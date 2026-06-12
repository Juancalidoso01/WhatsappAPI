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

function isAuthRequired() {
  return Boolean(config.dashboardPassword);
}

function verifyPassword(password) {
  if (!config.dashboardPassword) return false;
  const a = Buffer.from(String(password));
  const b = Buffer.from(String(config.dashboardPassword));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function createSessionToken() {
  return signPayload({
    v: 1,
    iat: Date.now(),
    exp: Date.now() + SESSION_MS,
  });
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

function getSession(req) {
  if (!isAuthRequired()) {
    return { authRequired: false, authenticated: true };
  }
  const token = parseCookies(req)[COOKIE_NAME];
  const payload = verifyToken(token);
  return { authRequired: true, authenticated: Boolean(payload) };
}

function sessionCookieHeader() {
  const token = createSessionToken();
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
  verifyPassword,
  getSession,
  sessionCookieHeader,
  clearSessionCookieHeader,
  requireDashboardAuth,
};
