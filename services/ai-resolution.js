"use strict";

const Store = require("./store");
const AutomationStore = require("./automation-store");
const GraphApi = require("./graph-api");
const { validateButtonsPayload } = require("./interactive-send");

const FB_YES = "ai_fb_yes";
const FB_NO = "ai_fb_no";

const POSITIVE_TEXT = [
  "si", "sí", "yes", "ok", "okay", "gracias", "thank", "perfecto", "excelente",
  "genial", "listo", "resuelto", "me ayudo", "me ayudó", "todo bien", "👍", "✅",
];
const NEGATIVE_TEXT = [
  "no", "nop", "nope", "no me ayudo", "no me ayudó", "no sirve", "no resolvió",
  "no resolvio", "necesito más", "necesito mas", "más ayuda", "mas ayuda",
  "hablar con", "agente", "humano", "persona", "❌", "👎",
];

function defaultResolution() {
  return {
    feedbackEnabled: true,
    feedbackPrompt: "¿Te ayudó esta respuesta?",
    feedbackYes: "Sí, gracias",
    feedbackNo: "Necesito más ayuda",
    thankYouMessage: "¡Me alegra haberte ayudado! Si necesitas algo más, escríbenos.",
    archiveOnConfirmed: false,
    inactivityMinutes: 4,
    assumedResolutionEnabled: true,
    followUpMessage: "¿Sigues necesitando ayuda con algo más?",
  };
}

function resolutionSettings(ai) {
  const base = defaultResolution();
  const r = (ai && ai.resolution) || {};
  return {
    feedbackEnabled: r.feedbackEnabled != null ? Boolean(r.feedbackEnabled) : base.feedbackEnabled,
    feedbackPrompt: String(r.feedbackPrompt || base.feedbackPrompt).trim().slice(0, 200) || base.feedbackPrompt,
    feedbackYes: String(r.feedbackYes || base.feedbackYes).trim().slice(0, 20) || base.feedbackYes,
    feedbackNo: String(r.feedbackNo || base.feedbackNo).trim().slice(0, 20) || base.feedbackNo,
    thankYouMessage: String(r.thankYouMessage || base.thankYouMessage).trim().slice(0, 500),
    archiveOnConfirmed: Boolean(r.archiveOnConfirmed),
    inactivityMinutes: Math.min(30, Math.max(1, Number(r.inactivityMinutes) || base.inactivityMinutes)),
    assumedResolutionEnabled: r.assumedResolutionEnabled != null
      ? Boolean(r.assumedResolutionEnabled)
      : base.assumedResolutionEnabled,
    followUpMessage: String(r.followUpMessage || base.followUpMessage).trim().slice(0, 300),
  };
}

function normalizeText(text) {
  return String(text || "").trim().toLowerCase();
}

function waMessageId(response) {
  return response && response.messages && response.messages[0] && response.messages[0].id;
}

async function finalizeOutbound(phone, stored, response) {
  const waId = waMessageId(response);
  if (waId) await Store.updateMessageId(phone, stored.id, waId);
  const id = waId || stored.id;
  await Store.updateMessageStatus(phone, id, "sent");
  stored.id = id;
  stored.status = "sent";
  return stored;
}

async function sendTextReply(phone, phoneNumberId, text) {
  const stored = await Store.addMessage({
    phone,
    phoneNumberId,
    direction: "out",
    text,
    type: "text",
    status: "pending",
    retryPayload: { kind: "text", text },
  });
  const response = await GraphApi.messageWithText(undefined, phoneNumberId, phone, text);
  await finalizeOutbound(phone, stored, response);
  return stored;
}

async function sendFeedbackButtons(phone, phoneNumberId, res) {
  const validated = validateButtonsPayload({
    body: res.feedbackPrompt,
    buttons: [
      { id: FB_YES, title: res.feedbackYes },
      { id: FB_NO, title: res.feedbackNo },
    ],
  });
  if (!validated.ok) throw new Error(validated.errors.join(" "));

  const interactiveMeta = {
    kind: "buttons",
    body: validated.body,
    buttons: validated.normalized,
    aiFeedback: true,
  };
  const stored = await Store.addMessage({
    phone,
    phoneNumberId,
    direction: "out",
    text: validated.body,
    type: "interactive",
    status: "pending",
    interactiveMeta,
    retryPayload: {
      kind: "interactive",
      variant: "buttons",
      body: validated.body,
      buttons: validated.normalized,
    },
  });
  const response = await GraphApi.messageWithInteractiveButtons(phoneNumberId, phone, {
    body: validated.body,
    buttons: validated.normalized,
  });
  await finalizeOutbound(phone, stored, response);
  return stored;
}

