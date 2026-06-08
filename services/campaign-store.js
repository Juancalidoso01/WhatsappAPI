"use strict";

const redis = require("./upstash");
const {
  initialRowStatus,
  applyVariableValues,
  rowHasRequiredVars,
} = require("./template-params");

const PREFIX = "wa:";
const memCampaigns = new Map();
const memRows = new Map();
const memWamids = new Map();

function newId() {
  return `cmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function rowKey(campaignId) {
  return `${PREFIX}campaign:${campaignId}:rows`;
}

function metaKey(campaignId) {
  return `${PREFIX}campaign:${campaignId}`;
}

function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

function defaultTotals() {
  return {
    total: 0,
    awaiting_vars: 0,
    ready: 0,
    pending: 0,
    sent: 0,
    delivered: 0,
    read: 0,
    failed: 0,
    skipped: 0,
  };
}

function totalsFromRows(rows) {
  const totals = defaultTotals();
  totals.total = rows.length;
  rows.forEach((r) => {
    const st = r.status || "pending";
    totals[st] = (totals[st] || 0) + 1;
  });
  return totals;
}

function bumpTotals(totals, from, to) {
  if (from && totals[from] > 0) totals[from]--;
  totals[to] = (totals[to] || 0) + 1;
}

function buildStoredRow(r, index, eventVariables) {
  const vars = r.vars || [];
  return {
    index,
    phone: normalizePhone(r.phone),
    name: r.name || "",
    externalId: r.externalId || null,
    vars,
    line: r.line || null,
    status: initialRowStatus(vars, eventVariables),
    wamid: null,
    error: null,
    sentAt: null,
    updatedAt: null,
  };
}

async function createCampaign({
  name,
  template,
  language,
  templateCategory,
  rows,
  varColumns,
  source = "csv",
  eventVariables = [],
}) {
  const id = newId();
  const now = Date.now();
  const evs = eventVariables || [];
  const storedRows = rows.map((r, index) => buildStoredRow(r, index, evs));
  const totals = totalsFromRows(storedRows);

  const meta = {
    id,
    name: name || `Carga ${new Date(now).toLocaleDateString("es")}`,
    template,
    language: language || "es",
    templateCategory: templateCategory || null,
    status: "draft",
    cursor: 0,
    source: source || "csv",
    createdAt: now,
    updatedAt: now,
    varColumns: JSON.stringify(varColumns || []),
    eventVariables: JSON.stringify(evs),
    totals: JSON.stringify(totals),
  };

  if (redis) {
    const ops = [
      redis.zadd(`${PREFIX}campaigns`, { score: now, member: id }),
      redis.hset(metaKey(id), meta),
    ];
    if (storedRows.length) {
      ops.push(redis.rpush(rowKey(id), ...storedRows.map((r) => JSON.stringify(r))));
    }
    await Promise.all(ops);
  } else {
    memCampaigns.set(id, {
      ...meta,
      totals,
      eventVariables: evs,
      varColumns: varColumns || [],
    });
    memRows.set(id, storedRows);
  }

  return getCampaign(id);
}

function parseMeta(raw, id) {
  if (!raw || !Object.keys(raw).length) return null;
  let totals = defaultTotals();
  try { totals = { ...defaultTotals(), ...JSON.parse(raw.totals || "{}") }; } catch (_) {}
  let varColumns = [];
  try { varColumns = JSON.parse(raw.varColumns || "[]"); } catch (_) {}
  let eventVariables = [];
  try { eventVariables = JSON.parse(raw.eventVariables || "[]"); } catch (_) {}
  return {
    id,
    name: raw.name,
    template: raw.template,
    language: raw.language,
    templateCategory: raw.templateCategory || null,
    status: raw.status || "draft",
    cursor: Number(raw.cursor || 0),
    source: raw.source || "csv",
    createdAt: Number(raw.createdAt || 0),
    updatedAt: Number(raw.updatedAt || 0),
    pauseReason: raw.pauseReason || null,
    varColumns,
    eventVariables,
    totals,
  };
}

async function getCampaign(id) {
  if (redis) {
    const raw = await redis.hgetall(metaKey(id));
    const meta = parseMeta(raw, id);
    if (!meta) return null;
    return meta;
  }
  const raw = memCampaigns.get(id);
  if (!raw) return null;
  return parseMeta({ ...raw, totals: JSON.stringify(raw.totals) }, id);
}

async function listCampaigns() {
  if (redis) {
    const ids = await redis.zrange(`${PREFIX}campaigns`, 0, -1, { rev: true });
    const list = await Promise.all((ids || []).map((id) => getCampaign(id)));
    return list.filter(Boolean);
  }
  return Array.from(memCampaigns.values())
    .map((c) => parseMeta({ ...c, totals: JSON.stringify(c.totals) }, c.id))
    .sort((a, b) => b.createdAt - a.createdAt);
}

async function getRows(campaignId, { offset = 0, limit = 100 } = {}) {
  if (redis) {
    const end = offset + limit - 1;
    const raw = await redis.lrange(rowKey(campaignId), offset, end);
    return (raw || []).map((r) => (typeof r === "string" ? JSON.parse(r) : r));
  }
  const rows = memRows.get(campaignId) || [];
  return rows.slice(offset, offset + limit);
}

async function getRow(campaignId, index) {
  if (redis) {
    const raw = await redis.lindex(rowKey(campaignId), index);
    return raw ? JSON.parse(raw) : null;
  }
  const rows = memRows.get(campaignId) || [];
  return rows[index] || null;
}

async function saveRow(campaignId, index, row) {
  if (redis) {
    await redis.lset(rowKey(campaignId), index, JSON.stringify(row));
    return;
  }
  const rows = memRows.get(campaignId) || [];
  rows[index] = row;
  memRows.set(campaignId, rows);
}

async function appendRows(campaignId, newRows) {
  if (redis) {
    if (newRows.length) {
      await redis.rpush(rowKey(campaignId), ...newRows.map((r) => JSON.stringify(r)));
    }
    return;
  }
  const rows = memRows.get(campaignId) || [];
  memRows.set(campaignId, rows.concat(newRows));
}

async function patchMeta(campaignId, fields) {
  const clean = {};
  Object.entries(fields).forEach(([k, v]) => {
    if (v != null) clean[k] = typeof v === "object" ? JSON.stringify(v) : String(v);
  });
  if (!Object.keys(clean).length) return;
  clean.updatedAt = String(Date.now());

  if (redis) {
    await redis.hset(metaKey(campaignId), clean);
    return;
  }
  const m = memCampaigns.get(campaignId);
  if (!m) return;
  Object.assign(m, fields);
  if (fields.totals) m.totals = fields.totals;
  if (fields.eventVariables) m.eventVariables = fields.eventVariables;
  m.updatedAt = Date.now();
}

async function recalcTotals(campaignId) {
  const rows = await exportRows(campaignId);
  const totals = totalsFromRows(rows);
  await patchMeta(campaignId, { totals });
  return totals;
}

async function setCampaignStatus(campaignId, status, extra = {}) {
  await patchMeta(campaignId, { status, ...extra });
}

const STATUS_ORDER = {
  awaiting_vars: 0,
  ready: 1,
  pending: 2,
  sent: 3,
  delivered: 4,
  read: 5,
  failed: 9,
  skipped: 9,
};

async function updateRowStatus(campaignId, index, status, extra = {}) {
  const row = await getRow(campaignId, index);
  if (!row) return null;
  const prev = row.status;
  if (prev === status) return row;

  const terminal = new Set(["delivered", "read", "failed", "skipped"]);
  if (terminal.has(prev) && status !== "failed") return row;

  if ((STATUS_ORDER[status] || 0) < (STATUS_ORDER[prev] || 0) && !["pending", "awaiting_vars", "ready"].includes(prev)) {
    return row;
  }

  row.status = status;
  row.updatedAt = Date.now();
  if (extra.error) row.error = extra.error;
  if (extra.wamid) row.wamid = extra.wamid;
  if (extra.sentAt) row.sentAt = extra.sentAt;
  await saveRow(campaignId, index, row);

  const meta = await getCampaign(campaignId);
  if (meta && meta.totals) {
    const totals = { ...meta.totals };
    bumpTotals(totals, prev, status);
    await patchMeta(campaignId, { totals });
  }
  return row;
}

async function findRow(campaignId, { phone, externalId } = {}) {
  const rows = await exportRows(campaignId);
  const norm = phone ? normalizePhone(phone) : null;
  return rows.find((r) => {
    if (externalId && r.externalId === externalId) return true;
    if (norm && normalizePhone(r.phone) === norm) return true;
    return false;
  }) || null;
}

async function addRecipients(campaignId, recipients) {
  const campaign = await getCampaign(campaignId);
  if (!campaign) return { ok: false, error: "Campaña no encontrada." };

  const existing = await exportRows(campaignId);
  const startIndex = existing.length;
  const evs = campaign.eventVariables || [];
  const added = [];

  for (const rec of recipients) {
    const phone = normalizePhone(rec.phone);
    if (!phone) continue;
    const dup = existing.find((r) => normalizePhone(r.phone) === phone
      || (rec.externalId && r.externalId === rec.externalId));
    if (dup) continue;

    const vars = applyVariableValues(evs, rec.variables || rec.vars || []);
    const row = buildStoredRow({ ...rec, phone, vars }, startIndex + added.length, evs);
    added.push(row);
    existing.push(row);
  }

  if (!added.length) return { ok: true, added: 0 };

  await appendRows(campaignId, added);
  await recalcTotals(campaignId);
  return { ok: true, added: added.length };
}

async function applyVariableEvents(campaignId, events) {
  const campaign = await getCampaign(campaignId);
  if (!campaign) return { ok: false, error: "Campaña no encontrada." };

  const evs = campaign.eventVariables || [];
  const results = [];

  for (const event of events) {
    const row = await findRow(campaignId, event);
    if (!row) {
      results.push({
        phone: event.phone,
        externalId: event.externalId,
        ok: false,
        error: "Destinatario no encontrado en la campaña.",
      });
      continue;
    }

    const terminal = new Set(["sent", "delivered", "read", "failed", "skipped"]);
    if (terminal.has(row.status)) {
      results.push({
        phone: row.phone,
        externalId: row.externalId,
        ok: false,
        error: `Fila ya en estado ${row.status}.`,
      });
      continue;
    }

    const vars = applyVariableValues(evs, event.variables || event.vars || {});
    const prev = row.status;
    const complete = rowHasRequiredVars(vars, evs);
    const nextStatus = complete ? "ready" : "awaiting_vars";

    row.vars = vars;
    row.updatedAt = Date.now();
    row.status = nextStatus;
    await saveRow(campaignId, row.index, row);

    if (prev !== nextStatus) {
      const meta = await getCampaign(campaignId);
      const totals = { ...meta.totals };
      bumpTotals(totals, prev, nextStatus);
      await patchMeta(campaignId, { totals });
    }

    results.push({
      phone: row.phone,
      externalId: row.externalId,
      ok: true,
      status: nextStatus,
      complete,
    });
  }

  return { ok: true, results, totals: (await getCampaign(campaignId)).totals };
}

async function promoteReadyToPending(campaignId) {
  const rows = await exportRows(campaignId);
  let promoted = 0;
  for (const row of rows) {
    if (row.status === "ready") {
      await updateRowStatus(campaignId, row.index, "pending");
      promoted++;
    }
  }
  return promoted;
}

async function bindWamid(wamid, campaignId, rowIndex) {
  const payload = JSON.stringify({ campaignId, rowIndex });
  if (redis) {
    await redis.set(`${PREFIX}wamid:${wamid}`, payload);
    return;
  }
  memWamids.set(wamid, { campaignId, rowIndex });
}

async function resolveWamid(wamid) {
  if (redis) {
    const raw = await redis.get(`${PREFIX}wamid:${wamid}`);
    return raw ? JSON.parse(raw) : null;
  }
  return memWamids.get(wamid) || null;
}

async function applyWebhookStatus(wamid, status) {
  const map = await resolveWamid(wamid);
  if (!map) return false;
  const mapped = { sent: "sent", delivered: "delivered", read: "read", failed: "failed" };
  const st = mapped[status];
  if (!st) return false;
  await updateRowStatus(map.campaignId, map.rowIndex, st);
  return true;
}

async function exportRows(campaignId) {
  if (redis) {
    const raw = await redis.lrange(rowKey(campaignId), 0, -1);
    return (raw || []).map((r) => (typeof r === "string" ? JSON.parse(r) : r));
  }
  return memRows.get(campaignId) || [];
}

module.exports = {
  createCampaign,
  getCampaign,
  listCampaigns,
  getRows,
  getRow,
  saveRow,
  patchMeta,
  setCampaignStatus,
  updateRowStatus,
  bindWamid,
  resolveWamid,
  applyWebhookStatus,
  exportRows,
  addRecipients,
  applyVariableEvents,
  promoteReadyToPending,
  findRow,
  recalcTotals,
  normalizePhone,
};
