"use strict";

const BRANCHES = [
  { id: "centro", title: "Punto Pago — Centro" },
  { id: "costa", title: "Punto Pago — Costa del Este" },
  { id: "albrook", title: "Punto Pago — Albrook" },
];

const WEEKDAY_SLOTS = [
  "09:00", "09:30", "10:00", "10:30", "11:00",
  "14:00", "14:30", "15:00", "15:30", "16:00", "16:30",
];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(baseIso, days) {
  const d = new Date(`${baseIso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function dateRange() {
  const min = addDaysIso(todayIso(), 1);
  const max = addDaysIso(todayIso(), 30);
  return { min, max };
}

function branchTitle(id) {
  const b = BRANCHES.find((x) => x.id === id);
  return b ? b.title : id || "—";
}

function slotTitle(id) {
  if (!id) return "—";
  if (id.includes(":")) return id;
  if (id.length === 4) return `${id.slice(0, 2)}:${id.slice(2)}`;
  return id;
}

function formatDateLabel(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(`${iso}T12:00:00`);
    return d.toLocaleDateString("es-PA", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  } catch (_) {
    return iso;
  }
}

function generateSlots(dateIso, branchId) {
  if (!dateIso) return [];
  const d = new Date(`${dateIso}T12:00:00`);
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return [];

  const seed = String(dateIso + branchId).split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  return WEEKDAY_SLOTS.map((title, i) => {
    const id = title.replace(":", "");
    const taken = ((seed + i * 7) % 5) === 0;
    return { id, title, enabled: !taken };
  }).filter((s) => s.enabled);
}

function initScreenData() {
  const range = dateRange();
  return {
    sucursales: BRANCHES,
    available_slots: [],
    is_slot_visible: false,
    min_date: range.min,
    max_date: range.max,
    selected_date: "",
  };
}

function slotsScreenData(fecha, sucursal) {
  const range = dateRange();
  const slots = generateSlots(fecha, sucursal);
  return {
    sucursales: BRANCHES,
    available_slots: slots.map((s) => ({ id: s.id, title: s.title })),
    is_slot_visible: slots.length > 0,
    min_date: range.min,
    max_date: range.max,
    selected_date: fecha,
  };
}

module.exports = {
  BRANCHES,
  branchTitle,
  slotTitle,
  formatDateLabel,
  generateSlots,
  dateRange,
  initScreenData,
  slotsScreenData,
};
