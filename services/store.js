/**
 * Conversation/message store for the web interface.
 *
 * Two backends behind one async interface:
 *  - Upstash Redis (when configured) -> persistent across serverless instances.
 *  - In-memory (fallback) -> great for local dev without extra infra.
 *
 * A small in-process EventEmitter is kept for real-time SSE on long-lived
 * servers (local). On serverless the UI relies on polling instead.
 *
 * Redis layout (prefixed with "wa:" so it can safely share a database):
 *   wa:convos              ZSET   score=lastActivity, member=phone
 *   wa:convo:<phone>       HASH   { name, phoneNumberId, firstSeen, notes, conversationOrigin, windowExpiresAt }
 *   wa:msgs:<phone>        LIST   JSON messages (oldest -> newest)
 *   wa:tplmeta             HASH   templateKey -> JSON { requestedCategory, pendingCategory, ... }
 */

"use strict";

const EventEmitter = require("events");
const redis = require("./upstash");

const PREFIX = "wa:";
const MAX_CONVOS = 100;

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

// ---------- In-memory fallback ----------
const memConversations = new Map();
const memTemplateMeta = new Map();

function templateKey(name, language) {
  return `${String(name)}|${String(language || "")}`;
}

function memGetOrCreate(phone, name, phoneNumberId) {
  let convo = memConversations.get(phone);
  if (!convo) {
    convo = {
      phone,
      name: name || phone,
      phoneNumberId: phoneNumberId || null,
      messages: [],
      lastActivity: Date.now(),
    };
    memConversations.set(phone, convo);
  }
  if (name && (!convo.name || convo.name === convo.phone)) convo.name = name;
  if (phoneNumberId) convo.phoneNumberId = phoneNumberId;
  return convo;
}

// ---------- Helpers ----------
function buildMessage({
  direction, text, type = "text", status = null, id = null,
  media = null, mediaId = null, voice = null,
}) {
  const message = {
    id: id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    direction,
    text,
    type,
    status,
    timestamp: Date.now(),
  };
  if (media) message.media = media;
  if (mediaId) message.mediaId = mediaId;
  if (voice != null) message.voice = voice;
  return message;
}

// ---------- Public API ----------
async function addMessage({
  phone,
  name,
  phoneNumberId,
  direction,
  text,
  type = "text",
  status = null,
  id = null,
  media = null,
  mediaId = null,
  voice = null,
}) {
  const message = buildMessage({ direction, text, type, status, id, media, mediaId, voice });

  if (redis) {
    const convoKey = `${PREFIX}convo:${phone}`;
    const meta = {};
    if (name) meta.name = name;
    if (phoneNumberId) meta.phoneNumberId = phoneNumberId;
    const ops = [
      redis.rpush(`${PREFIX}msgs:${phone}`, JSON.stringify(message)),
      redis.zadd(`${PREFIX}convos`, { score: message.timestamp, member: phone }),
    ];
    if (Object.keys(meta).length) ops.push(redis.hset(convoKey, meta));
    ops.push(redis.hsetnx(convoKey, "name", name || phone));
    ops.push(redis.hsetnx(convoKey, "firstSeen", String(message.timestamp)));
    await Promise.all(ops);
  } else {
    const convo = memGetOrCreate(phone, name, phoneNumberId);
    if (!convo.firstSeen) convo.firstSeen = message.timestamp;
    convo.messages.push(message);
    convo.lastActivity = message.timestamp;
  }

  emitter.emit("message", { phone, name: name || phone, message });
  return message;
}

async function updateMessageId(phone, localId, waId) {
  if (!localId || !waId || localId === waId) return;

  if (redis) {
    const key = `${PREFIX}msgs:${String(phone)}`;
    const raw = await redis.lrange(key, 0, -1);
    for (let i = 0; i < raw.length; i++) {
      const msg = typeof raw[i] === "string" ? JSON.parse(raw[i]) : raw[i];
      if (msg.id === localId) {
        msg.id = waId;
        await redis.lset(key, i, JSON.stringify(msg));
        emitter.emit("message", { phone: String(phone), name: String(phone), message: msg });
        return;
      }
    }
    return;
  }

  const convo = memConversations.get(String(phone));
  if (!convo) return;
  const message = convo.messages.find((m) => m.id === localId);
  if (message) {
    message.id = waId;
    emitter.emit("message", { phone: convo.phone, name: convo.name, message });
  }
}

