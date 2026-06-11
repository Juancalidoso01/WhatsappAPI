"use strict";

const FLOW_VERSION = "7.3";

const FIELD_TYPES = [
  { id: "text", label: "Texto corto", inputType: "text" },
  { id: "textarea", label: "Texto largo", inputType: "text" },
  { id: "number", label: "Número", inputType: "number" },
  { id: "email", label: "Correo", inputType: "email" },
  { id: "phone", label: "Teléfono", inputType: "phone" },
  { id: "select", label: "Lista de opciones", inputType: null },
  { id: "yesno", label: "Sí / No", inputType: null },
  { id: "rating", label: "Calificación 1–5", inputType: null },
  { id: "date", label: "Fecha (DatePicker)", inputType: null, meta: "DatePicker" },
  { id: "calendar", label: "Calendario (reservas)", inputType: null, meta: "CalendarPicker" },
  { id: "optin", label: "Casilla de aceptación", inputType: null, meta: "OptIn" },
  { id: "checkbox", label: "Varias opciones", inputType: null, meta: "CheckboxGroup" },
];

const META_CAPABILITIES = {
  layout: "SingleColumnLayout — columna vertical fija. Meta no permite canvas libre ni CSS.",
  textAlign: false,
  backgroundColor: false,
  textStyles: ["normal", "bold", "italic", "bold_italic"],
  image: { maxKb: 100, scaleTypes: ["contain", "cover"], formats: ["PNG", "JPG"] },
  dynamicBooking: "CalendarPicker/DatePicker con horarios dinámicos requieren Flow endpoint (data_exchange).",
  components: [
    "TextHeading", "TextSubheading", "TextBody", "TextCaption", "RichText",
    "Image", "ImageCarousel", "EmbeddedLink", "Footer", "Form",
    "TextInput", "TextArea", "Dropdown", "RadioButtonsGroup", "CheckboxGroup",
    "DatePicker", "CalendarPicker", "OptIn", "Switch", "If",
  ],
};

const CATEGORIES = [
  { id: "OTHER", label: "Otro" },
  { id: "LEAD_GENERATION", label: "Generación de leads" },
  { id: "SURVEY", label: "Encuesta" },
  { id: "SIGN_UP", label: "Registro" },
  { id: "CUSTOMER_SUPPORT", label: "Soporte" },
  { id: "APPOINTMENT_BOOKING", label: "Reserva de citas" },
];

const LIMITS = {
  maxScreens: 8,
  maxFieldsPerScreen: 12,
  maxBlocksPerScreen: 10,
  imageMaxKb: 100,
  carouselMinImages: 2,
  carouselMaxImages: 5,
};

function slugify(text, fallback) {
  const s = String(text || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 28);
  return s || fallback;
}

function validateName(name) {
  const n = String(name || "").trim();
  if (!n) return { ok: false, error: "El nombre del Flow es obligatorio." };
  if (!/^[a-z0-9_]{3,80}$/i.test(n)) {
    return { ok: false, error: "Usa solo letras, números y guion bajo (3–80 caracteres)." };
  }
  return { ok: true, name: n.toLowerCase() };
}

