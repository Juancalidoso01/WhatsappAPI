/**
 * Copyright 2021-present, Facebook, Inc. All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree.
 */

"use strict";

// Use dotenv to read .env vars into Node
require("dotenv").config();

// Required environment variables
const ENV_VARS = [
  "ACCESS_TOKEN",
  "APP_SECRET",
  "VERIFY_TOKEN",
  "REDIS_HOST",
  "REDIS_PORT"
];

function resolvePublicBaseUrl() {
  if (process.env.PUBLIC_BASE_URL) {
    const trimmed = String(process.env.PUBLIC_BASE_URL).replace(/\/$/, "");
    return trimmed.startsWith("http") ? trimmed : `https://${trimmed}`;
  }

  // Never use preview deployment URLs for Meta (Vercel Deployment Protection → 401).
  const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (productionHost) {
    const trimmed = String(productionHost).replace(/\/$/, "");
    return trimmed.startsWith("http") ? trimmed : `https://${trimmed}`;
  }

  const vercelUrl = process.env.VERCEL_URL ? String(process.env.VERCEL_URL).replace(/^https?:\/\//, "") : "";
  const isPreviewDeploy = /-projects-[a-z0-9]+\.vercel\.app$/i.test(vercelUrl);
  if (process.env.VERCEL_ENV === "production" && vercelUrl && !isPreviewDeploy) {
    return `https://${vercelUrl}`;
  }

  return null;
}

function isPreviewDeployUrl(url) {
  if (!url) return false;
  try {
    const host = new URL(url.startsWith("http") ? url : `https://${url}`).hostname;
    return /-projects-[a-z0-9]+\.vercel\.app$/i.test(host);
  } catch (_) {
    return false;
  }
}

module.exports = Object.freeze({
  // Application information
  appSecret: process.env.APP_SECRET,
  accessToken: process.env.ACCESS_TOKEN,
  verifyToken: process.env.VERIFY_TOKEN,

  // WhatsApp Business identifiers
  phoneNumberId: process.env.PHONE_NUMBER_ID,
  wabaId: process.env.WABA_ID,

  // Optional key for external systems (header X-API-Key)
  integrationApiKey: process.env.INTEGRATION_API_KEY || null,

  // Dashboard login (when set, all /api/* except webhooks require session cookie)
  dashboardPassword: process.env.DASHBOARD_PASSWORD || null,
  dashboardSecret:
    process.env.DASHBOARD_SECRET
    || process.env.APP_SECRET
    || process.env.DASHBOARD_PASSWORD
    || null,

  // Google OAuth (Sign in with Google) — free; restrict by email domain
  googleClientId: process.env.GOOGLE_CLIENT_ID || null,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || null,
  allowedEmailDomain: (process.env.ALLOWED_EMAIL_DOMAIN || "puntopago.net")
    .toLowerCase()
    .replace(/^@/, ""),

  faqSiteUrl: (process.env.FAQ_SITE_URL || "https://faq-sooty-theta.vercel.app").replace(/\/$/, ""),
  geminiApiKey:
    process.env.GOOGLE_GENERATIVE_AI_API_KEY
    || process.env.GEMINI_API_KEY
    || process.env.GOOGLE_API_KEY
    || null,
  geminiModel: process.env.GEMINI_MODEL || "gemini-2.5-flash",
  /** Secreto compartido con FAQ /api/agent/reply (default: INTEGRATION_API_KEY). */
  faqAgentSecret:
    process.env.FAQ_AGENT_SECRET
    || process.env.WHATSAPP_AGENT_SECRET
    || process.env.INTEGRATION_API_KEY
    || null,

  // Vercel Cron: Authorization Bearer CRON_SECRET
  cronSecret: process.env.CRON_SECRET || null,

  isProduction: process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production",

  allowSimulate: process.env.ALLOW_SIMULATE === "true",

  // Branding shown in the web interface
  brandName: process.env.BRAND_NAME || "Punto Pago",

  // Public HTTPS base URL (required for WhatsApp Flow endpoint_uri)
  publicBaseUrl: resolvePublicBaseUrl(),

  isPreviewDeployUrl,

  cardImageUrl: (() => {
    if (process.env.CARD_IMAGE_URL) return process.env.CARD_IMAGE_URL.replace(/\/$/, "");
    const base = resolvePublicBaseUrl();
    if (!base) return null;
    return `${base}/assets/punto-pago-card.png`;
  })(),

  // When false, the app never auto-replies; every message is handled by a human
  // from the web interface. Default off per product decision.
  botEnabled: process.env.BOT_ENABLED === "true",

  // Server configuration
  port: process.env.PORT || 8080,
  redisHost: process.env.REDIS_HOST || "localhost",
  redisPort: process.env.REDIS_PORT || 6379,

  checkEnvVariables: function () {
    ENV_VARS.forEach(function (key) {
      if (!process.env[key]) {
        console.warn("WARNING: Missing the environment variable " + key);
      }
    });
  }
});
