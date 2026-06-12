"use strict";

const POLL_CHAT_MS = 3000;
const POLL_CHAT_SSE_MS = 8000;
const POLL_IDLE_MS = 12000;
const POLL_HIDDEN_MS = 20000;
const SOUND_ENABLED_KEY = "pp-notify-sound";
const DAY_MS = 24 * 60 * 60 * 1000;
const t = (key, vars) => (window.I18n ? I18n.t(key, vars) : key);
const localeCode = () => (window.I18n ? I18n.getLocale() : "es");
const localeDateTime = (ms) => {
  const loc = localeCode();
  const tag = loc === "ru" ? "ru" : loc === "en" ? "en-US" : "es";
  return new Date(ms).toLocaleString(tag, { dateStyle: "medium", timeStyle: "short" });
};
const localeActivityDate = (ts) => {
  if (!ts) return "—";
  const tag = localeCode() === "ru" ? "ru" : localeCode() === "en" ? "en-US" : "es";
  return new Date(ts).toLocaleString(tag, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};
const flowStatusLabel = (st) => {
  const key = `flows.status.${(st || "").toUpperCase()}`;
  const lbl = t(key);
  return lbl !== key ? lbl : (st || "—");
};
const flowKindLabel = (k) => {
  const key = `flows.kind.${k}`;
  const lbl = t(key);
  return lbl !== key ? lbl : t("flows.kind.flow");
};
const flowDecisionLabel = (decision) => {
  if (decision === "authorize") return t("flows.decision.authorized");
  if (decision) return t("flows.decision.denied");
  return t("flows.decision.pending");
};
const fsLayoutLabel = (id) => t(`flows.layouts.${id}`) || id;
const FS_I18N_KEY = /^flows\.(studio|defaults|layouts)\.[A-Za-z0-9_.]+$/;

function isUnresolvedFlowI18n(val, expectedKey) {
  if (typeof val !== "string" || !val.trim()) return false;
  if (expectedKey && val === expectedKey) return true;
  return FS_I18N_KEY.test(val.trim());
}

function resolveFlowI18n(val) {
  if (typeof val !== "string" || !val.trim()) return val;
  const key = val.trim();
  if (!FS_I18N_KEY.test(key)) return val;
  const resolved = t(key);
  return resolved !== key ? resolved : val;
}

function repairFlowStudioTranslations() {
  fsState.screens.forEach((scr) => {
    scr.title = resolveFlowI18n(scr.title);
    scr.buttonLabel = resolveFlowI18n(scr.buttonLabel);
    if (scr.heading) scr.heading = resolveFlowI18n(scr.heading);
    if (scr.body) scr.body = resolveFlowI18n(scr.body);
    (scr.blocks || []).forEach((b) => {
      if (b.text) b.text = resolveFlowI18n(b.text);
      if (b.altText) b.altText = resolveFlowI18n(b.altText);
    });
    (scr.fields || []).forEach((f) => {
      if (f.label) f.label = resolveFlowI18n(f.label);
    });
  });
}

function syncFlowStudioFormDefaults() {
  const cta = $("fsCta");
  if (cta && (isUnresolvedFlowI18n(cta.value, "flows.studio.defaultCta")
    || ["Abrir formulario", "Open form", "Открыть форму"].includes(cta.value.trim()))) {
    cta.value = t("flows.studio.defaultCta");
  }
  const chat = $("fsChatBody");
  if (chat && (isUnresolvedFlowI18n(chat.value, "flows.studio.defaultChatBody") || !chat.value.trim())) {
    chat.value = t("flows.studio.defaultChatBody");
  }
  const btn = $("fsButton");
  if (btn && (isUnresolvedFlowI18n(btn.value)
    || ["Continuar", "Continue", "Продолжить"].includes(btn.value.trim()))) {
    btn.value = t("flows.studio.continue");
  }
}

const LEAD_TYPE_VALUES = ["", "prospecto", "cliente", "lead_caliente", "lead_frio", "soporte", "otro"];
const LEAD_USER_VALUES = ["", "titular", "beneficiario", "representante", "empleado", "otro"];

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
  flowSendProfile: null,
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
  notifications: [],
  notifPanelOpen: false,
  notifBootstrapped: false,
  convSnapshotReady: false,
  knownEventIds: null,
  readThrough: {},
  soundEnabled: true,
  replyTo: null,
  eventsBound: false,
  sseConnected: false,
  sseSource: null,
};

/* ---------- tiny helpers ---------- */
const $ = (id) => document.getElementById(id);
const fetchOpts = (opts = {}) => ({ credentials: "include", ...opts });

const api = async (url, opts) => {
  const res = await fetch(url, fetchOpts(opts));
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.code === "AUTH_REQUIRED" && !String(url).includes("/api/auth/")) {
    showLoginGate(data.error);
  }
  return data;
};
const post = (url, body) =>
  api(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const patch = (url, body) =>
  api(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const put = (url, body) =>
  api(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const del = (url) => api(url, { method: "DELETE" });
const postForm = (url, formData) => api(url, { method: "POST", body: formData });

function postCsv(url, formData) {
  return fetch(url, fetchOpts({ method: "POST", body: formData })).then((res) => res.json().catch(() => ({})));
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
  if (d < 60000) return t("common.now");
  if (d < 3600000) return Math.floor(d / 60000) + "m";
  if (d < DAY_MS) return Math.floor(d / 3600000) + "h";
  const loc = I18n.getLocale();
  return new Date(ts).toLocaleDateString(loc === "ru" ? "ru" : loc === "en" ? "en" : "es", { day: "2-digit", month: "2-digit" });
}
let toastTimer;
function toast(msg, kind = "") {
  const el = $("toast");
  el.textContent = msg;
  el.className = "toast " + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 3200);
}

const READ_THROUGH_KEY = "pp_read_through";

function phoneKey(phone) {
  return String(phone || "").replace(/\D/g, "");
}

function loadReadThrough() {
  try {
    const raw = JSON.parse(localStorage.getItem(READ_THROUGH_KEY) || "{}");
    const out = {};
    Object.entries(raw).forEach(([k, v]) => {
      const pk = phoneKey(k);
      if (!pk) return;
      out[pk] = Math.max(out[pk] || 0, Number(v) || 0);
    });
    return out;
  } catch (_) {
    return {};
  }
}

function saveReadThrough() {
  try {
    localStorage.setItem(READ_THROUGH_KEY, JSON.stringify(state.readThrough));
  } catch (_) { /* ignore */ }
}

function ensureKnownEventIds() {
  if (!state.knownEventIds) state.knownEventIds = new Set();
}

function conversationUnread(c) {
  const last = c && c.lastMessage;
  if (!last || last.direction !== "in") return false;
  const seen = state.readThrough[phoneKey(c.phone)] || 0;
  return last.timestamp > seen;
}

function totalUnreadChats() {
  return state.conversations.filter(conversationUnread).length;
}

function markConversationRead(phone, minTimestamp = 0) {
  const pk = phoneKey(phone);
  if (!pk) return;
  const c = state.conversations.find((x) => phoneKey(x.phone) === pk);
  let ts = Math.max(Number(minTimestamp) || 0, Date.now());
  if (c && c.lastMessage && c.lastMessage.timestamp) {
    ts = Math.max(ts, c.lastMessage.timestamp);
  }
  if (phoneKey(state.activePhone) === pk && state.messages.length) {
    for (const m of state.messages) {
      if (m.timestamp) ts = Math.max(ts, m.timestamp);
    }
  }
  state.readThrough[pk] = Math.max(state.readThrough[pk] || 0, ts);
  saveReadThrough();
  updateUnreadBadges();
}

function notifLabel(ev) {
  if (!ev) return { title: "", body: "", icon: "•", tpl: false };
  if (ev.type === "chat") {
    const meta = ev.meta || {};
    return {
      title: meta.name || meta.phone || t("notifications.newMessage"),
      body: meta.preview || "",
      icon: initials(meta.name || meta.phone),
      tpl: false,
    };
  }
  if (ev.type === "template") {
    const meta = ev.meta || {};
    const st = String(meta.status || "").toLowerCase();
    const titleKey = `notifications.template.${st}`;
    const title = t(titleKey);
    const body = meta.reason
      ? t("notifications.templateBodyReason", {
        name: meta.name,
        language: meta.language,
        reason: meta.reason,
      })
      : t("notifications.templateBody", { name: meta.name, language: meta.language });
    return {
      title: title !== titleKey ? title : meta.status,
      body,
      icon: "📋",
      tpl: true,
      status: meta.status,
    };
  }
  return { title: "", body: "", icon: "•", tpl: false };
}

let notifyCardTimer;
function showNotifyCard({ title, body, onClick, kind = "" }) {
  let el = $("notifyCard");
  if (!el) {
    el = document.createElement("div");
    el.id = "notifyCard";
    el.className = "notify-card hidden";
    document.body.appendChild(el);
  }
  el.innerHTML = `<strong>${escapeHtml(title)}</strong><p>${escapeHtml(body)}</p>`;
  el.className = `notify-card${kind ? ` ${kind}` : ""}`;
  el.classList.remove("hidden");
  clearTimeout(notifyCardTimer);
  const close = () => el.classList.add("hidden");
  el.onclick = () => { close(); onClick?.(); };
  notifyCardTimer = setTimeout(close, 6500);
}

let notifyAudioCtx = null;

function loadSoundPref() {
  try {
    const raw = localStorage.getItem(SOUND_ENABLED_KEY);
    return raw !== "0";
  } catch (_) {
    return true;
  }
}

function saveSoundPref() {
  try {
    localStorage.setItem(SOUND_ENABLED_KEY, state.soundEnabled ? "1" : "0");
  } catch (_) { /* ignore */ }
}

function ensureNotifyAudio() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!notifyAudioCtx) notifyAudioCtx = new Ctx();
  if (notifyAudioCtx.state === "suspended") notifyAudioCtx.resume().catch(() => {});
  return notifyAudioCtx;
}

function playChatNotifySound() {
  if (!state.soundEnabled) return;
  const ctx = ensureNotifyAudio();
  if (!ctx) return;
  try {
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const t0 = ctx.currentTime;
    [
      { f: 587.33, start: 0, dur: 0.11 },
      { f: 739.99, start: 0.09, dur: 0.13 },
      { f: 880, start: 0.2, dur: 0.18 },
    ].forEach(({ f, start, dur }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(f, t0 + start);
      gain.gain.setValueAtTime(0.0001, t0 + start);
      gain.gain.exponentialRampToValueAtTime(0.34, t0 + start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0 + start);
      osc.stop(t0 + start + dur + 0.03);
    });
  } catch (_) { /* ignore */ }
}

function playTemplateNotifySound() {
  if (!state.soundEnabled) return;
  const ctx = ensureNotifyAudio();
  if (!ctx) return;
  try {
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const t0 = ctx.currentTime;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.22, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.4);
    [[784, 0], [622, 0.12]].forEach(([freq, offset]) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, t0 + offset);
      osc.connect(gain);
      osc.start(t0 + offset);
      osc.stop(t0 + offset + 0.2);
    });
  } catch (_) { /* ignore */ }
}

function alertChatInbound(title, body, onClick, phone) {
  const viewingChat = phone
    && phoneKey(state.activePhone) === phoneKey(phone)
    && state.currentScreen === "chats";
  if (!viewingChat) playChatNotifySound();
  showNotifyCard({ title, body, onClick });
  if (document.hidden) tryBrowserNotify(title, body, onClick);
}

function alertInBackground(title, body, onClick, kind = "template") {
  if (kind === "chat") {
    alertChatInbound(title, body, onClick);
    return;
  }
  if (document.hidden) {
    playTemplateNotifySound();
    tryBrowserNotify(title, body, onClick);
  }
}

function tryBrowserNotify(title, body, onClick) {
  if (!document.hidden || typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;
  try {
    const n = new Notification(title, { body, icon: "/logo.png" });
    n.onclick = () => {
      window.focus();
      onClick?.();
      n.close();
    };
  } catch (_) { /* ignore */ }
}

function updateSoundBtn() {
  const btn = $("notifSoundBtn");
  if (!btn) return;
  btn.textContent = state.soundEnabled
    ? t("notifications.soundOn")
    : t("notifications.soundOff");
  btn.setAttribute("aria-pressed", state.soundEnabled ? "true" : "false");
}

function updateNotifBadges(count) {
  document.querySelectorAll("[data-notif-badge]").forEach((el) => {
    if (count > 0) {
      el.textContent = count > 99 ? "99+" : String(count);
      el.classList.remove("hidden");
    } else {
      el.classList.add("hidden");
    }
  });
}

function updateUnreadBadges() {
  const chats = totalUnreadChats();
  const navBadge = $("navChatsBadge");
  if (navBadge) {
    if (chats > 0) {
      navBadge.textContent = chats > 99 ? "99+" : String(chats);
      navBadge.classList.remove("hidden");
    } else {
      navBadge.classList.add("hidden");
    }
  }
}

const notifiedInboundKeys = new Set();

function inboundNotifyKey(c) {
  const lm = c.lastMessage || {};
  return lm.id || `${c.phone}-${lm.timestamp || 0}`;
}

function shouldNotifyInbound(c) {
  const key = inboundNotifyKey(c);
  if (!key || notifiedInboundKeys.has(key)) return false;
  notifiedInboundKeys.add(key);
  if (notifiedInboundKeys.size > 200) {
    notifiedInboundKeys.delete(notifiedInboundKeys.values().next().value);
  }
  return true;
}

function detectInboundChanges(prev, next) {
  const prevMap = new Map();
  (prev || []).forEach((c) => {
    const lm = c.lastMessage;
    prevMap.set(c.phone, lm ? { ts: lm.timestamp || 0, id: lm.id || "" } : { ts: 0, id: "" });
  });
  const out = [];
  (next || []).forEach((c) => {
    const lm = c.lastMessage;
    if (!lm || lm.direction !== "in") return;
    const p = prevMap.get(c.phone) || { ts: 0, id: "" };
    if (lm.timestamp > p.ts || (lm.id && lm.id !== p.id)) out.push(c);
  });
  return out;
}

function showInboundAlert(c) {
  if (!shouldNotifyInbound(c)) return;
  const last = c.lastMessage || {};
  const title = c.name || c.phone;
  const body = previewText(last) || t("notifications.newMessage");
  const open = () => {
    switchScreen("chats");
    openConversation(c.phone, c.name, null, {
      minTimestamp: (c.lastMessage && c.lastMessage.timestamp) || Date.now(),
    });
  };
  alertChatInbound(title, body, open, c.phone);
}

function handleLiveNotification(ev) {
  const { title, body, status } = notifLabel(ev);
  if (ev.type === "chat") {
    const phone = ev.meta && ev.meta.phone;
    const name = ev.meta && ev.meta.name;
    const isActive = phoneKey(state.activePhone) === phoneKey(phone) && state.currentScreen === "chats";
    if (isActive) {
      loadMessages(phone).then(() => {
        markConversationRead(phone, ev.at);
        renderConversations();
      });
      markChatNotificationsRead(phone);
      return;
    }
    const pseudo = {
      phone,
      name,
      lastMessage: {
        id: ev.meta && ev.meta.messageId,
        timestamp: ev.at,
        direction: "in",
        text: ev.meta && ev.meta.preview,
      },
    };
    if (!shouldNotifyInbound(pseudo)) return;
    const open = () => {
      switchScreen("chats");
      openConversation(phone, name, null, { minTimestamp: ev.at });
    };
    alertChatInbound(title, body, open, phone);
    updateUnreadBadges();
    return;
  }
  if (ev.type === "template") {
    const tplName = ev.meta && ev.meta.name;
    const open = () => {
      state.pendingTemplateHighlight = tplName || null;
      if (state.currentScreen === "templates") refreshTemplatesScreen({ highlightName: tplName });
      else switchScreen("templates");
    };
    const kind = status === "APPROVED" || status === "REINSTATED" ? "ok" : status === "REJECTED" ? "error" : "";
    showNotifyCard({ title, body, onClick: open, kind });
    alertInBackground(title, body, open, "template");
    if (!document.hidden) playTemplateNotifySound();
    if (state.currentScreen === "templates") {
      refreshTemplatesScreen({ highlightName: tplName });
    } else {
      Promise.all([loadTemplates(), loadTemplatePresets()]).catch(() => {});
    }
  }
}

async function loadNotifications() {
  try {
    const res = await api("/api/portal/notifications");
    if (!res || !res.ok) return;
    const events = res.events || [];
    ensureKnownEventIds();
    if (!state.notifBootstrapped) {
      events.forEach((e) => state.knownEventIds.add(e.id));
      state.notifBootstrapped = true;
    } else {
      events
        .filter((e) => !state.knownEventIds.has(e.id))
        .sort((a, b) => a.at - b.at)
        .forEach((e) => {
          state.knownEventIds.add(e.id);
          handleLiveNotification(e);
        });
    }
    state.notifications = events;
    updateNotifBadges(res.unread || 0);
    if (state.notifPanelOpen) renderNotifPanel();
  } catch (_) { /* polling must not break chats */ }
}

function applyNotifReadState(patch) {
  const { ids, chatPhone, type, all, unread } = patch || {};
  const idSet = ids && ids.length ? new Set(ids) : null;
  state.notifications.forEach((e) => {
    if (all) {
      e.read = true;
      return;
    }
    if (idSet && idSet.has(e.id)) e.read = true;
    if (chatPhone && e.type === "chat" && e.meta && phoneKey(e.meta.phone) === phoneKey(chatPhone)) {
      e.read = true;
    }
    if (type && e.type === type) e.read = true;
  });
  const count = unread != null ? unread : state.notifications.filter((e) => !e.read).length;
  updateNotifBadges(count);
  if (state.notifPanelOpen) renderNotifPanel();
}

async function markChatNotificationsRead(phone) {
  if (!phone) return;
  const res = await post("/api/portal/notifications/read", { chatPhone: String(phone) });
  if (!res || !res.ok) return;
  applyNotifReadState({
    ids: res.ids,
    chatPhone: String(phone),
    unread: res.unread,
  });
}

async function markTemplateNotificationsRead() {
  const res = await post("/api/portal/notifications/read", { type: "template" });
  if (!res || !res.ok) return;
  applyNotifReadState({ type: "template", ids: res.ids, unread: res.unread });
}

function sortNotifItems(items) {
  return [...items].sort((a, b) => {
    if (Boolean(a.read) !== Boolean(b.read)) return a.read ? 1 : -1;
    return (b.at || 0) - (a.at || 0);
  });
}

function renderNotifPanel() {
  const box = $("notifList");
  if (!box) return;
  const items = sortNotifItems(state.notifications || []);
  const unreadItems = items.filter((e) => !e.read);
  if (!items.length) {
    box.innerHTML = `<p class="muted" style="padding:12px">${escapeHtml(t("notifications.empty"))}</p>`;
    return;
  }
  let html = "";
  if (unreadItems.length && items.length > unreadItems.length) {
    html += `<p class="app-notif-section muted sm">${escapeHtml(t("notifications.sectionUnread"))}</p>`;
  }
  html += items.map((ev) => {
    const { title, body, icon, tpl } = notifLabel(ev);
    const unread = !ev.read;
    return `<button type="button" class="app-notif-item${unread ? " unread" : " read"}" data-notif-id="${escapeHtml(ev.id)}" data-notif-type="${escapeHtml(ev.type)}">
      <span class="app-notif-avatar${tpl ? " tpl" : ""}">${tpl ? icon : escapeHtml(icon)}</span>
      <span class="app-notif-body">
        <p class="app-notif-title">${escapeHtml(title)}</p>
        <p class="app-notif-text">${escapeHtml(body)}</p>
        <span class="app-notif-time">${escapeHtml(timeAgo(ev.at))}</span>
      </span>
    </button>`;
  }).join("");
  if (unreadItems.length && items.length > unreadItems.length) {
    const readIdx = html.indexOf('class="app-notif-item read"');
    if (readIdx > -1) {
      const label = `<p class="app-notif-section muted sm">${escapeHtml(t("notifications.sectionRead"))}</p>`;
      html = html.slice(0, readIdx) + label + html.slice(readIdx);
    }
  }
  box.innerHTML = html;
  box.querySelectorAll(".app-notif-item").forEach((btn) => {
    btn.addEventListener("click", () => handleNotifItemClick(btn.dataset.notifId, btn.dataset.notifType));
  });
}

async function handleNotifItemClick(id, type) {
  const ev = state.notifications.find((e) => e.id === id);
  if (!ev) return;
  if (type === "chat" && ev.meta && ev.meta.phone) {
    const res = await post("/api/portal/notifications/read", { chatPhone: String(ev.meta.phone) });
    applyNotifReadState({ chatPhone: String(ev.meta.phone), unread: res && res.unread });
  } else {
    const res = await post("/api/portal/notifications/read", { ids: [id] });
    applyNotifReadState({ ids: [id], unread: res && res.unread });
  }
  toggleNotifPanel(false);
  if (type === "chat" && ev.meta) {
    switchScreen("chats");
    await openConversation(ev.meta.phone, ev.meta.name, null, { minTimestamp: ev.at });
    return;
  }
  if (type === "template") {
    state.pendingTemplateHighlight = (ev.meta && ev.meta.name) || null;
    if (state.currentScreen !== "templates") switchScreen("templates");
    else refreshTemplatesScreen({ highlightName: state.pendingTemplateHighlight });
    markTemplateNotificationsRead();
  }
}

function toggleNotifPanel(open) {
  const panel = $("notifPanel");
  const btn = $("notifBtn");
  const btnMobile = $("notifBtnMobile");
  if (!panel) return;
  const next = open != null ? open : panel.classList.contains("hidden");
  state.notifPanelOpen = next;
  panel.classList.toggle("hidden", !next);
  if (btn) btn.setAttribute("aria-expanded", next ? "true" : "false");
  if (btnMobile) btnMobile.setAttribute("aria-expanded", next ? "true" : "false");
  if (next) {
    renderNotifPanel();
    loadNotifications();
  }
}

async function markAllNotificationsRead() {
  const res = await post("/api/portal/notifications/read", { all: true });
  applyNotifReadState({ all: true, unread: res && res.unread != null ? res.unread : 0 });
}

function toggleNotifySound() {
  state.soundEnabled = !state.soundEnabled;
  saveSoundPref();
  updateSoundBtn();
  if (state.soundEnabled) {
    ensureNotifyAudio();
    playChatNotifySound();
  }
}

async function requestBrowserNotifications() {
  if (typeof Notification === "undefined") return;
  const btn = $("notifBrowserBtn");
  if (Notification.permission === "granted") {
    if (btn) btn.textContent = t("notifications.browserEnabled");
    return;
  }
  if (Notification.permission === "denied") {
    if (btn) btn.textContent = t("notifications.browserDenied");
    return;
  }
  const perm = await Notification.requestPermission();
  if (btn) {
    btn.textContent = perm === "granted"
      ? t("notifications.browserEnabled")
      : perm === "denied"
        ? t("notifications.browserDenied")
        : t("notifications.enableBrowser");
  }
}

/* ---------- dashboard auth ---------- */
function showLoginGate(message) {
  const gate = $("loginGate");
  const app = document.querySelector(".app");
  if (!gate) return;
  gate.classList.remove("hidden");
  if (app) app.classList.add("hidden");
  const err = $("loginError");
  if (err) {
    err.textContent = message || "";
    err.classList.toggle("hidden", !message);
  }
  $("loginPassword")?.focus();
}

function hideLoginGate() {
  $("loginGate")?.classList.add("hidden");
  document.querySelector(".app")?.classList.remove("hidden");
  const err = $("loginError");
  if (err) {
    err.textContent = "";
    err.classList.add("hidden");
  }
}

async function submitDashboardLogin() {
  const password = ($("loginPassword") || {}).value || "";
  const btn = $("loginSubmitBtn");
  if (btn) btn.disabled = true;
  const res = await post("/api/auth/login", { password });
  if (btn) btn.disabled = false;
  if (!res.ok) {
    const err = $("loginError");
    if (err) {
      err.textContent = res.error || t("auth.loginFailed");
      err.classList.remove("hidden");
    }
    return;
  }
  hideLoginGate();
  await bootDashboard();
}

async function logoutDashboard() {
  await api("/api/auth/logout", { method: "POST" });
  showLoginGate();
  stopPolling();
  stopRealtimeStream();
  stopBulkPolling();
}

/* ---------- init ---------- */
async function init() {
  state.readThrough = loadReadThrough();
  state.soundEnabled = loadSoundPref();
  ensureKnownEventIds();
  try {
    state.config = await api("/api/config");
  } catch (_) {
    state.config = state.config || {};
  }
  await initI18n();

  const session = await api("/api/auth/session");
  if (session.authRequired && !session.authenticated) {
    showLoginGate();
    if (window.I18n) I18n.applyDom();
    bindLoginEvents();
    return;
  }
  await bootDashboard();
}

async function bootDashboard() {
  applyBranding();
  initSidebar();
  initLeadFormOptions();
  if (!state.eventsBound) {
    bindEvents();
    state.eventsBound = true;
  }
  bindLoginEvents();
  loadWorkspace().catch(() => {});
  await loadConversations();
  await loadNotifications();
  startPolling();
  startRealtimeStream();
  requestBrowserNotifications();
  updateSoundBtn();
  updateLogoutVisibility();
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      loadConversations().then(() => loadNotifications());
      if (state.activePhone) loadMessages(state.activePhone);
    }
    startPolling();
  });
}

function updateLogoutVisibility() {
  const btn = $("wsLogoutBtn");
  if (!btn) return;
  const show = Boolean(state.config && state.config.authRequired);
  btn.classList.toggle("hidden", !show);
}

function bindLoginEvents() {
  const form = $("loginForm");
  if (form && !form.dataset.bound) {
    form.dataset.bound = "1";
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      submitDashboardLogin();
    });
  }
  const logout = $("wsLogoutBtn");
  if (logout && !logout.dataset.bound) {
    logout.dataset.bound = "1";
    logout.addEventListener("click", logoutDashboard);
  }
}

async function initI18n() {
  if (!window.I18n) return;
  const loc = I18n.resolveInitial(
    localStorage.getItem("pp-locale"),
    state.config.workspace && state.config.workspace.portalLanguage
  );
  await I18n.bootstrap(loc);
  await I18n.ensureScreen("chats", loc);
  const sel = $("wsPortalLang");
  if (sel) sel.value = loc;
  document.addEventListener("localechange", onLocaleChange);
}

async function onLocaleChange() {
  initLeadFormOptions();
  if (state.activePhone && state.conversationDetail) {
    renderDetailPanel();
    updateWindow();
  }
  renderConversations();
  if (state.currentScreen === "templates") {
    renderTemplatesScreen();
    renderTpMetaRules();
    updateTplSyncHint();
    if (state.variableCatalog.length) loadTplVariableCatalog();
    if (tpState.validation && ($("tpBody") || {}).value.trim()) renderTpValidation(tpState.validation);
  }
  if (state.currentScreen === "billing" && state.billingLedger) {
    renderBillingLedger(state.billingLedger);
    renderBillingFlowRows(state.billingLedger);
  }
  if (state.currentScreen === "bulk") {
    renderLineHealth();
    renderCampaignList();
    if (state.activeCampaignId) refreshCampaignDetail();
  }
  if (state.currentScreen === "flows") {
    if (window.I18n) I18n.applyDom($("screenFlows"));
    loadFlowCapability();
    renderFlowsList();
    if (state.activeFlowId) loadFlowDetail(state.activeFlowId);
    if (!$("flowsPanelCrear")?.classList.contains("hidden")) {
      repairFlowStudioTranslations();
      syncFlowStudioFormDefaults();
      syncFsFromAllPreviews();
      renderFlowStudio();
    }
    if (!$("flowsPanelActividad")?.classList.contains("hidden")) loadFlowActivity();
    if (!$("flowsPanelProbar")?.classList.contains("hidden")) {
      updatePayAuthFlowPreview();
      loadPaymentAuthPanel();
    }
    renderFlowUseCaseGrid();
  }
  if (state.currentScreen === "integration" && window.IntegrationApiModule) {
    IntegrationApiModule.renderGuide($("screenIntegration"));
  }
  if (state.workspace) fillWorkspaceForms(state.workspace);
  setWorkspaceTab(state.workspaceTab || "profile");
  updateSidebarCollapseBtn();
}

