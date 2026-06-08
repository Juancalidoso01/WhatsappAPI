"use strict";

/** Meta rate card (USD per delivered template message), Apr 2026 reference. */
const RATE_CARD = {
  PA: { name: "Panamá", marketing: 0.074, utility: 0.0113, auth: 0.0113 },
  CO: { name: "Colombia", marketing: 0.0125, utility: 0.0008, auth: 0.0008 },
  MX: { name: "México", marketing: 0.0305, utility: 0.0085, auth: 0.0085 },
  US: { name: "Estados Unidos", marketing: 0.025, utility: 0.0034, auth: 0.0034 },
  CA: { name: "Canadá", marketing: 0.025, utility: 0.0034, auth: 0.0034 },
  AR: { name: "Argentina", marketing: 0.0618, utility: 0.026, auth: 0.026 },
  BR: { name: "Brasil", marketing: 0.0625, utility: 0.0068, auth: 0.0068 },
  CL: { name: "Chile", marketing: 0.0889, utility: 0.02, auth: 0.02 },
  PE: { name: "Perú", marketing: 0.0703, utility: 0.02, auth: 0.02 },
  EC: { name: "Ecuador", marketing: 0.074, utility: 0.0113, auth: 0.0113 },
  CR: { name: "Costa Rica", marketing: 0.074, utility: 0.0113, auth: 0.0113 },
  DO: { name: "Rep. Dominicana", marketing: 0.074, utility: 0.0113, auth: 0.0113 },
  GT: { name: "Guatemala", marketing: 0.074, utility: 0.0113, auth: 0.0113 },
  SV: { name: "El Salvador", marketing: 0.074, utility: 0.0113, auth: 0.0113 },
  HN: { name: "Honduras", marketing: 0.074, utility: 0.0113, auth: 0.0113 },
  NI: { name: "Nicaragua", marketing: 0.074, utility: 0.0113, auth: 0.0113 },
  BO: { name: "Bolivia", marketing: 0.074, utility: 0.0113, auth: 0.0113 },
  PY: { name: "Paraguay", marketing: 0.074, utility: 0.0113, auth: 0.0113 },
  UY: { name: "Uruguay", marketing: 0.074, utility: 0.0113, auth: 0.0113 },
  VE: { name: "Venezuela", marketing: 0.074, utility: 0.0113, auth: 0.0113 },
  PR: { name: "Puerto Rico", marketing: 0.074, utility: 0.0113, auth: 0.0113 },
  ES: { name: "España", marketing: 0.0615, utility: 0.02, auth: 0.02 },
  OTHER: { name: "Otro", marketing: 0.0604, utility: 0.0077, auth: 0.0077 },
};

function rateForCategory(countryCode, category) {
  const cc = String(countryCode || "OTHER").toUpperCase();
  const row = RATE_CARD[cc] || RATE_CARD.OTHER;
  const cat = String(category || "UTILITY").toUpperCase();
  if (cat === "SERVICE") return 0;
  if (cat === "MARKETING") return row.marketing;
  if (cat === "AUTHENTICATION" || cat === "AUTHENTICATION_INTERNATIONAL") return row.auth;
  return row.utility;
}

function estimateCost(countryCode, category) {
  return rateForCategory(countryCode, category);
}

function categoryLabel(cat) {
  const key = String(cat || "").toUpperCase();
  const map = {
    MARKETING: "Marketing",
    UTILITY: "Utilidad",
    AUTHENTICATION: "Autenticación",
    AUTHENTICATION_INTERNATIONAL: "Autenticación intl.",
    SERVICE: "Servicio",
  };
  return map[key] || key || "—";
}

module.exports = {
  RATE_CARD,
  rateForCategory,
  estimateCost,
  categoryLabel,
};
