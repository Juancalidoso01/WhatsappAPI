/**
 * Copyright 2021-present, Facebook, Inc. All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree.
 */

"use strict";

const crypto = require('crypto');
const path = require('path');

const { urlencoded, json } = require('body-parser');
require('dotenv').config();
const express = require('express');

const multer = require('multer');

const config = require('./services/config');
const Conversation = require('./services/conversation');
const GraphApi = require('./services/graph-api');
const Store = require('./services/store');
const phoneMeta = require('./services/phone-meta');
const templateCategory = require('./services/template-category');
const app = express();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 16 * 1024 * 1024 },
});

// Safety net: keep the server alive if a WhatsApp API call fails (e.g. when
// credentials aren't configured yet). The Facebook SDK otherwise installs a
// handler that crashes the process on unhandled rejections.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection (ignorado):', reason && reason.message ? reason.message : reason);
});

// Parse application/x-www-form-urlencoded
app.use(
  urlencoded({
    extended: true
  })
);

// Serve the lightweight chat web interface
app.use(express.static(path.join(__dirname, 'public')));

// JSON parser that validates the Facebook signature. Scoped to the webhook
// route only, so requests coming from our own web interface aren't rejected.
const webhookJson = json({ verify: verifyRequestSignature });

// JSON parser for the local web interface API
const apiJson = json();

// Handle webhook verification handshake
app.get("/webhook", function (req, res) {
  if (
    req.query["hub.mode"] != "subscribe" ||
    req.query["hub.verify_token"] != config.verifyToken
  ) {
    res.sendStatus(403);
    return;
  }

  res.send(req.query["hub.challenge"]);
});

// Handle incoming messages
app.post('/webhook', webhookJson, (req, res) => {
  console.log(JSON.stringify(req.body, null, 2));

  if (req.body.object === "whatsapp_business_account") {
    req.body.entry.forEach(entry => {
      entry.changes.forEach(change => {
        const value = change.value;
        if (!value) return;

        if (change.field === 'template_category_update') {
          Promise.resolve(Store.updateTemplateCategoryFromWebhook({
            name: value.message_template_name,
            language: value.message_template_language,
            correctCategory: value.correct_category,
            newCategory: value.new_category,
            previousCategory: value.previous_category,
          })).catch(err => console.error('template_category_update error:', err));
          return;
        }

        const senderPhoneNumberId = value.metadata && value.metadata.phone_number_id;
        if (!senderPhoneNumberId) return;

        // Map of consumer phone -> profile name (from the contacts array)
        const contactNames = {};
        (value.contacts || []).forEach(contact => {
          if (contact.wa_id) {
            contactNames[contact.wa_id] = contact.profile && contact.profile.name;
          }
        });

        if (value.statuses) {
            value.statuses.forEach(status => {
              const phone = String(status.recipient_id);
              Promise.resolve(Store.updateMessageStatus(phone, status.id, status.status))
                .catch(err => console.error('updateMessageStatus error:', err));

              const metaFields = {};
              if (status.conversation) {
                if (status.conversation.origin && status.conversation.origin.type) {
                  metaFields.conversationOrigin = status.conversation.origin.type;
                }
                if (status.conversation.expiration_timestamp) {
                  metaFields.windowExpiresAt = status.conversation.expiration_timestamp;
                }
              }
              if (Object.keys(metaFields).length) {
                Promise.resolve(Store.updateConversationMeta(phone, metaFields))
                  .catch(err => console.error('updateConversationMeta error:', err));
              }

              Promise.resolve(Conversation.handleStatus(senderPhoneNumberId, status))
                .catch(err => console.error('handleStatus error:', err));
            });
          }

          if (value.messages) {
            value.messages.forEach(rawMessage => {
              // Mirror the incoming message into the local web interface
              Promise.resolve(mirrorIncomingMessage(rawMessage, contactNames, senderPhoneNumberId))
                .catch(err => console.error('addMessage error:', err));

              // Auto-reply only when the bot is explicitly enabled. By default
              // every conversation is handled manually from the web interface.
              if (config.botEnabled) {
                Promise.resolve(Conversation.handleMessage(senderPhoneNumberId, rawMessage))
                  .catch(err => console.error('handleMessage error:', err));
              }
            });
          }
      });
    });
  }

  res.status(200).send('EVENT_RECEIVED');
});

