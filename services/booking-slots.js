"use strict";

const config = require("./config");
const bookingSchedule = require("./booking-schedule");
const BookingStore = require("./booking-store");
const redis = require("./upstash");

const OVERRIDE_PREFIX = "wa:booking:override:";
const memOverrides = new Map();

async function getOverride(branchId, dateIso) {
  const key = `${OVERRIDE_PREFIX}${branchId}:${dateIso}`;
  if (redis) {
    const raw = await redis.get(key);
    if (!raw) return null;
    try {
      return typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch (_) {
      return null;
    }
  }
  const row = memOverrides.get(key);
  if (row && row.expiresAt && row.expiresAt < Date.now()) {
    memOverrides.delete(key);
    return null;
  }
  return row || null;
}

async function setOverride(branchId, dateIso, payload, { ttlSec = 86400 } = {}) {
  const key = `${OVERRIDE_PREFIX}${branchId}:${dateIso}`;
  const row = {
    ...payload,
    branchId,
    date: dateIso,
    updatedAt: Date.now(),
    expiresAt: Date.now() + ttlSec * 1000,
  };
  if (redis) {
    await redis.set(key, JSON.stringify(row), { ex: ttlSec });
  } else {
    memOverrides.set(key, row);
  }
  return row;
}

async function fetchExternalSlots(branchId, dateIso) {
  const url = process.env.BOOKING_SLOTS_URL;
  if (!url) return null;

  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  if (config.integrationApiKey) headers["X-API-Key"] = config.integrationApiKey;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ branchId, date: dateIso }),
      signal: AbortSignal.timeout(Number(process.env.BOOKING_SLOTS_TIMEOUT_MS) || 8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const slots = data.slots || data.available_slots || data.availableSlots;
    if (!Array.isArray(slots)) return null;
    return slots
      .map((s) => ({
        id: String(s.id || bookingSchedule.slotIdFromTitle(s.title || "")),
        title: String(s.title || s.id || ""),
      }))
      .filter((s) => s.id && s.title);
  } catch (err) {
    console.warn("booking external slots:", err.message || err);
    return null;
  }
}

function applyOverride(baseSlots, override) {
  if (!override) return baseSlots;
  let slots = baseSlots;

  if (Array.isArray(override.availableSlots) && override.availableSlots.length) {
    slots = override.availableSlots.map((s) => ({
      id: String(s.id || bookingSchedule.slotIdFromTitle(s.title || "")),
      title: String(s.title || s.id || ""),
    })).filter((s) => s.id && s.title);
  }

  const blocked = new Set((override.blockedSlotIds || []).map(String));
  if (blocked.size) {
    slots = slots.filter((s) => !blocked.has(s.id));
  }
  return slots;
}

async function getAvailableSlots(branchId, dateIso) {
  if (!branchId || !dateIso) return { slots: [], source: "none" };

  const base = bookingSchedule.getBaseSlots(branchId, dateIso);
  if (!base.length) return { slots: [], source: "schedule_closed" };

  const override = await getOverride(branchId, dateIso);
  let slots = applyOverride(base, override);
  let source = override ? "override" : "schedule";

  const external = await fetchExternalSlots(branchId, dateIso);
  if (external && external.length) {
    const extIds = new Set(external.map((s) => s.id));
    slots = slots.filter((s) => extIds.has(s.id));
    if (!slots.length) slots = external;
    source = "external";
  }

  const taken = await BookingStore.listTakenSlotIds(branchId, dateIso);
  slots = slots.filter((s) => !taken.has(s.id));

  return { slots, source };
}

module.exports = {
  getAvailableSlots,
  getOverride,
  setOverride,
  fetchExternalSlots,
};
