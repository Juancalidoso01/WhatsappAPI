"use strict";

const FlowStore = require("./flow-store");

const PRODUCTS = [
  { id: "credito", title: "Crédito personal" },
  { id: "tarjeta", title: "Tarjeta de crédito" },
  { id: "seguro", title: "Seguro" },
];

function productTitle(id) {
  const p = PRODUCTS.find((x) => x.id === id);
  return p ? p.title : id || "—";
}

async function handleFlowRequest(decryptedBody) {
  const { action, screen, data, version, flow_token: flowToken } = decryptedBody;

  if (action === "ping") {
    await FlowStore.recordEndpointEvent({ type: "ping" });
    return { version, data: { status: "active" } };
  }

  if (data && data.error) {
    await FlowStore.recordEndpointEvent({ type: "error", error: data.error });
    return { version, data: { acknowledged: true } };
  }

  if (action === "INIT") {
    await FlowStore.recordEndpointEvent({ type: "init", flowToken });
    return {
      version,
      screen: "DATA",
      data: {
        productos: PRODUCTS,
      },
    };
  }

  if (action === "data_exchange") {
    const form = (data && data.form) || data || {};
    const producto = form.producto || form.product || "";
    const montoRaw = form.monto || form.amount || "0";
    const monto = Number(String(montoRaw).replace(/[^\d.]/g, "")) || 0;
    const cuota = monto > 0 ? (monto * 1.08 / 12).toFixed(2) : "0.00";

    await FlowStore.recordEndpointEvent({
      type: "data_exchange",
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

  return {
    version,
    screen: screen || "DATA",
    data: { productos: PRODUCTS },
  };
}

module.exports = { handleFlowRequest, PRODUCTS };
