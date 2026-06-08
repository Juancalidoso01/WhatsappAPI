"use strict";

const TIER_LIMITS = {
  TIER_50: 50,
  TIER_250: 250,
  TIER_2K: 2000,
  TIER_10K: 10000,
  TIER_100K: 100000,
  TIER_UNLIMITED: null,
  UNTIERED: 250,
};

const QUALITY_LABELS = {
  GREEN: { label: "Alta", color: "green", hint: "Buena integridad. Puedes escalar envíos con normalidad." },
  YELLOW: { label: "Media", color: "yellow", hint: "Calidad media. Revisa bloqueos y contenido de plantillas." },
  RED: { label: "Baja", color: "red", hint: "Calidad baja. Riesgo de restricciones; evita campañas agresivas." },
  NA: { label: "Sin datos", color: "muted", hint: "Meta aún no tiene suficiente señal de calidad." },
  UNKNOWN: { label: "Desconocida", color: "muted", hint: "" },
};

function tierLimit(tier) {
  if (!tier) return 250;
  if (tier === "TIER_UNLIMITED") return null;
  return TIER_LIMITS[tier] != null ? TIER_LIMITS[tier] : 250;
}

function tierLabel(tier) {
  const n = tierLimit(tier);
  if (tier === "TIER_UNLIMITED" || n == null) return "Ilimitado";
  return n.toLocaleString("es");
}

function parseLineHealth(raw) {
  const tier = raw.whatsapp_business_manager_messaging_limit
    || raw.messaging_limit_tier
    || "TIER_250";
  const quality = String(raw.quality_rating || "NA").toUpperCase();
  const q = QUALITY_LABELS[quality] || QUALITY_LABELS.UNKNOWN;
  const canSend = !raw.health_status
    || raw.health_status.can_send_message === "AVAILABLE"
    || raw.health_status.can_send_message === true;

  return {
    phoneNumberId: raw.id,
    displayPhone: raw.display_phone_number || null,
    verifiedName: raw.verified_name || null,
    verificationStatus: raw.code_verification_status || null,
    qualityRating: quality,
    qualityLabel: q.label,
    qualityColor: q.color,
    qualityHint: q.hint,
    messagingTier: tier,
    dailyUniqueLimit: tierLimit(tier),
    dailyUniqueLimitLabel: tierLabel(tier),
    canSendMessage: canSend,
    healthStatus: raw.health_status || null,
  };
}

module.exports = { parseLineHealth, tierLimit, tierLabel, QUALITY_LABELS, TIER_LIMITS };
