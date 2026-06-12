"use strict";

const LIMITS = {
  body: 1024,
  footer: 60,
  buttonTitle: 20,
  buttonId: 256,
  listButton: 20,
  sectionTitle: 24,
  rowTitle: 24,
  rowDescription: 72,
  rowId: 200,
  maxButtons: 3,
  maxRows: 10,
};

function slugId(prefix, title, index) {
  const base = String(title || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
  return `${prefix}_${index}_${base || "opt"}`.slice(0, LIMITS.rowId);
}

function normalizeButtons(buttons) {
  return (buttons || [])
    .map((b, i) => {
      const title = String(b.title || b.label || "").trim();
      if (!title) return null;
      const id = String(b.id || "").trim() || slugId("btn", title, i + 1);
      return {
        id: id.slice(0, LIMITS.buttonId),
        title: title.slice(0, LIMITS.buttonTitle),
      };
    })
    .filter(Boolean)
    .slice(0, LIMITS.maxButtons);
}

function normalizeSections(sections) {
  const rows = [];
  (sections || []).forEach((sec, si) => {
    const sectionTitle = String(sec.title || "").trim().slice(0, LIMITS.sectionTitle);
    (sec.rows || []).forEach((row, ri) => {
      const title = String(row.title || "").trim();
      if (!title) return;
      const id = String(row.id || "").trim() || slugId("row", title, rows.length + 1);
      rows.push({
        sectionTitle: sectionTitle || null,
        sectionIndex: si,
        id: id.slice(0, LIMITS.rowId),
        title: title.slice(0, LIMITS.rowTitle),
        description: String(row.description || "").trim().slice(0, LIMITS.rowDescription) || undefined,
      });
    });
  });

  const grouped = [];
  let currentKey = null;
  rows.slice(0, LIMITS.maxRows).forEach((r) => {
    const key = r.sectionTitle || "";
    let sec = grouped.find((s) => s._key === key);
    if (!sec) {
      sec = { title: r.sectionTitle || undefined, _key: key, rows: [] };
      grouped.push(sec);
    }
    sec.rows.push({
      id: r.id,
      title: r.title,
      description: r.description,
    });
  });

  return grouped.map(({ title, rows: secRows }) => ({
    title,
    rows: secRows,
  }));
}

function validateButtonsPayload({ body, footer, buttons }) {
  const errors = [];
  const text = String(body || "").trim();
  if (!text) errors.push("El mensaje es obligatorio.");
  if (text.length > LIMITS.body) errors.push(`El mensaje no puede superar ${LIMITS.body} caracteres.`);
  if (footer && String(footer).length > LIMITS.footer) {
    errors.push(`El pie no puede superar ${LIMITS.footer} caracteres.`);
  }
  const normalized = normalizeButtons(buttons);
  if (!normalized.length) errors.push("Agrega al menos un botón.");
  if (normalized.length > LIMITS.maxButtons) errors.push(`Máximo ${LIMITS.maxButtons} botones.`);
  normalized.forEach((b, i) => {
    if (!b.title) errors.push(`Botón ${i + 1}: falta el texto.`);
  });
  return { ok: !errors.length, errors, normalized, body: text, footer: footer ? String(footer).trim().slice(0, LIMITS.footer) : "" };
}

function validateListPayload({ body, footer, listButton, sections }) {
  const errors = [];
  const text = String(body || "").trim();
  if (!text) errors.push("El mensaje es obligatorio.");
  if (text.length > LIMITS.body) errors.push(`El mensaje no puede superar ${LIMITS.body} caracteres.`);
  if (footer && String(footer).length > LIMITS.footer) {
    errors.push(`El pie no puede superar ${LIMITS.footer} caracteres.`);
  }
  const button = String(listButton || "").trim();
  if (!button) errors.push("Indica el texto del botón que abre la lista.");
  if (button.length > LIMITS.listButton) {
    errors.push(`El botón de lista no puede superar ${LIMITS.listButton} caracteres.`);
  }
  const normalizedSections = normalizeSections(sections);
  const rowCount = normalizedSections.reduce((n, s) => n + s.rows.length, 0);
  if (!rowCount) errors.push("Agrega al menos una opción a la lista.");
  if (rowCount > LIMITS.maxRows) errors.push(`Máximo ${LIMITS.maxRows} opciones en total.`);
  return {
    ok: !errors.length,
    errors,
    normalizedSections,
    body: text,
    footer: footer ? String(footer).trim().slice(0, LIMITS.footer) : "",
    listButton: button.slice(0, LIMITS.listButton),
  };
}

function buildOutboundInteractiveMeta(variant, data) {
  if (variant === "buttons") {
    return {
      kind: "buttons",
      body: data.body,
      footer: data.footer || undefined,
      buttons: data.normalized,
    };
  }
  return {
    kind: "list",
    body: data.body,
    footer: data.footer || undefined,
    button: data.listButton,
    sections: data.normalizedSections,
  };
}

module.exports = {
  LIMITS,
  normalizeButtons,
  normalizeSections,
  validateButtonsPayload,
  validateListPayload,
  buildOutboundInteractiveMeta,
};
