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

  // Branding shown in the web interface
  brandName: process.env.BRAND_NAME || "Punto Pago",

  // Public HTTPS base URL (required for WhatsApp Flow endpoint_uri)
  publicBaseUrl: (() => {
    const raw = process.env.PUBLIC_BASE_URL || process.env.VERCEL_URL || "";
    if (!raw) return null;
    const trimmed = String(raw).replace(/\/$/, "");
    return trimmed.startsWith("http") ? trimmed : `https://${trimmed}`;
  })(),

  cardImageUrl: (() => {
    if (process.env.CARD_IMAGE_URL) return process.env.CARD_IMAGE_URL.replace(/\/$/, "");
    const base = process.env.PUBLIC_BASE_URL || process.env.VERCEL_URL || "";
    if (!base) return null;
    const trimmed = String(base).replace(/\/$/, "");
    const root = trimmed.startsWith("http") ? trimmed : `https://${trimmed}`;
    return `${root}/assets/punto-pago-card.png`;
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
