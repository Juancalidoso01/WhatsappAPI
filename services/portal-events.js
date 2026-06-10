"use strict";

/**
 * Eventos del portal para el centro de notificaciones (polling desde el UI).
 * Persiste en Redis cuando está disponible; memoria en local.
 */

const redis = require("./upstash");

const PREFIX = "wa:portal:";
const EVENTS_KEY = `${PREFIX}events`;
const READ_IDS_KEY = `${PREFIX}readids`;
const TPL_STATUS_KEY = `${PREFIX}tplstatus`;
const MAX_EVENTS = 120;

const NOTIFY_TEMPLATE_STATUSES = new Set([
  "APPROVED", "REJECTED", "PAUSED", "DISABLED", "FLAGGED", "REINSTATED",
]);

const memEvents = [];
const memReadIds = new Set();
const memTplStatus = new Map();

function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseRow(raw) {
  if (!raw) return null;
  try {
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (_) {
    return null;
  }
}

function chatPreview(text, type) {
  if (text) return String(text).slice(0, 160);
  const labels = {
    image: "[imagen]",
    audio: "[nota de voz]",
    video: "[video]",
    document: "[documento]",
    sticker: "[sticker]",
    location: "[ubicación]",
  };
  return labels[type] || "[mensaje]";
}

async function push(event) {
  const row = {
    id: newId(),
    at: Date.now(),
    type: event.type,
    meta: event.meta || {},
  };
  if (redis) {
    await redis.lpush(EVENTS_KEY, JSON.stringify(row));
    await redis.ltrim(EVENTS_KEY, 0, MAX_EVENTS - 1);
  } else {
    memEvents.unshift(row);
    if (memEvents.length > MAX_EVENTS) memEvents.length = MAX_EVENTS;
  }
  return row;
}

async function listRecent(limit = 40) {
  let rows;
  if (redis) {
    const raw = await redis.lrange(EVENTS_KEY, 0, MAX_EVENTS - 1);
    rows = (raw || []).map(parseRow).filter(Boolean);
  } else {
    rows = [...memEvents];
  }
  return rows.slice(0, limit);
}

async function listSince(since = 0, limit = 40) {
  const rows = await listRecent(MAX_EVENTS);
  return rows
    .filter((e) => e.at > since)
    .sort((a, b) => b.at - a.at)
    .slice(0, limit);
}

async function getReadIds() {
  if (redis) {
    const ids = await redis.smembers(READ_IDS_KEY);
    return new Set(Array.isArray(ids) ? ids : []);
  }
  return new Set(memReadIds);
}

async function markRead(ids) {
  const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
  if (!list.length) return { ok: true, marked: 0 };
  if (redis) {
    await redis.sadd(READ_IDS_KEY, ...list);
  } else {
    list.forEach((id) => memReadIds.add(id));
  }
  return { ok: true, marked: list.length };
}

async function markAllRead() {
  const rows = await listRecent(MAX_EVENTS);
  return markRead(rows.map((r) => r.id));
}

async function markChatReadForPhone(phone) {
  const target = String(phone || "");
  if (!target) return { ok: true, marked: 0, ids: [] };
  const rows = await listRecent(MAX_EVENTS);
  const readIds = await getReadIds();
  const ids = rows
    .filter((e) => e.type === "chat"
      && String(e.meta && e.meta.phone) === target
      && !readIds.has(e.id))
    .map((e) => e.id);
  const result = await markRead(ids);
  return { ...result, ids };
}

async function markTypeRead(type) {
  const rows = await listRecent(MAX_EVENTS);
  const readIds = await getReadIds();
  const ids = rows
    .filter((e) => e.type === type && !readIds.has(e.id))
    .map((e) => e.id);
  const result = await markRead(ids);
  return { ...result, ids };
}

async function unreadCount() {
  const [rows, readIds] = await Promise.all([listRecent(50), getReadIds()]);
  return rows.filter((e) => !readIds.has(e.id)).length;
}

async function enrichWithRead(rows) {
  const readIds = await getReadIds();
  return rows.map((e) => ({ ...e, read: readIds.has(e.id) }));
}

async function pushChatMessage({ phone, name, text, type, messageId }) {
  if (!phone) return null;
  return push({
    type: "chat",
    meta: {
      phone: String(phone),
      name: name || String(phone),
      preview: chatPreview(text, type),
      messageId: messageId || null,
    },
  });
}

async function pushTemplateStatus({ name, language, status, reason, previousStatus }) {
  const st = String(status || "").toUpperCase();
  if (!NOTIFY_TEMPLATE_STATUSES.has(st)) return null;
  return push({
    type: "template",
    meta: {
      name: String(name || ""),
      language: String(language || ""),
      status: st,
      reason: reason ? String(reason) : null,
      previousStatus: previousStatus ? String(previousStatus).toUpperCase() : null,
    },
  });
}

async function syncTemplateStatuses(templates) {
  const emitted = [];
  for (const t of templates || []) {
    const key = `${t.name}|${t.language}`;
    const status = String(t.status || "").toUpperCase();
    let prev = null;
    if (redis) {
      prev = await redis.hget(TPL_STATUS_KEY, key);
    } else {
      prev = memTplStatus.get(key) || null;
    }
    if (prev && prev !== status) {
      const ev = await pushTemplateStatus({
        name: t.name,
        language: t.language,
        status,
        previousStatus: prev,
      });
      if (ev) emitted.push(ev);
    }
    if (redis) {
      await redis.hset(TPL_STATUS_KEY, { [key]: status });
    } else {
      memTplStatus.set(key, status);
    }
  }
  return emitted;
}

module.exports = {
  push,
  pushChatMessage,
  pushTemplateStatus,
  syncTemplateStatuses,
  listRecent,
  listSince,
  enrichWithRead,
  markRead,
  markAllRead,
  markChatReadForPhone,
  markTypeRead,
  unreadCount,
};
