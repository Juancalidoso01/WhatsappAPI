"use strict";

const redis = require("./upstash");

const RULES_KEY = "wa:automation:rules";
const SETTINGS_KEY = "wa:automation:settings";
const AI_KEY = "wa:automation:ai";
const LOG_KEY = "wa:automation:log";
const FAILED_KEY = "wa:automation:ai_failed";
const RES_LOG_KEY = "wa:automation:ai_res_log";
const MAX_LOG = 80;
const MAX_CORRECTIONS = 25;
const MAX_FAILED = 40;
const MAX_RES_LOG = 60;

const mem = {
  rules: [],
  enabled: false,
  ai: null,
  log: [],
  aiFailed: [],
  aiResLog: [],
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
  "reply_ai",
  "archive",
  "add_note",
]);

function defaultAiSettings() {
  return {
    enabled: false,
    fallbackEnabled: true,
    role: "Asistente virtual de Punto Pago",
    instructions: "",
    faqEnabled: true,
    faqAudience: "cliente",
    faqMaxArticles: 4,
    escalation: {
      keywords: ["agente", "humano", "persona", "operador", "representante", "hablar con alguien"],
      onLowConfidence: true,
      confidenceThreshold: 0.45,
      maxRepliesPerChat: 8,
      handoffMessage: "Te conecto con un agente de nuestro equipo. En breve te atenderán.",
    },
    corrections: [],
    resolution: {
      feedbackEnabled: true,
      feedbackPrompt: "¿Te ayudó esta respuesta?",
      feedbackYes: "Sí, gracias",
      feedbackNo: "Necesito más ayuda",
      thankYouMessage: "¡Me alegra haberte ayudado! Si necesitas algo más, escríbenos.",
      archiveOnConfirmed: false,
      inactivityMinutes: 4,
      assumedResolutionEnabled: true,
      followUpMessage: "¿Sigues necesitando ayuda con algo más?",
    },
  };
}

