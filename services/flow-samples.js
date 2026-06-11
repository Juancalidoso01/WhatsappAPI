"use strict";

const fs = require("fs");
const path = require("path");
const config = require("./config");

function flowAssetSrc(filename) {
  const assetPath = path.join(__dirname, "..", "public", "assets", filename);
  try {
    const b64 = fs.readFileSync(assetPath).toString("base64");
    if (b64) return b64;
  } catch (_) {}
  const base = config.publicBaseUrl || config.cardImageUrl;
  if (base) return `${String(base).replace(/\/$/, "")}/assets/${filename}`;
  return "https://whatsapp-api-ten-tau.vercel.app/assets/punto-pago-card.png";
}

function flowImageBlock(altText) {
  return {
    type: "Image",
    src: flowAssetSrc("punto-pago-card.png"),
    "alt-text": altText,
    "scale-type": "contain",
    width: 280,
    height: 175,
  };
}

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

/** Reservas con CalendarPicker + horarios dinámicos vía endpoint (data_exchange). */
const BOOKING_FLOW = {
  version: "7.3",
  data_api_version: "4.0",
  routing_model: {
    BOOK: ["SUCCESS"],
    SUCCESS: [],
  },
  screens: [
    {
      id: "BOOK",
      title: "Agendar cita",
      data: {
        sucursales: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              title: { type: "string" },
            },
          },
          __example__: [{ id: "centro", title: "Punto Pago — Centro" }],
        },
        available_slots: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              title: { type: "string" },
            },
          },
          __example__: [{ id: "1000", title: "10:00" }],
        },
        is_slot_visible: { type: "boolean", __example__: false },
        min_date: { type: "string", __example__: "2026-06-09" },
        max_date: { type: "string", __example__: "2026-07-09" },
        selected_date: { type: "string", __example__: "" },
      },
      layout: {
        type: "SingleColumnLayout",
        children: [
          { type: "TextHeading", text: "Agenda tu cita" },
          {
            type: "TextBody",
            text: "Elige sucursal, fecha y horario. Los horarios disponibles se cargan al seleccionar una fecha.",
          },
          {
            type: "Form",
            name: "form",
            children: [
              {
                type: "Dropdown",
                name: "sucursal",
                label: "Sucursal",
                required: true,
                "data-source": "${data.sucursales}",
              },
              {
                type: "CalendarPicker",
                name: "fecha",
                label: "Fecha",
                required: true,
                mode: "single",
                "min-date": "${data.min_date}",
                "max-date": "${data.max_date}",
                "include-days": ["Mon", "Tue", "Wed", "Thu", "Fri"],
                "on-select-action": {
                  name: "data_exchange",
                  payload: {
                    component_action: "update_date",
                    fecha: "${form.fecha}",
                    sucursal: "${form.sucursal}",
                  },
                },
              },
              {
                type: "Dropdown",
                name: "horario",
                label: "Horario disponible",
                required: true,
                visible: "${data.is_slot_visible}",
                "data-source": "${data.available_slots}",
              },
              {
                type: "TextInput",
                name: "nombre",
                label: "Tu nombre",
                required: true,
                "input-type": "text",
              },
            ],
          },
          {
            type: "Footer",
            label: "Confirmar cita",
            "on-click-action": {
              name: "data_exchange",
              payload: { component_action: "confirm" },
            },
          },
        ],
      },
    },
    {
      id: "SUCCESS",
      title: "Cita confirmada",
      terminal: true,
      success: true,
      data: {
        resumen: {
          type: "string",
          __example__: "Tu cita en Punto Pago — Centro el lunes 9 de junio de 2026 a las 10:00 quedó registrada.",
        },
        sucursal_label: { type: "string", __example__: "Punto Pago — Centro" },
        fecha_label: { type: "string", __example__: "lunes, 9 de junio de 2026" },
        horario_label: { type: "string", __example__: "10:00" },
        nombre: { type: "string", __example__: "Ana Torres" },
      },
      layout: {
        type: "SingleColumnLayout",
        children: [
          { type: "TextHeading", text: "¡Cita confirmada!" },
          { type: "TextBody", text: "${data.resumen}" },
          { type: "TextBody", text: "Sucursal: ${data.sucursal_label}" },
          { type: "TextBody", text: "Fecha: ${data.fecha_label}" },
          { type: "TextBody", text: "Hora: ${data.horario_label}" },
          { type: "TextBody", text: "Nombre: ${data.nombre}" },
          {
            type: "Footer",
            label: "Cerrar",
            "on-click-action": {
              name: "complete",
              payload: {
                sucursal: "${data.sucursal_label}",
                fecha: "${data.fecha_label}",
                horario: "${data.horario_label}",
                nombre: "${data.nombre}",
              },
            },
          },
        ],
      },
    },
  ],
};