// ----- Local web interface API -----

// Expose non-sensitive runtime config to the UI
app.get('/api/config', (req, res) => {
  res.json({
    brandName: config.brandName,
    phoneNumberId: config.phoneNumberId || null,
    hasCredentials: Boolean(config.accessToken && config.phoneNumberId),
    templatesEnabled: Boolean(config.accessToken && config.wabaId),
    botEnabled: config.botEnabled,
    persistent: Store.isPersistent(),
  });
});

async function backfillTemplateMeta(templates) {
  const metaMap = await Store.getAllTemplateMeta();
  let synced = 0;

  for (const t of templates || []) {
    const key = `${t.name}|${t.language}`;
    const local = metaMap[key] || {};
    if (local.requestedCategory) continue;

    const inferred = templateCategory.inferRequestedCategory(t, local);
    if (!inferred) continue;

    await Store.setTemplateRequestedCategory(t.name, t.language, inferred, {
      syncedFrom: 'meta',
      syncedAt: Date.now(),
    });
    metaMap[key] = {
      ...local,
      requestedCategory: inferred,
      syncedFrom: 'meta',
      syncedAt: Date.now(),
    };
    synced++;
  }

  return { synced, metaMap };
}

async function enrichTemplatesList(templates, metaMap) {
  const map = metaMap || await Store.getAllTemplateMeta();
  return (templates || []).map((t) => {
    const local = map[`${t.name}|${t.language}`] || {};
    const categoryInfo = templateCategory.analyzeCategory({
      category: t.category,
      correct_category: t.correct_category,
      requestedCategory: local.requestedCategory,
      pendingCategory: local.pendingCategory,
    });
    return { ...t, categoryInfo, localMeta: local };
  });
}

// List WhatsApp message templates from the WABA
app.get('/api/templates', async (req, res) => {
  if (!config.accessToken || !config.wabaId) {
    return res.status(200).json({ data: [], summary: { total: 0 }, warning: 'Falta ACCESS_TOKEN o WABA_ID para gestionar plantillas.' });
  }
  try {
    const result = await GraphApi.listTemplates(config.wabaId);
    const raw = (result && result.data) || [];
    const { synced, metaMap } = await backfillTemplateMeta(raw);
    const data = await enrichTemplatesList(raw, metaMap);
    res.json({ data, summary: templateCategory.summarizeTemplates(data), synced });
  } catch (err) {
    console.error('listTemplates error:', err.message);
    res.status(200).json({ data: [], summary: { total: 0 }, error: String(err.message || err) });
  }
});

