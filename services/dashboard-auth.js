"use strict";

const crypto = require("crypto");
const config = require("./config");

const COOKIE_NAME = "pp_dashboard_session";
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

function dashboardSecret() {
  return config.dashboardSecret;
}

function signPayload(payload) {
  const secret = dashboardSecret();
  if (!secret) return null;
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verifyPayload(token) {
  return verifyToken(token);
}

function verifyToken(token) {
  const secret = dashboardSecret();
  if (!token || !secret) return null;
  const parts = String(token).split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  } catch (_) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

function isGoogleAuthConfigured() {
  return Boolean(
    config.googleClientId
    && config.googleClientSecret
    && config.publicBaseUrl,
  );
}

function isAuthRequired() {
  return Boolean(config.dashboardPassword) || isGoogleAuthConfigured();
}

function verifyPassword(password) {
  if (!config.dashboardPassword) return false;
  const a = Buffer.from(String(password));
  const b = Buffer.from(String(config.dashboardPassword));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function createSessionToken(user) {
  const payload = {
    v: 2,
    iat: Date.now(),
    exp: Date.now() + SESSION_MS,
    authMethod: (user && user.authMethod) || "password",
  };
  if (user && user.email) {
    payload.email = String(user.email);
    payload.name = String(user.name || user.email);
    if (user.picture) payload.picture = String(user.picture);
    if (user.sub) payload.sub = String(user.sub);
  }
  return signPayload(payload);
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const out = {};
  header.split(";").forEach((part) => {
    const [k, ...rest] = part.trim().split("=");
    if (k) out[k] = decodeURIComponent(rest.join("="));
  });
  return out;
}

function sessionUserFromPayload(payload) {
  if (!payload) return null;
  if (payload.email) {
    return {
      email: payload.email,
      name: payload.name || payload.email,
      picture: payload.picture || null,
      authMethod: payload.authMethod || "google",
    };
  }
  if (payload.authMethod === "password") {
    return { authMethod: "password" };
  }
  return null;
}

function getSession(req) {
  if (!isAuthRequired()) {
    return { authRequired: false, authenticated: true, user: null };
  }
  const token = parseCookies(req)[COOKIE_NAME];
  const payload = verifyToken(token);
  const authenticated = Boolean(payload);
  return {
    authRequired: true,
    authenticated,
    user: authenticated ? sessionUserFromPayload(payload) : null,
  };
}

function sessionCookieHeader(user) {
  const token = createSessionToken(user);
  const parts = [
    `${COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_MS / 1000)}`,
  ];
  if (config.isProduction) parts.push("Secure");
  return parts.join("; ");
}

function clearSessionCookieHeader() {
  const parts = [`${COOKIE_NAME}=`, "Path=/", "HttpOnly", "Max-Age=0"];
  if (config.isProduction) parts.push("Secure");
  return parts.join("; ");
}

function isPublicApiPath(req) {
  const path = req.path || "";
  const method = (req.method || "GET").toUpperCase();

  if (path === "/api/health" && method === "GET") return true;
  if (path === "/api/config" && method === "GET") return true;
  if (path === "/api/auth/login" && method === "POST") return true;
  if (path === "/api/auth/session" && method === "GET") return true;
  if (path === "/api/auth/google" && method === "GET") return true;
  if (path === "/api/auth/google/callback" && method === "GET") return true;
  if (path === "/api/campaigns/cron/tick" && method === "POST") return true;

  // Meta Flow data endpoint (signed by Meta, not dashboard session)
  if (path === "/api/flows/endpoint" && method === "POST") return true;

  // External CRM / ERP (uses X-API-Key on each route)
  if (path.startsWith("/api/integrations/")) return true;
  if (path === "/api/bookings/slots/sync" && method === "POST") return true;

  return false;
}

function requireDashboardAuth(req, res, next) {
  if (!req.path.startsWith("/api/")) return next();
  if (isPublicApiPath(req)) return next();
  if (!isAuthRequired()) return next();

  const session = getSession(req);
  if (session.authenticated) return next();

  return res.status(401).json({
    ok: false,
    error: "Sesión requerida. Inicia sesión en el panel.",
    code: "AUTH_REQUIRED",
  });
}

module.exports = {
  COOKIE_NAME,
  isAuthRequired,
  isGoogleAuthConfigured,
  verifyPassword,
  signPayload,
  verifyPayload,
  getSession,
  sessionCookieHeader,
  clearSessionCookieHeader,
  requireDashboardAuth,
};
