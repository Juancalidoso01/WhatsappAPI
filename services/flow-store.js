"use strict";

const redis = require("./upstash");

const PREFIX = "wa:flow:response:";
const LIST_KEY = "wa:flow:responses";
const mem = [];

function parseRow(raw, id) {
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch (_) { return null; }
  }
  return raw;
}

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
    ]);
  } else {
    mem.unshift(row);
    if (mem.length > 200) mem.length = 200;
  }
  return row;
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
  return mem.slice(0, limit);
}

module.exports = { saveResponse, listResponses };
