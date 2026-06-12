"use strict";

const redis = require("./upstash");
const { parseRedisJson } = require("./redis-json");
const phoneMeta = require("./phone-meta");
const { estimateCost, categoryLabel } = require("./billing-rates");

const LIST_KEY = "wa:billing:ledger";
const PREFIX = "wa:billing:entry:";
const MAX_ENTRIES = 500;
const mem = [];

function kindLabel(kind) {
  const map = {
    template: "Plantilla",
    template_flow: "Plantilla + Flow",
    flow_interactive: "Flow interactivo",
    flow: "Flow",
    text: "Texto",
    media: "Multimedia",
    bulk: "Carga masiva",
  };
  return map[kind] || kind || "Mensaje";
}

function classifyFlowBilling(mode, inServiceWindow) {
  if (mode === "template_flow") {
    return {
      category: "UTILITY",
      isFree: false,
      billingNote: "Se factura como plantilla UTILITY al abrir la conversación.",
    };
  }
  if (inServiceWindow) {
    return {
      category: "SERVICE",
      isFree: true,
      billingNote: "Dentro de ventana 24 h: mensaje de servicio (sin cargo Meta).",
    };
  }
  return {
    category: "UTILITY",
    isFree: false,
    billingNote: "Flow interactivo fuera de 24 h: estimado como UTILITY (mensaje business-initiated).",
  };
}

