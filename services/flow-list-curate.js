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

/** Flows de producción/prueba que no deben borrarse al limpiar borradores viejos. */
function isProtectedFlow(flow) {
  const name = String(flow.name || "").toLowerCase();
  return /3ds|autorizacion|payment_auth|payauth|verificacion/.test(name);
}

function curateFlowList(flows) {
  const list = Array.isArray(flows) ? flows : [];
  const published = list.filter(isPublished);
  const drafts = list.filter(isDraft).sort((a, b) => flowUpdatedAt(b) - flowUpdatedAt(a));
  const protectedDrafts = drafts.filter(isProtectedFlow);
  const disposableDrafts = drafts.filter((f) => !isProtectedFlow(f));
  const latestDisposable = disposableDrafts.length ? disposableDrafts[0] : null;
  const draftsToDelete = disposableDrafts.slice(1);

  const visible = [...published];
  protectedDrafts.forEach((f) => {
    if (!visible.some((v) => String(v.id) === String(f.id))) visible.push(f);
  });
  if (latestDisposable && !visible.some((v) => String(v.id) === String(latestDisposable.id))) {
    visible.push(latestDisposable);
  }

  visible.sort((a, b) => {
    const pa = isPublished(a) ? 0 : 1;
    const pb = isPublished(b) ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return String(a.name || "").localeCompare(String(b.name || ""), "es");
  });

  const latestDraftId = protectedDrafts[0]
    ? String(protectedDrafts[0].id)
    : (latestDisposable ? String(latestDisposable.id) : null);

  return { visible, draftsToDelete, latestDraftId };
}

module.exports = { curateFlowList, flowUpdatedAt, isDraft, isPublished, isProtectedFlow };