function applyBranding() {
  const ws = state.config.workspace || {};
  const name = ws.displayName || state.config.brandName || "Punto Pago";
  document.title = name + " · " + t("common.brandSub");
  const dot = $("connDot");
  if (dot) {
    dot.className = "conn-dot " + (state.config.persistent ? "online" : "offline");
    dot.title = state.config.persistent ? t("common.persistentOn") : t("common.persistentOff");
  }
  if ($("sidebarBrandName")) $("sidebarBrandName").textContent = name;
  updateWorkspaceHubPreview(name, ws.hasProfilePhoto);
  updateMetaTemplatesLink();
}

function updateMetaTemplatesLink() {
  const link = $("tplMetaManagerLink");
  if (!link) return;
  const url = (state.config && state.config.metaTemplatesUrl)
    || "https://business.facebook.com/latest/whatsapp_manager/message_templates";
  link.href = url;
}

function avatarSrc(hasPhoto) {
  return hasPhoto ? `/api/workspace/avatar?t=${Date.now()}` : "/logo.png";
}

function updateWorkspaceHubPreview(name, hasPhoto) {
  const portal = $("wsPortalPhoto");
  const src = avatarSrc(hasPhoto);
  const status = state.config.persistent ? t("common.online") : t("common.memory");
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
    const prev = state.conversations;
    const data = await api("/api/conversations");
    if (!Array.isArray(data)) return;
    if (state.convSnapshotReady) {
      const inbound = detectInboundChanges(prev, data);
      for (const c of inbound) {
        if (phoneKey(state.activePhone) === phoneKey(c.phone) && state.currentScreen === "chats") {
          await loadMessages(c.phone);
        } else {
          showInboundAlert(c);
        }
      }
    } else {
      state.convSnapshotReady = true;
    }
    state.conversations = data;
    renderConversations();
    updateUnreadBadges();
  } catch (_) {}
}

function renderConversations() {
  const list = $("conversationList");
  if (!list) return;
  const q = state.filter.toLowerCase();
  const items = state.conversations.filter(
    (c) => !q || String(c.name).toLowerCase().includes(q) || String(c.phone).includes(q)
  );
  if (!items.length) {
    list.innerHTML = `<li class="muted" style="padding:24px;text-align:center">${escapeHtml(t("chats.emptyList"))}</li>`;
    return;
  }
  list.innerHTML = items
    .map((c) => {
      const last = c.lastMessage || {};
      const prefix = last.direction === "out" ? t("common.you") + ": " : "";
      const unread = conversationUnread(c);
      return `<li class="conv${unread ? " unread" : ""}${phoneKey(c.phone) === phoneKey(state.activePhone) ? " active" : ""}" data-phone="${escapeHtml(c.phone)}" data-name="${escapeHtml(c.name)}">
        <div class="avatar">${escapeHtml(initials(c.name))}</div>
        <div class="conv-body">
          <div class="conv-top">
            <span class="conv-name">${escapeHtml(c.name)}</span>
            <span class="conv-time">${timeAgo(c.lastActivity)}</span>
          </div>
          <div class="conv-last">${escapeHtml(prefix + previewText(last))}</div>
        </div>
        ${unread ? '<span class="conv-unread-dot" aria-hidden="true"></span>' : ""}
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
  clearReplyTo();
  $("emptyState").classList.remove("hidden");
  $("chatView").classList.add("hidden");
  const chats = document.querySelector("#screenChats");
  if (chats) chats.classList.remove("show-chat");
  setDetailPaneOpen(false);
  renderConversations();
}

async function openConversation(phone, name, highlightMessageId = null, opts = {}) {
  state.activePhone = phoneKey(phone) || String(phone);
  state.highlightMessageId = highlightMessageId || null;
  $("emptyState").classList.add("hidden");
  $("chatView").classList.remove("hidden");
  $("chatName").textContent = name;
  $("chatPhone").textContent = "+" + state.activePhone;
  $("chatAvatar").textContent = initials(name);
  $("detailName").textContent = name;
  $("detailPhone").textContent = "+" + state.activePhone;
  $("detailAvatar").textContent = initials(name);
  document.querySelector("#screenChats").classList.add("show-chat");
  await Promise.all([
    loadConversations(),
    loadMessages(state.activePhone),
    loadConversationDetail(state.activePhone),
  ]);
  markConversationRead(state.activePhone, opts.minTimestamp);
  markChatNotificationsRead(state.activePhone);
  markWhatsAppRead(state.activePhone);
  renderConversations();
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
      if (phoneKey(phone) === phoneKey(state.activePhone) && state.currentScreen === "chats") {
        markConversationRead(phone);
        markChatNotificationsRead(phone);
        markWhatsAppRead(phone);
        renderConversations();
      }
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
  text: "modals.msgTypes.text",
  image: "modals.msgTypes.image",
  audio: "modals.msgTypes.audio",
  video: "modals.msgTypes.video",
  document: "modals.msgTypes.document",
  template: "modals.msgTypes.template",
  sticker: "modals.msgTypes.sticker",
  interactive: "modals.msgTypes.interactive",
  location: "modals.msgTypes.location",
  contacts: "modals.msgTypes.contacts",
  reaction: "modals.msgTypes.reaction",
};

function msgTypeLabel(type) {
  const key = TYPE_LABELS[type];
  return key ? t(key) : type;
}

const DEFAULT_LEAD_OPTIONS = {
  types: LEAD_TYPE_VALUES.map((v) => ({ value: v, label: v })),
  userTypes: LEAD_USER_VALUES.map((v) => ({ value: v, label: v })),
};

function initLeadFormOptions() {
  const typeSel = $("leadType");
  const userSel = $("leadUserType");
  if (typeSel) {
    const cur = typeSel.value;
    typeSel.innerHTML = LEAD_TYPE_VALUES.map((v) =>
      `<option value="${escapeHtml(v)}">${escapeHtml(t("detail.types." + v))}</option>`
    ).join("");
    if (cur) typeSel.value = cur;
  }
  if (userSel) {
    const cur = userSel.value;
    userSel.innerHTML = LEAD_USER_VALUES.map((v) =>
      `<option value="${escapeHtml(v)}">${escapeHtml(t("detail.userTypes." + v))}</option>`
    ).join("");
    if (cur) userSel.value = cur;
  }
}

function renderDetailActivityKv(lead) {
  const box = $("detailActivityKv");
  if (!box || !lead) return;
  const r = lead.readonly || {};
  const rows = [
    [t("detail.activity.whatsapp"), r.whatsappNumber || "—"],
    [t("detail.activity.firstSeen"), r.firstSeenLabel || "—"],
    [t("detail.activity.lastSeen"), r.lastSeenLabel || "—"],
    [t("detail.activity.lastContacted"), r.lastContactedLabel || "—"],
    [t("detail.activity.lastHeardFrom"), r.lastHeardFromLabel || "—"],
  ];
  box.innerHTML = rows.map(([k, v]) =>
    `<div class="detail-kv-row"><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`
  ).join("");
}

function renderDetailAndroidKv(lead) {
  const box = $("detailAndroidKv");
  if (!box || !lead) return;
  const na = t("detail.androidNa");
  const rows = [
    [t("detail.android.lastSeen"), na],
    [t("detail.android.sessions"), na],
    [t("detail.android.appVersion"), na],
    [t("detail.android.device"), na],
    [t("detail.android.osVersion"), na],
    [t("detail.android.sdkVersion"), na],
  ];
  box.innerHTML = rows.map(([k, v]) =>
    `<div class="detail-kv-row"><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`
  ).join("");
}

function renderDetailLeadForm(lead) {
  if (!lead) return;
  initLeadFormOptions();
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
    .map(([typeKey, n]) => `<div class="detail-stat"><span>${escapeHtml(msgTypeLabel(typeKey))}</span><span>${n}</span></div>`)
    .join("");
  $("detailStats").innerHTML = `
    <div class="detail-stat"><span>${escapeHtml(t("chats.statsTotal"))}</span><span>${stats.total || 0}</span></div>
    <div class="detail-stat"><span>${escapeHtml(t("chats.statsIn"))}</span><span>${stats.in || 0}</span></div>
    <div class="detail-stat"><span>${escapeHtml(t("chats.statsOut"))}</span><span>${stats.out || 0}</span></div>
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
  if (m.type === "reaction") return m.reactionEmoji ? `${m.reactionEmoji}` : t("chats.reaction");
  if (m.text) return m.text;
  if (m.type === "image") return "[imagen]";
  if (m.type === "audio") return m.voice ? "[nota de voz]" : "[audio]";
  if (m.type === "video") return "[video]";
  if (m.type === "document") return "[documento]";
  if (m.type === "sticker") return "[sticker]";
  if (m.type === "location") return m.location?.name || t("chats.location");
  if (m.type === "contacts") return t("chats.contact");
  return "";
}

function messageQuotePreview(m) {
  if (!m) return "";
  const p = previewText(m);
  return p || msgTypeLabel(m.type);
}

function isWaMessageId(id) {
  return id && String(id).startsWith("wamid.");
}

async function markWhatsAppRead(phone) {
  if (!phone) return;
  try {
    await post(`/api/conversations/${encodeURIComponent(phone)}/mark-read`, {});
  } catch (_) { /* non-blocking */ }
}

function isMessagingWindowOpen() {
  const detail = state.conversationDetail;
  if (detail && detail.windowExpiresAt) {
    return Date.now() < detail.windowExpiresAt * 1000;
  }
  const last = lastInboundTs();
  return Boolean(last && Date.now() - last < DAY_MS);
}

function setReplyTo(m) {
  if (!m || !isWaMessageId(m.id)) {
    toast(t("chats.replyUnavailable"), "error");
    return;
  }
  state.replyTo = { id: m.id, preview: messageQuotePreview(m) };
  syncReplyBar();
  $("messageInput")?.focus();
}

function clearReplyTo() {
  state.replyTo = null;
  syncReplyBar();
}

function syncReplyBar() {
  const bar = $("replyBar");
  const preview = $("replyPreview");
  if (!bar) return;
  if (!state.replyTo) {
    bar.classList.add("hidden");
    if (preview) preview.textContent = "";
    return;
  }
  bar.classList.remove("hidden");
  if (preview) preview.textContent = state.replyTo.preview || "";
}

function syncComposerState() {
  const open = isMessagingWindowOpen();
  const input = $("messageInput");
  const attach = $("attachBtn");
  const composer = $("composer");
  const sendBtn = composer?.querySelector(".send-btn");
  if (input) {
    input.disabled = !open;
    input.placeholder = open ? t("chats.writePlaceholder") : t("chats.writeClosedPlaceholder");
  }
  if (attach) attach.disabled = !open;
  if (sendBtn) sendBtn.disabled = !open;
  composer?.classList.toggle("composer-closed", !open);
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
  if (m.type === "sticker" && src) {
    return `<img class="msg-sticker" src="${escapeHtml(src)}" alt="Sticker" loading="lazy" />`;
  }
  if (!src) return "";
  if (m.type === "image" || m.type === "sticker") {
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

function renderLocationBlock(m) {
  const loc = m.location;
  if (!loc || loc.latitude == null || loc.longitude == null) return "";
  const label = [loc.name, loc.address].filter(Boolean).join(" · ")
    || `${loc.latitude}, ${loc.longitude}`;
  const mapsUrl = `https://www.google.com/maps?q=${encodeURIComponent(loc.latitude)},${encodeURIComponent(loc.longitude)}`;
  return `<a class="msg-location" href="${escapeHtml(mapsUrl)}" target="_blank" rel="noopener">
    <span class="msg-location-pin">📍</span>
    <span>${escapeHtml(label)}</span>
  </a>`;
}

function renderContactsBlock(m) {
  const list = m.contacts;
  if (!Array.isArray(list) || !list.length) return "";
  return list.map((c) => {
    const phone = (c.phones && c.phones[0]) || "";
    return `<div class="msg-contact">
      <strong>${escapeHtml(c.name || t("chats.contact"))}</strong>
      ${phone ? `<span class="muted sm">${escapeHtml(phone)}</span>` : ""}
    </div>`;
  }).join("");
}

function renderQuoteBlock(m) {
  const refId = m.replyTo && (m.replyTo.messageId || m.replyTo);
  if (!refId) return "";
  const ref = state.messages.find((x) => x.id === refId);
  const preview = ref ? messageQuotePreview(ref) : t("chats.quotedMessage");
  return `<div class="msg-quote"><span class="msg-quote-bar"></span><span class="msg-quote-text">${escapeHtml(String(preview).slice(0, 140))}</span></div>`;
}

function renderReactionBlock(m) {
  if (m.type !== "reaction") return "";
  const emoji = m.reactionEmoji || m.text?.replace(/^Reacción\s?/, "") || "👍";
  return `<div class="msg-reaction-out">${escapeHtml(emoji)}</div>`;
}

function renderMsgActions(m) {
  if (m.direction !== "in" || !isWaMessageId(m.id)) return "";
  return `<div class="msg-actions">
    <button type="button" class="msg-action-btn" data-action="reply" data-msg-id="${escapeHtml(m.id)}" title="${escapeHtml(t("chats.reply"))}">↩</button>
    <button type="button" class="msg-action-btn" data-action="react" data-emoji="👍" data-msg-id="${escapeHtml(m.id)}" title="${escapeHtml(t("chats.react"))}">👍</button>
    <button type="button" class="msg-action-btn" data-action="react" data-emoji="❤️" data-msg-id="${escapeHtml(m.id)}" title="${escapeHtml(t("chats.react"))}">❤️</button>
    <button type="button" class="msg-action-btn" data-action="react" data-emoji="😂" data-msg-id="${escapeHtml(m.id)}" title="${escapeHtml(t("chats.react"))}">😂</button>
  </div>`;
}

async function sendReaction(messageId, emoji) {
  const phone = state.activePhone;
  if (!phone || !messageId) return;
  const res = await post("/api/send-reaction", { phone, messageId, emoji });
  if (!res.ok) toast(res.error || t("toast.sendFailedGeneric"), "error");
  else await loadMessages(phone);
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

function messageErrorLabel(m) {
  const e = m && m.error;
  if (!e) return "";
  return e.title || e.message || (e.code ? `Código ${e.code}` : "");
}

function statusTick(m) {
  if (m.direction === "in") {
    let label = "Recibido";
    if (m.type === "audio") label = m.voice ? "Nota de voz recibida" : "Audio recibido";
    else if (m.type === "image") label = "Imagen recibida";
    else if (m.type === "video") label = "Video recibido";
    else if (m.type === "document") label = "Documento recibido";
    return `<span class="recv-badge" title="${escapeHtml(label)}">${escapeHtml(label)}</span>`;
  }
  let label = STATUS_LABELS[m.status] || "";
  const err = messageErrorLabel(m);
  if (m.status === "failed" && err) label = `${label}: ${err}`;
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
      const isReaction = m.type === "reaction";
      const media = isReaction ? renderReactionBlock(m) : renderMedia(m);
      const location = renderLocationBlock(m);
      const contacts = renderContactsBlock(m);
      const quote = renderQuoteBlock(m);
      const caption = m.text && !isReaction ? escapeHtml(m.text) : "";
      const time = new Date(m.timestamp).toLocaleTimeString(localeCode() === "ru" ? "ru" : localeCode() === "en" ? "en-US" : "es", { hour: "2-digit", minute: "2-digit" });
      const isHi = hi && (m.id === hi);
      return `<div class="msg-row ${m.direction}${isReaction ? " reaction" : ""}" data-msg-id="${escapeHtml(m.id)}"${isHi ? ' id="billHighlightMsg"' : ""}>
        <div class="bubble${tplClass}${isHi ? " msg-highlight" : ""}${isReaction ? " reaction-bubble" : ""}">
          ${quote}${media}${location}${contacts}${caption}
          <div class="bubble-meta">${time}${statusTick(m)}${renderMsgActions(m)}</div>
        </div>
      </div>`;
    })
    .join("");
  box.querySelectorAll(".msg-action-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const msgId = btn.dataset.msgId;
      const msg = state.messages.find((x) => x.id === msgId);
      if (btn.dataset.action === "reply") setReplyTo(msg);
      else if (btn.dataset.action === "react") sendReaction(msgId, btn.dataset.emoji);
    });
  });
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
    pill.textContent = t("chats.windowOpen", { hrs, mins });
    expiryEl.textContent = t("chats.windowCloses", { when: localeDateTime(expiryMs) });
    banner.classList.add("hidden");
  } else {
    pill.className = "window-pill closed";
    pill.textContent = t("chats.windowClosed");
    if (detail && detail.windowExpiresAt) {
      expiryEl.textContent = t("chats.windowExpired", { when: localeDateTime(detail.windowExpiresAt * 1000) });
    } else {
      expiryEl.textContent = t("chats.windowNoRecent");
    }
    banner.classList.remove("hidden");
    banner.innerHTML = t("chats.windowClosedBanner");
  }
  syncComposerState();
}

/* ---------- send text ---------- */
async function sendText(text) {
  const phone = state.activePhone;
  if (!phone || !text.trim()) return;
  if (!isMessagingWindowOpen()) {
    toast(t("chats.windowClosedHint"), "error");
    return;
  }
  const replyToMessageId = state.replyTo?.id || null;
  $("messageInput").value = "";
  clearReplyTo();
  const res = await post("/api/send", { phone, text: text.trim(), replyToMessageId });
  if (res.warning) toast(res.warning, "error");
  else if (res.error) toast(t("toast.sendFailed", { error: res.error }), "error");
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

function templateTypeLabel(tpl) {
  if (templateHasFlowButtonMeta(tpl)) return t("templates.typeTour");
  return t("templates.typeText");
}

function renderTemplateRow(tpl, i, list) {
  const st = (tpl.status || "").toLowerCase();
  const stUpper = (tpl.status || "").toUpperCase();
  const cls = st === "approved" ? "approved" : st === "rejected" ? "rejected" : "pending";
  const canSend = st === "approved";
  const canDelete = ["REJECTED", "PAUSED", "DISABLED"].includes(stUpper);
  const isFlowTpl = templateHasFlowButtonMeta(tpl);
  const q = tpl.quality_score && tpl.quality_score.score;
  const rejectReason = tpl.localMeta && tpl.localMeta.lastRejectionReason;
  return `<tr class="tpl-row${isFlowTpl ? " tpl-row-flow" : ""}" data-i="${i}">
    <td class="tpl-name-cell"><span class="tpl-table-name">${escapeHtml(tpl.name)}</span></td>
    <td>${escapeHtml(templateTypeLabel(tpl))}</td>
    <td>
      <span class="status-badge ${cls}">${escapeHtml(tpl.status || "—")}</span>
      ${qualityScoreBadge(q)}
      ${stUpper === "REJECTED" && rejectReason ? `<span class="tpl-reject-reason">${escapeHtml(rejectReason)}</span>` : ""}
    </td>
    <td>${isFlowTpl ? `<span class="tpl-flow-link-tag">${escapeHtml(t("templates.linkedFlow"))}</span>` : "—"}</td>
    <td class="tpl-action-cell">
      ${canSend
    ? `<button type="button" class="btn-ghost sm tpl-send-btn" data-i="${i}">${escapeHtml(t("templates.sendBtn"))}</button>`
    : ""}
      ${canDelete
    ? `<button type="button" class="btn-ghost sm tpl-delete-btn" data-name="${escapeHtml(tpl.name)}">${escapeHtml(t("templates.deleteBtn"))}</button>`
    : (!canSend ? `<span class="muted">—</span>` : "")}
    </td>
  </tr>`;
}

function renderTplProductGrid() {
  const box = $("tplProductGrid");
  if (!box) return;
  if (!state.config.templatesEnabled) {
    box.innerHTML = `<p class="muted center-msg">${escapeHtml(t("templates.configureAccess"))}</p>`;
    return;
  }
  if (!state.templatePresets.length) {
    box.innerHTML = `<p class="muted center-msg">${escapeHtml(t("templates.noDrafts"))}</p>`;
    return;
  }
  box.innerHTML = state.templatePresets.map((p) => {
    const ms = presetMetaForKey(p.key);
    const canSend = ms && ms.readyForProduction;
    const sendName = preferredTemplateForPreset(p);
    return `
    <article class="tpl-product-card${p.isFlowPreset ? " has-flow" : ""}">
      <div class="tpl-product-head">
        <h3>${escapeHtml(p.label)}</h3>
        ${presetVariantRowsHtml(p, ms)}
      </div>
      <div class="tpl-product-actions">
        <button type="button" class="btn-ghost sm tpl-preview-btn" data-preset="${escapeHtml(p.key)}">${escapeHtml(t("templates.viewPreview"))}</button>
        ${canSend && sendName
    ? `<button type="button" class="btn-primary sm tpl-send-preset-btn" data-tpl="${escapeHtml(sendName)}">${escapeHtml(t("templates.sendBtn"))}</button>`
    : ""}
      </div>
    </article>`;
  }).join("");
  box.querySelectorAll(".tpl-preview-btn").forEach((btn) =>
    btn.addEventListener("click", () => openTplDraftModal(btn.dataset.preset))
  );
  box.querySelectorAll(".tpl-send-preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const presetKey = btn.closest(".tpl-product-card")?.querySelector(".tpl-preview-btn")?.dataset.preset;
      openNewChat(btn.dataset.tpl, { presetKey });
    });
  });
  bindTemplateDeleteButtons(box);
}

async function deleteTemplateByName(name, btn) {
  if (!name) return;
  if (!window.confirm(t("templates.deleteConfirm", { name }))) return;
  if (btn) btn.disabled = true;
  const res = await del(`/api/templates/${encodeURIComponent(name)}`);
  if (!res.ok) {
    toast(res.error || t("templates.deleteFailed"), "error");
    if (btn) btn.disabled = false;
    return;
  }
  toast(t("templates.deleteOk", { name }), "ok");
  await refreshTemplatesScreen();
}

function bindTemplateDeleteButtons(root) {
  (root || document).querySelectorAll(".tpl-delete-btn").forEach((btn) => {
    if (btn.dataset.boundDelete) return;
    btn.dataset.boundDelete = "1";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteTemplateByName(btn.dataset.name, btn);
    });
  });
}

function renderTplOtherList() {
  const list = $("templateList");
  const section = $("tplOtherSection");
  const countEl = $("tplOtherCount");
  if (!list) return;
  const orphans = orphanTemplates();
  const wasOpen = section?.hasAttribute("open");
  if (section) section.classList.toggle("hidden", !orphans.length);
  if (countEl) countEl.textContent = orphans.length ? `(${orphans.length})` : "";
  if (!orphans.length) {
    list.innerHTML = "";
    return;
  }
  try {
    list.innerHTML = `
    <div class="billing-table-wrap">
      <table class="templates-table billing-table templates-table-compact">
        <thead>
          <tr>
            <th>${escapeHtml(t("templates.colName"))}</th>
            <th>${escapeHtml(t("templates.colType"))}</th>
            <th>${escapeHtml(t("templates.colStatus"))}</th>
            <th>${escapeHtml(t("templates.colFlow"))}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${orphans.map((tpl, i) => renderTemplateRow(tpl, i, orphans)).join("")}</tbody>
      </table>
    </div>`;
  } catch (err) {
    console.error("renderTplOtherList:", err);
    list.innerHTML = `<p class="muted sm">${escapeHtml(t("templates.otherLoadError"))}</p>`;
  }
  if (wasOpen && section) section.setAttribute("open", "");
  list.querySelectorAll(".tpl-send-btn").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openNewChat(orphans[Number(btn.dataset.i)].name);
    })
  );
  bindTemplateDeleteButtons(list);
}

