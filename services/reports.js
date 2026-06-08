"use strict";

const Store = require("./store");
const CampaignStore = require("./campaign-store");

const DAY_MS = 24 * 60 * 60 * 1000;

async function buildSummary({ templates = [] } = {}) {
  const now = Date.now();
  const since24h = now - DAY_MS;

  const conversations = await Store.listConversations();
  let messagesIn = 0;
  let messagesOut = 0;
  let active24h = 0;

  for (const c of conversations) {
    if ((c.lastActivity || 0) >= since24h) active24h++;
    const msgs = await Store.getMessages(c.phone);
    msgs.forEach((m) => {
      if (m.direction === "in") messagesIn++;
      else messagesOut++;
    });
  }

  const campaigns = await CampaignStore.listCampaigns();
  let campaignSent = 0;
  let campaignDelivered = 0;
  let campaignFailed = 0;
  campaigns.forEach((camp) => {
    const t = camp.totals || {};
    campaignSent += (t.sent || 0) + (t.delivered || 0) + (t.read || 0);
    campaignDelivered += (t.delivered || 0) + (t.read || 0);
    campaignFailed += t.failed || 0;
  });

  const tplList = templates || [];
  const approved = tplList.filter((t) => (t.status || "").toLowerCase() === "approved").length;
  const pending = tplList.filter((t) => {
    const s = (t.status || "").toLowerCase();
    return s === "pending" || s === "in_review";
  }).length;

  return {
    generatedAt: now,
    conversations: {
      total: conversations.length,
      active24h,
    },
    messages: {
      inbound: messagesIn,
      outbound: messagesOut,
      total: messagesIn + messagesOut,
    },
    campaigns: {
      total: campaigns.length,
      running: campaigns.filter((c) => c.status === "running").length,
      completed: campaigns.filter((c) => c.status === "completed").length,
      sent: campaignSent,
      delivered: campaignDelivered,
      failed: campaignFailed,
    },
    templates: {
      total: tplList.length,
      approved,
      pending,
    },
  };
}

module.exports = { buildSummary };
