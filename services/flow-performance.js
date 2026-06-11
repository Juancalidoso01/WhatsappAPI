"use strict";

const FlowStore = require("./flow-store");
const PaymentAuthStore = require("./payment-auth-store");

function isPaymentAuthFlow(flow) {
  const name = String((flow && flow.name) || "").toLowerCase();
  return name.includes("autorizacion_pago") || name.includes("payment_auth") || name.includes("3ds");
}

function isBookingFlow(flow) {
  const name = String((flow && flow.name) || "").toLowerCase();
  return name.includes("reserva_cita") || name.includes("booking");
}

async function getFlowPerformance(flowId, flowMeta) {
  const id = String(flowId);
  const sends = (await FlowStore.listSends({ limit: 500 })).filter((s) => String(s.flowId) === id);
  const sendTokens = new Set(sends.map((s) => s.flowToken).filter(Boolean));
  const allResponses = await FlowStore.listResponses({ limit: 500 });
  const responses = allResponses.filter((r) => r.flowToken && sendTokens.has(r.flowToken));
  const events = await FlowStore.listEndpointEvents({ limit: 300 });
  const relatedEvents = events.filter((e) => e.flowToken && sendTokens.has(e.flowToken));
  const inits = relatedEvents.filter((e) => e.type === "init").length;

  let payAuth = [];
  if (isPaymentAuthFlow(flowMeta)) {
    payAuth = (await PaymentAuthStore.listRecent({ limit: 200 })).filter((r) =>
      sends.some((s) => s.flowToken === r.flowToken)
    );
    if (!payAuth.length && isPaymentAuthFlow(flowMeta)) {
      payAuth = await PaymentAuthStore.listRecent({ limit: 30 });
    }
  }

  const authorized = payAuth.filter((r) => r.decision === "authorize").length;
  const denied = payAuth.filter((r) => r.decision === "deny").length;
  const pending = payAuth.filter((r) => r.status === "pending").length;
  const sent = sends.length;
  const responded = responses.length;
  const opened = Math.max(inits, responded, payAuth.filter((r) => r.decision).length);

  return {
    flowId: id,
    isPaymentAuth: isPaymentAuthFlow(flowMeta),
    isBooking: isBookingFlow(flowMeta),
    stats: {
      sent,
      opened,
      responded,
      completionRate: sent ? Math.round((responded / sent) * 100) : 0,
      openRate: sent ? Math.round((opened / sent) * 100) : 0,
      authorized,
      denied,
      pending,
    },
    recentSends: sends.slice(0, 15),
    recentResponses: responses.slice(0, 15),
    recentPayAuth: payAuth.slice(0, 15),
  };
}

module.exports = { getFlowPerformance, isPaymentAuthFlow, isBookingFlow };