function textMatchesAny(text, patterns) {
  const t = normalizeText(text);
  if (!t) return false;
  return patterns.some((p) => {
    if (p.length <= 3) {
      return new RegExp(`(?:^|\\s)${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|$|[!.?,])`).test(t);
    }
    return t === p || t.startsWith(`${p} `) || t.includes(p);
  });
}

function parseFeedbackInput(ctx) {
  const im = ctx.interactiveMeta;
  if (im && im.kind === "button_reply") {
    if (im.id === FB_YES) return "yes";
    if (im.id === FB_NO) return "no";
  }
  const t = normalizeText(ctx.text);
  if (!t) return null;
  if (textMatchesAny(t, NEGATIVE_TEXT)) return "no";
  if (textMatchesAny(t, POSITIVE_TEXT)) return "yes";
  return null;
}

function isAwaitingFeedback(meta) {
  return meta && meta.aiState === "awaiting_feedback";
}

function feedbackTimedOut(meta, res) {
  if (!meta || !meta.aiFeedbackSentAt) return false;
  const ms = (res.inactivityMinutes || 4) * 60 * 1000;
  return Date.now() - Number(meta.aiFeedbackSentAt) > ms;
}

function shouldSkipAiAgent(meta) {
  if (!meta) return false;
  if (meta.needsHuman === "1") return true;
  if (meta.humanActiveAt) {
    const age = Date.now() - Number(meta.humanActiveAt);
    if (age < 86400000) return true;
  }
  return false;
}

async function markHumanActive(phone) {
  await Store.updateConversationMeta(phone, {
    humanActiveAt: String(Date.now()),
    needsHuman: "1",
    aiState: "idle",
  });
}

async function setPendingFeedback(phone, { question, reply, sources }) {
  await Store.updateConversationMeta(phone, {
    aiState: "awaiting_feedback",
    aiResolution: "none",
    aiPendingQuestion: String(question || "").slice(0, 500),
    aiPendingReply: String(reply || "").slice(0, 900),
    aiPendingSources: JSON.stringify(sources || []).slice(0, 500),
    aiFeedbackSentAt: String(Date.now()),
  });
}

async function clearPendingFeedback(phone, extra = {}) {
  await Store.updateConversationMeta(phone, {
    aiState: "idle",
    aiPendingQuestion: "",
    aiPendingReply: "",
    aiPendingSources: "",
    aiFeedbackSentAt: "",
    ...extra,
  });
}

async function sendFeedbackPrompt(phone, phoneNumberId, aiSettings, { question, reply, sources }) {
  const res = resolutionSettings(aiSettings);
  if (!res.feedbackEnabled) return { sent: false, reason: "feedback_disabled" };

  await setPendingFeedback(phone, { question, reply, sources });
  await sendFeedbackButtons(phone, phoneNumberId, res);
  return { sent: true };
}

async function handleConfirmedResolution(ctx, aiSettings) {
  const res = resolutionSettings(aiSettings);
  const meta = await Store.getConversationMeta(ctx.phone);

  await clearPendingFeedback(ctx.phone, {
    aiResolution: "confirmed",
    aiResolvedAt: String(Date.now()),
    needsHuman: "0",
  });

  if (res.thankYouMessage) {
    await sendTextReply(ctx.phone, ctx.phoneNumberId, res.thankYouMessage);
  }
  if (res.archiveOnConfirmed) {
    await Store.updateConversationMeta(ctx.phone, { archived: "1" });
  }

  await AutomationStore.appendResolutionLog({
    type: "confirmed",
    phone: ctx.phone,
    contactName: ctx.contactName,
    question: meta && meta.aiPendingQuestion,
    answer: meta && meta.aiPendingReply,
  });

  return { ok: true, resolution: "confirmed" };
}