function validateDefinition(def) {
  const nameCheck = validateName(def.name);
  if (!nameCheck.ok) return nameCheck;

  const screens = def.screens || [];
  if (!screens.length) return { ok: false, error: "Agrega al menos una pantalla." };

  const usedNames = new Set();
  for (let si = 0; si < screens.length; si++) {
    const scr = screens[si];
    if (!String(scr.title || "").trim()) {
      return { ok: false, error: `La pantalla ${si + 1} necesita un título.` };
    }
    const blocks = Array.isArray(scr.blocks) ? scr.blocks : [];
    if (blocks.length > LIMITS.maxBlocksPerScreen) {
      return {
        ok: false,
        error: `"${scr.title}": máximo ${LIMITS.maxBlocksPerScreen} bloques por pantalla.`,
      };
    }
    for (let bi = 0; bi < blocks.length; bi++) {
      const b = blocks[bi];
      if (b.type === "link") {
        if (!String(b.text || "").trim()) {
          return { ok: false, error: `"${scr.title}": el enlace ${bi + 1} necesita texto.` };
        }
        const url = String(b.url || "").trim();
        if (!url || !/^https?:\/\//i.test(url)) {
          return { ok: false, error: `"${scr.title}": el enlace "${b.text}" necesita URL https:// válida.` };
        }
      }
      if (b.type === "carousel") {
        const imgs = (b.images || []).filter((img) => img && (img.src || img.previewUrl));
        if (imgs.length > 0 && imgs.length < LIMITS.carouselMinImages) {
          return {
            ok: false,
            error: `"${scr.title}": el carrusel necesita al menos ${LIMITS.carouselMinImages} imágenes.`,
          };
        }
        if (imgs.length > LIMITS.carouselMaxImages) {
          return {
            ok: false,
            error: `"${scr.title}": máximo ${LIMITS.carouselMaxImages} imágenes en carrusel.`,
          };
        }
      }
    }
    if (scr.type === "form") {
      const fields = scr.fields || [];
      if (!fields.length) {
        return { ok: false, error: `La pantalla "${scr.title}" no tiene campos.` };
      }
      if (fields.length > LIMITS.maxFieldsPerScreen) {
        return {
          ok: false,
          error: `"${scr.title}": máximo ${LIMITS.maxFieldsPerScreen} campos por pantalla.`,
        };
      }
      for (let fi = 0; fi < fields.length; fi++) {
        const f = fields[fi];
        if (!String(f.label || "").trim()) {
          return { ok: false, error: `Campo ${fi + 1} en "${scr.title}": falta etiqueta.` };
        }
        const fname = slugify(f.name || f.label, `campo_${si}_${fi}`);
        if (usedNames.has(fname)) {
          return { ok: false, error: `Nombre de campo duplicado: "${fname}". Cambia una etiqueta.` };
        }
        usedNames.add(fname);
        if (f.type === "select" || f.type === "checkbox") {
          const opts = (f.options || []).map((o) => String(o).trim()).filter(Boolean);
          if (opts.length < 2) {
            return { ok: false, error: `"${f.label}" necesita al menos 2 opciones.` };
          }
        }
      }
    }
    if (scr.type === "message") {
      const hasBlocks = Array.isArray(scr.blocks) && scr.blocks.some((b) => {
        if (b.type === "richtext") return String(b.markdown || b.text || "").trim();
        if (b.type === "carousel") return (b.images || []).some((img) => img && (img.src || img.previewUrl));
        if (b.type === "link") return String(b.text || "").trim() && String(b.url || "").trim();
        return String(b.text || b.src || "").trim();
      });
      const hasLegacy = String(scr.body || scr.heading || "").trim() || (scr.image && scr.image.src);
      if (!hasBlocks && !hasLegacy) {
        return { ok: false, error: `La pantalla "${scr.title}" necesita contenido (texto o imagen).` };
      }
    }
  }

  const hasTerminal = screens.some((s) => s.type === "confirm")
    || (screens.length === 1 && screens[0].type === "form");
  if (!hasTerminal && !screens.some((s) => s.type === "confirm")) {
    const last = screens[screens.length - 1];
    if (last.type !== "form" && last.type !== "message") {
      return { ok: false, error: "Agrega una pantalla de confirmación final o un formulario único." };
    }
  }

  return { ok: true };
}

function buildFieldComponent(field, fieldName) {
  const label = String(field.label).trim();
  const required = Boolean(field.required);

  if (field.type === "select") {
    const opts = (field.options || []).map((o) => String(o).trim()).filter(Boolean);
    return {
      type: "Dropdown",
      name: fieldName,
      label,
      required,
      "data-source": opts.map((o, i) => ({ id: slugify(o, `opt_${i}`), title: o })),
    };
  }

  if (field.type === "yesno") {
    return {
      type: "RadioButtonsGroup",
      name: fieldName,
      label,
      required,
      "data-source": [
        { id: "si", title: "Sí" },
        { id: "no", title: "No" },
      ],
    };
  }

  if (field.type === "rating") {
    return {
      type: "RadioButtonsGroup",
      name: fieldName,
      label,
      required,
      "data-source": [1, 2, 3, 4, 5].map((n) => ({ id: String(n), title: String(n) })),
    };
  }

  if (field.type === "date") {
    return {
      type: "DatePicker",
      name: fieldName,
      label,
      required,
    };
  }

  if (field.type === "calendar") {
    return {
      type: "CalendarPicker",
      name: fieldName,
      label,
      required,
      mode: field.calendarMode === "range" ? "range" : "single",
    };
  }

  if (field.type === "optin") {
    return {
      type: "OptIn",
      name: fieldName,
      label,
      required,
    };
  }

  if (field.type === "checkbox") {
    const opts = (field.options || []).map((o) => String(o).trim()).filter(Boolean);
    const titles = opts.length >= 2 ? opts : ["Opción A", "Opción B"];
    return {
      type: "CheckboxGroup",
      name: fieldName,
      label,
      required,
      "data-source": titles.map((o, i) => ({ id: slugify(o, `chk_${i}`), title: o })),
    };
  }

  if (field.type === "textarea") {
    return {
      type: "TextArea",
      name: fieldName,
      label,
      required,
    };
  }

  const meta = FIELD_TYPES.find((t) => t.id === field.type) || FIELD_TYPES[0];
  return {
    type: "TextInput",
    name: fieldName,
    label,
    required,
    "input-type": meta.inputType || "text",
  };
}

