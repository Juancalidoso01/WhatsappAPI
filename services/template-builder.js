"use strict";

const PLACEHOLDER_RE = /\{\{\s*(\d+)\s*\}\}/g;
const VALID_PLACEHOLDER_RE = /\{\{\s*\d+\s*\}\}/g;
const FORBIDDEN_EXAMPLE_CHARS = /[#$%]/;
/** Mínimo de texto fijo (sin {{n}}) por cada variable — heurística Meta. */
const MIN_STATIC_CHARS_PER_VAR = 12;

const META_PLACEHOLDER_RULES = [
  "Usa solo parámetros posicionales: {{1}}, {{2}}, {{3}}… (números, sin nombres).",
  "Los placeholders deben ser consecutivos: no saltes de {{2}} a {{5}}.",
  "El mensaje no puede empezar ni terminar con un parámetro (sin «colgantes»).",
  "Cada variable necesita ejemplo; no uses #, $ ni % en los ejemplos.",
  "Evita demasiadas variables para poco texto: deja al menos ~12 caracteres fijos por cada {{n}}.",
  "El pie (footer) no admite variables. El encabezado admite como mucho {{1}}.",
];

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
        error: `Los placeholders deben ser consecutivos desde {{1}}. Tienes: {{${indexes.join("}}, {{")}}}.`,
      };
    }
  }
  return { ok: true, indexes };
}

function validatePlaceholderSyntax(text, fieldLabel) {
  const str = String(text || "");
  if (!str) return { ok: true };

  const errors = [];
  const malformed = [];
  const re = /\{\{([^}]*)\}\}/g;
  let m;
  while ((m = re.exec(str)) !== null) {
    if (!/^\s*\d+\s*$/.test(m[1])) malformed.push(m[0]);
  }
  if (malformed.length) {
    errors.push(
      `${fieldLabel}: formato inválido ${malformed.map((x) => `«${x}»`).join(", ")}. `
      + "Solo se permiten números: {{1}}, {{2}}…"
    );
  }

  const stripped = str.replace(VALID_PLACEHOLDER_RE, "");
  if (/\{\{|\}\}/.test(stripped)) {
    errors.push(`${fieldLabel}: hay llaves {{ }} desajustadas o incompletas.`);
  }
  if (/\{\s*\d+\s*\}/.test(str) && !VALID_PLACEHOLDER_RE.test(str)) {
    errors.push(`${fieldLabel}: usa doble llave {{1}}, no {1}.`);
  }

  return errors.length ? { ok: false, errors } : { ok: true };
}

function validateNoDanglingParams(text, fieldLabel) {
  const t = String(text || "").trim();
  if (!t) return { ok: true };
  if (/^\{\{\s*\d+\s*\}\}/.test(t)) {
    return { ok: false, error: `${fieldLabel} no puede comenzar con un parámetro ({{n}}).` };
  }
  if (/\{\{\s*\d+\s*\}\}\s*[.,!?;:]*\s*$/.test(t)) {
    return { ok: false, error: `${fieldLabel} no puede terminar con un parámetro colgante.` };
  }
  return { ok: true };
}

function validateParamDensity(text, paramCount, fieldLabel) {
  if (!paramCount) return { ok: true };
  const staticText = String(text || "").replace(VALID_PLACEHOLDER_RE, " ").replace(/\s+/g, " ").trim();
  const staticLen = displayLength(staticText);
  const need = paramCount * MIN_STATIC_CHARS_PER_VAR;
  if (staticLen < need) {
    return {
      ok: false,
      error: `${fieldLabel}: demasiados parámetros (${paramCount}) para el texto fijo (${staticLen} caracteres). `
        + `Meta suele rechazarlo. Añade más texto o reduce variables (mín. ~${MIN_STATIC_CHARS_PER_VAR} caracteres fijos por cada {{n}}).`,
    };
  }
  return { ok: true };
}

