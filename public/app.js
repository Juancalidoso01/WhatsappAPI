"use strict";

const POLL_MS = 6000;
const DAY_MS = 24 * 60 * 60 * 1000;

const state = {
  config: { brandName: "Punto Pago", templatesEnabled: false, hasCredentials: false },
  conversations: [],
  templates: [],
  campaigns: [],
  activeCampaignId: null,
  lineHealth: null,
  bulkPollTimer: null,
  workspace: null,
  workspaceTab: "profile",
  flows: [],
  flowCapability: null,
  activeFlowId: null,
  flowSamples: [],
  flowUseCases: [],
  activeUseCaseId: null,
  templatePresets: [],
  activeTemplatePreset: "punto_pago_autorizacion_pago",
  presetMetaStatus: [],
  tplMetaSyncedAt: null,
  flowsTab: "mis",
  payAuthFlowScreen: "AUTH",
  cardImageUrl: null,
  flowsDetailTab: "preview",
  activeFlowPerformance: null,
  activeActivityRow: null,
  flowActivity: [],
  activePhone: null,
  messages: [],
  conversationDetail: null,
  filter: "",
  pollTimer: null,
  notesTimer: null,
  leadTimer: null,
  leadSaveHintTimer: null,
  leadOptions: null,
  billingLedger: [],
  billingMetaRows: [],
  activeBillEntry: null,
  highlightMessageId: null,
  billingTab: "resumen",
  billingLastSync: null,
  billingRangeDirty: false,
  variableCatalog: [],
  currentScreen: "chats",
  screenCache: {},
};

/* ---------- tiny helpers ---------- */
const $ = (id) => document.getElementById(id);
const api = async (url, opts) => {
  const res = await fetch(url, opts);
  return res.json().catch(() => ({}));
};
const post = (url, body) =>
  api(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const patch = (url, body) =>
  api(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const postForm = (url, formData) => api(url, { method: "POST", body: formData });

function postCsv(url, formData) {
  return fetch(url, { method: "POST", body: formData }).then((res) => res.json().catch(() => ({})));
}

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function initials(name) {
  const parts = String(name || "?").trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]).join("").toUpperCase() || "?";
}
function timeAgo(ts) {
  if (!ts) return "";
  const d = Date.now() - ts;
  if (d < 60000) return "ahora";
  if (d < 3600000) return Math.floor(d / 60000) + "m";
  if (d < DAY_MS) return Math.floor(d / 3600000) + "h";
  return new Date(ts).toLocaleDateString("es", { day: "2-digit", month: "2-digit" });
}
let toastTimer;
function toast(msg, kind = "") {
  const t = $("toast");
  t.textContent = msg;
  t.className = "toast " + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 3200);
}

/* ---------- init ---------- */
async function init() {
  try {
    state.config = await api("/api/config");
  } catch (_) {}
  applyBranding();
  initSidebar();
  initLeadFormOptions();
  bindEvents();
  loadWorkspace().catch(() => {});
  await loadConversations();
  startPolling();
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopPolling();
    else { loadConversations(); if (state.activePhone) loadMessages(state.activePhone); startPolling(); }
  });
}

function applyBranding() {
  const ws = state.config.workspace || {};
  const name = ws.displayName || state.config.brandName || "Punto Pago";
  document.title = name + " · WhatsApp";
  const dot = $("connDot");
  if (dot) {
    dot.className = "conn-dot " + (state.config.persistent ? "online" : "offline");
    dot.title = state.config.persistent ? "Persistencia activa" : "Modo memoria";
  }
  if ($("sidebarBrandName")) $("sidebarBrandName").textContent = name;
  updateWorkspaceHubPreview(name, ws.hasProfilePhoto);
}

function avatarSrc(hasPhoto) {
  return hasPhoto ? `/api/workspace/avatar?t=${Date.now()}` : "/logo.png";
}

function updateWorkspaceHubPreview(name, hasPhoto) {
  const portal = $("wsPortalPhoto");
  const src = avatarSrc(hasPhoto);
  const status = state.config.persistent ? "En línea · datos persistentes" : "Modo memoria";
  ["wsFlyoutName", "wsHubName"].forEach((id) => { if ($(id)) $(id).textContent = name; });
  ["wsFlyoutStatus", "wsHubStatus"].forEach((id) => { if ($(id)) $(id).textContent = status; });
  ["wsFlyoutAvatar", "wsHubAvatar", "wsMobileAvatar"].forEach((id) => { if ($(id)) $(id).src = src; });
  if (portal) portal.src = src;
  const railLogo = $("railLogo");
  if (railLogo) railLogo.src = hasPhoto ? src : "/logo.png";
}

/* ---------- conversations ---------- */
async function loadConversations() {
  try {
    const data = await api("/api/conversations");
    if (Array.isArray(data)) {
      state.conversations = data;
      renderConversations();
    }
  } catch (_) {}
}

function renderConversations() {
  const list = $("conversationList");
  const q = state.filter.toLowerCase();
  const items = state.conversations.filter(
    (c) => !q || String(c.name).toLowerCase().includes(q) || String(c.phone).includes(q)
  );
  if (!items.length) {
    list.innerHTML = `<li class="muted" style="padding:24px;text-align:center">Sin conversaciones todavía</li>`;
    return;
  }
  list.innerHTML = items
    .map((c) => {
      const last = c.lastMessage || {};
      const prefix = last.direction === "out" ? "Tú: " : "";
      return `<li class="conv ${c.phone === state.activePhone ? "active" : ""}" data-phone="${escapeHtml(c.phone)}" data-name="${escapeHtml(c.name)}">
        <div class="avatar">${escapeHtml(initials(c.name))}</div>
        <div class="conv-body">
          <div class="conv-top">
            <span class="conv-name">${escapeHtml(c.name)}</span>
            <span class="conv-time">${timeAgo(c.lastActivity)}</span>
          </div>
          <div class="conv-last">${escapeHtml(prefix + previewText(last))}</div>
        </div>
      </li>`;
    })
    .join("");
  list.querySelectorAll(".conv").forEach((el) =>
    el.addEventListener("click", () => openConversation(el.dataset.phone, el.dataset.name))
  );
}

function closeChatView() {
  state.activePhone = null;
  state.highlightMessageId = null;
  $("emptyState").classList.remove("hidden");
  $("chatView").classList.add("hidden");
  const chats = document.querySelector("#screenChats");
  if (chats) chats.classList.remove("show-chat");
  setDetailPaneOpen(false);
  renderConversations();
}

async function openConversation(phone, name, highlightMessageId = null) {
  state.activePhone = phone;
  state.highlightMessageId = highlightMessageId || null;
  $("emptyState").classList.add("hidden");
  $("chatView").classList.remove("hidden");
  $("chatName").textContent = name;
  $("chatPhone").textContent = "+" + phone;
  $("chatAvatar").textContent = initials(name);
  $("detailName").textContent = name;
  $("detailPhone").textContent = "+" + phone;
  $("detailAvatar").textContent = initials(name);
  document.querySelector("#screenChats").classList.add("show-chat");
  renderConversations();
  await Promise.all([loadMessages(phone), loadConversationDetail(phone)]);
  if (state.highlightMessageId) {
    requestAnimationFrame(() => {
      const box = $("messages");
      const el = $("billHighlightMsg") || (box && box.querySelector(`[data-msg-id="${CSS.escape(state.highlightMessageId)}"]`));
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => {
        state.highlightMessageId = null;
        renderMessages();
      }, 5000);
    });
  }
}

async function loadMessages(phone) {
  try {
    const data = await api(`/api/conversations/${encodeURIComponent(phone)}/messages`);
    if (Array.isArray(data)) {
      state.messages = data;
      renderMessages();
      updateWindow();
    }
  } catch (_) {}
}

async function loadConversationDetail(phone) {
  try {
    const data = await api(`/api/conversations/${encodeURIComponent(phone)}/detail`);
    if (data && !data.error) {
      state.conversationDetail = data;
      renderDetailPanel();
      updateWindow();
    }
  } catch (_) {}
}

const TYPE_LABELS = {
  text: "Texto",
  image: "Imagen",
  audio: "Audio",
  video: "Video",
  document: "Documento",
  template: "Plantilla",
  sticker: "Sticker",
  interactive: "Interactivo",
};

const DEFAULT_LEAD_OPTIONS = {
  types: [
    { value: "", label: "Sin clasificar" },
    { value: "prospecto", label: "Prospecto" },
    { value: "cliente", label: "Cliente" },
    { value: "lead_caliente", label: "Lead caliente" },
    { value: "lead_frio", label: "Lead frío" },
    { value: "soporte", label: "Soporte" },
    { value: "otro", label: "Otro" },
  ],
  userTypes: [
    { value: "", label: "Sin definir" },
    { value: "titular", label: "Titular" },
    { value: "beneficiario", label: "Beneficiario" },
    { value: "representante", label: "Representante" },
    { value: "empleado", label: "Empleado" },
    { value: "otro", label: "Otro" },
  ],
};

function initLeadFormOptions(options) {
  const opts = options || state.leadOptions || DEFAULT_LEAD_OPTIONS;
  state.leadOptions = opts;
  const typeSel = $("leadType");
  const userSel = $("leadUserType");
  if (typeSel && !typeSel.options.length) {
    typeSel.innerHTML = (opts.types || DEFAULT_LEAD_OPTIONS.types)
      .map((o) => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`)
      .join("");
  }
  if (userSel && !userSel.options.length) {
    userSel.innerHTML = (opts.userTypes || DEFAULT_LEAD_OPTIONS.userTypes)
      .map((o) => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`)
      .join("");
  }
}

function renderDetailActivityKv(lead) {
  const box = $("detailActivityKv");
  if (!box || !lead) return;
  const r = lead.readonly || {};
  const rows = [
    ["Número de WhatsApp", r.whatsappNumber || "—"],
    ["Primera vez visto", r.firstSeenLabel || "—"],
    ["Última vez visto", r.lastSeenLabel || "—"],
    ["Último contacto (enviado)", r.lastContactedLabel || "—"],
    ["Última respuesta del cliente", r.lastHeardFromLabel || "—"],
  ];
  box.innerHTML = rows.map(([k, v]) =>
    `<div class="detail-kv-row"><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`
  ).join("");
}

function renderDetailAndroidKv(lead) {
  const box = $("detailAndroidKv");
  if (!box || !lead) return;
  const na = "No disponible vía WhatsApp";
  const rows = [
    ["Última vez en Android", na],
    ["Sesiones Android", na],
    ["Versión app Android", na],
    ["Dispositivo Android", na],
    ["Versión SO Android", na],
    ["Versión SDK Android", na],
  ];
  box.innerHTML = rows.map(([k, v]) =>
    `<div class="detail-kv-row"><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`
  ).join("");
}

function renderDetailLeadForm(lead) {
  if (!lead) return;
  initLeadFormOptions(lead.options);
  const e = lead.editable || {};
  const setIfIdle = (id, val) => {
    const el = $(id);
    if (!el || document.activeElement === el) return;
    el.value = val != null ? String(val) : "";
  };
  setIfIdle("leadName", e.name);
  setIfIdle("leadCompany", e.company);
  setIfIdle("leadType", e.type);
  setIfIdle("leadUserType", e.userType);
  setIfIdle("leadLocation", e.location || (lead.readonly && lead.readonly.inferredLocation) || "");
  setIfIdle("leadOwner", e.owner);
  setIfIdle("leadEmail", e.email);
  setIfIdle("leadUserId", e.userId);
  setIfIdle("leadSignedUp", e.signedUp);
  setIfIdle("leadLastOpenedEmail", e.lastOpenedEmail);
  const phoneEl = $("leadPhone");
  if (phoneEl) phoneEl.value = (lead.readonly && lead.readonly.phone) || "";

  const alert = $("detailLeadAlert");
  if (alert) {
    alert.classList.toggle("hidden", !lead.needsQualification);
  }
}

function collectLeadPayload() {
  return {
    name: ($("leadName") || {}).value.trim(),
    lead: {
      company: ($("leadCompany") || {}).value.trim(),
      type: ($("leadType") || {}).value,
      userType: ($("leadUserType") || {}).value,
      location: ($("leadLocation") || {}).value.trim(),
      owner: ($("leadOwner") || {}).value.trim(),
      email: ($("leadEmail") || {}).value.trim(),
      userId: ($("leadUserId") || {}).value.trim(),
      signedUp: ($("leadSignedUp") || {}).value,
      lastOpenedEmail: ($("leadLastOpenedEmail") || {}).value.trim(),
    },
  };
}

function setDetailPaneOpen(open) {
  const pane = $("detailPane");
  const backdrop = $("detailPaneBackdrop");
  if (pane) pane.classList.toggle("open", Boolean(open));
  if (backdrop) {
    backdrop.classList.toggle("show", Boolean(open));
    backdrop.setAttribute("aria-hidden", open ? "false" : "true");
  }
}

async function saveLeadProfile() {
  const phone = state.activePhone;
  if (!phone) return;
  const payload = collectLeadPayload();
  const d = state.conversationDetail;
  if (!d || !d.lead) return;

  const prev = d.lead.editable || {};
  const same = payload.name === (d.name || "") &&
    payload.lead.company === (prev.company || "") &&
    payload.lead.type === (prev.type || "") &&
    payload.lead.userType === (prev.userType || "") &&
    payload.lead.location === (prev.location || "") &&
    payload.lead.owner === (prev.owner || "") &&
    payload.lead.email === (prev.email || "") &&
    payload.lead.userId === (prev.userId || "") &&
    payload.lead.signedUp === (prev.signedUp || "") &&
    payload.lead.lastOpenedEmail === (prev.lastOpenedEmail || "");
  if (same) return;

  const res = await patch(`/api/conversations/${encodeURIComponent(phone)}`, payload);
  if (!res.ok) return;

  if (payload.name) {
    d.name = payload.name;
    $("detailName").textContent = payload.name;
    if (state.activePhone === phone) {
      $("chatName").textContent = payload.name;
      $("chatAvatar").textContent = initials(payload.name);
      $("detailAvatar").textContent = initials(payload.name);
    }
    const conv = state.conversations.find((c) => c.phone === phone);
    if (conv) conv.name = payload.name;
    renderConversations();
  }

  Object.assign(d.lead.editable, payload.lead, { name: payload.name });
  d.lead.needsQualification = (d.stats && d.stats.in > 0) && !payload.lead.type;
  const alert = $("detailLeadAlert");
  if (alert) alert.classList.toggle("hidden", !d.lead.needsQualification);

  const hint = $("detailLeadSaveHint");
  if (hint) {
    hint.classList.remove("hidden");
    clearTimeout(state.leadSaveHintTimer);
    state.leadSaveHintTimer = setTimeout(() => hint.classList.add("hidden"), 1800);
  }
}

function scheduleLeadSave() {
  clearTimeout(state.leadTimer);
  state.leadTimer = setTimeout(saveLeadProfile, 700);
}

function renderDetailPanel() {
  const d = state.conversationDetail;
  if (!d) return;

  const phoneText = d.phoneFormatted || ("+" + d.phone);
  $("detailPhone").textContent = phoneText;
  if (state.activePhone === d.phone) $("chatPhone").textContent = phoneText;

  const countryEl = $("detailCountry");
  if (d.country && d.country.name) {
    const flag = d.country.flag ? d.country.flag + " " : "";
    countryEl.textContent = flag + d.country.name;
  } else {
    countryEl.textContent = "—";
  }

  $("detailOrigin").textContent = d.originLabel || d.conversationOrigin || "—";

  const stats = d.stats || {};
  const typeLines = Object.entries(stats.byType || {})
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `<div class="detail-stat"><span>${escapeHtml(TYPE_LABELS[t] || t)}</span><span>${n}</span></div>`)
    .join("");
  $("detailStats").innerHTML = `
    <div class="detail-stat"><span>Total mensajes</span><span>${stats.total || 0}</span></div>
    <div class="detail-stat"><span>Entrantes</span><span>${stats.in || 0}</span></div>
    <div class="detail-stat"><span>Salientes</span><span>${stats.out || 0}</span></div>
    ${typeLines}`;

  if (d.lead) {
    renderDetailLeadForm(d.lead);
    renderDetailActivityKv(d.lead);
    renderDetailAndroidKv(d.lead);
  }

  const notesEl = $("detailNotes");
  if (document.activeElement !== notesEl) {
    notesEl.value = d.notes || "";
  }
}

async function saveNotes() {
  const phone = state.activePhone;
  if (!phone) return;
  const notes = $("detailNotes").value;
  if (state.conversationDetail && state.conversationDetail.notes === notes) return;
  const res = await patch(`/api/conversations/${encodeURIComponent(phone)}`, { notes });
  if (res.ok && state.conversationDetail) state.conversationDetail.notes = notes;
}

function previewText(m) {
  if (!m) return "";
  if (m.text) return m.text;
  if (m.type === "image") return "[imagen]";
  if (m.type === "audio") return "[nota de voz]";
  if (m.type === "video") return "[video]";
  if (m.type === "document") return "[documento]";
  return "";
}

function mediaSrc(m) {
  if (m.mediaId) return `/api/media/${encodeURIComponent(m.mediaId)}`;
  if (m.media) return m.media;
  return null;
}

