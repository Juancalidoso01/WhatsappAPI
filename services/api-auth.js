"use strict";

const config = require("./config");

function requireIntegrationKey(req, res, next) {
  const expected = config.integrationApiKey;
  if (!expected) {
    if (config.isProduction) {
      return res.status(503).json({
        ok: false,
        error: "INTEGRATION_API_KEY no configurada. Define la variable en Vercel antes de usar la API de integración.",
      });
    }
    return next();
  }

  const key = req.get("X-API-Key") || req.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (key && key === expected) return next();

  return res.status(401).json({
    ok: false,
    error: "API key inválida o ausente. Envía el header X-API-Key.",
  });
}

module.exports = { requireIntegrationKey };
