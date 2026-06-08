"use strict";

const FlowStore = require("./flow-store");
const PaymentAuthStore = require("./payment-auth-store");

const SURVEY_NAME_RE = /encuesta|nps|survey|satisfaccion|feedback|calificacion|rating/i;
const PAYMENT_NAME_RE = /autorizacion_pago|payment_auth|pago|payauth/i;

function isPayAuthToken(token) {
  return token && String(token).startsWith("payauth_");
}

function findPaymentFlowId(flowList) {
  const hit = (flowList || []).find((f) => PAYMENT_NAME_RE.test(String(f.name || "")));
  return hit ? String(hit.id) : null;
}

function flattenResponsePayload(responseJson) {
  if (!responseJson || typeof responseJson !== "object") return {};
  const out = {};
  const walk = (obj, prefix) => {
    if (!obj || typeof obj !== "object") return;
    Object.entries(obj).forEach(([k, v]) => {
      if (["flow_token", "version", "screen", "action"].includes(k)) return;
      if (v && typeof v === "object" && !Array.isArray(v)) {
        walk(v, prefix ? `${prefix}.${k}` : k);
      } else if (v != null && String(v).trim() !== "") {
        const key = prefix ? `${prefix}.${k}` : k;
        out[key.replace(/^payload\./, "").replace(/^data\./, "")] = v;
      }
    });
  };
  walk(responseJson, "");
  if (responseJson.payload && typeof responseJson.payload === "object") walk(responseJson.payload, "payload");
  return out;
}

function classifyFlow(name, responses) {
  const n = String(name || "").toLowerCase();
  if (PAYMENT_NAME_RE.test(n)) return "payment";
  if (SURVEY_NAME_RE.test(n)) return "survey";
  const flat = responses.flatMap((r) => Object.entries(flattenResponsePayload(r.responseJson)));
  if (flat.some(([k, v]) => /rating|score|nps|calificacion|estrellas/i.test(k) && /^[1-5]$/.test(String(v)))) {
    return "survey";
  }
  if (flat.some(([k]) => /nombre|email|telefono|phone/i.test(k))) return "form";
  return "flow";
}

function buildSurveyResults(responses) {
  const fields = {};
  responses.forEach((r) => {
    const flat = flattenResponsePayload(r.responseJson);
    Object.entries(flat).forEach(([key, val]) => {
      if (!fields[key]) fields[key] = { field: key, label: humanizeField(key), counts: {}, total: 0 };
      const v = String(val);
      fields[key].counts[v] = (fields[key].counts[v] || 0) + 1;
      fields[key].total += 1;
    });
  });
  return Object.values(fields).sort((a, b) => b.total - a.total);
}

