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
];

const CATEGORIES = [
  { id: "OTHER", label: "Otro" },
  { id: "LEAD_GENERATION", label: "Generación de leads" },
  { id: "SURVEY", label: "Encuesta" },
  { id: "SIGN_UP", label: "Registro" },
  { id: "CUSTOMER_SUPPORT", label: "Soporte" },
];

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
    if (scr.type === "form") {
      const fields = scr.fields || [];
      if (!fields.length) {
        return { ok: false, error: `La pantalla "${scr.title}" no tiene campos.` };
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
        if (f.type === "select") {
          const opts = (f.options || []).map((o) => String(o).trim()).filter(Boolean);
          if (opts.length < 2) {
            return { ok: false, error: `"${f.label}" necesita al menos 2 opciones.` };
          }
        }
      }
    }
    if (scr.type === "message" && !String(scr.body || scr.heading || "").trim()) {
      return { ok: false, error: `La pantalla "${scr.title}" necesita un mensaje o título.` };
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

function navigateNext(nextScreenId) {
  return {
    name: "navigate",
    next: { type: "screen", name: nextScreenId },
  };
}

function completeAction(payload) {
  return { name: "complete", payload };
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
  const screenIds = bodyScreens.map((_, i) => `SCREEN_${i + 1}`);
  const confirmId = hasConfirm ? "CONFIRM" : null;

  bodyScreens.forEach((scr, i) => {
    const screenId = screenIds[i];
    const isLastBody = i === bodyScreens.length - 1;
    const nextId = isLastBody ? confirmId : screenIds[i + 1];
    const footerLabel = String(scr.footerLabel || (isLastBody && !confirmId ? "Enviar" : "Continuar")).trim();

    const layoutChildren = [];

    if (scr.type === "message") {
      if (scr.heading) layoutChildren.push({ type: "TextHeading", text: String(scr.heading).trim() });
      if (scr.body) layoutChildren.push({ type: "TextBody", text: String(scr.body).trim() });
      if (scr.linkUrl) {
        layoutChildren.push({
          type: "TextBody",
          text: `${scr.linkLabel || "Abrir enlace"}: ${String(scr.linkUrl).trim()}`,
        });
      }
    } else if (scr.type === "form") {
      if (scr.introHeading) layoutChildren.push({ type: "TextHeading", text: String(scr.introHeading).trim() });
      if (scr.introBody) layoutChildren.push({ type: "TextBody", text: String(scr.introBody).trim() });

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
      terminal: !nextId,
      success: !nextId,
      data: {},
      layout: {
        type: "SingleColumnLayout",
        children: layoutChildren,
      },
    });

    routing[screenId] = nextId ? [nextId] : [];
  });

  if (confirmDef) {
    const payload = {};
    fieldRefs.forEach((f) => { payload[f.key] = f.ref; });

    const children = [];
    if (confirmDef.heading) children.push({ type: "TextHeading", text: String(confirmDef.heading).trim() });
    if (confirmDef.body) children.push({ type: "TextBody", text: String(confirmDef.body).trim() });
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
    screenTypes: [
      { id: "form", label: "Formulario", description: "Campos que el usuario completa." },
      { id: "message", label: "Mensaje", description: "Texto informativo o CTA antes de continuar." },
      { id: "confirm", label: "Confirmación", description: "Pantalla final de agradecimiento." },
    ],
    limits: { maxScreens: 8, maxFieldsPerScreen: 12 },
  };
}

module.exports = {
  buildFlowJson,
  validateDefinition,
  getSchema,
  FIELD_TYPES,
  CATEGORIES,
};