function formatDuration(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function renderMedia(m) {
  const src = mediaSrc(m);
  if (!src) return "";
  if (m.type === "image") {
    return `<img src="${escapeHtml(src)}" alt="" loading="lazy" />`;
  }
  if (m.type === "audio") {
    const label = m.voice ? "Nota de voz" : "Audio";
    return `<div class="audio-wrap">
      <span class="audio-kind">${escapeHtml(label)} <span class="audio-duration" data-audio-dur>--:--</span></span>
      <audio controls preload="metadata" src="${escapeHtml(src)}"></audio>
    </div>`;
  }
  if (m.type === "video") {
    return `<video controls preload="metadata" src="${escapeHtml(src)}"></video>`;
  }
  if (m.type === "document") {
    const label = m.text || "Documento";
    return `<a class="doc-link" href="${escapeHtml(src)}" target="_blank" rel="noopener">${escapeHtml(label)}</a>`;
  }
  return "";
}

function guessMediaType(file) {
  const mime = String(file.type || "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return "document";
}

function updateMediaPreview() {
  const file = $("mdFile").files[0];
  const box = $("mdPreview");
  if (!file) {
    box.classList.add("hidden");
    box.innerHTML = "";
    return;
  }
  $("mdType").value = guessMediaType(file);
  box.classList.remove("hidden");
  if (file.type.startsWith("image/")) {
    const url = URL.createObjectURL(file);
    box.innerHTML = `<img src="${url}" alt="" /><span class="muted">${escapeHtml(file.name)}</span>`;
    return;
  }
  box.innerHTML = `<span class="muted">${escapeHtml(file.name)} · ${Math.max(1, Math.round(file.size / 1024))} KB</span>`;
}

const STATUS_LABELS = {
  pending: "Enviando…",
  sent: "Enviado",
  delivered: "Entregado",
  read: "Leído",
  failed: "Error al enviar",
};

function statusTick(m) {
  if (m.direction === "in") {
    let label = "Recibido";
    if (m.type === "audio") label = m.voice ? "Nota de voz recibida" : "Audio recibido";
    else if (m.type === "image") label = "Imagen recibida";
    else if (m.type === "video") label = "Video recibido";
    else if (m.type === "document") label = "Documento recibido";
    return `<span class="recv-badge" title="${escapeHtml(label)}">${escapeHtml(label)}</span>`;
  }
  const label = STATUS_LABELS[m.status] || "";
  const map = {
    pending: '<span class="tick"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></span>',
    sent: '<span class="tick"><svg viewBox="0 0 24 24"><path d="M4 12l5 5L20 6"/></svg></span>',
    delivered: '<span class="tick"><svg viewBox="0 0 24 24"><path d="M1 13l4 4L15 7M9 13l4 4L23 7"/></svg></span>',
    read: '<span class="tick read"><svg viewBox="0 0 24 24"><path d="M1 13l4 4L15 7M9 13l4 4L23 7"/></svg></span>',
    failed: '<span class="tick failed"><svg viewBox="0 0 24 24"><path d="M12 8v4m0 4h.01"/><circle cx="12" cy="12" r="9"/></svg></span>',
  };
  const icon = map[m.status] || "";
  if (!icon) return "";
  return `<span class="tick-wrap" title="${escapeHtml(label)}">${icon}<span class="tick-label">${escapeHtml(label)}</span></span>`;
}

function bindAudioDurations() {
  document.querySelectorAll(".audio-wrap audio").forEach((el) => {
    const badge = el.closest(".audio-wrap")?.querySelector("[data-audio-dur]");
    if (!badge) return;
    const update = () => {
      if (!el.duration || !Number.isFinite(el.duration)) return;
      badge.textContent = formatDuration(el.duration);
    };
    el.addEventListener("loadedmetadata", update);
    el.addEventListener("durationchange", update);
    update();
  });
}

function renderMessages() {
  const box = $("messages");
  const hi = state.highlightMessageId;
  box.innerHTML = state.messages
    .map((m) => {
      const tplClass = m.type === "template" ? " tpl" : "";
      const media = renderMedia(m);
      const caption = m.text ? escapeHtml(m.text) : "";
      const time = new Date(m.timestamp).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
      const isHi = hi && (m.id === hi);
      return `<div class="msg-row ${m.direction}" data-msg-id="${escapeHtml(m.id)}"${isHi ? ' id="billHighlightMsg"' : ""}>
        <div class="bubble${tplClass}${isHi ? " msg-highlight" : ""}">
          ${media}${caption}
          <div class="bubble-meta">${time}${statusTick(m)}</div>
        </div>
      </div>`;
    })
    .join("");
  box.scrollTop = box.scrollHeight;
  bindAudioDurations();
}

function lastInboundTs() {
  for (let i = state.messages.length - 1; i >= 0; i--) {
    if (state.messages[i].direction === "in") return state.messages[i].timestamp;
  }
  return 0;
}

function updateWindow() {
  const detail = state.conversationDetail;
  let open = false;
  let expiryMs = null;

  if (detail && detail.windowExpiresAt) {
    expiryMs = detail.windowExpiresAt * 1000;
    open = Date.now() < expiryMs;
  } else {
    const last = lastInboundTs();
    open = Boolean(last && Date.now() - last < DAY_MS);
    if (open) expiryMs = last + DAY_MS;
  }

  const pill = $("detailWindow");
  const banner = $("windowBanner");
  const expiryEl = $("detailWindowExpiry");

  if (open && expiryMs) {
    const remain = Math.max(0, expiryMs - Date.now());
    const hrs = Math.floor(remain / 3600000);
    const mins = Math.floor((remain % 3600000) / 60000);
    pill.className = "window-pill open";
    pill.textContent = `Abierta · ${hrs}h ${mins}m`;
    expiryEl.textContent = `Cierra: ${new Date(expiryMs).toLocaleString("es", { dateStyle: "medium", timeStyle: "short" })}`;
    banner.classList.add("hidden");
  } else {
    pill.className = "window-pill closed";
    pill.textContent = "Cerrada";
    if (detail && detail.windowExpiresAt) {
      expiryEl.textContent = `Expiró: ${new Date(detail.windowExpiresAt * 1000).toLocaleString("es", { dateStyle: "medium", timeStyle: "short" })}`;
    } else {
      expiryEl.textContent = "Sin mensajes recientes del cliente";
    }
    banner.classList.remove("hidden");
    banner.innerHTML = `La ventana de 24h está cerrada. Para escribir, envía una <strong>plantilla</strong> primero.`;
  }
}

/* ---------- send text ---------- */
async function sendText(text) {
  const phone = state.activePhone;
  if (!phone || !text.trim()) return;
  $("messageInput").value = "";
  const res = await post("/api/send", { phone, text: text.trim() });
  if (res.warning) toast(res.warning, "error");
  else if (res.error) toast("No se pudo enviar: " + res.error, "error");
  await loadMessages(phone);
  await loadConversationDetail(phone);
  await loadConversations();
}

/* ---------- templates ---------- */
async function loadTemplates() {
  const res = await api("/api/templates");
  state.templates = (res && res.data) || [];
  if (res && res.warning) toast(res.warning, "error");
  return state.templates;
}

function catTagHtml(cat, label) {
  const key = String(cat || "").toUpperCase();
  const text = label || key.toLowerCase();
  if (!key) return `<span class="cat-tag">—</span>`;
  return `<span class="cat-tag ${escapeHtml(key)}">${escapeHtml(text)}</span>`;
}

function categoryComment(t) {
  const info = t.categoryInfo;
  if (!info) return "";
  const userTracked = t.localMeta && t.localMeta.syncedFrom === "user";
  if (userTracked && info.hint) return info.hint;
  if (info.correct && info.current && info.correct !== info.current) {
    return info.hint || `WhatsApp sugiere cambiar a ${info.correctLabel}.`;
  }
  if (info.billingLabel) return `Facturación: ${info.billingLabel}.`;
  return "";
}

function formatTplDate(ts, kind) {
  if (!ts) return { main: "—", sub: "" };
  const d = new Date(ts);
  const main = d.toLocaleDateString("es", { day: "2-digit", month: "short", year: "numeric" });
  const sub = kind === "created" ? "Creada aquí" : "Meta";
  return { main, sub };
}

function previewSnippet(t, max = 72) {
  const header = (t.components || []).find((x) => x.type === "HEADER");
  const body = bodyOf(t) || "";
  const parts = [];
  if (header && header.text) parts.push(header.text);
  if (body) parts.push(body);
  const text = parts.join(" · ").replace(/\s+/g, " ").trim();
  if (!text) return "—";
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

function renderTemplateRow(t, i) {
  const st = (t.status || "").toLowerCase();
  const cls = st === "approved" ? "approved" : st === "rejected" ? "rejected" : "pending";
  const info = t.categoryInfo || {};
  const comment = categoryComment(t);
  const canSend = st === "approved";
  const date = formatTplDate(t.displayAt, t.displayAtKind);
  const snippet = previewSnippet(t);
  const fullPreview = previewSnippet(t, 500);
  const isFlowTpl = templateHasFlowButtonMeta(t);
  return `<tr class="tpl-row${isFlowTpl ? " tpl-row-flow" : ""}" data-i="${i}" title="${escapeHtml(fullPreview)}">
    <td class="tpl-name-cell">
      <span class="tpl-table-name">${escapeHtml(t.name)}</span>
      ${isFlowTpl ? `<span class="tpl-flow-tag">Flow</span>` : ""}
      ${comment ? `<span class="tpl-table-note" title="${escapeHtml(comment)}">${escapeHtml(comment)}</span>` : ""}
    </td>
    <td>${escapeHtml(t.language || "—")}</td>
    <td>${catTagHtml(info.billingCategory, info.billingLabel)}</td>
    <td><span class="status-badge ${cls}">${escapeHtml(t.status || "—")}</span></td>
    <td class="tpl-date-cell">
      <span>${escapeHtml(date.main)}</span>
      ${date.sub ? `<span class="muted">${escapeHtml(date.sub)}</span>` : ""}
    </td>
    <td class="tpl-preview-cell muted">${escapeHtml(snippet)}</td>
    <td class="tpl-action-cell">
      ${canSend
    ? `<button type="button" class="btn-ghost sm tpl-send-btn" data-i="${i}">Enviar</button>`
    : `<span class="muted">—</span>`}
    </td>
  </tr>`;
}

function renderTemplateList() {
  const list = $("templateList");
  if (!state.config.templatesEnabled) {
    list.innerHTML = `<p class="muted center-msg">Configura ACCESS_TOKEN y WABA_ID para gestionar plantillas.</p>`;
    return;
  }
  if (!state.templates.length) {
    list.innerHTML = `<p class="muted center-msg">No hay plantillas. Pulsa “Crear”.</p>`;
    return;
  }
  const count = state.templates.length;
  list.innerHTML = `
    <p class="templates-count muted">${count} plantilla${count === 1 ? "" : "s"} en tu cuenta</p>
    <div class="billing-table-wrap">
      <table class="templates-table billing-table">
        <thead>
          <tr>
            <th>Plantilla</th>
            <th>Idioma</th>
            <th>Categoría</th>
            <th>Estado</th>
            <th>Fecha</th>
            <th>Mensaje</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${state.templates.map((t, i) => renderTemplateRow(t, i)).join("")}</tbody>
      </table>
    </div>`;
  list.querySelectorAll(".tpl-send-btn").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openNewChat(state.templates[btn.dataset.i].name);
    })
  );
}

function bodyOf(t) {
  const c = (t.components || []).find((x) => x.type === "BODY");
  return c ? c.text : "";
}

/* ---------- create template (placeholders + emojis) ---------- */
const tpState = {
  limits: { header: 60, body: 1024, footer: 60 },
  emojis: [],
  vars: [],
  placeholderRules: [],
  validation: { ok: false, errors: [], warnings: [] },
  validateTimer: null,
};

function tpGraphemeLen(text) {
  const s = String(text || "");
  if (typeof Intl !== "undefined" && Intl.Segmenter) {
    return [...new Intl.Segmenter("es", { granularity: "grapheme" }).segment(s)].length;
  }
  return [...s].length;
}

function tpExtractPlaceholders(text) {
  const m = String(text || "").match(/\{\{\s*(\d+)\s*\}\}/g);
  if (!m) return [];
  return [...new Set(m.map((x) => Number(x.replace(/\D/g, ""))))].sort((a, b) => a - b);
}

function tpDefaultVars() {
  return [
    { key: "nombre", example: "Juan" },
    { key: "monto", example: "100.00" },
    { key: "fecha", example: "15/03/2026" },
  ];
}

function brandDisplayName() {
  const ws = state.config.workspace || {};
  return ws.displayName || state.config.brandName || "Punto Pago";
}

const PRESET_FIELD_IDS = {
  nombre_cliente: { draft: "tplPreviewName", flow: "payAuthCustomerName" },
  monto: { draft: "tplPreviewAmount", flow: "payAuthAmount" },
  comercio: { draft: "tplPreviewMerchant", flow: "payAuthMerchant" },
  ultimos_4: { draft: "tplPreviewCard4", flow: "payAuthCard4" },
};

const VAR_TYPE_HINTS = {
  text: { typeLabel: "Texto", accept: "Letras y espacios. Sin emojis ni saltos de línea.", example: "Juan Pablo" },
  money: { typeLabel: "Monto", accept: "Moneda ISO + monto (2 decimales). Ej: USD 45.90", example: "USD 45.90" },
  merchant: { typeLabel: "Comercio", accept: "Nombre del establecimiento.", example: "Supermercado XO" },
  card_last4: { typeLabel: "4 dígitos", accept: "Exactamente 4 números.", example: "4821" },
  phone: { typeLabel: "Teléfono", accept: "Dígitos con código de país.", example: "50763163152" },
  date: { typeLabel: "Fecha", accept: "Fecha legible.", example: "15 mar 2026" },
  code: { typeLabel: "Código", accept: "Alfanumérico corto.", example: "FAC-2026-00482" },
  id_ref: { typeLabel: "ID interno", accept: "Identificador del cliente. Sin espacios.", example: "CLI-10482" },
  integer: { typeLabel: "Entero", accept: "Solo dígitos (días, cuotas).", example: "15" },
  url: { typeLabel: "URL", accept: "Enlace https:// público.", example: "https://…" },
  generic: { typeLabel: "Texto", accept: "Texto corto sin saltos de línea.", example: "Valor" },
};

function inferVarTypeFromKey(key) {
  const k = String(key || "").toLowerCase();
  if (/^id_/.test(k) || k === "id_cliente") return "id_ref";
  if (/monto|amount|importe|saldo|cuota|deuda/.test(k)) return "money";
  if (/comercio|merchant|tienda/.test(k)) return "merchant";
  if (/ultimos|last4|card|tarjeta/.test(k)) return "card_last4";
  if (/^nombre_|_nombre$/.test(k)) return "text";
  if (/telefono|phone|celular|movil/.test(k)) return "phone";
  if (/fecha|date|vence|vencimiento/.test(k)) return "date";
  if (/numero_|num_|factura|referencia/.test(k)) return "code";
  if (/dias_/.test(k)) return "integer";
  if (/cliente|customer/.test(k)) return "text";
  return "generic";
}

function lookupClientSchema(key) {
  const flat = (state.variableCatalog || []).flatMap((g) => g.variables || []);
  return flat.find((v) => v.key === key) || null;
}

function clientVarSchema(v, index) {
  const key = (v && v.key) || "";
  const fromCatalog = key ? lookupClientSchema(key) : null;
  if (fromCatalog) return { ...fromCatalog, index };
  const type = (v && v.type) || inferVarTypeFromKey(key);
  const meta = VAR_TYPE_HINTS[type] || VAR_TYPE_HINTS.generic;
  return {
    key: key || `variable_${index + 1}`,
    label: (v && v.label) || key || `Variable {{${index + 1}}}`,
    placeholder: (v && v.placeholder) || `{{${index + 1}}}`,
    type,
    typeLabel: (v && v.typeLabel) || meta.typeLabel,
    accept: (v && v.accept) || meta.accept,
    example: (v && v.example) || meta.example,
    mapsTo: v && v.mapsTo,
    maxLength: v && v.maxLength,
    pattern: v && v.pattern,
    status: v && v.status,
    component: v && v.component,
    index,
  };
}

