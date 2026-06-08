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
