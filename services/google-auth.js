"use strict";

const crypto = require("crypto");
const config = require("./config");
const dashboardAuth = require("./dashboard-auth");

const STATE_MS = 10 * 60 * 1000;

function isEnabled() {
  return Boolean(
    config.googleClientId
    && config.googleClientSecret
    && config.publicBaseUrl
    && config.dashboardSecret,
  );
}

function allowedDomain() {
  return String(config.allowedEmailDomain || "puntopago.net")
    .toLowerCase()
    .trim()
    .replace(/^@/, "");
}

function isEmailAllowed(email) {
  const normalized = String(email || "").toLowerCase().trim();
  const domain = allowedDomain();
  if (!normalized || !domain) return false;
  return normalized.endsWith(`@${domain}`);
}

function redirectUri() {
  return `${config.publicBaseUrl}/api/auth/google/callback`;
}

function createOAuthState() {
  return dashboardAuth.signPayload({
    purpose: "google_oauth",
    n: crypto.randomBytes(16).toString("hex"),
    exp: Date.now() + STATE_MS,
  });
}

function verifyOAuthState(state) {
  const payload = dashboardAuth.verifyPayload(state);
  if (!payload || payload.purpose !== "google_oauth") return null;
  return payload;
}

function buildAuthorizeUrl(state) {
  const params = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: "openid email profile",
    access_type: "online",
    prompt: "select_account",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function exchangeCode(code) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error_description || data.error || "No se pudo validar con Google.");
  }
  return data;
}

async function fetchUserInfo(accessToken) {
  const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || "No se pudo leer el perfil de Google.");
  }
  return data;
}

async function authenticateCode(code) {
  const tokens = await exchangeCode(code);
  if (!tokens.access_token) {
    throw new Error("Google no devolvió un token de acceso.");
  }
  const user = await fetchUserInfo(tokens.access_token);
  if (!user.email) {
    throw new Error("Tu cuenta de Google no tiene correo asociado.");
  }
  if (user.email_verified === false) {
    throw new Error("Verifica tu correo en Google antes de entrar.");
  }
  if (!isEmailAllowed(user.email)) {
    throw new Error(`Solo cuentas @${allowedDomain()} pueden acceder.`);
  }
  return {
    email: user.email,
    name: user.name || user.email,
    picture: user.picture || null,
    sub: user.sub || null,
  };
}

module.exports = {
  isEnabled,
  allowedDomain,
  isEmailAllowed,
  redirectUri,
  createOAuthState,
  verifyOAuthState,
  buildAuthorizeUrl,
  authenticateCode,
};