function variableGuideTableHtml(vars, { title = "Leyenda de variables" } = {}) {
  if (!vars || !vars.length) return "";
  const rows = vars.map((v, i) => {
    const s = v.typeLabel ? v : clientVarSchema(v, i);
    return `<tr>
      <td><span class="tpl-var-ph">${escapeHtml(s.placeholder || `{{${i + 1}}}`)}</span><br><strong>${escapeHtml(s.label)}</strong>${s.key ? `<br><code class="muted sm">${escapeHtml(s.key)}</code>` : ""}</td>
      <td><span class="tpl-var-type">${escapeHtml(s.typeLabel || "Texto")}</span>${s.mapsTo ? `<div class="muted sm">${escapeHtml(s.mapsTo)}</div>` : ""}</td>
      <td class="muted sm">${escapeHtml(s.accept || "—")}</td>
      <td><code>${escapeHtml(s.example || "—")}</code></td>
    </tr>`;
  }).join("");
  return `${title ? `<p class="tpl-var-guide-title">${escapeHtml(title)}</p>` : ""}
    <table class="tpl-var-guide-table">
      <thead><tr><th>Variable</th><th>Tipo</th><th>Formato aceptado</th><th>Ejemplo</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderVariableGuide(el, vars, opts) {
  if (!el) return;
  if (!vars || !vars.length) {
    el.innerHTML = "";
    el.classList.add("hidden");
    return;
  }
  el.innerHTML = variableGuideTableHtml(vars, opts);
  el.classList.remove("hidden");
}

function inputAttrsFromSchema(schema) {
  const parts = [];
  if (schema.maxLength) parts.push(`maxlength="${schema.maxLength}"`);
  if (schema.pattern) parts.push(`pattern="${schema.pattern}"`);
  if (schema.type === "card_last4") parts.push('inputmode="numeric" maxlength="4" pattern="\\d{4}"');
  if (schema.type === "phone") parts.push('inputmode="tel"');
  if (schema.type === "money") parts.push(`placeholder="${escapeHtml(schema.example || "USD 45.90")}"`);
  return parts.join(" ");
}

function renderTplDraftInputs(guide) {
  const box = $("tplDraftFields");
  if (!box) return;
  const items = guide && guide.length ? guide : [];
  if (!items.length) {
    box.innerHTML = `<p class="muted sm">Sin variables configuradas.</p>`;
    renderVariableGuide($("tplDraftVarGuide"), []);
    return;
  }
  box.innerHTML = items.map((v) => {
    const s = v.typeLabel ? v : clientVarSchema(v, v.index || 0);
    const ids = PRESET_FIELD_IDS[s.key];
    const id = (ids && ids.draft) || `tplVar_${s.key}`;
    const val = s.example || "";
    return `<label>${escapeHtml(s.label)} <span class="tpl-var-ph">${escapeHtml(s.placeholder || "")}</span>
      <input id="${id}" type="text" value="${escapeHtml(val)}" ${inputAttrsFromSchema(s)} />
      <span class="tpl-field-hint">${escapeHtml(s.accept || "")}</span>
    </label>`;
  }).join("");
  items.forEach((v) => {
    const s = v.typeLabel ? v : clientVarSchema(v, v.index || 0);
    const ids = PRESET_FIELD_IDS[s.key];
    const id = (ids && ids.draft) || `tplVar_${s.key}`;
    const el = $(id);
    if (el) el.addEventListener("input", () => {
      updateTplDraftPreview();
      updatePayAuthPreview();
      updatePayAuthFlowPreview();
    });
  });
  renderVariableGuide($("tplDraftVarGuide"), items, { title: "Qué significa cada variable" });
}

function renderPayAuthVarGuide(guide) {
  renderVariableGuide($("payAuthVarGuide"), guide, { title: "Variables del mensaje de verificación 3DS" });
}

function updateTpVarGuide() {
  const vars = collectTpVariables().filter((v) => v.key || v.example);
  const guide = vars.map((v, i) => clientVarSchema(v, i));
  renderVariableGuide($("tpVarGuide"), guide, { title: "Guía de variables que estás definiendo" });
}

function tplPreviewOverrides() {
  return {
    nombre_cliente: ($("tplPreviewName") || {}).value || ($("payAuthCustomerName") || {}).value || "Juan Pablo",
    monto: formatPreviewAmount(($("tplPreviewAmount") || {}).value || ($("payAuthAmount") || {}).value || "45.90"),
    comercio: ($("tplPreviewMerchant") || {}).value || ($("payAuthMerchant") || {}).value || "Supermercado XO",
    ultimos_4: ($("tplPreviewCard4") || {}).value || ($("payAuthCard4") || {}).value || "4821",
  };
}

function formatPreviewAmount(raw) {
  const n = Number.parseFloat(String(raw || "0").replace(",", "."));
  if (Number.isNaN(n)) return `USD ${raw}`;
  return `USD ${n.toFixed(2)}`;
}

function renderWaMessagePreview(container, data) {
  if (!container || !data) return;
  const now = new Date();
  const time = now.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
  const header = data.headerText ? `<div class="wa-preview-header">${escapeHtml(data.headerText)}</div>` : "";
  const footer = data.footerText ? `<div class="wa-preview-footer">${escapeHtml(data.footerText)}</div>` : "";
  const cta = data.flowCta || data.cta
    ? `<div class="wa-preview-cta">${escapeHtml(data.flowCta || data.cta)}</div>`
    : "";
  container.innerHTML = `
    <div class="wa-preview-top">${escapeHtml(brandDisplayName())}</div>
    <div class="wa-preview-body">
      <div class="wa-preview-bubble">
        ${header}
        <div>${escapeHtml(data.bodyText || "—")}</div>
        ${footer}
        <div class="wa-preview-time">${time}</div>
        ${cta}
      </div>
    </div>
    <div class="wa-preview-note">Vista previa · el Flow se abre al tocar el botón</div>`;
}

function templateHasFlowButtonMeta(t) {
  const b = (t.components || []).find((x) => x.type === "BUTTONS");
  return Boolean(b && (b.buttons || []).some((btn) => String(btn.type || "").toUpperCase() === "FLOW"));
}

function presetMetaForKey(key) {
  return (state.presetMetaStatus || []).find((m) => m.key === key) || null;
}

function metaStatusBadge(status, fallbackLabel) {
  const st = String(status || "NOT_SUBMITTED").toLowerCase();
  const labels = {
    approved: "Aprobada",
    pending: "En revisión",
    rejected: "Rechazada",
    not_submitted: "Sin enviar",
  };
  const cls = st === "approved" ? "approved" : st === "rejected" ? "rejected" : st === "pending" ? "pending" : "draft";
  const text = labels[st] || fallbackLabel || status || "—";
  return `<span class="status-badge ${cls}">${escapeHtml(text)}</span>`;
}

async function loadTplVariableCatalog() {
  const res = await api("/api/templates/variable-catalog");
  state.variableCatalog = (res && res.ok && res.catalog) || [];
  const box = $("tplVarCatalogBody");
  if (!box) return;
  if (!state.variableCatalog.length) {
    box.textContent = res && res.error ? res.error : "Sin catálogo.";
    return;
  }
  box.innerHTML = state.variableCatalog.map((g) => `
    <div class="tpl-var-catalog-group">
      <h4>${escapeHtml(g.label)}
        <span class="tpl-var-status ${escapeHtml(g.status)}">${g.status === "active" ? "En uso" : "Futuro"}</span>
      </h4>
      <p class="muted sm">${escapeHtml(g.note || "")}</p>
      ${variableGuideTableHtml(g.variables, { title: "" })}
    </div>`).join("");
  renderTpVarCatalogPick();
}

function renderTpVarCatalogPick() {
  const box = $("tpVarCatalogPick");
  if (!box) return;
  const picks = (state.variableCatalog || [])
    .flatMap((g) => (g.variables || []).filter((v) => v.status === "reference"));
  if (!picks.length) {
    box.classList.add("hidden");
    box.innerHTML = "";
    return;
  }
  box.classList.remove("hidden");
  box.innerHTML = `<span class="muted sm" style="flex:1 1 100%;margin-bottom:2px">Claves sugeridas (referencia; no envía nada a Meta):</span>`
    + picks.map((v) =>
      `<button type="button" class="tpl-var-pick-btn" data-key="${escapeHtml(v.key)}" title="${escapeHtml(v.label + " — " + (v.accept || ""))}">${escapeHtml(v.key)}</button>`
    ).join("");
  box.querySelectorAll(".tpl-var-pick-btn").forEach((btn) =>
    btn.addEventListener("click", () => applyTpVarPick(btn.dataset.key))
  );
}

function applyTpVarPick(key) {
  if (!key) return;
  const s = lookupClientSchema(key);
  let rows = collectTpVariables();
  if (!rows.length) rows = [{ key: "", example: "" }];
  let idx = rows.findIndex((r) => !r.key);
  if (idx < 0) {
    rows.push({ key: "", example: "" });
    idx = rows.length - 1;
  }
  rows[idx] = { key, example: s.example || "" };
  renderTpVarList(rows);
  updateTpVarGuide();
  toast(`Clave «${key}» lista en variable {{${idx + 1}}}.`, "ok");
}

async function loadTemplatePresets() {
  const res = await api("/api/templates/presets");
  state.templatePresets = (res && res.presets) || [];
  state.presetMetaStatus = (res && res.metaStatus) || [];
  state.tplMetaSyncedAt = res && res.syncedAt ? res.syncedAt : null;
  updateTplSyncHint();
  renderTplPresetCards();
}

async function syncTemplatesWithMeta() {
  const btn = $("tplSyncMetaBtn");
  const hint = $("tplSyncMetaHint");
  if (btn) btn.disabled = true;
  if (hint) hint.textContent = "Sincronizando…";
  const res = await post("/api/templates/sync-meta", {});
  if (btn) btn.disabled = false;
  if (!res.ok) {
    if (hint) hint.textContent = res.error || "No se pudo sincronizar.";
    toast(res.error || "Error al sincronizar con Meta.", "error");
    return;
  }
  state.templates = res.data || [];
  state.presetMetaStatus = res.metaStatus || [];
  state.tplMetaSyncedAt = res.syncedAt || Date.now();
  updateTplSyncHint();
  renderTplPresetCards();
  renderTemplateList();
  if (state.activeTemplatePreset) renderTplDraftMetaBar(state.activeTemplatePreset);
  toast(`Sincronizado: ${res.total || 0} plantilla(s) en Meta.`, "ok");
}

function renderTplDraftMetaBar(key) {
  const el = $("tplDraftMetaBar");
  if (!el) return;
  const preset = state.templatePresets.find((p) => p.key === key);
  const ms = presetMetaForKey(key);
  if (!preset) {
    el.innerHTML = "";
    return;
  }
  if (!ms) {
    el.innerHTML = `<p class="muted sm tpl-draft-meta-hint">Pulsa «Sincronizar con Meta» arriba para ver el estado de aprobación.</p>`;
    return;
  }
  const textBadge = metaStatusBadge(ms.text && ms.text.status);
  const flowBadge = preset.templateFlowName
    ? metaStatusBadge(ms.flow && ms.flow.status)
    : "";
  const readyTag = ms.readyForProduction
    ? `<span class="tpl-preset-tag tpl-ready-prod">Lista para producción</span>`
    : `<p class="muted sm tpl-draft-meta-hint">Cuando Texto y + Flow estén aprobadas, los envíos usarán la plantilla oficial con botón Flow.</p>`;
  el.innerHTML = `
    <span class="tpl-preset-tag">Texto ${textBadge}</span>
    ${preset.templateFlowName ? `<span class="tpl-preset-tag">+ Flow ${flowBadge}</span>` : ""}
    ${readyTag}`;
}

function updateTplSyncHint() {
  const hint = $("tplSyncMetaHint");
  if (!hint) return;
  if (!state.tplMetaSyncedAt) {
    hint.textContent = "Actualiza estados de aprobación (Texto / + Flow).";
    return;
  }
  const when = new Date(state.tplMetaSyncedAt).toLocaleString("es", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
  hint.textContent = `Actualizado ${when}`;
}

function renderTplPresetCards() {
  const box = $("tplPresetCards");
  if (!box) return;
  if (!state.templatePresets.length) {
    box.innerHTML = `<p class="muted">No hay borradores disponibles.</p>`;
    return;
  }
  box.innerHTML = state.templatePresets.map((p) => {
    const ms = presetMetaForKey(p.key);
    const textBadge = ms ? metaStatusBadge(ms.text && ms.text.status) : metaStatusBadge("NOT_SUBMITTED");
    const flowBadge = p.templateFlowName && ms
      ? metaStatusBadge(ms.flow && ms.flow.status)
      : "";
    const ready = ms && ms.readyForProduction
      ? `<span class="tpl-preset-tag tpl-ready-prod">Lista para producción</span>`
      : "";
    return `
    <button type="button" class="tpl-preset-card${p.isFlowPreset ? " flow-preset" : ""}" data-preset="${escapeHtml(p.key)}">
      <h3>${escapeHtml(p.label)}</h3>
      <p>${escapeHtml(p.description || "")}</p>
      <div class="tpl-card-meta">
        <span class="tpl-preset-tag">Texto ${textBadge}</span>
        ${p.templateFlowName ? `<span class="tpl-preset-tag">+ Flow ${flowBadge}</span>` : ""}
        ${ready}
        <span class="tpl-preset-tag">${escapeHtml(String(p.category || "UTILITY").toLowerCase())}</span>
      </div>
      <p class="tpl-preset-names muted sm">${escapeHtml(p.name)}${p.templateFlowName ? ` · ${escapeHtml(p.templateFlowName)}` : ""}</p>
    </button>`;
  }).join("");
  box.querySelectorAll(".tpl-preset-card").forEach((btn) =>
    btn.addEventListener("click", () => openTplDraftModal(btn.dataset.preset))
  );
}

async function openTplDraftModal(key) {
  state.activeTemplatePreset = key || state.activeTemplatePreset;
  const preset = state.templatePresets.find((p) => p.key === key);
  if ($("payAuthCustomerName") && $("tplPreviewName")) {
    $("tplPreviewName").value = $("payAuthCustomerName").value.trim() || "Juan Pablo";
    $("tplPreviewAmount").value = ($("payAuthAmount") || {}).value || "45.90";
    $("tplPreviewMerchant").value = ($("payAuthMerchant") || {}).value || "Supermercado XO";
    $("tplPreviewCard4").value = ($("payAuthCard4") || {}).value || "4821";
  }
  if ($("tplDraftTitle")) $("tplDraftTitle").textContent = preset ? preset.label : "Borrador";
  if ($("tplDraftDesc")) $("tplDraftDesc").textContent = preset ? preset.description : "";
  renderTplDraftMetaBar(key);
  const presetRes = await api(`/api/templates/presets/${encodeURIComponent(key)}`);
  const guide = (presetRes && presetRes.preset && presetRes.preset.variableGuide)
    || (preset && preset.variables) || [];
  renderTplDraftInputs(guide);
  await updateTplDraftPreview();
  showModal("modalTplDraft");
}

async function updateTplDraftPreview() {
  const key = state.activeTemplatePreset;
  if (!key) return;
  const res = await fetchPresetPreview(key, tplPreviewOverrides());
  if (!res) return;
  renderWaMessagePreview($("tplDraftWaPreview"), {
    headerText: res.preview.headerText,
    bodyText: res.preview.bodyText,
    footerText: res.preview.footerText,
    flowCta: res.preview.flowCta,
  });
  updatePayAuthPreview();
}

async function fetchPresetPreview(key, overrides) {
  const q = new URLSearchParams(overrides || tplPreviewOverrides()).toString();
  const res = await api(`/api/templates/presets/${encodeURIComponent(key)}?${q}`);
  return (res && res.ok) ? res : null;
}

async function updatePayAuthPreview() {
  const res = await fetchPresetPreview("punto_pago_autorizacion_pago", tplPreviewOverrides());
  if (!res || !res.preset || !res.preset.flowMessage) return;
  const fm = res.preset.flowMessage;
  const ov = tplPreviewOverrides();
  const body = fm.bodyText
    .replace(/\{\{\s*monto\s*\}\}/g, ov.monto)
    .replace(/\{\{\s*comercio\s*\}\}/g, ov.comercio)
    .replace(/\{\{\s*ultimos_4\s*\}\}/g, ov.ultimos_4)
    .replace(/\{\{\s*nombre_cliente\s*\}\}/g, ov.nombre_cliente);
  renderWaMessagePreview($("payAuthWaPreview"), {
    headerText: fm.headerText,
    bodyText: body,
    footerText: fm.footerText,
    flowCta: fm.cta,
  });
}

async function initTemplateStudio() {
  await Promise.all([loadTemplatePresets(), loadTplVariableCatalog()]);
}

function applyPresetToForm(preset) {
  if (!preset) return;
  if ($("tpName")) $("tpName").value = preset.name || "";
  if ($("tpCategory")) $("tpCategory").value = preset.category || "UTILITY";
  if ($("tpLang")) $("tpLang").value = preset.language || "es";
  if ($("tpHeader")) $("tpHeader").value = preset.headerText || "";
  if ($("tpBody")) $("tpBody").value = preset.bodyText || "";
  if ($("tpFooter")) $("tpFooter").value = preset.footerText || "";
  renderTpVarList(preset.variables || []);
  if ($("tpVarsSection")) {
    $("tpVarsSection").classList.toggle("hidden", !(preset.variables && preset.variables.length));
  }
  updateTpPreview();
}

async function loadTemplatePresetIntoModal(key) {
  const res = await api(`/api/templates/presets/${encodeURIComponent(key)}`);
  if (!res || !res.ok || !res.preset) return;
  applyPresetToForm(res.preset);
}

function setFlowsTab(tab) {
  if (tab !== "mis" && tab !== "actividad") tab = "mis";
  state.flowsTab = tab;
  document.querySelectorAll(".flows-tab").forEach((b) =>
    b.classList.toggle("active", b.dataset.flowsTab === tab)
  );
  ["flowsPanelMis", "flowsPanelActividad", "flowsPanelCrear", "flowsPanelProbar"].forEach((id) => {
    const el = $(id);
    if (el) el.classList.add("hidden");
  });
  if (tab === "mis") {
    $("flowsPanelMis")?.classList.remove("hidden");
    const hasFlow = Boolean(state.activeFlowId);
    if ($("flowsDetailPanel")) $("flowsDetailPanel").classList.toggle("hidden", !hasFlow);
    if ($("flowsEmptyDetail")) $("flowsEmptyDetail").classList.toggle("hidden", hasFlow);
  } else if (tab === "actividad") {
    $("flowsPanelActividad")?.classList.remove("hidden");
    loadFlowActivity();
  }
}

function openFlowCreate() {
  state.activeUseCaseId = null;
  ["flowsPanelMis", "flowsPanelActividad", "flowsPanelProbar"].forEach((id) => {
    $(id)?.classList.add("hidden");
  });
  $("flowsPanelCrear")?.classList.remove("hidden");
  $("flowCreatePicker")?.classList.add("hidden");
  initFlowStudio();
}

function closeFlowCreate() {
  state.activeUseCaseId = null;
  setFlowsTab("mis");
}

function openFlowProbar() {
  ["flowsPanelMis", "flowsPanelActividad", "flowsPanelCrear"].forEach((id) => {
    $(id)?.classList.add("hidden");
  });
  $("flowsPanelProbar")?.classList.remove("hidden");
  updatePayAuthPreview();
  updatePayAuthFlowPreview();
}

function closeFlowProbar() {
  setFlowsTab("mis");
}

function syncTpVariablesSection() {
  const section = $("tpVarsSection");
  if (!section) return;
  const header = ($("tpHeader") || {}).value || "";
  const body = ($("tpBody") || {}).value || "";
  const bodyPh = tpExtractPlaceholders(body);
  const headerPh = tpExtractPlaceholders(header);
  const needed = Math.max(bodyPh.length, headerPh.length ? 1 : 0);
  const vars = collectTpVariables();
  const manualRows = vars.filter((v) => v.key || v.example).length;
  const show = needed > 0 || manualRows > 0 || vars.length > 1;
  section.classList.toggle("hidden", !show);
  if (!show) return;
  const target = Math.max(needed, vars.length, manualRows ? vars.length : 0, 1);
  if (vars.length !== target) {
    const next = vars.slice(0, target);
    while (next.length < target) next.push({ key: "", example: "" });
    renderTpVarList(next);
  }
}

function collectTpVariables() {
  const rows = $("tpVarList").querySelectorAll(".tp-var-row");
  return Array.from(rows).map((row, i) => ({
    key: (row.querySelector(".tp-var-key") || {}).value.trim(),
    example: (row.querySelector(".tp-var-ex") || {}).value.trim(),
    index: i + 1,
  }));
}

function renderTpVarList(vars) {
  const list = $("tpVarList");
  if (!list) return;
  const items = vars && vars.length ? vars : [];
  if (!items.length) {
    list.innerHTML = "";
    return;
  }
  list.innerHTML = items.map((v, i) => `
    <div class="tp-var-row" data-i="${i}">
      <span class="tp-var-n">{{${i + 1}}}</span>
      <input class="tp-var-key" type="text" placeholder="clave_api" value="${escapeHtml(v.key || "")}" />
      <input class="tp-var-ex" type="text" placeholder="ejemplo Meta" value="${escapeHtml(v.example || "")}" />
      <button type="button" class="btn-ghost sm tp-insert" title="Insertar {{${i + 1}}} en el cuerpo">{{${i + 1}}}</button>
      <button type="button" class="btn-ghost sm tp-remove" title="Quitar">×</button>
    </div>`).join("");

  list.querySelectorAll(".tp-insert").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.closest(".tp-var-row").dataset.i) + 1;
      insertTpPlaceholder("tpBody", `{{${i}}}`);
    });
  });
  list.querySelectorAll(".tp-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      const rows = collectTpVariables().filter((_, idx) => idx !== Number(btn.closest(".tp-var-row").dataset.i));
      renderTpVarList(rows);
      updateTpPreview();
    });
  });
  list.querySelectorAll("input").forEach((inp) => inp.addEventListener("input", () => {
    updateTpPreview();
    updateTpVarGuide();
  }));
  updateTpVarGuide();
}

function insertTpPlaceholder(fieldId, token) {
  const el = $(fieldId);
  if (!el) return;
  const start = el.selectionStart != null ? el.selectionStart : el.value.length;
  const end = el.selectionEnd != null ? el.selectionEnd : el.value.length;
  const before = el.value.slice(0, start);
  const after = el.value.slice(end);
  el.value = before + token + after;
  el.focus();
  const pos = start + token.length;
  if (el.setSelectionRange) el.setSelectionRange(pos, pos);
  updateTpFieldCounts();
  updateTpPreview();
}

function insertTpEmoji(fieldId, emoji) {
  insertTpPlaceholder(fieldId, emoji);
}

function updateTpFieldCounts() {
  const fields = [
    ["tpHeader", "tpHeaderCount", "header"],
    ["tpBody", "tpBodyCount", "body"],
    ["tpFooter", "tpFooterCount", "footer"],
  ];
  fields.forEach(([id, countId, kind]) => {
    const el = $(id);
    const box = $(countId);
    if (!el || !box) return;
    const len = tpGraphemeLen(el.value);
    const max = tpState.limits[kind] || 1024;
    box.textContent = `${len} / ${max} caracteres`;
    box.className = "field-count muted" + (len > max ? " over" : len > max * 0.9 ? " warn" : "");
  });
}

function renderTpMetaRules() {
  const list = $("tpMetaRulesList");
  if (!list) return;
  const rules = tpState.placeholderRules.length
    ? tpState.placeholderRules
    : [
      "Solo {{1}}, {{2}}… (números, sin nombres).",
      "Consecutivos, sin saltos.",
      "No empezar ni terminar con {{n}}.",
      "Ejemplos sin #, $ ni %.",
      "Suficiente texto fijo entre variables.",
    ];
  list.innerHTML = rules.map((r) => `<li>${escapeHtml(r)}</li>`).join("");
}

function collectTpDraftPayload() {
  return {
    headerText: ($("tpHeader") || {}).value.trim(),
    bodyText: ($("tpBody") || {}).value.trim(),
    footerText: ($("tpFooter") || {}).value.trim(),
    variables: collectTpVariables(),
  };
}

function renderTpValidation(result) {
  const box = $("tpValidation");
  const btn = $("tpCreate");
  if (!box) return;
  const errors = (result && result.errors) || [];
  const warnings = (result && result.warnings) || [];
  const ok = result && result.ok;

  tpState.validation = { ok: Boolean(ok), errors, warnings };

  if (btn) btn.disabled = !ok || !($("tpBody") || {}).value.trim();

  if (!($("tpBody") || {}).value.trim()) {
    box.className = "tp-validation hidden";
    box.innerHTML = "";
    return;
  }

  box.classList.remove("hidden");
  if (ok && !warnings.length) {
    box.className = "tp-validation ok";
    box.innerHTML = "✓ Cumple las reglas de Meta para variables. Puedes enviar a revisión.";
    return;
  }
  if (ok && warnings.length) {
    box.className = "tp-validation warn";
    box.innerHTML = `<strong>Listo con avisos:</strong><ul>${warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}</ul>`;
    return;
  }
  box.className = "tp-validation error";
  box.innerHTML = `<strong>Corrige antes de enviar a Meta:</strong><ul>${errors.map((e) => `<li>${escapeHtml(e)}</li>`).join("")}</ul>`;

  document.querySelectorAll(".tp-var-row").forEach((row, i) => {
    const keyInp = row.querySelector(".tp-var-key");
    const exInp = row.querySelector(".tp-var-ex");
    const n = i + 1;
    const badKey = errors.some((e) => e.includes(`{{${n}}}`) && e.includes("clave"));
    const badEx = errors.some((e) => e.includes(`{{${n}}}`) && (e.includes("ejemplo") || e.includes("#")));
    if (keyInp) keyInp.classList.toggle("invalid", badKey);
    if (exInp) exInp.classList.toggle("invalid", badEx);
  });
}

function scheduleTpValidation() {
  clearTimeout(tpState.validateTimer);
  tpState.validateTimer = setTimeout(runTpValidation, 350);
}

async function runTpValidation() {
  const payload = collectTpDraftPayload();
  if (!payload.bodyText) {
    renderTpValidation({ ok: false, errors: [], warnings: [] });
    if ($("tpCreate")) $("tpCreate").disabled = true;
    return;
  }
  const res = await post("/api/templates/validate", payload);
  renderTpValidation(res);
}

function updateTpPreview() {
  const preview = $("tpPreview");
  if (!preview) return;
  const vars = collectTpVariables().filter((v) => v.key || v.example);
  const body = $("tpBody").value;
  const header = $("tpHeader").value.trim();
  const footer = $("tpFooter").value.trim();
  const ph = tpExtractPlaceholders(body);
  const headerPh = tpExtractPlaceholders(header);
  const lines = [];
  if (header) lines.push("【Encabezado】 " + header);
  lines.push("【Cuerpo】 " + (body || "—"));
  if (footer) lines.push("【Pie】 " + footer);
  if (ph.length) {
    lines.push("");
    lines.push("Placeholders en cuerpo: " + ph.map((n) => `{{${n}}}`).join(", "));
    vars.forEach((v, i) => {
      if (v.key) lines.push(`  {{${i + 1}}} → API: ${v.key}${v.example ? ` (ej: ${v.example})` : ""}`);
    });
  }
  if (headerPh.length) lines.push("Encabezado con {{1}}.");
  preview.classList.toggle("hidden", !body.trim());
  preview.textContent = body.trim() ? lines.join("\n") : "";
  updateTpFieldCounts();
  syncTpVariablesSection();
  scheduleTpValidation();
}

function renderTpEmojiBar() {
  const bar = $("tpEmojiBar");
  if (!bar) return;
  const emojis = tpState.emojis.length ? tpState.emojis : ["👋", "✅", "📅", "💰", "🔔", "📱", "⏰", "🎉"];
  bar.innerHTML = emojis.map((e) =>
    `<button type="button" class="tp-emoji-btn" data-emoji="${escapeHtml(e)}" title="Insertar en cuerpo">${e}</button>`
  ).join("");
  bar.querySelectorAll(".tp-emoji-btn").forEach((btn) =>
    btn.addEventListener("click", () => insertTpEmoji("tpBody", btn.dataset.emoji))
  );
}

async function initTemplateModal(presetKey) {
  const meta = await api("/api/templates/create-meta");
  if (meta.ok) {
    tpState.limits = meta.limits || tpState.limits;
    tpState.emojis = meta.emojis || [];
    tpState.placeholderRules = meta.placeholderRules || [];
    if (meta.variableCatalog) state.variableCatalog = meta.variableCatalog;
  }
  renderTpMetaRules();
  if (!state.variableCatalog.length) await loadTplVariableCatalog();
  await loadTemplatePresets();
  $("tpHint").textContent = "";
  $("tpHint").className = "hint";
  const key = presetKey || "";
  if (key) {
    await loadTemplatePresetIntoModal(key);
  } else {
    if (!$("tpBody").value.trim()) {
      $("tpBody").value = "";
      renderTpVarList([]);
      $("tpVarsSection")?.classList.add("hidden");
    }
  }
  renderTpEmojiBar();
  updateTpPreview();
  await runTpValidation();
}

async function createTemplate() {
  const payload = {
    name: $("tpName").value.trim(),
    category: $("tpCategory").value,
    language: $("tpLang").value,
    ...collectTpDraftPayload(),
  };
  const hint = $("tpHint");
  if (!payload.name || !payload.bodyText) {
    hint.className = "hint error";
    hint.textContent = "Nombre y cuerpo son obligatorios.";
    return;
  }

  await runTpValidation();
  if (!tpState.validation.ok) {
    hint.className = "hint error";
    hint.textContent = (tpState.validation.errors && tpState.validation.errors[0])
      || "Corrige las reglas de variables antes de enviar a Meta.";
    return;
  }

  hint.className = "hint";
  hint.textContent = "Creando…";
  const res = await post("/api/templates", payload);
  if (res.ok) {
    closeModals();
    const keys = (res.eventVariableKeys || []).join(", ");
    toast(
      "Plantilla enviada a Meta."
      + (keys ? " Variables API: " + keys + "." : "")
      + " Espera la aprobación.",
      "ok"
    );
    await loadTemplates();
    renderTemplateList();
    await loadTemplatePresets();
  } else {
    hint.className = "hint error";
    hint.textContent = res.error || "No se pudo crear.";
  }
}

/* ---------- template parameter detection ---------- */
function tplByName(name) { return state.templates.find((t) => t.name === name); }

function bodyVarCount(t) {
  const b = (t.components || []).find((c) => c.type === "BODY");
  if (!b || !b.text) return 0;
  const m = b.text.match(/{{\s*\d+\s*}}/g);
  return m ? new Set(m.map((x) => x.replace(/[^0-9]/g, ""))).size : 0;
}
function headerSpec(t) {
  const h = (t.components || []).find((c) => c.type === "HEADER");
  if (!h) return null;
  if (h.format === "TEXT") return /{{\s*\d+\s*}}/.test(h.text || "") ? { kind: "text" } : null;
  if (["IMAGE", "VIDEO", "DOCUMENT"].includes(h.format)) return { kind: "media", format: h.format };
  return null;
}
function buttonSpecs(t) {
  const b = (t.components || []).find((c) => c.type === "BUTTONS");
  if (!b || !b.buttons) return [];
  const specs = [];
  b.buttons.forEach((btn, idx) => {
    const type = (btn.type || "").toUpperCase();
    if (type === "URL" && /{{\s*\d+\s*}}/.test(btn.url || "")) specs.push({ idx, kind: "url", text: btn.text });
    else if (type === "FLOW") specs.push({ idx, kind: "flow", text: btn.text });
    else if (type === "COPY_CODE") specs.push({ idx, kind: "copy", text: btn.text });
  });
  return specs;
}
function templateNeedsConfig(t) {
  return Boolean(headerSpec(t)) || bodyVarCount(t) > 0 || buttonSpecs(t).length > 0;
}

function renderTemplateFields(t) {
  const box = $("ncFields");
  const guideEl = $("ncVarGuide");
  if (!t) {
    box.innerHTML = "";
    renderVariableGuide(guideEl, []);
    return;
  }
  const parts = [];
  const hs = headerSpec(t);
  if (hs && hs.kind === "text") parts.push(`<label>Encabezado (variable)<input data-field="header" type="text" placeholder="Texto del encabezado" /></label>`);
  if (hs && hs.kind === "media") parts.push(`<label>${hs.format === "IMAGE" ? "Imagen" : hs.format === "VIDEO" ? "Video" : "Documento"} del encabezado (URL)<input data-field="headerMedia" type="text" placeholder="https://…" /></label>`);

  const n = bodyVarCount(t);
  for (let i = 1; i <= n; i++) parts.push(`<label>Variable del cuerpo {{${i}}}<input data-field="body${i}" type="text" placeholder="Valor para {{${i}}}" /></label>`);

  buttonSpecs(t).forEach((s) => {
    if (s.kind === "url") parts.push(`<label>URL del botón “${escapeHtml(s.text)}”<input data-field="btnurl${s.idx}" type="text" placeholder="parte dinámica de la URL" /></label>`);
    else if (s.kind === "copy") parts.push(`<label>Código del botón “${escapeHtml(s.text)}”<input data-field="btncode${s.idx}" type="text" placeholder="CUPON20" /></label>`);
    else if (s.kind === "flow") parts.push(`<label>Token del Flow “${escapeHtml(s.text)}” (opcional)<input data-field="flow${s.idx}" type="text" placeholder="unused" /></label>`);
  });

  box.innerHTML = parts.length
    ? `<div class="field-group"><div class="fg-title">Parámetros de la plantilla</div>${parts.join("")}</div>`
    : `<div class="tpl-none">Esta plantilla no requiere parámetros.</div>`;

  loadTemplateVariableGuide(t);
}

async function loadTemplateVariableGuide(t) {
  const guideEl = $("ncVarGuide");
  if (!t || !guideEl) {
    renderVariableGuide(guideEl, []);
    return;
  }
  try {
    const res = await api(`/api/templates/${encodeURIComponent(t.name)}/variables?language=${encodeURIComponent(t.language || "es")}`);
    const guide = (res && res.ok && (res.variableGuide || res.eventVariables)) || [];
    renderVariableGuide(guideEl, guide, { title: "Leyenda de variables de esta plantilla" });
    guide.forEach((v, i) => {
      const s = v.typeLabel ? v : clientVarSchema(v, i);
      const field = v.component === "header"
        ? guideEl.closest(".modal-card")?.querySelector('[data-field="header"]')
        : guideEl.closest(".modal-card")?.querySelector(`[data-field="body${(v.index != null ? v.index : i) + 1}"]`);
      if (!field) {
        const bodyIdx = guide.filter((g) => g.component !== "header").indexOf(v) + 1;
        const alt = guideEl.closest(".modal-card")?.querySelector(`[data-field="body${bodyIdx}"]`);
        if (alt) {
          alt.placeholder = s.example || alt.placeholder;
          if (s.maxLength) alt.maxLength = s.maxLength;
        }
        return;
      }
      field.placeholder = s.example || field.placeholder;
      if (s.maxLength) field.maxLength = s.maxLength;
      if (s.pattern) field.pattern = s.pattern;
    });
  } catch (_) {
    renderVariableGuide(guideEl, []);
  }
}

function collectComponents(t) {
  const box = $("ncFields");
  const val = (f) => { const el = box.querySelector(`[data-field="${f}"]`); return el ? el.value.trim() : ""; };
  const comps = [];

  const hs = headerSpec(t);
  if (hs && hs.kind === "text" && val("header")) comps.push({ type: "header", parameters: [{ type: "text", text: val("header") }] });
  if (hs && hs.kind === "media" && val("headerMedia")) {
    const k = hs.format.toLowerCase();
    comps.push({ type: "header", parameters: [{ type: k, [k]: { link: val("headerMedia") } }] });
  }

  const n = bodyVarCount(t);
  if (n > 0) {
    const params = [];
    for (let i = 1; i <= n; i++) params.push({ type: "text", text: val("body" + i) });
    comps.push({ type: "body", parameters: params });
  }

  buttonSpecs(t).forEach((s) => {
    if (s.kind === "url") comps.push({ type: "button", sub_type: "url", index: String(s.idx), parameters: [{ type: "text", text: val("btnurl" + s.idx) }] });
    else if (s.kind === "copy") comps.push({ type: "button", sub_type: "copy_code", index: String(s.idx), parameters: [{ type: "coupon_code", coupon_code: val("btncode" + s.idx) }] });
    else if (s.kind === "flow") comps.push({ type: "button", sub_type: "flow", index: String(s.idx), parameters: [{ type: "action", action: { flow_token: val("flow" + s.idx) || "unused" } }] });
  });

  return comps;
}

/* ---------- new chat (send template) ---------- */
async function openNewChat(prefillName) {
  showModal("modalNewChat");
  const sel = $("ncTemplate");
  const hint = $("ncHint");
  $("ncFields").innerHTML = "";
  renderVariableGuide($("ncVarGuide"), []);
  sel.innerHTML = `<option>Cargando…</option>`;
  if (!state.templates.length) await loadTemplates();
  const approved = state.templates.filter((t) => (t.status || "").toLowerCase() === "approved");
  if (!approved.length) {
    sel.innerHTML = `<option value="">— sin plantillas aprobadas —</option>`;
    hint.className = "hint error";
    hint.textContent = "No tienes plantillas aprobadas. Crea una en Plantillas y espera la aprobación de Meta.";
    return;
  }
  sel.innerHTML = approved
    .map((t) => {
      const bill = t.categoryInfo ? t.categoryInfo.billingLabel : String(t.category || "").toLowerCase();
      const warn = t.categoryInfo && t.categoryInfo.impactsBilling ? " ⚠" : "";
      return `<option value="${escapeHtml(t.name)}">${escapeHtml(t.name)} · ${escapeHtml(bill)}${warn}</option>`;
    })
    .join("");
  if (prefillName && approved.some((t) => t.name === prefillName)) sel.value = prefillName;
  updateNewChatCategoryHint();
  renderTemplateFields(tplByName(sel.value));
}

function updateNewChatCategoryHint() {
  const t = tplByName($("ncTemplate").value);
  const hint = $("ncHint");
  if (!t || !hint) return;
  const info = t.categoryInfo;
  if (info && info.impactsBilling && info.hint) {
    hint.className = "hint warn";
    hint.textContent = `Facturación actual: ${info.billingLabel}. ${info.hint}`;
    return;
  }
  hint.className = "hint";
  hint.textContent = info
    ? `Se facturará como ${info.billingLabel}. Configura los parámetros y envía.`
    : "Configura los parámetros y envía para abrir la conversación.";
}

async function sendNewChat() {
  const phone = $("ncPhone").value.replace(/[^0-9]/g, "");
  const name = $("ncName").value.trim();
  const tplName = $("ncTemplate").value;
  if (!phone || !tplName) { toast("Indica número y plantilla.", "error"); return; }
  const t = tplByName(tplName);
  const components = t ? collectComponents(t) : [];
  const res = await post("/api/send-template", { phone, name, template: tplName, language: t ? t.language : "es", components });
  if (res.ok) {
    closeModals();
    toast("Plantilla enviada.", "ok");
    switchScreen("chats");
    await loadConversations();
    openConversation(phone, name || phone);
  } else {
    toast("No se pudo enviar: " + (res.error || res.warning || "error"), "error");
  }
}

/* ---------- media ---------- */
async function sendMedia() {
  const phone = state.activePhone;
  if (!phone) return;
  const file = $("mdFile").files[0];
  const link = $("mdLink").value.trim();
  if (!file && !link) { toast("Selecciona un archivo o pega un enlace.", "error"); return; }

  let res;
  if (file) {
    const form = new FormData();
    form.append("phone", phone);
    form.append("mediaType", $("mdType").value);
    form.append("caption", $("mdCaption").value.trim());
    form.append("file", file, file.name);
    $("mdSend").disabled = true;
    res = await postForm("/api/send-media", form);
    $("mdSend").disabled = false;
  } else {
    res = await post("/api/send-media", {
      phone, mediaType: $("mdType").value, link, caption: $("mdCaption").value.trim(),
    });
  }

  closeModals();
  if (res.ok) toast("Enviado.", "ok");
  else toast("No se pudo enviar: " + (res.error || res.warning || "error"), "error");
  $("mdFile").value = "";
  $("mdLink").value = "";
  $("mdCaption").value = "";
  updateMediaPreview();
  await loadMessages(phone);
}

/* ---------- simulate ---------- */
async function simulate() {
  const phone = $("simPhone").value.replace(/[^0-9]/g, "");
  const text = $("simText").value.trim();
  if (!phone || !text) { toast("Número y mensaje requeridos.", "error"); return; }
  await post("/api/simulate-incoming", { phone, name: $("simName").value.trim(), text });
  closeModals();
  $("simText").value = "";
  await loadConversations();
  openConversation(phone, $("simName").value.trim() || phone);
}

/* ---------- billing ---------- */
function countryFlag(cc) {
  if (!cc || cc.length !== 2) return "";
  return String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 127397 + c.charCodeAt(0)));
}
function countryName(cc) {
  if (!cc) return "—";
  const entry = (typeof RATE_CARD !== "undefined") && RATE_CARD[String(cc).toUpperCase()];
  return entry ? entry.name : String(cc).toUpperCase();
}
function fmtCost(n) {
  const v = Number(n) || 0;
  return v === 0 ? "0" : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}
function fmtNum(n) { return (Number(n) || 0).toLocaleString("en-US"); }

function fmtBillDate(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("es", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function fmtCostCell(entry) {
  if (!entry) return "—";
  if (entry.isFree || !entry.estimatedCost) {
    return `<span class="bill-cost-free">Gratis</span>`;
  }
  return `<span class="bill-cost-paid">${fmtUsd(entry.estimatedCost)}</span>`;
}

function isFlowLedgerRow(r) {
  return r.kind === "flow" || r.kind === "flow_interactive" || r.kind === "template_flow"
    || Boolean(r.flowName || r.flowId);
}

function setBillingTab(tab) {
  state.billingTab = tab || "resumen";
  document.querySelectorAll(".billing-tab").forEach((btn) =>
    btn.classList.toggle("active", btn.dataset.billTab === state.billingTab)
  );
  document.querySelectorAll(".billing-tab-panel").forEach((panel) =>
    panel.classList.toggle("hidden", panel.dataset.billPanel !== state.billingTab)
  );
}

function openBillDetail(entry) {
  if (!entry) return;
  state.activeBillEntry = entry;
  const body = $("billDetailBody");
  if (!body) return;
  body.innerHTML = `
    <dl>
      <dt>Fecha</dt><dd>${escapeHtml(fmtBillDate(entry.sentAt))}</dd>
      <dt>Destino</dt><dd>${escapeHtml(entry.phoneFormatted || entry.phone)}${entry.recipientName ? ` · ${escapeHtml(entry.recipientName)}` : ""}</dd>
      <dt>País</dt><dd>${countryFlag(entry.country)} ${escapeHtml(entry.countryName || entry.country || "—")}</dd>
      <dt>Tipo</dt><dd>${escapeHtml(entry.kindLabel || entry.kind)}</dd>
      <dt>Categoría</dt><dd><span class="cat-tag ${escapeHtml(entry.category)}">${escapeHtml(entry.categoryLabel || categoryBillingLabel(entry.category))}</span></dd>
      <dt>Costo est.</dt><dd>${entry.isFree ? '<span class="bill-cost-free">Gratis (servicio)</span>' : fmtUsd(entry.estimatedCost || 0)}</dd>
      ${entry.templateName ? `<dt>Plantilla</dt><dd>${escapeHtml(entry.templateName)}</dd>` : ""}
      ${entry.flowName ? `<dt>Flow</dt><dd>${escapeHtml(entry.flowName)}</dd>` : ""}
      ${entry.flowMode ? `<dt>Modo</dt><dd>${escapeHtml(entry.flowMode)}</dd>` : ""}
      ${entry.preview ? `<dt>Mensaje</dt><dd>${escapeHtml(entry.preview)}</dd>` : ""}
      ${entry.billingNote ? `<dt>Nota</dt><dd class="muted sm">${escapeHtml(entry.billingNote)}</dd>` : ""}
    </dl>`;
  showModal("modalBillDetail");
}

function openConversationFromBillEntry(entry) {
  if (!entry || !entry.phone) return;
  closeModals();
  switchScreen("chats");
  openConversation(entry.phone, entry.recipientName || entry.phoneFormatted || entry.phone, entry.messageId || entry.localMessageId);
}

function renderBillingLedger(rows) {
  const tbody = $("billLedgerRows");
  if (!tbody) return;
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="muted center">Sin envíos registrados en este periodo.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map((r, i) => `<tr class="bill-row-click" data-ledger-i="${i}">
    <td>${escapeHtml(fmtBillDate(r.sentAt))}</td>
    <td>${escapeHtml(r.phoneFormatted || r.phone)}</td>
    <td>${escapeHtml(r.kindLabel || r.kind)}<div class="bill-preview">${escapeHtml(r.preview || r.templateName || r.flowName || "")}</div></td>
    <td><span class="cat-tag ${escapeHtml(r.category)}">${escapeHtml(r.categoryLabel || categoryBillingLabel(r.category))}</span></td>
    <td class="num">${fmtCostCell(r)}</td>
  </tr>`).join("");
  tbody.querySelectorAll(".bill-row-click").forEach((tr) =>
    tr.addEventListener("click", () => openBillDetail(rows[Number(tr.dataset.ledgerI)]))
  );
}

function renderBillingFlowRows(rows) {
  const flowRows = rows.filter(isFlowLedgerRow);
  const tbody = $("billFlowRows");
  if (!tbody) return;
  if (!flowRows.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="muted center">Sin envíos Flow en este periodo.</td></tr>`;
    return;
  }
  tbody.innerHTML = flowRows.map((r, i) => `<tr class="bill-row-click" data-flow-i="${i}">
    <td>${escapeHtml(fmtBillDate(r.sentAt))}</td>
    <td>${escapeHtml(r.flowName || r.templateName || "Flow")}</td>
    <td>${escapeHtml(r.flowMode || r.kindLabel || "—")}</td>
    <td><span class="cat-tag ${escapeHtml(r.category)}">${escapeHtml(r.categoryLabel || categoryBillingLabel(r.category))}</span></td>
    <td class="num">${fmtCostCell(r)}</td>
  </tr>`).join("");
  tbody.querySelectorAll(".bill-row-click").forEach((tr) =>
    tr.addEventListener("click", () => openBillDetail(flowRows[Number(tr.dataset.flowI)]))
  );
}

