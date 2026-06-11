"use strict";

const config = require("./config");
const FlowStore = require("./flow-store");
const PaymentAuthStore = require("./payment-auth-store");
const CardImageStore = require("./card-image-store");
const BookingStore = require("./booking-store");
const bookingFlow = require("./flow-booking");
const { PRODUCTS, productTitle } = require("./flow-quote");

function isPaymentAuthToken(flowToken) {
  return flowToken && String(flowToken).startsWith("payauth_");
}

function isBookingToken(flowToken) {
  return flowToken && String(flowToken).startsWith("booking_");
}

function isBookingRequest(decryptedBody) {
  const { screen, data } = decryptedBody || {};
  if (screen === "BOOK") return true;
  const payload = (data && data.form) || data || {};
  const action = payload.component_action || payload.componentAction;
  return action === "update_date" || action === "confirm";
}

function formatWhen(ts) {
  try {
    return new Date(ts).toLocaleString("es-PA", { dateStyle: "medium", timeStyle: "short" });
  } catch (_) {
    try {
      return new Date(ts).toLocaleString("es", { dateStyle: "medium", timeStyle: "short" });
    } catch (_2) {
      return new Date(ts).toISOString();
    }
  }
}

function cardImageUrl() {
  return config.cardImageUrl || "https://via.placeholder.com/640x400.png?text=Punto+Pago";
}

async function buildPaymentAuthScreenData(txn) {
  const card_image = await CardImageStore.resolveCardImageSrc();
  return {
    merchant: txn.merchant,
    amount: `${txn.currency} ${txn.amount}`,
    card_label: `Tarjeta Punto Pago •••• ${txn.cardLast4}`,
    card_image,
    when: formatWhen(txn.createdAt),
  };
}

async function handlePaymentAuth(decryptedBody) {
  const { action, data, version, flow_token: flowToken } = decryptedBody;

  if (action === "ping") {
    await FlowStore.recordEndpointEvent({ type: "ping", channel: "payment_auth" });
    return { version, data: { status: "active" } };
  }

  if (data && data.error) {
    await FlowStore.recordEndpointEvent({ type: "error", channel: "payment_auth", error: data.error });
    return { version, data: { acknowledged: true } };
  }

  const txn = await PaymentAuthStore.get(flowToken);
  if (!txn) {
    await FlowStore.recordEndpointEvent({ type: "error", channel: "payment_auth", error: "expired_token" });
    return {
      version,
      screen: "RESULT",
      data: {
        result_title: "Solicitud expirada",
        result_body: "Esta verificación ya no está disponible. Solicita un nuevo enlace desde Punto Pago.",
        decision: "expired",
        merchant: "—",
        amount: "—",
      },
    };
  }

  if (action === "INIT") {
    await FlowStore.recordEndpointEvent({ type: "init", channel: "payment_auth", flowToken, phone: txn.phone });
    return {
      version,
      screen: "AUTH",
      data: await buildPaymentAuthScreenData(txn),
    };
  }

  if (action === "data_exchange") {
    const form = (data && data.form) || data || {};
    const decision = form.decision === "authorize" ? "authorize" : "deny";
    const resolved = await PaymentAuthStore.resolve(flowToken, decision);

    await FlowStore.recordEndpointEvent({
      type: "data_exchange",
      channel: "payment_auth",
      flowToken,
      decision,
      merchant: txn.merchant,
      amount: txn.amount,
    });

    const authorized = decision === "authorize";
    return {
      version,
      screen: "RESULT",
      data: {
        result_title: authorized ? "Pago aprobado" : "Transacción rechazada",
        result_body: authorized
          ? "El comercio procesará tu pago en breve. Recibirás la confirmación por los canales habituales."
          : "El pago no se procesó. Si no reconoces esta compra, contáctanos de inmediato.",
        decision,
        merchant: txn.merchant,
        amount: `${txn.currency} ${resolved ? resolved.amount : txn.amount}`,
      },
    };
  }

  return {
    version,
    screen: "AUTH",
    data: await buildPaymentAuthScreenData(txn),
  };
}

