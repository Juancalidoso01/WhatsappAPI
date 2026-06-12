"use strict";

const redis = require("./upstash");

const RULES_KEY = "wa:automation:rules";
const SETTINGS_KEY = "wa:automation:settings";
const LOG_KEY = "wa:automation:log";
const MAX_LOG = 80;

const mem = {
  rules: [],
  enabled: false,
  log: [],
};

const CONDITION_TYPES = new Set([
  "any",
  "contains",
  "equals",
  "starts_with",
  "message_type",
  "first_inbound",
]);

const ACTION_TYPES = new Set([
  "reply_text",
  "reply_template",
  "reply_buttons",
  "archive",
  "add_note",
]);

function newId() {
  return `rule_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeCondition(c) {
  const type = CONDITION_TYPES.has(c && c.type) ? c.type : "contains";
  const out = { type };
  if (type === "message_type") {
    out.value = String(c.value || "text").toLowerCase();
  } else if (type !== "any" && type !== "first_inbound") {
    out.value = String(c.value || "").trim();
    if (!out.value && type !== "any") return null;
    if (c.caseInsensitive !== false) out.caseInsensitive = true;
  }
  return out;
}

function sanitizeAction(a) {
  const type = ACTION_TYPES.has(a && a.type) ? a.type : "reply_text";
  const out = { type };
  if (type === "reply_text") {
    out.text = String(a.text || "").trim();
    if (!out.text) return null;
  } else if (type === "reply_template") {
    out.template = String(a.template || "").trim();
    out.language = String(a.language || "es").trim() || "es";
    if (!out.template) return null;
  } else if (type === "reply_buttons") {
    out.body = String(a.body || "").trim();
    out.buttons = (a.buttons || [])
      .map((b) => ({ title: String(b.title || b.label || "").trim() }))
      .filter((b) => b.title)
      .slice(0, 3);
    if (!out.body || !out.buttons.length) return null;
  } else if (type === "add_note") {
    out.note = String(a.note || "").trim();
    if (!out.note) return null;
  }
  return out;
}

function sanitizeRule(input, existing) {
  const conditions = (input.conditions || [])
    .map(sanitizeCondition)
    .filter(Boolean);
  const actions = (input.actions || [])
    .map(sanitizeAction)
    .filter(Boolean);

  if (!conditions.length) throw new Error("Agrega al menos una condición.");
  if (!actions.length) throw new Error("Agrega al menos una acción.");

  const now = Date.now();
  return {
    id: (existing && existing.id) || newId(),
    name: String(input.name || (existing && existing.name) || "Regla sin nombre").trim().slice(0, 120),
    enabled: input.enabled != null ? Boolean(input.enabled) : (existing ? existing.enabled : true),
    stopOnMatch: input.stopOnMatch != null ? Boolean(input.stopOnMatch) : (existing ? existing.stopOnMatch : true),
    order: Number.isFinite(Number(input.order)) ? Number(input.order) : (existing ? existing.order : now),
    conditions,
    actions,
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now,
  };
}

async function readRules() {
  if (redis) {
    const raw = await redis.get(RULES_KEY);
    if (!raw) return [];
    try {
      const list = typeof raw === "string" ? JSON.parse(raw) : raw;
      return Array.isArray(list) ? list : [];
    } catch (_) {
      return [];
    }
  }
  return mem.rules.slice();
}

async function writeRules(rules) {
  const sorted = [...rules].sort((a, b) => a.order - b.order);
  if (redis) {
    await redis.set(RULES_KEY, JSON.stringify(sorted));
    return sorted;
  }
  mem.rules = sorted;
  return sorted;
}

async function getSettings() {
  if (redis) {
    const raw = await redis.hgetall(SETTINGS_KEY);
    return { enabled: raw && raw.enabled === "1" };
  }
  return { enabled: mem.enabled };
}

async function setSettings(patch) {
  const enabled = Boolean(patch && patch.enabled);
  if (redis) {
    await redis.hset(SETTINGS_KEY, { enabled: enabled ? "1" : "0" });
  } else {
    mem.enabled = enabled;
  }
  return { enabled };
}

async function listRules() {
  const [rules, settings] = await Promise.all([readRules(), getSettings()]);
  return { rules, settings };
}

async function getRule(id) {
  const rules = await readRules();
  return rules.find((r) => r.id === id) || null;
}

async function createRule(input) {
  const rules = await readRules();
  const rule = sanitizeRule(input);
  rule.order = rules.length ? Math.max(...rules.map((r) => r.order)) + 10 : 10;
  rules.push(rule);
  await writeRules(rules);
  return rule;
}

async function updateRule(id, input) {
  const rules = await readRules();
  const idx = rules.findIndex((r) => r.id === id);
  if (idx < 0) return null;
  const rule = sanitizeRule({ ...rules[idx], ...input, conditions: input.conditions || rules[idx].conditions, actions: input.actions || rules[idx].actions }, rules[idx]);
  rules[idx] = rule;
  await writeRules(rules);
  return rule;
}

async function deleteRule(id) {
  const rules = await readRules();
  const next = rules.filter((r) => r.id !== id);
  if (next.length === rules.length) return false;
  await writeRules(next);
  return true;
}

async function appendLog(entry) {
  const row = {
    id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    at: Date.now(),
    ...entry,
  };
  if (redis) {
    const raw = await redis.get(LOG_KEY);
    let list = [];
    try { list = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : []; } catch (_) {}
    if (!Array.isArray(list)) list = [];
    list.unshift(row);
    if (list.length > MAX_LOG) list.length = MAX_LOG;
    await redis.set(LOG_KEY, JSON.stringify(list));
    return row;
  }
  mem.log.unshift(row);
  if (mem.log.length > MAX_LOG) mem.log.length = MAX_LOG;
  return row;
}

async function listLog(limit = 30) {
  const n = Math.min(MAX_LOG, Math.max(1, Number(limit) || 30));
  if (redis) {
    const raw = await redis.get(LOG_KEY);
    if (!raw) return [];
    try {
      const list = typeof raw === "string" ? JSON.parse(raw) : raw;
      return Array.isArray(list) ? list.slice(0, n) : [];
    } catch (_) {
      return [];
    }
  }
  return mem.log.slice(0, n);
}

module.exports = {
  CONDITION_TYPES: [...CONDITION_TYPES],
  ACTION_TYPES: [...ACTION_TYPES],
  listRules,
  getRule,
  createRule,
  updateRule,
  deleteRule,
  setSettings,
  appendLog,
  listLog,
};