function buildBillMetaTipHtml(row) {
  if (!row) return "";
  const p = row.portal || {};
  const items = p.items || [];
  let portalBlock = "";
  if (p.matchCount > 0) {
    const list = items.slice(0, 8).map((it) => {
      const cost = it.isFree ? "gratis" : fmtUsd(it.estimatedCost || 0);
      const label = it.preview || it.templateName || it.flowName || it.kindLabel || "Mensaje";
      return `<li><strong>${escapeHtml(fmtBillDate(it.sentAt))}</strong> · ${escapeHtml(it.phoneFormatted || it.phone)}<br><span class="muted">${escapeHtml(label)}</span> · ${escapeHtml(cost)}</li>`;
    }).join("");
    const more = p.matchCount > items.length
      ? `<li class="muted">+ ${p.matchCount - items.length} más en «Nuestros envíos»</li>`
      : (p.matchCount > 8 ? `<li class="muted">+ ${p.matchCount - 8} más…</li>` : "");
    portalBlock = `<p><strong>En Punto Pago (${p.matchCount} envío${p.matchCount === 1 ? "" : "s"}):</strong></p><ul>${list}${more}</ul>`
      + (p.estimatedCost ? `<p>Estimado portal: <strong>${fmtUsd(p.estimatedCost)}</strong> (${p.freeCount || 0} gratis)</p>` : "");
  } else {
    portalBlock = `<p class="muted">Sin envíos registrados en el portal para esta fila. Pueden ser mensajes entrantes, webhooks o envíos anteriores al registro local.</p>`;
  }
  const zeroNote = row.costZeroReason
    ? `<p>${escapeHtml(row.costZeroReason)}</p>`
    : "";
  return `
    <div class="bill-tip-source">Fuente: ${escapeHtml(row.sourceLabel || "Meta")} · datos agregados (no lista mensaje por mensaje)</div>
    <p><strong>${escapeHtml(countryName(row.country))}</strong> · ${escapeHtml(categoryBillingLabel(row.category))}</p>
    <p>Meta reporta <strong>${fmtNum(row.volume)}</strong> mensaje(s) entregado(s) · costo <strong>${fmtCost(row.cost)}</strong></p>
    ${zeroNote}
    ${portalBlock}
    <p class="bill-tip-hint">Clic en la fila abre el primer envío del portal (si hay). Pestaña «Nuestros envíos» lista todos.</p>`;
}

function positionBillMetaTip(evt) {
  const tip = $("billMetaTip");
  if (!tip || tip.classList.contains("hidden")) return;
  const pad = 14;
  const rect = tip.getBoundingClientRect();
  let x = evt.clientX + pad;
  let y = evt.clientY + pad;
  if (x + rect.width > window.innerWidth - 8) x = evt.clientX - rect.width - pad;
  if (y + rect.height > window.innerHeight - 8) y = evt.clientY - rect.height - pad;
  tip.style.left = `${Math.max(8, x)}px`;
  tip.style.top = `${Math.max(8, y)}px`;
}

function showBillMetaTip(row, evt) {
  const tip = $("billMetaTip");
  if (!tip || !row) return;
  tip.innerHTML = buildBillMetaTipHtml(row);
  tip.classList.remove("hidden");
  tip.setAttribute("aria-hidden", "false");
  positionBillMetaTip(evt);
}

function hideBillMetaTip() {
  const tip = $("billMetaTip");
  if (!tip) return;
  tip.classList.add("hidden");
  tip.setAttribute("aria-hidden", "true");
}

function bindBillMetaRowTips(rows) {
  const tbody = $("billRows");
  if (!tbody) return;
  tbody.querySelectorAll(".bill-meta-row").forEach((tr) => {
    const idx = Number(tr.dataset.metaI);
    const row = rows[idx];
    tr.addEventListener("mouseenter", (e) => showBillMetaTip(row, e));
    tr.addEventListener("mousemove", (e) => positionBillMetaTip(e));
    tr.addEventListener("mouseleave", hideBillMetaTip);
    tr.addEventListener("click", () => {
      if (row && row.portal && row.portal.items && row.portal.items.length) {
        hideBillMetaTip();
        openBillDetail(row.portal.items[0]);
      }
    });
  });
  const wrap = $("billMetaTableWrap");
  if (wrap) wrap.addEventListener("mouseleave", hideBillMetaTip);
}

