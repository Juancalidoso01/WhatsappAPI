/**
 * Copyright 2021-present, Facebook, Inc. All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree.
 */

"use strict";

const redis = require('redis');
const config = require('./config');

// The Redis cache is optional. On environments without a reachable Redis
// server (e.g. Vercel serverless) the cache simply becomes a no-op instead
// of crashing the request. Connection is established lazily on first use.
let client;
let connecting;

function getClient() {
  if (client) return client;

  client = redis.createClient({
    socket: {
      host: config.redisHost,
      port: config.redisPort,
      // Don't keep retrying forever in serverless / no-redis environments.
      reconnectStrategy: false,
      connectTimeout: 2000,
    }
  });

  client.on('error', (err) => {
    console.error('Redis Client Error:', err.message);
  });

  connecting = client.connect().catch((err) => {
    console.error('Redis no disponible (cache deshabilitada):', err.message);
    client = null;
  });

  return client;
}

async function ready() {
  getClient();
  if (connecting) await connecting;
  return Boolean(client && client.isOpen);
}

module.exports = class Cache {
    static async insert(key) {
        try {
            if (!(await ready())) return;
            /**
             * As of when this was written, the redis client doesn't support
             * setting a TTL on members of the set dataytype. Instead, we'll
             * use the standard hash map with a dummy value to mimic one.
            */
            await client.set(key, "");

            // Assume that most "delivered / read" webhooks will happen within
            // 15 seconds.
            await client.expire(key, 15);
        } catch (err) {
            console.error('Cache.insert error:', err.message);
        }
    }

    static async remove(key) {
        try {
            if (!(await ready())) return false;
            let resp = await client.del(key);

            /**
             * Optionally, your application can measure / report the ingress latency
             * from Cloud API webhooks via Redis's TTL.
             * Ex.
             *      someLoggingFunc(client.ttl(key));
            */

            return resp > 0;
        } catch (err) {
            console.error('Cache.remove error:', err.message);
            return false;
        }
    }
}