// Re-sync category metadata for all existing templates from Meta
app.post('/api/templates/sync-categories', async (req, res) => {
  if (!config.accessToken || !config.wabaId) {
    return res.status(400).json({ ok: false, error: 'Falta ACCESS_TOKEN o WABA_ID.' });
  }
  try {
    const result = await GraphApi.listTemplates(config.wabaId);
    const raw = (result && result.data) || [];
    const metaMap = await Store.getAllTemplateMeta();
    let synced = 0;

    for (const t of raw) {
      const key = `${t.name}|${t.language}`;
      const local = metaMap[key] || {};
      if (local.requestedCategory) continue;

      const inferred = templateCategory.inferRequestedCategory(t, local);
      if (!inferred) continue;

      await Store.setTemplateRequestedCategory(t.name, t.language, inferred, {
        syncedFrom: 'meta',
        syncedAt: Date.now(),
      });
      metaMap[key] = { ...local, requestedCategory: inferred, syncedFrom: 'meta', syncedAt: Date.now() };
      synced++;
    }

    const data = await enrichTemplatesList(raw, metaMap);
    res.json({
      ok: true,
      synced,
      total: raw.length,
      data,
      summary: templateCategory.summarizeTemplates(data),
    });
  } catch (err) {
    console.error('sync-categories error:', err.message);
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

// Create a new WhatsApp message template (needs Meta approval afterwards)
app.post('/api/templates', apiJson, async (req, res) => {
  const { name, category, language, bodyText, headerText, footerText } = req.body || {};
  if (!name || !category || !language || !bodyText) {
    return res.status(400).json({ error: 'Se requieren name, category, language y bodyText.' });
  }
  if (!config.accessToken || !config.wabaId) {
    return res.status(400).json({ error: 'Falta ACCESS_TOKEN o WABA_ID.' });
  }

  const components = [];
  if (headerText) components.push({ type: 'HEADER', format: 'TEXT', text: headerText });
  components.push({ type: 'BODY', text: bodyText });
  if (footerText) components.push({ type: 'FOOTER', text: footerText });

  const tplName = String(name).toLowerCase().replace(/[^a-z0-9_]/g, '_');
  const tplCategory = String(category).toUpperCase();

  try {
    const result = await GraphApi.createTemplate(config.wabaId, {
      name: tplName,
      category: tplCategory,
      language,
      components,
    });
    await Store.setTemplateRequestedCategory(tplName, language, tplCategory, { syncedFrom: 'user' });
    res.json({ ok: true, result, requestedCategory: tplCategory });
  } catch (err) {
    console.error('createTemplate error:', err.message);
    res.status(200).json({ ok: false, error: String(err.message || err) });
  }
});

// Billing: cost & volume by country and message category (pricing_analytics)
app.get('/api/billing', async (req, res) => {
  if (!config.accessToken || !config.wabaId) {
    return res.json({ ok: false, error: 'Falta ACCESS_TOKEN o WABA_ID.', rows: [], totals: { cost: 0, volume: 0, byCategory: {} } });
  }
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 90);
  const end = Math.floor(Date.now() / 1000);
  const start = end - days * 86400;

  try {
    const data = await GraphApi.pricingAnalytics(config.wabaId, config.accessToken, { start, end });
    const points = [];
    (data || []).forEach((d) => (d.data_points || []).forEach((p) => points.push(p)));

    const map = {};
    let totalCost = 0;
    let totalVolume = 0;
    const byCategory = {};
    points.forEach((p) => {
      const key = `${p.country}|${p.pricing_category}`;
      if (!map[key]) map[key] = { country: p.country, category: p.pricing_category, volume: 0, cost: 0 };
      map[key].volume += p.volume || 0;
      map[key].cost += p.cost || 0;
      totalCost += p.cost || 0;
      totalVolume += p.volume || 0;
      byCategory[p.pricing_category] = (byCategory[p.pricing_category] || 0) + (p.cost || 0);
    });

    const rows = Object.values(map).sort((a, b) => b.cost - a.cost || b.volume - a.volume);

    let templateSummary = { total: 0, pendingReclass: 0, reclassified: 0, withBillingImpact: 0 };
    try {
      const tplResult = await GraphApi.listTemplates(config.wabaId);
      const rawTpl = (tplResult && tplResult.data) || [];
      const { metaMap } = await backfillTemplateMeta(rawTpl);
      const enriched = await enrichTemplatesList(rawTpl, metaMap);
      templateSummary = templateCategory.summarizeTemplates(enriched);
    } catch (tplErr) {
      console.error('billing template summary error:', tplErr.message);
    }

    res.json({
      ok: true,
      days,
      start,
      end,
      rows,
      totals: { cost: totalCost, volume: totalVolume, byCategory },
      templateSummary,
    });
  } catch (err) {
    console.error('billing error:', err.message);
    res.json({ ok: false, error: String(err.message || err), rows: [], totals: { cost: 0, volume: 0, byCategory: {} }, templateSummary: { total: 0 } });
  }
});

// Start a conversation (or message outside the 24h window) using a template
app.post('/api/send-template', apiJson, async (req, res) => {
  const { phone, name, template, language, components } = req.body || {};
  if (!phone || !template) {
    return res.status(400).json({ error: 'Se requieren "phone" y "template".' });
  }
  const phoneNumberId = config.phoneNumberId;
  if (!phoneNumberId || !config.accessToken) {
    return res.status(400).json({ error: 'Falta PHONE_NUMBER_ID o ACCESS_TOKEN.' });
  }

  const stored = await Store.addMessage({
    phone,
    name,
    phoneNumberId,
    direction: 'out',
    text: `[plantilla] ${template}`,
    type: 'template',
    status: 'pending',
  });

  try {
    const response = await GraphApi.sendTemplate(phoneNumberId, phone, { name: template, language: language || 'es', components });
    await finalizeOutbound(phone, stored, response);
    await Store.updateConversationMeta(phone, { conversationOrigin: 'business_initiated' });
    res.json({ ok: true, message: stored });
  } catch (err) {
    await Store.updateMessageStatus(phone, stored.id, 'failed');
    res.status(200).json({ ok: false, message: stored, error: String(err.message || err) });
  }
});

function parseSendMediaBody(req, res, next) {
  if (req.is('multipart/form-data')) {
    return upload.single('file')(req, res, next);
  }
  return apiJson(req, res, next);
}

// Send media: upload a file from the UI or fall back to a public https link
app.post('/api/send-media', parseSendMediaBody, async (req, res) => {
  const { phone, mediaType, link, caption } = req.body || {};
  const file = req.file;

  if (!phone) {
    return res.status(400).json({ error: 'Se requiere "phone".' });
  }
  if (!file && !link) {
    return res.status(400).json({ error: 'Adjunta un archivo o pega un enlace público (https).' });
  }

  const convo = await Store.getConversation(phone);
  const phoneNumberId = (convo && convo.phoneNumberId) || config.phoneNumberId;
  const waType = file
    ? resolveMediaType(file.mimetype, mediaType)
    : (mediaType === 'document' ? 'document' : mediaType === 'audio' ? 'audio' : mediaType === 'video' ? 'video' : 'image');
  const filename = file ? file.originalname : (req.body.filename || '');
  const label = caption
    || (waType === 'document' ? (filename || '[documento]') : waType === 'audio' ? '[audio]' : waType === 'video' ? '[video]' : '[imagen]');

  if (!phoneNumberId || !config.accessToken) {
    return res.status(200).json({ ok: false, warning: 'Falta PHONE_NUMBER_ID o ACCESS_TOKEN.' });
  }

  let stored;
  try {
    let mediaId = null;
    if (file) {
      mediaId = await GraphApi.uploadMedia(phoneNumberId, {
        buffer: file.buffer,
        mimeType: file.mimetype,
        filename: file.originalname,
        type: waType,
      });
    }

    stored = await Store.addMessage({
      phone,
      phoneNumberId,
      direction: 'out',
      text: label,
      type: waType,
      status: 'pending',
      media: file ? null : link,
      mediaId,
    });

    const response = await GraphApi.messageWithMedia(undefined, phoneNumberId, phone, {
      mediaType: waType,
      link: file ? undefined : link,
      mediaId,
      caption,
      filename,
    });

    await finalizeOutbound(phone, stored, response);
    res.json({ ok: true, message: stored });
  } catch (err) {
    if (stored) {
      await Store.updateMessageStatus(phone, stored.id, 'failed');
      stored.status = 'failed';
    }
    res.status(200).json({ ok: false, message: stored, error: String(err.message || err) });
  }
});

// Proxy WhatsApp media (images, audio, etc.) for the web interface.
// Meta URLs expire quickly and require the access token; we fetch on demand.
app.get('/api/media/:mediaId', async (req, res) => {
  const mediaId = String(req.params.mediaId || '').trim();
  if (!mediaId) return res.status(400).json({ error: 'mediaId requerido.' });
  if (!config.accessToken) return res.status(503).json({ error: 'ACCESS_TOKEN no configurado.' });

  try {
    const meta = await GraphApi.getMediaInfo(mediaId);
    if (!meta.url) return res.status(404).json({ error: 'Media no encontrado.' });

    const mediaRes = await fetch(meta.url, {
      headers: { Authorization: `Bearer ${config.accessToken}` },
    });
    if (!mediaRes.ok) {
      return res.status(502).json({ error: 'No se pudo descargar el archivo de WhatsApp.' });
    }

    const buffer = Buffer.from(await mediaRes.arrayBuffer());
    res.setHeader('Content-Type', meta.mime_type || mediaRes.headers.get('content-type') || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(buffer);
  } catch (err) {
    console.error('media proxy error:', err.message);
    res.status(404).json({ error: String(err.message || err) });
  }
});

// List all conversations
app.get('/api/conversations', async (req, res) => {
  try {
    res.json(await Store.listConversations());
  } catch (err) {
    console.error('listConversations error:', err.message);
    res.status(500).json({ error: 'No se pudieron cargar las conversaciones.' });
  }
});

// Get the messages of a single conversation
app.get('/api/conversations/:phone/messages', async (req, res) => {
  try {
    res.json(await Store.getMessages(req.params.phone));
  } catch (err) {
    console.error('getMessages error:', err.message);
    res.status(500).json({ error: 'No se pudieron cargar los mensajes.' });
  }
});

// Enriched contact detail (country, window, stats, notes)
app.get('/api/conversations/:phone/detail', async (req, res) => {
  try {
    const detail = await Store.getConversationDetail(req.params.phone);
    if (!detail) return res.status(404).json({ error: 'Conversación no encontrada.' });
    const country = phoneMeta.inferCountry(detail.phone);
    res.json({
      ...detail,
      country: {
        code: country.code,
        name: country.name,
        flag: phoneMeta.countryFlag(country.code),
      },
      phoneFormatted: phoneMeta.formatPhone(detail.phone),
      originLabel: phoneMeta.originLabel(detail.conversationOrigin),
    });
  } catch (err) {
    console.error('getConversationDetail error:', err.message);
    res.status(500).json({ error: 'No se pudo cargar el detalle.' });
  }
});

// Update internal CRM notes for a conversation
app.patch('/api/conversations/:phone', apiJson, async (req, res) => {
  const { notes } = req.body || {};
  if (typeof notes !== 'string') {
    return res.status(400).json({ error: 'Se requiere "notes" (texto).' });
  }
  try {
    await Store.updateConversationMeta(req.params.phone, { notes });
    res.json({ ok: true });
  } catch (err) {
    console.error('updateConversationNotes error:', err.message);
    res.status(500).json({ error: 'No se pudieron guardar las notas.' });
  }
});

// Send a text message manually from the web interface
app.post('/api/send', apiJson, async (req, res) => {
  const { phone, text } = req.body || {};
  if (!phone || !text) {
    return res.status(400).json({ error: 'Se requieren "phone" y "text".' });
  }

  const convo = await Store.getConversation(phone);
  const phoneNumberId =
    (convo && convo.phoneNumberId) || process.env.PHONE_NUMBER_ID;

  // Store the outgoing message right away so the UI feels responsive
  const stored = await Store.addMessage({
    phone,
    phoneNumberId,
    direction: 'out',
    text,
    type: 'text',
    status: 'pending',
  });

  if (!phoneNumberId || !config.accessToken) {
    await Store.updateMessageStatus(phone, stored.id, 'failed');
    return res.status(200).json({
      ok: false,
      message: stored,
      warning:
        'Mensaje guardado, pero no se envió por WhatsApp: falta PHONE_NUMBER_ID o ACCESS_TOKEN.',
    });
  }

  try {
    const response = await GraphApi.messageWithText(undefined, phoneNumberId, phone, text);
    await finalizeOutbound(phone, stored, response);
    res.json({ ok: true, message: stored });
  } catch (error) {
    await Store.updateMessageStatus(phone, stored.id, 'failed');
    res
      .status(200)
      .json({ ok: false, message: stored, error: String(error.message || error) });
  }
});

// Inject a fake incoming message, so the UI can be tested without WhatsApp
app.post('/api/simulate-incoming', apiJson, async (req, res) => {
  const { phone, name, text } = req.body || {};
  if (!phone || !text) {
    return res.status(400).json({ error: 'Se requieren "phone" y "text".' });
  }

  const message = await Store.addMessage({
    phone,
    name: name || `Demo ${phone}`,
    direction: 'in',
    text,
    type: 'text',
  });

  res.json({ ok: true, message });
});

// Server-Sent Events stream for real-time updates in the web interface
app.get('/api/stream', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();
  res.write(': connected\n\n');

  const keepAlive = setInterval(() => res.write(': ping\n\n'), 25000);

  const unsubscribe = Store.subscribe((payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  });

  req.on('close', () => {
    clearInterval(keepAlive);
    unsubscribe();
  });
});

// Default route for health check
app.get('/api/health', (req, res) => {
  res.json({
    message: 'Jasper\'s Market Server is running',
    endpoints: [
      'POST /webhook - WhatsApp webhook endpoint',
      'GET / - Web chat interface',
    ]
  });
});

// Check if all environment variables are set
config.checkEnvVariables();

// Verify that the callback came from Facebook.
function verifyRequestSignature(req, res, buf) {
  let signature = req.headers["x-hub-signature-256"];

  if (!signature) {
    console.warn(`Couldn't find "x-hub-signature-256" in headers.`);
  } else {
    let elements = signature.split("=");
    let signatureHash = elements[1];
    let expectedHash = crypto
      .createHmac("sha256", config.appSecret)
      .update(buf)
      .digest("hex");
    if (signatureHash != expectedHash) {
      throw new Error("Couldn't validate the request signature.");
    }
  }
}

function waMessageId(response) {
  return response && response.messages && response.messages[0] && response.messages[0].id;
}

async function finalizeOutbound(phone, stored, response) {
  const waId = waMessageId(response);
  if (waId) await Store.updateMessageId(phone, stored.id, waId);
  const id = waId || stored.id;
  await Store.updateMessageStatus(phone, id, 'sent');
  stored.id = id;
  stored.status = 'sent';
  return stored;
}

async function mirrorIncomingMessage(rawMessage, contactNames, senderPhoneNumberId) {
  const phone = rawMessage.from;
  const meta = { conversationOrigin: 'user_initiated' };
  if (rawMessage.timestamp) {
    meta.windowExpiresAt = String(Number(rawMessage.timestamp) + 86400);
  }
  await Store.updateConversationMeta(phone, meta);

  const audio = rawMessage.type === 'audio' ? rawMessage.audio : null;
  return Store.addMessage({
    phone: rawMessage.from,
    name: contactNames[rawMessage.from],
    phoneNumberId: senderPhoneNumberId,
    direction: 'in',
    text: extractMessageText(rawMessage),
    type: rawMessage.type,
    id: rawMessage.id,
    mediaId: extractMediaId(rawMessage),
    voice: audio ? Boolean(audio.voice) : null,
    status: 'received',
  });
}

function resolveMediaType(mimeType, requested) {
  const mime = String(mimeType || '').toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  if (['image', 'audio', 'video', 'document'].includes(requested)) return requested;
  return 'document';
}

function extractMediaId(rawMessage) {
  const payload = rawMessage[rawMessage.type];
  return payload && payload.id ? String(payload.id) : null;
}

// Build a human-readable text out of any incoming WhatsApp message type
function extractMessageText(rawMessage) {
  switch (rawMessage.type) {
    case 'text':
      return rawMessage.text && rawMessage.text.body;
    case 'interactive': {
      const interactive = rawMessage.interactive || {};
      if (interactive.button_reply) return interactive.button_reply.title;
      if (interactive.list_reply) return interactive.list_reply.title;
      return '[interactive]';
    }
    case 'button':
      return rawMessage.button && rawMessage.button.text;
    case 'image':
      return (rawMessage.image && rawMessage.image.caption) || '';
    case 'audio':
      return '';
    case 'video':
      return (rawMessage.video && rawMessage.video.caption) || '';
    case 'document':
      return (rawMessage.document && rawMessage.document.caption)
        || (rawMessage.document && rawMessage.document.filename)
        || '';
    case 'location':
      return '[ubicación]';
    default:
      return `[${rawMessage.type}]`;
  }
}


var listener = app.listen(config.port, () => {
  console.log(`The app is listening on port ${listener.address().port}`);
});