async function loadBilling() {
  const days = $("billRange").value;
  const tbody = $("billRows");
  if ($("billSyncHint")) $("billSyncHint").textContent = "Sincronizando…";
  tbody.innerHTML = `<tr><td colspan="4" class="muted center">Sincronizando…</td></tr>`;
  let res;
  try { res = await api(`/api/billing?days=${days}`); } catch (_) { res = { ok: false, error: "Error de red" }; }

  const note = $("billNote");
  const resetIds = [
    "bcCost", "bcVolume", "bcMkt", "bcUtil", "bcAuth", "bcPortalEst",
    "bcLedgerCount", "bcLedgerCost", "bcLedgerFree", "bcLedgerBillable",
    "bcFlowSends", "bcFlowBillable", "bcFlowFree", "bcFlowCost", "bcFlowResponses", "bcFlowEndpoint",
  ];
  if (!res.ok) {
    tbody.innerHTML = `<tr><td colspan="4" class="muted center">No se pudo cargar.</td></tr>`;
    note.textContent = res.error || "";
    resetIds.forEach((id) => { if ($(id)) $(id).textContent = "—"; });
    $("billTplAlert").classList.add("hidden");
    if ($("billFlowNote")) $("billFlowNote").textContent = "";
    if ($("billLedgerRows")) $("billLedgerRows").innerHTML = `<tr><td colspan="5" class="muted center">—</td></tr>`;
    if ($("billFlowRows")) $("billFlowRows").innerHTML = `<tr><td colspan="5" class="muted center">—</td></tr>`;
    return;
  }

  const t = res.totals || { byCategory: {} };
  const byCat = t.byCategory || {};
  $("bcCost").textContent = fmtCost(t.cost);
  $("bcVolume").textContent = fmtNum(t.volume);
  $("bcMkt").textContent = fmtCost(byCat.MARKETING || 0);
  $("bcUtil").textContent = fmtCost(byCat.UTILITY || 0);
  $("bcAuth").textContent = fmtCost((byCat.AUTHENTICATION || 0) + (byCat.AUTHENTICATION_INTERNATIONAL || 0));

  const ledger = res.ledger || {};
  const ledgerRows = ledger.rows || [];
  const ls = ledger.summary || {};
  state.billingLedger = ledgerRows;
  if ($("bcPortalEst")) $("bcPortalEst").textContent = fmtUsd(ls.estimatedCost || 0);
  if ($("bcLedgerCount")) $("bcLedgerCount").textContent = fmtNum(ls.count || 0);
  if ($("bcLedgerCost")) $("bcLedgerCost").textContent = fmtUsd(ls.estimatedCost || 0);
  if ($("bcLedgerFree")) $("bcLedgerFree").textContent = fmtNum(ls.freeCount || 0);
  if ($("bcLedgerBillable")) $("bcLedgerBillable").textContent = fmtNum(ls.billableCount || 0);
  renderBillingLedger(ledgerRows);

  const fs = res.flowStats || {};
  const fl = ls.flow || {};
  if ($("bcFlowSends")) $("bcFlowSends").textContent = fmtNum(fl.sends || fs.sends || 0);
  if ($("bcFlowBillable")) $("bcFlowBillable").textContent = fmtNum(fl.billableSends || 0);
  if ($("bcFlowFree")) $("bcFlowFree").textContent = fmtNum(fl.freeSends || 0);
  if ($("bcFlowCost")) $("bcFlowCost").textContent = fmtUsd(fl.estimatedCost || 0);
  if ($("bcFlowResponses")) $("bcFlowResponses").textContent = fmtNum(fs.responses || 0);
  if ($("bcFlowEndpoint")) $("bcFlowEndpoint").textContent = fmtNum(fs.endpointCalls || 0);
  if ($("billFlowNote") && res.flowBillingNote) $("billFlowNote").textContent = res.flowBillingNote;
  renderBillingFlowRows(ledgerRows);

  const alert = $("billTplAlert");
  const ts = res.templateSummary || {};
  if (ts.pendingReclass || ts.reclassified) {
    alert.classList.remove("hidden");
    const parts = [];
    if (ts.pendingReclass) parts.push(`${ts.pendingReclass} plantilla(s) con reclasificación pendiente`);
    if (ts.reclassified) parts.push(`${ts.reclassified} con categoría distinta a la solicitada`);
    alert.innerHTML = `<strong>Plantillas:</strong> ${parts.join(" · ")}. Los costos Meta reflejan la categoría facturada; revisa Plantillas para detalle.`;
  } else {
    alert.classList.add("hidden");
    alert.innerHTML = "";
  }

  state.billingMetaRows = res.rows || [];
  hideBillMetaTip();
  if (!state.billingMetaRows.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="muted center">Sin datos Meta en este periodo.</td></tr>`;
  } else {
    tbody.innerHTML = state.billingMetaRows
      .map((r, i) => {
        const hasPortal = r.portal && r.portal.matchCount > 0;
        const tipTitle = hasPortal
          ? `${r.portal.matchCount} envío(s) del portal en esta fila`
          : "Pasa el mouse para ver el detalle";
        return `<tr class="bill-meta-row" data-meta-i="${i}" title="${escapeHtml(tipTitle)}">
        <td><span class="country-cell"><span class="flag">${countryFlag(r.country)}</span>${escapeHtml(countryName(r.country))}</span></td>
        <td><span class="cat-tag ${escapeHtml(r.category)}">${escapeHtml(categoryBillingLabel(r.category))}</span></td>
        <td class="num bill-tip-cell">${fmtNum(r.volume)}${hasPortal ? `<span class="muted sm"> · ${r.portal.matchCount} local</span>` : ""}</td>
        <td class="num bill-tip-cell">${fmtCost(r.cost)}</td>
      </tr>`;
      })
      .join("");
    bindBillMetaRowTips(state.billingMetaRows);
  }
  note.innerHTML = `Pasa el mouse sobre una fila para ver de dónde salen los números. Meta entrega totales agregados; el portal cruza con envíos registrados. Costo <strong>0</strong> en Servicio = gratis (ventana 24 h).`;
  state.billingLastSync = Date.now();
  state.billingRangeDirty = false;
  updateBillSyncHint();
  setBillingTab(state.billingTab);
}

function updateBillSyncHint() {
  const hint = $("billSyncHint");
  if (!hint) return;
  if (state.billingRangeDirty) {
    hint.textContent = "Cambiaste el periodo · pulsa Actualizar";
    return;
  }
  if (!state.billingLastSync) {
    hint.textContent = "Se sincroniza al abrir esta pantalla";
    return;
  }
  const when = new Date(state.billingLastSync).toLocaleString("es", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
  hint.textContent = `Actualizado ${when}`;
}

function categoryBillingLabel(cat) {
  const key = String(cat || "").toUpperCase();
  const map = {
    MARKETING: "Marketing",
    UTILITY: "Utilidad",
    AUTHENTICATION: "Autenticación",
    AUTHENTICATION_INTERNATIONAL: "Autenticación intl.",
    SERVICE: "Servicio",
  };
  return map[key] || key.toLowerCase();
}

/* ---------- price reference (Meta rate card, Apr 2026, USD) ---------- */
const RATE_CARD = {
  PA: { name: "Panamá", marketing: 0.074, utility: 0.0113, auth: 0.0113 },
  CO: { name: "Colombia", marketing: 0.0125, utility: 0.0008, auth: 0.0008 },
  MX: { name: "México", marketing: 0.0305, utility: 0.0085, auth: 0.0085 },
  US: { name: "Estados Unidos", marketing: 0.025, utility: 0.0034, auth: 0.0034 },
  CA: { name: "Canadá", marketing: 0.025, utility: 0.0034, auth: 0.0034 },
  AR: { name: "Argentina", marketing: 0.0618, utility: 0.026, auth: 0.026 },
  BR: { name: "Brasil", marketing: 0.0625, utility: 0.0068, auth: 0.0068 },
  CL: { name: "Chile", marketing: 0.0889, utility: 0.02, auth: 0.02 },
  PE: { name: "Perú", marketing: 0.0703, utility: 0.02, auth: 0.02 },
  EC: { name: "Ecuador", marketing: 0.074, utility: 0.0113, auth: 0.0113 },
  CR: { name: "Costa Rica", marketing: 0.074, utility: 0.0113, auth: 0.0113 },
  DO: { name: "Rep. Dominicana", marketing: 0.074, utility: 0.0113, auth: 0.0113 },
  GT: { name: "Guatemala", marketing: 0.074, utility: 0.0113, auth: 0.0113 },
  SV: { name: "El Salvador", marketing: 0.074, utility: 0.0113, auth: 0.0113 },
  HN: { name: "Honduras", marketing: 0.074, utility: 0.0113, auth: 0.0113 },
  NI: { name: "Nicaragua", marketing: 0.074, utility: 0.0113, auth: 0.0113 },
  BO: { name: "Bolivia", marketing: 0.074, utility: 0.0113, auth: 0.0113 },
  PY: { name: "Paraguay", marketing: 0.074, utility: 0.0113, auth: 0.0113 },
  UY: { name: "Uruguay", marketing: 0.074, utility: 0.0113, auth: 0.0113 },
  VE: { name: "Venezuela", marketing: 0.074, utility: 0.0113, auth: 0.0113 },
  PR: { name: "Puerto Rico", marketing: 0.074, utility: 0.0113, auth: 0.0113 },
  ES: { name: "España", marketing: 0.0615, utility: 0.02, auth: 0.02 },
  OTHER: { name: "Otro (resto del mundo)", marketing: 0.0604, utility: 0.0077, auth: 0.0077 },
};
const priceQty = { marketing: 1000, utility: 1000, auth: 0, service: 0 };

function fmtUsd(n) { return "$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 }); }

function initPriceCountry() {
  const sel = $("priceCountry");
  if (sel.options.length) return;
  sel.innerHTML = Object.entries(RATE_CARD)
    .map(([code, v]) => `<option value="${code}">${escapeHtml(v.name)}</option>`)
    .join("");
  sel.value = "PA";
  sel.addEventListener("change", renderPrices);
}

function renderPrices() {
  initPriceCountry();
  const r = RATE_CARD[$("priceCountry").value] || RATE_CARD.OTHER;
  const cats = [
    { key: "marketing", label: "Marketing", rate: r.marketing },
    { key: "utility", label: "Utility (utilidad)", rate: r.utility },
    { key: "auth", label: "Authentication", rate: r.auth },
    { key: "service", label: "Service (servicio)", rate: 0 },
  ];
  $("priceRows").innerHTML = cats
    .map((c) => `<tr>
      <td><span class="cat-tag ${c.key === "auth" ? "AUTHENTICATION" : c.key.toUpperCase()}">${escapeHtml(c.label)}</span></td>
      <td class="num">${c.key === "service" ? '<span class="price-free">Gratis</span>' : fmtUsd(c.rate)}</td>
      <td class="num"><input class="qty-input" type="number" min="0" data-cat="${c.key}" value="${priceQty[c.key] || 0}" /></td>
      <td class="num" data-sub="${c.key}">${fmtUsd((priceQty[c.key] || 0) * c.rate)}</td>
    </tr>`)
    .join("");

  $("priceRows").querySelectorAll(".qty-input").forEach((inp) =>
    inp.addEventListener("input", () => {
      priceQty[inp.dataset.cat] = Math.max(0, parseInt(inp.value, 10) || 0);
      recomputePrices();
    })
  );
  recomputePrices();
}

function recomputePrices() {
  const r = RATE_CARD[$("priceCountry").value] || RATE_CARD.OTHER;
  const rates = { marketing: r.marketing, utility: r.utility, auth: r.auth, service: 0 };
  let total = 0;
  Object.keys(rates).forEach((k) => {
    const sub = (priceQty[k] || 0) * rates[k];
    total += sub;
    const cell = $("priceRows").querySelector(`[data-sub="${k}"]`);
    if (cell) cell.textContent = fmtUsd(sub);
  });
  $("priceTotal").textContent = fmtUsd(total);
}

/* ---------- bulk campaigns ---------- */
const BULK_STATUS_LABELS = {
  draft: "Borrador",
  running: "Enviando",
  paused: "Pausada",
  completed: "Completada",
  failed: "Fallida",
};
const ROW_STATUS_LABELS = {
  awaiting_vars: "Sin variables",
  ready: "Listo",
  pending: "Pendiente",
  sent: "Enviado",
  delivered: "Entregado",
  read: "Leído",
  failed: "Error",
  skipped: "Omitido",
};

async function loadLineHealth() {
  const res = await api("/api/line-health");
  state.lineHealth = res.ok ? res.line : null;
  renderLineHealth();
  return state.lineHealth;
}

function renderLineHealth() {
  const box = $("lineHealthCards");
  const l = state.lineHealth;
  if (!l) {
    box.innerHTML = `<div class="lh-card"><span class="lh-label">Línea WhatsApp</span><span class="lh-value">—</span><span class="lh-sub">Configura ACCESS_TOKEN y PHONE_NUMBER_ID.</span></div>`;
    return;
  }
  const qClass = l.qualityColor || "muted";
  box.innerHTML = `
    <div class="lh-card"><span class="lh-label">Número</span><span class="lh-value" style="font-size:15px">${escapeHtml(l.displayPhone || "—")}</span><span class="lh-sub">${escapeHtml(l.verifiedName || "")}</span></div>
    <div class="lh-card ${qClass}"><span class="lh-label">Integridad (Meta)</span><span class="lh-value">${escapeHtml(l.qualityLabel)}</span><span class="lh-sub">${escapeHtml(l.qualityHint || "")}</span></div>
    <div class="lh-card"><span class="lh-label">Límite diario</span><span class="lh-value">${escapeHtml(l.dailyUniqueLimitLabel)}</span><span class="lh-sub">Usuarios únicos / 24h · ${escapeHtml(l.messagingTier || "")}</span></div>
    <div class="lh-card"><span class="lh-label">Estado de envío</span><span class="lh-value" style="font-size:15px">${l.canSendMessage ? "Disponible" : "Restringido"}</span><span class="lh-sub">${l.canSendMessage ? "La línea puede enviar plantillas." : "Meta restringió envíos temporales."}</span></div>`;
}

function fillBulkTemplates() {
  const sel = $("bulkTemplate");
  const approved = state.templates.filter((t) => (t.status || "").toLowerCase() === "approved");
  if (!approved.length) {
    sel.innerHTML = `<option value="">— sin plantillas aprobadas —</option>`;
    return;
  }
  sel.innerHTML = approved
    .map((t) => `<option value="${escapeHtml(t.name)}" data-lang="${escapeHtml(t.language)}">${escapeHtml(t.name)} · ${escapeHtml(t.language)}</option>`)
    .join("");
  if (!sel.dataset.bound) {
    sel.dataset.bound = "1";
    sel.addEventListener("change", loadBulkTemplateVars);
  }
  loadBulkTemplateVars();
}

async function loadBulkTemplateVars() {
  const box = $("bulkEventVars");
  const tpl = selectedBulkTemplate();
  if (!tpl.name) { box.classList.add("hidden"); return; }
  const res = await api(`/api/templates/${encodeURIComponent(tpl.name)}/variables?language=${encodeURIComponent(tpl.language)}`);
  if (!res.ok || !res.eventVariables || !res.eventVariables.length) {
    box.innerHTML = `<span class="muted">Esta plantilla no requiere eventos variables.</span>`;
    box.classList.remove("hidden");
    return;
  }
  box.innerHTML = `<strong>Eventos variables de la plantilla</strong><ul>${res.eventVariables
    .map((ev) => `<li><code>${escapeHtml(ev.key)}</code> — ${escapeHtml(ev.label)} (${escapeHtml(ev.placeholder)})</li>`)
    .join("")}</ul><p class="muted" style="margin:8px 0 0">En CSV: columnas extra. Por API: ver guía en <strong>Integración API</strong>.</p>`;
  box.classList.remove("hidden");
}

async function loadCampaigns() {
  const res = await api("/api/campaigns");
  state.campaigns = (res && res.data) || [];
  renderCampaignList();
}

function renderCampaignList() {
  const box = $("bulkCampaignList");
  $("bulkListHint").textContent = state.campaigns.length ? `(${state.campaigns.length})` : "";
  if (!state.campaigns.length) {
    box.innerHTML = `<p class="muted">Aún no hay cargas. Crea una con CSV.</p>`;
    return;
  }
  box.innerHTML = state.campaigns
    .map((c) => {
      const t = c.totals || {};
      const active = c.id === state.activeCampaignId ? " active" : "";
      const pct = c.progress ? c.progress.percent : 0;
      const src = c.source === "api" ? "API" : "CSV";
      return `<div class="bulk-camp-item${active}" data-id="${escapeHtml(c.id)}">
        <strong>${escapeHtml(c.name)}</strong>
        <div class="muted" style="font-size:11px;margin-top:4px">
          ${escapeHtml(c.template)} · ${src} · ${escapeHtml(BULK_STATUS_LABELS[c.status] || c.status)}
          · ${pct}% · ${t.delivered || 0}/${t.total || 0} entregados
        </div>
      </div>`;
    })
    .join("");
  box.querySelectorAll(".bulk-camp-item").forEach((el) =>
    el.addEventListener("click", () => openCampaignDetail(el.dataset.id))
  );
}

function selectedBulkTemplate() {
  const sel = $("bulkTemplate");
  const opt = sel.options[sel.selectedIndex];
  return { name: sel.value, language: opt ? opt.dataset.lang : "es" };
}

async function readBulkCsvFile() {
  const file = $("bulkCsv").files[0];
  if (!file) return null;
  return file.text();
}

async function previewBulkCsv() {
  const csvText = await readBulkCsvFile();
  const box = $("bulkPreview");
  const tpl = selectedBulkTemplate();
  if (!csvText) { box.className = "bulk-preview error"; box.textContent = "Selecciona un archivo CSV."; box.classList.remove("hidden"); return; }
  if (!tpl.name) { box.className = "bulk-preview error"; box.textContent = "Selecciona una plantilla."; box.classList.remove("hidden"); return; }

  const fd = new FormData();
  fd.append("file", $("bulkCsv").files[0]);
  fd.append("template", tpl.name);
  fd.append("language", tpl.language);
  const res = await api("/api/campaigns/preview", { method: "POST", body: fd });

  box.classList.remove("hidden");
  if (!res.ok) {
    box.className = "bulk-preview error";
    box.textContent = res.error || (res.errors && res.errors.join(" ")) || "No se pudo validar.";
    return;
  }
  const evKeys = (res.eventVariables || []).map((e) => e.key).join(", ");
  let msg = `${res.rowCount} contacto(s) válidos. Eventos: ${evKeys || (res.varColumns || []).join(", ") || "ninguno"}.`;
  if (res.overDailyLimit && res.line) {
    msg += ` Atención: supera el límite diario de Meta (${res.line.dailyUniqueLimitLabel} únicos/24h).`;
  }
  if (res.errors && res.errors.length) msg += ` Avisos: ${res.errors.slice(0, 3).join(" ")}`;
  box.className = "bulk-preview ok";
  box.textContent = msg;
}

async function createBulkCampaign() {
  const csvText = await readBulkCsvFile();
  const tpl = selectedBulkTemplate();
  if (!csvText || !tpl.name) { toast("CSV y plantilla requeridos.", "error"); return; }

  const fd = new FormData();
  fd.append("file", $("bulkCsv").files[0]);
  fd.append("name", $("bulkName").value.trim() || `Carga ${tpl.name}`);
  fd.append("template", tpl.name);
  fd.append("language", tpl.language);
  const res = await api("/api/campaigns", { method: "POST", body: fd });
  if (!res.ok) { toast(res.error || "No se pudo crear la carga.", "error"); return; }
  toast("Carga creada.", "ok");
  await loadCampaigns();
  openCampaignDetail(res.campaign.id);
}

function downloadBulkSampleCsv() {
  const sample = "telefono,nombre,var1,var2\n50761234567,Juan,100.00,15 mar\n50769876543,Ana,250.00,20 mar\n";
  const blob = new Blob([sample], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "ejemplo_carga_whatsapp.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

async function openCampaignDetail(id) {
  state.activeCampaignId = id;
  $("bulkDetail").classList.remove("hidden");
  $("bulkExportBtn").href = `/api/campaigns/${encodeURIComponent(id)}/export`;
  renderCampaignList();
  await refreshCampaignDetail();
  startBulkPolling();
}

function closeCampaignDetail() {
  state.activeCampaignId = null;
  $("bulkDetail").classList.add("hidden");
  stopBulkPolling();
  renderCampaignList();
}

async function refreshCampaignDetail() {
  const id = state.activeCampaignId;
  if (!id) return;
  let metaRes = await api(`/api/campaigns/${encodeURIComponent(id)}`);
  if (!metaRes.ok) return;
  if (metaRes.campaign.status === "running") {
    await api(`/api/campaigns/${encodeURIComponent(id)}/tick`, { method: "POST" });
    metaRes = await api(`/api/campaigns/${encodeURIComponent(id)}`);
    if (!metaRes.ok) return;
  }
  const rowsRes = await api(`/api/campaigns/${encodeURIComponent(id)}/rows?offset=0&limit=200`);
  const c = metaRes.campaign;
  const t = c.totals || {};
  const prog = c.progress || {};
  const cost = c.costEstimate || {};
  $("bulkDetailTitle").textContent = c.name;
  const srcLabel = c.source === "api" ? "Integración API" : "CSV";
  $("bulkDetailMeta").textContent = `${c.template} · ${c.language} · ${srcLabel} · ${BULK_STATUS_LABELS[c.status] || c.status}${c.pauseReason ? " · " + c.pauseReason : ""}`;

  const progBox = $("bulkProgress");
  progBox.classList.remove("hidden");
  progBox.innerHTML = `
    <div style="display:flex;justify-content:space-between;font-size:12px;gap:12px;flex-wrap:wrap">
      <span><strong>Envío:</strong> ${prog.done || 0} / ${prog.total || 0} (${prog.percent || 0}%)</span>
      <span><strong>Variables:</strong> ${prog.varsReady || 0} / ${prog.total || 0} (${prog.varsPercent || 0}%)</span>
    </div>
    <div class="bulk-progress-bar"><div class="bulk-progress-fill" style="width:${prog.percent || 0}%"></div></div>
    <div class="bulk-progress-bar" style="margin-top:6px"><div class="bulk-progress-fill vars" style="width:${prog.varsPercent || 0}%"></div></div>`;

  const costBox = $("bulkCost");
  if (cost.estimatedTotalUsd != null) {
    costBox.classList.remove("hidden");
    costBox.innerHTML = `<strong>Costo estimado:</strong> ~$${cost.estimatedTotalUsd} USD (${cost.billableEstimate || 0} msgs × $${cost.ratePerMessageUsd} · ${escapeHtml(cost.category || "UTILITY")}). ${escapeHtml(cost.note || "")}`;
  } else costBox.classList.add("hidden");

  $("bulkStats").innerHTML = [
    ["total", "Total"],
    ["awaiting_vars", "Sin vars"],
    ["ready", "Listos"],
    ["pending", "Pendientes"],
    ["sent", "Enviados"],
    ["delivered", "Entregados"],
    ["read", "Leídos"],
    ["failed", "Errores"],
  ].map(([k, label]) => `<div class="bulk-stat"><span class="n">${t[k] || 0}</span><span class="l">${label}</span></div>`).join("");

  const schemaBox = $("bulkEventSchema");
  if (c.eventVariables && c.eventVariables.length) {
    schemaBox.classList.remove("hidden");
    schemaBox.innerHTML = `<strong>Esquema de eventos variables</strong>: ${c.eventVariables
      .map((ev) => `<code>${escapeHtml(ev.key)}</code>`)
      .join(", ")}`;
  } else schemaBox.classList.add("hidden");

  const rows = (rowsRes && rowsRes.rows) || [];
  $("bulkRowsBody").innerHTML = rows.map((r) => `<tr>
    <td>+${escapeHtml(r.phone)}</td>
    <td class="muted">${escapeHtml(r.externalId || "—")}</td>
    <td>${escapeHtml(r.name || "—")}</td>
    <td><span class="st-${escapeHtml(r.status)}">${escapeHtml(ROW_STATUS_LABELS[r.status] || r.status)}</span></td>
    <td class="muted">${escapeHtml(r.error || "")}</td>
    <td>${r.sentAt ? escapeHtml(new Date(r.sentAt).toLocaleString("es", { dateStyle: "short", timeStyle: "short" })) : "—"}</td>
  </tr>`).join("");

  if (c.status !== "running") stopBulkPolling();
}

async function startBulkCampaign() {
  const id = state.activeCampaignId;
  if (!id) return;
  const res = await api(`/api/campaigns/${encodeURIComponent(id)}/start`, { method: "POST" });
  if (!res.ok) { toast(res.error || "No se pudo iniciar.", "error"); return; }
  toast("Carga iniciada.", "ok");
  startBulkPolling();
  await refreshCampaignDetail();
  await loadCampaigns();
}

async function pauseBulkCampaign() {
  const id = state.activeCampaignId;
  if (!id) return;
  await api(`/api/campaigns/${encodeURIComponent(id)}/pause`, { method: "POST" });
  stopBulkPolling();
  await refreshCampaignDetail();
  await loadCampaigns();
}

function startBulkPolling() {
  stopBulkPolling();
  state.bulkPollTimer = setInterval(() => {
    if (state.activeCampaignId) refreshCampaignDetail();
  }, 4000);
}
function stopBulkPolling() {
  if (state.bulkPollTimer) clearInterval(state.bulkPollTimer);
  state.bulkPollTimer = null;
}

async function initBulkScreen() {
  await Promise.all([loadLineHealth(), loadTemplates(), loadCampaigns()]);
  fillBulkTemplates();
}

async function initIntegrationScreen() {
  await loadTemplates();
  if (window.IntegrationApiModule) {
    window.IntegrationApiModule.setTemplates(state.templates);
  }
}

/* ---------- workspace hub ---------- */
function toggleWorkspaceFlyout(force) {
  const fly = $("workspaceFlyout");
  if (!fly) return;
  const open = force != null ? force : fly.classList.contains("hidden");
  fly.classList.toggle("hidden", !open);
  ["workspaceHubBtn", "mobileWsBtn"].forEach((id) => {
    const btn = $(id);
    if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
  });
}

function openWorkspaceTab(tab) {
  state.workspaceTab = tab;
  toggleWorkspaceFlyout(false);
  switchScreen("workspace");
  setWorkspaceTab(tab);
}

function setWorkspaceTab(tab) {
  state.workspaceTab = tab;
  document.querySelectorAll(".ws-tab").forEach((b) => {
    b.classList.toggle("active", b.dataset.wsTab === tab);
  });
  ["profile", "workspace", "reports", "language"].forEach((id) => {
    const panel = $("wsPanel" + id.charAt(0).toUpperCase() + id.slice(1));
    if (panel) panel.classList.toggle("hidden", id !== tab);
  });
  const titles = {
    profile: "Perfil WhatsApp",
    workspace: "Espacio de trabajo",
    reports: "Informes",
    language: "Idioma del portal",
  };
  if ($("wsPageTitle")) $("wsPageTitle").textContent = titles[tab] || "Espacio de trabajo";
}

async function loadWorkspace() {
  const res = await api("/api/workspace");
  if (!res.ok) return;
  state.workspace = res;
  fillWorkspaceForms(res);
  updateWorkspaceHubPreview(
    res.workspace.displayName || res.workspace.workspaceName,
    res.workspace.hasProfilePhoto
  );
}

function fillWorkspaceForms(res) {
  const w = res.workspace || {};
  const wa = res.whatsapp || {};
  if ($("wsAbout")) $("wsAbout").value = w.about || wa.about || "";
  if ($("wsDescription")) $("wsDescription").value = w.description || wa.description || "";
  if ($("wsEmail")) $("wsEmail").value = w.email || wa.email || "";
  if ($("wsWebsite")) $("wsWebsite").value = (w.websites && w.websites[0]) || (wa.websites && wa.websites[0]) || "";
  if ($("wsWorkspaceName")) $("wsWorkspaceName").value = w.workspaceName || "";
  if ($("wsDisplayName")) $("wsDisplayName").value = w.displayName || "";
  if ($("wsPortalPhoto")) $("wsPortalPhoto").src = w.avatarUrl ? avatarSrc(true) : "/logo.png";
  if ($("wsWaPhoto")) {
    if (wa.profile_picture_url) {
      $("wsWaPhoto").src = wa.profile_picture_url;
      if ($("wsWaPhotoHint")) $("wsWaPhotoHint").textContent = "Foto actual sincronizada desde Meta.";
    } else if (wa.error) {
      if ($("wsWaPhotoHint")) $("wsWaPhotoHint").textContent = wa.error;
    }
  }
  const status = $("wsSystemStatus");
  if (status) {
    const line = res.line;
    status.innerHTML = [
      `<li>Persistencia: ${state.config.persistent ? "Redis activo" : "Memoria local"}</li>`,
      `<li>WhatsApp API: ${state.config.hasCredentials ? "Conectada" : "Sin credenciales"}</li>`,
      line ? `<li>Línea: ${escapeHtml(line.displayPhone || "—")} · ${escapeHtml(line.qualityLabel || "")}</li>` : "",
      `<li>Última actualización: ${w.updatedAt ? new Date(w.updatedAt).toLocaleString("es") : "—"}</li>`,
    ].filter(Boolean).join("");
  }
}

async function saveWorkspaceProfile() {
  const body = {
    about: $("wsAbout").value.trim(),
    description: $("wsDescription").value.trim(),
    email: $("wsEmail").value.trim(),
    websites: $("wsWebsite").value.trim() ? [$("wsWebsite").value.trim()] : [],
    syncWhatsapp: $("wsSyncWhatsapp").checked,
  };
  const res = await patch("/api/workspace", body);
  if (!res.ok) { toast(res.error || "No se pudo guardar.", "error"); return; }
  if (res.whatsappSync && !res.whatsappSync.ok) {
    toast("Guardado localmente. Meta: " + (res.whatsappSync.error || "no sincronizó"), "error");
  } else {
    toast("Perfil guardado.", "ok");
  }
  await loadWorkspace();
  state.config = await api("/api/config");
  applyBranding();
}

async function saveWorkspaceSettings() {
  const res = await patch("/api/workspace", {
    workspaceName: $("wsWorkspaceName").value.trim(),
    displayName: $("wsDisplayName").value.trim(),
  });
  if (!res.ok) { toast(res.error || "No se pudo guardar.", "error"); return; }
  toast("Espacio actualizado.", "ok");
  state.config = await api("/api/config");
  applyBranding();
  await loadWorkspace();
}

async function uploadWorkspacePhoto(file) {
  if (!file) return;
  const fd = new FormData();
  fd.append("photo", file);
  const res = await postForm("/api/workspace/profile-photo", fd);
  if (!res.ok) { toast(res.error || "No se pudo subir la imagen.", "error"); return; }
  toast("Foto del portal actualizada.", "ok");
  state.config = await api("/api/config");
  applyBranding();
  await loadWorkspace();
}

async function removeWorkspacePhoto() {
  const res = await api("/api/workspace/profile-photo", { method: "DELETE" });
  if (!res.ok) { toast(res.error || "No se pudo quitar.", "error"); return; }
  toast("Foto quitada.", "ok");
  state.config = await api("/api/config");
  applyBranding();
  await loadWorkspace();
}

async function loadWorkspaceReports() {
  const box = $("wsReportsGrid");
  if (box) box.textContent = "Cargando informes…";
  const res = await api("/api/reports/summary");
  if (!res.ok || !box) return;
  const s = res.summary;
  const cards = [
    [s.conversations.total, "Conversaciones"],
    [s.conversations.active24h, "Activas 24h"],
    [s.messages.inbound, "Msjs entrantes"],
    [s.messages.outbound, "Msjs salientes"],
    [s.campaigns.total, "Cargas masivas"],
    [s.campaigns.delivered, "Entregados (cargas)"],
    [s.templates.approved, "Plantillas aprobadas"],
    [s.templates.pending, "Plantillas en revisión"],
  ];
  box.className = "ws-reports-grid";
  box.innerHTML = cards.map(([n, l]) =>
    `<div class="ws-report-card"><span class="n">${n}</span><span class="l">${escapeHtml(l)}</span></div>`
  ).join("");
}

async function initWorkspaceScreen() {
  setWorkspaceTab(state.workspaceTab || "profile");
  await Promise.all([loadWorkspace(), loadWorkspaceReports()]);
}

/* ---------- WhatsApp Flows ---------- */
const FLOW_STATUS_LABELS = { DRAFT: "Borrador", PUBLISHED: "Publicado", DEPRECATED: "Deprecado", BLOCKED: "Bloqueado", THROTTLED: "Limitado" };

function getPayAuthFlowData() {
  const amount = formatPreviewAmount(($("payAuthAmount") || {}).value || "45.90");
  const card4 = ($("payAuthCard4") || {}).value || "4821";
  const merchant = ($("payAuthMerchant") || {}).value || "Supermercado XO";
  const now = new Date().toLocaleString("es-PA", { dateStyle: "medium", timeStyle: "short" });
  const cardImg = state.cardImageUrl || "/assets/punto-pago-card.png";
  return {
    merchant,
    amount,
    card_label: `Tarjeta Punto Pago •••• ${card4}`,
    card_image: cardImg + (String(cardImg).includes("?") ? "&" : "?") + "t=" + Date.now(),
    when: now,
  };
}

function renderFlowPhonePreview(container, screen, data) {
  if (!container) return;
  const d = data || getPayAuthFlowData();
  const title = screen === "RESULT" ? "Resultado" : "Verificación de pago";
  let bodyHtml = "";
  let footerLabel = "Continuar";

  if (screen === "AUTH") {
    bodyHtml = `
      <p class="flow-phone-brand">Punto Pago</p>
      <h3>Confirma tu transacción</h3>
      <p class="flow-phone-security">Por tu seguridad, valida este pago antes de procesarlo. Es el mismo paso de verificación que conoces como 3D Secure.</p>
      <img class="flow-phone-img" src="${escapeHtml(d.card_image)}" alt="Tarjeta" onerror="this.src='/assets/punto-pago-card.png'" />
      <p>Comercio: ${escapeHtml(d.merchant)}</p>
      <p>Monto: ${escapeHtml(d.amount)}</p>
      <p>${escapeHtml(d.card_label)}</p>
      <p>Fecha: ${escapeHtml(d.when)}</p>
      <p class="flow-phone-caption">Si no reconoces esta compra, elige Rechazar y contáctanos de inmediato.</p>
      <p class="flow-phone-caption">Elige una opción y pulsa Continuar para enviar tu respuesta.</p>
      <div class="flow-phone-radio">
        <label class="selected"><span class="dot"></span> Aprobar transacción</label>
        <label><span class="dot"></span> Rechazar transacción</label>
      </div>`;
  } else {
    bodyHtml = `
      <p class="flow-phone-brand">Punto Pago</p>
      <h3>Pago aprobado</h3>
      <p>El comercio procesará tu pago en breve.</p>
      <p>Comercio: ${escapeHtml(d.merchant)}</p>
      <p>Monto: ${escapeHtml(d.amount)}</p>`;
    footerLabel = "Cerrar";
  }

  container.className = "flow-phone flow-phone-pp";
  container.innerHTML = `
    <div class="flow-phone-nav flow-phone-nav-pp">
      <span class="flow-phone-cancel">Cancelar</span>
      <span class="flow-phone-title">${escapeHtml(title)}</span>
      <span class="flow-phone-menu">⋯</span>
    </div>
    <div class="flow-phone-body">${bodyHtml}</div>
    <div class="flow-phone-footer"><button type="button">${escapeHtml(footerLabel)}</button></div>
    <div class="flow-phone-managed">Administrado por ${escapeHtml(brandDisplayName())}</div>`;
}

function updatePayAuthFlowPreview() {
  renderFlowPhonePreview($("payAuthFlowPreview"), state.payAuthFlowScreen, getPayAuthFlowData());
}

async function uploadPayAuthCardImage(file) {
  if (!file) return;
  const fd = new FormData();
  fd.append("image", file);
  const res = await postForm("/api/flows/payment-auth/card-image", fd);
  if (!res.ok) { toast(res.error || "No se pudo subir la imagen.", "error"); return; }
  state.cardImageUrl = res.cardImageUrl;
  toast("Imagen de tarjeta actualizada.", "ok");
  updatePayAuthFlowPreview();
}

function renderFlowStatsCards(stats, isPaymentAuth) {
  const box = $("flowsStatsCards");
  if (!box || !stats) return;
  const cards = [
    [stats.sent, "Enviados"],
    [stats.opened, "Abiertos"],
    [stats.responded, "Completados"],
    [`${stats.completionRate || 0}%`, "Tasa completado"],
  ];
  if (isPaymentAuth) {
    cards[2] = [stats.authorized, "Autorizados"];
    cards[3] = [stats.denied, "Rechazados"];
  }
  box.innerHTML = cards.map(([n, l]) =>
    `<div class="flow-stat-card"><span class="n">${escapeHtml(String(n))}</span><span class="l">${escapeHtml(l)}</span></div>`
  ).join("");
}

function setFlowsDetailTab(tab) {
  state.flowsDetailTab = tab;
  document.querySelectorAll(".flows-detail-tab").forEach((b) =>
    b.classList.toggle("active", b.dataset.detailTab === tab)
  );
  ["preview", "sends", "responses"].forEach((t) => {
    const el = $("flowsDetail" + t.charAt(0).toUpperCase() + t.slice(1));
    if (el) el.classList.toggle("hidden", t !== tab);
  });
}

function renderFlowActivityList(rows, emptyMsg) {
  if (!rows || !rows.length) return `<p class="muted sm">${escapeHtml(emptyMsg)}</p>`;
  return `<div class="flow-activity-list">${rows.map((r) => {
    if (r.sentAt) {
      return `<div class="flow-activity-row">📤 +${escapeHtml(r.phone)} · ${escapeHtml(new Date(r.sentAt).toLocaleString("es"))}${r.mode ? ` · ${escapeHtml(r.mode)}` : ""}</div>`;
    }
    if (r.receivedAt) {
      const decision = r.responseJson && (r.responseJson.decision || (r.responseJson.payload && r.responseJson.payload.decision));
      return `<div class="flow-activity-row">✅ +${escapeHtml(r.phone)} · ${escapeHtml(new Date(r.receivedAt).toLocaleString("es"))}${decision ? ` · ${escapeHtml(decision)}` : ""}</div>`;
    }
    if (r.merchant) {
      const st = r.decision ? (r.decision === "authorize" ? "autorizado" : "rechazado") : "pendiente";
      return `<div class="flow-activity-row">💳 ${escapeHtml(r.merchant)} · $${escapeHtml(r.amount)} · ${escapeHtml(st)}</div>`;
    }
    return "";
  }).join("")}</div>`;
}

function renderFlowDetailPreview(performance) {
  const box = $("flowsDetailPreview");
  if (!box) return;
  if (performance.isPaymentAuth) {
    box.innerHTML = `
      <p class="muted sm" style="margin-bottom:10px">Así ve el cliente el mensaje y el formulario.</p>
      <div class="flows-dual-preview">
        <div class="flows-preview-col"><div id="flowDetailWaPreview"></div></div>
        <div class="flows-preview-col"><div id="flowDetailFlowPreview"></div></div>
      </div>`;
    const fm = {
      headerText: "Confirma tu pago",
      footerText: "Punto Pago · Verificación de seguridad",
      flowCta: "Confirmar pago",
    };
    const ov = tplPreviewOverrides();
    renderWaMessagePreview($("flowDetailWaPreview"), {
      headerText: fm.headerText,
      bodyText:
        `Hola ${ov.nombre_cliente},\n\n`
        + `Se requiere tu confirmación para un pago de ${ov.monto} en ${ov.comercio} `
        + `con Tarjeta Punto Pago •••• ${ov.ultimos_4}.\n\n`
        + "Toca abajo para aprobar o rechazar. Protege tu cuenta como el 3D Secure de tu banco.",
      footerText: fm.footerText,
      flowCta: fm.flowCta,
    });
    renderFlowPhonePreview($("flowDetailFlowPreview"), "AUTH", getPayAuthFlowData());
  } else {
    box.innerHTML = `<p class="muted sm">Vista previa disponible para Flows de autorización de pago. Usa «Abrir en Meta» para ver otros.</p>`;
  }
}

async function loadFlowDetail(id) {
  const perfRes = await api(`/api/flows/${encodeURIComponent(id)}/performance`);
  if (!perfRes.ok) return;
  state.activeFlowPerformance = perfRes;
  const f = state.flows.find((x) => x.id === id) || perfRes.flow || {};
  $("flowsDetailName").textContent = f.name || id;
  const st = (f.status || "").toUpperCase();
  const stEl = $("flowsDetailStatus");
  if (stEl) {
    stEl.textContent = FLOW_STATUS_LABELS[st] || st || "—";
    stEl.className = "flow-status " + st;
  }
  renderFlowStatsCards(perfRes.stats, perfRes.isPaymentAuth);
  $("flowsDetailSends").innerHTML = renderFlowActivityList(perfRes.recentSends, "Aún no hay envíos registrados.");
  const respRows = perfRes.isPaymentAuth && perfRes.recentPayAuth.length
    ? perfRes.recentPayAuth
    : perfRes.recentResponses;
  $("flowsDetailResponses").innerHTML = renderFlowActivityList(
    respRows,
    "Aún no hay respuestas. Cuando alguien complete el Flow, aparecerá aquí."
  );
  renderFlowDetailPreview(perfRes);
  const probarBtn = $("flowDetailProbarBtn");
  if (probarBtn) probarBtn.classList.toggle("hidden", !perfRes.isPaymentAuth);
  setFlowsDetailTab(state.flowsDetailTab || "preview");
  $("flowsDetailPanel").classList.remove("hidden");
  $("flowsEmptyDetail").classList.add("hidden");
}

const fsState = {
  schema: null,
  viewMode: "all",
  activeIndex: 0,
  screens: [],
};

const FS_LAYOUTS = [
  { id: "message", label: "Título y texto" },
  { id: "form", label: "Formulario" },
  { id: "confirm", label: "Pantalla final" },
];

function defaultFsScreens() {
  return [
    {
      layout: "message",
      title: "Paso 1",
      heading: "Título claro",
      body: "Usa texto breve. Explica qué debe hacer la persona en esta pantalla.",
      buttonLabel: "Continuar",
      buttonAction: "next",
      fields: [],
    },
    {
      layout: "message",
      title: "Paso 2",
      heading: "Más detalle",
      body: "Puedes agregar imágenes o pasos extra en pantallas siguientes.",
      buttonLabel: "Continuar",
      buttonAction: "next",
      fields: [],
    },
    {
      layout: "confirm",
      title: "Gracias",
      heading: "¡Listo!",
      body: "Recibimos tu respuesta. Te contactaremos pronto.",
      buttonLabel: "Cerrar",
      buttonAction: "complete",
      fields: [],
    },
  ];
}

async function initFlowStudio() {
  if (!fsState.schema) {
    const res = await api("/api/flows/builder/schema");
    fsState.schema = (res && res.schema) || { fieldTypes: [], categories: [], limits: { maxScreens: 8 } };
    const catSel = $("fsCategory");
    if (catSel) {
      catSel.innerHTML = (fsState.schema.categories || [])
        .map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.label)}</option>`)
        .join("");
    }
  }
  if (!fsState.screens.length) fsState.screens = defaultFsScreens();
  fsState.activeIndex = 0;
  fsState.viewMode = "all";
  if ($("fsName") && !$("fsName").value) $("fsName").value = "";
  if ($("fsChatBody") && !$("fsChatBody").value.trim()) {
    $("fsChatBody").value = "Hola, completa este formulario para continuar.";
  }
  renderFlowStudio();
}

