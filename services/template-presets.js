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
      {
        key: "nombre_cliente",
        placeholder: "{{1}}",
        label: "Nombre del cliente",
        type: "text",
        example: "Juan Pablo",
        mapsTo: "Saludo personalizado al titular de la tarjeta",
      },
      {
        key: "monto",
        placeholder: "{{2}}",
        label: "Monto del pago",
        type: "money",
        example: "USD 45.90",
        mapsTo: "Importe exacto del cargo a confirmar",
      },
      {
        key: "comercio",
        placeholder: "{{3}}",
        label: "Comercio",
        type: "merchant",
        example: "Supermercado XO",
        mapsTo: "Nombre del comercio donde ocurre la transacción",
      },
      {
        key: "ultimos_4",
        placeholder: "{{4}}",
        label: "Últimos 4 de la tarjeta",
        type: "card_last4",
        example: "4821",
        mapsTo: "Se muestra como Tarjeta Punto Pago •••• 4821",
      },
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
  punto_pago_recordatorio_pago: {
    key: "punto_pago_recordatorio_pago",
    label: "Recordatorio de pago",
    description: "Avisa un saldo pendiente con fecha límite. Compatible con campañas masivas vía API (plantilla recordatorio_pago).",
    name: "recordatorio_pago",
    category: "UTILITY",
    language: "es",
    headerText: "Recordatorio de pago",
    bodyText:
      "Hola {{1}},\n\n"
      + "Tienes un saldo pendiente de {{2}} con vencimiento el {{3}}.\n\n"
      + "Si ya pagaste, ignora este mensaje. Para consultas responde AYUDA.",
    footerText: "Punto Pago",
    variables: [
      {
        key: "nombre_cliente",
        placeholder: "{{1}}",
        label: "Nombre del cliente",
        type: "text",
        example: "Juan Pablo",
        mapsTo: "Nombre del destinatario del recordatorio",
      },
      {
        key: "monto",
        placeholder: "{{2}}",
        label: "Monto pendiente",
        type: "money",
        example: "USD 128.40",
        mapsTo: "Importe adeudado o cuota a pagar",
      },
      {
        key: "fecha_vencimiento",
        placeholder: "{{3}}",
        label: "Fecha de vencimiento",
        type: "date",
        example: "15 jun 2026",
        mapsTo: "Último día para pagar sin mora",
      },
    ],
  },
  punto_pago_recordatorio_mora: {
    key: "punto_pago_recordatorio_mora",
    label: "Aviso de mora",
    description: "Informa saldo vencido, días en mora y monto mínimo para regularizar la cuenta.",
    name: "recordatorio_mora",
    category: "UTILITY",
    language: "es",
    headerText: "Aviso de mora",
    bodyText:
      "Hola {{1}},\n\n"
      + "Tu cuenta registra un saldo de {{2}} con {{3}} días en mora (venció el {{4}}).\n\n"
      + "Puedes regularizar con un abono mínimo de {{5}}. Responde PAGO para opciones de pago.",
    footerText: "Punto Pago · Cobranza",
    variables: [
      {
        key: "nombre_cliente",
        placeholder: "{{1}}",
        label: "Nombre del cliente",
        type: "text",
        example: "María López",
        mapsTo: "Titular de la deuda",
      },
      {
        key: "saldo_deuda",
        placeholder: "{{2}}",
        label: "Saldo de deuda",
        type: "money",
        example: "USD 256.80",
        mapsTo: "Monto total adeudado",
      },
      {
        key: "dias_mora",
        placeholder: "{{3}}",
        label: "Días en mora",
        type: "integer",
        example: "12",
        mapsTo: "Días transcurridos desde el vencimiento",
      },
      {
        key: "fecha_vencimiento",
        placeholder: "{{4}}",
        label: "Fecha de vencimiento",
        type: "date",
        example: "28 may 2026",
        mapsTo: "Fecha en que venció el saldo",
      },
      {
        key: "monto_cuota",
        placeholder: "{{5}}",
        label: "Abono mínimo",
        type: "money",
        example: "USD 45.00",
        mapsTo: "Cuota o abono mínimo para regularizar",
      },
    ],
  },
  punto_pago_confirmacion_pago: {
    key: "punto_pago_confirmacion_pago",
    label: "Confirmación de pago recibido",
    description: "Acusa recibo de un pago con referencia y fecha. Útil tras abonos en canales digitales.",
    name: "confirmacion_pago",
    category: "UTILITY",
    language: "es",
    headerText: "Pago recibido",
    bodyText:
      "Hola {{1}},\n\n"
      + "Confirmamos tu pago de {{2}} recibido el {{3}}.\n\n"
      + "Referencia: {{4}}. Guarda este mensaje como comprobante.",
    footerText: "Punto Pago",
    variables: [
      {
        key: "nombre_cliente",
        placeholder: "{{1}}",
        label: "Nombre del cliente",
        type: "text",
        example: "Carlos Ruiz",
        mapsTo: "Cliente que realizó el pago",
      },
      {
        key: "monto",
        placeholder: "{{2}}",
        label: "Monto pagado",
        type: "money",
        example: "USD 89.50",
        mapsTo: "Importe acreditado",
      },
      {
        key: "fecha_pago",
        placeholder: "{{3}}",
        label: "Fecha de pago",
        type: "date",
        example: "08 jun 2026",
        mapsTo: "Día en que se registró el abono",
      },
      {
        key: "numero_pago",
        placeholder: "{{4}}",
        label: "Referencia de pago",
        type: "code",
        example: "PAG-8829103",
        mapsTo: "Folio o número de transacción",
      },
    ],
  },
  punto_pago_tarjeta_credito_bienvenida: {
    key: "punto_pago_tarjeta_credito_bienvenida",
    label: "Tarjeta de crédito — tour de producto",
    description: "Piloto por producto: presenta beneficios, condiciones y cómo solicitar la Tarjeta de Crédito desde la app (botón abre Flow).",
    name: "tarjeta_credito_info",
    templateFlowName: "tarjeta_credito_info_flow",
    category: "MARKETING",
    language: "es",
    flowSampleKey: "tarjeta_credito",
    flowScreenId: "INTRO",
    flowCacheKey: "wa:flow:tarjeta_credito_v1",
    headerText: "Tu Tarjeta de Crédito",
    bodyText:
      "Hola {{1}},\n\n"
      + "Conoce tu Tarjeta de Crédito Punto Pago: dónde usarla, condiciones y cómo solicitarla desde la app.\n\n"
      + "Toca el botón para ver el tour interactivo.",
    footerText: "Punto Pago · Productos",
    variables: [
      {
        key: "nombre_cliente",
        placeholder: "{{1}}",
        label: "Nombre del cliente",
        type: "text",
        example: "Ana Torres",
        mapsTo: "Saludo personalizado en el mensaje de bienvenida al producto",
      },
    ],
    flowCta: "Conocer tarjeta",
    flowMessage: {
      headerText: "Tu Tarjeta de Crédito",
      bodyText:
        "Hola {{nombre_cliente}},\n\n"
        + "Conoce tu Tarjeta de Crédito Punto Pago: dónde usarla, condiciones y cómo solicitarla desde la app.\n\n"
        + "Toca el botón para ver el tour interactivo.",
      footerText: "Punto Pago · Productos",
      cta: "Conocer tarjeta",
    },
  },
  punto_pago_bienvenida: {
    key: "punto_pago_bienvenida",
    label: "Bienvenida al cliente",
    description: "Saludo inicial con ID de cliente. Para onboarding tras alta en Punto Pago.",
    name: "bienvenida_cliente",
    category: "MARKETING",
    language: "es",
    headerText: "Bienvenido a Punto Pago",
    bodyText:
      "Hola {{1}},\n\n"
      + "Tu cuenta Punto Pago está activa. Tu ID de cliente es {{2}}.\n\n"
      + "Desde este chat puedes consultar saldos, pagar y recibir avisos importantes.",
    footerText: "Punto Pago",
    variables: [
      {
        key: "nombre_cliente",
        placeholder: "{{1}}",
        label: "Nombre del cliente",
        type: "text",
        example: "Ana Torres",
        mapsTo: "Nombre para el saludo de bienvenida",
      },
      {
        key: "id_cliente",
        placeholder: "{{2}}",
        label: "ID de cliente",
        type: "id_ref",
        example: "CLI-10482",
        mapsTo: "Identificador único en tu sistema",
      },
    ],
  },
  punto_pago_codigo_verificacion: {
    key: "punto_pago_codigo_verificacion",
    label: "Código de verificación",
    description: "OTP de un solo uso para validar identidad o confirmar una acción sensible.",
    name: "codigo_verificacion",
    category: "AUTHENTICATION",
    language: "es",
    bodyText:
      "Tu código de verificación Punto Pago es {{1}}.\n\n"
      + "Válido por 10 minutos. No lo compartas con nadie.",
    footerText: "Punto Pago · Seguridad",
    variables: [
      {
        key: "codigo_otp",
        placeholder: "{{1}}",
        label: "Código OTP",
        type: "code",
        example: "847291",
        mapsTo: "Código numérico de un solo uso",
      },
    ],
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
    variables: (p.variables || []).map((v) => ({
      key: v.key,
      label: v.label,
      example: v.example,
      placeholder: v.placeholder,
    })),
    flowCta: p.flowCta,
    flowSampleKey: p.flowSampleKey || null,
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
