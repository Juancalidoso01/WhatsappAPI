"use strict";

/**
 * Borradores de plantillas Punto Pago para el dashboard.
 * flowMessage = copy del mensaje interactivo (Flow) con placeholders {{key}}.
 */
const PRESETS = {
  punto_pago_autorizacion_pago: {
    key: "punto_pago_autorizacion_pago",
    label: "Verificación 3DS — confirmar pago",
    description: "Mensaje de verificación de seguridad antes de aprobar un pago con Tarjeta Punto Pago.",
    name: "punto_pago_3ds_confirmar_pago",
    templateFlowName: "punto_pago_3ds_confirmar_pago_flow",
    category: "UTILITY",
    language: "es",
    headerText: "Confirma tu pago",
    bodyText:
      "Hola {{1}},\n\n"
      + "Se requiere tu confirmación para un pago de {{2}} en {{3}} con Tarjeta Punto Pago •••• {{4}}.\n\n"
      + "Toca el botón para aprobar o rechazar. Este paso protege tu cuenta, como la verificación 3D Secure de tu banco.",
    footerText: "Punto Pago · Verificación de seguridad",
    variables: [
      { key: "nombre_cliente", example: "Juan Pablo" },
      { key: "monto", example: "USD 45.90" },
      { key: "comercio", example: "Supermercado XO" },
      { key: "ultimos_4", example: "4821" },
    ],
    flowCta: "Confirmar pago",
    flowMessage: {
      headerText: "Confirma tu pago",
      bodyText:
        "Hola {{nombre_cliente}},\n\n"
        + "Se requiere tu confirmación para un pago de {{monto}} en {{comercio}} con Tarjeta Punto Pago •••• {{ultimos_4}}.\n\n"
        + "Toca el botón para aprobar o rechazar. Este paso protege tu cuenta, como la verificación 3D Secure de tu banco.",
      footerText: "Punto Pago · Verificación de seguridad",
      cta: "Confirmar pago",
    },
  },
};

function listPresets() {
  return Object.values(PRESETS).map((p) => ({
    key: p.key,
    label: p.label,
    description: p.description,
    name: p.name,
    templateFlowName: p.templateFlowName || null,
    category: p.category,
    language: p.language,
    variableCount: (p.variables || []).length,
    flowCta: p.flowCta,
    isFlowPreset: Boolean(p.templateFlowName || p.flowCta),
  }));
}

function templateHasFlowButton(tpl) {
  const buttons = (tpl && tpl.components || []).find((c) => c.type === "BUTTONS");
  return Boolean(buttons && (buttons.buttons || []).some(
    (btn) => String(btn.type || "").toUpperCase() === "FLOW"
  ));
}

function findTemplateByName(templates, name, language) {
  if (!name) return null;
  const lang = language || "es";
  return (templates || []).find((t) => t.name === name && t.language === lang)
    || (templates || []).find((t) => t.name === name);
}

function tplStatusRow(tpl, { notSubmittedLabel = "Sin enviar" } = {}) {
  if (!tpl) return { status: "NOT_SUBMITTED", label: notSubmittedLabel, approved: false };
  const status = String(tpl.status || "UNKNOWN").toUpperCase();
  const labels = { APPROVED: "Aprobada", PENDING: "En revisión", REJECTED: "Rechazada" };
  return {
    name: tpl.name,
    status,
    label: labels[status] || status,
    approved: status === "APPROVED",
    id: tpl.id,
  };
}

function resolvePresetsMetaStatus(templates) {
  return Object.values(PRESETS).map((p) => {
    const lang = p.language || "es";
    const textTpl = findTemplateByName(templates, p.name, lang);
    const flowTpl = p.templateFlowName
      ? findTemplateByName(templates, p.templateFlowName, lang)
      : null;
    const text = tplStatusRow(textTpl);
    const flow = p.templateFlowName
      ? {
        ...tplStatusRow(flowTpl, { notSubmittedLabel: "Sin enviar" }),
        hasFlowButton: flowTpl ? templateHasFlowButton(flowTpl) : false,
      }
      : null;
    return {
      key: p.key,
      text,
      flow,
      readyForProduction: Boolean(
        text.approved && flow && flow.approved && flow.hasFlowButton
      ),
    };
  });
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

function buildPaymentAuthTemplateSend(txn, screenData, customerName) {
  const preset = getPreset("punto_pago_autorizacion_pago");
  if (!preset) return null;
  const name = customerName || "Cliente";
  const monto = formatAmount(txn.amount, txn.currency);
  const comercio = txn.merchant || "Comercio";
  const ultimos4 = txn.cardLast4 || "0000";
  return {
    templateName: preset.templateFlowName || `${preset.name}_flow`,
    language: preset.language || "es",
    components: [
      {
        type: "body",
        parameters: [
          { type: "text", text: name },
          { type: "text", text: monto },
          { type: "text", text: comercio },
          { type: "text", text: ultimos4 },
        ],
      },
      {
        type: "button",
        sub_type: "flow",
        index: "0",
        parameters: [{
          type: "action",
          action: {
            flow_token: txn.flowToken,
            flow_action_data: screenData || {},
          },
        }],
      },
    ],
  };
}

async function resolveApprovedPaymentAuthTemplate(GraphApi, wabaId) {
  const preset = getPreset("punto_pago_autorizacion_pago");
  if (!preset || !GraphApi || !wabaId) return null;
  try {
    const result = await GraphApi.listTemplates(wabaId);
    const list = (result && result.data) || [];
    const withFlow = list.find(
      (t) => t.name === preset.templateFlowName && String(t.status).toUpperCase() === "APPROVED"
    );
    if (withFlow) return { name: withFlow.name, language: withFlow.language || preset.language, hasFlowButton: true };
    const plain = list.find(
      (t) => t.name === preset.name && String(t.status).toUpperCase() === "APPROVED"
    );
    if (plain) return { name: plain.name, language: plain.language || preset.language, hasFlowButton: false };
  } catch (_) {}
  return null;
}

module.exports = {
  PRESETS,
  listPresets,
  getPreset,
  previewPreset,
  buildFlowMessage,
  buildPaymentAuthTemplateSend,
  resolveApprovedPaymentAuthTemplate,
  resolvePresetsMetaStatus,
  templateHasFlowButton,
  findTemplateByName,
  fillNumberedPlaceholders,
  formatAmount,
};