async function handleFailedResolution(ctx, aiSettings) {
  const meta = await Store.getConversationMeta(ctx.phone);
  const esc = (aiSettings && aiSettings.escalation) || {};
  const question = (meta && meta.aiPendingQuestion) || ctx.text;
  const answer = (meta && meta.aiPendingReply) || "";
  let sources = [];
  try {
    sources = JSON.parse((meta && meta.aiPendingSources) || "[]");
  } catch (_) { /* ignore */ }

  await clearPendingFeedback(ctx.phone, {
    aiResolution: "failed",
    aiResolvedAt: String(Date.now()),
    needsHuman: "1",
    aiEscalationReason: "Cliente indicó que la respuesta no ayudó.",
    aiEscalatedAt: String(Date.now()),
  });

  const prev = (meta && meta.notes) || "";
  const note = `[IA · sin resolver] P: «${question}» → R: «${String(answer).slice(0, 200)}»`;
  await Store.updateConversationMeta(ctx.phone, {
    notes: prev ? `${prev}\n${note}` : note,
  });

  await AutomationStore.appendFailedResolution({
    phone: ctx.phone,
    contactName: ctx.contactName,
    question,
    answer,
    sources,
  });

  const handoff = esc.handoffMessage;
  if (handoff) {
    await sendTextReply(ctx.phone, ctx.phoneNumberId, handoff);
  }

  await AutomationStore.appendResolutionLog({
    type: "failed",
    phone: ctx.phone,
    contactName: ctx.contactName,
    question,
    answer,
  });

  return { ok: true, resolution: "failed", escalated: true };
}

async function handleAssumedResolution(phone, aiSettings) {
  const meta = await Store.getConversationMeta(phone);
  const res = resolutionSettings(aiSettings);

  await clearPendingFeedback(phone, {
    aiResolution: "assumed",
    aiResolvedAt: String(Date.now()),
    needsHuman: "0",
  });

  if (res.archiveOnConfirmed) {
    await Store.updateConversationMeta(phone, { archived: "1" });
  }

  await AutomationStore.appendResolutionLog({
    type: "assumed",
    phone,
    contactName: meta && meta.contactName,
    question: meta && meta.aiPendingQuestion,
    answer: meta && meta.aiPendingReply,
  });

  return { ok: true, resolution: "assumed" };
}

async function maybeAssumedResolution(phone, aiSettings, meta) {
  const res = resolutionSettings(aiSettings);
  if (!isAwaitingFeedback(meta)) return null;
  if (!res.assumedResolutionEnabled) return null;
  if (!feedbackTimedOut(meta, res)) return null;
  return handleAssumedResolution(phone, aiSettings);
}

async function handleInboundFeedback(ctx, aiSettings) {
  let meta = await Store.getConversationMeta(ctx.phone);
  if (!isAwaitingFeedback(meta)) return { handled: false };

  const assumed = await maybeAssumedResolution(ctx.phone, aiSettings, meta);
  if (assumed) {
    meta = await Store.getConversationMeta(ctx.phone);
    if (!isAwaitingFeedback(meta)) {
      return { handled: false, assumed: true, resolution: "assumed" };
    }
  }

  const feedback = parseFeedbackInput(ctx);
  if (feedback === "yes") {
    const result = await handleConfirmedResolution(ctx, aiSettings);
    return { handled: true, ...result };
  }
  if (feedback === "no") {
    const result = await handleFailedResolution(ctx, aiSettings);
    return { handled: true, ...result };
  }

  await Store.updateConversationMeta(ctx.phone, { aiState: "idle" });
  return { handled: false, continued: true };
}

module.exports = {
  FB_YES,
  FB_NO,
  defaultResolution,
  resolutionSettings,
  parseFeedbackInput,
  isAwaitingFeedback,
  shouldSkipAiAgent,
  markHumanActive,
  sendFeedbackPrompt,
  handleInboundFeedback,
  maybeAssumedResolution,
  handleConfirmedResolution,
  handleFailedResolution,
};