/** Tour de producto: Tarjeta de Crédito (contenido basado en Centro de Ayuda Punto Pago). */
const TARJETA_CREDITO_FLOW = {
  version: "7.3",
  routing_model: {
    INTRO: ["BENEFICIOS"],
    BENEFICIOS: ["COSTOS"],
    COSTOS: ["SOLICITUD"],
    SOLICITUD: ["LISTO"],
    LISTO: [],
  },
  screens: [
    {
      id: "INTRO",
      title: "Tarjeta de crédito",
      layout: {
        type: "SingleColumnLayout",
        children: [
          { type: "TextHeading", text: "Tarjeta de Crédito Punto Pago" },
          flowImageBlock("Tarjeta de Crédito Punto Pago"),
          {
            type: "TextBody",
            text: "Te mostramos en pocos pasos cómo funciona tu tarjeta y cómo solicitarla desde la app.",
          },
          {
            type: "Footer",
            label: "Empezar",
            "on-click-action": { name: "navigate", next: { type: "screen", name: "BENEFICIOS" } },
          },
        ],
      },
    },
    {
      id: "BENEFICIOS",
      title: "Beneficios",
      layout: {
        type: "SingleColumnLayout",
        children: [
          { type: "TextHeading", text: "¿Dónde la uso?" },
          flowImageBlock("Tarjeta Punto Pago"),
          {
            type: "TextBody",
            text: "Paga en tiendas físicas y virtuales en Panamá y en el exterior con tu tarjeta Punto Pago.",
          },
          {
            type: "TextBody",
            text: "Límite disponible desde $10 hasta $500 según tu historial crediticio. El límite puede aumentar con buen uso y pagos a tiempo.",
          },
          {
            type: "TextCaption",
            text: "Tip: usa la flecha ← del teléfono para volver al paso anterior.",
          },
          {
            type: "Footer",
            label: "Siguiente",
            "on-click-action": { name: "navigate", next: { type: "screen", name: "COSTOS" } },
          },
        ],
      },
    },
    {
      id: "COSTOS",
      title: "Condiciones",
      layout: {
        type: "SingleColumnLayout",
        children: [
          { type: "TextHeading", text: "Condiciones claras" },
          { type: "TextBody", text: "Sin anualidad." },
          { type: "TextBody", text: "Interés mensual: 8,25%." },
          {
            type: "TextBody",
            text: "Tu fecha de pago se configura a 30 días a partir de tu primera compra con la tarjeta de crédito.",
          },
          {
            type: "TextCaption",
            text: "Tip: usa la flecha ← del teléfono para volver al paso anterior.",
          },
          {
            type: "Footer",
            label: "Siguiente",
            "on-click-action": { name: "navigate", next: { type: "screen", name: "SOLICITUD" } },
          },
        ],
      },
    },
    {
      id: "SOLICITUD",
      title: "Cómo solicitarla",
      layout: {
        type: "SingleColumnLayout",
        children: [
          { type: "TextHeading", text: "Solicítala en la app" },
          flowImageBlock("Tarjeta negra en la app Punto Pago"),
          {
            type: "TextBody",
            text: "1. Abre la app y toca la imagen de la tarjeta negra (arriba a la derecha en la pantalla principal).",
          },
          {
            type: "TextBody",
            text: "2. Revisa y confirma el límite aprobado. 3. Indica la dirección de entrega. 4. Recibe tu tarjeta en casa.",
          },
          {
            type: "TextBody",
            text: "Si no ves la tarjeta negra, completa tu validación de identidad e inténtalo más adelante.",
          },
          {
            type: "TextCaption",
            text: "Tip: usa la flecha ← del teléfono para volver al paso anterior.",
          },
          {
            type: "Footer",
            label: "Siguiente",
            "on-click-action": { name: "navigate", next: { type: "screen", name: "LISTO" } },
          },
        ],
      },
    },
    {
      id: "LISTO",
      title: "Listo",
      terminal: true,
      success: true,
      layout: {
        type: "SingleColumnLayout",
        children: [
          { type: "TextHeading", text: "¡Ya conoces lo esencial!" },
          {
            type: "TextBody",
            text: "Más detalles en el Centro de Ayuda Punto Pago. Si tienes dudas, escribe AYUDA por este chat.",
          },
          {
            type: "TextBody",
            text: "Para ver este tour otra vez, escribe TARJETA en este chat y te lo reenviamos (WhatsApp no permite reabrir un tour ya cerrado).",
          },
          {
            type: "EmbeddedLink",
            text: "Ver artículo en el Centro de Ayuda",
            "on-click-action": {
              name: "open_url",
              url: "https://faq-sooty-theta.vercel.app/articulo/tarjeta-de-credito/tarjeta-de-credito",
            },
          },
          {
            type: "Footer",
            label: "Cerrar",
            "on-click-action": {
              name: "complete",
              payload: { producto: "tarjeta_credito", origen: "welcome_flow" },
            },
          },
        ],
      },
    },
  ],
};

