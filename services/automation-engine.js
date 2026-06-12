"use strict";

const GraphApi = require("./graph-api");
const Store = require("./store");
const AutomationStore = require("./automation-store");
const { validateButtonsPayload } = require("./interactive-send");
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

async function executeAction(action, ctx) {
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
}) {
  if (!phone || !config.accessToken || !phoneNumberId) return { ran: false };

  const { rules, settings } = await AutomationStore.listRules();
  if (!settings.enabled) return { ran: false, reason: "disabled" };

  const activeRules = rules.filter((r) => r.enabled).sort((a, b) => a.order - b.order);
  if (!activeRules.length) return { ran: false, reason: "no_rules" };

  const ctx = {
    phone: String(phone).replace(/\D/g, ""),
    phoneNumberId,
    contactName,
    text: normalizeText(text),
    messageType: messageType || "text",
  };

  const results = [];

  for (const rule of activeRules) {
    const matched = await evaluateConditions(rule.conditions, ctx);
    if (!matched) continue;

    const actionResults = [];
    for (const action of rule.actions) {
      try {
        const res = await executeAction(action, ctx);
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

  return { ran: results.length > 0, results };
}

module.exports = {
  runAutomationForInbound,
  evaluateConditions,
  isWindowOpen,
};
