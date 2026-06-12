"use strict";

function bodyVarCount(t) {
  const b = (t.components || []).find((c) => String(c.type).toUpperCase() === "BODY");
  if (!b || !b.text) return 0;
  const m = b.text.match(/{{\s*\d+\s*}}/g);
  return m ? new Set(m.map((x) => x.replace(/[^0-9]/g, ""))).size : 0;
}

function headerSpec(t) {
  const h = (t.components || []).find((c) => String(c.type).toUpperCase() === "HEADER");
  if (!h) return null;
  if (h.format === "TEXT") return /{{\s*\d+\s*}}/.test(h.text || "") ? { kind: "text" } : null;
  if (["IMAGE", "VIDEO", "DOCUMENT"].includes(h.format)) return { kind: "media", format: h.format };
  return null;
}

function requiredVarCount(template) {
  let n = bodyVarCount(template);
  const hs = headerSpec(template);
  if (hs && hs.kind === "text") n += 1;
  return n;
}

/** Event variable slots for API / UI mapping (one per template placeholder). */
function extractEventVariables(template, customKeys) {
  const slots = [];
  const hs = headerSpec(template);
  const body = (template.components || []).find((c) => String(c.type).toUpperCase() === "BODY");
  let slotIndex = 0;

  if (hs && hs.kind === "text") {
    slots.push({
      key: (customKeys && customKeys[slotIndex]) || "header_1",
      index: slotIndex,
      component: "header",
      placeholder: "{{1}}",
      label: "Variable de encabezado",
      required: true,
    });
    slotIndex++;
  }

  if (hs && hs.kind === "media") {
    const fmt = String(hs.format || "IMAGE").toLowerCase();
    slots.push({
      key: (customKeys && customKeys[slotIndex]) || `header_${fmt}`,
      index: slotIndex,
      component: "header",
      placeholder: hs.format,
      label: `URL encabezado ${hs.format}`,
      required: true,
      mediaFormat: hs.format,
    });
    slotIndex++;
  }

  const n = bodyVarCount(template);
  for (let i = 1; i <= n; i++) {
    slots.push({
      key: (customKeys && customKeys[slotIndex]) || `body_${i}`,
      index: slotIndex,
      component: "body",
      placeholder: `{{${i}}}`,
      label: `Variable cuerpo {{${i}}}`,
      required: true,
      bodyText: body && body.text ? body.text : null,
    });
    slotIndex++;
  }

  return slots;
}

function applyVariableValues(eventVariables, values) {
  const vars = new Array(eventVariables.length).fill("");
  if (Array.isArray(values)) {
    values.forEach((v, i) => { if (i < vars.length) vars[i] = String(v ?? ""); });
    return vars;
  }
  if (values && typeof values === "object") {
    eventVariables.forEach((ev, i) => {
      if (values[ev.key] != null) vars[i] = String(values[ev.key]);
    });
  }
  return vars;
}

function rowHasRequiredVars(vars, eventVariables) {
  const required = eventVariables.filter((e) => e.required !== false);
  if (!required.length) return true;
  return required.every((ev) => {
    const v = vars[ev.index];
    return v != null && String(v).trim() !== "";
  });
}

function buildComponentsFromRow(template, row) {
  const vars = row.vars || [];
  let vi = 0;
  const comps = [];
  const hs = headerSpec(template);

  if (hs && hs.kind === "text") {
    const text = vars[vi++];
    if (text) comps.push({ type: "header", parameters: [{ type: "text", text }] });
  }

  if (hs && hs.kind === "media") {
    const url = vars[vi++];
    if (url) {
      const k = String(hs.format || "IMAGE").toLowerCase();
      comps.push({ type: "header", parameters: [{ type: k, [k]: { link: url } }] });
    }
  }

  const n = bodyVarCount(template);
  if (n > 0) {
    const params = [];
    for (let i = 0; i < n; i++) params.push({ type: "text", text: vars[vi++] || "" });
    comps.push({ type: "body", parameters: params });
  }

  return comps;
}

function validateRowsForTemplate(template, rows, eventVariables) {
  const need = eventVariables ? eventVariables.filter((e) => e.required !== false).length : requiredVarCount(template);
  const hs = headerSpec(template);
  if (hs && hs.kind === "media") {
    const evs = eventVariables || extractEventVariables(template);
    const headerSlot = evs.find((e) => e.component === "header");
    const badMedia = rows.find((r) => {
      const v = headerSlot != null ? (r.vars || [])[headerSlot.index] : (r.vars || [])[0];
      return !v || !String(v).trim().startsWith("http");
    });
    if (badMedia) {
      return {
        ok: false,
        error: `Fila ${badMedia.line || badMedia.phone}: falta URL https del encabezado ${hs.format}.`,
      };
    }
  }
  if (!need) return { ok: true, requiredVars: 0, eventVariables: extractEventVariables(template) };

  const bad = rows.find((r) => !rowHasRequiredVars(r.vars || [], eventVariables || extractEventVariables(template)));
  if (bad) {
    return { ok: false, error: `Fila ${bad.line || bad.phone}: faltan eventos variables requeridos.` };
  }
  return { ok: true, requiredVars: need, eventVariables: eventVariables || extractEventVariables(template) };
}

function initialRowStatus(vars, eventVariables) {
  if (!eventVariables || !eventVariables.length) return "pending";
  return rowHasRequiredVars(vars || [], eventVariables) ? "pending" : "awaiting_vars";
}

module.exports = {
  bodyVarCount,
  headerSpec,
  requiredVarCount,
  extractEventVariables,
  applyVariableValues,
  rowHasRequiredVars,
  buildComponentsFromRow,
  validateRowsForTemplate,
  initialRowStatus,
};
