/**
 * Copyright 2021-present, Facebook, Inc. All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree.
 */

"use strict";

const upstash = require("./upstash");
const redisLib = require("redis");
const config = require("./config");

const PREFIX = "wa:cache:";

// ---------- Optional classic Redis (local only) ----------
let client;
let connecting;

function getClient() {
  if (client) return client;

  client = redisLib.createClient({
    socket: {
      host: config.redisHost,
      port: config.redisPort,
      reconnectStrategy: false,
      connectTimeout: 2000,
    },
  });

  client.on("error", (err) => console.error("Redis Client Error:", err.message));

  connecting = client.connect().catch((err) => {
    console.error("Redis no disponible (cache deshabilitada):", err.message);
    client = null;
  });

  return client;
}

async function localReady() {
  getClient();
  if (connecting) await connecting;
  return Boolean(client && client.isOpen);
}

module.exports = class Cache {
  static async insert(key) {
    try {
      if (upstash) {
        await upstash.set(`${PREFIX}${key}`, "1", { ex: 15 });
        return;
      }
      if (!(await localReady())) return;
      await client.set(key, "");
      await client.expire(key, 15);
    } catch (err) {
      console.error("Cache.insert error:", err.message);
    }
  }

  static async remove(key) {
    try {
      if (upstash) {
        const resp = await upstash.del(`${PREFIX}${key}`);
        return resp > 0;
      }
      if (!(await localReady())) return false;
      let resp = await client.del(key);
      return resp > 0;
    } catch (err) {
      console.error("Cache.remove error:", err.message);
      return false;
    }
  }
};
