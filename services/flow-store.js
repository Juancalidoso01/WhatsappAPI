"use strict";

const redis = require("./upstash");
const { parseRedisJson } = require("./redis-json");

const PREFIX = "wa:flow:response:";
const LIST_KEY = "wa:flow:responses";
const SEND_LIST = "wa:flow:sends";
const STATS_KEY = "wa:flow:stats";
const EVENT_LIST = "wa:flow:endpoint:events";
const mem = { responses: [], sends: [], events: [], stats: { sends: 0, responses: 0, endpointCalls: 0 } };

async function resolveTokenMeta(flowToken) {
  if (!flowToken || !redis) return null;
  const raw = await redis.get(`wa:flow:token:${flowToken}`);
  if (!raw) return null;
  try {
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (_) {
    return { flowId: String(raw) };
  }
}

async function saveResponse({ phone, flowToken, responseJson, messageId, contextMessageId }) {
  const tokenMeta = flowToken ? await resolveTokenMeta(flowToken) : null;
  const id = `fr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const row = {
    id,
    phone: String(phone),
    flowToken: flowToken || null,
    flowId: tokenMeta && tokenMeta.flowId ? String(tokenMeta.flowId) : null,
    flowName: tokenMeta && tokenMeta.flowName ? tokenMeta.flowName : null,
    responseJson,
    messageId: messageId || null,
    contextMessageId: contextMessageId || null,
    receivedAt: Date.now(),
  };

  if (redis) {
    await Promise.all([
      redis.set(`${PREFIX}${id}`, JSON.stringify(row)),
      redis.zadd(LIST_KEY, { score: row.receivedAt, member: id }),
      redis.hincrby(STATS_KEY, "responses", 1),
    ]);
  } else {
    mem.responses.unshift(row);
    mem.stats.responses++;
    if (mem.responses.length > 200) mem.responses.length = 200;
  }
  return row;
}

async function recordSend({ phone, flowId, flowToken, mode, flowName, dynamicHandler }) {
  const id = `fs_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const row = {
    id,
    phone: String(phone),
    flowId,
    flowToken,
    flowName: flowName || null,
    dynamicHandler: dynamicHandler || null,
    mode: mode || "published",
    sentAt: Date.now(),
  };
  if (redis) {
    const ops = [
      redis.set(`${PREFIX}send:${id}`, JSON.stringify(row)),
      redis.zadd(SEND_LIST, { score: row.sentAt, member: id }),
      redis.hincrby(STATS_KEY, "sends", 1),
    ];
    if (flowToken && flowId) {
      const meta = { flowId: String(flowId), flowName: flowName || null };
      if (row.dynamicHandler) meta.dynamicHandler = row.dynamicHandler;
      ops.push(redis.set(`wa:flow:token:${flowToken}`, JSON.stringify(meta), { ex: 604800 }));
    }
    await Promise.all(ops);
  } else {
    mem.sends.unshift(row);
    mem.stats.sends++;
  }
  return row;
}

async function recordEndpointEvent(event) {
  const id = `fe_${Date.now()}`;
  const row = { id, ...event, at: Date.now() };
  try {
    if (redis) {
      await Promise.all([
        redis.set(`${PREFIX}event:${id}`, JSON.stringify(row)),
        redis.zadd(EVENT_LIST, { score: row.at, member: id }),
        redis.hincrby(STATS_KEY, "endpointCalls", 1),
      ]);
    } else {
      mem.events.unshift(row);
      mem.stats.endpointCalls++;
      if (mem.events.length > 100) mem.events.length = 100;
    }
  } catch (err) {
    console.error("recordEndpointEvent error:", err.message || err);
  }
  return row;
}

async function getStats() {
  if (redis) {
    const raw = await redis.hgetall(STATS_KEY);
    return {
      sends: Number(raw.sends || 0),
      responses: Number(raw.responses || 0),
      endpointCalls: Number(raw.endpointCalls || 0),
    };
  }
  return { ...mem.stats };
}

async function listResponses({ limit = 50 } = {}) {
  if (redis) {
    const ids = await redis.zrange(LIST_KEY, 0, limit - 1, { rev: true });
    const rows = await Promise.all((ids || []).map(async (id) => {
      const raw = await redis.get(`${PREFIX}${id}`);
      return parseRedisJson(raw);
    }));
    return rows.filter(Boolean);
  }
  return mem.responses.slice(0, limit);
}

async function listSends({ limit = 50 } = {}) {
  if (redis) {
    const ids = await redis.zrange(SEND_LIST, 0, limit - 1, { rev: true });
    const rows = await Promise.all((ids || []).map(async (id) => {
      const raw = await redis.get(`${PREFIX}send:${id}`);
      return parseRedisJson(raw);
    }));
    return rows.filter(Boolean);
  }
  return mem.sends.slice(0, limit);
}

async function listEndpointEvents({ limit = 50 } = {}) {
  if (redis) {
    const ids = await redis.zrange(EVENT_LIST, 0, limit - 1, { rev: true });
    const rows = await Promise.all((ids || []).map(async (id) => {
      const raw = await redis.get(`${PREFIX}event:${id}`);
      return parseRedisJson(raw);
    }));
    return rows.filter(Boolean);
  }
  return mem.events.slice(0, limit);
}

module.exports = {
  saveResponse,
  recordSend,
  recordEndpointEvent,
  getStats,
  listResponses,
  listSends,
  listEndpointEvents,
  resolveTokenMeta,
};
