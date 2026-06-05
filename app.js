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

const config = require('./services/config');
const Conversation = require('./services/conversation');
const GraphApi = require('./services/graph-api');
const Store = require('./services/store');
const app = express();

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
        if (value) {
          const senderPhoneNumberId = value.metadata.phone_number_id;

          // Map of consumer phone -> profile name (from the contacts array)
          const contactNames = {};
          (value.contacts || []).forEach(contact => {
            if (contact.wa_id) {
              contactNames[contact.wa_id] = contact.profile && contact.profile.name;
            }
          });

          if (value.statuses) {
            value.statuses.forEach(status => {
              Promise.resolve(Store.updateMessageStatus(status.recipient_id, status.id, status.status))
                .catch(err => console.error('updateMessageStatus error:', err));
              // Handle message status updates
              Promise.resolve(Conversation.handleStatus(senderPhoneNumberId, status))
                .catch(err => console.error('handleStatus error:', err));
            });
          }

          if (value.messages) {
            value.messages.forEach(rawMessage => {
              // Mirror the incoming message into the local web interface
              Promise.resolve(Store.addMessage({
                phone: rawMessage.from,
                name: contactNames[rawMessage.from],
                phoneNumberId: senderPhoneNumberId,
                direction: 'in',
                text: extractMessageText(rawMessage),
                type: rawMessage.type,
                id: rawMessage.id,
              })).catch(err => console.error('addMessage error:', err));

              // Auto-reply only when the bot is explicitly enabled. By default
              // every conversation is handled manually from the web interface.
              if (config.botEnabled) {
                Promise.resolve(Conversation.handleMessage(senderPhoneNumberId, rawMessage))
                  .catch(err => console.error('handleMessage error:', err));
              }
            });
          }
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

// List WhatsApp message templates from the WABA
app.get('/api/templates', async (req, res) => {
  if (!config.accessToken || !config.wabaId) {
    return res.status(200).json({ data: [], warning: 'Falta ACCESS_TOKEN o WABA_ID para gestionar plantillas.' });
  }
  try {
    const result = await GraphApi.listTemplates(config.wabaId);
    res.json({ data: (result && result.data) || [] });
  } catch (err) {
    console.error('listTemplates error:', err.message);
    res.status(200).json({ data: [], error: String(err.message || err) });
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

  try {
    const result = await GraphApi.createTemplate(config.wabaId, {
      name: String(name).toLowerCase().replace(/[^a-z0-9_]/g, '_'),
      category: String(category).toUpperCase(),
      language,
      components,
    });
    res.json({ ok: true, result });
  } catch (err) {
    console.error('createTemplate error:', err.message);
    res.status(200).json({ ok: false, error: String(err.message || err) });
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
    await GraphApi.sendTemplate(phoneNumberId, phone, { name: template, language: language || 'es', components });
    await Store.updateMessageStatus(phone, stored.id, 'sent');
    res.json({ ok: true, message: stored });
  } catch (err) {
    await Store.updateMessageStatus(phone, stored.id, 'failed');
    res.status(200).json({ ok: false, message: stored, error: String(err.message || err) });
  }
});

// Send an image or document by public link
app.post('/api/send-media', apiJson, async (req, res) => {
  const { phone, mediaType, link, caption, filename } = req.body || {};
  if (!phone || !link) {
    return res.status(400).json({ error: 'Se requieren "phone" y "link".' });
  }

  const convo = await Store.getConversation(phone);
  const phoneNumberId = (convo && convo.phoneNumberId) || config.phoneNumberId;

  const stored = await Store.addMessage({
    phone,
    phoneNumberId,
    direction: 'out',
    text: caption || (mediaType === 'document' ? (filename || '[documento]') : '[imagen]'),
    type: mediaType === 'document' ? 'document' : 'image',
    status: 'pending',
    media: link,
  });

  if (!phoneNumberId || !config.accessToken) {
    await Store.updateMessageStatus(phone, stored.id, 'failed');
    return res.status(200).json({ ok: false, message: stored, warning: 'Falta PHONE_NUMBER_ID o ACCESS_TOKEN.' });
  }

  try {
    await GraphApi.messageWithMedia(undefined, phoneNumberId, phone, { mediaType, link, caption, filename });
    await Store.updateMessageStatus(phone, stored.id, 'sent');
    res.json({ ok: true, message: stored });
  } catch (err) {
    await Store.updateMessageStatus(phone, stored.id, 'failed');
    res.status(200).json({ ok: false, message: stored, error: String(err.message || err) });
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
    await GraphApi.messageWithText(undefined, phoneNumberId, phone, text);
    await Store.updateMessageStatus(phone, stored.id, 'sent');
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
      return '[imagen]';
    case 'audio':
      return '[audio]';
    case 'video':
      return '[video]';
    case 'document':
      return '[documento]';
    case 'location':
      return '[ubicación]';
    default:
      return `[${rawMessage.type}]`;
  }
}


var listener = app.listen(config.port, () => {
  console.log(`The app is listening on port ${listener.address().port}`);
});
