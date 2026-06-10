"use strict";

/** Tipos de valor aceptados en variables de plantilla (guía para operadores). */
const TYPE_META = {
  text: {
    typeLabel: "Texto",
    accept: "Letras, espacios y signos básicos. Sin emojis ni saltos de línea.",
    example: "Juan Pablo",
    maxLength: 60,
  },
  money: {
    typeLabel: "Monto",
    accept: "Moneda ISO (3 letras) + espacio + monto con 2 decimales.",
    example: "USD 45.90",
    pattern: "^[A-Z]{3}\\s\\d+(\\.\\d{2})$",
  },
  merchant: {
    typeLabel: "Comercio",
    accept: "Nombre del establecimiento. Texto corto, sin URLs.",
    example: "Supermercado XO",
    maxLength: 80,
  },
  card_last4: {
    typeLabel: "Últimos 4 dígitos",
    accept: "Exactamente 4 números (últimos dígitos de la tarjeta).",
    example: "4821",
    pattern: "^\\d{4}$",
    maxLength: 4,
  },
  phone: {
    typeLabel: "Teléfono",
    accept: "Solo dígitos, con código de país (sin + ni espacios).",
    example: "50763163152",
    pattern: "^\\d{8,15}$",
  },
  date: {
    typeLabel: "Fecha",
    accept: "Fecha legible. Ej: 15 mar 2026 o 15/03/2026.",
    example: "15 mar 2026",
    maxLength: 40,
  },
  code: {
    typeLabel: "Código",
    accept: "Alfanumérico corto, sin espacios.",
    example: "FAC-2026-00482",
    maxLength: 32,
  },
  id_ref: {
    typeLabel: "ID interno",
    accept: "Identificador del cliente en tu sistema. Alfanumérico, sin espacios.",
    example: "CLI-10482",
    maxLength: 40,
    pattern: "^[A-Za-z0-9_-]{3,40}$",
  },
  integer: {
    typeLabel: "Número entero",
    accept: "Solo dígitos (cantidad de días, cuotas, etc.).",
    example: "15",
    pattern: "^\\d{1,4}$",
    maxLength: 4,
  },
  url: {
    typeLabel: "URL",
    accept: "Enlace https:// público y accesible.",
    example: "https://puntopago.net/pago/123",
  },
  generic: {
    typeLabel: "Texto libre",
    accept: "Texto corto sin saltos de línea. Meta limita ~1024 caracteres en el cuerpo completo.",
    example: "Valor de ejemplo",
    maxLength: 200,
  },
};

/**
 * Esquemas por clave API. Solo guía humana / futuros borradores.
 * No modifica plantillas ya aprobadas en Meta.
 */
const KEY_SCHEMA = {
  nombre_cliente: {
    key: "nombre_cliente",
    label: "Nombre del cliente",
    type: "text",
    mapsTo: "Nombre que saluda el mensaje",
    example: "Juan Pablo",
    status: "active",
    usedIn: "punto_pago_3ds_confirmar_pago, recordatorio_pago, recordatorio_mora, confirmacion_pago, bienvenida_cliente",
  },
  monto: {
    key: "monto",
    label: "Monto del pago",
    type: "money",
    mapsTo: "Importe que el cliente debe confirmar",
    example: "USD 45.90",
    status: "active",
    usedIn: "punto_pago_3ds_confirmar_pago, recordatorio_pago, confirmacion_pago",
  },
  comercio: {
    key: "comercio",
    label: "Comercio",
    type: "merchant",
    mapsTo: "Establecimiento donde se realiza el cargo",
    example: "Supermercado XO",
    status: "active",
    usedIn: "punto_pago_3ds_confirmar_pago",
  },
  ultimos_4: {
    key: "ultimos_4",
    label: "Últimos 4 de la tarjeta",
    type: "card_last4",
    mapsTo: "Tarjeta Punto Pago que aparece como •••• 4821",
    example: "4821",
    status: "active",
    usedIn: "punto_pago_3ds_confirmar_pago",
  },
  id_cliente: {
    key: "id_cliente",
    label: "ID de cliente",
    type: "id_ref",
    mapsTo: "Identificador único del cliente en Punto Pago / core bancario",
    example: "CLI-10482",
    status: "active",
    usedIn: "bienvenida_cliente",
  },
  numero_factura: {
    key: "numero_factura",
    label: "Número de factura",
    type: "code",
    mapsTo: "Folio o número de factura a cobrar o recordar",
    example: "FAC-2026-00482",
    status: "reference",
  },
  numero_pago: {
    key: "numero_pago",
    label: "Número de pago / referencia",
    type: "code",
    mapsTo: "Referencia de transacción o comprobante de pago",
    example: "PAG-8829103",
    status: "active",
    usedIn: "confirmacion_pago",
  },
  fecha_pago: {
    key: "fecha_pago",
    label: "Fecha de pago",
    type: "date",
    mapsTo: "Día en que se realizó o se programó el pago",
    example: "08 jun 2026",
    status: "active",
    usedIn: "confirmacion_pago",
  },
  fecha_vencimiento: {
    key: "fecha_vencimiento",
    label: "Fecha de vencimiento",
    type: "date",
    mapsTo: "Límite para pagar una deuda o cuota",
    example: "15 jun 2026",
    status: "active",
    usedIn: "recordatorio_pago, recordatorio_mora",
  },
  saldo_deuda: {
    key: "saldo_deuda",
    label: "Saldo de deuda",
    type: "money",
    mapsTo: "Monto total adeudado al momento del mensaje",
    example: "USD 128.40",
    status: "active",
    usedIn: "recordatorio_mora",
  },
  monto_cuota: {
    key: "monto_cuota",
    label: "Monto de cuota",
    type: "money",
    mapsTo: "Importe de la cuota o abono mínimo",
    example: "USD 35.00",
    status: "active",
    usedIn: "recordatorio_mora",
  },
  dias_mora: {
    key: "dias_mora",
    label: "Días en mora",
    type: "integer",
    mapsTo: "Días transcurridos después del vencimiento",
    example: "12",
    status: "active",
    usedIn: "recordatorio_mora",
  },
  telefono_cliente: {
    key: "telefono_cliente",
    label: "Teléfono del cliente",
    type: "phone",
    mapsTo: "Número WhatsApp o móvil del destinatario (solo si va en el texto)",
    example: "50763163152",
    status: "reference",
  },
  codigo_otp: {
    key: "codigo_otp",
    label: "Código OTP",
    type: "code",
    mapsTo: "Código numérico de un solo uso para verificación",
    example: "847291",
    status: "active",
    usedIn: "codigo_verificacion",
  },
};

