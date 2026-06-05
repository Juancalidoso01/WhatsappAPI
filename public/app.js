"use strict";

const state = {
  conversations: [],
  activePhone: null,
  messagesCache: {},
};

const els = {
  list: document.getElementById("conversationList"),
  search: document.getElementById("searchInput"),
  emptyState: document.getElementById("emptyState"),
  chatView: document.getElementById("chatView"),
  chatName: document.getElementById("chatName"),
  chatPhone: document.getElementById("chatPhone"),
  chatAvatar: document.getElementById("chatAvatar"),
  messages: document.getElementById("messages"),
  composer: document.getElementById("composer"),
  messageInput: document.getElementById("messageInput"),
  connection: document.getElementById("connection"),
  newChatBtn: document.getElementById("newChatBtn"),
  modal: document.getElementById("modal"),
  modalCancel: document.getElementById("modalCancel"),
  modalSend: document.getElementById("modalSend"),
  simPhone: document.getElementById("simPhone"),
  simName: document.getElementById("simName"),
  simText: document.getElementById("simText"),
};

// ---------- Helpers ----------
function initials(name) {
  return (name || "?")
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function tickFor(status) {
  if (!status) return "";
  if (status === "failed") return `<span class="tick failed" title="No enviado">✕</span>`;
  if (status === "pending") return `<span class="tick pending" title="Enviando…">🕓</span>`;
  if (status === "sent") return `<span class="tick sent" title="Enviado">✓</span>`;
  if (status === "delivered") return `<span class="tick sent" title="Entregado">✓✓</span>`;
  if (status === "read") return `<span class="tick sent" title="Leído">✓✓</span>`;
  return "";
}

function showToast(text) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = text;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

// ---------- Rendering ----------
function renderConversations() {
  const q = els.search.value.trim().toLowerCase();
  const filtered = state.conversations.filter(
    (c) =>
      !q ||
      (c.name || "").toLowerCase().includes(q) ||
      c.phone.includes(q)
  );

  els.list.innerHTML = "";
  filtered.forEach((c) => {
    const li = document.createElement("li");
    li.className = "conversation-item" + (c.phone === state.activePhone ? " active" : "");
    li.onclick = () => openConversation(c.phone);

    const preview = c.lastMessage ? c.lastMessage.text || "" : "";
    li.innerHTML = `
      <div class="avatar">${initials(c.name)}</div>
      <div class="conversation-meta">
        <div class="row">
          <span class="conversation-name">${escapeHtml(c.name || c.phone)}</span>
          <span class="conversation-time">${c.lastActivity ? formatTime(c.lastActivity) : ""}</span>
        </div>
        <div class="conversation-preview">${escapeHtml(preview)}</div>
      </div>`;
    els.list.appendChild(li);
  });
}

function renderMessages(phone) {
  const msgs = state.messagesCache[phone] || [];
  els.messages.innerHTML = "";
  msgs.forEach((m) => {
    const div = document.createElement("div");
    const cls = m.direction === "in" ? "in" : m.type === "bot" ? "bot" : "out";
    div.className = "bubble " + cls;
    div.innerHTML = `
      ${escapeHtml(m.text || "")}
      <span class="meta">${formatTime(m.timestamp)} ${m.direction === "out" || m.type === "bot" ? tickFor(m.status) : ""}</span>`;
    els.messages.appendChild(div);
  });
  els.messages.scrollTop = els.messages.scrollHeight;
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ---------- Data ----------
async function loadConversations() {
  const res = await fetch("/api/conversations");
  state.conversations = await res.json();
  renderConversations();
}

async function openConversation(phone) {
  state.activePhone = phone;
  const convo = state.conversations.find((c) => c.phone === phone);
  els.chatName.textContent = (convo && convo.name) || phone;
  els.chatPhone.textContent = "+" + phone;
  els.chatAvatar.textContent = initials((convo && convo.name) || phone);
  els.emptyState.classList.add("hidden");
  els.chatView.classList.remove("hidden");

  const res = await fetch(`/api/conversations/${encodeURIComponent(phone)}/messages`);
  state.messagesCache[phone] = await res.json();
  renderMessages(phone);
  renderConversations();
}

async function sendMessage(text) {
  const phone = state.activePhone;
  if (!phone) return;
  const res = await fetch("/api/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, text }),
  });
  const data = await res.json();
  if (data.warning) showToast(data.warning);
  else if (data.error) showToast("Error al enviar: " + data.error);
}

async function simulateIncoming() {
  const phone = els.simPhone.value.trim();
  const name = els.simName.value.trim();
  const text = els.simText.value.trim();
  if (!phone || !text) {
    showToast("Número y mensaje son obligatorios.");
    return;
  }
  await fetch("/api/simulate-incoming", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, name, text }),
  });
  closeModal();
  els.simText.value = "";
}

