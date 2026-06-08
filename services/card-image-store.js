"use strict";

const fs = require("fs");
const path = require("path");
const redis = require("./upstash");
const config = require("./config");

const KEY = "wa:payauth:card_image";
const DEFAULT_CARD_PATH = path.join(__dirname, "..", "public", "assets", "punto-pago-card.png");
let memImage = null;
let defaultBase64Cache = null;

function loadDefaultBase64() {
  if (defaultBase64Cache) return defaultBase64Cache;
  try {
    defaultBase64Cache = fs.readFileSync(DEFAULT_CARD_PATH).toString("base64");
  } catch (_) {
    defaultBase64Cache = "";
  }
  return defaultBase64Cache;
}

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
  const base = config.publicBaseUrl;
  if (!base) return "https://via.placeholder.com/640x400.png?text=Punto+Pago";
  const root = base.replace(/\/$/, "");
  const stored = await get();
  if (stored) return `${root}/api/flows/payment-auth/card-image`;
  return `${root}/assets/punto-pago-card.png`;
}

/** Base64 para el componente Image del Flow (Meta no siempre puede cargar URLs externas). */
async function resolveCardImageSrc() {
  const stored = await get();
  if (stored && stored.data) return stored.data;
  const b64 = loadDefaultBase64();
  if (b64) return b64;
  return resolveCardImageUrl();
}

module.exports = { save, get, publicUrl, resolveCardImageUrl, resolveCardImageSrc, loadDefaultBase64 };
