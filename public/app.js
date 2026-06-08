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
  activePhone: null,
  messages: [],
  conversationDetail: null,
  filter: "",
  pollTimer: null,
  notesTimer: null,
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
  bindEvents();
  await loadConversations();
  startPolling();
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopPolling();
    else { loadConversations(); if (state.activePhone) loadMessages(state.activePhone); startPolling(); }
  });
}

function applyBranding() {
  const name = state.config.brandName || "Punto Pago";
  document.title = name + " · Inbox";
  $("connDot").className = "conn-dot " + (state.config.persistent ? "online" : "offline");
  $("connDot").title = state.config.persistent ? "Persistencia activa" : "Modo memoria";
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

async function openConversation(phone, name) {
  state.activePhone = phone;
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

  const first = d.firstSeen;
  $("detailFirstSeen").textContent = first
    ? `Primer contacto: ${new Date(first).toLocaleString("es", { dateStyle: "medium", timeStyle: "short" })}`
    : "";

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
  box.innerHTML = state.messages
    .map((m) => {
      const tplClass = m.type === "template" ? " tpl" : "";
      const media = renderMedia(m);
      const caption = m.text ? escapeHtml(m.text) : "";
      const time = new Date(m.timestamp).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
      return `<div class="msg-row ${m.direction}">
        <div class="bubble${tplClass}">
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
  return `<tr class="tpl-row" data-i="${i}" title="${escapeHtml(fullPreview)}">
    <td class="tpl-name-cell">
      <span class="tpl-table-name">${escapeHtml(t.name)}</span>
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
async function createTemplate() {
  const payload = {
    name: $("tpName").value.trim(),
    category: $("tpCategory").value,
    language: $("tpLang").value,
    headerText: $("tpHeader").value.trim(),
    bodyText: $("tpBody").value.trim(),
    footerText: $("tpFooter").value.trim(),
  };
  const hint = $("tpHint");
  if (!payload.name || !payload.bodyText) {
    hint.className = "hint error";
    hint.textContent = "Nombre y cuerpo son obligatorios.";
    return;
  }
  hint.className = "hint";
  hint.textContent = "Creando…";
  const res = await post("/api/templates", payload);
  if (res.ok) {
    closeModals();
    toast("Plantilla creada como " + (res.requestedCategory || payload.category).toLowerCase() + ". Meta puede asignar otra categoría al aprobarla.", "ok");
    await loadTemplates();
    renderTemplateList();
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
  if (!t) { box.innerHTML = ""; return; }
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

async function loadBilling() {
  const days = $("billRange").value;
  const tbody = $("billRows");
  tbody.innerHTML = `<tr><td colspan="4" class="muted center">Sincronizando…</td></tr>`;
  let res;
  try { res = await api(`/api/billing?days=${days}`); } catch (_) { res = { ok: false, error: "Error de red" }; }

  const note = $("billNote");
  if (!res.ok) {
    tbody.innerHTML = `<tr><td colspan="4" class="muted center">No se pudo cargar.</td></tr>`;
    note.textContent = res.error || "";
    ["bcCost", "bcVolume", "bcMkt", "bcUtil", "bcAuth"].forEach((id) => ($(id).textContent = "—"));
    $("billTplAlert").classList.add("hidden");
    return;
  }

  const t = res.totals || { byCategory: {} };
  const byCat = t.byCategory || {};
  $("bcCost").textContent = fmtCost(t.cost);
  $("bcVolume").textContent = fmtNum(t.volume);
  $("bcMkt").textContent = fmtCost(byCat.MARKETING || 0);
  $("bcUtil").textContent = fmtCost(byCat.UTILITY || 0);
  $("bcAuth").textContent = fmtCost((byCat.AUTHENTICATION || 0) + (byCat.AUTHENTICATION_INTERNATIONAL || 0));

  const alert = $("billTplAlert");
  const ts = res.templateSummary || {};
  if (ts.pendingReclass || ts.reclassified) {
    alert.classList.remove("hidden");
    const parts = [];
    if (ts.pendingReclass) parts.push(`${ts.pendingReclass} plantilla(s) con reclasificación pendiente`);
    if (ts.reclassified) parts.push(`${ts.reclassified} con categoría distinta a la solicitada`);
    alert.innerHTML = `<strong>Plantillas:</strong> ${parts.join(" · ")}. Los costos de arriba reflejan la categoría que Meta ya facturó; revisa la pantalla Plantillas para ver solicitudes vs. categoría asignada.`;
  } else {
    alert.classList.add("hidden");
    alert.innerHTML = "";
  }

  if (!res.rows.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="muted center">Sin datos en este periodo.</td></tr>`;
  } else {
    tbody.innerHTML = res.rows
      .map((r) => `<tr>
        <td><span class="country-cell"><span class="flag">${countryFlag(r.country)}</span>${escapeHtml(countryName(r.country))}</span></td>
        <td><span class="cat-tag ${escapeHtml(r.category)}">${escapeHtml(categoryBillingLabel(r.category))}</span></td>
        <td class="num">${fmtNum(r.volume)}</td>
        <td class="num">${fmtCost(r.cost)}</td>
      </tr>`)
      .join("");
  }
  note.innerHTML = `Los montos están en la moneda de tu WABA y usan la <strong>categoría asignada por Meta</strong> (no la que solicitaste al crear la plantilla). Un costo de <strong>0</strong> suele indicar mensajes de servicio gratuitos o tráfico de número de prueba.`;
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
      return `<div class="bulk-camp-item${active}" data-id="${escapeHtml(c.id)}">
        <strong>${escapeHtml(c.name)}</strong>
        <div class="muted" style="font-size:11px;margin-top:4px">
          ${escapeHtml(c.template)} · ${escapeHtml(BULK_STATUS_LABELS[c.status] || c.status)}
          · ${t.delivered || 0} entregados / ${t.total || 0}
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
  let msg = `${res.rowCount} contacto(s) válidos. Variables: ${(res.varColumns || []).join(", ") || "ninguna"}.`;
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
  $("bulkDetailTitle").textContent = c.name;
  $("bulkDetailMeta").textContent = `${c.template} · ${c.language} · ${BULK_STATUS_LABELS[c.status] || c.status}${c.pauseReason ? " · " + c.pauseReason : ""}`;
  $("bulkStats").innerHTML = [
    ["total", "Total"],
    ["pending", "Pendientes"],
    ["sent", "Enviados"],
    ["delivered", "Entregados"],
    ["read", "Leídos"],
    ["failed", "Errores"],
  ].map(([k, label]) => `<div class="bulk-stat"><span class="n">${t[k] || 0}</span><span class="l">${label}</span></div>`).join("");

  const rows = (rowsRes && rowsRes.rows) || [];
  $("bulkRowsBody").innerHTML = rows.map((r) => `<tr>
    <td>+${escapeHtml(r.phone)}</td>
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

/* ---------- modals & nav ---------- */
function showModal(id) { $(id).classList.remove("hidden"); }
function closeModals() { document.querySelectorAll(".modal").forEach((m) => m.classList.add("hidden")); }

function switchScreen(name) {
  document.querySelectorAll(".rail-btn").forEach((b) => b.classList.toggle("active", b.dataset.screen === name));
  $("screenChats").classList.toggle("hidden", name !== "chats");
  $("screenTemplates").classList.toggle("hidden", name !== "templates");
  $("screenBulk").classList.toggle("hidden", name !== "bulk");
  $("screenBilling").classList.toggle("hidden", name !== "billing");
  if (name === "templates") { loadTemplates().then(renderTemplateList); }
  if (name === "bulk") { initBulkScreen(); }
  if (name === "billing") { loadBilling(); renderPrices(); }
  if (name !== "bulk") stopBulkPolling();
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
  document.querySelectorAll(".rail-btn").forEach((b) =>
    b.addEventListener("click", () => switchScreen(b.dataset.screen))
  );
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
  $("billRange").addEventListener("change", loadBilling);
  $("bulkPreviewBtn").addEventListener("click", previewBulkCsv);
  $("bulkCreateBtn").addEventListener("click", createBulkCampaign);
  $("bulkSampleBtn").addEventListener("click", downloadBulkSampleCsv);
  $("bulkStartBtn").addEventListener("click", startBulkCampaign);
  $("bulkPauseBtn").addEventListener("click", pauseBulkCampaign);
  $("bulkCloseBtn").addEventListener("click", closeCampaignDetail);
  $("newTemplateBtn").addEventListener("click", () => showModal("modalTemplate"));
  $("tpCreate").addEventListener("click", createTemplate);
  $("detailTemplateBtn").addEventListener("click", () => openNewChat());
  $("detailToggle").addEventListener("click", () => $("detailPane").classList.toggle("collapsed"));
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