// ---------- Real-time (SSE) with polling fallback ----------
// Polling interval is conservative to limit requests against the shared
// Upstash database. Polling pauses while the browser tab is hidden.
const POLL_INTERVAL_MS = 6000;
let pollTimer = null;

async function refreshNow() {
  await loadConversations();
  if (state.activePhone) {
    const res = await fetch(
      `/api/conversations/${encodeURIComponent(state.activePhone)}/messages`
    );
    state.messagesCache[state.activePhone] = await res.json();
    renderMessages(state.activePhone);
  }
}

function startPolling() {
  if (pollTimer) return;
  els.connection.textContent = "actualizando";
  els.connection.className = "status-dot";
  pollTimer = setInterval(() => {
    if (document.hidden) return;
    refreshNow().catch(() => {});
  }, POLL_INTERVAL_MS);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function connectStream() {
  // On serverless (non-localhost) SSE connections time out and churn
  // function invocations, so use polling directly there.
  const isLocal = ["localhost", "127.0.0.1"].includes(location.hostname);
  if (!isLocal) {
    startPolling();
    return;
  }

  let source;
  try {
    source = new EventSource("/api/stream");
  } catch (e) {
    startPolling();
    return;
  }

  source.onopen = () => {
    stopPolling();
    els.connection.textContent = "en línea";
    els.connection.className = "status-dot online";
  };
  source.onerror = () => {
    els.connection.textContent = "modo sin tiempo real";
    els.connection.className = "status-dot offline";
    source.close();
    startPolling();
  };
  source.onmessage = (event) => {
    const payload = JSON.parse(event.data);
    handleIncomingEvent(payload);
  };
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && pollTimer) refreshNow().catch(() => {});
});

function handleIncomingEvent({ phone, name, message }) {
  // Update cache for that conversation
  const cache = state.messagesCache[phone] || (state.messagesCache[phone] = []);
  const existing = cache.find((m) => m.id === message.id);
  if (existing) {
    Object.assign(existing, message);
  } else {
    cache.push(message);
  }

  // Update conversation summary list
  let convo = state.conversations.find((c) => c.phone === phone);
  if (!convo) {
    convo = { phone, name, lastActivity: message.timestamp, lastMessage: message };
    state.conversations.unshift(convo);
  } else {
    if (name) convo.name = name;
    convo.lastActivity = message.timestamp;
    convo.lastMessage = message;
    state.conversations.sort((a, b) => b.lastActivity - a.lastActivity);
  }

  renderConversations();
  if (phone === state.activePhone) renderMessages(phone);
}

// ---------- Modal ----------
function openModal() { els.modal.classList.remove("hidden"); els.simPhone.focus(); }
function closeModal() { els.modal.classList.add("hidden"); }

// ---------- Wire up ----------
els.composer.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = els.messageInput.value.trim();
  if (!text) return;
  els.messageInput.value = "";
  sendMessage(text);
});
els.search.addEventListener("input", renderConversations);
els.newChatBtn.addEventListener("click", openModal);
els.modalCancel.addEventListener("click", closeModal);
els.modalSend.addEventListener("click", simulateIncoming);
els.modal.addEventListener("click", (e) => { if (e.target === els.modal) closeModal(); });

loadConversations();
connectStream();
