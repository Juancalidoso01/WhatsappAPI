"use strict";

const GraphApi = require("./graph-api");
const Store = require("./store");
const AutomationStore = require("./automation-store");
const { validateButtonsPayload } = require("./interactive-send");
const { searchFaqArticles, formatFaqContext } = require("./faq-knowledge");
const GeminiAgent = require("./gemini-agent");
const AiResolution = require("./ai-resolution");
const config = require("./config");

function normalizeText(text) {
  return String(text || "").trim();
}

function matchText(value, pattern, { caseInsensitive = true } = {}) {
  const a = caseInsensitive ? normalizeText(value).toLowerCase() : normalizeText(value);
  const b = caseInsensitive ? normalizeText(pattern).toLowerCase() : normalizeText(pattern);
  return a.includes(b);
}

function equalsText(value, pattern, { caseInsensitive = true } = {}) {
  const a = caseInsensitive ? normalizeText(value).toLowerCase() : normalizeText(value);
  const b = caseInsensitive ? normalizeText(pattern).toLowerCase() : normalizeText(pattern);
  return a === b;
}

function startsWithText(value, pattern, { caseInsensitive = true } = {}) {
  const a = caseInsensitive ? normalizeText(value).toLowerCase() : normalizeText(value);
  const b = caseInsensitive ? normalizeText(pattern).toLowerCase() : normalizeText(pattern);
  return a.startsWith(b);
}

async function isFirstInbound(phone) {
  const msgs = await Store.getMessages(phone);
  return msgs.filter((m) => m.direction === "in").length <= 1;
}

async function isWindowOpen(phone) {
  const meta = await Store.getConversationMeta(phone);
  if (meta && meta.windowExpiresAt) {
    return Date.now() < Number(meta.windowExpiresAt) * 1000;
  }
  const msgs = await Store.getMessages(phone);
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].direction === "in" && msgs[i].timestamp) {
      return Date.now() - msgs[i].timestamp < 86400000;
    }
  }
  return false;
}

