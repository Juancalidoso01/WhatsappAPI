"use strict";

/** Flows publicados + el borrador más reciente; el resto de borradores son intentos de prueba. */

function flowUpdatedAt(flow) {
  const raw = flow.updated_time || flow.last_updated_time;
  if (raw) {
    const n = typeof raw === "number" ? raw * 1000 : Date.parse(raw);
    if (!Number.isNaN(n)) return n;
  }
  const idDigits = String(flow.id || "").replace(/\D/g, "");
  if (idDigits) {
    const n = Number(idDigits);
    if (Number.isFinite(n)) return n;
  }
  const nameMatch = String(flow.name || "").match(/(\d{10,})$/);
  if (nameMatch) return Number(nameMatch[1]);
  return 0;
}

function isDraft(flow) {
  return String(flow.status || "").toUpperCase() === "DRAFT";
}

function isPublished(flow) {
  return String(flow.status || "").toUpperCase() === "PUBLISHED";
}

function curateFlowList(flows) {
  const list = Array.isArray(flows) ? flows : [];
  const published = list.filter(isPublished);
  const drafts = list.filter(isDraft).sort((a, b) => flowUpdatedAt(b) - flowUpdatedAt(a));
  const latestDraft = drafts.length ? drafts[0] : null;
  const draftsToDelete = drafts.slice(1);

  const visible = [...published];
  if (latestDraft) visible.push(latestDraft);

  visible.sort((a, b) => {
    const pa = isPublished(a) ? 0 : 1;
    const pb = isPublished(b) ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return String(a.name || "").localeCompare(String(b.name || ""), "es");
  });

  return { visible, draftsToDelete, latestDraftId: latestDraft ? String(latestDraft.id) : null };
}

module.exports = { curateFlowList, flowUpdatedAt, isDraft, isPublished };
