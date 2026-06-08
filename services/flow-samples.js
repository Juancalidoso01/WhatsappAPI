"use strict";

const HELLO_FLOW = {
  version: "5.0",
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
  version: "5.0",
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

const SAMPLES = {
  hello: {
    name: "punto_pago_hello",
    categories: ["OTHER"],
    publish: true,
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
  }));
}

module.exports = { SAMPLES, getSample, listSamples };
