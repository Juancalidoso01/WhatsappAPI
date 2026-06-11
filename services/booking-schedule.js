"use strict";

const fs = require("fs");
const path = require("path");

const WEEKDAY_MAP = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

let cached = null;

function loadSchedule() {
  if (cached) return cached;
  const filePath = path.join(__dirname, "..", "data", "booking-schedule.json");
  try {
    cached = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_) {
    cached = {
      timezone: "America/Panama",
      minLeadDays: 1,
      horizonDays: 30,
      branches: {},
    };
  }
  return cached;
}

function reloadSchedule() {
  cached = null;
  return loadSchedule();
}

function listBranches() {
  const cfg = loadSchedule();
  return Object.entries(cfg.branches || {}).map(([id, b]) => ({
    id,
    title: b.title || id,
    address: b.address || "",
  }));
}

function getBranch(branchId) {
  const cfg = loadSchedule();
  return cfg.branches?.[branchId] || null;
}

function branchTitle(branchId) {
  const b = getBranch(branchId);
  return b?.title || branchId || "—";
}

function todayIsoInTz(timezone) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const y = parts.find((p) => p.type === "year")?.value;
    const m = parts.find((p) => p.type === "month")?.value;
    const d = parts.find((p) => p.type === "day")?.value;
    return `${y}-${m}-${d}`;
  } catch (_) {
    return new Date().toISOString().slice(0, 10);
  }
}

function addDaysIso(baseIso, days) {
  const d = new Date(`${baseIso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function weekdayCode(dateIso, timezone) {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(
      new Date(`${dateIso}T12:00:00`)
    );
  } catch (_) {
    return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(`${dateIso}T12:00:00`).getDay()];
  }
}

function dateRange() {
  const cfg = loadSchedule();
  const tz = cfg.timezone || "America/Panama";
  const min = addDaysIso(todayIsoInTz(tz), Number(cfg.minLeadDays) || 1);
  const max = addDaysIso(todayIsoInTz(tz), Number(cfg.horizonDays) || 30);
  return { min, max, timezone: tz };
}

function slotIdFromTitle(title) {
  return String(title).replace(":", "");
}

function getBaseSlots(branchId, dateIso) {
  const branch = getBranch(branchId);
  if (!branch || !dateIso) return [];

  const cfg = loadSchedule();
  const tz = cfg.timezone || "America/Panama";
  const closed = new Set(branch.closedDates || []);
  if (closed.has(dateIso)) return [];

  const code = weekdayCode(dateIso, tz);
  const allowed = new Set(branch.weekdays || ["Mon", "Tue", "Wed", "Thu", "Fri"]);
  if (!allowed.has(code)) return [];

  return (branch.slots || []).map((title) => ({
    id: slotIdFromTitle(title),
    title,
  }));
}

function getPublicConfig() {
  const cfg = loadSchedule();
  const range = dateRange();
  return {
    timezone: cfg.timezone,
    minLeadDays: cfg.minLeadDays,
    horizonDays: cfg.horizonDays,
    dateRange: range,
    branches: listBranches(),
  };
}

module.exports = {
  loadSchedule,
  reloadSchedule,
  listBranches,
  getBranch,
  branchTitle,
  dateRange,
  getBaseSlots,
  getPublicConfig,
  slotIdFromTitle,
};
