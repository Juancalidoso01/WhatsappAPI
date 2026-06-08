"use strict";

/**
 * Borradores de plantillas Punto Pago para el dashboard.
 * flowMessage = copy del mensaje interactivo (Flow) con placeholders {{key}}.
 */
const PRESETS = {
  punto_pago_autorizacion_pago: {
    key: "punto_pago_autorizacion_pago",
    label: "Autorización de pago en comercio",
    description: "Alerta de transacción con botón al Flow de autorizar/rechazar. Categoría Utilidad.",
    name: "punto_pago_autorizacion_pago",
    category: "UTILITY",
    language: "es",
    headerText: "Alerta de transacción",
    bodyText:
      "Hola {{1}},\n\n"
      + "Hay un pago pendiente de {{2}} en {{3}} con tu tarjeta Punto Pago •••• {{4}}.\n\n"
      + "¿Autorizas esta transacción? Toca el botón para revisar los detalles y confirmar.",
    footerText: "Punto Pago · Mensaje automático",
    variables: [
      { key: "nombre_cliente", example: "Juan Pablo" },
      { key: "monto", example: "USD 45.90" },
      { key: "comercio", example: "Supermercado XO" },
      { key: "ultimos_4", example: "4821" },
    ],
    flowCta: "Revisar y autorizar",
    flowMessage: {
      headerText: "Alerta de transacción",
      bodyText:
        "Hay un pago pendiente de {{monto}} en {{comercio}} con tu tarjeta Punto Pago •••• {{ultimos_4}}.\n\n"
        + "¿Autorizas esta transacción?",
      footerText: "Punto Pago · Mensaje automático",
      cta: "Revisar y autorizar",
    },
  },
};

function listPresets() {
  return Object.values(PRESETS).map((p) => ({
    key: p.key,
    label: p.label,
    description: p.description,
    name: p.name,
    category: p.category,
    language: p.language,
    variableCount: (p.variables || []).length,
    flowCta: p.flowCta,
  }));
}

function getPreset(key) {
  return PRESETS[key] || null;
}

function fillPlaceholders(text, values) {
  let out = String(text || "");
  Object.entries(values || {}).forEach(([key, val]) => {
    out = out.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "g"), String(val ?? ""));
  });
  return out;
}

function fillNumberedPlaceholders(text, variables, overrides) {
  const byIndex = {};
  (variables || []).forEach((v, i) => {
    byIndex[i + 1] = (overrides && overrides[v.key] != null ? overrides[v.key] : v.example) || "";
  });
  return String(text || "").replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => byIndex[Number(n)] ?? `{{${n}}}`);
}

function buildFlowMessage(presetKey, data) {
  const preset = getPreset(presetKey);
  if (!preset || !preset.flowMessage) return null;
  const fm = preset.flowMessage;
  const values = {
    nombre_cliente: data.customerName || data.nombre_cliente || "Cliente",
    monto: formatAmount(data.amount, data.currency),
    comercio: data.merchant || data.comercio || "Comercio",
    ultimos_4: data.cardLast4 || data.ultimos_4 || "0000",
  };
  return {
    headerText: fm.headerText,
    bodyText: fillPlaceholders(fm.bodyText, values),
    footerText: fm.footerText,
    cta: fm.cta || preset.flowCta,
  };
}

function formatAmount(amount, currency) {
  const cur = String(currency || "USD").toUpperCase();
  const raw = String(amount ?? "0").replace(/[^\d.,]/g, "").replace(",", ".");
  const num = Number.parseFloat(raw);
  if (Number.isNaN(num)) return `${cur} ${amount}`;
  return `${cur} ${num.toFixed(2)}`;
}

function previewPreset(presetKey, overrides) {
  const preset = getPreset(presetKey);
  if (!preset) return null;
  return {
    name: preset.name,
    category: preset.category,
    language: preset.language,
    headerText: preset.headerText,
    bodyText: fillNumberedPlaceholders(preset.bodyText, preset.variables, overrides),
    footerText: preset.footerText,
    flowCta: preset.flowCta,
    variables: preset.variables,
  };
}

module.exports = {
  PRESETS,
  listPresets,
  getPreset,
  previewPreset,
  buildFlowMessage,
  fillNumberedPlaceholders,
  formatAmount,
};