async function record({
  phone,
  messageId = null,
  localMessageId = null,
  kind = "template",
  category = null,
  templateName = null,
  flowName = null,
  flowMode = null,
  flowId = null,
  preview = null,
  source = null,
  inServiceWindow = false,
  recipientName = null,
  status = "sent",
} = {}) {
  const normPhone = String(phone || "").replace(/\D/g, "");
  const country = phoneMeta.inferCountry(normPhone);
  let billingCategory = category ? String(category).toUpperCase() : null;
  let billingNote = null;
  let isFree = false;

  const flowKinds = new Set(["flow", "flow_interactive", "template_flow"]);
  if (flowKinds.has(kind) || flowMode) {
    const flowClass = classifyFlowBilling(flowMode || kind, inServiceWindow);
    billingCategory = billingCategory || flowClass.category;
    billingNote = flowClass.billingNote;
    isFree = flowClass.isFree;
  } else if (kind === "text" || kind === "media") {
    if (inServiceWindow) {
      billingCategory = "SERVICE";
      isFree = true;
      billingNote = "Respuesta dentro de ventana 24 h (gratis).";
    } else {
      billingCategory = billingCategory || "SERVICE";
      isFree = true;
      billingNote = "Mensaje de sesión; sin plantilla.";
    }
  } else {
    billingCategory = billingCategory || "UTILITY";
    billingNote = "Plantilla business-initiated; costo según categoría Meta.";
  }

  const estimatedCost = isFree ? 0 : estimateCost(country.code, billingCategory);
  const id = `bl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const row = {
    id,
    phone: normPhone,
    phoneFormatted: phoneMeta.formatPhone(normPhone),
    recipientName: recipientName || null,
    country: country.code,
    countryName: country.name,
    messageId,
    localMessageId,
    kind,
    kindLabel: kindLabel(kind),
    category: billingCategory,
    categoryLabel: categoryLabel(billingCategory),
    templateName,
    flowName,
    flowMode,
    flowId: flowId ? String(flowId) : null,
    preview: preview ? String(preview).slice(0, 240) : null,
    source: source || null,
    estimatedCost,
    isFree,
    billingNote,
    status,
    sentAt: Date.now(),
  };

  if (redis) {
    await Promise.all([
      redis.set(`${PREFIX}${id}`, JSON.stringify(row), { ex: 86400 * 120 }),
      redis.zadd(LIST_KEY, { score: row.sentAt, member: id }),
    ]);
    const count = await redis.zcard(LIST_KEY);
    if (count > MAX_ENTRIES) {
      const trim = await redis.zrange(LIST_KEY, 0, count - MAX_ENTRIES - 1);
      if (trim && trim.length) {
        await Promise.all([
          redis.zrem(LIST_KEY, ...trim),
          ...trim.map((mid) => redis.del(`${PREFIX}${mid}`)),
        ]);
      }
    }
  } else {
    mem.unshift(row);
    if (mem.length > MAX_ENTRIES) mem.length = MAX_ENTRIES;
  }
  return row;
}

async function list({ since = 0, limit = 100, country = null, category = null, kind = null } = {}) {
  let rows = [];
  if (redis) {
    const ids = await redis.zrange(LIST_KEY, 0, MAX_ENTRIES - 1, { rev: true });
    rows = await Promise.all((ids || []).map(async (id) => {
      const raw = await redis.get(`${PREFIX}${id}`);
      return parseRedisJson(raw);
    }));
    rows = rows.filter(Boolean);
  } else {
    rows = [...mem];
  }

  rows = rows.filter((r) => r.sentAt >= since);
  if (country) rows = rows.filter((r) => r.country === String(country).toUpperCase());
  if (category) rows = rows.filter((r) => r.category === String(category).toUpperCase());
  if (kind) rows = rows.filter((r) => r.kind === kind);

  return rows.slice(0, limit);
}

function groupByCountryCategory(rows) {
  const map = {};
  (rows || []).forEach((r) => {
    const cat = String(r.category || "UTILITY").toUpperCase();
    const cc = String(r.country || "OTHER").toUpperCase();
    const key = `${cc}|${cat}`;
    if (!map[key]) {
      map[key] = { items: [], count: 0, estimatedCost: 0, freeCount: 0, billableCount: 0 };
    }
    map[key].items.push(r);
    map[key].count += 1;
    map[key].estimatedCost += r.estimatedCost || 0;
    if (r.isFree) map[key].freeCount += 1;
    else map[key].billableCount += 1;
  });
  return map;
}

function summarizeLedgerAsMetaRows(ledgerRows) {
  const map = {};
  (ledgerRows || []).forEach((r) => {
    const cat = String(r.category || "UTILITY").toUpperCase();
    const cc = String(r.country || "OTHER").toUpperCase();
    const key = `${cc}|${cat}`;
    if (!map[key]) {
      map[key] = {
        country: cc,
        category: cat,
        volume: 0,
        cost: 0,
        fromLedger: true,
      };
    }
    map[key].volume += 1;
    map[key].cost += r.estimatedCost || 0;
  });
  return Object.values(map).sort((a, b) => b.cost - a.cost || b.volume - a.volume);
}

function enrichMetaRows(metaRows, ledgerRows) {
  const grouped = groupByCountryCategory(ledgerRows);
  return (metaRows || []).map((row) => {
    const cat = String(row.category || "").toUpperCase();
    const cc = String(row.country || "").toUpperCase();
    const key = `${cc}|${cat}`;
    const match = grouped[key] || { items: [], count: 0, estimatedCost: 0, freeCount: 0, billableCount: 0 };
    let costZeroReason = null;
    if (!row.cost) {
      if (cat === "SERVICE") {
        costZeroReason = "Categoría Servicio: respuestas dentro de la ventana de 24 h (sin cargo Meta).";
      } else {
        costZeroReason = "Costo 0 en Meta: número de prueba, sandbox o tráfico aún sin tarifa facturada.";
      }
    }
    return {
      ...row,
      category: cat,
      country: cc,
      source: row.fromLedger ? "portal_ledger" : "meta_pricing_analytics",
      sourceLabel: row.fromLedger ? "Punto Pago (estimado)" : "WhatsApp · pricing_analytics",
      portal: {
        matchCount: match.count,
        estimatedCost: match.estimatedCost,
        freeCount: match.freeCount,
        billableCount: match.billableCount,
        items: match.items.slice(0, 20),
      },
      costZeroReason,
    };
  });
}

function summarize(rows) {
  const out = {
    count: rows.length,
    estimatedCost: 0,
    freeCount: 0,
    billableCount: 0,
    byCategory: {},
    byKind: {},
    flow: {
      sends: 0,
      billableSends: 0,
      freeSends: 0,
      estimatedCost: 0,
      responsesNote: "Completar el Flow no genera cargo adicional en Meta.",
    },
  };

  rows.forEach((r) => {
    out.estimatedCost += r.estimatedCost || 0;
    if (r.isFree) out.freeCount += 1;
    else out.billableCount += 1;
    out.byCategory[r.category] = (out.byCategory[r.category] || 0) + (r.estimatedCost || 0);
    out.byKind[r.kind] = (out.byKind[r.kind] || 0) + 1;

    const isFlow = r.kind === "flow" || r.kind === "flow_interactive" || r.kind === "template_flow"
      || Boolean(r.flowName || r.flowId);
    if (isFlow) {
      out.flow.sends += 1;
      out.flow.estimatedCost += r.estimatedCost || 0;
      if (r.isFree) out.flow.freeSends += 1;
      else out.flow.billableSends += 1;
    }
  });

  return out;
}

module.exports = {
  record,
  list,
  summarize,
  summarizeLedgerAsMetaRows,
  enrichMetaRows,
  groupByCountryCategory,
  classifyFlowBilling,
  kindLabel,
};