function fsActiveScreen() {
  return fsState.screens[fsState.activeIndex] || fsState.screens[0];
}

function syncFsFromSidebar() {
  const scr = fsActiveScreen();
  if (!scr) return;
  if ($("fsHeading")) scr.heading = $("fsHeading").value;
  if ($("fsBody")) scr.body = $("fsBody").value;
  if ($("fsButton")) scr.buttonLabel = $("fsButton").value;
  const action = document.querySelector('input[name="fsAction"]:checked');
  if (action) scr.buttonAction = action.value;
  scr.title = scr.heading.slice(0, 40) || scr.title || `Paso ${fsState.activeIndex + 1}`;
}

function loadFsSidebarFromScreen() {
  const scr = fsActiveScreen();
  if (!scr) return;
  if ($("fsHeading")) $("fsHeading").value = scr.heading || "";
  if ($("fsBody")) $("fsBody").value = scr.body || "";
  if ($("fsButton")) $("fsButton").value = scr.buttonLabel || "Continuar";
  document.querySelectorAll('input[name="fsAction"]').forEach((r) => {
    r.checked = r.value === (scr.buttonAction || "next");
  });
  document.querySelectorAll(".fs-layout-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.layout === scr.layout)
  );
  const fieldsBox = $("fsFieldsBox");
  if (fieldsBox) fieldsBox.classList.toggle("hidden", scr.layout !== "form");
  renderFsFieldsList();
}

function renderFsLayoutGrid() {
  const box = $("fsLayoutGrid");
  if (!box) return;
  const scr = fsActiveScreen();
  box.innerHTML = FS_LAYOUTS.map((l) =>
    `<button type="button" class="fs-layout-btn${scr && scr.layout === l.id ? " active" : ""}" data-layout="${l.id}">
      <span class="fs-layout-icon"></span>${escapeHtml(l.label)}
    </button>`
  ).join("");
  box.querySelectorAll(".fs-layout-btn").forEach((btn) =>
    btn.addEventListener("click", () => {
      syncFsFromSidebar();
      const s = fsActiveScreen();
      if (!s) return;
      s.layout = btn.dataset.layout;
      if (s.layout === "form" && !(s.fields || []).length) {
        s.fields = [{ type: "text", label: "Nombre", required: true }];
      }
      if (s.layout === "confirm") {
        s.buttonAction = "complete";
        s.buttonLabel = s.buttonLabel || "Cerrar";
      }
      loadFsSidebarFromScreen();
      renderFlowStudio();
    })
  );
}

