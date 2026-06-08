"use strict";

function parseRedisJson(raw) {
  if (raw == null) return null;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(String(raw));
  } catch (_) {
    return null;
  }
}

module.exports = { parseRedisJson };
