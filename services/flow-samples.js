"use strict";

const HELLO_FLOW = {
  version: "7.3",
  screens: [
    {
      id: "WELCOME_SCREEN",
      title: "Bienvenida",
      terminal: true,
      success: true,
      data: {},
      layout: {
        type: "SingleColumnLayout",
        children: [
          { type: "TextHeading", text: "Hola desde Punto Pago 👋" },
          { type: "TextBody", text: "Este es un Flow de prueba. Pulsa Completar para enviar la respuesta al webhook." },
          {
            type: "Footer",
            label: "Completar",
            "on-click-action": { name: "complete", payload: { origen: "punto_pago_hello" } },
          },
        ],
      },
    },
  ],
};

const LEAD_FLOW = {
  version: "7.3",
  screens: [
    {
      id: "LEAD",
      title: "Contáctanos",
      terminal: true,
      success: true,
      data: {},
      layout: {
        type: "SingleColumnLayout",
        children: [
          {
            type: "Form",
            name: "form",
            children: [
              {
                type: "TextInput",
                name: "nombre",
                label: "Nombre",
                "input-type": "text",
                required: true,
              },
              {
                type: "TextInput",
                name: "email",
                label: "Correo",
                "input-type": "email",
                required: true,
              },
              {
                type: "TextInput",
                name: "telefono",
                label: "Teléfono",
                "input-type": "phone",
                required: false,
              },
            ],
          },
          {
            type: "Footer",
            label: "Enviar",
            "on-click-action": {
              name: "complete",
              payload: {
                nombre: "${screen.LEAD.form.nombre}",
                email: "${screen.LEAD.form.email}",
                telefono: "${screen.LEAD.form.telefono}",
              },
            },
          },
        ],
      },
    },
  ],
};

const QUOTE_FLOW = {
  version: "7.3",
  data_api_version: "4.0",
  routing_model: {
    DATA: ["SUCCESS"],
    SUCCESS: [],
  },
  screens: [
    {
      id: "DATA",
      title: "Cotización",
      data: {
        productos: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              title: { type: "string" },
            },
          },
          __example__: [{ id: "credito", title: "Crédito personal" }],
        },
      },
      layout: {
        type: "SingleColumnLayout",
        children: [
          {
            type: "Form",
            name: "form",
            children: [
              {
                type: "Dropdown",
                name: "producto",
                label: "Producto",
                required: true,
                "data-source": "${data.productos}",
              },
              {
                type: "TextInput",
                name: "monto",
                label: "Monto (USD)",
                "input-type": "number",
                required: true,
              },
            ],
          },
          {
            type: "Footer",
            label: "Calcular cuota",
            "on-click-action": { name: "data_exchange", payload: {} },
          },
        ],
      },
    },
    {
      id: "SUCCESS",
      title: "Resultado",
      terminal: true,
      success: true,
      data: {
        producto_label: { type: "string", __example__: "Crédito personal" },
        monto: { type: "string", __example__: "1000.00" },
        cuota: { type: "string", __example__: "90.00" },
      },
      layout: {
        type: "SingleColumnLayout",
        children: [
          { type: "TextHeading", text: "Tu cotización" },
          { type: "TextBody", text: "Producto: ${data.producto_label}" },
          { type: "TextBody", text: "Monto: $${data.monto}" },
          { type: "TextBody", text: "Cuota estimada (12 meses): $${data.cuota}/mes" },
          {
            type: "Footer",
            label: "Confirmar",
            "on-click-action": {
              name: "complete",
              payload: {
                producto: "${data.producto_label}",
                monto: "${data.monto}",
                cuota: "${data.cuota}",
              },
            },
          },
        ],
      },
    },
  ],
};

