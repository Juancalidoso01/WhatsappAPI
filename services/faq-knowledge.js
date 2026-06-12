"use strict";

const config = require("./config");

function faqBaseUrl() {
  const base = config.faqSiteUrl || "https://faq-sooty-theta.vercel.app";
  return String(base).replace(/\/$/, "");
}

async function searchFaqArticles(query, options = {}) {
  const q = String(query || "").trim();
  if (!q) return [];

  const limit = Math.min(8, Math.max(1, Number(options.limit) || 4));
  const audience = options.audience || "cliente";
  const params = new URLSearchParams({
    q,
    limit: String(limit),
    audience,
  });

  const url = `${faqBaseUrl()}/api/knowledge/search?${params}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(12000),
  });

  if (!res.ok) {
    throw new Error(`FAQ knowledge HTTP ${res.status}`);
  }

  const data = await res.json();
  if (!data.ok || !Array.isArray(data.results)) return [];
  return data.results;
}

function formatFaqContext(articles) {
  if (!articles.length) return "(Sin artículos FAQ relevantes para esta consulta.)";
  return articles
    .map((a, i) => {
      const parts = [
        `### Fuente ${i + 1}: ${a.title}`,
        a.url ? `URL: ${a.url}` : "",
        a.description ? `Resumen: ${a.description}` : "",
        a.contentExcerpt ? `Contenido:\n${a.contentExcerpt}` : "",
      ].filter(Boolean);
      return parts.join("\n");
    })
    .join("\n\n");
}

module.exports = {
  faqBaseUrl,
  searchFaqArticles,
  formatFaqContext,
};