async function updateMessageStatus(phone, messageId, status) {
  if (redis) {
    const key = `${PREFIX}msgs:${String(phone)}`;
    const raw = await redis.lrange(key, 0, -1);
    for (let i = 0; i < raw.length; i++) {
      const msg = typeof raw[i] === "string" ? JSON.parse(raw[i]) : raw[i];
      if (msg.id === messageId) {
        msg.status = status;
        await redis.lset(key, i, JSON.stringify(msg));
        emitter.emit("message", { phone, name: phone, message: msg });
        return;
      }
    }
    return;
  }

  const convo = memConversations.get(phone);
  if (!convo) return;
  const message = convo.messages.find((m) => m.id === messageId);
  if (message) {
    message.status = status;
    emitter.emit("message", { phone, name: convo.name, message });
  }
}

function parseConvoMeta(meta, phone) {
  if (!meta || !Object.keys(meta).length) return null;
  return {
    phone: String(phone),
    name: String(meta.name || phone),
    phoneNumberId: meta.phoneNumberId ? String(meta.phoneNumberId) : null,
    firstSeen: meta.firstSeen ? Number(meta.firstSeen) : null,
    conversationOrigin: meta.conversationOrigin || null,
    windowExpiresAt: meta.windowExpiresAt ? Number(meta.windowExpiresAt) : null,
    notes: meta.notes || "",
  };
}

async function updateConversationMeta(phone, fields) {
  const p = String(phone);
  const clean = {};
  Object.entries(fields || {}).forEach(([k, v]) => {
    if (v != null && v !== "") clean[k] = String(v);
  });
  if (!Object.keys(clean).length) return;

  if (redis) {
    await redis.hset(`${PREFIX}convo:${p}`, clean);
    return;
  }
  const convo = memGetOrCreate(p);
  Object.assign(convo, clean);
  if (clean.firstSeen && !convo.firstSeen) convo.firstSeen = Number(clean.firstSeen);
  if (clean.windowExpiresAt) convo.windowExpiresAt = Number(clean.windowExpiresAt);
}

function computeMessageStats(messages) {
  const stats = { total: 0, in: 0, out: 0, byType: {} };
  let firstSeen = null;
  let lastInbound = null;
  (messages || []).forEach((m) => {
    stats.total++;
    if (m.direction === "in") {
      stats.in++;
      lastInbound = m.timestamp;
    } else {
      stats.out++;
    }
    const t = m.type || "text";
    stats.byType[t] = (stats.byType[t] || 0) + 1;
    if (!firstSeen || m.timestamp < firstSeen) firstSeen = m.timestamp;
  });
  return { stats, firstSeen, lastInbound };
}

async function getConversation(phone) {
  return getConversationMeta(phone);
}

async function getConversationMeta(phone) {
  const p = String(phone);
  if (redis) {
    const meta = await redis.hgetall(`${PREFIX}convo:${p}`);
    return parseConvoMeta(meta, p);
  }
  const convo = memConversations.get(p);
  return convo ? parseConvoMeta(convo, p) : null;
}

async function getConversationDetail(phone) {
  const p = String(phone);
  const [meta, messages] = await Promise.all([getConversationMeta(p), getMessages(p)]);
  const { stats, firstSeen, lastInbound } = computeMessageStats(messages);
  return {
    ...(meta || { phone: p, name: p, phoneNumberId: null, notes: "" }),
    firstSeen: (meta && meta.firstSeen) || firstSeen,
    stats,
    lastInbound,
  };
}