const PAYMENT_AUTH_FLOW = {
  version: "7.3",
  data_api_version: "4.0",
  routing_model: {
    AUTH: ["RESULT"],
    RESULT: [],
  },
  screens: [
    {
      id: "AUTH",
      title: "Verificación de pago",
      data: {
        merchant: { type: "string", __example__: "Supermercado XO" },
        amount: { type: "string", __example__: "USD 45.90" },
        card_label: { type: "string", __example__: "Tarjeta Punto Pago •••• 4821" },
        card_image: { type: "string", __example__: "https://example.com/card.png" },
        when: { type: "string", __example__: "8 jun 2026, 14:32" },
      },
      layout: {
        type: "SingleColumnLayout",
        children: [
          { type: "TextHeading", text: "Confirma tu transacción" },
          {
            type: "TextBody",
            text: "Verificación de seguridad (3DS). Revisa los datos del pago antes de continuar.",
          },
          {
            type: "Image",
            src: "${data.card_image}",
            "alt-text": "Tarjeta Punto Pago",
            "scale-type": "contain",
            width: 280,
            height: 175,
          },
          { type: "TextBody", text: "Comercio: ${data.merchant}" },
          { type: "TextBody", text: "Monto: ${data.amount}" },
          { type: "TextBody", text: "${data.card_label}" },
          { type: "TextBody", text: "Fecha: ${data.when}" },
          {
            type: "TextBody",
            text: "Si no reconoces esta compra, elige Rechazar y contáctanos de inmediato.",
          },
          {
            type: "TextBody",
            text: "Elige una opción y pulsa Continuar para enviar tu respuesta.",
          },
          {
            type: "Form",
            name: "form",
            children: [
              {
                type: "RadioButtonsGroup",
                name: "decision",
                label: "¿Apruebas este pago?",
                required: true,
                "data-source": [
                  { id: "authorize", title: "Aprobar transacción" },
                  { id: "deny", title: "Rechazar transacción" },
                ],
              },
            ],
          },
          {
            type: "Footer",
            label: "Continuar",
            "on-click-action": { name: "data_exchange", payload: {} },
          },
        ],
      },
    },
    {
      id: "RESULT",
      title: "Resultado",
      terminal: true,
      success: true,
      data: {
        result_title: { type: "string", __example__: "Pago aprobado" },
        result_body: { type: "string", __example__: "El comercio procesará tu pago en breve." },
        decision: { type: "string", __example__: "authorize" },
        merchant: { type: "string", __example__: "Supermercado XO" },
        amount: { type: "string", __example__: "USD 45.90" },
      },
      layout: {
        type: "SingleColumnLayout",
        children: [
          { type: "TextHeading", text: "${data.result_title}" },
          { type: "TextBody", text: "${data.result_body}" },
          { type: "TextBody", text: "Comercio: ${data.merchant}" },
          { type: "TextBody", text: "Monto: ${data.amount}" },
          {
            type: "Footer",
            label: "Cerrar",
            "on-click-action": {
              name: "complete",
              payload: {
                decision: "${data.decision}",
                merchant: "${data.merchant}",
                amount: "${data.amount}",
              },
            },
          },
        ],
      },
    },
  ],
};

const SAMPLES = {
  hello: {
    name: "punto_pago_hello",
    categories: ["OTHER"],
    publish: false,
    description: "Flow mínimo de prueba (una pantalla, sin formulario).",
    defaultScreen: "WELCOME_SCREEN",
    defaultCta: "Abrir",
    flow_json: HELLO_FLOW,
  },
  lead: {
    name: "punto_pago_lead",
    categories: ["LEAD_GENERATION"],
    publish: false,
    description: "Captura nombre, email y teléfono. Se crea en borrador para revisar en Meta.",
    defaultScreen: "LEAD",
    defaultCta: "Completar datos",
    flow_json: LEAD_FLOW,
  },
  quote: {
    name: "punto_pago_cotizacion",
    categories: ["OTHER"],
    publish: false,
    description: "Flow dinámico con endpoint propio: elige producto, calcula cuota vía data_exchange.",
    defaultScreen: "DATA",
    defaultCta: "Cotizar",
    flowAction: "data_exchange",
    dynamic: true,
    flow_json: QUOTE_FLOW,
  },
  payment_auth: {
    name: "punto_pago_3ds_verificacion",
    categories: ["OTHER"],
    publish: false,
    description: "Verificación 3DS Punto Pago: confirma o rechaza un pago con tarjeta antes de procesarlo.",
    defaultScreen: "AUTH",
    defaultCta: "Confirmar pago",
    flowAction: "data_exchange",
    dynamic: true,
    flow_json: PAYMENT_AUTH_FLOW,
  },
};

function getSample(key) {
  return SAMPLES[key] || null;
}

function listSamples() {
  return Object.entries(SAMPLES).map(([key, s]) => ({
    key,
    name: s.name,
    description: s.description,
    publish: s.publish,
    defaultScreen: s.defaultScreen,
    defaultCta: s.defaultCta,
    dynamic: Boolean(s.dynamic),
    flowAction: s.flowAction || "navigate",
  }));
}

module.exports = { SAMPLES, getSample, listSamples };