function renderTemplatesScreen() {
  renderTplProductGrid();
  renderTplOtherList();
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

function variableGuideTableHtml(vars, { title } = {}) {
  if (!vars || !vars.length) return "";
  const titleText = title != null ? title : t("templates.varGuideDefault");
  const rows = vars.map((v, i) => {
    const s = v.typeLabel ? v : clientVarSchema(v, i);
    return `<tr>
      <td><span class="tpl-var-ph">${escapeHtml(s.placeholder || `{{${i + 1}}}`)}</span><br><strong>${escapeHtml(s.label)}</strong>${s.key ? `<br><code class="muted sm">${escapeHtml(s.key)}</code>` : ""}</td>
      <td><span class="tpl-var-type">${escapeHtml(s.typeLabel || t("modals.msgTypes.text"))}</span>${s.mapsTo ? `<div class="muted sm">${escapeHtml(s.mapsTo)}</div>` : ""}</td>
      <td class="muted sm">${escapeHtml(s.accept || "—")}</td>
      <td><code>${escapeHtml(s.example || "—")}</code></td>
    </tr>`;
  }).join("");
  return `${titleText ? `<p class="tpl-var-guide-title">${escapeHtml(titleText)}</p>` : ""}
    <table class="tpl-var-guide-table">
      <thead><tr><th>${escapeHtml(t("templates.varGuideColVariable"))}</th><th>${escapeHtml(t("templates.varGuideColType"))}</th><th>${escapeHtml(t("templates.varGuideColFormat"))}</th><th>${escapeHtml(t("templates.varGuideColExample"))}</th></tr></thead>
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
    box.innerHTML = `<p class="muted sm">${escapeHtml(t("templates.noVarsConfigured"))}</p>`;
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
  renderVariableGuide($("tplDraftVarGuide"), items, { title: t("templates.varGuideDraft") });
}

function renderPayAuthVarGuide(guide) {
  renderVariableGuide($("payAuthVarGuide"), guide, { title: t("templates.varGuidePayAuth") });
}

function updateTpVarGuide() {
  const vars = collectTpVariables().filter((v) => v.key || v.example);
  const guide = vars.map((v, i) => clientVarSchema(v, i));
  renderVariableGuide($("tpVarGuide"), guide, { title: t("templates.varGuideDefining") });
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
  const time = now.toLocaleTimeString(localeCode() === "ru" ? "ru" : localeCode() === "en" ? "en-US" : "es", { hour: "2-digit", minute: "2-digit" });
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
    <div class="wa-preview-note">${escapeHtml(t("templates.waPreviewNote"))}</div>`;
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
  const labelKey = `templates.metaStatus.${st.replace(/-/g, "_")}`;
  const translated = t(labelKey);
  const cls = st === "approved" ? "approved" : st === "rejected" ? "rejected" : st === "pending" ? "pending" : "draft";
  const text = translated !== labelKey ? translated : (fallbackLabel || status || "—");
  return `<span class="status-badge ${cls}">${escapeHtml(text)}</span>`;
}

function tplLookupByName(name) {
  if (!name) return null;
  return state.templates.find((tpl) => tpl.name === name) || null;
}

function qualityScoreBadge(score) {
  const q = String(score || "").toUpperCase();
  if (!q || q === "UNKNOWN") return "";
  const cls = q === "GREEN" ? "quality-green" : q === "YELLOW" ? "quality-yellow" : q === "RED" ? "quality-red" : "";
  if (!cls) return "";
  const labelKey = `templates.quality.${q.toLowerCase()}`;
  const label = t(labelKey);
  return `<span class="tpl-quality ${cls}">${escapeHtml(label !== labelKey ? label : q)}</span>`;
}

function tplRejectionReasonHtml(name) {
  const tpl = tplLookupByName(name);
  const reason = tpl?.localMeta?.lastRejectionReason;
  if (!reason) return "";
  return `<span class="tpl-reject-reason">${escapeHtml(reason)}</span>`;
}

function variantDeleteBtn(name, status) {
  const st = String(status || "").toUpperCase();
  if (!name || !["REJECTED", "PAUSED", "DISABLED"].includes(st)) return "";
  return `<button type="button" class="btn-ghost sm tpl-delete-btn" data-name="${escapeHtml(name)}" title="${escapeHtml(t("templates.deleteBtn"))}">×</button>`;
}

function presetVariantRowsHtml(preset, ms) {
  if (!preset) return "";
  const textSt = (ms && ms.text && ms.text.status) || "NOT_SUBMITTED";
  const textName = preset.name;
  const textQ = (ms && ms.text && ms.text.qualityScore) || tplLookupByName(textName)?.quality_score?.score;
  const flowName = preset.templateFlowName;
  const flowSt = flowName && ms && ms.flow ? ms.flow.status : "NOT_SUBMITTED";
  const flowQ = flowName && ms && ms.flow && ms.flow.qualityScore
    ? ms.flow.qualityScore
    : (flowName ? tplLookupByName(flowName)?.quality_score?.score : null);
  const catKey = String(preset.category || "UTILITY").toLowerCase();
  let rows = `<div class="tpl-variant-row">
    <span class="tpl-variant-type">${escapeHtml(t("templates.typeText"))}</span>
    ${metaStatusBadge(textSt)}
    ${qualityScoreBadge(textQ)}
    ${variantDeleteBtn(textName, textSt)}
    ${textSt === "REJECTED" ? tplRejectionReasonHtml(textName) : ""}
  </div>`;
  if (flowName) {
    rows += `<div class="tpl-variant-row">
      <span class="tpl-variant-type">${escapeHtml(t("templates.typeTour"))}</span>
      ${metaStatusBadge(flowSt)}
      ${qualityScoreBadge(flowQ)}
      ${variantDeleteBtn(flowName, flowSt)}
      ${flowSt === "REJECTED" ? tplRejectionReasonHtml(flowName) : ""}
      <span class="tpl-flow-link-tag" title="${escapeHtml(flowName)}">${escapeHtml(t("templates.linkedFlow"))}</span>
    </div>`;
  }
  return `<div class="tpl-variant-rows">${rows}</div><span class="tpl-cat-pill">${escapeHtml(catKey)}</span>`;
}

function presetTemplateNames() {
  const names = new Set();
  state.templatePresets.forEach((p) => {
    if (p.name) names.add(p.name);
    if (p.templateFlowName) names.add(p.templateFlowName);
  });
  return names;
}

function orphanTemplates() {
  const linked = presetTemplateNames();
  return state.templates.filter((t) => !linked.has(t.name));
}

function presetForFlowName(flowName) {
  const n = String(flowName || "").toLowerCase();
  return state.templatePresets.find((p) => {
    const prefix = PRESET_FLOW_PREFIX[p.key] || p.flowSampleKey || "";
    return prefix && n.startsWith(String(prefix).toLowerCase());
  }) || null;
}

async function loadTplVariableCatalog() {
  const res = await api("/api/templates/variable-catalog");
  state.variableCatalog = (res && res.ok && res.catalog) || [];
  const box = $("tplVarCatalogBody");
  if (!box) return;
  if (!state.variableCatalog.length) {
    box.textContent = res && res.error ? res.error : t("templates.noCatalog");
    return;
  }
  box.innerHTML = state.variableCatalog.map((g) => `
    <div class="tpl-var-catalog-group">
      <h4>${escapeHtml(g.label)}
        <span class="tpl-var-status ${escapeHtml(g.status)}">${g.status === "active" ? t("templates.catalogActive") : t("templates.catalogFuture")}</span>
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
  box.innerHTML = `<span class="muted sm" style="flex:1 1 100%;margin-bottom:2px">${escapeHtml(t("templates.varCatalogPick"))}</span>`
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
  toast(t("toast.varKeyReady", { key, index: `{{${idx + 1}}}` }), "ok");
}

async function loadTemplatePresets() {
  const res = await api("/api/templates/presets");
  state.templatePresets = (res && res.presets) || [];
  state.presetMetaStatus = (res && res.metaStatus) || [];
  state.tplMetaSyncedAt = res && res.syncedAt ? res.syncedAt : null;
  updateTplSyncHint();
  if ($("tplProductGrid")) renderTplProductGrid();
}

async function syncTemplatesWithMeta() {
  const btn = $("tplSyncMetaBtn");
  const hint = $("tplSyncMetaHint");
  if (btn) btn.disabled = true;
  if (hint) hint.textContent = t("common.syncing");
  const res = await post("/api/templates/sync-meta", {});
  if (btn) btn.disabled = false;
  if (!res.ok) {
    if (hint) hint.textContent = res.error || t("templates.syncFailed");
    toast(res.error || t("toast.syncMetaError"), "error");
    return;
  }
  state.templates = res.data || [];
  state.presetMetaStatus = res.metaStatus || [];
  state.tplMetaSyncedAt = res.syncedAt || Date.now();
  updateTplSyncHint();
  renderTemplatesScreen();
  if (state.activeTemplatePreset) renderTplDraftMetaBar(state.activeTemplatePreset);
  toast(t("toast.syncMetaOk", { total: res.total || 0 }), "ok");
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
    el.innerHTML = `<p class="muted sm tpl-draft-meta-hint">${escapeHtml(t("templates.draftMetaSyncHint"))}</p>`;
    return;
  }
  el.innerHTML = presetVariantRowsHtml(preset, ms);
}

function updateTplSyncHint() {
  const hint = $("tplSyncMetaHint");
  if (!hint) return;
  if (!state.tplMetaSyncedAt) {
    hint.textContent = t("templates.syncHintDefault");
    return;
  }
  hint.textContent = t("templates.syncHintUpdated", { when: localeDateTime(state.tplMetaSyncedAt) });
}

function nextPresetSubmitAction(preset, ms) {
  if (!preset) return null;
  const meta = ms || { text: { status: "NOT_SUBMITTED" } };
  const textSt = (meta.text && meta.text.status) || "NOT_SUBMITTED";
  const flowName = preset.templateFlowName;
  const flowSt = flowName && meta.flow ? meta.flow.status : "NOT_SUBMITTED";
  const needsText = textSt === "NOT_SUBMITTED" || textSt === "REJECTED";
  const needsFlow = flowName && (flowSt === "NOT_SUBMITTED" || flowSt === "REJECTED");
  if (String(preset.category || "").toUpperCase() === "AUTHENTICATION") {
    return needsText ? { includeFlow: false, variant: "auth" } : null;
  }
  if (needsText) return { includeFlow: false, variant: "text" };
  if (needsFlow) return { includeFlow: true, variant: "flow" };
  return null;
}

async function submitPresetToMeta(key) {
  const preset = state.templatePresets.find((p) => p.key === key);
  if (!preset) return;
  const action = nextPresetSubmitAction(preset, presetMetaForKey(key));
  if (!action) {
    toast(t("templates.presetAlreadySubmitted"), "info");
    return;
  }
  const btn = $("tplDraftCreateBtn");
  const prevLabel = btn ? btn.textContent : "";
  if (btn) {
    btn.disabled = true;
    btn.textContent = t("templates.submittingMeta");
  }
  const res = await post(`/api/templates/presets/${encodeURIComponent(key)}/submit`, {
    includeFlow: action.variant === "flow",
  });
  if (btn) {
    btn.disabled = false;
    btn.textContent = prevLabel || t("modals.draftModal.requestMeta");
  }
  if (!res.ok) {
    toast(res.error || t("templates.submitMetaFailed"), "error");
    return;
  }
  closeModals();
  toast(t("templates.submitMetaOk", { name: res.name }), "ok");
  await refreshTemplatesScreen({ highlightName: res.name });
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
  if ($("tplDraftTitle")) $("tplDraftTitle").textContent = preset ? preset.label : t("templates.draftTitle");
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
  await Promise.all([loadTemplates(), loadTemplatePresets(), loadTplVariableCatalog()]);
  renderTemplatesScreen();
}

async function refreshTemplatesScreen(opts = {}) {
  await Promise.all([loadTemplates(), loadTemplatePresets()]);
  renderTemplatesScreen();
  const highlightName = opts.highlightName || state.pendingTemplateHighlight || null;
  state.pendingTemplateHighlight = null;
  if (highlightName) highlightTemplateInTable(highlightName);
}

function highlightTemplateInTable(name) {
  if (!name) return;
  const preset = presetForTemplateName(name);
  if (preset) {
    const card = $("tplProductGrid")?.querySelector(`.tpl-preview-btn[data-preset="${CSS.escape(preset.key)}"]`)?.closest(".tpl-product-card");
    if (card) {
      card.classList.add("tpl-row-highlight");
      card.scrollIntoView({ block: "nearest", behavior: "smooth" });
      window.setTimeout(() => card.classList.remove("tpl-row-highlight"), 4000);
      return;
    }
  }
  const orphans = orphanTemplates();
  const idx = orphans.findIndex((t) => t.name === name);
  const list = $("templateList");
  if (idx < 0 || !list) return;
  const row = list.querySelector(`tr.tpl-row[data-i="${idx}"]`);
  if (!row) return;
  $("tplOtherSection")?.classList.remove("hidden");
  $("tplOtherSection")?.setAttribute("open", "");
  row.classList.add("tpl-row-highlight");
  row.scrollIntoView({ block: "nearest", behavior: "smooth" });
  window.setTimeout(() => row.classList.remove("tpl-row-highlight"), 4000);
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

function syncFlowsCreateLayout(active) {
  const pane = document.querySelector("#screenFlows .flows-pane");
  pane?.classList.toggle("flows-pane-studio", active);
  $("flowsTabs")?.classList.toggle("hidden", active);
  $("flowsStatusBar")?.classList.toggle("flows-status-compact", active);
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
  syncFlowsCreateLayout(false);
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

async function showFlowCreatePanel() {
  state.activeUseCaseId = null;
  syncFlowsCreateLayout(true);
  ["flowsPanelMis", "flowsPanelActividad", "flowsPanelProbar"].forEach((id) => {
    $(id)?.classList.add("hidden");
  });
  $("flowsPanelCrear")?.classList.remove("hidden");
  $("flowCreatePicker")?.classList.add("hidden");
  if (window.I18n) await I18n.ensureScreen("flows");
  await initFlowStudio();
  if (window.I18n) I18n.applyDom($("flowStudioPanel"));
}

async function openFlowCreate() {
  fsState.editingFlowId = null;
  fsState.screens = [];
  fsState.activeIndex = 0;
  syncFsStudioEditUi();
  await showFlowCreatePanel();
}

function closeFlowCreate() {
  state.activeUseCaseId = null;
  syncFlowsCreateLayout(false);
  setFlowsTab("mis");
}

function openFlowProbar(mode) {
  state.probarMode = mode === "booking" ? "booking" : "payment";
  syncFlowsCreateLayout(false);
  ["flowsPanelMis", "flowsPanelActividad", "flowsPanelCrear"].forEach((id) => {
    $(id)?.classList.add("hidden");
  });
  $("flowsPanelProbar")?.classList.remove("hidden");

  const isBooking = state.probarMode === "booking";
  const badge = document.querySelector("#flowsPanelProbar .flows-hero-badge");
  const heroTitle = document.querySelector("#flowsPanelProbar .flows-hero-copy h2");
  const heroHint = document.querySelector("#flowsPanelProbar .flows-hero-copy p.muted");
  if (badge) badge.textContent = isBooking ? t("flows.badgeBooking") : t("flows.badge3ds");
  if (heroTitle) heroTitle.textContent = isBooking ? t("flows.bookingTitle") : t("flows.payConfirmTitle");
  if (heroHint) heroHint.textContent = isBooking ? t("flows.bookingHint") : t("flows.payConfirmHint");

  $("flowsPaymentAuthPanel")?.classList.toggle("hidden", isBooking);
  $("flowsBookingPanel")?.classList.toggle("hidden", !isBooking);
  $("payAuthScreenTabs")?.classList.toggle("hidden", isBooking);
  $("payAuthFlowPreview")?.classList.toggle("hidden", isBooking);
  $("bookingFlowPreview")?.classList.toggle("hidden", !isBooking);

  if (isBooking) {
    updateBookingPreview();
    loadBookingScheduleDefaults();
    loadBookingRecent();
  } else {
    updatePayAuthPreview();
    updatePayAuthFlowPreview();
  }
}

function updateBookingPreview() {
  renderWaMessagePreview($("payAuthWaPreview"), {
    header: t("flows.bookingWaHeader"),
    body: t("flows.bookingWaBody", { name: ($("bookingCustomerName") || $("payAuthCustomerName") || {}).value || "Ana Torres" }),
    footer: t("flows.bookingWaFooter"),
    cta: t("flows.bookingCta"),
  });
  const box = $("bookingFlowPreview");
  if (!box) return;
  box.innerHTML = `
    <div class="flow-phone-nav"><span>✕</span><span>${escapeHtml(t("flows.bookingScreenTitle"))}</span><span>⋯</span></div>
    <div class="flow-phone-body">
      <h3>${escapeHtml(t("flows.bookingScreenHeading"))}</h3>
      <p>${escapeHtml(t("flows.bookingScreenBody"))}</p>
      <p style="margin:8px 0;padding:10px;border:1px solid #e9edef;border-radius:8px;font-size:12px;color:#667781">${escapeHtml(t("flows.bookingFieldBranch"))}</p>
      <p style="margin:8px 0;padding:10px;border:1px solid #e9edef;border-radius:8px;font-size:12px;color:#667781">📅 ${escapeHtml(t("flows.bookingFieldDate"))}</p>
      <p class="muted sm">${escapeHtml(t("flows.bookingFieldSlotsHint"))}</p>
    </div>
    <div class="flow-phone-footer"><button type="button">${escapeHtml(t("flows.bookingCta"))}</button></div>`;
}

async function sendBookingTest() {
  const phone = ($("bookingPhone") || $("payAuthPhone") || {}).value.trim();
  if (!phone) { toast(t("toast.phoneRequired"), "error"); return; }
  const res = await post("/api/flows/booking/test", {
    phone,
    customerName: ($("bookingCustomerName") || $("payAuthCustomerName") || {}).value.trim(),
  });
  if (!res.ok) { toast(res.error || t("toast.sendFailedGeneric"), "error"); return; }
  toast(t("toast.bookingSent"), "ok");
  loadBookingRecent();
}

async function loadBookingRecent() {
  const box = $("bookingRecent");
  if (!box) return;
  const res = await api("/api/flows/booking/recent");
  const rows = (res && res.data) || [];
  if (!rows.length) {
    box.textContent = t("flows.noTestBookings");
    return;
  }
  box.innerHTML = rows.slice(0, 5).map((r) =>
    `<div>${escapeHtml(r.customerName || "—")} · ${escapeHtml(r.date || t("flows.activity.pending"))} ${escapeHtml(r.slotLabel || "")} · ${escapeHtml(r.status || "")}</div>`
  ).join("");
}

async function loadBookingScheduleDefaults() {
  const res = await api("/api/bookings/schedule");
  if (!res.ok || !res.schedule) return;
  const sel = $("bookingAvailBranch");
  if (sel && res.schedule.branches?.length) {
    sel.innerHTML = res.schedule.branches.map((b) =>
      `<option value="${escapeHtml(b.id)}">${escapeHtml(b.title)}</option>`
    ).join("");
  }
  const dateInput = $("bookingAvailDate");
  if (dateInput && res.schedule.dateRange?.min) {
    dateInput.min = res.schedule.dateRange.min;
    dateInput.max = res.schedule.dateRange.max;
    if (!dateInput.value) dateInput.value = res.schedule.dateRange.min;
  }
}

async function checkBookingAvailability() {
  const branch = ($("bookingAvailBranch") || {}).value || "centro";
  const date = ($("bookingAvailDate") || {}).value;
  const box = $("bookingAvailResult");
  if (!date) {
    toast(t("flows.bookingFieldDate"), "error");
    return;
  }
  if (box) box.textContent = t("flows.loading");
  const res = await api(`/api/bookings/availability?branch=${encodeURIComponent(branch)}&date=${encodeURIComponent(date)}`);
  if (!box) return;
  if (!res.ok) {
    box.textContent = res.error || t("toast.sendFailedGeneric");
    return;
  }
  if (!res.slots?.length) {
    box.innerHTML = `<p>${escapeHtml(t("flows.bookingAvailEmpty"))}</p>
      <p>${escapeHtml(t("flows.bookingAvailSource"))}: ${escapeHtml(res.source || "—")} · ${escapeHtml(t("flows.bookingAvailTaken"))}: ${res.takenCount || 0}${res.externalConfigured ? " · CRM ✓" : ""}</p>`;
    return;
  }
  box.innerHTML = `<p>${escapeHtml(t("flows.bookingAvailSource"))}: <strong>${escapeHtml(res.source)}</strong> · ${escapeHtml(t("flows.bookingAvailTaken"))}: ${res.takenCount || 0}${res.externalConfigured ? " · CRM ✓" : ""}</p>
    <div>${res.slots.map((s) => `<span class="booking-avail-slot">${escapeHtml(s.title)}</span>`).join("")}</div>`;
}

function openFlowDetailProbar() {
  const perf = state.activeFlowPerformance || {};
  if (perf.isPaymentAuth) {
    openFlowProbar("payment");
    return;
  }
  if (perf.isBooking) {
    openFlowProbar("booking");
    return;
  }
  openFlowSendModal();
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
    box.textContent = t("templates.charCount", { len, max });
    box.className = "field-count muted" + (len > max ? " over" : len > max * 0.9 ? " warn" : "");
  });
}

function tpMetaRulesFallback() {
  const rules = [];
  for (let i = 0; i < 8; i++) {
    const line = t(`templates.metaRules.${i}`);
    if (line === `templates.metaRules.${i}`) break;
    rules.push(line);
  }
  return rules;
}

function renderTpMetaRules() {
  const list = $("tpMetaRulesList");
  if (!list) return;
  const rules = tpState.placeholderRules.length
    ? tpState.placeholderRules
    : tpMetaRulesFallback();
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
    box.innerHTML = escapeHtml(t("templates.validationOk"));
    return;
  }
  if (ok && warnings.length) {
    box.className = "tp-validation warn";
    box.innerHTML = `<strong>${escapeHtml(t("templates.validationWarnTitle"))}</strong><ul>${warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}</ul>`;
    return;
  }
  box.className = "tp-validation error";
  box.innerHTML = `<strong>${escapeHtml(t("templates.validationErrorTitle"))}</strong><ul>${errors.map((e) => `<li>${escapeHtml(e)}</li>`).join("")}</ul>`;

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
  if (header) lines.push(t("templates.previewHeader") + " " + header);
  lines.push(t("templates.previewBody") + " " + (body || "—"));
  if (footer) lines.push(t("templates.previewFooter") + " " + footer);
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
    hint.textContent = t("templates.nameBodyRequired");
    return;
  }

  await runTpValidation();
  if (!tpState.validation.ok) {
    hint.className = "hint error";
    hint.textContent = (tpState.validation.errors && tpState.validation.errors[0])
      || t("templates.fixVarsBeforeMeta");
    return;
  }

  hint.className = "hint";
  hint.textContent = t("templates.creating");
  const res = await post("/api/templates", payload);
  if (res.ok) {
    closeModals();
    const keys = (res.eventVariableKeys || []).join(", ");
    toast(
      t("toast.templateSubmittedMeta", {
        vars: keys ? t("toast.templateSubmittedVars", { keys }) : "",
      }),
      "ok"
    );
    await loadTemplates();
    renderTemplatesScreen();
    await loadTemplatePresets();
  } else {
    hint.className = "hint error";
    hint.textContent = res.error || t("templates.createFailed");
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

function ncPresetForTemplate(tpl) {
  if (!tpl) return null;
  return state.templatePresets.find((p) => p.name === tpl.name || p.templateFlowName === tpl.name) || null;
}

function renderTemplateFields(tpl) {
  const box = $("ncFields");
  const guideEl = $("ncVarGuide");
  const guideWrap = $("ncVarGuideWrap");
  if (!tpl) {
    box.innerHTML = "";
    renderVariableGuide(guideEl, []);
    guideWrap?.classList.add("hidden");
    return;
  }
  const preset = ncPresetForTemplate(tpl);
  const parts = [];
  const hs = headerSpec(tpl);
  if (hs && hs.kind === "text") {
    parts.push(`<label><span>${escapeHtml(t("templates.tplHeaderVar"))}</span><input data-field="header" type="text" placeholder="${escapeHtml(t("templates.tplHeaderVarPlaceholder"))}" /></label>`);
  }
  if (hs && hs.kind === "media") {
    const typeKey = hs.format === "IMAGE" ? "image" : hs.format === "VIDEO" ? "video" : "document";
    const typeLabel = t(`modals.msgTypes.${typeKey}`);
    parts.push(`<label><span>${escapeHtml(t("templates.tplHeaderMedia", { type: typeLabel }))}</span><input data-field="headerMedia" type="text" placeholder="https://…" /></label>`);
  }

  const n = bodyVarCount(tpl);
  for (let i = 1; i <= n; i++) {
    const ph = `{{${i}}}`;
    const v = preset && preset.variables ? preset.variables[i - 1] : null;
    const label = (v && v.label) || t("templates.tplBodyVar", { placeholder: ph });
    const placeholder = (v && v.example) || t("templates.tplBodyPlaceholder", { placeholder: ph });
    parts.push(`<label><span>${escapeHtml(label)}</span><input data-field="body${i}" type="text" placeholder="${escapeHtml(placeholder)}" /></label>`);
  }

  buttonSpecs(tpl).forEach((s) => {
    if (s.kind === "url") parts.push(`<label><span>${escapeHtml(t("templates.tplBtnUrl", { text: s.text }))}</span><input data-field="btnurl${s.idx}" type="text" placeholder="${escapeHtml(t("templates.tplBtnUrlPlaceholder"))}" /></label>`);
    else if (s.kind === "copy") parts.push(`<label><span>${escapeHtml(t("templates.tplBtnCode", { text: s.text }))}</span><input data-field="btncode${s.idx}" type="text" placeholder="CUPON20" /></label>`);
    else if (s.kind === "flow") parts.push(`<label><span>${escapeHtml(t("templates.tplBtnFlow", { text: s.text }))}</span><input data-field="flow${s.idx}" type="text" placeholder="unused" /></label>`);
  });

  box.innerHTML = parts.length
    ? `<div class="nc-params">${parts.join("")}</div>`
    : `<div class="tpl-none">${escapeHtml(t("templates.tplNoParams"))}</div>`;

  const complexTpl = n > 1 || (hs && hs.kind) || buttonSpecs(tpl).length > 0;
  if (complexTpl) {
    loadTemplateVariableGuide(tpl);
  } else {
    renderVariableGuide(guideEl, []);
    guideWrap?.classList.add("hidden");
  }
}

async function loadTemplateVariableGuide(tpl) {
  const guideEl = $("ncVarGuide");
  const guideWrap = $("ncVarGuideWrap");
  if (!tpl || !guideEl) {
    renderVariableGuide(guideEl, []);
    guideWrap?.classList.add("hidden");
    return;
  }
  try {
    const res = await api(`/api/templates/${encodeURIComponent(tpl.name)}/variables?language=${encodeURIComponent(tpl.language || "es")}`);
    const guide = (res && res.ok && (res.variableGuide || res.eventVariables)) || [];
    renderVariableGuide(guideEl, guide, { title: "" });
    if (guide.length) guideWrap?.classList.remove("hidden");
    else guideWrap?.classList.add("hidden");
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
    guideWrap?.classList.add("hidden");
  }
}

function syncNcNameToBodyVar() {
  const name = ($("ncName") && $("ncName").value.trim()) || "";
  const body1 = $("ncFields") && $("ncFields").querySelector('[data-field="body1"]');
  if (body1 && name && !body1.value.trim()) {
    body1.value = name;
    updateNcPreview();
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
const PRESET_FLOW_PREFIX = {
  punto_pago_tarjeta_credito_bienvenida: "punto_pago_tarjeta_credito",
  punto_pago_autorizacion_pago: "punto_pago_3ds_verificacion",
};

function findPublishedFlowForPreset(preset) {
  if (!preset) return null;
  const prefix = PRESET_FLOW_PREFIX[preset.key] || preset.flowSampleKey || "";
  if (!prefix) return null;
  return (state.flows || []).find((f) => {
    const n = String(f.name || "");
    return (n === prefix || n.startsWith(`${prefix}_`))
      && String(f.status || "").toUpperCase() === "PUBLISHED";
  }) || null;
}

function isFlowTemplateApproved(preset) {
  if (!preset || !preset.templateFlowName) return false;
  const tpl = tplByName(preset.templateFlowName);
  if (tpl && String(tpl.status || "").toLowerCase() === "approved" && templateHasFlowButtonMeta(tpl)) {
    return true;
  }
  const meta = presetMetaForKey(preset.key);
  return Boolean(meta && meta.flow && meta.flow.approved && meta.flow.hasFlowButton);
}

function presetForTemplateName(tplName) {
  return state.templatePresets.find((p) => p.name === tplName || p.templateFlowName === tplName) || null;
}

function isTemplateApproved(tpl) {
  return Boolean(tpl && String(tpl.status || "").toLowerCase() === "approved");
}

function preferredTemplateForPreset(preset) {
  if (!preset) return null;
  if (isFlowTemplateApproved(preset)) return preset.templateFlowName;
  const textTpl = tplByName(preset.name);
  if (isTemplateApproved(textTpl)) return preset.name;
  return null;
}

function templateSendOptionLabel(tpl, preset) {
  const bill = tpl.categoryInfo ? tpl.categoryInfo.billingLabel : String(tpl.category || "").toLowerCase();
  const warn = tpl.categoryInfo && tpl.categoryInfo.impactsBilling ? " ⚠" : "";
  const withTour = templateHasFlowButtonMeta(tpl);
  const variant = withTour ? t("templates.ncVariantWithTour") : t("templates.ncVariantTextOnly");
  if (preset) return `${preset.label} — ${variant} · ${bill}${warn}`;
  return `${tpl.name} — ${variant} · ${bill}${warn}`;
}

function buildNcTemplateSelectHtml(approved) {
  const groups = new Map();
  const orphans = [];
  approved.forEach((tpl) => {
    const preset = presetForTemplateName(tpl.name);
    if (preset) {
      if (!groups.has(preset.key)) groups.set(preset.key, { preset, templates: [] });
      groups.get(preset.key).templates.push(tpl);
    } else {
      orphans.push(tpl);
    }
  });
  let html = "";
  groups.forEach(({ preset, templates }) => {
    const sorted = templates.slice().sort((a, b) => {
      const af = templateHasFlowButtonMeta(a) ? 1 : 0;
      const bf = templateHasFlowButtonMeta(b) ? 1 : 0;
      return af - bf;
    });
    html += `<optgroup label="${escapeHtml(preset.label)}">`;
    sorted.forEach((tpl) => {
      html += `<option value="${escapeHtml(tpl.name)}">${escapeHtml(templateSendOptionLabel(tpl, preset))}</option>`;
    });
    html += "</optgroup>";
  });
  if (orphans.length) {
    html += `<optgroup label="${escapeHtml(t("templates.ncOtherTemplates"))}">`;
    orphans.forEach((tpl) => {
      html += `<option value="${escapeHtml(tpl.name)}">${escapeHtml(templateSendOptionLabel(tpl, null))}</option>`;
    });
    html += "</optgroup>";
  }
  return html;
}

function getNcPresetContext(tplName) {
  const preset = presetForTemplateName(tplName);
  if (!preset) return null;
  return {
    preset,
    isFlowTpl: tplName === preset.templateFlowName,
  };
}

function collectNcPresetOverrides() {
  const box = $("ncFields");
  const tpl = tplByName(($("ncTemplate") && $("ncTemplate").value) || "");
  if (!box || !tpl) return {};
  const overrides = {};
  const n = bodyVarCount(tpl);
  for (let i = 1; i <= n; i++) {
    const el = box.querySelector(`[data-field="body${i}"]`);
    if (el && el.value.trim()) overrides[`var${i}`] = el.value.trim();
  }
  const preset = presetForTemplateName(tpl.name);
  if (preset && preset.variables) {
    preset.variables.forEach((v, i) => {
      const val = overrides[`var${i + 1}`];
      if (val && v.key) overrides[v.key] = val;
    });
  }
  return overrides;
}

async function updateNcPreview() {
  const selected = ($("ncTemplate") && $("ncTemplate").value) || "";
  const ctx = getNcPresetContext(selected);
  const tpl = tplByName(selected);
  const waBox = $("ncWaPreview");
  const flowWrap = $("ncFlowPreviewWrap");
  if (!ctx || !waBox) {
    if (waBox) renderWaMessagePreview(waBox, { bodyText: "—" });
    flowWrap?.classList.add("hidden");
    return;
  }
  const q = new URLSearchParams(collectNcPresetOverrides()).toString();
  const res = await api(`/api/templates/presets/${encodeURIComponent(ctx.preset.key)}${q ? `?${q}` : ""}`);
  const preview = res && res.preview;
  const showFlow = templateHasFlowButtonMeta(tpl);
  renderWaMessagePreview(waBox, {
    headerText: (preview && preview.headerText) || "",
    bodyText: (preview && preview.bodyText) || "—",
    footerText: (preview && preview.footerText) || "",
    flowCta: showFlow ? ((preview && preview.flowCta) || ctx.preset.flowCta) : "",
  });
  if (flowWrap && showFlow && state.flowSendProfile) {
    flowWrap.classList.remove("hidden");
    const screenId = state.flowSendProfile.defaultScreen || "INTRO";
    renderFlowScreenPreview($("ncFlowPreview"), screenId, state.flowSendProfile);
  } else if (flowWrap) {
    flowWrap.classList.add("hidden");
  }
}

async function ensureNcFlowPreviewProfile(tplName) {
  const ctx = getNcPresetContext(tplName);
  if (!ctx || !ctx.preset.templateFlowName) return;
  if (!state.flows.length) await loadFlows();
  const flow = findPublishedFlowForPreset(ctx.preset)
    || state.flows.find((f) => {
      const prefix = PRESET_FLOW_PREFIX[ctx.preset.key] || ctx.preset.flowSampleKey || "";
      return prefix && String(f.name || "").startsWith(prefix);
    });
  if (flow && flow.id) await loadFlowSendProfile(flow.id);
}

async function openNewChat(prefillName, opts) {
  if (window.I18n) await I18n.ensureModules(["templates", "modals"]);
  showModal("modalNewChat");
  const sel = $("ncTemplate");
  const hint = $("ncHint");
  $("ncFields").innerHTML = "";
  renderVariableGuide($("ncVarGuide"), []);
  $("ncVarGuideWrap")?.classList.add("hidden");
  sel.innerHTML = `<option>${escapeHtml(t("common.loading"))}</option>`;
  await Promise.all([loadTemplates(), loadTemplatePresets()]);
  if (!state.flows.length) await loadFlows();
  const approved = state.templates.filter((t) => isTemplateApproved(t));
  if (!approved.length) {
    sel.innerHTML = `<option value="">${escapeHtml(t("bulk.noApprovedTemplates"))}</option>`;
    hint.className = "hint error";
    hint.textContent = t("templates.ncNoApprovedHint");
    return;
  }
  sel.innerHTML = buildNcTemplateSelectHtml(approved);
  let pick = prefillName || "";
  if (!pick && opts && opts.presetKey) {
    const preset = state.templatePresets.find((p) => p.key === opts.presetKey);
    pick = preferredTemplateForPreset(preset) || "";
  }
  if (pick && approved.some((t) => t.name === pick)) sel.value = pick;
  else if (opts && opts.preferFlow) {
    const flowTpl = approved.find((t) => templateHasFlowButtonMeta(t));
    if (flowTpl) sel.value = flowTpl.name;
  }
  if (opts && opts.phone && $("ncPhone")) $("ncPhone").value = opts.phone;
  if (opts && opts.name && $("ncName")) $("ncName").value = opts.name;
  else if (state.activePhone && $("ncPhone") && !$("ncPhone").value) $("ncPhone").value = state.activePhone;
  updateNewChatCategoryHint();
  renderTemplateFields(tplByName(sel.value));
  syncNcNameToBodyVar();
  await ensureNcFlowPreviewProfile(sel.value);
  await updateNcPreview();
}

function updateNewChatCategoryHint() {
  const tpl = tplByName($("ncTemplate").value);
  const hint = $("ncHint");
  if (!tpl || !hint) return;
  const info = tpl.categoryInfo;
  if (info && info.impactsBilling && info.hint) {
    hint.className = "hint warn";
    hint.textContent = t("templates.ncBillingWarn", { label: info.billingLabel, hint: info.hint });
    return;
  }
  hint.className = "hint";
  hint.textContent = info
    ? t("templates.ncBillingInfo", { label: info.billingLabel })
    : t("templates.ncBillingDefault");
}

async function sendNewChat() {
  const phone = $("ncPhone").value.replace(/[^0-9]/g, "");
  const tplName = ($("ncTemplate") && $("ncTemplate").value) || "";
  const overrides = collectNcPresetOverrides();
  const name = overrides.nombre_cliente || overrides.var1 || $("ncName").value.trim();
  if (!phone || !tplName) { toast(t("toast.phoneAndTemplateRequired"), "error"); return; }
  const tpl = tplByName(tplName);
  const components = tpl ? collectComponents(tpl) : [];
  const bodyN = tpl ? bodyVarCount(tpl) : 0;
  if (bodyN > 0) {
    for (let i = 1; i <= bodyN; i++) {
      const el = $("ncFields") && $("ncFields").querySelector(`[data-field="body${i}"]`);
      if (!el || !el.value.trim()) {
        toast(t("templates.ncMissingVars"), "error");
        return;
      }
    }
  }
  const res = await post("/api/send-template", {
    phone,
    name,
    template: tplName,
    language: tpl ? tpl.language : "es",
    components,
  });
  if (res.ok) {
    closeModals();
    toast(t("toast.templateSent"), "ok");
    switchScreen("chats");
    await loadConversations();
    openConversation(phone, name || phone);
  } else {
    toast(t("toast.sendFailed", { error: res.error || res.warning || "error" }), "error");
  }
}

/* ---------- media ---------- */
async function sendMedia() {
  const phone = state.activePhone;
  if (!phone) return;
  if (!isMessagingWindowOpen()) {
    toast(t("chats.windowClosedHint"), "error");
    return;
  }
  const file = $("mdFile").files[0];
  const link = $("mdLink").value.trim();
  if (!file && !link) { toast(t("toast.fileOrLinkRequired"), "error"); return; }

  const replyToMessageId = state.replyTo?.id || null;
  let res;
  if (file) {
    const form = new FormData();
    form.append("phone", phone);
    form.append("mediaType", $("mdType").value);
    form.append("caption", $("mdCaption").value.trim());
    if (replyToMessageId) form.append("replyToMessageId", replyToMessageId);
    form.append("file", file, file.name);
    $("mdSend").disabled = true;
    res = await postForm("/api/send-media", form);
    $("mdSend").disabled = false;
  } else {
    res = await post("/api/send-media", {
      phone, mediaType: $("mdType").value, link, caption: $("mdCaption").value.trim(), replyToMessageId,
    });
  }

  closeModals();
  clearReplyTo();
  if (res.ok) toast(t("toast.sent"), "ok");
  else toast(t("toast.sendFailed", { error: res.error || res.warning || "error" }), "error");
  $("mdFile").value = "";
  $("mdLink").value = "";
  $("mdCaption").value = "";
  updateMediaPreview();
  await loadMessages(phone);
}

async function sendLocation() {
  const phone = state.activePhone;
  if (!phone) return;
  if (!isMessagingWindowOpen()) {
    toast(t("chats.windowClosedHint"), "error");
    return;
  }
  const lat = Number(($("locLat") || {}).value);
  const lng = Number(($("locLng") || {}).value);
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    toast(t("chats.locationInvalid"), "error");
    return;
  }
  const res = await post("/api/send-location", {
    phone,
    latitude: lat,
    longitude: lng,
    name: ($("locName") || {}).value.trim(),
    address: ($("locAddress") || {}).value.trim(),
    replyToMessageId: state.replyTo?.id || null,
  });
  closeModals();
  clearReplyTo();
  if (res.ok) toast(t("toast.sent"), "ok");
  else toast(t("toast.sendFailed", { error: res.error || res.warning || "error" }), "error");
  ["locLat", "locLng", "locName", "locAddress"].forEach((id) => {
    const el = $(id);
    if (el) el.value = "";
  });
  await loadMessages(phone);
}

function openLocationModal() {
  if (!state.activePhone) return;
  if (!isMessagingWindowOpen()) {
    toast(t("chats.windowClosedHint"), "error");
    return;
  }
  showModal("modalLocation");
}

/* ---------- simulate ---------- */
async function simulate() {
  const phone = $("simPhone").value.replace(/[^0-9]/g, "");
  const text = $("simText").value.trim();
  if (!phone || !text) { toast(t("toast.phoneAndMessageRequired"), "error"); return; }
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
    return `<span class="bill-cost-free">${escapeHtml(t("billing.free"))}</span>`;
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
      <dt>${escapeHtml(t("billing.detail.date"))}</dt><dd>${escapeHtml(fmtBillDate(entry.sentAt))}</dd>
      <dt>${escapeHtml(t("billing.detail.dest"))}</dt><dd>${escapeHtml(entry.phoneFormatted || entry.phone)}${entry.recipientName ? ` · ${escapeHtml(entry.recipientName)}` : ""}</dd>
      <dt>${escapeHtml(t("billing.detail.country"))}</dt><dd>${countryFlag(entry.country)} ${escapeHtml(entry.countryName || entry.country || "—")}</dd>
      <dt>${escapeHtml(t("billing.detail.type"))}</dt><dd>${escapeHtml(entry.kindLabel || entry.kind)}</dd>
      <dt>${escapeHtml(t("billing.detail.category"))}</dt><dd><span class="cat-tag ${escapeHtml(entry.category)}">${escapeHtml(entry.categoryLabel || categoryBillingLabel(entry.category))}</span></dd>
      <dt>${escapeHtml(t("billing.detail.costEst"))}</dt><dd>${entry.isFree ? `<span class="bill-cost-free">${escapeHtml(t("billing.freeServiceLabel"))}</span>` : fmtUsd(entry.estimatedCost || 0)}</dd>
      ${entry.templateName ? `<dt>${escapeHtml(t("billing.detail.template"))}</dt><dd>${escapeHtml(entry.templateName)}</dd>` : ""}
      ${entry.flowName ? `<dt>${escapeHtml(t("billing.detail.flow"))}</dt><dd>${escapeHtml(entry.flowName)}</dd>` : ""}
      ${entry.flowMode ? `<dt>${escapeHtml(t("billing.detail.mode"))}</dt><dd>${escapeHtml(entry.flowMode)}</dd>` : ""}
      ${entry.preview ? `<dt>${escapeHtml(t("billing.detail.message"))}</dt><dd>${escapeHtml(entry.preview)}</dd>` : ""}
      ${entry.billingNote ? `<dt>${escapeHtml(t("billing.detail.note"))}</dt><dd class="muted sm">${escapeHtml(entry.billingNote)}</dd>` : ""}
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
    tbody.innerHTML = `<tr><td colspan="5" class="muted center">${escapeHtml(t("billing.noLedgerRows"))}</td></tr>`;
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
    tbody.innerHTML = `<tr><td colspan="5" class="muted center">${escapeHtml(t("billing.noFlowRows"))}</td></tr>`;
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
      const cost = it.isFree ? t("billing.tip.freeWord") : fmtUsd(it.estimatedCost || 0);
      const label = it.preview || it.templateName || it.flowName || it.kindLabel || "Mensaje";
      return `<li><strong>${escapeHtml(fmtBillDate(it.sentAt))}</strong> · ${escapeHtml(it.phoneFormatted || it.phone)}<br><span class="muted">${escapeHtml(label)}</span> · ${escapeHtml(cost)}</li>`;
    }).join("");
    const more = p.matchCount > items.length
      ? `<li class="muted">${escapeHtml(t("billing.tip.moreInLedger", { n: p.matchCount - items.length }))}</li>`
      : (p.matchCount > 8 ? `<li class="muted">${escapeHtml(t("billing.tip.more", { n: p.matchCount - 8 }))}</li>` : "");
    portalBlock = `<p><strong>${escapeHtml(t("billing.tip.portalSends", { count: p.matchCount }))}</strong></p><ul>${list}${more}</ul>`
      + (p.estimatedCost ? `<p>${escapeHtml(t("billing.tip.portalEst", { cost: fmtUsd(p.estimatedCost), free: p.freeCount || 0 }))}</p>` : "");
  } else {
    portalBlock = `<p class="muted">${escapeHtml(t("billing.tip.noPortal"))}</p>`;
  }
  const zeroNote = row.costZeroReason
    ? `<p>${escapeHtml(row.costZeroReason)}</p>`
    : "";
  return `
    <div class="bill-tip-source">${escapeHtml(t("billing.tip.source", { source: row.sourceLabel || "Meta" }))}</div>
    <p><strong>${escapeHtml(countryName(row.country))}</strong> · ${escapeHtml(categoryBillingLabel(row.category))}</p>
    <p>${escapeHtml(t("billing.tip.metaReports", { volume: fmtNum(row.volume), cost: fmtCost(row.cost) }))}</p>
    ${zeroNote}
    ${portalBlock}
    <p class="bill-tip-hint">${escapeHtml(t("billing.tip.clickHint"))}</p>`;
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
  if ($("billSyncHint")) $("billSyncHint").textContent = t("billing.syncing");
  tbody.innerHTML = `<tr><td colspan="4" class="muted center">${escapeHtml(t("billing.syncing"))}</td></tr>`;
  let res;
  try { res = await api(`/api/billing?days=${days}`); } catch (_) { res = { ok: false, error: "Error de red" }; }

  const note = $("billNote");
  const resetIds = [
    "bcCost", "bcVolume", "bcMkt", "bcUtil", "bcAuth", "bcPortalEst",
    "bcLedgerCount", "bcLedgerCost", "bcLedgerFree", "bcLedgerBillable",
    "bcFlowSends", "bcFlowBillable", "bcFlowFree", "bcFlowCost", "bcFlowResponses", "bcFlowEndpoint",
  ];
  if (!res.ok) {
    tbody.innerHTML = `<tr><td colspan="4" class="muted center">${escapeHtml(t("billing.loadFailed"))}</td></tr>`;
    note.textContent = res.error || "";
    resetIds.forEach((id) => { if ($(id)) $(id).textContent = "—"; });
    $("billTplAlert").classList.add("hidden");
    if ($("billFlowNote")) $("billFlowNote").textContent = "";
    if ($("billLedgerRows")) $("billLedgerRows").innerHTML = `<tr><td colspan="5" class="muted center">—</td></tr>`;
    if ($("billFlowRows")) $("billFlowRows").innerHTML = `<tr><td colspan="5" class="muted center">—</td></tr>`;
    return;
  }

  const billTotals = res.totals || { byCategory: {} };
  const byCat = billTotals.byCategory || {};
  $("bcCost").textContent = fmtCost(billTotals.cost);
  $("bcVolume").textContent = fmtNum(billTotals.volume);
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
    tbody.innerHTML = `<tr><td colspan="4" class="muted center">${escapeHtml(t("billing.noMetaRows"))}</td></tr>`;
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
  note.innerHTML = t("billing.metaNote");
  state.billingLastSync = Date.now();
  state.billingRangeDirty = false;
  updateBillSyncHint();
  setBillingTab(state.billingTab);
}

function updateBillSyncHint() {
  const hint = $("billSyncHint");
  if (!hint) return;
  if (state.billingRangeDirty) {
    hint.textContent = t("billing.periodChanged");
    return;
  }
  if (!state.billingLastSync) {
    hint.textContent = t("billing.syncOnScreenOpen");
    return;
  }
  const when = new Date(state.billingLastSync).toLocaleString((window.I18n && I18n.getLocale()) || "es", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
  hint.textContent = t("billing.updatedAt", { when });
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
function bulkStatusLabel(status) {
  const key = `bulk.status.${status}`;
  const label = t(key);
  return label !== key ? label : status;
}
function bulkRowStatusLabel(status) {
  const key = `bulk.rowStatus.${status}`;
  const label = t(key);
  return label !== key ? label : status;
}

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
    box.innerHTML = `<div class="lh-card"><span class="lh-label">${escapeHtml(t("bulk.lineWhatsapp"))}</span><span class="lh-value">—</span><span class="lh-sub">${escapeHtml(t("bulk.configureLine"))}</span></div>`;
    return;
  }
  const qClass = l.qualityColor || "muted";
  box.innerHTML = `
    <div class="lh-card"><span class="lh-label">${escapeHtml(t("bulk.lineNumber"))}</span><span class="lh-value" style="font-size:15px">${escapeHtml(l.displayPhone || "—")}</span><span class="lh-sub">${escapeHtml(l.verifiedName || "")}</span></div>
    <div class="lh-card ${qClass}"><span class="lh-label">${escapeHtml(t("bulk.lineIntegrity"))}</span><span class="lh-value">${escapeHtml(l.qualityLabel)}</span><span class="lh-sub">${escapeHtml(l.qualityHint || "")}</span></div>
    <div class="lh-card"><span class="lh-label">${escapeHtml(t("bulk.lineDailyLimit"))}</span><span class="lh-value">${escapeHtml(l.dailyUniqueLimitLabel)}</span><span class="lh-sub">${escapeHtml(t("bulk.lineDailySub", { tier: l.messagingTier || "" }))}</span></div>
    <div class="lh-card"><span class="lh-label">${escapeHtml(t("bulk.lineSendStatus"))}</span><span class="lh-value" style="font-size:15px">${l.canSendMessage ? escapeHtml(t("bulk.lineAvailable")) : escapeHtml(t("bulk.lineRestricted"))}</span><span class="lh-sub">${l.canSendMessage ? escapeHtml(t("bulk.lineCanSend")) : escapeHtml(t("bulk.lineCannotSend"))}</span></div>`;
}

function fillBulkTemplates() {
  const sel = $("bulkTemplate");
  const approved = state.templates.filter((t) => (t.status || "").toLowerCase() === "approved");
  if (!approved.length) {
    sel.innerHTML = `<option value="">${escapeHtml(t("bulk.noApprovedTemplates"))}</option>`;
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
    box.innerHTML = `<span class="muted">${escapeHtml(t("bulk.noEventVars"))}</span>`;
    box.classList.remove("hidden");
    return;
  }
  box.innerHTML = `<strong>${escapeHtml(t("bulk.eventVarsTitle"))}</strong><ul>${res.eventVariables
    .map((ev) => `<li><code>${escapeHtml(ev.key)}</code> — ${escapeHtml(ev.label)} (${escapeHtml(ev.placeholder)})</li>`)
    .join("")}</ul><p class="muted" style="margin:8px 0 0">${escapeHtml(t("bulk.eventVarsApiHint"))}</p>`;
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
    box.innerHTML = `<p class="muted">${escapeHtml(t("bulk.noCampaigns"))}</p>`;
    return;
  }
  box.innerHTML = state.campaigns
    .map((c) => {
      const totals = c.totals || {};
      const active = c.id === state.activeCampaignId ? " active" : "";
      const pct = c.progress ? c.progress.percent : 0;
      const src = c.source === "api" ? t("bulk.sourceApi") : t("bulk.sourceCsv");
      return `<div class="bulk-camp-item${active}" data-id="${escapeHtml(c.id)}">
        <strong>${escapeHtml(c.name)}</strong>
        <div class="muted" style="font-size:11px;margin-top:4px">
          ${escapeHtml(c.template)} · ${src} · ${escapeHtml(bulkStatusLabel(c.status))}
          · ${pct}% · ${escapeHtml(t("bulk.deliveredOf", { delivered: totals.delivered || 0, total: totals.total || 0 }))}
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
  if (!csvText) { box.className = "bulk-preview error"; box.textContent = t("bulk.selectCsv"); box.classList.remove("hidden"); return; }
  if (!tpl.name) { box.className = "bulk-preview error"; box.textContent = t("bulk.selectTemplate"); box.classList.remove("hidden"); return; }

  const fd = new FormData();
  fd.append("file", $("bulkCsv").files[0]);
  fd.append("template", tpl.name);
  fd.append("language", tpl.language);
  const res = await api("/api/campaigns/preview", { method: "POST", body: fd });

  box.classList.remove("hidden");
  if (!res.ok) {
    box.className = "bulk-preview error";
    box.textContent = res.error || (res.errors && res.errors.join(" ")) || t("bulk.validateFailed");
    return;
  }
  const evKeys = (res.eventVariables || []).map((e) => e.key).join(", ");
  let msg = t("bulk.previewValid", {
    count: res.rowCount,
    events: evKeys || (res.varColumns || []).join(", ") || t("bulk.none"),
  });
  if (res.overDailyLimit && res.line) {
    msg += t("bulk.previewOverLimit", { limit: res.line.dailyUniqueLimitLabel });
  }
  if (res.errors && res.errors.length) msg += t("bulk.previewWarnings", { warnings: res.errors.slice(0, 3).join(" ") });
  box.className = "bulk-preview ok";
  box.textContent = msg;
}

async function createBulkCampaign() {
  const csvText = await readBulkCsvFile();
  const tpl = selectedBulkTemplate();
  if (!csvText || !tpl.name) { toast(t("toast.csvAndTemplateRequired"), "error"); return; }

  const fd = new FormData();
  fd.append("file", $("bulkCsv").files[0]);
  fd.append("name", $("bulkName").value.trim() || `Carga ${tpl.name}`);
  fd.append("template", tpl.name);
  fd.append("language", tpl.language);
  const res = await api("/api/campaigns", { method: "POST", body: fd });
  if (!res.ok) { toast(res.error || t("toast.campaignCreateFailed"), "error"); return; }
  toast(t("toast.campaignCreated"), "ok");
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
  const campTotals = c.totals || {};
  const prog = c.progress || {};
  const cost = c.costEstimate || {};
  $("bulkDetailTitle").textContent = c.name;
  const srcLabel = c.source === "api" ? t("bulk.sourceApi") : t("bulk.sourceCsv");
  $("bulkDetailMeta").textContent = `${c.template} · ${c.language} · ${srcLabel} · ${bulkStatusLabel(c.status)}${c.pauseReason ? " · " + c.pauseReason : ""}`;

  const progBox = $("bulkProgress");
  progBox.classList.remove("hidden");
  progBox.innerHTML = `
    <div style="display:flex;justify-content:space-between;font-size:12px;gap:12px;flex-wrap:wrap">
      <span><strong>${escapeHtml(t("bulk.progressSend"))}</strong> ${prog.done || 0} / ${prog.total || 0} (${prog.percent || 0}%)</span>
      <span><strong>${escapeHtml(t("bulk.progressVars"))}</strong> ${prog.varsReady || 0} / ${prog.total || 0} (${prog.varsPercent || 0}%)</span>
    </div>
    <div class="bulk-progress-bar"><div class="bulk-progress-fill" style="width:${prog.percent || 0}%"></div></div>
    <div class="bulk-progress-bar" style="margin-top:6px"><div class="bulk-progress-fill vars" style="width:${prog.varsPercent || 0}%"></div></div>`;

  const costBox = $("bulkCost");
  if (cost.estimatedTotalUsd != null) {
    costBox.classList.remove("hidden");
    costBox.innerHTML = `<strong>${escapeHtml(t("bulk.costEst"))}</strong> ~$${cost.estimatedTotalUsd} USD (${cost.billableEstimate || 0} msgs × $${cost.ratePerMessageUsd} · ${escapeHtml(cost.category || "UTILITY")}). ${escapeHtml(cost.note || "")}`;
  } else costBox.classList.add("hidden");

  $("bulkStats").innerHTML = [
    "total", "awaiting_vars", "ready", "pending", "sent", "delivered", "read", "failed",
  ].map((k) => `<div class="bulk-stat"><span class="n">${campTotals[k] || 0}</span><span class="l">${escapeHtml(t(`bulk.stats.${k}`))}</span></div>`).join("");

  const schemaBox = $("bulkEventSchema");
  if (c.eventVariables && c.eventVariables.length) {
    schemaBox.classList.remove("hidden");
    schemaBox.innerHTML = `<strong>${escapeHtml(t("bulk.eventSchema"))}</strong>: ${c.eventVariables
      .map((ev) => `<code>${escapeHtml(ev.key)}</code>`)
      .join(", ")}`;
  } else schemaBox.classList.add("hidden");

  const rows = (rowsRes && rowsRes.rows) || [];
  $("bulkRowsBody").innerHTML = rows.map((r) => `<tr>
    <td>+${escapeHtml(r.phone)}</td>
    <td class="muted">${escapeHtml(r.externalId || "—")}</td>
    <td>${escapeHtml(r.name || "—")}</td>
    <td><span class="st-${escapeHtml(r.status)}">${escapeHtml(bulkRowStatusLabel(r.status))}</span></td>
    <td class="muted">${escapeHtml(r.error || "")}</td>
    <td>${r.sentAt ? escapeHtml(new Date(r.sentAt).toLocaleString("es", { dateStyle: "short", timeStyle: "short" })) : "—"}</td>
  </tr>`).join("");

  if (c.status !== "running") stopBulkPolling();
}

async function startBulkCampaign() {
  const id = state.activeCampaignId;
  if (!id) return;
  const res = await api(`/api/campaigns/${encodeURIComponent(id)}/start`, { method: "POST" });
  if (!res.ok) { toast(res.error || t("toast.campaignStartFailed"), "error"); return; }
  toast(t("toast.campaignStarted"), "ok");
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
    profile: t("workspace.pageTitles.profile"),
    workspace: t("workspace.pageTitles.workspace"),
    reports: t("workspace.pageTitles.reports"),
    language: t("workspace.pageTitles.language"),
  };
  if ($("wsPageTitle")) $("wsPageTitle").textContent = titles[tab] || t("workspace.title");
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
  const langSel = $("wsPortalLang");
  if (langSel && w.portalLanguage) langSel.value = w.portalLanguage;
  if ($("wsWaPhoto")) {
    if (wa.profile_picture_url) {
      $("wsWaPhoto").src = wa.profile_picture_url;
      if ($("wsWaPhotoHint")) $("wsWaPhotoHint").textContent = t("workspace.waPhotoSynced");
    } else if (wa.error) {
      if ($("wsWaPhotoHint")) $("wsWaPhotoHint").textContent = wa.error;
    } else if ($("wsWaPhotoHint")) {
      $("wsWaPhotoHint").textContent = t("workspace.waPhotoHintConnect");
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

async function savePortalLanguage() {
  const sel = $("wsPortalLang");
  if (!sel) return;
  const loc = sel.value;
  if (!I18n.LOCALES.includes(loc)) return;
  await I18n.setLocale(loc, { force: true });
  await I18n.ensureScreen(state.currentScreen || "chats", loc);
  const res = await patch("/api/workspace", { portalLanguage: loc });
  if (!res.ok) {
    toast(res.error || t("toast.languageSaveFailed"), "error");
    return;
  }
  if (state.config.workspace) state.config.workspace.portalLanguage = loc;
  toast(t("common.saved"), "ok");
  onLocaleChange();
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
  if (!res.ok) { toast(res.error || t("toast.saveFailed"), "error"); return; }
  if (res.whatsappSync && !res.whatsappSync.ok) {
    toast(t("toast.profileSavedLocalMeta", { error: res.whatsappSync.error || "no sincronizó" }), "error");
  } else {
    toast(t("toast.profileSaved"), "ok");
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
  if (!res.ok) { toast(res.error || t("toast.saveFailed"), "error"); return; }
  toast(t("toast.workspaceUpdated"), "ok");
  state.config = await api("/api/config");
  applyBranding();
  await loadWorkspace();
}

async function uploadWorkspacePhoto(file) {
  if (!file) return;
  const fd = new FormData();
  fd.append("photo", file);
  const res = await postForm("/api/workspace/profile-photo", fd);
  if (!res.ok) { toast(res.error || t("toast.photoUploadFailed"), "error"); return; }
  toast(t("toast.portalPhotoUpdated"), "ok");
  state.config = await api("/api/config");
  applyBranding();
  await loadWorkspace();
}

async function removeWorkspacePhoto() {
  const res = await api("/api/workspace/profile-photo", { method: "DELETE" });
  if (!res.ok) { toast(res.error || t("toast.removeFailed"), "error"); return; }
  toast(t("toast.photoRemoved"), "ok");
  state.config = await api("/api/config");
  applyBranding();
  await loadWorkspace();
}

async function loadWorkspaceReports() {
  const box = $("wsReportsGrid");
  if (box) box.textContent = t("workspace.reportsLoading");
  const res = await api("/api/reports/summary");
  if (!res.ok || !box) return;
  const s = res.summary;
  const cards = [
    [s.conversations.total, t("workspace.reports.conversations")],
    [s.conversations.active24h, t("workspace.reports.active24h")],
    [s.messages.inbound, t("workspace.reports.inbound")],
    [s.messages.outbound, t("workspace.reports.outbound")],
    [s.campaigns.total, t("workspace.reports.campaigns")],
    [s.campaigns.delivered, t("workspace.reports.campaignDelivered")],
    [s.templates.approved, t("workspace.reports.templatesApproved")],
    [s.templates.pending, t("workspace.reports.templatesPending")],
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

function getPayAuthFlowData() {
  const amount = formatPreviewAmount(($("payAuthAmount") || {}).value || "45.90");
  const card4 = ($("payAuthCard4") || {}).value || "4821";
  const merchant = ($("payAuthMerchant") || {}).value || "Supermercado XO";
  const now = localeDateTime(Date.now());
  const cardImg = state.cardImageUrl || "/assets/punto-pago-card.png";
  return {
    merchant,
    amount,
    card_label: t("flows.preview.cardLabel", { last4: card4 }),
    card_image: cardImg + (String(cardImg).includes("?") ? "&" : "?") + "t=" + Date.now(),
    when: now,
  };
}

function renderFlowPhonePreview(container, screen, data) {
  if (!container) return;
  const d = data || getPayAuthFlowData();
  const title = screen === "RESULT" ? t("flows.preview.resultTitle") : t("flows.preview.verifyTitle");
  let bodyHtml = "";
  let footerLabel = t("flows.studio.continue");

  if (screen === "AUTH") {
    bodyHtml = `
      <p class="flow-phone-brand">${escapeHtml(t("flows.preview.brand"))}</p>
      <h3>${escapeHtml(t("flows.preview.confirmTx"))}</h3>
      <p class="flow-phone-security">${escapeHtml(t("flows.preview.security"))}</p>
      <img class="flow-phone-img" src="${escapeHtml(d.card_image)}" alt="Tarjeta" onerror="this.src='/assets/punto-pago-card.png'" />
      <p>${escapeHtml(t("flows.preview.merchant"))}: ${escapeHtml(d.merchant)}</p>
      <p>${escapeHtml(t("flows.preview.amount"))}: ${escapeHtml(d.amount)}</p>
      <p>${escapeHtml(d.card_label)}</p>
      <p>${escapeHtml(t("flows.preview.date"))}: ${escapeHtml(d.when)}</p>
      <p class="flow-phone-caption">${escapeHtml(t("flows.preview.unrecognized"))}</p>
      <p class="flow-phone-caption">${escapeHtml(t("flows.preview.chooseOption"))}</p>
      <div class="flow-phone-radio">
        <label class="selected"><span class="dot"></span> ${escapeHtml(t("flows.preview.approve"))}</label>
        <label><span class="dot"></span> ${escapeHtml(t("flows.preview.reject"))}</label>
      </div>`;
  } else {
    bodyHtml = `
      <p class="flow-phone-brand">${escapeHtml(t("flows.preview.brand"))}</p>
      <h3>${escapeHtml(t("flows.preview.approvedTitle"))}</h3>
      <p>${escapeHtml(t("flows.preview.approvedBody"))}</p>
      <p>${escapeHtml(t("flows.preview.merchant"))}: ${escapeHtml(d.merchant)}</p>
      <p>${escapeHtml(t("flows.preview.amount"))}: ${escapeHtml(d.amount)}</p>`;
    footerLabel = t("flows.studio.close");
  }

  container.className = "flow-phone flow-phone-pp";
  container.innerHTML = `
    <div class="flow-phone-nav flow-phone-nav-pp">
      <span class="flow-phone-cancel">${escapeHtml(t("flows.preview.cancel"))}</span>
      <span class="flow-phone-title">${escapeHtml(title)}</span>
      <span class="flow-phone-menu">⋯</span>
    </div>
    <div class="flow-phone-body">${bodyHtml}</div>
    <div class="flow-phone-footer"><button type="button">${escapeHtml(footerLabel)}</button></div>
    <div class="flow-phone-managed">${escapeHtml(t("flows.preview.managedBy", { brand: brandDisplayName() }))}</div>`;
}

function updatePayAuthFlowPreview() {
  renderFlowPhonePreview($("payAuthFlowPreview"), state.payAuthFlowScreen, getPayAuthFlowData());
}

async function uploadPayAuthCardImage(file) {
  if (!file) return;
  const fd = new FormData();
  fd.append("image", file);
  const res = await postForm("/api/flows/payment-auth/card-image", fd);
  if (!res.ok) { toast(res.error || t("toast.photoUploadFailed"), "error"); return; }
  state.cardImageUrl = res.cardImageUrl;
  toast(t("toast.cardImageUpdated"), "ok");
  updatePayAuthFlowPreview();
}

function renderFlowStatsCards(stats, isPaymentAuth) {
  const box = $("flowsStatsCards");
  if (!box || !stats) return;
  const cards = [
    [stats.sent, t("flows.stats.sent")],
    [stats.opened, t("flows.stats.opened")],
    [stats.responded, t("flows.stats.responded")],
    [`${stats.completionRate || 0}%`, t("flows.stats.completionRate")],
  ];
  if (isPaymentAuth) {
    cards[2] = [stats.authorized, t("flows.stats.authorized")];
    cards[3] = [stats.denied, t("flows.stats.denied")];
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
      return `<div class="flow-activity-row">📤 +${escapeHtml(r.phone)} · ${escapeHtml(localeActivityDate(r.sentAt))}${r.mode ? ` · ${escapeHtml(r.mode)}` : ""}</div>`;
    }
    if (r.receivedAt) {
      const decision = r.responseJson && (r.responseJson.decision || (r.responseJson.payload && r.responseJson.payload.decision));
      return `<div class="flow-activity-row">✅ +${escapeHtml(r.phone)} · ${escapeHtml(localeActivityDate(r.receivedAt))}${decision ? ` · ${escapeHtml(decision)}` : ""}</div>`;
    }
    if (r.merchant) {
      const st = flowDecisionLabel(r.decision);
      return `<div class="flow-activity-row">💳 ${escapeHtml(r.merchant)} · $${escapeHtml(r.amount)} · ${escapeHtml(st)}</div>`;
    }
    return "";
  }).join("")}</div>`;
}

async function renderFlowDetailPreview(performance) {
  const box = $("flowsDetailPreview");
  if (!box) return;
  const profile = state.flowSendProfile;
  const preset = profile && profile.presetKey
    ? state.templatePresets.find((p) => p.key === profile.presetKey)
    : presetForFlowName((performance.flow && performance.flow.name) || $("flowsDetailName")?.textContent);
  const screenId = (profile && profile.defaultScreen) || "INTRO";

  if (performance.isPaymentAuth) {
    box.innerHTML = `<div class="flows-dual-preview">
        <div class="flows-preview-col"><p class="preview-step">${escapeHtml(t("flows.previewStep1"))}</p><div id="flowDetailWaPreview" class="wa-preview-phone wa-preview-compact"></div></div>
        <div class="flows-preview-col"><p class="preview-step">${escapeHtml(t("flows.previewStep2"))}</p><div id="flowDetailFlowPreview" class="flow-phone"></div></div>
      </div>`;
    const ov = tplPreviewOverrides();
    renderWaMessagePreview($("flowDetailWaPreview"), {
      headerText: t("flows.preview.waHeader"),
      bodyText: t("flows.preview.waBody", {
        name: ov.nombre_cliente,
        amount: ov.monto,
        merchant: ov.comercio,
        last4: ov.ultimos_4,
      }),
      footerText: t("flows.preview.waFooter"),
      flowCta: t("flows.preview.waCta"),
    });
    renderFlowPhonePreview($("flowDetailFlowPreview"), "AUTH", getPayAuthFlowData());
    return;
  }

  if (profile && profile.screens && profile.screens.length) {
    box.innerHTML = `<div class="flows-dual-preview">
        <div class="flows-preview-col"><p class="preview-step">${escapeHtml(t("flows.previewStep1"))}</p><div id="flowDetailWaPreview" class="wa-preview-phone wa-preview-compact"></div></div>
        <div class="flows-preview-col"><p class="preview-step">${escapeHtml(t("flows.previewStep2"))}</p>
          <div id="flowDetailJourney" class="flows-send-journey-steps-wrap"></div>
          <div id="flowDetailFlowPreview" class="flow-phone"></div>
        </div>
      </div>`;
    let waData = { bodyText: (profile.sendDefaults && profile.sendDefaults.bodyText) || "—", flowCta: profile.defaultCta };
    if (preset) {
      const res = await fetchPresetPreview(preset.key, { nombre_cliente: "Cliente" });
      if (res && res.preview) {
        waData = {
          headerText: res.preview.headerText,
          bodyText: res.preview.bodyText,
          footerText: res.preview.footerText,
          flowCta: res.preview.flowCta,
        };
      }
    }
    renderWaMessagePreview($("flowDetailWaPreview"), waData);
    renderFlowJourneyPicker("flowDetailJourney", profile.screens, screenId, (id) => {
      renderFlowScreenPreview($("flowDetailFlowPreview"), id, profile);
    });
    renderFlowScreenPreview($("flowDetailFlowPreview"), screenId, profile);
    return;
  }

  box.innerHTML = `<p class="muted sm center-msg">${escapeHtml(t("flows.noPreview"))}</p>`;
}

function renderFlowHealthPanel(flow) {
  const panel = $("flowsHealthPanel");
  if (!panel) return;
  if (!flow) {
    panel.classList.add("hidden");
    panel.innerHTML = "";
    return;
  }
  const hs = flow.health_status || {};
  const canSend = hs.can_send_message;
  let canSendLabel = t("flows.healthUnknown");
  if (canSend === "AVAILABLE" || canSend === true) canSendLabel = t("flows.healthAvailable");
  else if (canSend) canSendLabel = String(canSend);
  const endpointLabel = flow.endpoint_uri ? t("flows.healthYes") : t("flows.healthNo");
  panel.classList.remove("hidden");
  panel.innerHTML = `
    <div class="flows-health-grid">
      <div><span class="flows-health-label">${escapeHtml(t("flows.healthTitle"))}</span></div>
      <div class="flows-health-row"><span>${escapeHtml(t("flows.healthCanSend"))}</span><strong>${escapeHtml(canSendLabel)}</strong></div>
      <div class="flows-health-row"><span>${escapeHtml(t("flows.healthEndpoint"))}</span><strong>${escapeHtml(endpointLabel)}</strong></div>
      ${flow.endpoint_uri ? `<div class="flows-health-uri muted sm">${escapeHtml(flow.endpoint_uri)}</div>` : ""}
    </div>`;
}

function renderFlowValidationPanel(flow) {
  const panel = $("flowsValidationPanel");
  if (!panel) return;
  const errs = flow && flow.validation_errors;
  if (!errs || !errs.length) {
    panel.classList.add("hidden");
    panel.innerHTML = "";
    return;
  }
  panel.classList.remove("hidden");
  panel.innerHTML = `
    <strong class="flows-validation-title">${escapeHtml(t("flows.validationErrors"))}</strong>
    <ul class="flows-validation-list">${errs.map((e) =>
      `<li>${escapeHtml(e.message || e.error || JSON.stringify(e))}</li>`
    ).join("")}</ul>`;
}

function syncFlowEditButton(status) {
  const btn = $("flowEditDraftBtn");
  if (!btn) return;
  const isDraft = String(status || "").toUpperCase() === "DRAFT";
  btn.classList.toggle("hidden", !isDraft);
}

function syncFsDynamicUi() {
  const on = Boolean(($("fsDynamic") || {}).checked);
  $("fsDynamicHandlerWrap")?.classList.toggle("hidden", !on);
  $("fsDynamicHint")?.classList.toggle("hidden", !on);
  const handler = ($("fsDynamicHandler") || {}).value || "generic";
  const hint = $("fsDynamicHint");
  if (hint && on) {
    hint.textContent = handler === "booking"
      ? t("flows.studio.dynamicBookingHint")
      : t("flows.studio.dynamicHint");
  }
}

function syncFlowLifecycleButtons(status) {
  const st = String(status || "").toUpperCase();
  $("flowDeleteBtn")?.classList.toggle("hidden", st !== "DRAFT");
  $("flowDeprecateBtn")?.classList.toggle("hidden", st !== "PUBLISHED");
}

async function deleteActiveFlow() {
  const id = state.activeFlowId;
  if (!id) return;
  const name = ($("flowsDetailName") || {}).textContent || id;
  if (!window.confirm(t("flows.deleteConfirm", { name }))) return;
  const res = await del(`/api/flows/${encodeURIComponent(id)}`);
  if (!res.ok) {
    toast(res.error || t("toast.flowDeleteFailed"), "error");
    return;
  }
  toast(t("toast.flowDeleted"), "ok");
  state.activeFlowId = null;
  state.activeFlowDetail = null;
  $("flowsDetailPanel")?.classList.add("hidden");
  $("flowsEmptyDetail")?.classList.remove("hidden");
  await loadFlows();
}

async function deprecateActiveFlow() {
  const id = state.activeFlowId;
  if (!id) return;
  const name = ($("flowsDetailName") || {}).textContent || id;
  if (!window.confirm(t("flows.deprecateConfirm", { name }))) return;
  const res = await post(`/api/flows/${encodeURIComponent(id)}/deprecate`, {});
  if (!res.ok) {
    toast(res.error || t("toast.flowDeprecateFailed"), "error");
    return;
  }
  toast(t("toast.flowDeprecated"), "ok");
  await loadFlows();
  if (state.activeFlowId === id) {
    const detail = await api(`/api/flows/${encodeURIComponent(id)}`);
    state.activeFlowDetail = detail.ok ? detail.flow : null;
    await loadFlowDetail(id);
  }
}

async function createFlowTemplate(opts = {}) {
  const id = opts.flowId || state.activeFlowId;
  if (!id) {
    toast(t("toast.selectFlow"), "error");
    return;
  }
  const def = opts.def || {};
  const profile = state.flowSendProfile || {};
  const defaults = profile.sendDefaults || {};
  const slug = String(def.name || state.activeFlowDetail?.name || "flow")
    .replace(/[^a-z0-9_]/gi, "_")
    .slice(0, 40);
  const bodyText = opts.bodyText || def.chatBody || defaults.bodyText || t("flows.studio.defaultChatBody");
  const cta = opts.cta || def.cta || defaults.cta || profile.defaultCta || t("flows.studio.defaultCta");
  const screen = opts.screen || defaults.screen || profile.defaultScreen || "SCREEN_A";
  const res = await post(`/api/flows/${encodeURIComponent(id)}/template`, {
    name: opts.name || `${slug}_mensaje`,
    bodyText,
    cta: String(cta).slice(0, 25),
    screen,
    category: def.category || "UTILITY",
    footerText: opts.footerText || "Punto Pago",
  });
  if (!res.ok) {
    toast(res.error || t("toast.templateCreateFailed"), "error");
    return;
  }
  toast(t("toast.flowTemplateSubmitted", { name: res.name }), "ok");
  return res;
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
    stEl.textContent = flowStatusLabel(st);
    stEl.className = "flow-status " + st;
  }
  syncFlowPublishButton(st);
  syncFlowEditButton(st);
  syncFlowLifecycleButtons(st);
  renderFlowHealthPanel(state.activeFlowDetail);
  renderFlowValidationPanel(state.activeFlowDetail);
  renderFlowStatsCards(perfRes.stats, perfRes.isPaymentAuth);
  $("flowsDetailSends").innerHTML = renderFlowActivityList(perfRes.recentSends, t("flows.emptySends"));
  const respRows = perfRes.isPaymentAuth && perfRes.recentPayAuth.length
    ? perfRes.recentPayAuth
    : perfRes.recentResponses;
  $("flowsDetailResponses").innerHTML = renderFlowActivityList(
    respRows,
    t("flows.emptyResponses")
  );
  await renderFlowDetailPreview(perfRes);
  const probarBtn = $("flowDetailProbarBtn");
  if (probarBtn) probarBtn.classList.remove("hidden");
  setFlowsDetailTab(state.flowsDetailTab || "preview");
  $("flowsDetailPanel").classList.remove("hidden");
  $("flowsEmptyDetail").classList.add("hidden");
  renderFlowTemplateLink(perfRes);
}

const fsState = {
  schema: null,
  activeIndex: 0,
  screens: [],
  editingFlowId: null,
};
let fsFormatCtx = null;
let fsPersistedCtx = null;
let fsFormatBarBound = false;
let fsInsertMenuBound = false;

function setFsFormatCtx(ctx) {
  fsFormatCtx = ctx;
  if (ctx) fsPersistedCtx = { ...ctx };
}

const FS_LAYOUTS = ["message", "form", "confirm"];
const FS_TEXT_SIZE_ORDER = ["caption", "body", "subheading", "heading"];

function defaultFsScreens() {
  return [
    {
      layout: "message",
      title: t("flows.defaults.step1Title"),
      blocks: [
        { type: "heading", text: t("flows.defaults.step1Heading") },
        { type: "body", text: t("flows.defaults.step1Body"), emphasis: "normal" },
      ],
      buttonLabel: t("flows.studio.continue"),
      buttonAction: "next",
      fields: [],
    },
    {
      layout: "form",
      title: t("flows.defaults.step2Title"),
      blocks: [
        { type: "heading", text: t("flows.defaults.step2Heading") },
        { type: "body", text: t("flows.defaults.step2Body"), emphasis: "normal" },
      ],
      buttonLabel: t("flows.studio.submit"),
      buttonAction: "next",
      fields: [{ type: "text", label: t("flows.studio.defaultFieldName"), required: true }],
    },
    {
      layout: "confirm",
      title: t("flows.defaults.thanksTitle"),
      blocks: [
        { type: "heading", text: t("flows.defaults.thanksHeading") },
        { type: "body", text: t("flows.defaults.thanksBody"), emphasis: "normal" },
      ],
      buttonLabel: t("flows.studio.close"),
      buttonAction: "complete",
      fields: [],
    },
  ];
}

function ensureScreenBlocks(scr) {
  if (!scr) return;
  if (Array.isArray(scr.blocks) && scr.blocks.length) return;
  scr.blocks = [];
  if (scr.heading) scr.blocks.push({ type: "heading", text: scr.heading });
  if (scr.body) scr.blocks.push({ type: "body", text: scr.body, emphasis: "normal" });
  if (scr.image && (scr.image.previewUrl || scr.image.src)) {
    scr.blocks.push({ type: "image", ...scr.image });
  }
  if (!scr.blocks.length) {
    scr.blocks.push({ type: "heading", text: t("flows.studio.newScreenHeading") });
    scr.blocks.push({ type: "body", text: t("flows.studio.newScreenBody"), emphasis: "normal" });
  }
}

function syncScreenLegacyFromBlocks(scr) {
  if (!scr || !Array.isArray(scr.blocks)) return;
  const heading = scr.blocks.find((b) => b.type === "heading");
  const body = scr.blocks.find((b) => b.type === "body");
  const image = scr.blocks.find((b) => b.type === "image");
  scr.heading = heading?.text || "";
  scr.body = body?.text || "";
  if (image) scr.image = { ...image };
  else delete scr.image;
  scr.title = (scr.heading || scr.title || t("flows.studio.step", { n: 1 })).slice(0, 40);
}

function fsBlockLabel(type) {
  const bt = (fsState.schema?.blockTypes || []).find((b) => b.id === type);
  if (bt) return bt.label;
  const map = {
    heading: t("flows.studio.blockHeading"),
    subheading: t("flows.studio.blockSubheading"),
    body: t("flows.studio.blockBody"),
    caption: t("flows.studio.blockCaption"),
    image: t("flows.studio.blockImage"),
    link: t("flows.studio.blockLink"),
    richtext: t("flows.studio.blockRichText"),
    carousel: t("flows.studio.blockCarousel"),
  };
  return map[type] || type;
}

async function initFlowStudio() {
  initFsFormatBar();
  initFsInsertMenu();
  if (window.I18n) await I18n.ensureScreen("flows");
  if (!fsState.schema) {
    const res = await api("/api/flows/builder/schema");
    fsState.schema = (res && res.schema) || { fieldTypes: [], categories: [], limits: { maxScreens: 8 } };
    const catSel = $("fsCategory");
    if (catSel) {
      catSel.innerHTML = (fsState.schema.categories || [])
        .map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.label)}</option>`)
        .join("");
    }
    const handlerSel = $("fsDynamicHandler");
    if (handlerSel && !handlerSel.dataset.ready) {
      handlerSel.innerHTML = (fsState.schema.dynamicHandlers || [
        { id: "generic", label: "Genérico" },
        { id: "quote", label: "Cotización" },
        { id: "booking", label: "Reservas" },
      ]).map((h) => `<option value="${escapeHtml(h.id)}">${escapeHtml(h.label)}</option>`).join("");
      handlerSel.dataset.ready = "1";
    }
  }
  if ($("fsDynamic") && !$("fsDynamic").dataset.bound) {
    $("fsDynamic").addEventListener("change", syncFsDynamicUi);
    $("fsDynamicHandler")?.addEventListener("change", syncFsDynamicUi);
    $("fsDynamic").dataset.bound = "1";
  }
  syncFsDynamicUi();
  if (!fsState.screens.length && !fsState.editingFlowId) fsState.screens = defaultFsScreens();
  fsState.activeIndex = 0;
  syncFsStudioEditUi();
  if ($("fsName") && !$("fsName").value) $("fsName").value = "";
  repairFlowStudioTranslations();
  syncFlowStudioFormDefaults();
  fsState.screens.forEach(ensureScreenBlocks);
  renderFlowStudio();
}

function fsActiveScreen() {
  return fsState.screens[fsState.activeIndex] || fsState.screens[0];
}

function syncFsPreviewScreen(index, wrap) {
  const scr = fsState.screens[index];
  if (!scr || !wrap) return;
  ensureScreenBlocks(scr);
  const titleEl = wrap.querySelector(".fs-ed-title");
  if (titleEl) scr.title = titleEl.textContent.trim().slice(0, 40);
  wrap.querySelectorAll(".fs-ed-block").forEach((blockEl) => {
    const bi = Number(blockEl.dataset.bi);
    const block = scr.blocks[bi];
    if (!block) return;
    if (block.type === "image") {
      block.altText = (blockEl.querySelector(".fs-b-alt") || {}).value || "";
      block.scaleType = (blockEl.querySelector(".fs-b-scale") || {}).value || "contain";
    } else if (block.type === "link") {
      block.text = (blockEl.querySelector(".fs-b-link-text") || {}).value || "";
      block.url = (blockEl.querySelector(".fs-b-link-url") || {}).value || "";
    } else if (block.type === "richtext") {
      block.markdown = (blockEl.querySelector(".fs-b-richtext") || {}).value || "";
    } else {
      const textEl = blockEl.querySelector(".fs-ed-text");
      if (textEl) block.text = textEl.textContent.trim();
      if (block.type === "body" || block.type === "caption") {
        block.emphasis = block.emphasis || "normal";
      }
    }
  });
  if (scr.layout === "form") {
    const fieldRows = wrap.querySelectorAll(".fs-ed-field");
    if (fieldRows.length) {
      scr.fields = [];
      fieldRows.forEach((row) => {
        const type = (row.querySelector(".fs-f-type") || {}).value || "text";
        const field = {
          type,
          label: (row.querySelector(".fs-f-label") || {}).value || "",
          required: true,
        };
        const optsRaw = (row.querySelector(".fs-f-opts") || {}).value || "";
        if (type === "select" || type === "checkbox") {
          field.options = optsRaw.split(",").map((s) => s.trim()).filter(Boolean);
        }
        scr.fields.push(field);
      });
    } else {
      scr.fields = scr.fields || [];
    }
  }
  const footer = wrap.querySelector(".fs-ed-footer-btn");
  if (footer) scr.buttonLabel = footer.value.trim();
  const nextSel = wrap.querySelector(".fs-next-target-sel");
  if (nextSel) scr.nextTarget = nextSel.value;
  const screenIndex = Number(wrap.dataset.fsI);
  const isLast = screenIndex === fsState.screens.length - 1;
  scr.buttonAction = (scr.layout === "confirm" || isLast) ? "complete" : "next";
  const layoutSel = wrap.querySelector(".fs-layout-sel");
  if (layoutSel) scr.layout = layoutSel.value;
  syncScreenLegacyFromBlocks(scr);
}

function syncFsFromAllPreviews() {
  const row = $("fsPreviewRow");
  if (!row) return;
  row.querySelectorAll(".fs-phone-wrap").forEach((wrap) => {
    syncFsPreviewScreen(Number(wrap.dataset.fsI), wrap);
  });
}

function fsEmphasisClass(emphasis) {
  if (!emphasis || emphasis === "normal") return "";
  return ` fs-em-${emphasis.replace(/_/g, "-")}`;
}

function hideFsFormatBar() {
  $("fsFormatBar")?.classList.add("hidden");
  fsFormatCtx = null;
}

function updateFsFormatBarState() {
  const bar = $("fsFormatBar");
  if (!bar || !fsFormatCtx) return;
  const scr = fsState.screens[fsFormatCtx.screenIndex];
  const isField = fsFormatCtx.kind === "field";
  const block = !isField ? scr?.blocks?.[fsFormatCtx.blockIndex] : null;
  const isImage = block?.type === "image";
  const canEmphasis = !isField && block && (block.type === "body" || block.type === "caption");
  const maxBlocks = fsState.schema?.limits?.maxBlocksPerScreen || 10;
  bar.querySelectorAll("[data-fmt='bold'], [data-fmt='italic']").forEach((btn) => {
    const fmt = btn.dataset.fmt;
    const emph = block?.emphasis || "normal";
    const on = fmt === "bold" ? emph.includes("bold") : emph.includes("italic");
    btn.classList.toggle("active", canEmphasis && on);
    btn.disabled = isField || !canEmphasis || isImage;
    btn.classList.toggle("disabled", isField || !canEmphasis || isImage);
  });
  const sizeIdx = block && !isImage ? FS_TEXT_SIZE_ORDER.indexOf(block.type) : -1;
  bar.querySelectorAll("[data-fmt='size-up'], [data-fmt='size-down']").forEach((btn) => {
    const hidden = isField || isImage || sizeIdx < 0;
    const atMax = sizeIdx >= FS_TEXT_SIZE_ORDER.length - 1;
    const atMin = sizeIdx <= 0;
    const disabled = hidden || (btn.dataset.fmt === "size-up" ? atMax : atMin);
    btn.disabled = disabled;
    btn.classList.toggle("disabled", disabled);
  });
  bar.querySelectorAll("[data-fmt-type]").forEach((btn) => {
    const hidden = isField || isImage;
    btn.classList.toggle("active", !hidden && block?.type === btn.dataset.fmtType);
    btn.disabled = hidden;
    btn.classList.toggle("disabled", hidden);
  });
  bar.classList.toggle("fs-format-bar-image", Boolean(!isField && isImage));
  bar.classList.toggle("fs-format-bar-field", Boolean(isField));
}

function positionFsFormatBar(rect) {
  const bar = $("fsFormatBar");
  if (!bar || !rect || (rect.width === 0 && rect.height === 0)) return;
  bar.classList.remove("hidden");
  const w = bar.offsetWidth || 220;
  const h = bar.offsetHeight || 36;
  let left = rect.left + rect.width / 2 - w / 2;
  let top = rect.top - h - 10;
  left = Math.max(12, Math.min(left, window.innerWidth - w - 12));
  top = Math.max(12, top);
  bar.style.left = `${left}px`;
  bar.style.top = `${top}px`;
}

function onFsTextSelection() {
  const panel = $("flowsPanelCrear");
  if (!panel || panel.classList.contains("hidden")) {
    hideFsFormatBar();
    return;
  }
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
    const active = document.activeElement;
    if (active?.closest?.("#fsFormatBar, #fsInsertMenu")) return;
    if ($("fsInsertMenu") && !$("fsInsertMenu").classList.contains("hidden")) return;
    hideFsFormatBar();
    return;
  }
  const anchor = sel.anchorNode;
  const focus = sel.focusNode;
  const el = (anchor?.nodeType === 3 ? anchor.parentElement : anchor);
  const focusEl = (focus?.nodeType === 3 ? focus.parentElement : focus);
  const editable = el?.closest?.(".fs-ed-text");
  if (!editable || editable !== focusEl?.closest?.(".fs-ed-text")) {
    hideFsFormatBar();
    return;
  }
  const blockEl = editable.closest(".fs-ed-block");
  const wrap = editable.closest(".fs-phone-wrap");
  if (!blockEl || !wrap || blockEl.dataset.blockType === "image") {
    hideFsFormatBar();
    return;
  }
  setFsFormatCtx({
    kind: "block",
    screenIndex: Number(wrap.dataset.fsI),
    blockIndex: Number(blockEl.dataset.bi),
    editable,
  });
  fsState.activeIndex = fsFormatCtx.screenIndex;
  const range = sel.getRangeAt(0);
  positionFsFormatBar(range.getBoundingClientRect());
  updateFsFormatBarState();
}

