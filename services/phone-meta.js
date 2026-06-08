"use strict";

// ISO country code -> { name, dial }
const COUNTRIES = {
  PA: { name: "Panamá", dial: "507" },
  US: { name: "Estados Unidos", dial: "1" },
  CA: { name: "Canadá", dial: "1" },
  MX: { name: "México", dial: "52" },
  CO: { name: "Colombia", dial: "57" },
  AR: { name: "Argentina", dial: "54" },
  BR: { name: "Brasil", dial: "55" },
  CL: { name: "Chile", dial: "56" },
  PE: { name: "Perú", dial: "51" },
  EC: { name: "Ecuador", dial: "593" },
  CR: { name: "Costa Rica", dial: "506" },
  DO: { name: "Rep. Dominicana", dial: "1" },
  GT: { name: "Guatemala", dial: "502" },
  SV: { name: "El Salvador", dial: "503" },
  HN: { name: "Honduras", dial: "504" },
  NI: { name: "Nicaragua", dial: "505" },
  BO: { name: "Bolivia", dial: "591" },
  PY: { name: "Paraguay", dial: "595" },
  UY: { name: "Uruguay", dial: "598" },
  VE: { name: "Venezuela", dial: "58" },
  PR: { name: "Puerto Rico", dial: "1" },
  ES: { name: "España", dial: "34" },
};

const DIAL_ENTRIES = Object.entries(COUNTRIES)
  .map(([code, v]) => ({ code, dial: v.dial }))
  .sort((a, b) => b.dial.length - a.dial.length);

function countryFlag(code) {
  if (!code || code.length !== 2) return "";
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 127397 + c.charCodeAt(0)));
}

function inferCountry(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return { code: null, name: null, dial: null };

  for (const entry of DIAL_ENTRIES) {
    if (digits.startsWith(entry.dial)) {
      return { code: entry.code, name: COUNTRIES[entry.code].name, dial: entry.dial };
    }
  }
  return { code: "OTHER", name: "Otro", dial: null };
}

function formatPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  const { dial } = inferCountry(digits);
  if (dial && digits.startsWith(dial)) {
    const local = digits.slice(dial.length);
    const chunk = local.replace(/(\d{3,4})(?=\d)/g, "$1 ").trim();
    return `+${dial} ${chunk}`;
  }
  return `+${digits}`;
}

const ORIGIN_LABELS = {
  user_initiated: "Iniciada por el cliente",
  business_initiated: "Iniciada por el negocio",
  referral_conversion: "Referido (anuncio/enlace)",
  service: "Servicio",
};

function originLabel(origin) {
  return ORIGIN_LABELS[origin] || origin || "—";
}

module.exports = { inferCountry, formatPhone, countryFlag, originLabel };
