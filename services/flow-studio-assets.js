"use strict";

const crypto = require("crypto");
const redis = require("./upstash");

const PREFIX = "wa:flowstudio:asset:";
const mem = new Map();

function key(id) {
  return `${PREFIX}${id}`;
}

async function save({ buffer, mimeType }) {
  const id = crypto.randomBytes(8).toString("hex");
  const row = {
    id,
    data: buffer.toString("base64"),
    mimeType: mimeType || "image/png",
    updatedAt: Date.now(),
  };
  if (redis) {
    await redis.set(key(id), JSON.stringify(row));
  } else {
    mem.set(id, row);
  }
  return row;
}

async function get(id) {
  if (!id) return null;
  if (redis) {
    const raw = await redis.get(key(id));
    if (!raw) return null;
    try {
      return typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch (_) {
      return null;
    }
  }
  return mem.get(id) || null;
}

module.exports = { save, get };
