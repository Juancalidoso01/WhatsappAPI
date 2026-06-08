"use strict";

const PHONE_KEYS = new Set(["telefono", "teléfono", "phone", "numero", "número", "celular", "mobile", "wa_id"]);
const NAME_KEYS = new Set(["nombre", "name", "cliente", "contacto"]);

function normalizeHeader(h) {
  return String(h || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function parseCsv(text) {
  const lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { headers: [], rows: [], errors: ["El archivo está vacío."] };

  const parsed = lines.map(parseCsvLine);
  const headers = parsed[0].map(normalizeHeader);
  const phoneIdx = headers.findIndex((h) => PHONE_KEYS.has(h));
  if (phoneIdx < 0) {
    return { headers, rows: [], errors: ['Falta columna "telefono" (o phone / numero).'] };
  }
  const nameIdx = headers.findIndex((h) => NAME_KEYS.has(h));
  const varIndices = headers
    .map((h, i) => ({ h, i }))
    .filter(({ h, i }) => i !== phoneIdx && i !== nameIdx && h)
    .map(({ i }) => i);

  const rows = [];
  const errors = [];

  for (let r = 1; r < parsed.length; r++) {
    const cells = parsed[r];
    const phone = String(cells[phoneIdx] || "").replace(/\D/g, "");
    if (!phone) {
      errors.push(`Fila ${r + 1}: teléfono vacío.`);
      continue;
    }
    if (phone.length < 8 || phone.length > 15) {
      errors.push(`Fila ${r + 1}: teléfono inválido (${phone}).`);
      continue;
    }
    const name = nameIdx >= 0 ? String(cells[nameIdx] || "").trim() : "";
    const vars = varIndices.map((i) => String(cells[i] || "").trim());
    rows.push({ phone, name, vars, line: r + 1 });
  }

  return { headers, rows, errors, varColumns: varIndices.map((i) => headers[i]) };
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
      continue;
    }
    if ((ch === "," || ch === ";") && !inQuotes) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

module.exports = { parseCsv, PHONE_KEYS, NAME_KEYS };
