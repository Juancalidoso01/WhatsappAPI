"use strict";

const PLACEHOLDER_RE = /\{\{\s*(\d+)\s*\}\}/g;

const LIMITS = {
  header: 60,
  body: 1024,
  footer: 60,
};

const COMMON_EMOJIS = [
  "👋", "✅", "❌", "📅", "💰", "🔔", "📱", "⏰", "🎉", "📦",
  "🛒", "💳", "📍", "✉️", "⚠️", "ℹ️", "🙏", "😊", "👍", "🚀",
];

function extractPlaceholderIndexes(text) {
  const found = [];
  const re = new RegExp(PLACEHOLDER_RE.source, "g");
  let m;
  while ((m = re.exec(String(text || ""))) !== null) {
    found.push(Number(m[1]));
  }
  return [...new Set(found)].sort((a, b) => a - b);
}

function validateSequential(indexes) {
  if (!indexes.length) return { ok: true, indexes: [] };
  for (let i = 0; i < indexes.length; i++) {
    if (indexes[i] !== i + 1) {
      return {
        ok: false,
        error: `Los placeholders deben ser consecutivos desde {{1}}. Falta o sobra: {{${indexes.join("}}, {{")}}}.`,
      };
    }
  }
  return { ok: true, indexes };
}

function orderedExamples(text, variables) {
  const indexes = extractPlaceholderIndexes(text);
  const check = validateSequential(indexes);
  if (!check.ok) return check;

  const byIndex = {};
  (variables || []).forEach((v, i) => {
    byIndex[i + 1] = v;
  });

  const examples = indexes.map((n) => {
    const v = byIndex[n];
    const ex = v && v.example != null ? String(v.example).trim() : "";
    return ex || `ejemplo_${n}`;
  });

  return { ok: true, indexes, examples };
}

function utf8Safe(text) {
  try {
    const encoded = Buffer.from(String(text), "utf8").toString("utf8");
    if (encoded !== String(text)) return { ok: false, error: "El texto contiene caracteres no válidos en UTF-8." };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: "El texto contiene caracteres no válidos en UTF-8." };
  }
}

/** Approximate grapheme length (emojis count as 1). */
function displayLength(text) {
  if (typeof Intl !== "undefined" && Intl.Segmenter) {
    const seg = new Intl.Segmenter("es", { granularity: "grapheme" });
    return [...seg.segment(String(text || ""))].length;
  }
  return [...String(text || "")].length;
}

function validateEmojiCompatibility(text) {
  const safe = utf8Safe(text);
  if (!safe.ok) return safe;
  const str = String(text || "");
  const broken = str.match(/\uFFFD/g);
  if (broken) return { ok: false, error: "Hay emojis o símbolos incompatibles en el texto." };
  return { ok: true, note: "WhatsApp admite emojis Unicode estándar en plantillas. Meta puede revisar plantillas con muchos emojis." };
}

function validateFieldLength(text, field) {
  const max = LIMITS[field];
  if (!max) return { ok: true };
  const len = displayLength(text);
  if (len > max) {
    return { ok: false, error: `El ${field} supera ${max} caracteres (tiene ${len}). Los emojis cuentan como un carácter.` };
  }
  return { ok: true, length: len, max };
}

function buildComponents({ headerText, bodyText, footerText, variables, headerHasVar }) {
  const components = [];
  const errors = [];

  const bodySafe = utf8Safe(bodyText);
  if (!bodySafe.ok) errors.push(bodySafe.error);

  const bodyLen = validateFieldLength(bodyText, "body");
  if (!bodyLen.ok) errors.push(bodyLen.error);

  const headerIndexes = extractPlaceholderIndexes(headerText);
  const bodyIndexes = extractPlaceholderIndexes(bodyText);

  if (headerIndexes.length > 1) {
    errors.push("El encabezado solo puede tener un placeholder ({{1}}).");
  }
  if (headerIndexes.length && headerIndexes[0] !== 1) {
    errors.push("El placeholder del encabezado debe ser {{1}}.");
  }

  const bodyCheck = validateSequential(bodyIndexes);
  if (!bodyCheck.ok) errors.push(bodyCheck.error);

  if (headerText) {
    const hLen = validateFieldLength(headerText, "header");
    if (!hLen.ok) errors.push(hLen.error);
    const headerComp = { type: "HEADER", format: "TEXT", text: headerText };
    if (headerIndexes.length) {
      const ex = orderedExamples(headerText, variables);
      if (!ex.ok) errors.push(ex.error);
      else headerComp.example = { header_text: [ex.examples[0] || "Ejemplo"] };
    }
    components.push(headerComp);
  }

  const bodyComp = { type: "BODY", text: bodyText };
  if (bodyIndexes.length) {
    const ex = orderedExamples(bodyText, variables);
    if (!ex.ok) errors.push(ex.error);
    else bodyComp.example = { body_text: [ex.examples] };
  }
  components.push(bodyComp);

  if (footerText) {
    const fLen = validateFieldLength(footerText, "footer");
    if (!fLen.ok) errors.push(fLen.error);
    const emojiCheck = validateEmojiCompatibility(footerText);
    if (!emojiCheck.ok) errors.push(emojiCheck.error);
    components.push({ type: "FOOTER", text: footerText });
  }

  const emojiBody = validateEmojiCompatibility(bodyText);
  if (!emojiBody.ok) errors.push(emojiBody.error);

  if (errors.length) return { ok: false, errors };

  const eventVariableKeys = (variables || [])
    .filter((v) => v && v.key)
    .map((v) => String(v.key).trim().toLowerCase().replace(/[^a-z0-9_]/g, "_"))
    .filter(Boolean);

  return {
    ok: true,
    components,
    eventVariableKeys,
    placeholderCount: bodyIndexes.length + headerIndexes.length,
    emojiNote: emojiBody.note,
  };
}

module.exports = {
  LIMITS,
  COMMON_EMOJIS,
  extractPlaceholderIndexes,
  validateSequential,
  buildComponents,
  validateEmojiCompatibility,
  validateFieldLength,
  displayLength,
  utf8Safe,
};
