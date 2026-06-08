"use strict";

const GraphApi = require("./graph-api");
const CampaignStore = require("./campaign-store");
const BillingLedger = require("./billing-ledger");
const { buildComponentsFromRow } = require("./template-params");

const BATCH_SIZE = 20;

function waMessageId(response) {
  return response && response.messages && response.messages[0] && response.messages[0].id;
}

function isRateLimitError(err) {
  const msg = String(err && err.message ? err.message : err).toLowerCase();
  return msg.includes("rate") || msg.includes("130429") || msg.includes("too many");
}

async function processBatch({ campaignId, templateDef, phoneNumberId }) {
  const campaign = await CampaignStore.getCampaign(campaignId);
  if (!campaign || campaign.status !== "running") {
    return { done: true, processed: 0, reason: "not_running" };
  }

  const cursor = campaign.cursor || 0;
  const batch = await CampaignStore.getRows(campaignId, { offset: cursor, limit: BATCH_SIZE });
  if (!batch.length) {
    await CampaignStore.setCampaignStatus(campaignId, "completed", { pauseReason: "" });
    return { done: true, processed: 0 };
  }

  let processed = 0;
  let stopped = false;
  let stopReason = null;

  for (const row of batch) {
    if (row.status !== "pending") {
      processed++;
      continue;
    }

    try {
      const components = buildComponentsFromRow(templateDef, row);
      const response = await GraphApi.sendTemplate(phoneNumberId, row.phone, {
        name: campaign.template,
        language: campaign.language,
        components,
      });
      const wamid = waMessageId(response);
      const sentAt = Date.now();
      await CampaignStore.updateRowStatus(campaignId, row.index, "sent", { wamid, sentAt });
      if (wamid) await CampaignStore.bindWamid(wamid, campaignId, row.index);
      try {
        const cat = String((templateDef && templateDef.category) || campaign.templateCategory || "UTILITY").toUpperCase();
        await BillingLedger.record({
          phone: row.phone,
          messageId: wamid,
          kind: "bulk",
          category: cat,
          templateName: campaign.template,
          preview: `[carga masiva] ${campaign.name || campaign.template}`,
          source: `campaign:${campaignId}`,
          recipientName: row.name || null,
        });
      } catch (_) { /* non-blocking */ }
      processed++;
    } catch (err) {
      const rate = isRateLimitError(err);
      await CampaignStore.updateRowStatus(campaignId, row.index, "failed", {
        error: String(err.message || err),
      });
      processed++;
      if (rate) {
        stopped = true;
        stopReason = "rate_limit";
        await CampaignStore.setCampaignStatus(campaignId, "paused", {
          pauseReason: "Límite de envío de Meta alcanzado. Reanuda más tarde.",
        });
        break;
      }
    }
  }

  const newCursor = cursor + processed;
  await CampaignStore.patchMeta(campaignId, { cursor: newCursor });

  const refreshed = await CampaignStore.getCampaign(campaignId);
  const totals = refreshed.totals || {};
  const remaining = (totals.pending || 0) + (totals.ready || 0);

  if (!stopped && remaining === 0) {
    await CampaignStore.setCampaignStatus(campaignId, "completed", { pauseReason: "" });
    return { done: true, processed, totals: refreshed.totals };
  }

  return { done: stopped, processed, stopReason, totals: refreshed.totals, cursor: newCursor };
}

module.exports = { processBatch, BATCH_SIZE };