function sanitizeAiSettings(input) {
  const base = defaultAiSettings();
  const src = input || {};
  const esc = src.escalation || {};
  const keywords = Array.isArray(esc.keywords)
    ? esc.keywords.map((k) => String(k).trim().toLowerCase()).filter(Boolean).slice(0, 30)
    : base.escalation.keywords;

  const corrections = (src.corrections || base.corrections || [])
    .map((c) => ({
      id: c.id || `corr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      when: String(c.when || "").trim().slice(0, 300),
      prefer: String(c.prefer || "").trim().slice(0, 500),
      at: c.at || Date.now(),
    }))
    .filter((c) => c.when && c.prefer)
    .slice(0, MAX_CORRECTIONS);

  const res = src.resolution || base.resolution || {};
  const resolution = {
    feedbackEnabled: res.feedbackEnabled != null ? Boolean(res.feedbackEnabled) : base.resolution.feedbackEnabled,
    feedbackPrompt: String(res.feedbackPrompt || base.resolution.feedbackPrompt).trim().slice(0, 200),
    feedbackYes: String(res.feedbackYes || base.resolution.feedbackYes).trim().slice(0, 20),
    feedbackNo: String(res.feedbackNo || base.resolution.feedbackNo).trim().slice(0, 20),
    thankYouMessage: String(res.thankYouMessage || base.resolution.thankYouMessage).trim().slice(0, 500),
    archiveOnConfirmed: Boolean(res.archiveOnConfirmed),
    inactivityMinutes: Math.min(30, Math.max(1, Number(res.inactivityMinutes) || base.resolution.inactivityMinutes)),
    assumedResolutionEnabled: res.assumedResolutionEnabled != null
      ? Boolean(res.assumedResolutionEnabled)
      : base.resolution.assumedResolutionEnabled,
    followUpMessage: String(res.followUpMessage || base.resolution.followUpMessage).trim().slice(0, 300),
  };

  return {
    enabled: src.enabled != null ? Boolean(src.enabled) : base.enabled,
    fallbackEnabled: src.fallbackEnabled != null ? Boolean(src.fallbackEnabled) : base.fallbackEnabled,
    role: String(src.role || base.role).trim().slice(0, 120) || base.role,
    instructions: String(src.instructions || "").trim().slice(0, 4000),
    faqEnabled: src.faqEnabled != null ? Boolean(src.faqEnabled) : base.faqEnabled,
    faqAudience: ["cliente", "empresa", "all"].includes(src.faqAudience) ? src.faqAudience : base.faqAudience,
    faqMaxArticles: Math.min(8, Math.max(1, Number(src.faqMaxArticles) || base.faqMaxArticles)),
    escalation: {
      keywords,
      onLowConfidence: esc.onLowConfidence != null ? Boolean(esc.onLowConfidence) : base.escalation.onLowConfidence,
      confidenceThreshold: Math.max(0.1, Math.min(0.95, Number(esc.confidenceThreshold) || base.escalation.confidenceThreshold)),
      maxRepliesPerChat: Math.min(30, Math.max(1, Number(esc.maxRepliesPerChat) || base.escalation.maxRepliesPerChat)),
      handoffMessage: String(esc.handoffMessage || base.escalation.handoffMessage).trim().slice(0, 500),
    },
    corrections,
    resolution,
  };
}

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
  } else if (type === "reply_ai") {
    // Usa configuración global del agente IA
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

async function readAiSettings() {
  if (redis) {
    const raw = await redis.get(AI_KEY);
    if (!raw) return defaultAiSettings();
    try {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      return sanitizeAiSettings(parsed);
    } catch (_) {
      return defaultAiSettings();
    }
  }
  return sanitizeAiSettings(mem.ai || defaultAiSettings());
}

async function writeAiSettings(settings) {
  const next = sanitizeAiSettings(settings);
  if (redis) {
    await redis.set(AI_KEY, JSON.stringify(next));
  } else {
    mem.ai = next;
  }
  return next;
}

async function getAiSettings() {
  return readAiSettings();
}

async function setAiSettings(patch) {
  const current = await readAiSettings();
  const merged = {
    ...current,
    ...patch,
    escalation: { ...current.escalation, ...(patch && patch.escalation) },
    resolution: { ...current.resolution, ...(patch && patch.resolution) },
  };
  if (!patch || !Array.isArray(patch.corrections)) {
    merged.corrections = current.corrections || [];
  }
  const saved = await writeAiSettings(merged);
  return saved;
}

async function addCorrection({ when, prefer }) {
  const current = await readAiSettings();
  const row = {
    id: `corr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    when: String(when || "").trim(),
    prefer: String(prefer || "").trim(),
    at: Date.now(),
  };
  if (!row.when || !row.prefer) throw new Error("Indica cuándo aplicar la corrección y la respuesta preferida.");
  const corrections = [row, ...(current.corrections || [])].slice(0, MAX_CORRECTIONS);
  return writeAiSettings({ ...current, corrections });
}

async function deleteCorrection(id) {
  const current = await readAiSettings();
  const corrections = (current.corrections || []).filter((c) => c.id !== id);
  return writeAiSettings({ ...current, corrections });
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
  const [rules, settings, ai] = await Promise.all([readRules(), getSettings(), readAiSettings()]);
  return { rules, settings, ai };
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

async function readJsonList(key, memField, max) {
  if (redis) {
    const raw = await redis.get(key);
    if (!raw) return [];
    try {
      const list = typeof raw === "string" ? JSON.parse(raw) : raw;
      return Array.isArray(list) ? list : [];
    } catch (_) {
      return [];
    }
  }
  return mem[memField] || [];
}

async function writeJsonList(key, memField, list, max) {
  const trimmed = list.slice(0, max);
  if (redis) {
    await redis.set(key, JSON.stringify(trimmed));
  } else {
    mem[memField] = trimmed;
  }
  return trimmed;
}

async function appendFailedResolution(entry) {
  const row = {
    id: `fail_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    at: Date.now(),
    ...entry,
  };
  const list = await readJsonList(FAILED_KEY, "aiFailed", MAX_FAILED);
  list.unshift(row);
  await writeJsonList(FAILED_KEY, "aiFailed", list, MAX_FAILED);
  return row;
}

async function listFailedResolutions(limit = 20) {
  const n = Math.min(MAX_FAILED, Math.max(1, Number(limit) || 20));
  const list = await readJsonList(FAILED_KEY, "aiFailed", MAX_FAILED);
  return list.slice(0, n);
}

async function appendResolutionLog(entry) {
  const row = {
    id: `res_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    at: Date.now(),
    ...entry,
  };
  const list = await readJsonList(RES_LOG_KEY, "aiResLog", MAX_RES_LOG);
  list.unshift(row);
  await writeJsonList(RES_LOG_KEY, "aiResLog", list, MAX_RES_LOG);
  return row;
}

async function listResolutionLog(limit = 30) {
  const n = Math.min(MAX_RES_LOG, Math.max(1, Number(limit) || 30));
  const list = await readJsonList(RES_LOG_KEY, "aiResLog", MAX_RES_LOG);
  return list.slice(0, n);
}

module.exports = {
  CONDITION_TYPES: [...CONDITION_TYPES],
  ACTION_TYPES: [...ACTION_TYPES],
  defaultAiSettings,
  listRules,
  getRule,
  createRule,
  updateRule,
  deleteRule,
  setSettings,
  getAiSettings,
  setAiSettings,
  addCorrection,
  deleteCorrection,
  appendLog,
  listLog,
  appendFailedResolution,
  listFailedResolutions,
  appendResolutionLog,
  listResolutionLog,
};
