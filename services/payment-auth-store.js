"use strict";

const redis = require("./upstash");
const { parseRedisJson } = require("./redis-json");

const PREFIX = "wa:payauth:";
const LIST_KEY = "wa:payauth:list";
const TTL_SEC = 600;
const mem = new Map();

function tokenId() {
  return `payauth_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

async function create({ phone, merchant, amount, currency, cardLast4 }) {
  const flowToken = tokenId();
  const row = {
    flowToken,
    phone: String(phone).replace(/\D/g, ""),
    merchant: String(merchant || "Comercio").trim(),
    amount: String(amount || "0"),
    currency: currency || "USD",
    cardLast4: String(cardLast4 || "0000").slice(-4),
    status: "pending",
    decision: null,
    createdAt: Date.now(),
    expiresAt: Date.now() + TTL_SEC * 1000,
  };

  if (redis) {
    await Promise.all([
      redis.set(`${PREFIX}${flowToken}`, JSON.stringify(row), { ex: TTL_SEC }),
      redis.zadd(LIST_KEY, { score: row.createdAt, member: flowToken }),
    ]);
  } else {
    mem.set(flowToken, row);
  }
  return row;
}

async function get(flowToken) {
  if (!flowToken) return null;
  if (redis) {
    const raw = await redis.get(`${PREFIX}${flowToken}`);
    return parseRedisJson(raw);
  }
  const row = mem.get(flowToken) || null;
  if (row && row.expiresAt < Date.now()) {
    mem.delete(flowToken);
    return null;
  }
  return row;
}

async function resolve(flowToken, decision) {
  const row = await get(flowToken);
  if (!row) return null;
  if (row.status !== "pending") return row;

  row.status = "resolved";
  row.decision = decision === "authorize" ? "authorize" : "deny";
  row.resolvedAt = Date.now();

  if (redis) {
    await redis.set(`${PREFIX}${flowToken}`, JSON.stringify(row), { ex: 3600 });
  } else {
    mem.set(flowToken, row);
  }
  return row;
}

async function listRecent({ limit = 20 } = {}) {
  if (redis) {
    const ids = await redis.zrange(LIST_KEY, 0, limit - 1, { rev: true });
    const rows = await Promise.all((ids || []).map((id) => get(id)));
    return rows.filter(Boolean);
  }
  return [...mem.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}

module.exports = { create, get, resolve, listRecent, tokenId };