function humanizeField(key) {
  return String(key)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildPaymentResults(responses, payAuthRows, tokenToFlowId, flowId) {
  const tokens = new Set(Object.entries(tokenToFlowId).filter(([, id]) => id === flowId).map(([t]) => t));
  const rows = payAuthRows.filter((r) => tokens.has(r.flowToken) || !tokens.size);
  const authorized = rows.filter((r) => r.decision === "authorize").length;
  const denied = rows.filter((r) => r.decision === "deny").length;
  const pending = rows.filter((r) => r.status === "pending").length;
  return { authorized, denied, pending, rows: rows.slice(0, 20) };
}

async function getActivityReport(flowList) {
  const nameById = Object.fromEntries((flowList || []).map((f) => [String(f.id), f.name || f.id]));
  const sends = await FlowStore.listSends({ limit: 500 });
  const responses = await FlowStore.listResponses({ limit: 500 });
  const events = await FlowStore.listEndpointEvents({ limit: 500 });
  const payAuthRows = await PaymentAuthStore.listRecent({ limit: 200 });

  const tokenToFlowId = {};
  const tokenToName = {};
  sends.forEach((s) => {
    if (!s.flowToken || !s.flowId) return;
    tokenToFlowId[s.flowToken] = String(s.flowId);
    if (s.flowName) tokenToName[s.flowToken] = s.flowName;
  });
  responses.forEach((r) => {
    if (r.flowToken && r.flowId) tokenToFlowId[r.flowToken] = String(r.flowId);
    if (r.flowToken && r.flowName) tokenToName[r.flowToken] = r.flowName;
  });

  const paymentFlowId = findPaymentFlowId(flowList);
  payAuthRows.forEach((r) => {
    if (r.flowToken && paymentFlowId) tokenToFlowId[r.flowToken] = paymentFlowId;
  });

  const initTokens = new Set(events.filter((e) => e.type === "init" && e.flowToken).map((e) => e.flowToken));
  const groups = {};

  function bucket(flowId, hintName) {
    const id = flowId || "_unknown";
    if (!groups[id]) {
      groups[id] = {
        flowId: id === "_unknown" ? null : id,
        name: nameById[id] || hintName || tokenToName[id] || "Sin identificar",
        sentPhones: new Set(),
        viewedPhones: new Set(),
        completedPhones: new Set(),
        responses: [],
        lastActivityAt: 0,
      };
    }
    return groups[id];
  }

  sends.forEach((s) => {
    if (!s.flowId) return;
    const g = bucket(String(s.flowId), s.flowName);
    g.sentPhones.add(s.phone);
    g.lastActivityAt = Math.max(g.lastActivityAt, s.sentAt || 0);
    if (initTokens.has(s.flowToken)) g.viewedPhones.add(s.phone);
  });

  responses.forEach((r) => {
    const fid = r.flowId || tokenToFlowId[r.flowToken] || (isPayAuthToken(r.flowToken) ? paymentFlowId : null);
    const g = bucket(fid ? String(fid) : "_unknown", r.flowName || (isPayAuthToken(r.flowToken) ? "Autorización de pago" : null));
    g.completedPhones.add(r.phone);
    g.viewedPhones.add(r.phone);
    g.responses.push(r);
    g.lastActivityAt = Math.max(g.lastActivityAt, r.receivedAt || 0);
  });

  events.filter((e) => e.type === "init" && e.phone).forEach((e) => {
    const fid = tokenToFlowId[e.flowToken] || (isPayAuthToken(e.flowToken) ? paymentFlowId : null);
    const g = bucket(fid ? String(fid) : "_unknown", isPayAuthToken(e.flowToken) ? "Autorización de pago" : null);
    g.viewedPhones.add(String(e.phone));
    g.lastActivityAt = Math.max(g.lastActivityAt, e.at || 0);
  });

  return Object.values(groups)
    .filter((g) => g.sentPhones.size || g.completedPhones.size || g.viewedPhones.size)
    .map((g) => {
      const sent = g.sentPhones.size;
      const viewed = g.viewedPhones.size;
      const completed = g.completedPhones.size;
      const kind = classifyFlow(g.name, g.responses);
      const row = {
        flowId: g.flowId,
        name: g.name,
        kind,
        sent,
        viewed: Math.max(viewed, completed),
        completed,
        completionRate: sent ? Math.round((completed / sent) * 100) : (completed ? 100 : 0),
        viewRate: sent ? Math.round((Math.max(viewed, completed) / sent) * 100) : 0,
        lastActivityAt: g.lastActivityAt,
        surveyResults: null,
        paymentResults: null,
        recentResponses: g.responses.slice(0, 10).map((r) => ({
          phone: r.phone,
          receivedAt: r.receivedAt,
          answers: flattenResponsePayload(r.responseJson),
        })),
      };
      if (kind === "survey") row.surveyResults = buildSurveyResults(g.responses);
      if (kind === "payment" && g.flowId) {
        row.paymentResults = buildPaymentResults(g.responses, payAuthRows, tokenToFlowId, g.flowId);
      }
      return row;
    })
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}

module.exports = {
  getActivityReport,
  flattenResponsePayload,
  classifyFlow,
  buildSurveyResults,
};
