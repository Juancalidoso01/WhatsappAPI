"use strict";

const redis = require("./upstash");

const KEY = "wa:workspace";
const mem = {
  workspaceName: null,
  displayName: null,
  about: "",
  description: "",
  email: "",
  websites: [],
  portalLanguage: "es",
  profilePhoto: null,
  profilePhotoMime: null,
  updatedAt: 0,
};

function defaults(brandName) {
  return {
    workspaceName: brandName || "Punto Pago",
    displayName: brandName || "Punto Pago",
    about: "",
    description: "",
    email: "",
    websites: [],
    portalLanguage: "es",
    hasProfilePhoto: false,
    updatedAt: 0,
  };
}

function parse(raw, brandName) {
  const base = defaults(brandName);
  if (!raw || !Object.keys(raw).length) return base;
  let websites = [];
  try { websites = JSON.parse(raw.websites || "[]"); } catch (_) {}
  return {
    workspaceName: raw.workspaceName || base.workspaceName,
    displayName: raw.displayName || base.displayName,
    about: raw.about || "",
    description: raw.description || "",
    email: raw.email || "",
    websites,
    portalLanguage: raw.portalLanguage || "es",
    hasProfilePhoto: Boolean(raw.profilePhoto),
    updatedAt: Number(raw.updatedAt || 0),
  };
}

async function getWorkspace(brandName) {
  if (redis) {
    const raw = await redis.hgetall(KEY);
    return parse(raw, brandName);
  }
  return parse(mem, brandName);
}

async function getProfilePhoto() {
  if (redis) {
    const [data, mime] = await Promise.all([
      redis.hget(KEY, "profilePhoto"),
      redis.hget(KEY, "profilePhotoMime"),
    ]);
    if (!data) return null;
    return { data, mime: mime || "image/jpeg" };
  }
  if (!mem.profilePhoto) return null;
  return { data: mem.profilePhoto, mime: mem.profilePhotoMime || "image/jpeg" };
}

async function updateWorkspace(fields, brandName) {
  const current = await getWorkspace(brandName);
  const next = {
    ...current,
    workspaceName: fields.workspaceName != null ? String(fields.workspaceName).trim() : current.workspaceName,
    displayName: fields.displayName != null ? String(fields.displayName).trim() : current.displayName,
    about: fields.about != null ? String(fields.about) : current.about,
    description: fields.description != null ? String(fields.description) : current.description,
    email: fields.email != null ? String(fields.email).trim() : current.email,
    websites: Array.isArray(fields.websites) ? fields.websites.map(String) : current.websites,
    portalLanguage: fields.portalLanguage != null ? String(fields.portalLanguage) : current.portalLanguage,
    updatedAt: Date.now(),
  };

  const stored = {
    workspaceName: next.workspaceName,
    displayName: next.displayName,
    about: next.about,
    description: next.description,
    email: next.email,
    websites: JSON.stringify(next.websites || []),
    portalLanguage: next.portalLanguage,
    updatedAt: String(next.updatedAt),
  };

  if (redis) {
    const existingPhoto = await redis.hget(KEY, "profilePhoto");
    if (existingPhoto) stored.profilePhoto = existingPhoto;
    const existingMime = await redis.hget(KEY, "profilePhotoMime");
    if (existingMime) stored.profilePhotoMime = existingMime;
    await redis.hset(KEY, stored);
  } else {
    Object.assign(mem, next, { websites: next.websites });
    mem.updatedAt = next.updatedAt;
  }

  return { ...next, hasProfilePhoto: Boolean(await getProfilePhoto()) };
}

async function setProfilePhoto(buffer, mimeType) {
  const b64 = buffer.toString("base64");
  const updatedAt = Date.now();
  if (redis) {
    await redis.hset(KEY, {
      profilePhoto: b64,
      profilePhotoMime: mimeType || "image/jpeg",
      updatedAt: String(updatedAt),
    });
  } else {
    mem.profilePhoto = b64;
    mem.profilePhotoMime = mimeType || "image/jpeg";
    mem.updatedAt = updatedAt;
  }
  return { ok: true, updatedAt };
}

async function removeProfilePhoto() {
  if (redis) {
    await redis.hdel(KEY, "profilePhoto", "profilePhotoMime");
  } else {
    mem.profilePhoto = null;
    mem.profilePhotoMime = null;
  }
  return { ok: true };
}

module.exports = {
  getWorkspace,
  getProfilePhoto,
  updateWorkspace,
  setProfilePhoto,
  removeProfilePhoto,
};