async function resolveCardImageUrl() {
  return CardImageStore.resolveCardImageUrl();
}

async function handleBookingFlow(decryptedBody) {
  const { action, data, version, flow_token: flowToken } = decryptedBody;

  if (action === "ping") {
    await FlowStore.recordEndpointEvent({ type: "ping", channel: "booking" });
    return { version, data: { status: "active" } };
  }

  if (data && data.error) {
    await FlowStore.recordEndpointEvent({ type: "error", channel: "booking", error: data.error });
    return { version, data: { acknowledged: true } };
  }

  if (action === "INIT") {
    let session = await BookingStore.get(flowToken);
    if (!session) {
      session = await BookingStore.create({ flowToken });
    }
    await FlowStore.recordEndpointEvent({ type: "init", channel: "booking", flowToken });
    return {
      version,
      screen: "BOOK",
      data: bookingFlow.initScreenData(),
    };
  }

  if (action === "data_exchange") {
    const payload = (data && data.form) || data || {};
    const componentAction = payload.component_action || payload.componentAction;

    if (componentAction === "update_date") {
      const fecha = payload.fecha || "";
      const sucursal = payload.sucursal || "centro";
      const slots = bookingFlow.slotsScreenData(fecha, sucursal);

      await FlowStore.recordEndpointEvent({
        type: "data_exchange",
        channel: "booking",
        flowToken,
        action: "update_date",
        fecha,
        sucursal,
        slots: slots.available_slots.length,
      });

      return {
        version,
        screen: "BOOK",
        data: slots,
      };
    }

    if (componentAction === "confirm") {
      const fecha = payload.fecha || "";
      const sucursal = payload.sucursal || "";
      const horario = payload.horario || "";
      const nombre = payload.nombre || "";
      const horarioLabel = bookingFlow.slotTitle(horario);
      const sucursalLabel = bookingFlow.branchTitle(sucursal);
      const fechaLabel = bookingFlow.formatDateLabel(fecha);

      await BookingStore.confirm(flowToken, {
        branchId: sucursal,
        date: fecha,
        slotId: horario,
        slotLabel: horarioLabel,
        customerName: nombre,
      });

      await FlowStore.recordEndpointEvent({
        type: "data_exchange",
        channel: "booking",
        flowToken,
        action: "confirm",
        fecha,
        sucursal,
        horario,
        nombre,
      });

      const resumen = nombre
        ? `${nombre}, tu cita en ${sucursalLabel} el ${fechaLabel} a las ${horarioLabel} quedó registrada.`
        : `Tu cita en ${sucursalLabel} el ${fechaLabel} a las ${horarioLabel} quedó registrada.`;

      return {
        version,
        screen: "SUCCESS",
        data: {
          resumen,
          sucursal_label: sucursalLabel,
          fecha_label: fechaLabel,
          horario_label: horarioLabel,
          nombre: nombre || "—",
        },
      };
    }
  }

  return {
    version,
    screen: "BOOK",
    data: bookingFlow.initScreenData(),
  };
}

async function handleQuoteFlow(decryptedBody) {
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
      data: { productos: PRODUCTS },
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

async function handleFlowRequest(decryptedBody) {
  const { flow_token: flowToken } = decryptedBody;
  if (isPaymentAuthToken(flowToken)) {
    return handlePaymentAuth(decryptedBody);
  }
  if (isBookingToken(flowToken) || isBookingRequest(decryptedBody)) {
    return handleBookingFlow(decryptedBody);
  }
  return handleQuoteFlow(decryptedBody);
}

module.exports = {
  handleFlowRequest,
  isPaymentAuthToken,
  isBookingToken,
  cardImageUrl,
  resolveCardImageUrl,
  buildPaymentAuthScreenData,
  formatWhen,
};
