/**
 * Shared Upstash Redis (REST) client.
 *
 * Returns a configured client when UPSTASH_REDIS_REST_URL and
 * UPSTASH_REDIS_REST_TOKEN are present, otherwise null. The REST client works
 * great on serverless (Vercel) because it's stateless HTTP, unlike a classic
 * TCP Redis connection.
 */

"use strict";

const { Redis } = require("@upstash/redis");

// Support both the Upstash-native variable names and Vercel's "KV" naming
// (KV_REST_API_URL / KV_REST_API_TOKEN), which the Marketplace integration
// injects for Upstash-backed stores.
const url =
  process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token =
  process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

let client = null;

if (url && token) {
  client = new Redis({ url, token });
}

module.exports = client;