function toggleFsBlockEmphasis(kind) {
  if (!fsFormatCtx) return;
  syncFsFromAllPreviews();
  const scr = fsState.screens[fsFormatCtx.screenIndex];
  const block = scr?.blocks?.[fsFormatCtx.blockIndex];
  if (!block || (block.type !== "body" && block.type !== "caption")) return;
  let emph = block.emphasis || "normal";
  const hasBold = emph.includes("bold");
  const hasItalic = emph.includes("italic");
  if (kind === "bold") {
    emph = hasBold
      ? (hasItalic ? "italic" : "normal")
      : (hasItalic ? "bold_italic" : "bold");
  } else {
    emph = hasItalic
      ? (hasBold ? "bold" : "normal")
      : (hasBold ? "bold_italic" : "italic");
  }
  block.emphasis = emph;
  const el = fsFormatCtx.editable;
  if (el) {
    el.classList.remove("fs-em-bold", "fs-em-italic", "fs-em-bold-italic");
    const cls = fsEmphasisClass(emph).trim();
    if (cls) el.classList.add(cls);
  }
  updateFsFormatBarState();
}

function setFsBlockType(type, keepBar) {
  if (!fsFormatCtx) return;
  syncFsFromAllPreviews();
  const i = fsFormatCtx.screenIndex;
  const bi = fsFormatCtx.blockIndex;
  const scr = fsState.screens[i];
  const block = scr?.blocks?.[bi];
  if (!block || block.type === type || block.type === "image") return;
  block.type = type;
  if (type === "body" || type === "caption") {
    block.emphasis = block.emphasis || "normal";
  } else {
    delete block.emphasis;
  }
  fsState.activeIndex = i;
  if (!keepBar) hideFsFormatBar();
  renderFlowStudio();
  if (keepBar) {
    requestAnimationFrame(() => {
      const wrap = $(`fsPhone${i}`) || $("fsPreviewRow")?.querySelector(`[data-fs-i="${i}"]`);
      const blockEl = wrap?.querySelector(`.fs-ed-block[data-bi="${bi}"]`);
      if (blockEl) showFsFormatBarForBlock(blockEl, wrap);
    });
  }
}

