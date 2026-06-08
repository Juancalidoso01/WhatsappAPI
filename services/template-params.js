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

function buildComponentsFromRow(template, row) {
  const vars = row.vars || [];
  let vi = 0;
  const comps = [];
  const hs = headerSpec(template);

  if (hs && hs.kind === "text") {
    const text = vars[vi++];
    if (text) comps.push({ type: "header", parameters: [{ type: "text", text }] });
  }

  const n = bodyVarCount(template);
  if (n > 0) {
    const params = [];
    for (let i = 0; i < n; i++) params.push({ type: "text", text: vars[vi++] || "" });
    comps.push({ type: "body", parameters: params });
  }

  return comps;
}

function validateRowsForTemplate(template, rows) {
  const need = requiredVarCount(template);
  const hs = headerSpec(template);
  if (hs && hs.kind === "media") {
    return { ok: false, error: "Plantillas con encabezado multimedia no están soportadas en cargas masivas (fase 1)." };
  }
  const bad = rows.find((r) => (r.vars || []).filter(Boolean).length < need);
  if (bad && need > 0) {
    return { ok: false, error: `Fila ${bad.line}: faltan variables (se requieren ${need} columnas de datos).` };
  }
  return { ok: true, requiredVars: need };
}

module.exports = {
  bodyVarCount,
  headerSpec,
  requiredVarCount,
  buildComponentsFromRow,
  validateRowsForTemplate,
};