const KYC_FLOW = {
  version: "7.3",
  screens: [
    {
      id: "KYC",
      title: "Verificación de identidad",
      terminal: true,
      success: true,
      data: {},
      layout: {
        type: "SingleColumnLayout",
        children: [
          { type: "TextHeading", text: "Completa tu registro" },
          { type: "TextBody", text: "Necesitamos algunos datos para validar tu identidad en Punto Pago." },
          {
            type: "Form",
            name: "form",
            children: [
              { type: "TextInput", name: "nombre", label: "Nombre completo", "input-type": "text", required: true },
              { type: "TextInput", name: "documento", label: "Número de documento", "input-type": "text", required: true },
              { type: "TextInput", name: "email", label: "Correo electrónico", "input-type": "email", required: true },
              { type: "OptIn", name: "terminos", label: "Acepto los términos y la política de privacidad", required: true },
            ],
          },
          {
            type: "Footer",
            label: "Enviar datos",
            "on-click-action": {
              name: "complete",
              payload: {
                nombre: "${screen.KYC.form.nombre}",
                documento: "${screen.KYC.form.documento}",
                email: "${screen.KYC.form.email}",
                terminos: "${screen.KYC.form.terminos}",
              },
            },
          },
        ],
      },
    },
  ],
};

const MARKETING_FLOW = {
  version: "7.3",
  routing_model: { PROMO: ["SIGNUP"], SIGNUP: [] },
  screens: [
    {
      id: "PROMO",
      title: "Promoción exclusiva",
      data: {},
      layout: {
        type: "SingleColumnLayout",
        children: [
          { type: "TextHeading", text: "20% de descuento" },
          { type: "TextBody", text: "Regístrate para recibir tu código promocional de Punto Pago." },
          {
            type: "Footer",
            label: "Quiero el descuento",
            "on-click-action": { name: "navigate", next: { type: "screen", name: "SIGNUP" } },
          },
        ],
      },
    },
    {
      id: "SIGNUP",
      title: "Registro promo",
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
              { type: "TextInput", name: "nombre", label: "Nombre", "input-type": "text", required: true },
              { type: "TextInput", name: "email", label: "Correo", "input-type": "email", required: true },
            ],
          },
          {
            type: "Footer",
            label: "Recibir código",
            "on-click-action": {
              name: "complete",
              payload: {
                nombre: "${screen.SIGNUP.form.nombre}",
                email: "${screen.SIGNUP.form.email}",
                campana: "promo_20",
              },
            },
          },
        ],
      },
    },
  ],
};

