"use strict";

function parseFieldComponent(comp) {
  if (!comp || !comp.type) return null;
  const base = { label: comp.label || "", required: Boolean(comp.required) };
  if (comp.name) base.name = comp.name;

  switch (comp.type) {
    case "TextArea":
      return { ...base, type: "textarea" };
    case "DatePicker":
      return { ...base, type: "date" };
    case "CalendarPicker":
      return { ...base, type: "calendar", calendarMode: comp.mode === "range" ? "range" : "single" };
    case "OptIn":
      return { ...base, type: "optin" };
    case "Dropdown": {
      const opts = (comp["data-source"] || []).map((o) => o.title || o.id).filter(Boolean);
      return { ...base, type: "select", options: opts };
    }
    case "CheckboxGroup": {
      const opts = (comp["data-source"] || []).map((o) => o.title || o.id).filter(Boolean);
      return { ...base, type: "checkbox", options: opts };
    }
    case "RadioButtonsGroup": {
      const src = comp["data-source"] || [];
      const ids = src.map((o) => String(o.id || "").toLowerCase());
      if (ids.includes("si") && ids.includes("no")) return { ...base, type: "yesno" };
      if (src.length === 5 && src.every((o) => /^[1-5]$/.test(String(o.id)))) {
        return { ...base, type: "rating" };
      }
      const opts = src.map((o) => o.title || o.id).filter(Boolean);
      return { ...base, type: "select", options: opts };
    }
    case "TextInput": {
      const it = comp["input-type"] || "text";
      if (it === "email") return { ...base, type: "email" };
      if (it === "phone") return { ...base, type: "phone" };
      if (it === "number") return { ...base, type: "number" };
      return { ...base, type: "text" };
    }
    default:
      return null;
  }
}

function parseContentBlock(comp) {
  if (!comp || !comp.type) return null;
  if (comp.type === "TextHeading") return { type: "heading", text: comp.text || "" };
  if (comp.type === "TextSubheading") return { type: "subheading", text: comp.text || "" };
  if (comp.type === "TextBody") {
    return { type: "body", text: comp.text || "", emphasis: comp["font-weight"] || "normal" };
  }
  if (comp.type === "TextCaption") {
    return { type: "caption", text: comp.text || "", emphasis: comp["font-weight"] || "normal" };
  }
  if (comp.type === "RichText") {
    return { type: "richtext", markdown: comp.text || "" };
  }
  if (comp.type === "Image") {
    return {
      type: "image",
      src: comp.src || "",
      altText: comp["alt-text"] || "",
      scaleType: comp["scale-type"] === "cover" ? "cover" : "contain",
      previewUrl: comp.src && String(comp.src).startsWith("data:") ? comp.src : "",
    };
  }
  if (comp.type === "ImageCarousel") {
    const images = (comp.images || []).map((img) => ({
      type: "image",
      src: img.src || "",
      altText: img["alt-text"] || "",
      scaleType: comp["scale-type"] === "cover" ? "cover" : "contain",
      previewUrl: img.src && String(img.src).startsWith("data:") ? img.src : "",
    }));
    return {
      type: "carousel",
      scaleType: comp["scale-type"] === "cover" ? "cover" : "contain",
      images,
    };
  }
  if (comp.type === "EmbeddedLink") {
    const action = comp["on-click-action"] || {};
    return {
      type: "link",
      text: comp.text || "",
      url: action.url || "",
    };
  }
  return null;
}

function parseScreen(screen, { isConfirm, nextTarget }) {
  const children = (screen.layout && screen.layout.children) || [];
  const footer = children.find((c) => c.type === "Footer");
  const form = children.find((c) => c.type === "Form");
  const contentChildren = children.filter((c) =>
    c.type !== "Footer" && c.type !== "Form"
  );

  const blocks = contentChildren.map(parseContentBlock).filter(Boolean);
  const fields = form && Array.isArray(form.children)
    ? form.children.map(parseFieldComponent).filter(Boolean)
    : [];

  const scr = {
    title: screen.title || "",
    buttonLabel: footer?.label || "",
    blocks,
    fields,
    nextTarget: nextTarget || undefined,
  };

  if (isConfirm || (screen.terminal && screen.success && !form)) {
    scr.layout = "confirm";
    scr.type = "confirm";
  } else if (form || fields.length) {
    scr.layout = "form";
    scr.type = "form";
  } else {
    scr.layout = "message";
    scr.type = "message";
  }

  if (footer?.["on-click-action"]?.name === "complete") {
    scr.buttonAction = "complete";
  } else {
    scr.buttonAction = "next";
  }

  return scr;
}

function isConfirmScreen(screen) {
  if (!screen || !screen.terminal || !screen.success) return false;
  if (screen.id === "CONFIRM") return true;
  const children = (screen.layout && screen.layout.children) || [];
  return !children.some((c) => c.type === "Form");
}

function resolveNextTarget(screenId, routing, confirmId, bodyScreens) {
  const next = (routing[screenId] || [])[0];
  if (!next) return "complete";
  if (confirmId && next === confirmId) return "confirm";
  const idx = bodyScreens.findIndex((s) => s.id === next);
  if (idx >= 0) return String(idx);
  return "next";
}

function importFlowJson(flowJson) {
  if (!flowJson || !Array.isArray(flowJson.screens) || !flowJson.screens.length) {
    return { ok: false, error: "Flow JSON sin pantallas." };
  }

  const isDynamic = Boolean(flowJson.data_api_version);
  const routing = flowJson.routing_model || {};
  const confirmScreen = flowJson.screens.find((s) => isConfirmScreen(s));
  const confirmId = confirmScreen && confirmScreen.id;

  const bodyScreens = flowJson.screens.filter((s) => s.id !== confirmId);
  const screens = bodyScreens.map((s) => parseScreen(s, {
    isConfirm: false,
    nextTarget: resolveNextTarget(s.id, routing, confirmId, bodyScreens),
  }));

  if (confirmScreen) {
    screens.push(parseScreen(confirmScreen, { isConfirm: true, nextTarget: "complete" }));
  } else if (screens.length) {
    const last = screens[screens.length - 1];
    if (last.type === "message") last.buttonAction = "complete";
  }

  return {
    ok: true,
    screens,
    partial: isDynamic,
    dynamic: isDynamic,
    version: flowJson.version || null,
  };
}

module.exports = {
  importFlowJson,
};
