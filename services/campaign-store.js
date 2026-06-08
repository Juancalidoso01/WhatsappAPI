"use strict";

const redis = require("./upstash");

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

function defaultTotals() {
  return { total: 0, pending: 0, sent: 0, delivered: 0, read: 0, failed: 0, skipped: 0 };
}

function bumpTotals(totals, from, to) {
  if (from && totals[from] > 0) totals[from]--;
  totals[to] = (totals[to] || 0) + 1;
}

async function createCampaign({
  name, template, language, templateCategory, rows, varColumns,
}) {
  const id = newId();
  const now = Date.now();
  const meta = {
    id,
    name: name || `Carga ${new Date(now).toLocaleDateString("es")}`,
    template,
    language: language || "es",
    templateCategory: templateCategory || null,
    status: "draft",
    cursor: 0,
    createdAt: now,
    updatedAt: now,
    varColumns: JSON.stringify(varColumns || []),
    totals: JSON.stringify({ ...defaultTotals(), total: rows.length, pending: rows.length }),
  };

  const storedRows = rows.map((r, index) => ({
    index,
    phone: r.phone,
    name: r.name || "",
    vars: r.vars || [],
    line: r.line,
    status: "pending",
    wamid: null,
    error: null,
    sentAt: null,
    updatedAt: null,
  }));

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
    memCampaigns.set(id, { ...meta, totals: JSON.parse(meta.totals) });
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
  return {
    id,
    name: raw.name,
    template: raw.template,
    language: raw.language,
    templateCategory: raw.templateCategory || null,
    status: raw.status || "draft",
    cursor: Number(raw.cursor || 0),
    createdAt: Number(raw.createdAt || 0),
    updatedAt: Number(raw.updatedAt || 0),
    pauseReason: raw.pauseReason || null,
    varColumns,
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
  m.updatedAt = Date.now();
}

async function setCampaignStatus(campaignId, status, extra = {}) {
  await patchMeta(campaignId, { status, ...extra });
}

async function updateRowStatus(campaignId, index, status, extra = {}) {
  const row = await getRow(campaignId, index);
  if (!row) return null;
  const prev = row.status;
  if (prev === status) return row;

  const terminal = new Set(["delivered", "read", "failed", "skipped"]);
  if (terminal.has(prev) && status !== "failed") return row;

  const order = { pending: 0, sent: 1, delivered: 2, read: 3, failed: 9, skipped: 9 };
  if ((order[status] || 0) < (order[prev] || 0) && prev !== "pending") return row;

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
};
