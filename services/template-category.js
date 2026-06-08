"use strict";

const LABELS = {
  MARKETING: "Marketing",
  UTILITY: "Utilidad",
  AUTHENTICATION: "Autenticación",
  AUTHENTICATION_INTERNATIONAL: "Autenticación internacional",
  SERVICE: "Servicio",
};

function normalize(cat) {
  if (cat == null || cat === "") return null;
  return String(cat).toUpperCase().trim();
}

function label(cat) {
  const n = normalize(cat);
  if (!n) return "—";
  return LABELS[n] || n.charAt(0) + n.slice(1).toLowerCase();
}

function analyzeCategory({ category, correct_category, requestedCategory, pendingCategory } = {}) {
  const current = normalize(category);
  const correct = normalize(correct_category);
  const requested = normalize(requestedCategory);
  const pending = normalize(pendingCategory);

  let status = "matched";
  let hint = null;
  let impactsBilling = false;

  if (correct && current && correct !== current) {
    status = "pending_reclass";
    impactsBilling = true;
    hint = `WhatsApp reclasificará esta plantilla de ${label(current)} a ${label(correct)}. Hasta entonces se factura como ${label(current)}.`;
  } else if (pending && current && pending !== current) {
    status = "pending_reclass";
    impactsBilling = true;
    hint = `Cambio de categoría anunciado: de ${label(current)} a ${label(pending)}.`;
  } else if (requested && current && requested !== current) {
    status = "reclassified";
    impactsBilling = true;
    hint = `Solicitaste ${label(requested)} pero Meta la clasificó como ${label(current)}. La facturación usa la categoría de Meta.`;
  } else if (!current) {
    status = "unknown";
  }

  const billingCategory = current || correct || requested || null;

  return {
    current,
    currentLabel: label(current),
    correct: correct || pending || null,
    correctLabel: label(correct || pending),
    requested: requested || null,
    requestedLabel: label(requested),
    billingCategory,
    billingLabel: label(billingCategory),
    status,
    statusLabel: statusLabel(status),
    hint,
    impactsBilling,
  };
}

function statusLabel(status) {
  switch (status) {
    case "pending_reclass": return "Reclasificación pendiente";
    case "reclassified": return "Categoría distinta a la solicitada";
    case "matched": return "Categoría alineada";
    default: return "Sin categoría";
  }
}

/** Best-effort baseline for templates created before we tracked requestedCategory. */
function inferRequestedCategory(template, local = {}) {
  if (local.requestedCategory) return normalize(local.requestedCategory);

  const current = normalize(template && template.category);
  const correct = normalize(template && template.correct_category);

  if (local.previousCategory) return normalize(local.previousCategory);
  if (correct && current && correct !== current) return current;
  if (local.lastAssignedCategory) return normalize(local.lastAssignedCategory);

  return current;
}

function summarizeTemplates(templates) {
  const list = templates || [];
  return {
    total: list.length,
    pendingReclass: list.filter((t) => t.categoryInfo && t.categoryInfo.status === "pending_reclass").length,
    reclassified: list.filter((t) => t.categoryInfo && t.categoryInfo.status === "reclassified").length,
    withBillingImpact: list.filter((t) => t.categoryInfo && t.categoryInfo.impactsBilling).length,
  };
}

module.exports = {
  LABELS,
  normalize,
  label,
  analyzeCategory,
  inferRequestedCategory,
  statusLabel,
  summarizeTemplates,
};