const LOGISTICS_FLOW = {
  version: "7.3",
  screens: [
    {
      id: "DELIVERY",
      title: "Confirmar entrega",
      terminal: true,
      success: true,
      data: {},
      layout: {
        type: "SingleColumnLayout",
        children: [
          { type: "TextHeading", text: "Datos de entrega" },
          { type: "TextBody", text: "Confirma la dirección y la ventana horaria para tu pedido Punto Pago." },
          {
            type: "Form",
            name: "form",
            children: [
              { type: "TextInput", name: "direccion", label: "Dirección completa", "input-type": "text", required: true },
              { type: "TextInput", name: "referencia", label: "Referencia / edificio", "input-type": "text", required: false },
              {
                type: "Dropdown",
                name: "ventana",
                label: "Ventana de entrega",
                required: true,
                "data-source": [
                  { id: "manana", title: "Mañana (8:00–12:00)" },
                  { id: "tarde", title: "Tarde (14:00–18:00)" },
                  { id: "noche", title: "Noche (18:00–21:00)" },
                ],
              },
            ],
          },
          {
            type: "Footer",
            label: "Confirmar entrega",
            "on-click-action": {
              name: "complete",
              payload: {
                direccion: "${screen.DELIVERY.form.direccion}",
                referencia: "${screen.DELIVERY.form.referencia}",
                ventana: "${screen.DELIVERY.form.ventana}",
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
    sendDefaults: {
      bodyText: "Hola, este es un formulario de prueba de Punto Pago. Toca el botón para abrirlo.",
      cta: "Abrir",
      screen: "WELCOME_SCREEN",
    },
    flow_json: HELLO_FLOW,
  },
  lead: {
    name: "punto_pago_lead",
    categories: ["LEAD_GENERATION"],
    publish: false,
    description: "Captura nombre, email y teléfono. Se crea en borrador para revisar en Meta.",
    defaultScreen: "LEAD",
    defaultCta: "Completar datos",
    sendDefaults: {
      bodyText: "Hola, completa tus datos en el formulario de Punto Pago.",
      cta: "Completar datos",
      screen: "LEAD",
    },
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
    sendDefaults: {
      bodyText: "Hola, solicita una cotización desde el formulario de Punto Pago.",
      cta: "Cotizar",
      screen: "DATA",
    },
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
    sendDefaults: {
      bodyText: "Se requiere tu confirmación para un pago con Tarjeta Punto Pago. Toca el botón para aprobar o rechazar.",
      cta: "Confirmar pago",
      screen: "AUTH",
    },
    flow_json: PAYMENT_AUTH_FLOW,
  },
  booking: {
    name: "punto_pago_reserva_cita",
    categories: ["APPOINTMENT_BOOKING"],
    publish: false,
    description: "Reserva de cita: elige sucursal, fecha en calendario y horario dinámico desde el endpoint.",
    defaultScreen: "BOOK",
    defaultCta: "Agendar cita",
    flowAction: "data_exchange",
    dynamic: true,
    sendDefaults: {
      headerText: "Agenda tu cita",
      bodyText: "Hola, elige sucursal, fecha y horario para tu cita en Punto Pago. Los horarios se actualizan al seleccionar la fecha.",
      footerText: "Punto Pago · Citas",
      cta: "Agendar cita",
      screen: "BOOK",
    },
    flow_json: BOOKING_FLOW,
  },
  tarjeta_credito: {
    name: "punto_pago_tarjeta_credito",
    categories: ["SIGN_UP"],
    publish: false,
    description: "Tour de producto: beneficios, condiciones y cómo solicitar la Tarjeta de Crédito en la app.",
    defaultScreen: "INTRO",
    defaultCta: "Conocer tarjeta",
    flowAction: "navigate",
    dynamic: false,
    sendDefaults: {
      headerText: "Tu Tarjeta de Crédito",
      bodyText: "Hola,\n\nTour interactivo de la Tarjeta de Crédito Punto Pago. Toca el botón para empezar.",
      footerText: "Punto Pago · Productos",
      cta: "Conocer tarjeta",
      screen: "INTRO",
    },
    flow_json: TARJETA_CREDITO_FLOW,
  },
  kyc: {
    name: "punto_pago_kyc",
    categories: ["SIGN_UP"],
    publish: false,
    description: "Registro KYC: nombre, documento, correo y aceptación de términos.",
    defaultScreen: "KYC",
    defaultCta: "Completar registro",
    sendDefaults: {
      bodyText: "Hola, completa tu verificación de identidad en Punto Pago.",
      cta: "Completar registro",
      screen: "KYC",
    },
    flow_json: KYC_FLOW,
  },
  marketing: {
    name: "punto_pago_promo",
    categories: ["OTHER"],
    publish: false,
    description: "Promoción con pantalla intro y registro de email (routing ramificado).",
    defaultScreen: "PROMO",
    defaultCta: "Ver promoción",
    sendDefaults: {
      bodyText: "Tienes un descuento exclusivo en Punto Pago. Toca para registrarte.",
      cta: "Ver promoción",
      screen: "PROMO",
    },
    flow_json: MARKETING_FLOW,
  },
  logistics: {
    name: "punto_pago_entrega",
    categories: ["OTHER"],
    publish: false,
    description: "Confirmación de dirección y ventana horaria de entrega.",
    defaultScreen: "DELIVERY",
    defaultCta: "Confirmar entrega",
    sendDefaults: {
      bodyText: "Confirma los datos de entrega de tu pedido Punto Pago.",
      cta: "Confirmar entrega",
      screen: "DELIVERY",
    },
    flow_json: LOGISTICS_FLOW,
  },
};

function extractScreenPreview(flowJson, screenId) {
  const screen = (flowJson && flowJson.screens ? flowJson.screens : []).find((s) => s.id === screenId);
  if (!screen) return null;
  const children = (screen.layout && screen.layout.children) || [];
  const headings = children.filter((c) => c.type === "TextHeading").map((c) => c.text);
  const bodies = children.filter((c) => c.type === "TextBody").map((c) => c.text);
  const captions = children.filter((c) => c.type === "TextCaption").map((c) => c.text);
  const links = children.filter((c) => c.type === "EmbeddedLink").map((c) => c.text);
  const richTexts = children.filter((c) => c.type === "RichText").map((c) => c.text);
  const footer = children.find((c) => c.type === "Footer");
  const hasImage = children.some((c) => c.type === "Image");
  const imageUrl = hasImage
    ? (config.cardImageUrl || (config.publicBaseUrl ? `${config.publicBaseUrl}/assets/punto-pago-card.png` : "/assets/punto-pago-card.png"))
    : null;

  return {
    id: screen.id,
    title: screen.title || screen.id,
    headings,
    bodies,
    captions,
    links,
    richTexts,
    footerLabel: footer && footer.label ? footer.label : "",
    hasImage,
    imageUrl,
    terminal: Boolean(screen.terminal),
  };
}

function extractFlowScreens(flowJson) {
  return (flowJson && flowJson.screens ? flowJson.screens : []).map((s, index) => {
    const preview = extractScreenPreview(flowJson, s.id);
    return {
      id: s.id,
      title: s.title || s.id,
      index: index + 1,
      terminal: Boolean(s.terminal),
      preview,
    };
  });
}

function resolveSendProfileByFlowName(flowName) {
  const n = String(flowName || "").toLowerCase();
  let best = null;
  for (const [key, sample] of Object.entries(SAMPLES)) {
    const base = String(sample.name || "").toLowerCase();
    if (!base) continue;
    if (n === base || n.startsWith(`${base}_`)) {
      if (!best || base.length > best.baseLen) best = { key, sample, baseLen: base.length };
    }
  }
  if (!best) return null;

  const { key, sample } = best;
  const screens = extractFlowScreens(sample.flow_json);
  const defaults = sample.sendDefaults || {};
  const defaultScreen = defaults.screen || sample.defaultScreen || screens[0]?.id || "WELCOME_SCREEN";

  const PRESET_BY_SAMPLE = {
    tarjeta_credito: "punto_pago_tarjeta_credito_bienvenida",
    payment_auth: "punto_pago_autorizacion_pago",
    booking: "punto_pago_reserva_cita",
  };

  return {
    sampleKey: key,
    presetKey: PRESET_BY_SAMPLE[key] || null,
    label: sample.description || sample.name,
    dynamic: Boolean(sample.dynamic),
    flowAction: sample.flowAction || "navigate",
    defaultScreen,
    defaultCta: defaults.cta || sample.defaultCta || "Abrir",
    sendDefaults: {
      headerText: defaults.headerText || "",
      bodyText: defaults.bodyText || "",
      footerText: defaults.footerText || "",
      cta: defaults.cta || sample.defaultCta || "Abrir",
      screen: defaultScreen,
    },
    screens,
  };
}

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

module.exports = {
  SAMPLES,
  getSample,
  listSamples,
  extractFlowScreens,
  extractScreenPreview,
  resolveSendProfileByFlowName,
};