function stepFsBlockSize(delta) {
  if (!fsFormatCtx || fsFormatCtx.kind === "field") return;
  syncFsFromAllPreviews();
  const block = fsState.screens[fsFormatCtx.screenIndex]?.blocks?.[fsFormatCtx.blockIndex];
  if (!block || block.type === "image") return;
  let idx = FS_TEXT_SIZE_ORDER.indexOf(block.type);
  if (idx < 0) idx = 1;
  const next = idx + delta;
  if (next < 0 || next >= FS_TEXT_SIZE_ORDER.length) return;
  setFsBlockType(FS_TEXT_SIZE_ORDER[next], true);
}

function fsRemoveBlockAt(screenIndex, blockIndex) {
  syncFsFromAllPreviews();
  const scr = fsState.screens[screenIndex];
  if (!scr) return;
  if (scr.blocks.length <= 1) {
    toast(t("toast.minOneBlock"), "error");
    return;
  }
  scr.blocks.splice(blockIndex, 1);
  fsState.activeIndex = screenIndex;
  hideFsFormatBar();
  hideFsInsertMenu();
  renderFlowStudio();
}

function showFsFormatBarForBlock(blockEl, wrap) {
  if (!blockEl || !wrap) return;
  setFsFormatCtx({
    kind: "block",
    screenIndex: Number(wrap.dataset.fsI),
    blockIndex: Number(blockEl.dataset.bi),
    editable: blockEl.querySelector(".fs-ed-text"),
  });
  fsState.activeIndex = fsFormatCtx.screenIndex;
  const rect = (fsFormatCtx.editable || blockEl).getBoundingClientRect();
  positionFsFormatBar(rect);
  updateFsFormatBarState();
}

