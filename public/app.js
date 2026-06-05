"use strict";

const POLL_MS = 6000;
const DAY_MS = 24 * 60 * 60 * 1000;

const state = {
  config: { brandName: "Punto Pago", templatesEnabled: false, hasCredentials: false },
  conversations: [],
  templates: [],
  activePhone: null,
  messages: [],
  filter: "",
  pollTimer: null,
};

/* ---------- tiny helpers ---------- */
const $ = (id) => document.getElementById(id);
const api = async (url, opts) => {
  const res = await fetch(url, opts);
  return res.json().catch(() => ({}));
};
const post = (url, body) =>
  api(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

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
          <div class="conv-last">${escapeHtml(prefix + (last.text || ""))}</div>
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
  await loadMessages(phone);
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

function statusTick(m) {
  if (m.direction !== "out") return "";
  const map = {
    pending: '<span class="tick"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></span>',
    sent: '<span class="tick"><svg viewBox="0 0 24 24"><path d="M4 12l5 5L20 6"/></svg></span>',
    delivered: '<span class="tick"><svg viewBox="0 0 24 24"><path d="M1 13l4 4L15 7M9 13l4 4L23 7"/></svg></span>',
    read: '<span class="tick read"><svg viewBox="0 0 24 24"><path d="M1 13l4 4L15 7M9 13l4 4L23 7"/></svg></span>',
    failed: '<span class="tick failed"><svg viewBox="0 0 24 24"><path d="M12 8v4m0 4h.01"/><circle cx="12" cy="12" r="9"/></svg></span>',
  };
  return map[m.status] || "";
}

function renderMessages() {
  const box = $("messages");
  box.innerHTML = state.messages
    .map((m) => {
      const tplClass = m.type === "template" ? " tpl" : "";
      const media = m.media && m.type === "image" ? `<img src="${escapeHtml(m.media)}" alt="" />` : "";
      const time = new Date(m.timestamp).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
      return `<div class="msg-row ${m.direction}">
        <div class="bubble${tplClass}">
          ${media}${escapeHtml(m.text || "")}
          <div class="bubble-meta">${time}${statusTick(m)}</div>
        </div>
      </div>`;
    })
    .join("");
  box.scrollTop = box.scrollHeight;
}

function lastInboundTs() {
  for (let i = state.messages.length - 1; i >= 0; i--) {
    if (state.messages[i].direction === "in") return state.messages[i].timestamp;
  }
  return 0;
}

function updateWindow() {
  const last = lastInboundTs();
  const open = last && Date.now() - last < DAY_MS;
  const pill = $("detailWindow");
  const banner = $("windowBanner");
  if (open) {
    const hrs = Math.max(0, Math.floor((DAY_MS - (Date.now() - last)) / 3600000));
    pill.className = "window-pill open";
    pill.textContent = `Abierta · ~${hrs}h restantes`;
    banner.classList.add("hidden");
  } else {
    pill.className = "window-pill closed";
    pill.textContent = "Cerrada";
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
  await loadConversations();
}

/* ---------- templates ---------- */
async function loadTemplates() {
  const res = await api("/api/templates");
  state.templates = (res && res.data) || [];
  if (res && res.warning) toast(res.warning, "error");
  return state.templates;
}

function renderTemplateList() {
  const list = $("templateList");
  if (!state.config.templatesEnabled) {
    list.innerHTML = `<li class="muted" style="padding:24px;text-align:center">Configura ACCESS_TOKEN y WABA_ID para gestionar plantillas.</li>`;
    return;
  }
  if (!state.templates.length) {
    list.innerHTML = `<li class="muted" style="padding:24px;text-align:center">No hay plantillas. Pulsa “Crear”.</li>`;
    return;
  }
  list.innerHTML = state.templates
    .map((t, i) => {
      const st = (t.status || "").toLowerCase();
      const cls = st === "approved" ? "approved" : st === "rejected" ? "rejected" : "pending";
      return `<li class="tpl-item" data-i="${i}">
        <div class="tpl-name">${escapeHtml(t.name)}</div>
        <div class="tpl-sub">
          <span class="status-badge ${cls}">${escapeHtml(t.status || "—")}</span>
          <span>${escapeHtml(t.language || "")}</span>
          <span>${escapeHtml((t.category || "").toLowerCase())}</span>
        </div>
      </li>`;
    })
    .join("");
  list.querySelectorAll(".tpl-item").forEach((el) =>
    el.addEventListener("click", () => showTemplate(state.templates[el.dataset.i]))
  );
}

function bodyOf(t) {
  const c = (t.components || []).find((x) => x.type === "BODY");
  return c ? c.text : "";
}
function showTemplate(t) {
  $("templateEmpty").classList.add("hidden");
  const d = $("templateDetail");
  d.classList.remove("hidden");
  const header = (t.components || []).find((x) => x.type === "HEADER");
  const footer = (t.components || []).find((x) => x.type === "FOOTER");
  const st = (t.status || "").toLowerCase();
  const cls = st === "approved" ? "approved" : st === "rejected" ? "rejected" : "pending";
  d.innerHTML = `
    <h2>${escapeHtml(t.name)}</h2>
    <span class="status-badge ${cls}">${escapeHtml(t.status || "—")}</span>
    <div class="tpl-preview">
      ${header && header.text ? `<div class="tpl-h">${escapeHtml(header.text)}</div>` : ""}
      <div>${escapeHtml(bodyOf(t))}</div>
      ${footer && footer.text ? `<div class="tpl-f">${escapeHtml(footer.text)}</div>` : ""}
    </div>`;
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
    toast("Plantilla creada. Meta la revisará.", "ok");
    await loadTemplates();
    renderTemplateList();
  } else {
    hint.className = "hint error";
    hint.textContent = res.error || "No se pudo crear.";
  }
}

/* ---------- new chat (send template) ---------- */
async function openNewChat() {
  showModal("modalNewChat");
  const sel = $("ncTemplate");
  const hint = $("ncHint");
  sel.innerHTML = `<option>Cargando…</option>`;
  await loadTemplates();
  const approved = state.templates.filter((t) => (t.status || "").toLowerCase() === "approved");
  if (!approved.length) {
    sel.innerHTML = `<option value="">— sin plantillas aprobadas —</option>`;
    hint.className = "hint error";
    hint.textContent = "No tienes plantillas aprobadas. Crea una en la sección Plantillas y espera la aprobación de Meta.";
  } else {
    sel.innerHTML = approved
      .map((t) => `<option value="${escapeHtml(t.name)}|${escapeHtml(t.language)}">${escapeHtml(t.name)} (${escapeHtml(t.language)})</option>`)
      .join("");
    hint.className = "hint";
    hint.textContent = "Se enviará la plantilla para abrir la conversación.";
  }
}

async function sendNewChat() {
  const phone = $("ncPhone").value.replace(/[^0-9]/g, "");
  const name = $("ncName").value.trim();
  const val = $("ncTemplate").value;
  if (!phone || !val) { toast("Indica número y plantilla.", "error"); return; }
  const [template, language] = val.split("|");
  const res = await post("/api/send-template", { phone, name, template, language });
  if (res.ok) {
    closeModals();
    toast("Plantilla enviada.", "ok");
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
  const link = $("mdLink").value.trim();
  if (!link) { toast("Pega un enlace.", "error"); return; }
  const res = await post("/api/send-media", {
    phone, mediaType: $("mdType").value, link, caption: $("mdCaption").value.trim(),
  });
  closeModals();
  if (res.ok) toast("Enviado.", "ok");
  else toast("No se pudo enviar: " + (res.error || res.warning || "error"), "error");
  $("mdLink").value = ""; $("mdCaption").value = "";
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

/* ---------- modals & nav ---------- */
function showModal(id) { $(id).classList.remove("hidden"); }
function closeModals() { document.querySelectorAll(".modal").forEach((m) => m.classList.add("hidden")); }

function switchScreen(name) {
  document.querySelectorAll(".rail-btn").forEach((b) => b.classList.toggle("active", b.dataset.screen === name));
  $("screenChats").classList.toggle("hidden", name !== "chats");
  $("screenTemplates").classList.toggle("hidden", name !== "templates");
  if (name === "templates") { loadTemplates().then(renderTemplateList); }
}

/* ---------- polling ---------- */
function startPolling() {
  stopPolling();
  state.pollTimer = setInterval(async () => {
    await loadConversations();
    if (state.activePhone) await loadMessages(state.activePhone);
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
  $("newChatBtn").addEventListener("click", openNewChat);
  $("ncSend").addEventListener("click", sendNewChat);
  $("attachBtn").addEventListener("click", () => showModal("modalMedia"));
  $("detailMediaBtn").addEventListener("click", () => showModal("modalMedia"));
  $("mdSend").addEventListener("click", sendMedia);
  $("simBtn").addEventListener("click", () => showModal("modalSim"));
  $("simSend").addEventListener("click", simulate);
  $("newTemplateBtn").addEventListener("click", () => showModal("modalTemplate"));
  $("tpCreate").addEventListener("click", createTemplate);
  $("detailTemplateBtn").addEventListener("click", openNewChat);
  $("detailToggle").addEventListener("click", () => $("detailPane").classList.toggle("collapsed"));
  document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeModals));
  document.querySelectorAll(".modal").forEach((m) =>
    m.addEventListener("click", (e) => { if (e.target === m) closeModals(); })
  );
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModals(); });
}

init();