/** Grupos para la biblioteca visible en el portal (referencia humana). */
const VARIABLE_CATALOG_GROUPS = [
  {
    id: "active_3ds",
    label: "En uso · verificación 3DS",
    note: "Plantilla ya aprobada o en revisión en Meta. La leyenda ayuda al operador al enviar.",
    status: "active",
    keys: ["nombre_cliente", "monto", "comercio", "ultimos_4"],
  },
  {
    id: "identificacion",
    label: "Identificación",
    note: "Para futuras plantillas. No enviar a Meta hasta definir el copy.",
    status: "reference",
    keys: ["id_cliente", "telefono_cliente"],
  },
  {
    id: "pagos",
    label: "Pagos y referencias",
    note: "Números de pago, factura y fechas de cobro.",
    status: "reference",
    keys: ["numero_pago", "numero_factura", "fecha_pago"],
  },
  {
    id: "cobranza",
    label: "En uso · recordatorios y cobranza",
    note: "Borradores recordatorio_pago y recordatorio_mora. Envía a Meta antes de usar en producción.",
    status: "active",
    keys: ["nombre_cliente", "monto", "fecha_vencimiento", "saldo_deuda", "monto_cuota", "dias_mora"],
  },
  {
    id: "confirmaciones",
    label: "En uso · confirmaciones y bienvenida",
    note: "Comprobantes de pago, onboarding y códigos OTP.",
    status: "active",
    keys: ["nombre_cliente", "monto", "fecha_pago", "numero_pago", "id_cliente", "codigo_otp"],
  },
  {
    id: "deudas",
    label: "Deudas y mora (referencia)",
    note: "Mismas claves que cobranza; guía extendida para operadores.",
    status: "reference",
    keys: ["saldo_deuda", "monto_cuota", "fecha_vencimiento", "dias_mora"],
  },
];

/** Plantillas con guía fija (por nombre interno en Meta). */
const TEMPLATE_GUIDES = {
  punto_pago_3ds_confirmar_pago: "punto_pago_autorizacion_pago",
  punto_pago_3ds_confirmar_pago_flow: "punto_pago_autorizacion_pago",
  tarjeta_credito_info: "punto_pago_tarjeta_credito_bienvenida",
  tarjeta_credito_info_flow: "punto_pago_tarjeta_credito_bienvenida",
  recordatorio_pago: "punto_pago_recordatorio_pago",
  recordatorio_mora: "punto_pago_recordatorio_mora",
  confirmacion_pago: "punto_pago_confirmacion_pago",
  bienvenida_cliente: "punto_pago_bienvenida",
  codigo_verificacion: "punto_pago_codigo_verificacion",
};

