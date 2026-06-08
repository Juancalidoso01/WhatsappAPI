"use strict";

const redis = require("./upstash");

const PREFIX = "wa:flow:response:";
const LIST_KEY = "wa:flow:responses";
const SEND_LIST = "wa:flow:sends";
const STATS_KEY = "wa:flow:stats";
const EVENT_LIST = "wa:flow:endpoint:events";
const mem = { responses: [], sends: [], events: [], stats: { sends: 0, responses: 0, endpointCalls: 0 } };

async function saveResponse({ phone, flowToken, responseJson, messageId, contextMessageId }) {
  const id = `fr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const row = {
    id,
    phone: String(phone),
    flowToken: flowToken || null,
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

async function recordSend({ phone, flowId, flowToken, mode }) {
  const id = `fs_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const row = {
    id,
    phone: String(phone),
    flowId,
    flowToken,
    mode: mode || "published",
    sentAt: Date.now(),
  };
  if (redis) {
    await Promise.all([
      redis.set(`${PREFIX}send:${id}`, JSON.stringify(row)),
      redis.zadd(SEND_LIST, { score: row.sentAt, member: id }),
      redis.hincrby(STATS_KEY, "sends", 1),
    ]);
  } else {
    mem.sends.unshift(row);
    mem.stats.sends++;
  }
  return row;
}

async function recordEndpointEvent(event) {
  const id = `fe_${Date.now()}`;
  const row = { id, ...event, at: Date.now() };
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
      return raw ? JSON.parse(raw) : null;
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
      return raw ? JSON.parse(raw) : null;
    }));
    return rows.filter(Boolean);
  }
  return mem.sends.slice(0, limit);
}

module.exports = {
  saveResponse,
  recordSend,
  recordEndpointEvent,
  getStats,
  listResponses,
  listSends,
};
