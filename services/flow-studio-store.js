"use strict";

const redis = require("./upstash");
const { parseRedisJson } = require("./redis-json");

const KEY = (id) => `wa:flow:studio:${id}`;
const mem = new Map();

async function saveDefinition(flowId, definition) {
  const id = String(flowId);
  const row = {
    flowId: id,
    name: definition.name || "",
    category: definition.category || "OTHER",
    cta: definition.cta || "",
    chatBody: definition.chatBody || "",
    screens: definition.screens || [],
    dynamic: Boolean(definition.dynamic),
    dynamicHandler: definition.dynamicHandler || null,
    firstScreenId: definition.firstScreenId || null,
    dataFormScreenId: definition.dataFormScreenId || null,
    dynamicResultScreen: definition.dynamicResultScreen || null,
    fieldKeys: definition.fieldKeys || [],
    updatedAt: Date.now(),
    source: definition.source || "studio",
  };
  if (redis) {
    await redis.set(KEY(id), JSON.stringify(row));
  } else {
    mem.set(id, row);
  }
  return row;
}

async function getDefinition(flowId) {
  const id = String(flowId);
  if (redis) {
    const raw = await redis.get(KEY(id));
    return parseRedisJson(raw);
  }
  return mem.get(id) || null;
}

module.exports = {
  saveDefinition,
  getDefinition,
};
