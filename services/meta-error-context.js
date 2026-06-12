"use strict";

const { getMetaPlatformStatus, servicesForOperation, pickAffectedServices, statusLabel } = require("./meta-platform-status");

const STATUS_RANK = { operational: 0, unknown: 1, degraded: 2, major: 3 };

function parseMetaError(err) {
  if (!err) return { code: null, subcode: null, message: "" };
  const meta = err.meta || err.error || err;
  const code = Number(meta.code != null ? meta.code : meta.error && meta.error.code);
  const subcode = Number(meta.error_subcode != null ? meta.error_subcode : meta.error && meta.error.error_subcode);
  const message = String(
    err.message
    || meta.message
    || (meta.error && meta.error.message)
    || "",
  );
  return {
    code: Number.isFinite(code) ? code : null,
    subcode: Number.isFinite(subcode) ? subcode : null,
    message,
  };
}

function classifyApiError(parsed) {
  const { code, message } = parsed;
  const msg = message.toLowerCase();

  if (code === 190 || /expired|session has expired|invalid oauth|error validating access token/i.test(msg)) {
    return { kind: "auth_token", severity: "error" };
  }
  if (code === 200 || code === 10 || /permission|not authorized|does not have permission|capability/i.test(msg)) {
    return { kind: "permission", severity: "error" };
  }
  if ([4, 17, 32, 613, 80004].includes(code) || /rate limit|too many calls|user request limit/i.test(msg)) {
    return { kind: "rate_limit", severity: "warn" };
  }
  if ([1, 2, 80007].includes(code) || /unexpected error|try again|temporarily unavailable|retry your request/i.test(msg)) {
    return { kind: "transient", severity: "warn" };
  }
  if (code === 100 || /invalid parameter|param/i.test(msg)) {
    return { kind: "request_error", severity: "error" };
  }
  return { kind: "unknown", severity: "error" };
}

function findOutageForServices(platformStatus, affected) {
  if (!platformStatus || !affected || !affected.length) return null;
  const ids = new Set(affected.map((s) => s.id));
  const outages = (platformStatus.outages || []).filter((o) => ids.has(o.serviceId));
  if (!outages.length) return null;
  return outages.sort((a, b) => STATUS_RANK.major - STATUS_RANK.degraded)[0] || outages[0];
}

function worstStatus(services) {
  return (services || []).reduce(
    (acc, s) => (STATUS_RANK[s.status] > STATUS_RANK[acc] ? s.status : acc),
    "operational",
  );
}

function buildI18nContext(classification, platformStatus, operation, parsed) {
  const affected = pickAffectedServices(platformStatus, operation);
  const outage = findOutageForServices(platformStatus, affected);
  const hasPlatformIssue = affected.length > 0;
  const serviceNames = affected.map((s) => s.name).join(", ");

  if (classification.kind === "auth_token") {
    return {
      kind: "auth_token",
      severity: "error",
      i18nKey: "meta.errors.authToken",
      i18nParams: {},
      hintKey: "meta.errors.authTokenHint",
    };
  }

  if (classification.kind === "permission") {
    return {
      kind: "permission",
      severity: "error",
      i18nKey: "meta.errors.permission",
      i18nParams: { detail: parsed.message ? parsed.message.slice(0, 160) : "" },
      hintKey: "meta.errors.permissionHint",
    };
  }

  if (hasPlatformIssue && ["transient", "unknown", "rate_limit", "request_error"].includes(classification.kind)) {
    const status = statusLabel(worstStatus(affected));
    const detail = outage && outage.description
      ? outage.description.slice(0, 180) + (outage.description.length > 180 ? "…" : "")
      : "";
    return {
      kind: "platform_outage",
      severity: worstStatus(affected) === "major" ? "error" : "warn",
      i18nKey: "meta.errors.platformOutage",
      i18nParams: { services: serviceNames, status, detail },
      hintKey: "meta.errors.platformOutageHint",
      affectedServices: affected.map((s) => ({
        key: s.key,
        name: s.name,
        status: s.status,
        statusRaw: s.statusRaw,
        level: s.level,
      })),
      outage: outage ? {
        serviceName: outage.serviceName,
        description: outage.description,
        time: outage.time,
        status: outage.status,
      } : null,
    };
  }

  if (classification.kind === "rate_limit") {
    return {
      kind: "rate_limit",
      severity: "warn",
      i18nKey: "meta.errors.rateLimit",
      i18nParams: {},
      hintKey: "meta.errors.rateLimitHint",
    };
  }

  if (classification.kind === "transient") {
    return {
      kind: "transient",
      severity: "warn",
      i18nKey: hasPlatformIssue ? "meta.errors.transientWithStatus" : "meta.errors.transient",
      i18nParams: hasPlatformIssue
        ? { status: statusLabel(platformStatus.overall) }
        : {},
      hintKey: "meta.errors.transientHint",
    };
  }

  if (classification.kind === "request_error") {
    return {
      kind: "request_error",
      severity: "error",
      i18nKey: "meta.errors.requestError",
      i18nParams: { detail: parsed.message ? parsed.message.slice(0, 160) : "" },
      hintKey: null,
    };
  }

  return {
    kind: "unknown",
    severity: "error",
    i18nKey: hasPlatformIssue ? "meta.errors.unknownWithOutage" : "meta.errors.unknown",
    i18nParams: hasPlatformIssue
      ? { services: serviceNames, status: statusLabel(worstStatus(affected)) }
      : { detail: parsed.message ? parsed.message.slice(0, 160) : "" },
    hintKey: hasPlatformIssue ? "meta.errors.platformOutageHint" : null,
    affectedServices: hasPlatformIssue
      ? affected.map((s) => ({
        key: s.key,
        name: s.name,
        status: s.status,
        statusRaw: s.statusRaw,
        level: s.level,
      }))
      : [],
  };
}

async function buildMetaErrorContext({ operation = "messaging", error } = {}) {
  const parsed = parseMetaError(error);
  const classification = classifyApiError(parsed);
  const platformStatus = await getMetaPlatformStatus();
  const i18n = buildI18nContext(classification, platformStatus, operation, parsed);

  return {
    operation,
    api: {
      kind: classification.kind,
      severity: classification.severity,
      code: parsed.code,
      message: parsed.message,
    },
    platform: platformStatus && platformStatus.ok ? {
      overall: platformStatus.overall,
      overallLevel: platformStatus.overallLevel,
      pageUrl: platformStatus.pageUrl,
      fetchedAt: platformStatus.fetchedAt,
      stale: Boolean(platformStatus.stale),
    } : null,
    ...i18n,
  };
}

async function attachMetaError(body, operation, error) {
  try {
    const metaContext = await buildMetaErrorContext({ operation, error });
    return { ...body, metaContext };
  } catch (err) {
    console.warn("attachMetaError:", err.message || err);
    return body;
  }
}

module.exports = {
  parseMetaError,
  classifyApiError,
  buildMetaErrorContext,
  attachMetaError,
};
