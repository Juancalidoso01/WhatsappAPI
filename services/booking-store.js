"use strict";

const redis = require("./upstash");
const { parseRedisJson } = require("./redis-json");

const PREFIX = "wa:booking:";
const LIST_KEY = "wa:booking:list";
const SLOT_PREFIX = "wa:booking:slot:";
const DATE_INDEX_PREFIX = "wa:booking:date:";
const TTL_SEC = 3600;
const SLOT_TTL_SEC = 90 * 86400;
const mem = new Map();
const memSlots = new Map();
const memDateIndex = new Map();

function tokenId() {
  return `booking_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function slotKey(branchId, date, slotId) {
  return `${SLOT_PREFIX}${branchId}:${date}:${slotId}`;
}

function dateIndexKey(branchId, date) {
  return `${DATE_INDEX_PREFIX}${branchId}:${date}`;
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

async function listTakenSlotIds(branchId, date) {
  if (!branchId || !date) return new Set();
  const idxKey = dateIndexKey(branchId, date);
  if (redis) {
    const ids = await redis.smembers(idxKey);
    return new Set((ids || []).map(String));
  }
  return new Set(memDateIndex.get(idxKey) || []);
}

async function reserveSlot(branchId, date, slotId, flowToken) {
  if (!branchId || !date || !slotId) return { ok: false, error: "missing_fields" };

  const key = slotKey(branchId, date, slotId);
  if (redis) {
    const existing = await redis.get(key);
    if (existing && existing !== flowToken) return { ok: false, error: "slot_taken" };
    await redis.set(key, flowToken, { ex: SLOT_TTL_SEC });
    await redis.sadd(dateIndexKey(branchId, date), slotId);
  } else {
    const owner = memSlots.get(key);
    if (owner && owner !== flowToken) return { ok: false, error: "slot_taken" };
    memSlots.set(key, flowToken);
    const idxKey = dateIndexKey(branchId, date);
    const set = memDateIndex.get(idxKey) || new Set();
    set.add(slotId);
    memDateIndex.set(idxKey, set);
  }
  return { ok: true };
}

async function confirm(flowToken, details) {
  const row = await get(flowToken);
  if (!row) return { ok: false, error: "not_found" };

  const branchId = details.branchId || null;
  const date = details.date || null;
  const slotId = details.slotId || null;

  if (branchId && date && slotId) {
    const reserved = await reserveSlot(branchId, date, slotId, flowToken);
    if (!reserved.ok) return reserved;
  }

  row.status = "confirmed";
  row.branchId = branchId;
  row.date = date;
  row.slotId = slotId;
  row.slotLabel = details.slotLabel || null;
  row.customerName = details.customerName || row.customerName;
  row.confirmedAt = Date.now();

  if (redis) {
    await redis.set(`${PREFIX}${flowToken}`, JSON.stringify(row), { ex: 86400 * 7 });
  } else {
    mem.set(flowToken, row);
  }
  return { ok: true, booking: row };
}

async function listRecent({ limit = 20 } = {}) {
  if (redis) {
    const ids = await redis.zrange(LIST_KEY, 0, limit - 1, { rev: true });
    const rows = await Promise.all((ids || []).map((id) => get(id)));
    return rows.filter(Boolean);
  }
  return [...mem.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}

async function listConfirmedForDate(branchId, date) {
  const taken = await listTakenSlotIds(branchId, date);
  const recent = await listRecent({ limit: 100 });
  return recent.filter(
    (r) => r.status === "confirmed" && r.branchId === branchId && r.date === date && taken.has(String(r.slotId))
  );
}

module.exports = {
  tokenId,
  create,
  get,
  confirm,
  listRecent,
  listTakenSlotIds,
  reserveSlot,
  listConfirmedForDate,
};