function textBodyComponent(text, emphasis) {
  const body = { type: "TextBody", text: String(text).trim() };
  if (emphasis && emphasis !== "normal") body["font-weight"] = emphasis;
  return body;
}

function imageComponent(image) {
  if (!image || !image.src) return null;
  const block = {
    type: "Image",
    src: String(image.src).trim(),
    "alt-text": String(image.altText || "Imagen").trim(),
    "scale-type": image.scaleType === "cover" ? "cover" : "contain",
  };
  if (image.width) block.width = Number(image.width);
  if (image.height) block.height = Number(image.height);
  return block;
}

function layoutContentFromScreen(scr) {
  const children = [];
  const blocks = Array.isArray(scr.blocks) && scr.blocks.length ? scr.blocks : null;

  if (blocks) {
    blocks.forEach((b) => {
      if (b.type === "heading" && b.text) {
        children.push({ type: "TextHeading", text: String(b.text).trim() });
      } else if (b.type === "subheading" && b.text) {
        children.push({ type: "TextSubheading", text: String(b.text).trim() });
      } else if (b.type === "body" && b.text) {
        children.push(textBodyComponent(b.text, b.emphasis));
      } else if (b.type === "caption" && b.text) {
        const cap = { type: "TextCaption", text: String(b.text).trim() };
        if (b.emphasis && b.emphasis !== "normal") cap["font-weight"] = b.emphasis;
        children.push(cap);
      } else if (b.type === "image") {
        const img = imageComponent(b);
        if (img) children.push(img);
      } else if (b.type === "link") {
        const url = String(b.url || "").trim();
        const text = String(b.text || "Abrir enlace").trim();
        if (url) {
          children.push({
            type: "EmbeddedLink",
            text,
            "on-click-action": { name: "open_url", url },
          });
        }
      } else if (b.type === "richtext" && String(b.markdown || b.text || "").trim()) {
        children.push({ type: "RichText", text: String(b.markdown || b.text).trim() });
      } else if (b.type === "carousel") {
        const imgs = (b.images || []).map((img) => imageComponent(img)).filter(Boolean);
        if (imgs.length >= LIMITS.carouselMinImages) {
          children.push({
            type: "ImageCarousel",
            images: imgs,
            "scale-type": b.scaleType === "cover" ? "cover" : "contain",
          });
        } else if (imgs.length === 1) {
          children.push(imgs[0]);
        }
      }
    });
  } else {
    const heading = scr.heading || scr.introHeading;
    const body = scr.body || scr.introBody;
    if (heading) children.push({ type: "TextHeading", text: String(heading).trim() });
    if (body) children.push({ type: "TextBody", text: String(body).trim() });
    const img = imageComponent(scr.image);
    if (img) children.push(img);
  }

  if (scr.linkUrl) {
    children.push({
      type: "TextBody",
      text: `${scr.linkLabel || "Abrir enlace"}: ${String(scr.linkUrl).trim()}`,
    });
  }
  return children;
}

function navigateNext(nextScreenId) {
  return {
    name: "navigate",
    next: { type: "screen", name: nextScreenId },
  };
}

function completeAction(payload) {
  return { name: "complete", payload };
}

function screenIdAt(index) {
  const letter = String.fromCharCode(65 + (index % 26));
  return `SCREEN_${letter}`;
}

function resolveNextScreenId(scr, index, bodyScreens, screenIds, confirmId) {
  const target = scr.nextTarget;
  if (target === "complete") return null;
  if (target === "confirm" && confirmId) return confirmId;
  if (target != null && target !== "next" && target !== "") {
    const idx = Number(target);
    if (!Number.isNaN(idx) && idx >= 0 && idx < bodyScreens.length) {
      return screenIds[idx];
    }
  }
  const isLastBody = index === bodyScreens.length - 1;
  return isLastBody ? confirmId : screenIds[index + 1];
}

