"use strict";

const { PRODUCTS, productTitle } = require("./flow-quote");
const FlowStore = require("./flow-store");

const DYNAMIC_HANDLERS = [
  { id: "generic", label: "Genérico (eco del formulario)" },
  { id: "quote", label: "Cotización (producto + monto)" },
  { id: "booking", label: "Reservas (estructura Punto Pago)" },
];

function findLastFormScreenIndex(bodyScreens) {
  for (let i = bodyScreens.length - 1; i >= 0; i -= 1) {
    if (bodyScreens[i].type === "form") return i;
  }
  return -1;
}

function validateDynamicDefinition(def) {
  if (!def.dynamic) return { ok: true };
  const bodyScreens = (def.screens || []).filter((s) => s.type !== "confirm");
  const formIdx = findLastFormScreenIndex(bodyScreens);
  if (formIdx < 0) {
    return { ok: false, error: "Un Flow dinámico necesita al menos una pantalla de formulario." };
  }
  const handler = def.dynamicHandler || "generic";
  if (handler === "quote") {
    const fields = bodyScreens[formIdx].fields || [];
    const hasSelect = fields.some((f) => f.type === "select");
    const hasNumber = fields.some((f) => f.type === "number");
    if (!hasSelect || !hasNumber) {
      return {
        ok: false,
        error: "Handler «Cotización» requiere un campo lista (producto) y uno numérico (monto).",
      };
    }
  }
  return { ok: true };
}

function renameScreenId(flowJson, oldId, newId) {
  if (oldId === newId) return;
  const screen = flowJson.screens.find((s) => s.id === oldId);
  if (!screen) return;
  screen.id = newId;
  if (!flowJson.routing_model) return;
  if (flowJson.routing_model[oldId]) {
    flowJson.routing_model[newId] = flowJson.routing_model[oldId].map((id) => (id === oldId ? newId : id));
    delete flowJson.routing_model[oldId];
  }
  Object.keys(flowJson.routing_model).forEach((k) => {
    flowJson.routing_model[k] = flowJson.routing_model[k].map((id) => (id === oldId ? newId : id));
  });
}

function applyQuoteFormSchema(formScreen) {
  formScreen.data = {
    productos: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, title: { type: "string" } },
      },
      __example__: PRODUCTS,
    },
  };
  const form = formScreen.layout.children.find((c) => c.type === "Form");
  if (!form) return;
  const selectField = form.children.find((c) => c.type === "Dropdown");
  if (selectField) {
    selectField["data-source"] = "${data.productos}";
    if (!selectField.name || selectField.name.startsWith("campo_")) selectField.name = "producto";
  }
  const numberField = form.children.find((c) => c.type === "TextInput" && c["input-type"] === "number");
  if (numberField && (!numberField.name || numberField.name.startsWith("campo_"))) numberField.name = "monto";
}

function applyQuoteResultScreen(resultScreen) {
  resultScreen.data = {
    producto_label: { type: "string", __example__: "Crédito personal" },
    monto: { type: "string", __example__: "1000.00" },
    cuota: { type: "string", __example__: "90.00" },
  };
  const footer = resultScreen.layout.children.find((c) => c.type === "Footer") || {
    type: "Footer",
    label: "Confirmar",
  };
  resultScreen.layout.children = [
    { type: "TextHeading", text: "Tu cotización" },
    { type: "TextBody", text: "Producto: ${data.producto_label}" },
    { type: "TextBody", text: "Monto: $${data.monto}" },
    { type: "TextBody", text: "Cuota estimada (12 meses): $${data.cuota}/mes" },
    {
      ...footer,
      label: footer.label || "Confirmar",
      "on-click-action": {
        name: "complete",
        payload: {
          producto: "${data.producto_label}",
          monto: "${data.monto}",
          cuota: "${data.cuota}",
        },
      },
    },
  ];
}

function applyGenericResultScreen(resultScreen, fieldRefs) {
  const dataSchema = {};
  fieldRefs.forEach((f) => {
    dataSchema[f.key] = { type: "string", __example__: "…" };
  });
  resultScreen.data = dataSchema;
  const footer = resultScreen.layout.children.find((c) => c.type === "Footer") || {
    type: "Footer",
    label: "Cerrar",
  };
  const payload = {};
  fieldRefs.forEach((f) => { payload[f.key] = `\${data.${f.key}}`; });
  const staticBlocks = resultScreen.layout.children.filter(
    (c) => c.type !== "Footer" && c.type !== "TextBody" && c.type !== "TextHeading",
  );
  const bodies = fieldRefs.map((f) => ({
    type: "TextBody",
    text: `${f.label || f.key}: \${data.${f.key}}`,
  }));
  resultScreen.layout.children = [
    { type: "TextHeading", text: resultScreen.title || "Resultado" },
    ...staticBlocks,
    ...bodies,
    {
      ...footer,
      "on-click-action": { name: "complete", payload },
    },
  ];
}

