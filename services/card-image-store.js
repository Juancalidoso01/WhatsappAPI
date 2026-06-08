"use strict";

const redis = require("./upstash");
const config = require("./config");

const KEY = "wa:payauth:card_image";
let memImage = null;

async function save({ buffer, mimeType }) {
  const row = {
    data: buffer.toString("base64"),
    mimeType: mimeType || "image/png",
    updatedAt: Date.now(),
  };
  if (redis) {
    await redis.set(KEY, JSON.stringify(row));
  } else {
    memImage = row;
  }
  return row;
}

async function get() {
  if (redis) {
    const raw = await redis.get(KEY);
    if (!raw) return null;
    try {
      return typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch (_) {
      return null;
    }
  }
  return memImage;
}

function publicUrl() {
  const base = config.publicBaseUrl;
  if (!base) return null;
  return `${base.replace(/\/$/, "")}/api/flows/payment-auth/card-image`;
}

async function resolveCardImageUrl() {
  const custom = process.env.CARD_IMAGE_URL;
  if (custom) return custom.replace(/\/$/, "");
  const stored = await get();
  if (stored && publicUrl()) return publicUrl();
  const base = config.publicBaseUrl;
  if (base) return `${base.replace(/\/$/, "")}/assets/punto-pago-card.png`;
  return "https://via.placeholder.com/640x400.png?text=Punto+Pago";
}

module.exports = { save, get, publicUrl, resolveCardImageUrl };