function fsFieldTypeOptions(selected) {
  return (fsState.schema?.fieldTypes || [
    { id: "text", label: "Texto" },
    { id: "email", label: "Correo" },
    { id: "rating", label: "1–5" },
  ]).map((t) => `<option value="${escapeHtml(t.id)}"${t.id === selected ? " selected" : ""}>${escapeHtml(t.label)}</option>`).join("");
}

function renderFsFieldsList() {
  const box = $("fsFieldsList");
  const scr = fsActiveScreen();
  if (!box || !scr || scr.layout !== "form") return;
  scr.fields = scr.fields || [];
  box.innerHTML = scr.fields.map((f, fi) => `
    <div class="fs-field-row" data-fi="${fi}">
      <input type="text" class="fs-f-label" placeholder="Etiqueta" value="${escapeHtml(f.label || "")}" />
      <select class="fs-f-type">${fsFieldTypeOptions(f.type)}</select>
      <button type="button" class="btn-ghost sm fs-f-remove">×</button>
    </div>`).join("");
  box.querySelectorAll(".fs-f-label, .fs-f-type").forEach((el) =>
    el.addEventListener("input", syncFsFieldsFromDom)
  );
  box.querySelectorAll(".fs-f-type").forEach((el) =>
    el.addEventListener("change", syncFsFieldsFromDom)
  );
  box.querySelectorAll(".fs-f-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      syncFsFieldsFromDom();
      const fi = Number(btn.closest(".fs-field-row").dataset.fi);
      scr.fields.splice(fi, 1);
      renderFsFieldsList();
      renderFlowStudio();
    });
  });
}

function syncFsFieldsFromDom() {
  const scr = fsActiveScreen();
  const box = $("fsFieldsList");
  if (!scr || !box || scr.layout !== "form") return;
  scr.fields = [];
  box.querySelectorAll(".fs-field-row").forEach((row) => {
    scr.fields.push({
      type: (row.querySelector(".fs-f-type") || {}).value || "text",
      label: (row.querySelector(".fs-f-label") || {}).value || "",
      required: true,
    });
  });
}

function renderFsPhonePreview(scr, index, editing) {
  const isLast = index === fsState.screens.length - 1;
  const btnLabel = scr.buttonLabel || (isLast ? "Cerrar" : "Continuar");
  let bodyHtml = "";
  if (scr.layout === "form" && (scr.fields || []).length) {
    bodyHtml = (scr.fields || []).map((f) =>
      `<p style="margin:8px 0;padding:10px;border:1px solid #e9edef;border-radius:8px;font-size:12px;color:#667781">${escapeHtml(f.label || "Campo")}</p>`
    ).join("");
  }
  return `
    <div class="fs-phone-wrap${editing ? " editing" : ""}" data-fs-i="${index}">
      <div class="flow-phone fs-phone-mini">
        <div class="flow-phone-nav">
          <span class="flow-phone-cancel">✕</span>
          <span class="flow-phone-title">${escapeHtml(scr.title || `Paso ${index + 1}`)}</span>
          <span class="flow-phone-menu">⋯</span>
        </div>
        <div class="flow-phone-body">
          <h3>${escapeHtml(scr.heading || "Título")}</h3>
          <p>${escapeHtml(scr.body || "Texto de la pantalla…")}</p>
          ${bodyHtml}
        </div>
        <div class="flow-phone-footer">
          <button type="button">${escapeHtml(btnLabel)}</button>
        </div>
      </div>
      <div class="fs-phone-dots">${fsState.screens.map((_, i) =>
        `<span class="${i === index ? "on" : ""}"></span>`
      ).join("")}</div>
    </div>`;
}

function renderFlowStudio() {
  renderFsLayoutGrid();
  loadFsSidebarFromScreen();

  const strip = $("fsScreenStrip");
  const row = $("fsPreviewRow");
  if (!strip || !row) return;

  const max = fsState.schema?.limits?.maxScreens || 8;
  strip.innerHTML = fsState.screens.map((scr, i) =>
    `<button type="button" class="fs-thumb${i === fsState.activeIndex ? " active" : ""}" data-fs-i="${i}" title="${escapeHtml(scr.title || "")}">
      <div class="fs-thumb-inner">${escapeHtml((scr.heading || scr.title || "Pantalla").slice(0, 24))}</div>
    </button>`
  ).join("")
    + (fsState.screens.length < max
      ? `<button type="button" class="fs-thumb-add" id="fsAddScreen" title="Agregar pantalla">+</button>`
      : "");

  strip.querySelectorAll(".fs-thumb").forEach((btn) => {
    btn.addEventListener("click", () => {
      syncFsFromSidebar();
      syncFsFieldsFromDom();
      fsState.activeIndex = Number(btn.dataset.fsI);
      fsState.viewMode = "one";
      document.querySelectorAll(".fs-view-btn").forEach((b) =>
        b.classList.toggle("active", b.dataset.fsView === "one")
      );
      renderFlowStudio();
    });
  });
  const addBtn = $("fsAddScreen");
  if (addBtn) addBtn.addEventListener("click", fsAddScreen);

  row.className = "fs-preview-row" + (fsState.viewMode === "one" ? " single" : "");
  if (fsState.viewMode === "one") {
    row.innerHTML = renderFsPhonePreview(fsActiveScreen(), fsState.activeIndex, true);
  } else {
    row.innerHTML = fsState.screens.map((scr, i) =>
      renderFsPhonePreview(scr, i, i === fsState.activeIndex)
    ).join("")
      + (fsState.screens.length < max
        ? `<button type="button" class="fs-thumb-add" style="width:240px;height:320px;font-size:32px" id="fsAddScreenRow">+</button>`
        : "");
    row.querySelectorAll(".fs-phone-wrap").forEach((el) => {
      el.addEventListener("click", () => {
        syncFsFromSidebar();
        fsState.activeIndex = Number(el.dataset.fsI);
        fsState.viewMode = "one";
        document.querySelectorAll(".fs-view-btn").forEach((b) =>
          b.classList.toggle("active", b.dataset.fsView === "one")
        );
        renderFlowStudio();
      });
    });
    const addRow = $("fsAddScreenRow");
    if (addRow) addRow.addEventListener("click", fsAddScreen);
  }
}

function fsAddScreen() {
  syncFsFromSidebar();
  syncFsFieldsFromDom();
  const max = fsState.schema?.limits?.maxScreens || 8;
  if (fsState.screens.length >= max) {
    toast(`Máximo ${max} pantallas.`, "error");
    return;
  }
  const confirmIdx = fsState.screens.findIndex((s) => s.layout === "confirm");
  const insertAt = confirmIdx >= 0 ? confirmIdx : fsState.screens.length;
  fsState.screens.splice(insertAt, 0, {
    layout: "message",
    title: `Paso ${insertAt + 1}`,
    heading: "Nueva pantalla",
    body: "Describe aquí el contenido.",
    buttonLabel: "Continuar",
    buttonAction: "next",
    fields: [],
  });
  fsState.activeIndex = insertAt;
  renderFlowStudio();
}

function fsRemoveScreen(index) {
  if (fsState.screens.length <= 1) {
    toast("Debe quedar al menos una pantalla.", "error");
    return;
  }
  fsState.screens.splice(index, 1);
  if (fsState.activeIndex >= fsState.screens.length) {
    fsState.activeIndex = fsState.screens.length - 1;
  }
  renderFlowStudio();
}

function collectFsDefinition() {
  syncFsFromSidebar();
  syncFsFieldsFromDom();
  const screens = fsState.screens.map((s, i) => {
    const isLast = i === fsState.screens.length - 1;
    if (s.layout === "form") {
      return {
        type: "form",
        title: s.title || `Paso ${i + 1}`,
        introHeading: s.heading,
        introBody: s.body,
        footerLabel: s.buttonLabel || "Enviar",
        fields: (s.fields && s.fields.length)
          ? s.fields.map((f) => ({ ...f }))
          : [{ type: "text", label: "Respuesta", required: true }],
      };
    }
    if (s.layout === "confirm" || (isLast && s.buttonAction === "complete")) {
      return {
        type: "confirm",
        title: s.title || "Gracias",
        heading: s.heading,
        body: s.body,
        footerLabel: s.buttonLabel || "Cerrar",
      };
    }
    return {
      type: "message",
      title: s.title || `Paso ${i + 1}`,
      heading: s.heading,
      body: s.body,
      footerLabel: s.buttonLabel || (isLast ? "Cerrar" : "Continuar"),
    };
  });
  const hasConfirm = screens.some((s) => s.type === "confirm");
  if (!hasConfirm && screens.length) {
    const last = screens[screens.length - 1];
    if (last.type === "message") last.footerLabel = last.footerLabel || "Cerrar";
  }
  return {
    name: ($("fsName") || {}).value.trim(),
    category: ($("fsCategory") || {}).value || "OTHER",
    cta: ($("fsCta") || {}).value.trim() || "Abrir formulario",
    chatBody: ($("fsChatBody") || {}).value.trim(),
    publish: false,
    screens,
  };
}

async function createFlowFromStudio() {
  const def = collectFsDefinition();
  if (!def.name) {
    toast("Ingresa un nombre interno para el Flow.", "error");
    $("fsName")?.focus();
    return;
  }
  const res = await post("/api/flows/build", def);
  if (!res.ok) { toast(res.error || "No se pudo crear el Flow.", "error"); return; }
  toast("Flow creado en Meta. Ahora puedes solicitar la plantilla del mensaje.", "ok");
  await loadFlows();
  closeFlowCreate();
  if (res.flow && res.flow.id) {
    if (res.defaultScreen) $("flowSendScreen").value = res.defaultScreen;
    if (res.defaultCta) $("flowSendCta").value = res.defaultCta;
    selectFlow(res.flow.id);
    openTemplateFromFlow(def);
  }
}

function openTemplateFromFlow(def) {
  const slug = def.name.replace(/[^a-z0-9_]/gi, "_").slice(0, 40);
  initTemplateModal().then(() => {
    if ($("tpName")) $("tpName").value = `${slug}_mensaje`;
    if ($("tpBody")) $("tpBody").value = def.chatBody || "Completa el formulario para continuar.";
    if ($("tpFooter")) $("tpFooter").value = "Punto Pago";
    renderTpVarList([]);
    $("tpVarsSection")?.classList.add("hidden");
    updateTpPreview();
    showModal("modalTemplate");
    toast("Revisa el mensaje y créalo en Meta para vincularlo al Flow.", "ok");
  });
}

async function initFlowBuilder() {
  await initFlowStudio();
}

async function loadPaymentAuthPanel() {
  const cfg = await api("/api/flows/payment-auth/config");
  if (cfg.ok && cfg.cardImageUrl) state.cardImageUrl = cfg.cardImageUrl;
  const presetRes = await api("/api/templates/presets/punto_pago_autorizacion_pago");
  const guide = (presetRes && presetRes.preset && presetRes.preset.variableGuide) || [];
  renderPayAuthVarGuide(guide);
  await updatePayAuthPreview();
  updatePayAuthFlowPreview();
  const recent = await api("/api/flows/payment-auth/recent");
  const box = $("payAuthRecent");
  if (!box) return;
  const rows = (recent && recent.data) || [];
  if (!rows.length) {
    box.textContent = "Sin autorizaciones de prueba aún.";
    return;
  }
  box.innerHTML = rows.slice(0, 5).map((r) => {
    const st = r.decision ? (r.decision === "authorize" ? "autorizado" : "rechazado") : "pendiente";
    return `<div>${escapeHtml(r.merchant)} · $${escapeHtml(r.amount)} · ${escapeHtml(st)} · ${escapeHtml(new Date(r.createdAt).toLocaleString("es"))}</div>`;
  }).join("");
}

async function sendPaymentAuthTest() {
  const phone = ($("payAuthPhone") || {}).value.trim();
  if (!phone) { toast("Ingresa un teléfono.", "error"); return; }
  const res = await post("/api/flows/payment-auth/test", {
    phone,
    customerName: ($("payAuthCustomerName") || {}).value.trim(),
    merchant: ($("payAuthMerchant") || {}).value.trim(),
    amount: ($("payAuthAmount") || {}).value.trim(),
    cardLast4: ($("payAuthCard4") || {}).value.trim(),
  });
  if (!res.ok) { toast(res.error || "No se pudo enviar.", "error"); return; }
  toast("Verificación de pago enviada. Revisa WhatsApp.", "ok");
  await loadPaymentAuthPanel();
  await loadFlowActivity();
  if (res.flowId) {
    await selectFlow(res.flowId);
    setFlowsTab("mis");
  }
}

async function loadFlowCapability() {
  const res = await api("/api/flows/capability");
  state.flowCapability = res;
  const dot = $("flowsStatusDot");
  const text = $("flowsStatusText");
  const cfgStatus = $("flowsConfigStatus");
  if (!dot || !text) return;

  if (!res.hasCredentials) {
    dot.className = "flows-status-dot err";
    text.textContent = "Sin conexión a WhatsApp. Configura las credenciales del servidor.";
    if (cfgStatus) cfgStatus.textContent = "Credenciales no configuradas.";
    return;
  }

  const ok = res.canListFlows;
  dot.className = `flows-status-dot ${ok ? "ok" : "warn"}`;
  const count = res.flowCount != null ? `${res.flowCount} Flow${res.flowCount === 1 ? "" : "s"} en tu cuenta` : "Flows disponibles";
  text.textContent = ok ? `Conectado · ${count}` : "Conexión parcial. Revisa Configuración.";
  if (cfgStatus) {
    cfgStatus.textContent = ok
      ? `Servidor listo. ${count}.`
      : (res.error || "No se pudo verificar la API de Flows.");
  }
}

async function loadFlowSamples() {
  const res = await api("/api/flows/samples");
  state.flowSamples = (res && res.samples) || [];
}

const FLOW_USE_CASE_ICONS = {
  cart: '<svg viewBox="0 0 24 24"><circle cx="9" cy="20" r="1"/><circle cx="17" cy="20" r="1"/><path d="M2 2h2l2.4 12.4a2 2 0 0 0 2 1.6h7.2a2 2 0 0 0 2-1.6L21 7H6"/></svg>',
  calendar: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/></svg>',
  support: '<svg viewBox="0 0 24 24"><path d="M4 14a8 8 0 0 1 16 0"/><path d="M5 14v2a2 2 0 0 0 2 2h1"/><path d="M17 18h1a2 2 0 0 0 2-2v-2"/></svg>',
  payment: '<svg viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>',
  kyc: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 20a8 8 0 0 1 16 0"/><path d="M16 11l2 2 4-4"/></svg>',
  megaphone: '<svg viewBox="0 0 24 24"><path d="M3 10v4l7 3V7L3 10z"/><path d="M14 8v8a3 3 0 0 0 3 3"/><path d="M17 5a5 5 0 0 1 0 14"/></svg>',
  truck: '<svg viewBox="0 0 24 24"><path d="M3 6h11v9H3z"/><path d="M14 9h4l3 4v2h-7V9z"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/></svg>',
  briefcase: '<svg viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
};

function flowUseCaseIconHtml(key, large) {
  const svg = FLOW_USE_CASE_ICONS[key] || FLOW_USE_CASE_ICONS.cart;
  return `<span class="flow-use-case-icon${large ? " lg" : ""}">${svg}</span>`;
}

async function loadFlowUseCases() {
  const res = await api("/api/flows/use-cases");
  state.flowUseCases = (res && res.useCases) || [];
  renderFlowUseCaseGrid();
}

function renderFlowUseCaseGrid() {
  const box = $("flowUseCaseGrid");
  if (!box) return;
  if (!state.flowUseCases.length) {
    box.innerHTML = `<p class="muted">No hay plantillas disponibles.</p>`;
    return;
  }
  const cards = [];
  state.flowUseCases.forEach((u) => {
    if (u.status === "soon" || !u.templates || !u.templates.length) return;
    u.templates.forEach((t) => {
      cards.push(`
        <article class="flow-template-card${t.key === "payment_auth" ? " featured" : ""}">
          <h3>${escapeHtml(t.name || t.key)}</h3>
          <p class="muted sm">${escapeHtml(u.label)} · ${escapeHtml(t.description || "")}</p>
          <div class="flows-actions">
            <button type="button" class="btn-primary sm flow-create-sample" data-sample="${escapeHtml(t.key)}">Crear en Meta</button>
            ${t.key === "payment_auth" ? `<button type="button" class="btn-ghost sm flow-go-probar">Probar</button>` : ""}
          </div>
        </article>`);
    });
  });
  box.innerHTML = cards.length
    ? cards.join("")
    : `<p class="muted">Plantillas en camino. Usa el editor visual de arriba.</p>`;
  box.querySelectorAll(".flow-create-sample").forEach((btn) =>
    btn.addEventListener("click", () => createFlowSampleKey(btn.dataset.sample))
  );
  box.querySelectorAll(".flow-go-probar").forEach((btn) =>
    btn.addEventListener("click", () => openFlowProbar())
  );
}

async function loadFlowEndpointSetup() {
  const res = await api("/api/flows/endpoint/setup");
  const uriEl = $("flowEndpointUri");
  const hint = $("flowEndpointHint");
  const retryBtn = $("flowEndpointSetupBtn");
  if (!uriEl) return;
  if (res.ok && res.endpointUri) {
    uriEl.textContent = res.endpointUri;
    if (hint) {
      if (res.warning) {
        hint.textContent = res.warning;
        hint.style.color = "var(--red)";
      } else if (res.synced) {
        hint.textContent = "Conectado con Meta. Los formularios dinámicos (como autorización de pago) se configuran solos.";
        hint.style.color = "";
      } else if (res.syncError) {
        hint.textContent = res.syncError;
        hint.style.color = "var(--red)";
      } else {
        hint.textContent = "Comprobando conexión con Meta…";
        hint.style.color = "";
      }
    }
    if (retryBtn) retryBtn.classList.toggle("hidden", Boolean(res.synced && !res.warning));
  } else {
    uriEl.textContent = "No configurado";
    if (hint) {
      hint.textContent = "El servidor necesita PUBLIC_BASE_URL para formularios con datos en vivo.";
      hint.style.color = "";
    }
    if (retryBtn) retryBtn.classList.add("hidden");
  }
}

async function openFlowsConfigModal() {
  await loadFlowEndpointSetup();
  await loadFlowCapability();
  showModal("modalFlowsConfig");
}

async function setupFlowEndpoint() {
  const res = await post("/api/flows/endpoint/setup", {});
  if (!res.ok) { toast(res.error || "No se pudo registrar la clave.", "error"); return; }
  toast(res.message || "Clave registrada.", "ok");
  await loadFlowEndpointSetup();
}

async function loadFlows() {
  const res = await api("/api/flows");
  state.flows = (res && res.data) || [];
  if (res && res.cleaned > 0) {
    toast(`${res.cleaned} borrador${res.cleaned === 1 ? "" : "es"} de prueba eliminado${res.cleaned === 1 ? "" : "s"} en Meta.`, "ok");
  }
  if (state.activeFlowId && !state.flows.some((f) => f.id === state.activeFlowId)) {
    state.activeFlowId = null;
  }
  renderFlowsList();
  if (state.activeFlowId) {
    await loadFlowDetail(state.activeFlowId);
  } else if ($("flowsDetailPanel")) {
    $("flowsDetailPanel").classList.add("hidden");
    if ($("flowsEmptyDetail")) $("flowsEmptyDetail").classList.remove("hidden");
  }
}

function renderFlowsList() {
  const box = $("flowsList");
  const hint = $("flowsListHint");
  if (hint) hint.textContent = state.flows.length ? `(${state.flows.length})` : "";
  if (!box) return;
  if (!state.flows.length) {
    box.innerHTML = `<p class="muted">Aún no tienes Flows. Pulsa «+ Agregar flujo» para crear uno desde una plantilla de Meta.</p>`;
    return;
  }
  box.innerHTML = state.flows.map((f) => {
    const st = (f.status || "").toUpperCase();
    const active = f.id === state.activeFlowId ? " active" : "";
    return `<div class="flow-item${active}" data-id="${escapeHtml(f.id)}">
      <div class="flow-item-head">
        <strong>${escapeHtml(f.name || f.id)}</strong>
        <span class="flow-status ${escapeHtml(st)}">${escapeHtml(FLOW_STATUS_LABELS[st] || st)}</span>
      </div>
      <div class="muted" style="font-size:11px;margin-top:4px">ID: ${escapeHtml(f.id)} · ${escapeHtml((f.categories || []).join(", ") || "—")}</div>
    </div>`;
  }).join("");
  box.querySelectorAll(".flow-item").forEach((el) =>
    el.addEventListener("click", () => selectFlow(el.dataset.id))
  );
}

async function selectFlow(id) {
  state.activeFlowId = id;
  renderFlowsList();
  setFlowsTab("mis");
  const f = state.flows.find((x) => x.id === id);

  const detail = await api(`/api/flows/${encodeURIComponent(id)}`);
  state.activeFlowDetail = detail.ok ? detail.flow : null;
  if (detail.ok && detail.flow && detail.flow.preview && detail.flow.preview.preview_url) {
    const a = $("flowPreviewLink");
    a.href = detail.flow.preview.preview_url;
    a.classList.remove("hidden");
  } else if ($("flowPreviewLink")) {
    $("flowPreviewLink").classList.add("hidden");
  }

  await loadFlowDetail(id);
  if (f && f.name && (f.name.includes("autorizacion") || f.name.includes("3ds"))) {
    $("flowSendScreen").value = "AUTH";
    $("flowSendCta").value = "Confirmar pago";
  }
}