function inferTypeFromKey(key) {
  const k = String(key || "").toLowerCase();
  if (/^id_/.test(k) || k === "id_cliente") return "id_ref";
  if (/monto|amount|importe|saldo|cuota|deuda/.test(k)) return "money";
  if (/comercio|merchant|tienda|establecimiento/.test(k)) return "merchant";
  if (/ultimos|last4|card|tarjeta/.test(k)) return "card_last4";
  if (/^nombre_|_nombre$|customer_name/.test(k)) return "text";
  if (/telefono|phone|celular|movil/.test(k)) return "phone";
  if (/fecha|date|vence|vencimiento/.test(k)) return "date";
  if (/numero_|num_|factura|pago_ref|referencia/.test(k)) return "code";
  if (/dias_|días_/.test(k)) return "integer";
  if (/codigo|code|cupon|otp/.test(k)) return "code";
  if (/url|link|enlace/.test(k)) return "url";
  if (/cliente|customer/.test(k)) return "text";
  return "generic";
}

function resolveSchema(def) {
  const key = def && def.key ? String(def.key) : "";
  const known = KEY_SCHEMA[key];
  const type = (def && def.type) || (known && known.type) || inferTypeFromKey(key);
  const meta = TYPE_META[type] || TYPE_META.generic;
  return {
    key: key || (def && def.placeholder) || "variable",
    label: (def && def.label) || (known && known.label) || key || "Variable",
    type,
    typeLabel: meta.typeLabel,
    accept: (def && def.accept) || meta.accept,
    example: (def && def.example) || (known && known.example) || meta.example,
    maxLength: (def && def.maxLength) || meta.maxLength,
    pattern: (def && def.pattern) || meta.pattern,
    placeholder: (def && def.placeholder) || (known && known.placeholder) || null,
    mapsTo: (def && def.mapsTo) || (known && known.mapsTo) || null,
    status: (def && def.status) || (known && known.status) || "reference",
    usedIn: (def && def.usedIn) || (known && known.usedIn) || null,
    index: def && def.index != null ? def.index : null,
    component: def && def.component ? def.component : null,
    required: def && def.required !== false,
  };
}

function enrichPresetVariables(variables) {
  return (variables || []).map((v, i) => resolveSchema({
    ...v,
    placeholder: v.placeholder || `{{${i + 1}}}`,
    index: i,
    component: "body",
  }));
}

function enrichEventVariables(eventVariables, templateName) {
  const presetKey = TEMPLATE_GUIDES[templateName];
  let presetVars = null;
  if (presetKey) {
    try {
      const presets = require("./template-presets");
      const preset = presets.getPreset(presetKey);
      if (preset && preset.variables) presetVars = preset.variables;
    } catch (_) { /* ignore */ }
  }

  return (eventVariables || []).map((ev, i) => {
    const presetMatch = presetVars && presetVars.find((p) => p.key === ev.key)
      || (presetVars && presetVars[i]);
    return resolveSchema({
      ...presetMatch,
      ...ev,
      key: ev.key || (presetMatch && presetMatch.key) || `body_${i + 1}`,
      placeholder: ev.placeholder || (presetMatch && presetMatch.placeholder) || `{{${i + 1}}}`,
      index: ev.index != null ? ev.index : i,
      label: ev.label || (presetMatch && presetMatch.label),
      component: ev.component || (presetMatch && "body"),
    });
  });
}

function getVariableCatalog() {
  return VARIABLE_CATALOG_GROUPS.map((g) => ({
    id: g.id,
    label: g.label,
    note: g.note,
    status: g.status,
    variables: g.keys.map((k) => resolveSchema(KEY_SCHEMA[k] || { key: k })),
  }));
}

function lookupSchemaByKey(key) {
  if (!key) return null;
  const k = String(key).trim();
  return resolveSchema(KEY_SCHEMA[k] || { key: k });
}

function inputAttrsForSchema(schema) {
  const attrs = {};
  if (schema.maxLength) attrs.maxlength = schema.maxLength;
  if (schema.pattern) attrs.pattern = schema.pattern;
  if (schema.type === "card_last4") {
    attrs.inputmode = "numeric";
    attrs.maxlength = 4;
  }
  if (schema.type === "phone") attrs.inputmode = "tel";
  if (schema.type === "integer") attrs.inputmode = "numeric";
  if (schema.type === "money") attrs.placeholder = schema.example || "USD 45.90";
  return attrs;
}

module.exports = {
  TYPE_META,
  KEY_SCHEMA,
  VARIABLE_CATALOG_GROUPS,
  TEMPLATE_GUIDES,
  resolveSchema,
  enrichPresetVariables,
  enrichEventVariables,
  getVariableCatalog,
  lookupSchemaByKey,
  inputAttrsForSchema,
};
