"use strict";

const redis = require("./upstash");
const { parseRedisJson } = require("./redis-json");

const PREFIX = "wa:booking:";
const LIST_KEY = "wa:booking:list";
const TTL_SEC = 3600;
const mem = new Map();

function tokenId() {
  return `booking_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

async function create({ phone, customerName, flowToken: existingToken }) {
  const flowToken = existingToken || tokenId();
  const row = {
    flowToken,
    phone: phone ? String(phone).replace(/\D/g, "") : "",
    customerName: String(customerName || "").trim(),
    status: "pending",
    branchId: null,
    date: null,
    slotId: null,
    slotLabel: null,
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

async function confirm(flowToken, details) {
  const row = await get(flowToken);
  if (!row) return null;

  row.status = "confirmed";
  row.branchId = details.branchId || null;
  row.date = details.date || null;
  row.slotId = details.slotId || null;
  row.slotLabel = details.slotLabel || null;
  row.customerName = details.customerName || row.customerName;
  row.confirmedAt = Date.now();

  if (redis) {
    await redis.set(`${PREFIX}${flowToken}`, JSON.stringify(row), { ex: 86400 });
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

module.exports = { tokenId, create, get, confirm, listRecent };