function buildFlowJson(definition) {
  const check = validateDefinition(definition);
  if (!check.ok) return check;

  const screensIn = definition.screens || [];
  const confirmIdx = screensIn.findIndex((s) => s.type === "confirm");
  const hasConfirm = confirmIdx >= 0;
  const confirmDef = hasConfirm ? screensIn[confirmIdx] : null;
  const bodyScreens = screensIn.filter((s) => s.type !== "confirm");

  if (!bodyScreens.length) {
    return { ok: false, error: "Agrega al menos una pantalla de contenido." };
  }

  const fieldRefs = [];
  const flowScreens = [];
  const routing = {};
  const screenIds = bodyScreens.map((_, i) => screenIdAt(i));
  const confirmId = hasConfirm ? "CONFIRM" : null;

  bodyScreens.forEach((scr, i) => {
    const screenId = screenIds[i];
    const nextId = resolveNextScreenId(scr, i, bodyScreens, screenIds, confirmId);
    const footerLabel = String(scr.footerLabel || (nextId ? "Continuar" : "Enviar")).trim();

    const layoutChildren = [];

    if (scr.type === "message") {
      layoutChildren.push(...layoutContentFromScreen(scr));
    } else if (scr.type === "form") {
      layoutChildren.push(...layoutContentFromScreen({
        blocks: scr.blocks,
        heading: scr.introHeading,
        body: scr.introBody,
        image: scr.image,
      }));

      const formFields = [];
      (scr.fields || []).forEach((f, fi) => {
        const fname = slugify(f.name || f.label, `campo_${i}_${fi}`);
        formFields.push(buildFieldComponent(f, fname));
        fieldRefs.push({
          key: fname,
          ref: `\${screen.${screenId}.form.${fname}}`,
        });
      });

      layoutChildren.push({
        type: "Form",
        name: "form",
        children: formFields,
      });
    }

    let footerAction;
    if (nextId) {
      footerAction = navigateNext(nextId);
    } else {
      const payload = {};
      fieldRefs.forEach((f) => { payload[f.key] = f.ref; });
      footerAction = completeAction(payload);
    }

    layoutChildren.push({
      type: "Footer",
      label: footerLabel,
      "on-click-action": footerAction,
    });

    flowScreens.push({
      id: screenId,
      title: String(scr.title).trim(),
      data: {},
      layout: {
        type: "SingleColumnLayout",
        children: layoutChildren,
      },
      ...(nextId ? {} : { terminal: true, success: true }),
    });

    routing[screenId] = nextId ? [nextId] : [];
  });

  if (confirmDef) {
    const payload = {};
    fieldRefs.forEach((f) => { payload[f.key] = f.ref; });

    const children = [];
    children.push(...layoutContentFromScreen(confirmDef));
    children.push({
      type: "Footer",
      label: String(confirmDef.footerLabel || "Cerrar").trim(),
      "on-click-action": completeAction(payload),
    });

    flowScreens.push({
      id: confirmId,
      title: String(confirmDef.title || "Confirmación").trim(),
      terminal: true,
      success: true,
      data: {},
      layout: {
        type: "SingleColumnLayout",
        children,
      },
    });
    routing[confirmId] = [];
  }

  const flowJson = {
    version: FLOW_VERSION,
    screens: flowScreens,
  };
  if (Object.keys(routing).length > 1 || (confirmId && bodyScreens.length > 0)) {
    flowJson.routing_model = routing;
  }

  return {
    ok: true,
    flowJson,
    firstScreenId: screenIds[0],
    defaultCta: String(definition.cta || "Abrir").trim(),
    fieldKeys: fieldRefs.map((f) => f.key),
  };
}

function getSchema() {
  return {
    version: FLOW_VERSION,
    fieldTypes: FIELD_TYPES,
    categories: CATEGORIES,
    metaCapabilities: META_CAPABILITIES,
    blockTypes: [
      { id: "heading", label: "Título grande" },
      { id: "subheading", label: "Subtítulo" },
      { id: "body", label: "Párrafo" },
      { id: "caption", label: "Texto pequeño" },
      { id: "image", label: "Imagen" },
      { id: "link", label: "Enlace" },
      { id: "richtext", label: "Texto enriquecido (Markdown)" },
      { id: "carousel", label: "Carrusel de imágenes" },
    ],
    screenTypes: [
      { id: "form", label: "Formulario", description: "Campos que el usuario completa." },
      { id: "message", label: "Mensaje", description: "Texto informativo o CTA antes de continuar." },
      { id: "confirm", label: "Confirmación", description: "Pantalla final de agradecimiento." },
    ],
    limits: LIMITS,
  };
}

module.exports = {
  buildFlowJson,
  validateDefinition,
  getSchema,
  FIELD_TYPES,
  CATEGORIES,
};
