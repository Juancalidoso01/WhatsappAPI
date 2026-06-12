"use strict";

const config = require("./config");
const redis = require("./upstash");
const dashboardAuth = require("./dashboard-auth");

function getOpsStatus() {
  const persistent = Boolean(redis);
  const hasCredentials = Boolean(config.accessToken && config.phoneNumberId);
  const cronConfigured = Boolean(config.cronSecret);
  const dashboardAuthOn = dashboardAuth.isAuthRequired();
  const integrationConfigured = Boolean(config.integrationApiKey);

  const items = [
    {
      key: "persistence",
      ok: persistent,
      level: persistent ? "ok" : (config.isProduction ? "warn" : "info"),
    },
    {
      key: "whatsapp",
      ok: hasCredentials,
      level: hasCredentials ? "ok" : "error",
    },
    {
      key: "cron",
      ok: cronConfigured,
      level: cronConfigured ? "ok" : (config.isProduction ? "warn" : "info"),
    },
    {
      key: "dashboardAuth",
      ok: dashboardAuthOn,
      level: dashboardAuthOn ? "ok" : (config.isProduction ? "warn" : "info"),
    },
    {
      key: "integrationApi",
      ok: integrationConfigured,
      level: integrationConfigured ? "ok" : (config.isProduction ? "info" : "info"),
    },
  ];

  const warnings = [];
  if (!persistent && config.isProduction) {
    warnings.push({ code: "NO_REDIS", severity: "critical", messageKey: "workspace.ops.noRedis" });
  }
  if (!cronConfigured && config.isProduction) {
    warnings.push({ code: "NO_CRON_SECRET", severity: "warn", messageKey: "workspace.ops.noCronSecret" });
  }
  if (!dashboardAuthOn && config.isProduction) {
    warnings.push({ code: "NO_DASHBOARD_PASSWORD", severity: "warn", messageKey: "workspace.ops.noDashboardAuth" });
  }
  if (!integrationConfigured && config.isProduction) {
    warnings.push({ code: "NO_INTEGRATION_KEY", severity: "info", messageKey: "workspace.ops.noIntegrationKey" });
  }

  return {
    items,
    warnings,
    persistent,
    hasCredentials,
    cronConfigured,
    dashboardAuthOn,
    integrationConfigured,
  };
}

module.exports = { getOpsStatus };