function validateVariableExamples(variables, indexes, fieldLabel) {
  const errors = [];
  (indexes || []).forEach((n) => {
    const v = (variables || [])[n - 1];
    const key = v && v.key ? String(v.key).trim() : "";
    const ex = v && v.example != null ? String(v.example).trim() : "";
    if (!key) errors.push(`${fieldLabel}: {{${n}}} necesita clave API.`);
    if (!ex) errors.push(`${fieldLabel}: {{${n}}} necesita ejemplo para Meta.`);
    else if (FORBIDDEN_EXAMPLE_CHARS.test(ex)) {
      errors.push(`${fieldLabel}: el ejemplo de {{${n}}} no puede contener #, $ ni %.`);
    }
  });
  return errors;
}

function validateTemplateDraft({ headerText = "", bodyText = "", footerText = "", variables = [] } = {}) {
  const errors = [];
  const warnings = [];

  if (footerText && extractPlaceholderIndexes(footerText).length) {
    errors.push("El pie (footer) no puede contener parámetros {{n}}.");
  }

  [
    { text: headerText, label: "Encabezado" },
    { text: bodyText, label: "Cuerpo" },
    { text: footerText, label: "Pie" },
  ].forEach(({ text, label }) => {
    const syn = validatePlaceholderSyntax(text, label);
    if (!syn.ok) errors.push(...(syn.errors || []));
    const hang = validateNoDanglingParams(text, label);
    if (!hang.ok) errors.push(hang.error);
  });

  const headerIndexes = extractPlaceholderIndexes(headerText);
  const bodyIndexes = extractPlaceholderIndexes(bodyText);

  if (headerIndexes.length > 1) {
    errors.push("El encabezado solo puede tener un placeholder ({{1}}).");
  }
  if (headerIndexes.length && headerIndexes[0] !== 1) {
    errors.push("El placeholder del encabezado debe ser {{1}}.");
  }

  const bodySeq = validateSequential(bodyIndexes);
  if (!bodySeq.ok) errors.push(bodySeq.error);

  const headerSeq = validateSequential(headerIndexes);
  if (!headerSeq.ok) errors.push(headerSeq.error);

  const densityBody = validateParamDensity(bodyText, bodyIndexes.length, "Cuerpo");
  if (!densityBody.ok) errors.push(densityBody.error);

  if (headerIndexes.length) {
    const densityHeader = validateParamDensity(headerText, headerIndexes.length, "Encabezado");
    if (!densityHeader.ok) errors.push(densityHeader.error);
    errors.push(...validateVariableExamples(variables, headerIndexes, "Encabezado"));
  }
  if (bodyIndexes.length) {
    errors.push(...validateVariableExamples(variables, bodyIndexes, "Cuerpo"));
  }

  const bodyLen = validateFieldLength(bodyText, "body");
  if (!bodyLen.ok) errors.push(bodyLen.error);
  if (headerText) {
    const hLen = validateFieldLength(headerText, "header");
    if (!hLen.ok) errors.push(hLen.error);
  }
  if (footerText) {
    const fLen = validateFieldLength(footerText, "footer");
    if (!fLen.ok) errors.push(fLen.error);
  }

  const bodySafe = utf8Safe(bodyText);
  if (!bodySafe.ok) errors.push(bodySafe.error);
  const emojiBody = validateEmojiCompatibility(bodyText);
  if (!emojiBody.ok) errors.push(emojiBody.error);
  else if (emojiBody.note) warnings.push(emojiBody.note);

  return { ok: errors.length === 0, errors, warnings, placeholderCount: bodyIndexes.length + headerIndexes.length };
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
  const draftCheck = validateTemplateDraft({ headerText, bodyText, footerText, variables });
  const errors = draftCheck.errors ? [...draftCheck.errors] : [];

  const headerIndexes = extractPlaceholderIndexes(headerText);
  const bodyIndexes = extractPlaceholderIndexes(bodyText);

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
  META_PLACEHOLDER_RULES,
  MIN_STATIC_CHARS_PER_VAR,
  extractPlaceholderIndexes,
  validateSequential,
  validateTemplateDraft,
  buildComponents,
  validateEmojiCompatibility,
  validateFieldLength,
  displayLength,
  utf8Safe,
};