async function evaluateConditions(conditions, ctx) {
  for (const cond of conditions || []) {
    switch (cond.type) {
      case "any":
        break;
      case "contains":
        if (!matchText(ctx.text, cond.value, cond)) return false;
        break;
      case "equals":
        if (!equalsText(ctx.text, cond.value, cond)) return false;
        break;
      case "starts_with":
        if (!startsWithText(ctx.text, cond.value, cond)) return false;
        break;
      case "message_type":
        if (String(ctx.messageType || "").toLowerCase() !== String(cond.value || "text").toLowerCase()) {
          return false;
        }
        break;
      case "first_inbound":
        if (!(await isFirstInbound(ctx.phone))) return false;
        break;
      default:
        return false;
    }
  }
  return true;
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

async function sendTemplateReply(phone, phoneNumberId, { template, language }) {
  const stored = await Store.addMessage({
    phone,
    phoneNumberId,
    direction: "out",
    text: `[plantilla] ${template}`,
    type: "template",
    status: "pending",
    retryPayload: { kind: "template", template, language: language || "es", components: [] },
  });
  const response = await GraphApi.sendTemplate(phoneNumberId, phone, {
    name: template,
    language: language || "es",
    components: [],
  });
  await finalizeOutbound(phone, stored, response);
  await Store.updateConversationMeta(phone, { conversationOrigin: "business_initiated" });
  return stored;
}

async function sendButtonsReply(phone, phoneNumberId, action) {
  const validated = validateButtonsPayload({
    body: action.body,
    buttons: action.buttons,
  });
  if (!validated.ok) throw new Error(validated.errors.join(" "));

  const interactiveMeta = {
    kind: "buttons",
    body: validated.body,
    buttons: validated.normalized,
  };
  const retryPayload = {
    kind: "interactive",
    variant: "buttons",
    body: validated.body,
    buttons: validated.normalized,
  };

  const stored = await Store.addMessage({
    phone,
    phoneNumberId,
    direction: "out",
    text: validated.body,
    type: "interactive",
    status: "pending",
    interactiveMeta,
    retryPayload,
  });
  const response = await GraphApi.messageWithInteractiveButtons(phoneNumberId, phone, {
    body: validated.body,
    buttons: validated.normalized,
  });
  await finalizeOutbound(phone, stored, response);
  return stored;
}

function messageMatchesEscalation(text, keywords) {
  const t = normalizeText(text).toLowerCase();
  return (keywords || []).some((k) => k && t.includes(String(k).toLowerCase()));
}

async function getAiReplyCount(phone) {
  const meta = await Store.getConversationMeta(phone);
  return Number(meta && meta.aiReplyCount) || 0;
}

async function bumpAiReplyCount(phone) {
  const n = (await getAiReplyCount(phone)) + 1;
  await Store.updateConversationMeta(phone, { aiReplyCount: String(n) });
  return n;
}

async function markNeedsHuman(phone, reason) {
  await Store.updateConversationMeta(phone, {
    needsHuman: "1",
    aiEscalationReason: String(reason || "").slice(0, 500),
    aiEscalatedAt: String(Date.now()),
  });
}

async function runAiAgent(ctx, aiSettings, { ruleName } = {}) {
  if (!GeminiAgent.isConfigured()) {
    return { ok: false, skipped: true, reason: "no_gemini_key" };
  }
  if (!aiSettings || !aiSettings.enabled) {
    return { ok: false, skipped: true, reason: "ai_disabled" };
  }

  const esc = aiSettings.escalation || {};
  const replyCount = await getAiReplyCount(ctx.phone);

  if (replyCount >= (esc.maxRepliesPerChat || 8)) {
    await markNeedsHuman(ctx.phone, "Límite de respuestas IA alcanzado.");
    return { ok: false, escalated: true, reason: "max_ai_replies" };
  }

  if (messageMatchesEscalation(ctx.text, esc.keywords)) {
    await markNeedsHuman(ctx.phone, "Usuario solicitó agente humano.");
    const handoff = esc.handoffMessage;
    if (handoff && (await isWindowOpen(ctx.phone))) {
      await sendTextReply(ctx.phone, ctx.phoneNumberId, handoff);
    }
    return { ok: true, action: "reply_ai", escalated: true, reason: "keyword_escalation" };
  }

  let faqArticles = [];
  if (aiSettings.faqEnabled !== false) {
    try {
      faqArticles = await searchFaqArticles(ctx.text, {
        audience: aiSettings.faqAudience || "cliente",
        limit: aiSettings.faqMaxArticles || 4,
      });
    } catch (err) {
      console.error("faq-knowledge error:", err.message);
    }
  }

  const messages = await Store.getMessages(ctx.phone);
  const history = messages.slice(-8).map((m) => ({
    direction: m.direction,
    text: m.text || "",
  }));

  let generated;
  try {
    generated = await GeminiAgent.generateAgentReply({
      ai: aiSettings,
      corrections: aiSettings.corrections,
      message: ctx.text,
      contactName: ctx.contactName,
      faqContext: formatFaqContext(faqArticles),
      history,
    });
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }

  let shouldEscalate = generated.escalate;
  if (
    !shouldEscalate
    && esc.onLowConfidence
    && generated.confidence < (esc.confidenceThreshold || 0.45)
  ) {
    shouldEscalate = true;
    generated.escalationReason = generated.escalationReason || "Confianza baja según FAQ.";
  }

  if (shouldEscalate) {
    await markNeedsHuman(ctx.phone, generated.escalationReason || "Escalamiento IA");
    if (generated.internalNote) {
      const meta = await Store.getConversationMeta(ctx.phone);
      const prev = (meta && meta.notes) || "";
      const note = `[IA${ruleName ? ` · ${ruleName}` : ""}] ${generated.internalNote}`;
      await Store.updateConversationMeta(ctx.phone, { notes: prev ? `${prev}\n${note}` : note });
    }
    const handoff = esc.handoffMessage;
    if (handoff && (await isWindowOpen(ctx.phone))) {
      await sendTextReply(ctx.phone, ctx.phoneNumberId, handoff);
    }
    return {
      ok: true,
      action: "reply_ai",
      escalated: true,
      confidence: generated.confidence,
      sources: generated.sources,
      reason: generated.escalationReason,
    };
  }

  if (!generated.reply) {
    return { ok: false, skipped: true, reason: "empty_reply" };
  }

  if (!(await isWindowOpen(ctx.phone))) {
    return { ok: false, skipped: true, reason: "window_closed" };
  }

  await sendTextReply(ctx.phone, ctx.phoneNumberId, generated.reply);
  await bumpAiReplyCount(ctx.phone);

  if (generated.internalNote) {
    const meta = await Store.getConversationMeta(ctx.phone);
    const prev = (meta && meta.notes) || "";
    const note = `[IA] ${generated.internalNote}`;
    await Store.updateConversationMeta(ctx.phone, { notes: prev ? `${prev}\n${note}` : note });
  }

  const resCfg = AiResolution.resolutionSettings(aiSettings);
  if (resCfg.feedbackEnabled) {
    try {
      await AiResolution.sendFeedbackPrompt(ctx.phone, ctx.phoneNumberId, aiSettings, {
        question: ctx.text,
        reply: generated.reply,
        sources: generated.sources,
      });
    } catch (err) {
      console.error("ai-resolution feedback error:", err.message);
    }
  }

  return {
    ok: true,
    action: "reply_ai",
    confidence: generated.confidence,
    sources: generated.sources,
    faqCount: faqArticles.length,
  };
}

async function executeAction(action, ctx, aiSettings) {
  const { phone, phoneNumberId } = ctx;
  switch (action.type) {
    case "reply_text": {
      if (!(await isWindowOpen(phone))) {
        return { ok: false, skipped: true, reason: "window_closed" };
      }
      await sendTextReply(phone, phoneNumberId, action.text);
      return { ok: true, action: "reply_text" };
    }
    case "reply_template": {
      await sendTemplateReply(phone, phoneNumberId, action);
      return { ok: true, action: "reply_template" };
    }
    case "reply_buttons": {
      if (!(await isWindowOpen(phone))) {
        return { ok: false, skipped: true, reason: "window_closed" };
      }
      await sendButtonsReply(phone, phoneNumberId, action);
      return { ok: true, action: "reply_buttons" };
    }
    case "archive": {
      await Store.updateConversationMeta(phone, { archived: "1" });
      return { ok: true, action: "archive" };
    }
    case "add_note": {
      const meta = await Store.getConversationMeta(phone);
      const prev = (meta && meta.notes) || "";
      const note = action.note;
      const next = prev ? `${prev}\n${note}` : note;
      await Store.updateConversationMeta(phone, { notes: next });
      return { ok: true, action: "add_note" };
    }
    case "reply_ai": {
      if (AiResolution.shouldSkipAiAgent(await Store.getConversationMeta(phone))) {
        return { ok: false, skipped: true, reason: "human_or_escalated" };
      }
      return runAiAgent(ctx, aiSettings, { ruleName: "regla" });
    }
    default:
      return { ok: false, skipped: true, reason: "unknown_action" };
  }
}

async function runAutomationForInbound({
  phone,
  phoneNumberId,
  contactName,
  text,
  messageType,
  interactiveMeta,
}) {
  if (!phone || !config.accessToken || !phoneNumberId) return { ran: false };

  const { rules, ai } = await AutomationStore.listRules();

  const ctx = {
    phone: String(phone).replace(/\D/g, ""),
    phoneNumberId,
    contactName,
    text: normalizeText(text),
    messageType: messageType || "text",
    interactiveMeta: interactiveMeta || null,
  };

  const feedbackResult = await AiResolution.handleInboundFeedback(ctx, ai);
  if (feedbackResult.handled) {
    await AutomationStore.appendLog({
      ruleId: "ai_resolution",
      ruleName: `Resolución IA (${feedbackResult.resolution || "feedback"})`,
      phone: ctx.phone,
      contactName: contactName || ctx.phone,
      text: ctx.text,
      messageType: ctx.messageType,
      actions: [feedbackResult],
    });
    return { ran: true, results: [{ ruleId: "ai_resolution", actions: [feedbackResult] }] };
  }

  const meta = await Store.getConversationMeta(ctx.phone);
  const skipAi = AiResolution.shouldSkipAiAgent(meta);

  const activeRules = rules.filter((r) => r.enabled).sort((a, b) => a.order - b.order);

  const results = [];
  let matchedAny = false;

  for (const rule of activeRules) {
    const matched = await evaluateConditions(rule.conditions, ctx);
    if (!matched) continue;
    matchedAny = true;

    const actionResults = [];
    for (const action of rule.actions) {
      if (skipAi && action.type === "reply_ai") {
        actionResults.push({ ok: false, skipped: true, reason: "human_or_escalated" });
        continue;
      }
      try {
        const res = await executeAction(action, ctx, ai);
        actionResults.push(res);
      } catch (err) {
        actionResults.push({ ok: false, error: String(err.message || err) });
      }
    }

    await AutomationStore.appendLog({
      ruleId: rule.id,
      ruleName: rule.name,
      phone: ctx.phone,
      contactName: contactName || ctx.phone,
      text: ctx.text,
      messageType: ctx.messageType,
      actions: actionResults,
    });

    results.push({ ruleId: rule.id, ruleName: rule.name, actions: actionResults });

    if (rule.stopOnMatch) break;
  }

  if (!matchedAny && ai && ai.enabled && ai.fallbackEnabled && skipAi) {
    console.log("[automation] ai fallback skipped:", ctx.phone, meta.needsHuman === "1" ? "needsHuman" : "humanActive");
  }

  if (!matchedAny && ai && ai.enabled && ai.fallbackEnabled && !skipAi) {
    try {
      const res = await runAiAgent(ctx, ai, { ruleName: "fallback IA" });
      if (res.skipped || res.error) {
        console.warn("[automation] ai fallback:", res.reason || res.error);
      }
      await AutomationStore.appendLog({
        ruleId: "ai_fallback",
        ruleName: "Agente IA (fallback)",
        phone: ctx.phone,
        contactName: contactName || ctx.phone,
        text: ctx.text,
        messageType: ctx.messageType,
        actions: [res],
      });
      results.push({ ruleId: "ai_fallback", ruleName: "Agente IA (fallback)", actions: [res] });
    } catch (err) {
      await AutomationStore.appendLog({
        ruleId: "ai_fallback",
        ruleName: "Agente IA (fallback)",
        phone: ctx.phone,
        contactName: contactName || ctx.phone,
        text: ctx.text,
        messageType: ctx.messageType,
        actions: [{ ok: false, error: String(err.message || err) }],
      });
    }
  }

  if (!activeRules.length && !(ai && ai.enabled && ai.fallbackEnabled)) {
    return { ran: false, reason: "nothing_enabled" };
  }

  return { ran: results.length > 0, results };
}

function buildConversationAiStatus({ meta, windowOpen, readiness }) {
  const m = meta || {};
  const needsHuman = m.needsHuman === "1" || m.needsHuman === true;
  const humanActiveAt = m.humanActiveAt ? Number(m.humanActiveAt) : 0;
  const humanActive = Boolean(humanActiveAt && Date.now() - humanActiveAt < 3600000);
  const awaitingFeedback = m.aiState === "awaiting_feedback";
  const r = readiness || {};
  const blockers = [];

  if (r.botEnabled) blockers.push("bot");
  if (!r.aiEnabled) blockers.push("global_off");
  if (!r.geminiConfigured) blockers.push("no_gemini");
  if (r.aiEnabled && !r.fallbackEnabled && !r.hasAiRule) blockers.push("no_fallback");
  if (needsHuman) blockers.push("needs_human");
  if (humanActive) blockers.push("human_active");
  if (!windowOpen) blockers.push("window_closed");

  let mode = "ready";
  if (r.botEnabled) mode = "bot";
  else if (!r.aiEnabled) mode = "off";
  else if (!r.geminiConfigured) mode = "no_gemini";
  else if (needsHuman) mode = "escalated";
  else if (humanActive) mode = "human_active";
  else if (awaitingFeedback) mode = "awaiting_feedback";
  else if (r.aiEnabled && !r.fallbackEnabled && !r.hasAiRule) mode = "no_fallback";
  else if (!windowOpen) mode = "window_closed";
  else mode = "ready";

  const canRespond = mode === "ready";

  return {
    mode,
    canRespond,
    blockers,
    needsHuman,
    humanActive,
    awaitingFeedback,
    windowOpen: Boolean(windowOpen),
    escalationReason: m.aiEscalationReason || "",
    globalAiEnabled: Boolean(r.aiEnabled),
    globalReady: Boolean(r.ready),
    aiReplyCount: Number(m.aiReplyCount) || 0,
  };
}

function buildReadiness({ ai, rules, botEnabled, geminiConfigured, geminiViaFaq }) {
  const hints = [];
  const aiOn = Boolean(ai && ai.enabled);
  const fallback = Boolean(ai && ai.fallbackEnabled);
  const hasAiRule = (rules || []).some(
    (r) => r.enabled && (r.actions || []).some((a) => a.type === "reply_ai"),
  );

  if (botEnabled) hints.push("BOT_ENABLED=true en el servidor bloquea respuestas automáticas.");
  if (!aiOn) hints.push("Activa «Agente IA activo» en esta pestaña.");
  if (aiOn && !fallback && !hasAiRule) {
    hints.push("Activa «Fallback IA» para responder cuando no haya reglas manuales.");
  }
  if (!geminiConfigured) {
    hints.push("Sin conexión IA: configura FAQ proxy (INTEGRATION_API_KEY en FAQ) o GOOGLE_GENERATIVE_AI_API_KEY.");
  }

  const canReply = aiOn && geminiConfigured && (fallback || hasAiRule) && !botEnabled;
  return {
    ready: canReply && hints.length === 0,
    canReply,
    aiEnabled: aiOn,
    fallbackEnabled: fallback,
    hasAiRule,
    geminiConfigured: Boolean(geminiConfigured),
    geminiViaFaq: Boolean(geminiViaFaq),
    botEnabled: Boolean(botEnabled),
    hints,
  };
}

module.exports = {
  runAutomationForInbound,
  evaluateConditions,
  isWindowOpen,
  buildReadiness,
  buildConversationAiStatus,
};
