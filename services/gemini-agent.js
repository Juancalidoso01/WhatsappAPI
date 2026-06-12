"use strict";

const config = require("./config");

function resolveGoogleApiKey() {
  return (
    config.geminiApiKey
    || process.env.GOOGLE_GENERATIVE_AI_API_KEY
    || process.env.GEMINI_API_KEY
    || process.env.GOOGLE_API_KEY
    || null
  );
}

function isFaqProxyConfigured() {
  return Boolean(config.faqSiteUrl && config.faqAgentSecret);
}

function isConfigured() {
  return Boolean(resolveGoogleApiKey()) || isFaqProxyConfigured();
}

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    reply: {
      type: "string",
      description: "Respuesta corta para WhatsApp (máx. 900 caracteres). Tono Punto Pago.",
    },
    escalate: {
      type: "boolean",
      description: "true si debe pasar a un agente humano.",
    },
    escalationReason: {
      type: "string",
      description: "Motivo breve de escalamiento, o cadena vacía.",
    },
    confidence: {
      type: "number",
      description: "Confianza 0-1 de que la respuesta es correcta según el FAQ.",
    },
    sources: {
      type: "array",
      items: { type: "string" },
      description: "Slugs de artículos FAQ usados.",
    },
    internalNote: {
      type: "string",
      description: "Nota interna para el equipo (no enviar al cliente), o vacío.",
    },
  },
  required: ["reply", "escalate", "escalationReason", "confidence", "sources"],
};

function buildSystemPrompt(ai, corrections) {
  const lines = [
    `Rol: ${ai.role || "Asistente virtual de Punto Pago"}.`,
    "Eres el asistente de WhatsApp Business de Punto Pago (fintech en Panamá).",
    "Responde en español neutro de Panamá, claro y breve (mensaje de chat, no email).",
    "Usa SOLO la información del FAQ proporcionado. No inventes montos, plazos, requisitos ni políticas.",
    "Si el FAQ no alcanza para responder con certeza, marca escalate=true.",
    "Si el usuario pide agente humano o muestra frustración extrema, marca escalate=true.",
    "Incluye en sources los slugs de artículos que usaste.",
  ];

  if (ai.instructions && String(ai.instructions).trim()) {
    lines.push("", "Instrucciones adicionales del equipo:", String(ai.instructions).trim());
  }

  const corr = (corrections || []).slice(0, 15);
  if (corr.length) {
    lines.push("", "Correcciones aprendidas (prioridad alta):");
    corr.forEach((c) => {
      lines.push(`- Cuando: «${c.when}» → Responder/mejorar: «${c.prefer}»`);
    });
  }

  return lines.join("\n");
}

function buildUserPrompt({ message, contactName, faqContext, history }) {
  const hist = (history || [])
    .slice(-6)
    .map((m) => `${m.direction === "out" ? "Empresa" : "Cliente"}: ${m.text}`)
    .join("\n");

  return [
    contactName ? `Contacto: ${contactName}` : "",
    hist ? `Historial reciente:\n${hist}` : "",
    "",
    "Mensaje actual del cliente:",
    message,
    "",
    "=== BASE DE CONOCIMIENTO (FAQ Punto Pago) ===",
    faqContext,
    "",
    "Genera la respuesta JSON según el esquema.",
  ].filter(Boolean).join("\n");
}

function normalizeReply(parsed) {
  return {
    reply: String(parsed.reply || "").trim().slice(0, 900),
    escalate: Boolean(parsed.escalate),
    escalationReason: String(parsed.escalationReason || "").trim(),
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
    sources: Array.isArray(parsed.sources) ? parsed.sources.map(String) : [],
    internalNote: String(parsed.internalNote || "").trim(),
  };
}

async function generateViaFaqProxy(input) {
  const url = `${config.faqSiteUrl.replace(/\/$/, "")}/api/agent/reply`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${config.faqAgentSecret}`,
    },
    body: JSON.stringify({
      ai: input.ai || {},
      corrections: input.corrections || [],
      message: input.message,
      contactName: input.contactName,
      faqContext: input.faqContext,
      history: input.history,
    }),
    signal: AbortSignal.timeout(28000),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `FAQ agent HTTP ${res.status}`);
  }
  return normalizeReply(data);
}

async function generateDirect(input, apiKey) {
  const model = config.geminiModel || "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const system = buildSystemPrompt(input.ai || {}, input.corrections);
  const prompt = buildUserPrompt(input);

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.25,
        maxOutputTokens: 1024,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    }),
    signal: AbortSignal.timeout(25000),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error?.message || data.error || `Gemini HTTP ${res.status}`;
    throw new Error(msg);
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini no devolvió contenido.");

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (_) {
    throw new Error("Respuesta IA inválida (JSON).");
  }

  return normalizeReply(parsed);
}

async function generateAgentReply(input) {
  const apiKey = resolveGoogleApiKey();
  if (apiKey) {
    return generateDirect(input, apiKey);
  }
  if (isFaqProxyConfigured()) {
    return generateViaFaqProxy(input);
  }
  throw new Error(
    "IA no configurada: añade GOOGLE_GENERATIVE_AI_API_KEY o conecta el proxy FAQ "
    + "(FAQ_SITE_URL + INTEGRATION_API_KEY compartida con el proyecto FAQ).",
  );
}

module.exports = {
  resolveGoogleApiKey,
  isFaqProxyConfigured,
  isConfigured,
  generateAgentReply,
};