function initFsInsertMenu() {
  if (fsInsertMenuBound) return;
  const menu = $("fsInsertMenu");
  if (!menu) return;
  fsInsertMenuBound = true;
  menu.addEventListener("click", (e) => {
    const btn = e.target.closest(".fs-insert-menu-item");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const type = btn.dataset.insertType;
    const i = Number(menu.dataset.screen);
    const at = Number(menu.dataset.at);
    if (menu.dataset.kind === "field" || btn.dataset.insertKind === "field") {
      const fieldAt = menu.dataset.kind === "field" ? at : (fsState.screens[i]?.fields || []).length;
      fsInsertFieldAt(i, fieldAt, type);
    } else fsInsertBlockAt(i, at, type);
    hideFsInsertMenu();
  });
}

function initFsFormatBar() {
  if (fsFormatBarBound) return;
  const bar = $("fsFormatBar");
  if (!bar) return;
  fsFormatBarBound = true;
  initFsInsertMenu();
  document.addEventListener("mousedown", (e) => {
    if (e.target.closest("#fsInsertMenu")) return;
    if (e.target.closest("#fsFormatBar")) return;
    hideFsInsertMenu();
  });
  bar.querySelectorAll(".fs-fmt-btn").forEach((btn) => {
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (btn.dataset.fmt === "size-up") {
        stepFsBlockSize(1);
        return;
      }
      if (btn.dataset.fmt === "size-down") {
        stepFsBlockSize(-1);
        return;
      }
      if (btn.dataset.fmt === "bold" || btn.dataset.fmt === "italic") {
        toggleFsBlockEmphasis(btn.dataset.fmt);
        return;
      }
      if (btn.dataset.fmtType) setFsBlockType(btn.dataset.fmtType);
    });
  });
  document.addEventListener("selectionchange", () => {
    window.requestAnimationFrame(onFsTextSelection);
  });
  document.addEventListener("mousedown", (e) => {
    if (e.target.closest("#fsFormatBar, #fsInsertMenu, .fs-ed-block, .fs-ed-field, .fs-insert-line")) return;
    hideFsFormatBar();
  });
  window.addEventListener("scroll", hideFsFormatBar, true);
  $("fsPreviewRow")?.addEventListener("scroll", hideFsFormatBar);
}

function fsFieldTypeMenuItems() {
  const fromSchema = fsState.schema?.fieldTypes;
  if (fromSchema && fromSchema.length) return fromSchema;
  return [
    { id: "text", label: t("flows.studio.defaultFieldName") },
    { id: "textarea", label: t("flows.studio.fieldTextarea") || "Texto largo" },
    { id: "number", label: t("flows.studio.fieldNumber") || "Número" },
    { id: "email", label: "Email" },
    { id: "phone", label: t("flows.studio.fieldPhone") || "Teléfono" },
    { id: "select", label: t("flows.studio.fieldSelect") },
    { id: "yesno", label: t("flows.studio.fieldYesNo") || "Sí / No" },
    { id: "rating", label: t("flows.studio.fieldRating") || "Calificación" },
    { id: "date", label: t("flows.studio.fieldDate") },
    { id: "calendar", label: t("flows.studio.fieldCalendar") || "Calendario" },
    { id: "optin", label: t("flows.studio.fieldOptin") || "Aceptación" },
    { id: "checkbox", label: t("flows.studio.fieldCheckbox") || "Varias opciones" },
  ];
}

function fsBlockTypeMenuItems() {
  const fromSchema = fsState.schema?.blockTypes;
  if (fromSchema && fromSchema.length) return fromSchema;
  return [
    { id: "heading", label: t("flows.studio.blockHeading") },
    { id: "subheading", label: t("flows.studio.blockSubheading") },
    { id: "body", label: t("flows.studio.blockBody") },
    { id: "caption", label: t("flows.studio.blockCaption") },
    { id: "image", label: t("flows.studio.blockImage") },
    { id: "link", label: t("flows.studio.blockLink") },
    { id: "richtext", label: t("flows.studio.blockRichText") },
    { id: "carousel", label: t("flows.studio.blockCarousel") },
  ];
}

function buildFsInsertMenuHtml(kind, screenIndex) {
  const scr = fsState.screens[screenIndex];
  const blocks = kind === "field" ? [] : fsBlockTypeMenuItems();
  const showFields = kind === "field" || (scr && scr.layout !== "confirm");
  const fields = showFields ? fsFieldTypeMenuItems() : [];
  let html = blocks.map((item) =>
    `<button type="button" class="fs-insert-menu-item" role="menuitem" data-insert-type="${escapeHtml(item.id)}" data-insert-kind="block">${escapeHtml(item.label)}</button>`
  ).join("");
  if (kind !== "field" && fields.length) {
    html += `<div class="fs-insert-menu-sep" role="presentation">${escapeHtml(t("flows.studio.insertMenuFields"))}</div>`;
    html += fields.map((item) =>
      `<button type="button" class="fs-insert-menu-item" role="menuitem" data-insert-type="${escapeHtml(item.id)}" data-insert-kind="field">${escapeHtml(item.label)}</button>`
    ).join("");
  }
  if (kind === "field") {
    html = fields.map((item) =>
      `<button type="button" class="fs-insert-menu-item" role="menuitem" data-insert-type="${escapeHtml(item.id)}" data-insert-kind="field">${escapeHtml(item.label)}</button>`
    ).join("");
  }
  return html;
}

function fsFieldTypeOptions(selected) {
  return fsFieldTypeMenuItems().map((ft) =>
    `<option value="${escapeHtml(ft.id)}"${ft.id === selected ? " selected" : ""}>${escapeHtml(ft.label)}</option>`
  ).join("");
}

function hideFsInsertMenu() {
  const menu = $("fsInsertMenu");
  if (!menu) return;
  menu.classList.add("hidden");
  document.querySelectorAll(".fs-insert-line.is-open").forEach((el) => el.classList.remove("is-open"));
}

function showFsInsertMenu(anchorBtn, kind, screenIndex, insertAt) {
  const menu = $("fsInsertMenu");
  const anchor = anchorBtn;
  if (!menu || !anchor) return;
  hideFsInsertMenu();
  anchor.closest(".fs-insert-line")?.classList.add("is-open");
  menu.innerHTML = buildFsInsertMenuHtml(kind, screenIndex);
  menu.dataset.screen = String(screenIndex);
  menu.dataset.at = String(insertAt);
  menu.dataset.kind = kind;
  menu.classList.remove("hidden");
  const placeMenu = () => {
    const rect = anchor.getBoundingClientRect();
    const mw = menu.offsetWidth || 168;
    let left = rect.left;
    let top = rect.bottom + 6;
    left = Math.max(12, Math.min(left, window.innerWidth - mw - 12));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  };
  placeMenu();
  requestAnimationFrame(placeMenu);
}

function fsInsertBlockAt(screenIndex, insertAt, type) {
  syncFsFromAllPreviews();
  const scr = fsState.screens[screenIndex];
  if (!scr) return;
  ensureScreenBlocks(scr);
  const max = fsState.schema?.limits?.maxBlocksPerScreen || 10;
  if (scr.blocks.length >= max) {
    toast(t("toast.maxBlocks", { max }), "error");
    return;
  }
  const block = { type };
  if (type === "body" || type === "caption") block.emphasis = "normal";
  if (type === "image") {
    block.altText = t("flows.studio.imageAltDefault");
    block.scaleType = "contain";
  } else if (type === "link") {
    block.text = t("flows.studio.linkTextDefault");
    block.url = "";
  } else if (type === "richtext") {
    block.markdown = t("flows.studio.richtextDefault");
  } else if (type === "carousel") {
    block.scaleType = "contain";
    block.images = [];
  } else {
    block.text = "";
  }
  const at = Math.max(0, Math.min(insertAt, scr.blocks.length));
  scr.blocks.splice(at, 0, block);
  fsState.activeIndex = screenIndex;
  setFsFormatCtx({ kind: "block", screenIndex, blockIndex: at, editable: null });
  renderFlowStudio();
  requestAnimationFrame(() => {
    const wrap = $(`fsPhone${screenIndex}`) || $("fsPreviewRow")?.querySelector(`[data-fs-i="${screenIndex}"]`);
    const blockEl = wrap?.querySelector(`.fs-ed-block[data-bi="${at}"]`);
    if (blockEl) showFsFormatBarForBlock(blockEl, wrap);
  });
}

function fsInsertFieldAt(screenIndex, insertAt, type) {
  syncFsFromAllPreviews();
  const scr = fsState.screens[screenIndex];
  if (!scr) return;
  if (scr.layout !== "form") {
    scr.layout = "form";
    toast(t("flows.studio.switchedToForm"), "info");
  }
  scr.fields = scr.fields || [];
  const maxFields = fsState.schema?.limits?.maxFieldsPerScreen || 12;
  if (scr.fields.length >= maxFields) {
    toast(t("toast.maxFields", { max: maxFields }), "error");
    return;
  }
  const at = Math.max(0, Math.min(insertAt, scr.fields.length));
  scr.fields.splice(at, 0, { type: type || "text", label: "", required: true });
  fsState.activeIndex = screenIndex;
  setFsFormatCtx({ kind: "field", screenIndex, fieldIndex: at });
  renderFlowStudio();
  requestAnimationFrame(() => {
    const wrap = $(`fsPhone${screenIndex}`) || $("fsPreviewRow")?.querySelector(`[data-fs-i="${screenIndex}"]`);
    const input = wrap?.querySelector(`.fs-ed-field[data-fi="${at}"] .fs-f-label`);
    if (input) {
      input.focus();
      positionFsFormatBar(input.getBoundingClientRect());
      updateFsFormatBarState();
    }
  });
}

function fsInsertLineHtml(at) {
  return `<div class="fs-insert-line" data-insert-at="${at}">
    <button type="button" class="fs-insert-plus" title="${escapeHtml(t("flows.studio.insertAddContent"))}">+</button>
  </div>`;
}

function fsBlocksEditorHtml(scr, screenIndex) {
  const blocks = scr.blocks || [];
  let html = fsInsertLineHtml(0);
  blocks.forEach((b, bi) => {
    html += fsEditableBlockHtml(b, bi, screenIndex);
    html += fsInsertLineHtml(bi + 1);
  });
  return html;
}

function fsEditableBlockHtml(b, bi, screenIndex) {
  const blockCount = fsState.screens[screenIndex]?.blocks?.length || 0;
  const removeBtn = blockCount > 1
    ? `<button type="button" class="fs-block-remove" title="${escapeHtml(t("flows.studio.removeBlock"))}">−</button>`
    : "";
  if (b.type === "image") {
    const preview = b.previewUrl || (b.src ? `data:image/png;base64,${b.src}` : "");
    return `
      <div class="fs-ed-block" data-bi="${bi}" data-block-type="image">
        ${removeBtn}
        ${preview ? `<img class="fs-preview-img" src="${escapeHtml(preview)}" alt="" />` : `<div class="fs-preview-img fs-preview-img-empty muted sm">${escapeHtml(t("flows.studio.noImageYet"))}</div>`}
        <label class="flows-upload-label sm fs-ed-upload"><span>${escapeHtml(t("flows.studio.uploadImage"))}</span>
          <input type="file" accept="image/png,image/jpeg" class="fs-block-file" data-bi="${bi}" />
        </label>
        <input type="text" class="fs-b-alt sm" placeholder="${escapeHtml(t("flows.studio.imageAlt"))}" value="${escapeHtml(b.altText || "")}" />
        <select class="fs-b-scale sm">
          <option value="contain"${b.scaleType !== "cover" ? " selected" : ""}>${escapeHtml(t("flows.studio.scaleContain"))}</option>
          <option value="cover"${b.scaleType === "cover" ? " selected" : ""}>${escapeHtml(t("flows.studio.scaleCover"))}</option>
        </select>
      </div>`;
  }
  if (b.type === "link") {
    return `
      <div class="fs-ed-block" data-bi="${bi}" data-block-type="link">
        ${removeBtn}
        <input type="text" class="fs-b-link-text" placeholder="${escapeHtml(t("flows.studio.linkTextPh"))}" value="${escapeHtml(b.text || "")}" />
        <input type="url" class="fs-b-link-url sm" placeholder="${escapeHtml(t("flows.studio.linkUrlPh"))}" value="${escapeHtml(b.url || "")}" />
      </div>`;
  }
  if (b.type === "richtext") {
    return `
      <div class="fs-ed-block" data-bi="${bi}" data-block-type="richtext">
        ${removeBtn}
        <textarea class="fs-b-richtext sm" placeholder="${escapeHtml(t("flows.studio.richtextPh"))}">${escapeHtml(b.markdown || b.text || "")}</textarea>
      </div>`;
  }
  if (b.type === "carousel") {
    const imgs = b.images || [];
    const thumbs = imgs.map((img) => {
      const preview = img.previewUrl || (img.src ? `data:image/png;base64,${img.src}` : "");
      return preview ? `<img class="fs-carousel-thumb" src="${escapeHtml(preview)}" alt="" />` : "";
    }).join("");
    const max = fsState.schema?.limits?.carouselMaxImages || 5;
    return `
      <div class="fs-ed-block" data-bi="${bi}" data-block-type="carousel">
        ${removeBtn}
        <p class="muted sm">${escapeHtml(t("flows.studio.carouselHint", { min: 2, max }))}</p>
        <div class="fs-carousel-images">${thumbs || `<span class="muted sm">${escapeHtml(t("flows.studio.noImageYet"))}</span>`}</div>
        <label class="flows-upload-label sm fs-ed-upload"><span>${escapeHtml(t("flows.studio.carouselAdd"))}</span>
          <input type="file" accept="image/png,image/jpeg" class="fs-carousel-file" data-bi="${bi}" ${imgs.length >= max ? "disabled" : ""} />
        </label>
      </div>`;
  }
  const ph = escapeHtml(t("flows.studio.blockTextPh"));
  const textContent = escapeHtml(b.text || "");
  const emphCls = (b.type === "body" || b.type === "caption") ? fsEmphasisClass(b.emphasis) : "";
  let textHtml;
  if (b.type === "heading") {
    textHtml = `<h3 class="fs-ed-text${emphCls}" contenteditable="true" data-placeholder="${ph}">${textContent}</h3>`;
  } else if (b.type === "subheading") {
    textHtml = `<p class="fs-preview-sub fs-ed-text${emphCls}" contenteditable="true" data-placeholder="${ph}">${textContent}</p>`;
  } else if (b.type === "caption") {
    textHtml = `<p class="fs-preview-caption fs-ed-text${emphCls}" contenteditable="true" data-placeholder="${ph}">${textContent}</p>`;
  } else {
    textHtml = `<p class="fs-ed-text${emphCls}" contenteditable="true" data-placeholder="${ph}">${textContent}</p>`;
  }
  return `
    <div class="fs-ed-block" data-bi="${bi}" data-block-type="${escapeHtml(b.type)}">
      ${removeBtn}
      ${textHtml}
    </div>`;
}

function fsEditableFieldsHtml(scr) {
  if (scr.layout !== "form") return "";
  const fields = scr.fields || [];
  const rows = fields.map((f, fi) => {
    const needsOpts = f.type === "select" || f.type === "checkbox";
    const optsVal = (f.options || []).join(", ");
    return `
      <div class="fs-ed-field" data-fi="${fi}">
        <input type="text" class="fs-f-label" placeholder="${escapeHtml(t("flows.studio.fieldLabel"))}" value="${escapeHtml(f.label || "")}" />
        <select class="fs-f-type">${fsFieldTypeOptions(f.type)}</select>
        <button type="button" class="btn-ghost sm fs-f-remove" title="×">×</button>
        ${needsOpts ? `<input type="text" class="fs-f-opts sm" placeholder="${escapeHtml(t("flows.studio.fieldOptionsPh"))}" value="${escapeHtml(optsVal)}" />` : ""}
      </div>`;
  }).join("");
  return `
    <div class="fs-ed-fields">
      <div class="fs-ed-fields-head">
        <span class="fs-ed-fields-label">${escapeHtml(t("flows.studio.formFields"))}</span>
        <button type="button" class="fs-field-add-link">+ ${escapeHtml(t("flows.studio.addField"))}</button>
      </div>
      ${rows}
    </div>`;
}

function fsNextTargetOptions(scr, screenIndex) {
  const confirmIdx = fsState.screens.findIndex((s) => s.layout === "confirm");
  const hasConfirm = confirmIdx >= 0;
  const value = scr.nextTarget || (scr.layout === "confirm" ? "complete" : "next");
  let html = `<option value="next"${value === "next" ? " selected" : ""}>${escapeHtml(t("flows.studio.nextTargetNext"))}</option>`;
  html += `<option value="complete"${value === "complete" ? " selected" : ""}>${escapeHtml(t("flows.studio.nextTargetComplete"))}</option>`;
  if (hasConfirm) {
    html += `<option value="confirm"${value === "confirm" ? " selected" : ""}>${escapeHtml(t("flows.studio.nextTargetConfirm"))}</option>`;
  }
  fsState.screens.forEach((s, i) => {
    if (i === screenIndex || s.layout === "confirm") return;
    const title = (s.title || t("flows.studio.step", { n: i + 1 })).slice(0, 24);
    html += `<option value="${i}"${value === String(i) ? " selected" : ""}>${escapeHtml(t("flows.studio.nextTargetScreen", { n: i + 1, title }))}</option>`;
  });
  return html;
}