function finalizeDynamicFlow(flowJson, opts) {
  const {
    dynamicHandler = "generic",
    dataFormScreenId,
    resultScreenId,
    fieldRefs = [],
  } = opts;

  flowJson.data_api_version = "4.0";

  const formScreen = flowJson.screens.find((s) => s.id === dataFormScreenId);
  const resultScreen = flowJson.screens.find((s) => s.id === resultScreenId);
  if (!formScreen || !resultScreen) return opts;

  const footer = formScreen.layout.children.find((c) => c.type === "Footer");
  if (footer) footer["on-click-action"] = { name: "data_exchange", payload: {} };
  delete formScreen.terminal;
  delete formScreen.success;

  resultScreen.terminal = true;
  resultScreen.success = true;

  if (!flowJson.routing_model) flowJson.routing_model = {};
  flowJson.routing_model[dataFormScreenId] = [resultScreenId];
  flowJson.routing_model[resultScreenId] = [];

  let outFormId = dataFormScreenId;
  let outResultId = resultScreenId;

  if (dynamicHandler === "quote") {
    applyQuoteFormSchema(formScreen);
    applyQuoteResultScreen(resultScreen);
    renameScreenId(flowJson, dataFormScreenId, "DATA");
    renameScreenId(flowJson, resultScreenId, "SUCCESS");
    outFormId = "DATA";
    outResultId = "SUCCESS";
  } else if (dynamicHandler === "generic") {
    applyGenericResultScreen(resultScreen, fieldRefs);
  }

  return {
    ...opts,
    dataFormScreenId: outFormId,
    resultScreenId: outResultId,
  };
}

async function handleStudioGenericFlow(decryptedBody, studioDef) {
  const { action, data, version, flow_token: flowToken } = decryptedBody;
  const resultScreenId = studioDef?.dynamicResultScreen || studioDef?.resultScreenId || "CONFIRM";
  const formScreenId = studioDef?.dataFormScreenId || studioDef?.firstScreenId || "SCREEN_A";
  const fieldKeys = studioDef?.fieldKeys || [];

  if (action === "ping") {
    await FlowStore.recordEndpointEvent({ type: "ping", channel: "studio_generic" });
    return { version, data: { status: "active" } };
  }
  if (data && data.error) {
    await FlowStore.recordEndpointEvent({ type: "error", channel: "studio_generic", error: data.error });
    return { version, data: { acknowledged: true } };
  }
  if (action === "INIT") {
    await FlowStore.recordEndpointEvent({ type: "init", channel: "studio_generic", flowToken });
    return { version, screen: formScreenId, data: {} };
  }
  if (action === "data_exchange") {
    const form = (data && data.form) || data || {};
    const payload = {};
    const keys = fieldKeys.length ? fieldKeys : Object.keys(form);
    keys.forEach((k) => { payload[k] = String(form[k] ?? "—"); });
    await FlowStore.recordEndpointEvent({
      type: "data_exchange",
      channel: "studio_generic",
      flowToken,
      payload,
    });
    return { version, screen: resultScreenId, data: payload };
  }
  return { version, screen: formScreenId, data: {} };
}

async function handleStudioQuoteFlow(decryptedBody) {
  const { action, data, version, flow_token: flowToken } = decryptedBody;

  if (action === "ping") {
    await FlowStore.recordEndpointEvent({ type: "ping", channel: "studio_quote" });
    return { version, data: { status: "active" } };
  }
  if (data && data.error) {
    await FlowStore.recordEndpointEvent({ type: "error", channel: "studio_quote", error: data.error });
    return { version, data: { acknowledged: true } };
  }
  if (action === "INIT") {
    await FlowStore.recordEndpointEvent({ type: "init", channel: "studio_quote", flowToken });
    return { version, screen: "DATA", data: { productos: PRODUCTS } };
  }
  if (action === "data_exchange") {
    const form = (data && data.form) || data || {};
    const producto = form.producto || form.product || "";
    const montoRaw = form.monto || form.amount || "0";
    const monto = Number(String(montoRaw).replace(/[^\d.]/g, "")) || 0;
    const cuota = monto > 0 ? (monto * 1.08 / 12).toFixed(2) : "0.00";
    await FlowStore.recordEndpointEvent({
      type: "data_exchange",
      channel: "studio_quote",
      flowToken,
      producto,
      monto,
      cuota,
    });
    return {
      version,
      screen: "SUCCESS",
      data: {
        producto_label: productTitle(producto),
        monto: monto.toFixed(2),
        cuota,
        flow_token: flowToken,
      },
    };
  }
  return { version, screen: "DATA", data: { productos: PRODUCTS } };
}

module.exports = {
  DYNAMIC_HANDLERS,
  validateDynamicDefinition,
  finalizeDynamicFlow,
  handleStudioGenericFlow,
  handleStudioQuoteFlow,
  findLastFormScreenIndex,
};
