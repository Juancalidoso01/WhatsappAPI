"use strict";

const Store = require("./store");
const CampaignStore = require("./campaign-store");

const DAY_MS = 24 * 60 * 60 * 1000;

async function buildSummary({ templates = [] } = {}) {
  const now = Date.now();
  const since24h = now - DAY_MS;

  const conversations = await Store.listConversations();
  const counts = await Promise.all(conversations.map(async (c) => {
    const msgs = await Store.getMessages(c.phone);
    let inbound = 0;
    let outbound = 0;
    msgs.forEach((m) => {
      if (m.direction === "in") inbound++;
      else outbound++;
    });
    return { inbound, outbound };
  }));
  const messagesIn = counts.reduce((sum, c) => sum + c.inbound, 0);
  const messagesOut = counts.reduce((sum, c) => sum + c.outbound, 0);

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

function summaryToCsv(summary) {
  const s = summary || {};
  const rows = [
    ["metric", "value"],
    ["generated_at", s.generatedAt ? new Date(s.generatedAt).toISOString() : ""],
    ["conversations_total", s.conversations?.total ?? 0],
    ["conversations_active_24h", s.conversations?.active24h ?? 0],
    ["messages_inbound", s.messages?.inbound ?? 0],
    ["messages_outbound", s.messages?.outbound ?? 0],
    ["messages_total", s.messages?.total ?? 0],
    ["campaigns_total", s.campaigns?.total ?? 0],
    ["campaigns_running", s.campaigns?.running ?? 0],
    ["campaigns_completed", s.campaigns?.completed ?? 0],
    ["campaigns_sent", s.campaigns?.sent ?? 0],
    ["campaigns_delivered", s.campaigns?.delivered ?? 0],
    ["campaigns_failed", s.campaigns?.failed ?? 0],
    ["templates_total", s.templates?.total ?? 0],
    ["templates_approved", s.templates?.approved ?? 0],
    ["templates_pending", s.templates?.pending ?? 0],
  ];
  return rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
}

module.exports = { buildSummary, summaryToCsv };