function renderFsPhoneEditor(scr, index) {
  ensureScreenBlocks(scr);
  const isLast = index === fsState.screens.length - 1;
  const canDelete = fsState.screens.length > 1;
  const btnLabel = scr.buttonLabel || (isLast ? t("flows.studio.close") : t("flows.studio.continue"));
  const stepOf = t("flows.studio.previewStepOf", { n: index + 1, total: fsState.screens.length });
  const blocksHtml = fsBlocksEditorHtml(scr, index);
  const layoutOpts = FS_LAYOUTS.map((id) =>
    `<option value="${id}"${scr.layout === id ? " selected" : ""}>${escapeHtml(fsLayoutLabel(id))}</option>`
  ).join("");
  const dotsHtml = fsState.screens.map((_, i) =>
    `<span class="${i === index ? "on" : ""}"></span>`
  ).join("");

  return `
    <div class="fs-phone-wrap${fsState.activeIndex === index ? " editing" : ""}" data-fs-i="${index}" id="fsPhone${index}">
      <div class="fs-preview-meta">
        <span class="fs-preview-badge">${escapeHtml(t("flows.studio.previewBadge"))}</span>
        <span class="fs-preview-step muted sm">${escapeHtml(stepOf)}</span>
        <select class="fs-layout-sel" title="${escapeHtml(t("flows.studio.screenType"))}">${layoutOpts}</select>
        ${canDelete ? `<button type="button" class="fs-screen-del" data-fs-del="${index}">${escapeHtml(t("flows.studio.removeScreenBtn"))}</button>` : ""}
      </div>
      <div class="fs-phone-device">
        <div class="flow-phone fs-phone-mini">
          <div class="flow-phone-nav fs-preview-nav">
            <span class="flow-phone-cancel fs-preview-decor" aria-hidden="true">${escapeHtml(t("flows.studio.previewCancelLabel"))}</span>
            <span class="flow-phone-title fs-ed-title" contenteditable="true" data-placeholder="${escapeHtml(t("flows.studio.screenTitle"))}">${escapeHtml(scr.title || t("flows.studio.step", { n: index + 1 }))}</span>
            <span class="flow-phone-menu fs-preview-decor" aria-hidden="true">⋯</span>
          </div>
          <div class="flow-phone-body fs-ed-body">
            ${blocksHtml}
            ${fsEditableFieldsHtml(scr)}
          </div>
          <div class="flow-phone-footer fs-ed-footer">
            <input type="text" class="fs-ed-footer-btn" value="${escapeHtml(btnLabel)}" placeholder="${escapeHtml(t("flows.studio.screenButton"))}" />
          </div>
          ${scr.layout !== "confirm" ? `<label class="fs-next-target sm"><span>${escapeHtml(t("flows.studio.nextTargetLabel"))}</span><select class="fs-next-target-sel">${fsNextTargetOptions(scr, index)}</select></label>` : ""}
        </div>
      </div>
      <div class="fs-phone-dots">${dotsHtml}</div>
    </div>`;
}

function bindFsPreviewRow(row) {
  if (!row) return;
  row.querySelectorAll(".fs-ed-text[contenteditable]").forEach((el) => {
    el.addEventListener("input", () => {
      if (!el.textContent.trim()) el.classList.add("empty");
      else el.classList.remove("empty");
    });
  });
  row.querySelectorAll(".fs-layout-sel").forEach((sel) => {
    sel.addEventListener("change", () => {
      syncFsFromAllPreviews();
      const wrap = sel.closest(".fs-phone-wrap");
      const i = Number(wrap.dataset.fsI);
      const scr = fsState.screens[i];
      if (!scr) return;
      scr.layout = sel.value;
      if (scr.layout === "form" && !(scr.fields || []).length) {
        scr.fields = [{ type: "text", label: t("flows.studio.defaultFieldName"), required: true }];
      }
      if (scr.layout === "confirm") {
        scr.buttonAction = "complete";
        scr.buttonLabel = scr.buttonLabel || t("flows.studio.close");
      }
      fsState.activeIndex = i;
      renderFlowStudio();
    });
  });
  row.querySelectorAll(".fs-ed-block").forEach((blockEl) => {
    blockEl.addEventListener("mousedown", (e) => {
      if (e.target.closest("input, select, label, .fs-ed-text")) return;
      const wrap = blockEl.closest(".fs-phone-wrap");
      fsState.activeIndex = Number(wrap.dataset.fsI);
      showFsFormatBarForBlock(blockEl, wrap);
    });
  });
  row.querySelectorAll(".fs-insert-plus").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      syncFsFromAllPreviews();
      const wrap = btn.closest(".fs-phone-wrap");
      const line = btn.closest(".fs-insert-line");
      const i = Number(wrap.dataset.fsI);
      const at = Number(line?.dataset.insertAt ?? 0);
      fsState.activeIndex = i;
      showFsInsertMenu(btn, "block", i, at);
    });
  });
  row.querySelectorAll(".fs-block-remove").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const wrap = btn.closest(".fs-phone-wrap");
      const blockEl = btn.closest(".fs-ed-block");
      if (!wrap || !blockEl) return;
      fsRemoveBlockAt(Number(wrap.dataset.fsI), Number(blockEl.dataset.bi));
    });
  });
  row.querySelectorAll(".fs-field-add-link").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      syncFsFromAllPreviews();
      const wrap = btn.closest(".fs-phone-wrap");
      const i = Number(wrap.dataset.fsI);
      const scr = fsState.screens[i];
      if (!scr || scr.layout !== "form") return;
      showFsInsertMenu(btn, "field", i, (scr.fields || []).length);
    });
  });
  row.querySelectorAll(".fs-f-label").forEach((input) => {
    input.addEventListener("focus", () => hideFsFormatBar());
  });
  row.querySelectorAll(".fs-block-file").forEach((input) => {
    input.addEventListener("change", () => {
      syncFsFromAllPreviews();
      const wrap = input.closest(".fs-phone-wrap");
      const i = Number(wrap.dataset.fsI);
      fsState.activeIndex = i;
      uploadFsBlockImage(Number(input.dataset.bi), input);
    });
  });
  row.querySelectorAll(".fs-carousel-file").forEach((input) => {
    input.addEventListener("change", () => {
      syncFsFromAllPreviews();
      const wrap = input.closest(".fs-phone-wrap");
      const i = Number(wrap.dataset.fsI);
      fsState.activeIndex = i;
      uploadFsCarouselImage(Number(input.dataset.bi), input);
    });
  });
  row.querySelectorAll(".fs-f-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      syncFsFromAllPreviews();
      const wrap = btn.closest(".fs-phone-wrap");
      const i = Number(wrap.dataset.fsI);
      const scr = fsState.screens[i];
      const fi = Number(btn.closest(".fs-ed-field").dataset.fi);
      if (!scr || !scr.fields) return;
      scr.fields.splice(fi, 1);
      fsState.activeIndex = i;
      renderFlowStudio();
    });
  });
  row.querySelectorAll(".fs-f-type").forEach((el) => {
    el.addEventListener("change", () => {
      syncFsFromAllPreviews();
      const wrap = el.closest(".fs-phone-wrap");
      fsState.activeIndex = Number(wrap.dataset.fsI);
      renderFlowStudio();
    });
  });
  row.querySelectorAll(".fs-screen-del").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      fsRemoveScreen(Number(btn.dataset.fsDel));
    });
  });
}

function fsThumbLabel(scr) {
  ensureScreenBlocks(scr);
  const heading = scr.blocks.find((b) => b.type === "heading");
  const text = heading?.text || scr.title || t("flows.studio.screenDefault");
  return String(text).slice(0, 24);
}

function renderFlowStudio() {
  hideFsFormatBar();
  hideFsInsertMenu();
  initFsFormatBar();
  const strip = $("fsScreenStrip");
  const row = $("fsPreviewRow");
  if (!strip || !row) return;

  const max = fsState.schema?.limits?.maxScreens || 8;
  strip.innerHTML = fsState.screens.map((scr, i) =>
    `<button type="button" class="fs-thumb${i === fsState.activeIndex ? " active" : ""}" data-fs-i="${i}" title="${escapeHtml(scr.title || t("flows.studio.step", { n: i + 1 }))}">
      <span class="fs-thumb-step">${escapeHtml(t("flows.studio.step", { n: i + 1 }))}</span>
      <div class="fs-thumb-inner">${escapeHtml(fsThumbLabel(scr))}</div>
    </button>`
  ).join("")
    + (fsState.screens.length < max
      ? `<button type="button" class="fs-thumb-add" id="fsAddScreen" title="${escapeHtml(t("flows.studio.addScreen"))}">+</button>`
      : "");

  strip.querySelectorAll(".fs-thumb").forEach((btn) => {
    btn.addEventListener("click", () => {
      syncFsFromAllPreviews();
      fsState.activeIndex = Number(btn.dataset.fsI);
      renderFlowStudio();
      const target = $(`fsPhone${fsState.activeIndex}`) || row.querySelector(`[data-fs-i="${fsState.activeIndex}"]`);
      target?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    });
  });
  const addBtn = $("fsAddScreen");
  if (addBtn) addBtn.addEventListener("click", fsAddScreen);

  row.className = "fs-preview-row"
    + (fsState.screens.length <= 2 ? " fs-preview-centered" : "");
  row.innerHTML = fsState.screens.map((scr, i) => renderFsPhoneEditor(scr, i)).join("")
    + (fsState.screens.length < max
      ? `<button type="button" class="fs-thumb-add fs-add-screen-card" id="fsAddScreenRow" title="${escapeHtml(t("flows.studio.addScreen"))}">+</button>`
      : "");
  bindFsPreviewRow(row);
  hideFsInsertMenu();
  const addRow = $("fsAddScreenRow");
  if (addRow) addRow.addEventListener("click", fsAddScreen);
}

async function uploadFsBlockImage(bi, input) {
  const file = input?.files?.[0];
  if (!file) return;
  if (file.size > 100 * 1024) {
    toast(t("toast.imageTooLarge"), "error");
    input.value = "";
    return;
  }
  const scr = fsActiveScreen();
  if (!scr || !scr.blocks[bi]) return;
  const fd = new FormData();
  fd.append("image", file);
  toast(t("toast.uploadingImage"), "info");
  const res = await postForm("/api/flows/studio/assets", fd);
  if (!res.ok) {
    toast(res.error || t("toast.uploadFailed"), "error");
    input.value = "";
    return;
  }
  scr.blocks[bi] = {
    ...scr.blocks[bi],
    type: "image",
    assetId: res.assetId,
    previewUrl: res.previewUrl,
    src: res.src,
    altText: scr.blocks[bi].altText || file.name.replace(/\.[^.]+$/, ""),
    scaleType: scr.blocks[bi].scaleType || "contain",
  };
  toast(t("toast.imageUploaded"), "ok");
  syncFsFromAllPreviews();
  renderFlowStudio();
}

async function uploadFsCarouselImage(bi, input) {
  const file = input?.files?.[0];
  if (!file) return;
  if (file.size > 100 * 1024) {
    toast(t("toast.imageTooLarge"), "error");
    input.value = "";
    return;
  }
  syncFsFromAllPreviews();
  const scr = fsActiveScreen();
  const block = scr?.blocks?.[bi];
  if (!block || block.type !== "carousel") return;
  const max = fsState.schema?.limits?.carouselMaxImages || 5;
  block.images = block.images || [];
  if (block.images.length >= max) {
    toast(t("toast.carouselMaxImages", { max }), "error");
    return;
  }
  const fd = new FormData();
  fd.append("image", file);
  toast(t("toast.uploadingImage"), "info");
  const res = await postForm("/api/flows/studio/assets", fd);
  if (!res.ok) {
    toast(res.error || t("toast.uploadFailed"), "error");
    return;
  }
  block.images.push({
    type: "image",
    assetId: res.assetId,
    previewUrl: res.previewUrl,
    src: res.src,
    altText: file.name.replace(/\.[^.]+$/, ""),
    scaleType: block.scaleType || "contain",
  });
  toast(t("toast.imageUploaded"), "ok");
  renderFlowStudio();
}

function fsAddScreen() {
  syncFsFromAllPreviews();
  const max = fsState.schema?.limits?.maxScreens || 8;
  if (fsState.screens.length >= max) {
    toast(t("toast.maxScreens", { max }), "error");
    return;
  }
  const confirmIdx = fsState.screens.findIndex((s) => s.layout === "confirm");
  const insertAt = confirmIdx >= 0 ? confirmIdx : fsState.screens.length;
  fsState.screens.splice(insertAt, 0, {
    layout: "message",
    title: t("flows.studio.step", { n: insertAt + 1 }),
    blocks: [
      { type: "heading", text: t("flows.studio.newScreenHeading") },
      { type: "body", text: t("flows.studio.newScreenBody"), emphasis: "normal" },
    ],
    buttonLabel: t("flows.studio.continue"),
    buttonAction: "next",
    fields: [],
  });
  fsState.activeIndex = insertAt;
  renderFlowStudio();
}

function fsRemoveScreen(index) {
  syncFsFromAllPreviews();
  if (fsState.screens.length <= 1) {
    toast(t("toast.minOneScreen"), "error");
    return;
  }
  fsState.screens.splice(index, 1);
  if (fsState.activeIndex >= fsState.screens.length) {
    fsState.activeIndex = fsState.screens.length - 1;
  } else if (fsState.activeIndex > index) {
    fsState.activeIndex -= 1;
  }
  toast(t("flows.studio.screenRemoved"), "ok");
  renderFlowStudio();
}

function mapFsScreenToDef(s, i, fsStateScreens) {
  ensureScreenBlocks(s);
  syncScreenLegacyFromBlocks(s);
  const isLast = i === fsStateScreens.length - 1;
  const blocks = (s.blocks || []).map((b) => {
    const copy = { ...b };
    if (copy.type === "image") {
      copy.src = copy.src || undefined;
    }
    return copy;
  });
  const base = {
    title: s.title || t("flows.studio.step", { n: i + 1 }),
    blocks,
    footerLabel: s.buttonLabel || (isLast ? t("flows.studio.close") : t("flows.studio.continue")),
  };
  if (s.nextTarget && s.nextTarget !== "next") base.nextTarget = s.nextTarget;
  else if (s.layout === "confirm") base.nextTarget = "complete";
  if (s.layout === "form") {
    return {
      type: "form",
      ...base,
      introHeading: s.heading,
      introBody: s.body,
      footerLabel: s.buttonLabel || t("flows.studio.submit"),
      fields: (s.fields && s.fields.length)
        ? s.fields.map((f) => ({ ...f }))
        : [{ type: "text", label: t("flows.studio.response"), required: true }],
    };
  }
  if (s.layout === "confirm" || (isLast && s.buttonAction === "complete")) {
    return {
      type: "confirm",
      ...base,
      heading: s.heading,
      body: s.body,
      footerLabel: s.buttonLabel || t("flows.studio.close"),
    };
  }
  return {
    type: "message",
    ...base,
    heading: s.heading,
    body: s.body,
  };
}

function collectFsDefinition() {
  syncFsFromAllPreviews();
  const screens = fsState.screens.map((s, i) => mapFsScreenToDef(s, i, fsState.screens));
  const hasConfirm = screens.some((s) => s.type === "confirm");
  if (!hasConfirm && screens.length) {
    const last = screens[screens.length - 1];
    if (last.type === "message") last.footerLabel = last.footerLabel || t("flows.studio.close");
  }
  return {
    name: ($("fsName") || {}).value.trim(),
    category: ($("fsCategory") || {}).value || "OTHER",
    cta: ($("fsCta") || {}).value.trim() || t("flows.studio.defaultCta"),
    chatBody: ($("fsChatBody") || {}).value.trim(),
    publish: false,
    dynamic: Boolean(($("fsDynamic") || {}).checked),
    dynamicHandler: ($("fsDynamicHandler") || {}).value || "generic",
    screens,
  };
}

function loadStudioDefinition(def) {
  fsState.screens = (def.screens || []).map((s) => ({
    layout: s.layout || s.type || "message",
    title: s.title || "",
    blocks: Array.isArray(s.blocks) ? s.blocks.map((b) => ({ ...b })) : [],
    fields: Array.isArray(s.fields) ? s.fields.map((f) => ({ ...f })) : [],
    buttonLabel: s.buttonLabel || "",
    buttonAction: s.buttonAction || "next",
    nextTarget: s.nextTarget || undefined,
  }));
  fsState.activeIndex = 0;
  if ($("fsName")) $("fsName").value = def.name || "";
  if ($("fsCategory")) $("fsCategory").value = def.category || "OTHER";
  if ($("fsChatBody")) $("fsChatBody").value = def.chatBody || "";
  if ($("fsCta")) $("fsCta").value = def.cta || "";
  if ($("fsDynamic")) $("fsDynamic").checked = Boolean(def.dynamic);
  if ($("fsDynamicHandler")) $("fsDynamicHandler").value = def.dynamicHandler || "generic";
  syncFsDynamicUi();
  fsState.screens.forEach(ensureScreenBlocks);
}

function syncFsStudioEditUi() {
  const editing = Boolean(fsState.editingFlowId);
  const createBtn = $("fsCreateBtn");
  const cancelBtn = $("fsCancelEditBtn");
  if (createBtn) {
    createBtn.textContent = editing ? t("flows.studio.saveDraft") : t("flows.studio.createDraft");
  }
  cancelBtn?.classList.toggle("hidden", !editing);
  if ($("fsName") && editing) $("fsName").readOnly = true;
  else if ($("fsName")) $("fsName").readOnly = false;
}

function cancelFlowStudioEdit() {
  fsState.editingFlowId = null;
  syncFsStudioEditUi();
  if (state.activeFlowId) {
    closeFlowCreate();
    selectFlow(state.activeFlowId);
  } else {
    fsState.screens = defaultFsScreens();
    renderFlowStudio();
  }
}

async function openFlowEditDraft() {
  const id = state.activeFlowId;
  if (!id) return;
  const res = await api(`/api/flows/${encodeURIComponent(id)}/studio`);
  if (!res.ok || !res.editable) {
    toast(res.error || t("toast.flowEditFailed"), "error");
    return;
  }
  fsState.editingFlowId = id;
  await initFlowStudio();
  loadStudioDefinition(res.definition);
  syncFsStudioEditUi();
  openFlowCreate();
  renderFlowStudio();
  toast(t("flows.studio.editingFlow"), "info");
}

function openFlowSendModal() {
  if (!state.activeFlowId) {
    toast(t("toast.selectFlow"), "error");
    return;
  }
  const profile = state.flowSendProfile || {};
  const defaults = profile.sendDefaults || {};
  const st = String((state.activeFlowDetail && state.activeFlowDetail.status) || "").toUpperCase();
  if ($("flowSendPhone")) $("flowSendPhone").value = "";
  if ($("flowSendBody")) {
    $("flowSendBody").value = defaults.bodyText || "Completa este formulario para continuar.";
  }
  if ($("flowSendCta")) {
    $("flowSendCta").value = defaults.cta || profile.defaultCta || t("flows.studio.defaultCta");
  }
  if ($("flowSendScreen")) {
    $("flowSendScreen").value = defaults.screen || profile.defaultScreen || "SCREEN_A";
  }
  const hint = $("flowSendModeHint");
  if (hint) {
    hint.textContent = st === "DRAFT" ? t("flows.sendModal.draftMode") : t("flows.sendModal.publishedMode");
  }
  showModal("modalFlowSend");
}

function setFlowJsonModal(mode, json) {
  state.flowJsonMode = mode;
  const editor = $("flowJsonEditor");
  const title = $("flowJsonModalTitle");
  const importBtn = $("flowJsonImportBtn");
  if (editor) editor.value = typeof json === "string" ? json : JSON.stringify(json, null, 2);
  if (title) {
    title.textContent = mode === "export"
      ? t("flows.json.exportTitle")
      : (mode === "import" ? t("flows.json.importTitle") : t("flows.json.previewTitle"));
  }
  if (importBtn) importBtn.classList.toggle("hidden", mode === "export");
  showModal("modalFlowJson");
}

async function openFsJsonPreview() {
  const def = collectFsDefinition();
  if (!def.name) {
    toast(t("toast.flowNameRequired"), "error");
    return;
  }
  const res = await post("/api/flows/studio/preview-json", def);
  if (!res.ok) {
    toast(res.error || t("toast.jsonPreviewFailed"), "error");
    return;
  }
  setFlowJsonModal("preview", res.flowJson);
}

async function exportActiveFlowJson() {
  const id = state.activeFlowId;
  if (!id) {
    toast(t("toast.selectFlow"), "error");
    return;
  }
  const res = await api(`/api/flows/${encodeURIComponent(id)}/export-json`);
  if (!res.ok) {
    toast(res.error || t("toast.jsonExportFailed"), "error");
    return;
  }
  setFlowJsonModal("export", res.flowJson);
}

