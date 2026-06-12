"use strict";

const ORG_ID = "whatsapp-business-api";
const META_STATUS_BASE = "https://metastatus.com";
const CACHE_TTL_MS = 3 * 60 * 1000;

/** Services we surface in the dashboard (ids from metastatus.com/data/orgs.json). */
const RELEVANT_SERVICE_IDS = new Set([4, 6, 7, 1, 8]);

let cache = { at: 0, data: null };

function normalizeStatus(raw) {
  const s = String(raw || "").toLowerCase();
  if (!s || s.includes("no known issues")) return "operational";
  if (s.includes("resolved")) return "operational";
  if (s.includes("high disruption")) return "major";
  if (s.includes("disruption") || s.includes("degraded")) return "degraded";
  return "unknown";
}

function statusLevel(status) {
  if (status === "operational") return "ok";
  if (status === "major") return "error";
  if (status === "degraded") return "warn";
  return "info";
}

function serviceKey(name) {
  const n = String(name || "").toLowerCase();
  if (n.includes("cloud api") && !n.includes("calling")) return "cloudApi";
  if (n.includes("calling")) return "cloudApiCalling";
  if (n.includes("flows")) return "flows";
  if (n.includes("marketing")) return "marketing";
  if (n.includes("account management")) return "waba";
  return n.replace(/[^a-z0-9]+/g, "_").slice(0, 32);
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

function mapOrg(org, outages) {
  const serviceMap = new Map((org.services || []).map((s) => [s.id, s.name]));
  const relevant = (org.services || [])
    .filter((s) => RELEVANT_SERVICE_IDS.has(s.id))
    .map((s) => ({
      id: s.id,
      key: serviceKey(s.name),
      name: s.name,
      status: normalizeStatus(s.status),
      statusRaw: s.status,
      level: statusLevel(normalizeStatus(s.status)),
      updatedAt: s.time || null,
    }));

  const activeOutages = (outages || [])
    .filter((o) => o.status && !String(o.status).toLowerCase().includes("resolved"))
    .map((o) => {
      const posts = o.posts || [];
      const latest = posts.length ? posts[posts.length - 1] : null;
      return {
        serviceId: o.service_id,
        serviceName: serviceMap.get(o.service_id) || null,
        status: o.status,
        description: latest ? latest.description : null,
        time: o.time || (latest && latest.time) || null,
      };
    });

  const rank = { operational: 0, unknown: 1, degraded: 2, major: 3 };
  const overall = relevant.reduce(
    (acc, s) => (rank[s.status] > rank[acc] ? s.status : acc),
    "operational",
  );

  const rssFile = (org.rss_file_paths || [])[0] || `outage-events-feed-${ORG_ID}.rss`;

  return {
    ok: true,
    orgId: org.id,
    orgName: org.name,
    pageUrl: `${META_STATUS_BASE}/${ORG_ID}`,
    rssUrl: `${META_STATUS_BASE}/${rssFile}`,
    docsUrl: "https://developers.facebook.com/docs/whatsapp/support-api-status-page",
    fetchedAt: Date.now(),
    overall,
    overallLevel: statusLevel(overall),
    services: relevant,
    outages: activeOutages,
  };
}

async function getMetaPlatformStatus({ force = false } = {}) {
  const now = Date.now();
  if (!force && cache.data && now - cache.at < CACHE_TTL_MS) {
    return cache.data;
  }

  try {
    const orgs = await fetchJson(`${META_STATUS_BASE}/data/orgs.json`);
    const org = orgs.find((o) => o.id === ORG_ID);
    if (!org) {
      return { ok: false, error: "WhatsApp Business Platform not found on metastatus.com" };
    }

    let outages = [];
    try {
      outages = await fetchJson(`${META_STATUS_BASE}/data/outages/${ORG_ID}.json`);
    } catch (_) { /* optional */ }

    const data = mapOrg(org, outages);
    cache = { at: now, data };
    return data;
  } catch (err) {
    if (cache.data) {
      return { ...cache.data, stale: true, fetchError: String(err.message || err) };
    }
    return { ok: false, error: String(err.message || err) };
  }
}

module.exports = { getMetaPlatformStatus };
