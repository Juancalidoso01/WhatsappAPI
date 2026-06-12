"use strict";

const FLOW_SKIP_KEYS = new Set([
  "flow_token",
  "flow_id",
  "screen",
  "extension_message_response",
]);

function flowReplyFields(obj) {
  if (!obj || typeof obj !== "object") return [];
  const rows = [];
  const walk = (prefix, value) => {
    if (value == null || value === "") return;
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(`${prefix}[${i}]`, v));
      return;
    }
    if (typeof value === "object") {
      Object.entries(value).forEach(([k, v]) => {
        if (FLOW_SKIP_KEYS.has(k)) return;
        walk(prefix ? `${prefix}.${k}` : k, v);
      });
      return;
    }
    rows.push({ key: prefix, value: String(value) });
  };
  Object.entries(obj).forEach(([k, v]) => {
    if (FLOW_SKIP_KEYS.has(k)) return;
    walk(k, v);
  });
  return rows.slice(0, 12);
}

function extractInteractiveMeta(rawMessage) {
  if (!rawMessage || rawMessage.type !== "interactive") return null;
  const interactive = rawMessage.interactive || {};

  if (interactive.button_reply) {
    const br = interactive.button_reply;
    return {
      kind: "button_reply",
      id: br.id || null,
      title: br.title || "",
    };
  }

  if (interactive.list_reply) {
    const lr = interactive.list_reply;
    return {
      kind: "list_reply",
      id: lr.id || null,
      title: lr.title || "",
      description: lr.description || "",
    };
  }

  if (interactive.type === "nfm_reply" && interactive.nfm_reply) {
    let responseJson = interactive.nfm_reply.response_json;
    if (typeof responseJson === "string") {
      try { responseJson = JSON.parse(responseJson); } catch (_) { /* keep string */ }
    }
    const fields = typeof responseJson === "object" && responseJson
      ? flowReplyFields(responseJson)
      : [];
    return {
      kind: "flow_reply",
      fields,
      raw: typeof responseJson === "object" ? responseJson : { value: responseJson },
    };
  }

  if (interactive.type === "button" && interactive.action && interactive.action.buttons) {
    return {
      kind: "buttons",
      body: (interactive.body && interactive.body.text) || "",
      buttons: (interactive.action.buttons || []).map((b) => ({
        id: (b.reply && b.reply.id) || b.id || "",
        title: (b.reply && b.reply.title) || b.title || "",
      })),
    };
  }

  if (interactive.type === "list" && interactive.action) {
    const sections = (interactive.action.sections || []).map((sec) => ({
      title: sec.title || "",
      rows: (sec.rows || []).map((r) => ({
        id: r.id || "",
        title: r.title || "",
        description: r.description || "",
      })),
    }));
    return {
      kind: "list",
      body: (interactive.body && interactive.body.text) || "",
      button: (interactive.action.button) || "",
      sections,
    };
  }

  return { kind: "unknown" };
}

function interactivePreviewText(meta) {
  if (!meta) return "";
  if (meta.kind === "button_reply") return meta.title || "";
  if (meta.kind === "list_reply") {
    return meta.description ? `${meta.title} — ${meta.description}` : (meta.title || "");
  }
  if (meta.kind === "flow_reply") {
    if (meta.fields && meta.fields.length) {
      return meta.fields.map((f) => `${f.key}: ${f.value}`).join(" · ");
    }
    return "[Flow]";
  }
  if (meta.kind === "buttons" && meta.body) return meta.body;
  if (meta.kind === "list" && meta.body) return meta.body;
  return "";
}

module.exports = {
  extractInteractiveMeta,
  interactivePreviewText,
  flowReplyFields,
};
