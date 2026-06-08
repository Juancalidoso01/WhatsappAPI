"use strict";

const crypto = require("crypto");
const redis = require("./upstash");

const REDIS_KEY = "wa:flow:keys";
let memKeys = null;

function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { publicKey, privateKey };
}

async function getKeyPair() {
  if (process.env.FLOW_PRIVATE_KEY && process.env.FLOW_PUBLIC_KEY) {
    return {
      privateKey: process.env.FLOW_PRIVATE_KEY.replace(/\\n/g, "\n"),
      publicKey: process.env.FLOW_PUBLIC_KEY.replace(/\\n/g, "\n"),
      source: "env",
    };
  }

  if (redis) {
    const raw = await redis.hgetall(REDIS_KEY);
    if (raw && raw.privateKey && raw.publicKey) {
      return { privateKey: raw.privateKey, publicKey: raw.publicKey, source: "redis" };
    }
    const pair = generateKeyPair();
    await redis.hset(REDIS_KEY, { privateKey: pair.privateKey, publicKey: pair.publicKey });
    return { ...pair, source: "generated" };
  }

  if (!memKeys) memKeys = generateKeyPair();
  return { ...memKeys, source: "memory" };
}

module.exports = { getKeyPair, generateKeyPair };