async function createFlowSampleKey(sample) {
  const key = sample || "hello";
  const res = await post("/api/flows", { sample: key });
  if (!res.ok) { toast(res.error || "No se pudo crear el Flow.", "error"); return; }
  if (res.validation_errors && res.validation_errors.length) {
    toast(res.validation_errors[0].message || res.error || "Flow inválido.", "error");
    return;
  }
  toast("Flow creado en Meta.", "ok");
  await loadFlows();
  closeFlowCreate();
  if (res.flow && res.flow.id) {
    if (res.defaultScreen) $("flowSendScreen").value = res.defaultScreen;
    if (res.defaultCta) $("flowSendCta").value = res.defaultCta;
    selectFlow(res.flow.id);
  }
}

async function createFlowSample() {
  await createFlowSampleKey(($("flowSampleSelect") || {}).value || "hello");
}

async function sendActiveFlow() {
  const id = state.activeFlowId;
  if (!id) { toast("Selecciona un Flow.", "error"); return; }
  const phone = $("flowSendPhone").value.trim();
  if (!phone) { toast("Ingresa un teléfono.", "error"); return; }
  const isDynamic = state.activeFlowDetail && state.activeFlowDetail.endpoint_uri;
  const res = await post(`/api/flows/${encodeURIComponent(id)}/send`, {
    phone,
    bodyText: $("flowSendBody").value.trim(),
    cta: $("flowSendCta").value.trim(),
    screen: $("flowSendScreen").value.trim(),
    flowAction: isDynamic ? "data_exchange" : undefined,
  });
  if (!res.ok) {
    toast(res.hint || res.error || "No se pudo enviar.", "error");
    return;
  }
  toast(`Flow enviado (modo ${res.mode || "published"}).`, "ok");
  if (state.activeFlowId) await loadFlowDetail(state.activeFlowId);
  await loadFlowActivity();
}

async function publishActiveFlow() {
  const id = state.activeFlowId;
  if (!id) return;
  const res = await post(`/api/flows/${encodeURIComponent(id)}/publish`, {});
  if (!res.ok) { toast(res.error || "No se pudo publicar.", "error"); return; }
  toast("Flow publicado.", "ok");
  await loadFlows();
}

const FLOW_KIND_LABELS = { survey: "Encuesta", payment: "Pago", form: "Formulario", flow: "Flow" };

function formatActivityDate(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("es", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function renderFlowActivityDetail(row) {
  const box = $("flowActivityDetail");
  if (!box || !row) return;
  box.classList.remove("hidden");

  let body = `<h3>${escapeHtml(row.name)}</h3>`;

  if (row.kind === "survey" && row.surveyResults && row.surveyResults.length) {
    body += `<p class="muted sm">Resultados agregados de la encuesta</p>
      <table class="flow-survey-table billing-table">
        <thead><tr><th>Pregunta / campo</th><th>Respuesta</th><th class="num">Personas</th><th class="num">%</th></tr></thead>
        <tbody>`;
    row.surveyResults.forEach((field) => {
      const entries = Object.entries(field.counts).sort((a, b) => b[1] - a[1]);
      entries.forEach(([answer, count], i) => {
        const pct = field.total ? Math.round((count / field.total) * 100) : 0;
        body += `<tr>
          <td>${i === 0 ? escapeHtml(field.label) : ""}</td>
          <td>${escapeHtml(answer)}</td>
          <td class="num">${count}</td>
          <td class="num">${pct}%</td>
        </tr>`;
      });
    });
    body += `</tbody></table>`;
  } else if (row.kind === "payment" && row.paymentResults) {
    const p = row.paymentResults;
    body += `<div class="flows-stats-grid" style="margin-bottom:14px">
      <div class="flow-stat-card"><span class="n">${p.authorized}</span><span class="l">Autorizados</span></div>
      <div class="flow-stat-card"><span class="n">${p.denied}</span><span class="l">Rechazados</span></div>
      <div class="flow-stat-card"><span class="n">${p.pending}</span><span class="l">Pendientes</span></div>
    </div>`;
  }

  if (row.recentResponses && row.recentResponses.length) {
    body += `<p class="muted sm" style="margin-top:8px">Respuestas individuales</p>
      <table class="flow-responses-mini billing-table">
        <thead><tr><th>Teléfono</th><th>Fecha</th><th>Datos</th></tr></thead><tbody>`;
    row.recentResponses.forEach((r) => {
      const ans = Object.entries(r.answers || {}).map(([k, v]) => `${k}: ${v}`).join(" · ") || "—";
      body += `<tr>
        <td>+${escapeHtml(r.phone)}</td>
        <td>${escapeHtml(formatActivityDate(r.receivedAt))}</td>
        <td>${escapeHtml(ans)}</td>
      </tr>`;
    });
    body += `</tbody></table>`;
  } else if (!row.surveyResults || !row.surveyResults.length) {
    body += `<p class="muted sm">Sin respuestas detalladas todavía.</p>`;
  }

  box.innerHTML = body;
}

function selectActivityRow(index) {
  state.activeActivityRow = index;
  const row = state.flowActivity[index];
  document.querySelectorAll(".flow-activity-row").forEach((tr, i) =>
    tr.classList.toggle("active", i === index)
  );
  renderFlowActivityDetail(row);
}

async function loadFlowActivity() {
  const tbody = $("flowActivityRows");
  const summary = $("flowActivitySummary");
  const detail = $("flowActivityDetail");
  if (!tbody) return;

  const res = await api("/api/flows/activity");
  state.flowActivity = (res && res.data) || [];

  if (summary && res.summary) {
    summary.classList.remove("hidden");
    summary.innerHTML = [
      [res.summary.total, "Flows con actividad"],
      [res.summary.sent, "Enviados"],
      [res.summary.viewed, "Vieron"],
      [res.summary.completed, "Completaron"],
    ].map(([n, l]) => `<div class="flow-stat-card"><span class="n">${n}</span><span class="l">${escapeHtml(l)}</span></div>`).join("");
  }

  if (!state.flowActivity.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="muted center">Sin actividad aún. Envía un Flow desde Probar o Mis Flows.</td></tr>`;
    if (detail) detail.classList.add("hidden");
    return;
  }

  tbody.innerHTML = state.flowActivity.map((row, i) => {
    const kind = FLOW_KIND_LABELS[row.kind] || "Flow";
    return `<tr class="flow-activity-row${state.activeActivityRow === i ? " active" : ""}" data-i="${i}">
      <td>
        <strong>${escapeHtml(row.name)}</strong>
        <span class="kind-tag ${escapeHtml(row.kind)}">${escapeHtml(kind)}</span>
      </td>
      <td class="num">${row.sent}</td>
      <td class="num">${row.viewed}</td>
      <td class="num">${row.completed}${row.sent ? ` <span class="muted">(${row.completionRate}%)</span>` : ""}</td>
      <td>${escapeHtml(formatActivityDate(row.lastActivityAt))}</td>
      <td><span class="muted">Ver →</span></td>
    </tr>`;
  }).join("");

  tbody.querySelectorAll(".flow-activity-row").forEach((tr) =>
    tr.addEventListener("click", () => selectActivityRow(Number(tr.dataset.i)))
  );

  if (state.activeActivityRow != null && state.flowActivity[state.activeActivityRow]) {
    renderFlowActivityDetail(state.flowActivity[state.activeActivityRow]);
  } else if (state.flowActivity.length === 1) {
    selectActivityRow(0);
  } else if (detail) {
    detail.classList.add("hidden");
  }
}

async function loadFlowResponses() {
  await loadFlowActivity();
}

async function initFlowsScreen() {
  setFlowsTab(state.flowsTab || "mis");
  await Promise.all([
    loadFlowCapability(),
    initFlowBuilder(),
    loadFlowUseCases(),
    loadFlowSamples(),
    loadFlowEndpointSetup(),
    loadPaymentAuthPanel(),
    loadFlows(),
    loadFlowActivity(),
  ]);
}

/* ---------- modals & nav ---------- */
function showModal(id) { $(id).classList.remove("hidden"); }
function closeModals() { document.querySelectorAll(".modal").forEach((m) => m.classList.add("hidden")); }

function initSidebar() {
  const nav = $("appNav");
  if (!nav) return;
  if (localStorage.getItem("pp-nav-collapsed") === "1") nav.classList.add("collapsed");
}

function switchScreen(name) {
  if (!name || name === state.currentScreen) return;
  const prev = state.currentScreen;
  state.currentScreen = name;

  document.querySelectorAll(".nav-item[data-screen]").forEach((b) =>
    b.classList.toggle("active", b.dataset.screen === name)
  );
  $("screenChats").classList.toggle("hidden", name !== "chats");
  $("screenTemplates").classList.toggle("hidden", name !== "templates");
  $("screenBulk").classList.toggle("hidden", name !== "bulk");
  $("screenIntegration").classList.toggle("hidden", name !== "integration");
  $("screenWorkspace").classList.toggle("hidden", name !== "workspace");
  $("screenFlows").classList.toggle("hidden", name !== "flows");
  $("screenBilling").classList.toggle("hidden", name !== "billing");

  if (prev === "chats" && name !== "chats") stopPolling();
  if (name === "chats") {
    loadConversations();
    startPolling();
  }

  const cache = state.screenCache;
  if (name === "templates") {
    if (!cache.templates) {
      cache.templates = true;
      Promise.all([loadTemplates().then(renderTemplateList), initTemplateStudio()]);
    } else {
      renderTemplateList();
    }
  }
  if (name === "bulk") {
    if (!cache.bulk) {
      cache.bulk = true;
      initBulkScreen();
    } else {
      fillBulkTemplates();
    }
  }
  if (name === "integration") {
    if (!cache.integration) {
      cache.integration = true;
      initIntegrationScreen();
    } else if (window.IntegrationApiModule) {
      window.IntegrationApiModule.setTemplates(state.templates);
    }
  }
  if (name === "workspace") {
    if (!cache.workspace) {
      cache.workspace = true;
      initWorkspaceScreen();
    }
  }
  if (name === "flows") {
    if (!cache.flows) {
      cache.flows = true;
      initFlowsScreen();
    }
  }
  if (name === "billing") {
    if (!cache.billing) {
      cache.billing = true;
      loadBilling();
      renderPrices();
    }
  }
  if (name !== "bulk") stopBulkPolling();
  toggleWorkspaceFlyout(false);
}

/* ---------- polling ---------- */
function startPolling() {
  stopPolling();
  state.pollTimer = setInterval(async () => {
    await loadConversations();
    if (state.activePhone) {
      await Promise.all([
        loadMessages(state.activePhone),
        loadConversationDetail(state.activePhone),
      ]);
    }
  }, POLL_MS);
}
function stopPolling() { if (state.pollTimer) clearInterval(state.pollTimer); state.pollTimer = null; }

/* ---------- events ---------- */
function bindEvents() {
  document.querySelectorAll(".nav-item[data-screen]").forEach((b) =>
    b.addEventListener("click", () => switchScreen(b.dataset.screen))
  );
  const collapseBtn = $("sidebarCollapseBtn");
  if (collapseBtn) {
    collapseBtn.addEventListener("click", () => {
      const nav = $("appNav");
      if (!nav) return;
      nav.classList.toggle("collapsed");
      localStorage.setItem("pp-nav-collapsed", nav.classList.contains("collapsed") ? "1" : "0");
    });
  }
  const chatBack = $("chatBackBtn");
  if (chatBack) chatBack.addEventListener("click", closeChatView);
  const mobileWs = $("mobileWsBtn");
  if (mobileWs) {
    mobileWs.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleWorkspaceFlyout();
    });
  }
  $("searchInput").addEventListener("input", (e) => { state.filter = e.target.value; renderConversations(); });
  $("composer").addEventListener("submit", (e) => { e.preventDefault(); sendText($("messageInput").value); });
  $("newChatBtn").addEventListener("click", () => openNewChat());
  $("ncTemplate").addEventListener("change", (e) => {
    renderTemplateFields(tplByName(e.target.value));
    updateNewChatCategoryHint();
  });
  $("ncSend").addEventListener("click", sendNewChat);
  $("attachBtn").addEventListener("click", () => showModal("modalMedia"));
  $("detailMediaBtn").addEventListener("click", () => showModal("modalMedia"));
  $("mdFile").addEventListener("change", updateMediaPreview);
  $("mdSend").addEventListener("click", sendMedia);
  $("simBtn").addEventListener("click", () => showModal("modalSim"));
  $("simSend").addEventListener("click", simulate);
  $("billSync").addEventListener("click", loadBilling);
  $("billRange").addEventListener("change", () => {
    state.billingRangeDirty = true;
    updateBillSyncHint();
  });
  document.querySelectorAll(".billing-tab").forEach((btn) =>
    btn.addEventListener("click", () => setBillingTab(btn.dataset.billTab))
  );
  const billDetailOpenChat = $("billDetailOpenChat");
  if (billDetailOpenChat) {
    billDetailOpenChat.addEventListener("click", () => openConversationFromBillEntry(state.activeBillEntry));
  }
  $("bulkPreviewBtn").addEventListener("click", previewBulkCsv);
  $("bulkCreateBtn").addEventListener("click", createBulkCampaign);
  $("bulkSampleBtn").addEventListener("click", downloadBulkSampleCsv);
  $("bulkStartBtn").addEventListener("click", startBulkCampaign);
  $("bulkPauseBtn").addEventListener("click", pauseBulkCampaign);
  $("bulkCloseBtn").addEventListener("click", closeCampaignDetail);
  const bulkGoInt = $("bulkGoIntegration");
  if (bulkGoInt) bulkGoInt.addEventListener("click", () => switchScreen("integration"));

  $("workspaceHubBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    toggleWorkspaceFlyout();
  });
  document.querySelectorAll(".ws-flyout-item:not(:disabled)").forEach((btn) =>
    btn.addEventListener("click", () => openWorkspaceTab(btn.dataset.wsTab))
  );
  document.querySelectorAll(".ws-tab:not(:disabled)").forEach((btn) =>
    btn.addEventListener("click", () => setWorkspaceTab(btn.dataset.wsTab))
  );
  $("wsSaveProfile").addEventListener("click", saveWorkspaceProfile);
  $("wsSaveWorkspace").addEventListener("click", saveWorkspaceSettings);
  $("wsRefreshReports").addEventListener("click", loadWorkspaceReports);
  $("wsPhotoInput").addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) uploadWorkspacePhoto(f);
    e.target.value = "";
  });
  $("wsPhotoRemove").addEventListener("click", removeWorkspacePhoto);
  document.querySelectorAll("[data-screen-jump]").forEach((btn) =>
    btn.addEventListener("click", () => switchScreen(btn.dataset.screenJump))
  );
  document.addEventListener("click", (e) => {
    const fly = $("workspaceFlyout");
    if (!fly || fly.classList.contains("hidden")) return;
    if (fly.contains(e.target)) return;
    if ($("workspaceHubBtn")?.contains(e.target)) return;
    if ($("mobileWsBtn")?.contains(e.target)) return;
    toggleWorkspaceFlyout(false);
  });
  $("newTemplateBtn").addEventListener("click", () => { initTemplateModal(); showModal("modalTemplate"); });
  const tplSyncMetaBtn = $("tplSyncMetaBtn");
  if (tplSyncMetaBtn) tplSyncMetaBtn.addEventListener("click", syncTemplatesWithMeta);
  const tplDraftCreateBtn = $("tplDraftCreateBtn");
  if (tplDraftCreateBtn) {
    tplDraftCreateBtn.addEventListener("click", () => {
      const key = state.activeTemplatePreset;
      closeModals();
      initTemplateModal(key).then(() => showModal("modalTemplate"));
    });
  }
  ["tplPreviewName", "tplPreviewAmount", "tplPreviewMerchant", "tplPreviewCard4"].forEach((id) => {
    const el = $(id);
    if (el) el.addEventListener("input", () => {
      updateTplDraftPreview();
      updatePayAuthPreview();
      updatePayAuthFlowPreview();
    });
  });
  const payAuthOpenTplBtn = $("payAuthOpenTplBtn");
  if (payAuthOpenTplBtn) {
    payAuthOpenTplBtn.addEventListener("click", () => openTplDraftModal("punto_pago_autorizacion_pago"));
  }
  document.querySelectorAll(".flows-tab").forEach((btn) =>
    btn.addEventListener("click", () => setFlowsTab(btn.dataset.flowsTab))
  );
  const flowsConfigBtn = $("flowsConfigBtn");
  if (flowsConfigBtn) flowsConfigBtn.addEventListener("click", openFlowsConfigModal);
  const fsCreateBtn = $("fsCreateBtn");
  if (fsCreateBtn) fsCreateBtn.addEventListener("click", createFlowFromStudio);
  const fsPickerToggle = $("fsPickerToggle");
  if (fsPickerToggle) {
    fsPickerToggle.addEventListener("click", () => $("flowCreatePicker")?.classList.toggle("hidden"));
  }
  document.querySelectorAll(".fs-view-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      syncFsFromSidebar();
      fsState.viewMode = btn.dataset.fsView || "all";
      document.querySelectorAll(".fs-view-btn").forEach((b) =>
        b.classList.toggle("active", b.dataset.fsView === fsState.viewMode)
      );
      renderFlowStudio();
    });
  });
  ["fsHeading", "fsBody", "fsButton"].forEach((id) => {
    const el = $(id);
    if (el) el.addEventListener("input", () => { syncFsFromSidebar(); renderFlowStudio(); });
  });
  document.querySelectorAll('input[name="fsAction"]').forEach((el) =>
    el.addEventListener("change", () => { syncFsFromSidebar(); renderFlowStudio(); })
  );
  const fsAddField = $("fsAddField");
  if (fsAddField) {
    fsAddField.addEventListener("click", () => {
      syncFsFieldsFromDom();
      const scr = fsActiveScreen();
      if (!scr || scr.layout !== "form") return;
      scr.fields = scr.fields || [];
      scr.fields.push({ type: "text", label: "", required: true });
      renderFsFieldsList();
      renderFlowStudio();
    });
  }
  ["payAuthCustomerName", "payAuthMerchant", "payAuthAmount", "payAuthCard4"].forEach((id) => {
    const el = $(id);
    if (el) el.addEventListener("input", () => { updatePayAuthPreview(); updatePayAuthFlowPreview(); });
  });
  const payAuthCardImage = $("payAuthCardImage");
  if (payAuthCardImage) {
    payAuthCardImage.addEventListener("change", (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) uploadPayAuthCardImage(f);
      e.target.value = "";
    });
  }
  document.querySelectorAll(".flow-screen-tab").forEach((btn) =>
    btn.addEventListener("click", () => {
      state.payAuthFlowScreen = btn.dataset.screen || "AUTH";
      document.querySelectorAll(".flow-screen-tab").forEach((b) =>
        b.classList.toggle("active", b.dataset.screen === state.payAuthFlowScreen)
      );
      updatePayAuthFlowPreview();
    })
  );
  document.querySelectorAll(".flows-detail-tab").forEach((btn) =>
    btn.addEventListener("click", () => setFlowsDetailTab(btn.dataset.detailTab))
  );
  $("tpCreate").addEventListener("click", createTemplate);
  $("tpAddVar").addEventListener("click", () => {
    const vars = collectTpVariables();
    vars.push({ key: "", example: "" });
    renderTpVarList(vars);
    $("tpVarsSection")?.classList.remove("hidden");
    updateTpPreview();
  });
  const flowAddBtn = $("flowAddBtn");
  if (flowAddBtn) flowAddBtn.addEventListener("click", openFlowCreate);
  const flowCreateCancel = $("flowCreateCancel");
  if (flowCreateCancel) flowCreateCancel.addEventListener("click", closeFlowCreate);
  const flowProbarBack = $("flowProbarBack");
  if (flowProbarBack) flowProbarBack.addEventListener("click", closeFlowProbar);
  const flowDetailProbarBtn = $("flowDetailProbarBtn");
  if (flowDetailProbarBtn) flowDetailProbarBtn.addEventListener("click", openFlowProbar);
  ["tpHeader", "tpBody", "tpFooter"].forEach((id) => {
    const el = $(id);
    if (el) el.addEventListener("input", updateTpPreview);
  });
  $("flowSendBtn")?.addEventListener("click", sendActiveFlow);
  $("flowPublishBtn")?.addEventListener("click", publishActiveFlow);
  $("flowRefreshResponses")?.addEventListener("click", loadFlowActivity);
  if ($("flowEndpointSetupBtn")) $("flowEndpointSetupBtn").addEventListener("click", setupFlowEndpoint);
  if ($("payAuthSendBtn")) $("payAuthSendBtn").addEventListener("click", sendPaymentAuthTest);
  $("detailTemplateBtn").addEventListener("click", () => openNewChat());
  $("detailToggle").addEventListener("click", () => {
    const pane = $("detailPane");
    if (!pane) return;
    if (window.matchMedia("(max-width: 1100px)").matches) {
      setDetailPaneOpen(!pane.classList.contains("open"));
    } else {
      pane.classList.toggle("collapsed");
    }
  });
  const detailBackdrop = $("detailPaneBackdrop");
  if (detailBackdrop) {
    detailBackdrop.addEventListener("click", () => setDetailPaneOpen(false));
  }
  [
    "leadName", "leadCompany", "leadType", "leadUserType", "leadLocation",
    "leadOwner", "leadEmail", "leadUserId", "leadSignedUp", "leadLastOpenedEmail",
  ].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener("input", scheduleLeadSave);
    el.addEventListener("change", scheduleLeadSave);
  });
  $("detailNotes").addEventListener("blur", saveNotes);
  $("detailNotes").addEventListener("input", () => {
    clearTimeout(state.notesTimer);
    state.notesTimer = setTimeout(saveNotes, 900);
  });
  document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeModals));
  document.querySelectorAll(".modal").forEach((m) =>
    m.addEventListener("click", (e) => { if (e.target === m) closeModals(); })
  );
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModals(); });
}

init();
