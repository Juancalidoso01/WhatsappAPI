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
              Store.updateMessageStatus(status.recipient_id, status.id, status.status);
              // Handle message status updates
              Promise.resolve(Conversation.handleStatus(senderPhoneNumberId, status))
                .catch(err => console.error('handleStatus error:', err));
            });
          }

          if (value.messages) {
            value.messages.forEach(rawMessage => {
              // Mirror the incoming message into the local web interface
              Store.addMessage({
                phone: rawMessage.from,
                name: contactNames[rawMessage.from],
                phoneNumberId: senderPhoneNumberId,
                direction: 'in',
                text: extractMessageText(rawMessage),
                type: rawMessage.type,
                id: rawMessage.id,
              });

              // Respond to message
              Promise.resolve(Conversation.handleMessage(senderPhoneNumberId, rawMessage))
                .catch(err => console.error('handleMessage error:', err));
            });
          }
        }
      });
    });
  }

  res.status(200).send('EVENT_RECEIVED');
});

// ----- Local web interface API -----

// List all conversations
app.get('/api/conversations', (req, res) => {
  res.json(Store.listConversations());
});

// Get the messages of a single conversation
app.get('/api/conversations/:phone/messages', (req, res) => {
  res.json(Store.getMessages(req.params.phone));
});

// Send a text message manually from the web interface
app.post('/api/send', apiJson, async (req, res) => {
  const { phone, text } = req.body || {};
  if (!phone || !text) {
    return res.status(400).json({ error: 'Se requieren "phone" y "text".' });
  }

  const convo = Store.getConversation(phone);
  const phoneNumberId =
    (convo && convo.phoneNumberId) || process.env.PHONE_NUMBER_ID;

  // Store the outgoing message right away so the UI feels responsive
  const stored = Store.addMessage({
    phone,
    phoneNumberId,
    direction: 'out',
    text,
    type: 'text',
    status: 'pending',
  });

  if (!phoneNumberId || !config.accessToken) {
    Store.updateMessageStatus(phone, stored.id, 'failed');
    return res.status(200).json({
      ok: false,
      message: stored,
      warning:
        'Mensaje guardado localmente, pero no se envió por WhatsApp: falta PHONE_NUMBER_ID o ACCESS_TOKEN en .env.',
    });
  }

  try {
    await GraphApi.messageWithText(undefined, phoneNumberId, phone, text);
    Store.updateMessageStatus(phone, stored.id, 'sent');
    res.json({ ok: true, message: stored });
  } catch (error) {
    Store.updateMessageStatus(phone, stored.id, 'failed');
    res
      .status(200)
      .json({ ok: false, message: stored, error: String(error.message || error) });
  }
});

// Inject a fake incoming message, so the UI can be tested without WhatsApp
app.post('/api/simulate-incoming', apiJson, (req, res) => {
  const { phone, name, text } = req.body || {};
  if (!phone || !text) {
    return res.status(400).json({ error: 'Se requieren "phone" y "text".' });
  }

  const message = Store.addMessage({
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
