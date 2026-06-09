"use strict";

/** Campos editables de calificación CRM (persistidos en leadProfile JSON). */
const EDITABLE_KEYS = [
  "company",
  "type",
  "userType",
  "location",
  "owner",
  "email",
  "userId",
  "signedUp",
  "lastOpenedEmail",
];

const LEAD_TYPE_OPTIONS = [
  { value: "", label: "Sin clasificar" },
  { value: "prospecto", label: "Prospecto" },
  { value: "cliente", label: "Cliente" },
  { value: "lead_caliente", label: "Lead caliente" },
  { value: "lead_frio", label: "Lead frío" },
  { value: "soporte", label: "Soporte" },
  { value: "otro", label: "Otro" },
];

const USER_TYPE_OPTIONS = [
  { value: "", label: "Sin definir" },
  { value: "titular", label: "Titular" },
  { value: "beneficiario", label: "Beneficiario" },
  { value: "representante", label: "Representante" },
  { value: "empleado", label: "Empleado" },
  { value: "otro", label: "Otro" },
];

function parse(raw) {
  if (!raw) return {};
  try {
    const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
    return obj && typeof obj === "object" ? obj : {};
  } catch (_) {
    return {};
  }
}

function merge(prev, patch) {
  const out = { ...parse(prev) };
  EDITABLE_KEYS.forEach((k) => {
    if (patch[k] == null) return;
    const v = String(patch[k]).trim();
    if (v) out[k] = v;
    else delete out[k];
  });
  return out;
}

function serialize(profile) {
  const clean = {};
  EDITABLE_KEYS.forEach((k) => {
    const v = profile && profile[k] != null ? String(profile[k]).trim() : "";
    if (v) clean[k] = v;
  });
  return JSON.stringify(clean);
}

function formatTs(ts) {
  if (!ts) return null;
  return new Date(Number(ts)).toLocaleString("es", { dateStyle: "medium", timeStyle: "short" });
}

function typeLabel(value) {
  const hit = LEAD_TYPE_OPTIONS.find((o) => o.value === value);
  return hit ? hit.label : (value || null);
}

function userTypeLabel(value) {
  const hit = USER_TYPE_OPTIONS.find((o) => o.value === value);
  return hit ? hit.label : (value || null);
}

/**
 * Vista enriquecida para el panel de detalle (etiquetas listas para UI en español).
 */
function buildDetailView(detail, country) {
  const profile = parse(detail.leadProfile);
  const stats = detail.stats || {};
  const hasInbound = (stats.in || 0) > 0;
  const countryName = country && country.name ? country.name : null;
  const inferredLocation = profile.location || countryName || null;

  return {
    needsQualification: hasInbound && !profile.type,
    hasInbound,
    editable: {
      name: detail.name || detail.phone,
      company: profile.company || "",
      type: profile.type || "",
      userType: profile.userType || "",
      location: profile.location || "",
      owner: profile.owner || "",
      email: profile.email || "",
      userId: profile.userId || "",
      signedUp: profile.signedUp || "",
      lastOpenedEmail: profile.lastOpenedEmail || "",
    },
    readonly: {
      phone: detail.phoneFormatted || detail.phone,
      whatsappNumber: detail.phoneFormatted || detail.phone,
      firstSeen: detail.firstSeen || null,
      firstSeenLabel: formatTs(detail.firstSeen),
      lastSeen: detail.lastSeen || null,
      lastSeenLabel: formatTs(detail.lastSeen),
      lastContacted: detail.lastOutbound || null,
      lastContactedLabel: formatTs(detail.lastOutbound),
      lastHeardFrom: detail.lastInbound || null,
      lastHeardFromLabel: formatTs(detail.lastInbound),
      country: countryName,
      inferredLocation,
    },
    /** Canales fuera de WhatsApp — no los provee la API de Meta. */
    external: {
      lastOpenedEmail: profile.lastOpenedEmail || null,
      lastOpenedEmailLabel: profile.lastOpenedEmail
        ? formatTs(Number(profile.lastOpenedEmail)) || profile.lastOpenedEmail
        : null,
      android: {
        available: false,
        lastSeen: null,
        sessions: null,
        appVersion: null,
        device: null,
        osVersion: null,
        sdkVersion: null,
      },
    },
    labels: {
      type: typeLabel(profile.type),
      userType: userTypeLabel(profile.userType),
    },
    options: {
      types: LEAD_TYPE_OPTIONS,
      userTypes: USER_TYPE_OPTIONS,
    },
  };
}

function sanitizePatch(body) {
  if (!body || typeof body !== "object") return {};
  const out = {};
  EDITABLE_KEYS.forEach((k) => {
    if (body[k] != null) out[k] = String(body[k]).trim();
  });
  return out;
}

module.exports = {
  EDITABLE_KEYS,
  LEAD_TYPE_OPTIONS,
  USER_TYPE_OPTIONS,
  parse,
  merge,
  serialize,
  sanitizePatch,
  buildDetailView,
  typeLabel,
  userTypeLabel,
};