async function listConversations() {
  if (redis) {
    const phones = await redis.zrange(`${PREFIX}convos`, 0, MAX_CONVOS - 1, {
      rev: true,
    });
    if (!phones || !phones.length) return [];

    const results = await Promise.all(
      phones.map(async (rawPhone) => {
        // Upstash auto-parses all-digit members as numbers; keep phones as text.
        const phone = String(rawPhone);
        const [meta, lastRaw, score] = await Promise.all([
          redis.hgetall(`${PREFIX}convo:${phone}`),
          redis.lindex(`${PREFIX}msgs:${phone}`, -1),
          redis.zscore(`${PREFIX}convos`, phone),
        ]);
        const lastMessage = lastRaw
          ? typeof lastRaw === "string"
            ? JSON.parse(lastRaw)
            : lastRaw
          : null;
        return {
          phone,
          name: String((meta && meta.name) || phone),
          lastActivity: Number(score) || (lastMessage && lastMessage.timestamp) || 0,
          lastMessage,
        };
      })
    );
    return results;
  }

  return Array.from(memConversations.values())
    .sort((a, b) => b.lastActivity - a.lastActivity)
    .map((c) => ({
      phone: c.phone,
      name: c.name,
      lastActivity: c.lastActivity,
      lastMessage: c.messages[c.messages.length - 1] || null,
    }));
}

async function getMessages(phone) {
  if (redis) {
    const raw = await redis.lrange(`${PREFIX}msgs:${phone}`, 0, -1);
    return (raw || []).map((m) => (typeof m === "string" ? JSON.parse(m) : m));
  }
  const convo = memConversations.get(phone);
  return convo ? convo.messages : [];
}

function subscribe(listener) {
  emitter.on("message", listener);
  return () => emitter.off("message", listener);
}

function isPersistent() {
  return Boolean(redis);
}

async function readTemplateMetaEntry(key) {
  if (redis) {
    const raw = await redis.hget(`${PREFIX}tplmeta`, key);
    return raw ? JSON.parse(raw) : {};
  }
  return memTemplateMeta.get(key) || {};
}

async function writeTemplateMetaEntry(key, data) {
  if (redis) {
    await redis.hset(`${PREFIX}tplmeta`, { [key]: JSON.stringify(data) });
    return;
  }
  memTemplateMeta.set(key, data);
}

async function setTemplateRequestedCategory(name, language, category, extra = {}) {
  const key = templateKey(name, language);
  const prev = await readTemplateMetaEntry(key);
  await writeTemplateMetaEntry(key, {
    ...prev,
    requestedCategory: String(category).toUpperCase(),
    updatedAt: Date.now(),
    ...extra,
  });
}

async function updateTemplateCategoryFromWebhook({
  name, language, correctCategory, newCategory, previousCategory,
}) {
  const key = templateKey(name, language);
  const prev = await readTemplateMetaEntry(key);
  const next = { ...prev, updatedAt: Date.now() };

  if (correctCategory && !previousCategory) {
    next.pendingCategory = String(correctCategory).toUpperCase();
    if (newCategory) next.pendingFrom = String(newCategory).toUpperCase();
  }
  if (previousCategory && newCategory) {
    next.previousCategory = String(previousCategory).toUpperCase();
    next.lastAssignedCategory = String(newCategory).toUpperCase();
    delete next.pendingCategory;
    delete next.pendingFrom;
  } else if (newCategory && !correctCategory && !previousCategory) {
    next.lastAssignedCategory = String(newCategory).toUpperCase();
  }

  await writeTemplateMetaEntry(key, next);
}

async function getAllTemplateMeta() {
  if (redis) {
    const all = await redis.hgetall(`${PREFIX}tplmeta`);
    if (!all) return {};
    const out = {};
    Object.entries(all).forEach(([k, v]) => {
      if (v == null) return;
      if (typeof v === "object") {
        out[k] = v;
        return;
      }
      try { out[k] = JSON.parse(v); } catch (_) { /* skip */ }
    });
    return out;
  }
  const out = {};
  memTemplateMeta.forEach((v, k) => { out[k] = v; });
  return out;
}

module.exports = {
  addMessage,
  updateMessageId,
  updateMessageStatus,
  updateConversationMeta,
  getConversation,
  getConversationMeta,
  getConversationDetail,
  listConversations,
  getMessages,
  subscribe,
  isPersistent,
  setTemplateRequestedCategory,
  updateTemplateCategoryFromWebhook,
  getAllTemplateMeta,
};