function downloadFlowJsonFromModal() {
  const raw = ($("flowJsonEditor") || {}).value || "";
  if (!raw.trim()) return;
  const blob = new Blob([raw], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const name = state.activeFlowDetail?.name || ($("fsName") || {}).value || "flow";
  a.href = url;
  a.download = `${String(name).replace(/[^a-z0-9_]/gi, "_")}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function importFlowJsonFromModal() {
  const raw = ($("flowJsonEditor") || {}).value || "";
  let flowJson;
  try {
    flowJson = JSON.parse(raw);
  } catch (_) {
    toast(t("toast.jsonInvalid"), "error");
    return;
  }
  const res = await post("/api/flows/studio/import-json", { flowJson });
  if (!res.ok) {
    toast(res.error || t("toast.jsonImportFailed"), "error");
    return;
  }
  if (res.dynamic) toast(t("flows.json.dynamicHint"), "info");
  loadStudioDefinition({
    ...res.definition,
    name: ($("fsName") || {}).value || res.definition.name,
    category: ($("fsCategory") || {}).value || res.definition.category,
  });
  renderFlowStudio();
  closeModals();
  toast(t("toast.jsonImported"), "ok");
}

function openFsJsonImportEmpty() {
  setFlowJsonModal("import", "{\n  \"version\": \"7.3\",\n  \"screens\": []\n}");
}

async function confirmFlowSend() {
  const id = state.activeFlowId;
  const phone = ($("flowSendPhone") || {}).value.trim();
  if (!id || !phone) {
    toast(t("toast.phoneRequired"), "error");
    return;
  }
  const bodyText = ($("flowSendBody") || {}).value.trim();
  const cta = ($("flowSendCta") || {}).value.trim();
  const screen = ($("flowSendScreen") || {}).value.trim();
  const profile = state.flowSendProfile || {};
  const res = await post(`/api/flows/${encodeURIComponent(id)}/send`, {
    phone,
    bodyText,
    cta,
    screen,
    flowAction: profile.flowAction,
  });
  if (!res.ok) {
    toast(res.error || res.hint || t("toast.sendFailedGeneric"), "error");
    return;
  }
  toast(t("toast.flowSent", { mode: res.mode || "published" }), "ok");
  closeModals();
  await loadFlowDetail(id);
}

async function createFlowFromStudio() {
  const def = collectFsDefinition();
  if (!def.name) {
    toast(t("toast.flowNameRequired"), "error");
    $("fsName")?.focus();
    return;
  }
  if (fsState.editingFlowId) {
    const res = await put(`/api/flows/${encodeURIComponent(fsState.editingFlowId)}`, def);
    if (!res.ok) { toast(res.error || t("toast.flowEditFailed"), "error"); return; }
    toast(t("toast.flowUpdated"), "ok");
    const flowId = fsState.editingFlowId;
    fsState.editingFlowId = null;
    syncFsStudioEditUi();
    await loadFlows();
    closeFlowCreate();
    if (flowId) selectFlow(flowId);
    return;
  }
  const res = await post("/api/flows/build", def);
  if (!res.ok) { toast(res.error || t("toast.flowCreateFailed"), "error"); return; }
  toast(t("toast.flowCreatedRequestTemplate"), "ok");
  await loadFlows();
  closeFlowCreate();
  if (res.flow && res.flow.id) {
    selectFlow(res.flow.id);
    openTemplateFromFlow(def, res.flow.id, res.defaultScreen || "SCREEN_A", res.flowAction);
  }
}

function openTemplateFromFlow(def, flowId, defaultScreen, flowAction) {
  const slug = def.name.replace(/[^a-z0-9_]/gi, "_").slice(0, 40);
  const bodyText = def.chatBody || t("flows.studio.defaultChatBody");
  const cta = def.cta || t("flows.studio.defaultCta");
  if (window.confirm(t("flows.createFlowTemplateConfirm"))) {
    createFlowTemplate({
      flowId,
      def,
      bodyText,
      cta,
      screen: defaultScreen || "SCREEN_A",
      name: `${slug}_mensaje`,
    });
    return;
  }
  initTemplateModal().then(() => {
    if ($("tpName")) $("tpName").value = `${slug}_mensaje`;
    if ($("tpBody")) $("tpBody").value = def.chatBody || "Completa el formulario para continuar.";
    if ($("tpFooter")) $("tpFooter").value = "Punto Pago";
    renderTpVarList([]);
    $("tpVarsSection")?.classList.add("hidden");
    updateTpPreview();
    showModal("modalTemplate");
    toast(t("toast.reviewMessageCreateMeta"), "ok");
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
    box.textContent = t("flows.noTestAuths");
    return;
  }
  box.innerHTML = rows.slice(0, 5).map((r) => {
    const st = flowDecisionLabel(r.decision);
    return `<div>${escapeHtml(r.merchant)} · $${escapeHtml(r.amount)} · ${escapeHtml(st)} · ${escapeHtml(localeActivityDate(r.createdAt))}</div>`;
  }).join("");
}

async function sendPaymentAuthTest() {
  const phone = ($("payAuthPhone") || {}).value.trim();
  if (!phone) { toast(t("toast.phoneRequired"), "error"); return; }
  const res = await post("/api/flows/payment-auth/test", {
    phone,
    customerName: ($("payAuthCustomerName") || {}).value.trim(),
    merchant: ($("payAuthMerchant") || {}).value.trim(),
    amount: ($("payAuthAmount") || {}).value.trim(),
    cardLast4: ($("payAuthCard4") || {}).value.trim(),
  });
  if (!res.ok) { toast(res.error || t("toast.sendFailedGeneric"), "error"); return; }
  toast(t("toast.payAuthSent"), "ok");
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
    text.textContent = t("flows.noConnection");
    if (cfgStatus) cfgStatus.textContent = t("flows.credsNotConfigured");
    return;
  }

  const ok = res.canListFlows;
  dot.className = `flows-status-dot ${ok ? "ok" : "warn"}`;
  const count = res.flowCount != null
    ? (res.flowCount === 1 ? t("flows.flowCountOne") : t("flows.flowCountMany", { count: res.flowCount }))
    : t("flows.flowsAvailable");
  text.textContent = ok ? t("flows.connected", { count }) : t("flows.connectedPartial");
  if (cfgStatus) {
    cfgStatus.textContent = ok
      ? t("flows.serverReady", { count })
      : (res.error || t("flows.connectedPartial"));
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
    box.innerHTML = `<p class="muted">${escapeHtml(t("flows.noTemplates"))}</p>`;
    return;
  }
  const cards = [];
  state.flowUseCases.forEach((u) => {
    if (u.status === "soon" || !u.templates || !u.templates.length) return;
    u.templates.forEach((tpl) => {
      cards.push(`
        <article class="flow-template-card${tpl.key === "payment_auth" || tpl.key === "tarjeta_credito" || tpl.key === "booking" ? " featured" : ""}">
          <h3>${escapeHtml(tpl.name || tpl.key)}</h3>
          <p class="muted sm">${escapeHtml(u.label)} · ${escapeHtml(tpl.description || "")}</p>
          <div class="flows-actions">
            <button type="button" class="btn-primary sm flow-create-sample" data-sample="${escapeHtml(tpl.key)}">${escapeHtml(t("flows.studio.createInMeta"))}</button>
            ${tpl.key === "payment_auth" ? `<button type="button" class="btn-ghost sm flow-go-probar">${escapeHtml(t("flows.studio.tryBtn"))}</button>` : ""}
            ${tpl.key === "booking" ? `<button type="button" class="btn-ghost sm flow-go-booking">${escapeHtml(t("flows.studio.tryBtn"))}</button>` : ""}
            ${tpl.key === "tarjeta_credito" ? `<button type="button" class="btn-ghost sm flow-open-tpl-draft" data-preset="punto_pago_tarjeta_credito_bienvenida">${escapeHtml(t("templates.draftsTitle"))}</button>` : ""}
            ${tpl.key === "booking" ? `<button type="button" class="btn-ghost sm flow-open-tpl-draft" data-preset="punto_pago_reserva_cita">${escapeHtml(t("templates.draftsTitle"))}</button>` : ""}
          </div>
        </article>`);
    });
  });
  box.innerHTML = cards.length
    ? cards.join("")
    : `<p class="muted">${escapeHtml(t("flows.studio.comingSoon"))}</p>`;
  box.querySelectorAll(".flow-create-sample").forEach((btn) =>
    btn.addEventListener("click", () => createFlowSampleKey(btn.dataset.sample))
  );
  box.querySelectorAll(".flow-go-probar").forEach((btn) =>
    btn.addEventListener("click", () => openFlowProbar("payment"))
  );
  box.querySelectorAll(".flow-go-booking").forEach((btn) =>
    btn.addEventListener("click", () => openFlowProbar("booking"))
  );
  box.querySelectorAll(".flow-open-tpl-draft").forEach((btn) =>
    btn.addEventListener("click", () => {
      switchScreen("templates");
      openTplDraftModal(btn.dataset.preset);
    })
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
        hint.textContent = t("flows.connectedMeta");
        hint.style.color = "";
      } else if (res.syncError) {
        hint.textContent = res.syncError;
        hint.style.color = "var(--red)";
      } else {
        hint.textContent = t("flows.checkingMeta");
        hint.style.color = "";
      }
    }
    if (retryBtn) retryBtn.classList.toggle("hidden", Boolean(res.synced && !res.warning));
  } else {
    uriEl.textContent = t("flows.endpoint.notConfigured");
    if (hint) {
      hint.textContent = t("flows.endpoint.needsPublicUrl");
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
  if (!res.ok) { toast(res.error || t("toast.keyRegisterFailed"), "error"); return; }
  toast(res.message || t("toast.keyRegistered"), "ok");
  await loadFlowEndpointSetup();
}

async function loadFlows() {
  const res = await api("/api/flows");
  state.flows = (res && res.data) || [];
  if (res && res.cleaned > 0) {
    toast(t("toast.draftsCleaned", { count: res.cleaned }), "ok");
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

function flowTemplateLinkSummary(flowName) {
  const preset = presetForFlowName(flowName);
  if (!preset) return `<span class="flow-tpl-none">${escapeHtml(t("flows.noLinkedTpl"))}</span>`;
  const ms = presetMetaForKey(preset.key);
  if (ms && ms.readyForProduction) {
    return `<span class="flow-tpl-ok">${escapeHtml(t("flows.tplReady"))}</span>`;
  }
  return `<span class="flow-tpl-pending">${escapeHtml(t("flows.tplPending"))}</span>`;
}

function renderFlowsList() {
  const box = $("flowsList");
  const hint = $("flowsListHint");
  if (hint) hint.textContent = state.flows.length ? `(${state.flows.length})` : "";
  if (!box) return;
  if (!state.flows.length) {
    box.innerHTML = `<p class="muted">${escapeHtml(t("flows.emptyFlowsList"))}</p>`;
    return;
  }
  box.innerHTML = state.flows.map((f) => {
    const st = (f.status || "").toUpperCase();
    const active = f.id === state.activeFlowId ? " active" : "";
    return `<div class="flow-item${active}" data-id="${escapeHtml(f.id)}">
      <div class="flow-item-head">
        <strong>${escapeHtml(f.name || f.id)}</strong>
        <span class="flow-status ${escapeHtml(st)}">${escapeHtml(flowStatusLabel(st))}</span>
      </div>
      <div class="flow-item-meta">${flowTemplateLinkSummary(f.name)}</div>
    </div>`;
  }).join("");
  box.querySelectorAll(".flow-item").forEach((el) =>
    el.addEventListener("click", () => selectFlow(el.dataset.id))
  );
}

function getFlowViewScreenId() {
  const el = $("flowViewScreen");
  return el ? String(el.value || "").trim() : "";
}

function setFlowViewScreen(screenId) {
  const el = $("flowViewScreen");
  if (el) el.value = screenId;
  updateFlowViewPreview();
}

function renderFlowScreenPreview(container, screenId, profile) {
  if (!container) return;
  const screen = (profile && profile.screens || []).find((s) => s.id === screenId);
  const preview = screen && screen.preview;
  if (!preview) {
    container.innerHTML = `<p class="muted sm">${escapeHtml(t("flows.sendPreviewFlowEmpty"))}</p>`;
    return;
  }

  const headingHtml = (preview.headings || []).map((h) => `<h3>${escapeHtml(h)}</h3>`).join("");
  const bodyHtml = (preview.bodies || []).map((b) => `<p>${escapeHtml(b)}</p>`).join("");
  const captionHtml = (preview.captions || []).map((c) => `<p class="flow-phone-caption">${escapeHtml(c)}</p>`).join("");
  const linkHtml = (preview.links || []).map((l) => `<p class="flow-phone-link">${escapeHtml(l)}</p>`).join("");
  const imageHtml = preview.hasImage
    ? `<img class="flow-phone-img" src="${escapeHtml(preview.imageUrl || "/assets/punto-pago-card.png")}" alt="" onerror="this.src='/assets/punto-pago-card.png'" />`
    : "";

  container.className = "flow-phone flow-phone-pp";
  container.innerHTML = `
    <div class="flow-phone-nav flow-phone-nav-pp">
      <span class="flow-phone-cancel">${escapeHtml(t("flows.preview.cancel"))}</span>
      <span class="flow-phone-title">${escapeHtml(preview.title || screenId)}</span>
      <span class="flow-phone-menu">⋯</span>
    </div>
    <div class="flow-phone-body">
      <p class="flow-phone-brand">${escapeHtml(t("flows.preview.brand"))}</p>
      ${headingHtml}
      ${imageHtml}
      ${bodyHtml}
      ${captionHtml}
      ${linkHtml}
    </div>
    ${preview.footerLabel ? `<div class="flow-phone-footer"><button type="button">${escapeHtml(preview.footerLabel)}</button></div>` : ""}
    <div class="flow-phone-managed">${escapeHtml(t("flows.preview.managedBy", { brand: brandDisplayName() }))}</div>`;
}

function renderFlowJourneyPicker(boxId, screens, activeId, onPick) {
  const box = $(boxId);
  if (!box) return;
  if (!screens || !screens.length) {
    box.innerHTML = `<p class="muted sm">${escapeHtml(t("flows.sendUnknownFlow"))}</p>`;
    return;
  }
  const steps = screens.map((s) => {
    const active = s.id === activeId ? " active" : "";
    const terminal = s.terminal ? " terminal" : "";
    return `<button type="button" class="flows-send-journey-step${active}${terminal}" data-screen-id="${escapeHtml(s.id)}" title="${escapeHtml(s.id)}">${escapeHtml(t("flows.sendJourneyStep", { n: s.index, title: s.title }))}</button>`;
  }).join("");
  box.innerHTML = `<div class="flows-send-journey-steps">${steps}</div>`;
  box.querySelectorAll("[data-screen-id]").forEach((btn) => {
    btn.addEventListener("click", () => onPick(btn.dataset.screenId));
  });
}

function updateFlowViewPreview() {
  const profile = state.flowSendProfile;
  const defaults = (profile && profile.sendDefaults) || {};
  const screenId = getFlowViewScreenId() || defaults.screen || (profile && profile.defaultScreen) || "";
  renderFlowJourneyPicker("flowViewJourney", profile && profile.screens, screenId, setFlowViewScreen);
  renderFlowScreenPreview($("flowViewFlowPreview"), screenId, profile);
}

function syncFlowPublishButton(status) {
  const pubBtn = $("flowPublishBtn");
  if (!pubBtn) return;
  const isDraft = String(status || "").toUpperCase() === "DRAFT";
  pubBtn.classList.toggle("hidden", !isDraft);
  pubBtn.title = isDraft ? t("flows.publishDraftHint") : "";
}

function applyFlowSendProfile(profileRes) {
  const profile = (profileRes && profileRes.profile) || null;
  state.flowSendProfile = profile;
  const defaults = (profile && profile.sendDefaults) || {};
  const screenId = defaults.screen || profile?.defaultScreen || "WELCOME_SCREEN";
  if ($("flowViewScreen")) $("flowViewScreen").value = screenId;
  updateFlowViewPreview();
  if (state.activeFlowId && !$("flowsDetailPanel")?.classList.contains("hidden")) {
    renderFlowTemplateLink(state.activeFlowPerformance);
    renderFlowDetailPreview(state.activeFlowPerformance);
  }
}

function buildFlowLaunchContext(perfRes) {
  const profile = state.flowSendProfile || {};
  const presetKey = profile.presetKey || null;
  const preset = presetKey ? state.templatePresets.find((p) => p.key === presetKey) : null;
  const meta = presetKey ? presetMetaForKey(presetKey) : null;
  const preferredTemplateName = preset ? preferredTemplateForPreset(preset) : null;
  const canSend = Boolean(preferredTemplateName);
  return { presetKey, preset, meta, preferredTemplateName, canSend };
}

async function renderFlowTemplateLink(perfRes) {
  const panel = $("flowTemplateLink");
  if (!panel || !state.activeFlowId) return;
  if (!state.templatePresets.length || !state.templates.length) {
    await Promise.all([
      state.templatePresets.length ? Promise.resolve() : loadTemplatePresets(),
      state.templates.length ? Promise.resolve() : loadTemplates(),
    ]);
  }
  const ctx = buildFlowLaunchContext(perfRes);
  state.flowLaunchContext = ctx;
  if (ctx.preset) {
    panel.classList.remove("hidden");
    panel.innerHTML = `
    <div class="flow-template-link-head">
      <span class="flow-template-link-label">${escapeHtml(t("flows.linkedTemplates"))}</span>
      ${presetVariantRowsHtml(ctx.preset, ctx.meta)}
    </div>
    <div class="flow-template-link-actions">
      <button type="button" class="btn-primary sm" id="flowLaunchOpenBtn" ${ctx.canSend ? "" : "disabled"}>${escapeHtml(t("flows.launch.sendPrimary"))}</button>
      <button type="button" class="btn-ghost sm" id="flowGoTemplatesBtn">${escapeHtml(t("flows.goTemplates"))}</button>
    </div>`;
    $("flowLaunchOpenBtn")?.addEventListener("click", openFlowLaunchFromPanel);
    $("flowGoTemplatesBtn")?.addEventListener("click", () => {
      switchScreen("templates");
      if (ctx.preset) openTplDraftModal(ctx.preset.key);
    });
    return;
  }
  panel.classList.remove("hidden");
  panel.innerHTML = `
    <div class="flow-template-link-head">
      <span class="flow-template-link-label">${escapeHtml(t("flows.studioTemplateTitle"))}</span>
      <p class="muted sm">${escapeHtml(t("flows.studioTemplateHint"))}</p>
    </div>
    <div class="flow-template-link-actions">
      <button type="button" class="btn-primary sm" id="flowCreateTemplateBtn">${escapeHtml(t("flows.createFlowTemplate"))}</button>
    </div>`;
  $("flowCreateTemplateBtn")?.addEventListener("click", () => createFlowTemplate());
}

function openFlowLaunchFromPanel() {
  const ctx = state.flowLaunchContext || buildFlowLaunchContext(state.activeFlowPerformance);
  if (!ctx.canSend || !ctx.preferredTemplateName) {
    toast(t("templates.ncNoApprovedHint"), "error");
    return;
  }
  openNewChat(ctx.preferredTemplateName, { presetKey: ctx.presetKey });
}

async function loadFlowSendProfile(flowId) {
  const res = await api(`/api/flows/${encodeURIComponent(flowId)}/send-profile`);
  if (!res.ok) {
    state.flowSendProfile = null;
    updateFlowViewPreview();
    return;
  }
  applyFlowSendProfile(res);
}

function openFlowViewModal() {
  if (!state.activeFlowId) {
    toast(t("toast.selectFlow"), "error");
    return;
  }
  const flowName = ($("flowsDetailName") && $("flowsDetailName").textContent) || "";
  const title = $("flowViewModalTitle");
  if (title) title.textContent = `${t("flows.viewApprovedTour")}: ${flowName}`;
  updateFlowViewPreview();
  showModal("modalFlowView");
}

async function selectFlow(id) {
  state.activeFlowId = id;
  renderFlowsList();
  setFlowsTab("mis");
  const detail = await api(`/api/flows/${encodeURIComponent(id)}`);
  state.activeFlowDetail = detail.ok ? detail.flow : null;
  if (detail.ok && detail.flow && detail.flow.preview && detail.flow.preview.preview_url) {
    const a = $("flowPreviewLink");
    a.href = detail.flow.preview.preview_url;
    a.classList.remove("hidden");
  } else if ($("flowPreviewLink")) {
    $("flowPreviewLink").classList.add("hidden");
  }

  await Promise.all([loadFlowDetail(id), loadFlowSendProfile(id)]);
}

async function createFlowSampleKey(sample) {
  const key = sample || "hello";
  const res = await post("/api/flows", { sample: key });
  if (!res.ok) { toast(res.error || t("toast.flowCreateFailed"), "error"); return; }
  if (res.validation_errors && res.validation_errors.length) {
    toast(res.validation_errors[0].message || res.error || t("toast.flowInvalid"), "error");
    return;
  }
  toast(t("toast.flowCreated"), "ok");
  await loadFlows();
  closeFlowCreate();
  if (res.flow && res.flow.id) {
    selectFlow(res.flow.id);
  }
}

async function createFlowSample() {
  await createFlowSampleKey(($("flowSampleSelect") || {}).value || "hello");
}

async function publishActiveFlow() {
  const id = state.activeFlowId;
  if (!id) return;
  const res = await post(`/api/flows/${encodeURIComponent(id)}/publish`, {});
  if (!res.ok) { toast(res.error || t("toast.publishFailed"), "error"); return; }
  toast(t("toast.flowPublished"), "ok");
  await loadFlows();
  if (state.activeFlowId === id) {
    const detail = await api(`/api/flows/${encodeURIComponent(id)}`);
    state.activeFlowDetail = detail.ok ? detail.flow : null;
    await loadFlowDetail(id);
  }
}

function renderFlowActivityDetail(row) {
  const box = $("flowActivityDetail");
  if (!box || !row) return;
  box.classList.remove("hidden");

  let body = `<h3>${escapeHtml(row.name)}</h3>`;

  if (row.kind === "survey" && row.surveyResults && row.surveyResults.length) {
    body += `<p class="muted sm">${escapeHtml(t("flows.activity.surveyResults"))}</p>
      <table class="flow-survey-table billing-table">
        <thead><tr><th>${escapeHtml(t("flows.activity.colQuestion"))}</th><th>${escapeHtml(t("flows.activity.colAnswer"))}</th><th class="num">${escapeHtml(t("flows.activity.colPeople"))}</th><th class="num">%</th></tr></thead>
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
      <div class="flow-stat-card"><span class="n">${p.authorized}</span><span class="l">${escapeHtml(t("flows.stats.authorized"))}</span></div>
      <div class="flow-stat-card"><span class="n">${p.denied}</span><span class="l">${escapeHtml(t("flows.stats.denied"))}</span></div>
      <div class="flow-stat-card"><span class="n">${p.pending}</span><span class="l">${escapeHtml(t("flows.activity.pending"))}</span></div>
    </div>`;
  }

  if (row.recentResponses && row.recentResponses.length) {
    body += `<p class="muted sm" style="margin-top:8px">${escapeHtml(t("flows.activity.individualResponses"))}</p>
      <table class="flow-responses-mini billing-table">
        <thead><tr><th>${escapeHtml(t("flows.activity.colPhone"))}</th><th>${escapeHtml(t("flows.activity.colDate"))}</th><th>${escapeHtml(t("flows.activity.colData"))}</th></tr></thead><tbody>`;
    row.recentResponses.forEach((r) => {
      const ans = Object.entries(r.answers || {}).map(([k, v]) => `${k}: ${v}`).join(" · ") || "—";
      body += `<tr>
        <td>+${escapeHtml(r.phone)}</td>
        <td>${escapeHtml(localeActivityDate(r.receivedAt))}</td>
        <td>${escapeHtml(ans)}</td>
      </tr>`;
    });
    body += `</tbody></table>`;
  } else if (!row.surveyResults || !row.surveyResults.length) {
    body += `<p class="muted sm">${escapeHtml(t("flows.activity.noDetailYet"))}</p>`;
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
      [res.summary.total, t("flows.stats.withActivity")],
      [res.summary.sent, t("flows.stats.sent")],
      [res.summary.viewed, t("flows.stats.viewed")],
      [res.summary.completed, t("flows.stats.completed")],
    ].map(([n, l]) => `<div class="flow-stat-card"><span class="n">${n}</span><span class="l">${escapeHtml(l)}</span></div>`).join("");
  }

  if (!state.flowActivity.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="muted center">${escapeHtml(t("flows.emptyActivity"))}</td></tr>`;
    if (detail) detail.classList.add("hidden");
    return;
  }

  tbody.innerHTML = state.flowActivity.map((row, i) => {
    const kind = flowKindLabel(row.kind);
    return `<tr class="flow-activity-row${state.activeActivityRow === i ? " active" : ""}" data-i="${i}">
      <td>
        <strong>${escapeHtml(row.name)}</strong>
        <span class="kind-tag ${escapeHtml(row.kind)}">${escapeHtml(kind)}</span>
      </td>
      <td class="num">${row.sent}</td>
      <td class="num">${row.viewed}</td>
      <td class="num">${row.completed}${row.sent ? ` <span class="muted">(${row.completionRate}%)</span>` : ""}</td>
      <td>${escapeHtml(localeActivityDate(row.lastActivityAt))}</td>
      <td><span class="muted">${escapeHtml(t("flows.viewDetails"))}</span></td>
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

function updateSidebarCollapseBtn() {
  const nav = $("appNav");
  const btn = $("sidebarCollapseBtn");
  if (!nav || !btn) return;
  const collapsed = nav.classList.contains("collapsed");
  const key = collapsed ? "nav.expand" : "nav.collapse";
  btn.title = t(key);
  btn.setAttribute("aria-label", t(key));
}

function toggleSidebarCollapsed(forceExpand) {
  const nav = $("appNav");
  if (!nav) return;
  if (forceExpand === true) nav.classList.remove("collapsed");
  else if (forceExpand === false) nav.classList.add("collapsed");
  else nav.classList.toggle("collapsed");
  localStorage.setItem("pp-nav-collapsed", nav.classList.contains("collapsed") ? "1" : "0");
  updateSidebarCollapseBtn();
}

function initSidebar() {
  const nav = $("appNav");
  if (!nav) return;
  if (localStorage.getItem("pp-nav-collapsed") === "1") nav.classList.add("collapsed");
  updateSidebarCollapseBtn();
  const logo = $("railLogo");
  if (logo) {
    logo.addEventListener("click", () => {
      if (nav.classList.contains("collapsed")) toggleSidebarCollapsed(true);
    });
  }
}

function switchScreen(name) {
  if (!name || name === state.currentScreen) return;
  const prev = state.currentScreen;
  state.currentScreen = name;

  if (window.I18n) {
    I18n.ensureScreen(name).then(() => {
      I18n.applyDom();
      if (name === "workspace") setWorkspaceTab(state.workspaceTab || "profile");
    });
  }

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

  if (name === "chats") loadConversations();
  if (!state.pollTimer) startPolling();

  const cache = state.screenCache;
  if (name === "templates") {
    markTemplateNotificationsRead();
    refreshTemplatesScreen({ highlightName: state.pendingTemplateHighlight });
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
      renderPrices();
    }
    loadBilling();
  }
  if (name !== "bulk") stopBulkPolling();
  toggleWorkspaceFlyout(false);
  toggleNotifPanel(false);
}

/* ---------- realtime (SSE + polling) ---------- */
function pollIntervalMs() {
  if (document.hidden) return POLL_HIDDEN_MS;
  if (state.currentScreen === "chats") {
    return state.sseConnected ? POLL_CHAT_SSE_MS : POLL_CHAT_MS;
  }
  return POLL_IDLE_MS;
}

function startPolling() {
  stopPolling();
  const tick = async () => {
    try {
      await loadConversations();
      await loadNotifications();
      if (state.activePhone && state.currentScreen === "chats") {
        await Promise.all([
          loadMessages(state.activePhone),
          loadConversationDetail(state.activePhone),
        ]);
      }
    } catch (_) { /* keep polling alive */ }
    state.pollTimer = setTimeout(tick, pollIntervalMs());
  };
  state.pollTimer = setTimeout(tick, pollIntervalMs());
}

function stopPolling() {
  if (state.pollTimer) clearTimeout(state.pollTimer);
  state.pollTimer = null;
}

function handleStreamPayload(payload) {
  if (!payload || !payload.phone) return;
  const phone = String(payload.phone);
  const msg = payload.message;
  if (state.currentScreen === "chats") {
    loadConversations().catch(() => {});
    if (phone === state.activePhone) {
      loadMessages(phone).catch(() => {});
      loadConversationDetail(phone).catch(() => {});
    }
  }
  if (msg && msg.direction === "in") {
    loadNotifications().catch(() => {});
  }
}

function startRealtimeStream() {
  stopRealtimeStream();
  if (typeof EventSource === "undefined") return;
  try {
    const es = new EventSource("/api/stream");
    state.sseSource = es;
    es.onopen = () => { state.sseConnected = true; };
    es.onmessage = (ev) => {
      if (!ev.data) return;
      try {
        handleStreamPayload(JSON.parse(ev.data));
      } catch (_) { /* ignore ping / comments */ }
    };
    es.onerror = () => {
      state.sseConnected = false;
      es.close();
      state.sseSource = null;
      window.setTimeout(() => {
        const gate = $("loginGate");
        if (gate && !gate.classList.contains("hidden")) return;
        startRealtimeStream();
      }, 5000);
    };
  } catch (_) {
    state.sseConnected = false;
  }
}

function stopRealtimeStream() {
  state.sseConnected = false;
  if (state.sseSource) {
    state.sseSource.close();
    state.sseSource = null;
  }
}

/* ---------- events ---------- */
function bindEvents() {
  const notifBtn = $("notifBtn");
  if (notifBtn) {
    notifBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleNotifPanel();
    });
  }
  const notifBtnMobile = $("notifBtnMobile");
  if (notifBtnMobile) {
    notifBtnMobile.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleNotifPanel();
    });
  }
  const notifMarkAllBtn = $("notifMarkAllBtn");
  if (notifMarkAllBtn) notifMarkAllBtn.addEventListener("click", () => markAllNotificationsRead());
  const notifBrowserBtn = $("notifBrowserBtn");
  if (notifBrowserBtn) notifBrowserBtn.addEventListener("click", () => requestBrowserNotifications());
  const notifSoundBtn = $("notifSoundBtn");
  if (notifSoundBtn) notifSoundBtn.addEventListener("click", () => toggleNotifySound());
  document.addEventListener("pointerdown", () => ensureNotifyAudio(), { passive: true });
  document.addEventListener("click", (e) => {
    const panel = $("notifPanel");
    if (!panel || panel.classList.contains("hidden")) return;
    if (panel.contains(e.target) || e.target.closest("#notifBtn, #notifBtnMobile")) return;
    toggleNotifPanel(false);
  });

  document.querySelectorAll(".nav-item[data-screen]").forEach((b) =>
    b.addEventListener("click", () => switchScreen(b.dataset.screen))
  );
  const collapseBtn = $("sidebarCollapseBtn");
  if (collapseBtn) collapseBtn.addEventListener("click", () => toggleSidebarCollapsed());
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
  $("replyCancel")?.addEventListener("click", clearReplyTo);
  $("newChatBtn").addEventListener("click", () => openNewChat());
  $("ncTemplate").addEventListener("change", async (e) => {
    renderTemplateFields(tplByName(e.target.value));
    syncNcNameToBodyVar();
    updateNewChatCategoryHint();
    await ensureNcFlowPreviewProfile(e.target.value);
    await updateNcPreview();
  });
  $("ncName")?.addEventListener("input", syncNcNameToBodyVar);
  $("ncFields")?.addEventListener("input", () => updateNcPreview());
  $("ncSend").addEventListener("click", sendNewChat);
  $("attachBtn").addEventListener("click", () => showModal("modalMedia"));
  const locationBtn = $("locationBtn");
  if (locationBtn) locationBtn.addEventListener("click", openLocationModal);
  const locSend = $("locSend");
  if (locSend) locSend.addEventListener("click", sendLocation);
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
  const wsSaveLang = $("wsSaveLanguage");
  if (wsSaveLang) wsSaveLang.addEventListener("click", savePortalLanguage);
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
      if (!key) return;
      submitPresetToMeta(key);
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
  const fsJsonBtn = $("fsJsonBtn");
  if (fsJsonBtn) {
    fsJsonBtn.addEventListener("click", () => {
      if (fsState.screens.length) openFsJsonPreview();
      else openFsJsonImportEmpty();
    });
  }
  $("flowJsonDownloadBtn")?.addEventListener("click", downloadFlowJsonFromModal);
  $("flowJsonImportBtn")?.addEventListener("click", importFlowJsonFromModal);
  const fsPickerToggle = $("fsPickerToggle");
  if (fsPickerToggle) {
    fsPickerToggle.addEventListener("click", () => $("flowCreatePicker")?.classList.toggle("hidden"));
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
  if (flowDetailProbarBtn) flowDetailProbarBtn.addEventListener("click", openFlowDetailProbar);
  const bookingSendBtn = $("bookingSendBtn");
  if (bookingSendBtn) bookingSendBtn.addEventListener("click", sendBookingTest);
  const bookingOpenTplBtn = $("bookingOpenTplBtn");
  if (bookingOpenTplBtn) {
    bookingOpenTplBtn.addEventListener("click", () => openTplDraftModal("punto_pago_reserva_cita"));
  }
  ["bookingPhone", "bookingCustomerName"].forEach((id) => {
    const el = $(id);
    if (el) el.addEventListener("input", updateBookingPreview);
  });
  const bookingAvailBtn = $("bookingAvailBtn");
  if (bookingAvailBtn) bookingAvailBtn.addEventListener("click", checkBookingAvailability);
  ["tpHeader", "tpBody", "tpFooter"].forEach((id) => {
    const el = $(id);
    if (el) el.addEventListener("input", updateTpPreview);
  });
  $("flowPublishBtn")?.addEventListener("click", publishActiveFlow);
  $("flowDeleteBtn")?.addEventListener("click", deleteActiveFlow);
  $("flowDeprecateBtn")?.addEventListener("click", deprecateActiveFlow);
  $("flowExportJsonBtn")?.addEventListener("click", exportActiveFlowJson);
  $("flowEditDraftBtn")?.addEventListener("click", openFlowEditDraft);
  $("flowSendBtn")?.addEventListener("click", openFlowSendModal);
  $("flowSendConfirmBtn")?.addEventListener("click", confirmFlowSend);
  $("fsCancelEditBtn")?.addEventListener("click", cancelFlowStudioEdit);
  $("flowRefreshResponses")?.addEventListener("click", loadFlowActivity);
  if ($("flowEndpointSetupBtn")) $("flowEndpointSetupBtn").addEventListener("click", setupFlowEndpoint);
  if ($("payAuthSendBtn")) $("payAuthSendBtn").addEventListener("click", sendPaymentAuthTest);
  $("detailTemplateBtn").addEventListener("click", () => {
    const d = state.conversationDetail || {};
    openNewChat(null, { phone: state.activePhone, name: d.name || d.profileName || "" });
  });
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
