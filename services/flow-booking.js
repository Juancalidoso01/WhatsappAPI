"use strict";

const bookingSchedule = require("./booking-schedule");
const bookingSlots = require("./booking-slots");

function slotTitle(id) {
  if (!id) return "—";
  if (id.includes(":")) return id;
  if (id.length === 4) return `${id.slice(0, 2)}:${id.slice(2)}`;
  return id;
}

function formatDateLabel(iso) {
  if (!iso) return "—";
  const tz = bookingSchedule.loadSchedule().timezone || "America/Panama";
  try {
    const d = new Date(`${iso}T12:00:00`);
    return d.toLocaleDateString("es-PA", {
      timeZone: tz,
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch (_) {
    return iso;
  }
}

function initScreenData() {
  const range = bookingSchedule.dateRange();
  return {
    sucursales: bookingSchedule.listBranches(),
    available_slots: [],
    is_slot_visible: false,
    min_date: range.min,
    max_date: range.max,
    selected_date: "",
  };
}

async function slotsScreenData(fecha, sucursal) {
  const range = bookingSchedule.dateRange();
  const { slots, source } = await bookingSlots.getAvailableSlots(sucursal, fecha);
  return {
    sucursales: bookingSchedule.listBranches(),
    available_slots: slots.map((s) => ({ id: s.id, title: s.title })),
    is_slot_visible: slots.length > 0,
    min_date: range.min,
    max_date: range.max,
    selected_date: fecha,
    slots_source: source,
  };
}

module.exports = {
  BRANCHES: bookingSchedule.listBranches(),
  branchTitle: bookingSchedule.branchTitle,
  slotTitle,
  formatDateLabel,
  dateRange: bookingSchedule.dateRange,
  initScreenData,
  slotsScreenData,
  getAvailableSlots: bookingSlots.getAvailableSlots,
};
