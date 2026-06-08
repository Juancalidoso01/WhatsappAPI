"use strict";

const RATES_USD = {
  MARKETING: 0.074,
  UTILITY: 0.0113,
  AUTHENTICATION: 0.0113,
  AUTHENTICATION_INTERNATIONAL: 0.0113,
  SERVICE: 0,
};

function progressFromTotals(totals) {
  const t = totals || {};
  const total = t.total || 0;
  const done = (t.sent || 0) + (t.delivered || 0) + (t.read || 0) + (t.failed || 0) + (t.skipped || 0);
  const varsReady = (t.ready || 0) + (t.pending || 0) + done;
  return {
    total,
    done,
    percent: total ? Math.round((done / total) * 100) : 0,
    awaitingVars: t.awaiting_vars || 0,
    ready: t.ready || 0,
    pending: t.pending || 0,
    varsReady,
    varsPercent: total ? Math.round((varsReady / total) * 100) : 0,
  };
}

function estimateCost(campaign, countryCode = "PA") {
  const cat = String(campaign.templateCategory || "UTILITY").toUpperCase();
  const rate = RATES_USD[cat] != null ? RATES_USD[cat] : RATES_USD.UTILITY;
  const t = campaign.totals || {};
  const billable = (t.ready || 0) + (t.pending || 0) + (t.sent || 0) + (t.delivered || 0) + (t.read || 0);
  const total = t.total || 0;
  return {
    category: cat,
    ratePerMessageUsd: rate,
    countryCode,
    recipients: total,
    billableEstimate: billable || total,
    estimatedTotalUsd: Number(((billable || total) * rate).toFixed(4)),
    note: "Estimación con tarifa Meta PA (abr. 2026). El costo real depende del país de cada destinatario.",
  };
}

module.exports = { progressFromTotals, estimateCost, RATES_USD };
