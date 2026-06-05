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

let client = null;

if (
  process.env.UPSTASH_REDIS_REST_URL &&
  process.env.UPSTASH_REDIS_REST_TOKEN
) {
  client = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
}

module.exports = client;
