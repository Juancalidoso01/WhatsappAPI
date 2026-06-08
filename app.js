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
const CampaignStore = require('./services/campaign-store');
const CampaignRunner = require('./services/campaign-runner');
const { parseCsv } = require('./services/csv-parse');
const { parseLineHealth } = require('./services/line-health');
const { validateRowsForTemplate, extractEventVariables } = require('./services/template-params');
const campaignMetrics = require('./services/campaign-metrics');
const { requireIntegrationKey } = require('./services/api-auth');
const WorkspaceStore = require('./services/workspace-store');
const reports = require('./services/reports');
const templateBuilder = require('./services/template-builder');
const FlowStore = require('./services/flow-store');
const flowSamples = require('./services/flow-samples');
const FlowKeys = require('./services/flow-keys');
const { decryptRequest, encryptResponse, FlowEndpointException } = require('./services/flow-encryption');
const { handleFlowRequest } = require('./services/flow-endpoint-handler');
const app = express();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 16 * 1024 * 1024 },
});

const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 512 * 1024 },
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

// Integration API documentation (markdown)
app.get('/docs/INTEGRACION_API.md', (req, res) => {
  res.type('text/markdown; charset=utf-8');
  res.sendFile(path.join(__dirname, 'docs', 'INTEGRACION_API.md'));
});

app.get('/docs/FLOWS.md', (req, res) => {
  res.type('text/markdown; charset=utf-8');
  res.sendFile(path.join(__dirname, 'docs', 'FLOWS.md'));
});

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
              Promise.resolve(CampaignStore.applyWebhookStatus(status.id, status.status))
                .catch(err => console.error('campaign status error:', err));

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

              Promise.resolve(handleFlowResponse(rawMessage, contactNames))
                .catch(err => console.error('flow response error:', err));

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
app.get('/api/config', async (req, res) => {
  const workspace = await WorkspaceStore.getWorkspace(config.brandName);
  res.json({
    brandName: config.brandName,
    phoneNumberId: config.phoneNumberId || null,
    hasCredentials: Boolean(config.accessToken && config.phoneNumberId),
    templatesEnabled: Boolean(config.accessToken && config.wabaId),
    flowsEnabled: Boolean(config.accessToken && config.wabaId && config.phoneNumberId),
    flowEndpointUri: config.publicBaseUrl ? `${config.publicBaseUrl}/api/flows/endpoint` : null,
    botEnabled: config.botEnabled,
    persistent: Store.isPersistent(),
    workspace: {
      displayName: workspace.displayName,
      workspaceName: workspace.workspaceName,
      hasProfilePhoto: workspace.hasProfilePhoto,
      portalLanguage: workspace.portalLanguage,
    },
  });
});

// ----- Workspace (settings, profile, reports hub) -----

app.get('/api/workspace', async (req, res) => {
  try {
    const workspace = await WorkspaceStore.getWorkspace(config.brandName);
    let whatsapp = null;
    let line = null;
    if (config.accessToken && config.phoneNumberId) {
      try {
        whatsapp = await GraphApi.getBusinessProfile(config.phoneNumberId);
      } catch (err) {
        whatsapp = { error: String(err.message || err) };
      }
      try {
        line = parseLineHealth(await GraphApi.getPhoneLineHealth(config.phoneNumberId));
      } catch (_) {}
    }
    res.json({
      ok: true,
      workspace: {
        ...workspace,
        avatarUrl: workspace.hasProfilePhoto ? '/api/workspace/avatar' : null,
      },
      whatsapp,
      line,
      portalLanguageEnabled: false,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

app.patch('/api/workspace', apiJson, async (req, res) => {
  try {
    const body = req.body || {};
    const workspace = await WorkspaceStore.updateWorkspace(body, config.brandName);
    let whatsappSync = null;

    if (body.syncWhatsapp && config.accessToken && config.phoneNumberId) {
      try {
        await GraphApi.updateBusinessProfile(config.phoneNumberId, {
          about: workspace.about,
          description: workspace.description,
          email: workspace.email,
          websites: workspace.websites,
        });
        whatsappSync = { ok: true };
      } catch (err) {
        whatsappSync = { ok: false, error: String(err.message || err) };
      }
    }

    res.json({
      ok: true,
      workspace: {
        ...workspace,
        avatarUrl: workspace.hasProfilePhoto ? '/api/workspace/avatar' : null,
      },
      whatsappSync,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

app.post('/api/workspace/profile-photo', (req, res) => {
  avatarUpload.single('photo')(req, res, async (err) => {
    if (err) return res.status(400).json({ ok: false, error: String(err.message || err) });
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ ok: false, error: 'Sube una imagen (JPG o PNG).' });
    }
    const mime = req.file.mimetype || 'image/jpeg';
    if (!/^image\/(jpeg|png|webp)$/i.test(mime)) {
      return res.status(400).json({ ok: false, error: 'Formato no soportado. Usa JPG, PNG o WebP.' });
    }
    try {
      await WorkspaceStore.setProfilePhoto(req.file.buffer, mime);
      res.json({ ok: true, avatarUrl: '/api/workspace/avatar' });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });
});

app.delete('/api/workspace/profile-photo', async (req, res) => {
  try {
    await WorkspaceStore.removeProfilePhoto();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

app.get('/api/workspace/avatar', async (req, res) => {
  const photo = await WorkspaceStore.getProfilePhoto();
  if (!photo) return res.redirect('/logo.png');
  const buf = Buffer.from(photo.data, 'base64');
  res.set('Cache-Control', 'private, max-age=300');
  res.type(photo.mime).send(buf);
});

app.get('/api/reports/summary', async (req, res) => {
  try {
    let templates = [];
    if (config.accessToken && config.wabaId) {
      try {
        const result = await GraphApi.listTemplates(config.wabaId);
        templates = (result && result.data) || [];
      } catch (_) {}
    }
    const summary = await reports.buildSummary({ templates });
    res.json({ ok: true, summary });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

// ----- WhatsApp Flows -----

async function ensureFlowEndpointReady() {
  const base = config.publicBaseUrl;
  if (!base) {
    throw new Error('Configura PUBLIC_BASE_URL con la URL pública HTTPS de esta app (ej. https://tu-app.vercel.app).');
  }
  if (!config.phoneNumberId || !config.accessToken) {
    throw new Error('Falta PHONE_NUMBER_ID o ACCESS_TOKEN para registrar la clave del endpoint.');
  }
  const { publicKey } = await FlowKeys.getKeyPair();
  await GraphApi.uploadFlowPublicKey(config.phoneNumberId, publicKey);
  return `${base}/api/flows/endpoint`;
}

app.post('/api/flows/endpoint', apiJson, async (req, res) => {
  try {
    const { privateKey } = await FlowKeys.getKeyPair();
    const { decryptedBody, aesKeyBuffer, initialVectorBuffer } = decryptRequest(req.body, privateKey);
    const responseBody = await handleFlowRequest(decryptedBody);
    return res.status(200).type('text/plain').send(encryptResponse(responseBody, aesKeyBuffer, initialVectorBuffer));
  } catch (err) {
    if (err instanceof FlowEndpointException) {
      return res.sendStatus(err.statusCode);
    }
    console.error('flow endpoint error:', err.message || err);
    return res.sendStatus(500);
  }
});

app.get('/api/flows/endpoint/setup', async (req, res) => {
  try {
    const keys = await FlowKeys.getKeyPair();
    res.json({
      ok: true,
      endpointUri: config.publicBaseUrl ? `${config.publicBaseUrl}/api/flows/endpoint` : null,
      hasPublicBaseUrl: Boolean(config.publicBaseUrl),
      keySource: keys.source,
      publicKeyRegistered: Boolean(config.phoneNumberId && config.accessToken),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

app.post('/api/flows/endpoint/setup', async (req, res) => {
  if (!config.phoneNumberId || !config.accessToken) {
    return res.status(400).json({ ok: false, error: 'Falta PHONE_NUMBER_ID o ACCESS_TOKEN.' });
  }
  try {
    const endpointUri = await ensureFlowEndpointReady();
    res.json({ ok: true, endpointUri, message: 'Clave pública registrada en Meta.' });
  } catch (err) {
    res.status(200).json({ ok: false, error: String(err.message || err) });
  }
});

app.get('/api/flows/capability', async (req, res) => {
  const base = {
    ok: false,
    hasCredentials: Boolean(config.accessToken && config.wabaId && config.phoneNumberId),
    canListFlows: false,
    testNumberLikely: false,
    notes: [],
  };
  if (!base.hasCredentials) {
    base.notes.push('Configura ACCESS_TOKEN, WABA_ID y PHONE_NUMBER_ID.');
    return res.json(base);
  }

  try {
    const result = await GraphApi.listFlows(config.wabaId);
    base.ok = true;
    base.canListFlows = true;
    base.flowCount = (result.data || []).length;
  } catch (err) {
    base.error = String(err.message || err);
    base.notes.push('No se pudo listar Flows. Verifica permisos whatsapp_business_management.');
  }

  try {
    const line = parseLineHealth(await GraphApi.getPhoneLineHealth(config.phoneNumberId));
    base.line = line;
    const phone = String(line.displayPhone || '');
    base.testNumberLikely = /555|test|0000/i.test(phone) || (line.verifiedName || '').toLowerCase().includes('test');
  } catch (_) {}

  base.notes.push(
    'Número de prueba Meta: puedes crear Flows y probarlos en borrador (mode draft) dentro de la ventana de 24 h.',
    'Enviar Flows publicados masivamente requiere WABA verificada y nombre de display aprobado.',
    'Si ves error 139000 (Integrity), completa verificación de negocio en Meta Business.',
    config.publicBaseUrl
      ? `Endpoint dinámico disponible en ${config.publicBaseUrl}/api/flows/endpoint (sample quote).`
      : 'Para Flows dinámicos configura PUBLIC_BASE_URL y registra la clave en la pantalla Flows.',
  );

  res.json(base);
});

app.get('/api/flows/samples', (req, res) => {
  res.json({ ok: true, samples: flowSamples.listSamples() });
});

app.get('/api/flows', async (req, res) => {
  if (!config.accessToken || !config.wabaId) {
    return res.json({ ok: false, error: 'Falta ACCESS_TOKEN o WABA_ID.', data: [] });
  }
  try {
    const result = await GraphApi.listFlows(config.wabaId);
    res.json({ ok: true, data: result.data || [], paging: result.paging || null });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err), data: [] });
  }
});

app.get('/api/flows/responses', async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    res.json({ ok: true, data: await FlowStore.listResponses({ limit }) });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err), data: [] });
  }
});

app.get('/api/flows/:id', async (req, res) => {
  if (!config.accessToken) return res.status(400).json({ ok: false, error: 'Falta ACCESS_TOKEN.' });
  try {
    let fields = 'id,name,status,categories,validation_errors,json_version,endpoint_uri,preview';
    if (config.phoneNumberId) {
      fields += `,health_status.phone_number(${config.phoneNumberId})`;
    }
    const flow = await GraphApi.getFlow(req.params.id, fields);
    res.json({ ok: true, flow });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

app.post('/api/flows', apiJson, async (req, res) => {
  const { sample, name, publish } = req.body || {};
  if (!config.accessToken || !config.wabaId) {
    return res.status(400).json({ ok: false, error: 'Falta ACCESS_TOKEN o WABA_ID.' });
  }
  const tpl = flowSamples.getSample(sample || 'hello');
  if (!tpl) return res.status(400).json({ ok: false, error: 'Sample no válido (hello | lead | quote).' });

  let endpointUri;
  if (tpl.dynamic) {
    try {
      endpointUri = await ensureFlowEndpointReady();
    } catch (err) {
      return res.json({ ok: false, error: String(err.message || err) });
    }
  }

  try {
    const result = await GraphApi.createFlow(config.wabaId, {
      name: name || tpl.name,
      categories: tpl.categories,
      flowJson: tpl.flow_json,
      publish: publish != null ? Boolean(publish) : tpl.publish,
      endpointUri,
    });
    const validationErrors = result.validation_errors || [];
    if (validationErrors.length) {
      const first = validationErrors[0];
      return res.status(200).json({
        ok: false,
        error: first.message || first.error || 'Flow JSON inválido.',
        validation_errors: validationErrors,
        flow: result,
      });
    }
    res.status(201).json({
      ok: true,
      flow: result,
      sample: sample || 'hello',
      defaultScreen: tpl.defaultScreen,
      defaultCta: tpl.defaultCta,
      flowAction: tpl.flowAction || 'navigate',
      endpointUri: endpointUri || null,
    });
  } catch (err) {
    console.error('createFlow error:', err.message);
    res.status(200).json({ ok: false, error: String(err.message || err) });
  }
});

app.post('/api/flows/:id/publish', async (req, res) => {
  if (!config.accessToken) return res.status(400).json({ ok: false, error: 'Falta ACCESS_TOKEN.' });
  try {
    const result = await GraphApi.publishFlow(req.params.id);
    res.json({ ok: true, result });
  } catch (err) {
    res.status(200).json({ ok: false, error: String(err.message || err) });
  }
});

app.post('/api/flows/:id/send', apiJson, async (req, res) => {
  const { phone, bodyText, cta, screen, flowToken, mode, flowAction } = req.body || {};
  if (!phone) return res.status(400).json({ ok: false, error: 'Se requiere "phone".' });
  if (!config.phoneNumberId || !config.accessToken) {
    return res.status(400).json({ ok: false, error: 'Falta PHONE_NUMBER_ID o ACCESS_TOKEN.' });
  }

  let flowMeta;
  try {
    flowMeta = await GraphApi.getFlow(req.params.id, 'id,name,status,endpoint_uri');
  } catch (err) {
    return res.json({ ok: false, error: String(err.message || err) });
  }

  const sendMode = mode || (String(flowMeta.status).toUpperCase() === 'DRAFT' ? 'draft' : 'published');
  const token = flowToken || `ptp_${req.params.id}_${Date.now()}`;
  const action = flowAction || (flowMeta.endpoint_uri ? 'data_exchange' : 'navigate');

  try {
    const response = await GraphApi.sendFlowMessage(config.phoneNumberId, String(phone).replace(/\D/g, ''), {
      flowId: req.params.id,
      flowToken: token,
      cta,
      bodyText,
      screen,
      mode: sendMode === 'draft' ? 'draft' : undefined,
      flowAction: action,
    });
    const wamid = waMessageId(response);
    const normPhone = String(phone).replace(/\D/g, '');
    await FlowStore.recordSend({
      phone: normPhone,
      flowId: req.params.id,
      flowToken: token,
      mode: sendMode,
    });
    const stored = await Store.addMessage({
      phone: normPhone,
      phoneNumberId: config.phoneNumberId,
      direction: 'out',
      text: `[Flow] ${flowMeta.name || req.params.id}`,
      type: 'flow',
      status: 'sent',
      id: wamid,
    });
    res.json({ ok: true, message: stored, response, mode: sendMode, flowAction: action });
  } catch (err) {
    const msg = String(err.message || err);
    const details = err.response && err.response.error_data && err.response.error_data.details;
    const integrity = msg.includes('139000') || /integrity/i.test(msg);
    res.status(200).json({
      ok: false,
      error: details ? `${msg} — ${details}` : msg,
      integrity,
      hint: integrity
        ? 'Meta bloqueó el envío (Integrity). Verifica el negocio y el nombre del número, o prueba con Flow en borrador a un número registrado en la ventana 24 h.'
        : 'Asegúrate de que el contacto tenga conversación activa (ventana 24 h) para mensajes interactivos.',
    });
  }
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
    const createdAt = local.createdAt ? Number(local.createdAt) : null;
    const updatedAt = parseMetaTimestamp(t.last_updated_time);
    return {
      ...t,
      categoryInfo,
      localMeta: local,
      createdAt,
      updatedAt,
      displayAt: createdAt || updatedAt,
      displayAtKind: createdAt ? 'created' : 'updated',
    };
  });
}

function parseMetaTimestamp(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return value < 1e12 ? value * 1000 : value;
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? null : parsed;
}

// List WhatsApp message templates from the WABA
app.get('/api/templates', async (req, res) => {
  if (!config.accessToken || !config.wabaId) {
    return res.status(200).json({ data: [], summary: { total: 0 }, warning: 'Falta ACCESS_TOKEN o WABA_ID para gestionar plantillas.' });
  }
  try {
    const result = await GraphApi.listTemplates(config.wabaId);
    const raw = (result && result.data) || [];
    const data = (await enrichTemplatesList(raw))
      .sort((a, b) => (b.displayAt || 0) - (a.displayAt || 0) || String(a.name).localeCompare(String(b.name)));
    res.json({
      data,
      total: data.length,
      summary: templateCategory.summarizeTemplates(data),
    });
  } catch (err) {
    console.error('listTemplates error:', err.message);
    res.status(200).json({ data: [], total: 0, summary: { total: 0 }, error: String(err.message || err) });
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

// Emoji list + template field limits (for create-template UI)
app.get('/api/templates/create-meta', (req, res) => {
  res.json({
    ok: true,
    emojis: templateBuilder.COMMON_EMOJIS,
    limits: templateBuilder.LIMITS,
    placeholderHelp: "Usa {{1}}, {{2}}… en el texto. Cada variable necesita clave API y ejemplo para Meta.",
  });
});

// Create a new WhatsApp message template (needs Meta approval afterwards)
app.post('/api/templates', apiJson, async (req, res) => {
  const { name, category, language, bodyText, headerText, footerText, variables } = req.body || {};
  if (!name || !category || !language || !bodyText) {
    return res.status(400).json({ error: 'Se requieren name, category, language y bodyText.' });
  }
  if (!config.accessToken || !config.wabaId) {
    return res.status(400).json({ error: 'Falta ACCESS_TOKEN o WABA_ID.' });
  }

  const built = templateBuilder.buildComponents({
    headerText: headerText || '',
    bodyText,
    footerText: footerText || '',
    variables: variables || [],
  });
  if (!built.ok) {
    return res.status(400).json({ ok: false, error: built.errors.join(' ') });
  }

  const tplName = String(name).toLowerCase().replace(/[^a-z0-9_]/g, '_');
  const tplCategory = String(category).toUpperCase();

  try {
    const result = await GraphApi.createTemplate(config.wabaId, {
      name: tplName,
      category: tplCategory,
      language,
      components: built.components,
    });
    await Store.setTemplateRequestedCategory(tplName, language, tplCategory, {
      syncedFrom: 'user',
      createdAt: Date.now(),
      eventVariableKeys: built.eventVariableKeys,
      placeholderCount: built.placeholderCount,
    });
    res.json({
      ok: true,
      result,
      requestedCategory: tplCategory,
      eventVariableKeys: built.eventVariableKeys,
      placeholderCount: built.placeholderCount,
    });
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
      const enriched = await enrichTemplatesList(rawTpl);
      templateSummary = templateCategory.summarizeTemplates(enriched);
    } catch (tplErr) {
      console.error('billing template summary error:', tplErr.message);
    }

    let flowStats = { sends: 0, responses: 0, endpointCalls: 0 };
    try {
      flowStats = await FlowStore.getStats();
    } catch (flowErr) {
      console.error('billing flow stats error:', flowErr.message);
    }

    res.json({
      ok: true,
      days,
      start,
      end,
      rows,
      totals: { cost: totalCost, volume: totalVolume, byCategory },
      templateSummary,
      flowStats,
      flowBillingNote:
        'Los Flows enviados dentro de la ventana de 24 h son mensajes interactivos de servicio (gratis en Meta). '
        + 'Si abres la conversación con plantilla, se factura como la categoría de esa plantilla. '
        + 'Las métricas de Flows abajo son contadores internos de Punto Pago.',
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

function readCsvFromRequest(req) {
  if (req.file && req.file.buffer) return req.file.buffer.toString('utf8');
  return (req.body && req.body.csvText) || '';
}

async function findTemplateDefinition(name, language) {
  if (!config.wabaId) return null;
  const result = await GraphApi.listTemplates(config.wabaId);
  const list = (result && result.data) || [];
  const lang = language || 'es';
  return list.find((t) => t.name === name && t.language === lang)
    || list.find((t) => t.name === name);
}

function enrichCampaign(campaign) {
  if (!campaign) return null;
  return {
    ...campaign,
    progress: campaignMetrics.progressFromTotals(campaign.totals),
    costEstimate: campaignMetrics.estimateCost(campaign),
  };
}

function resolveEventVariables(tpl, body, localMeta) {
  const customKeys = [];
  const stored = (localMeta && localMeta.eventVariableKeys)
    || (tpl && tpl.localMeta && tpl.localMeta.eventVariableKeys)
    || [];
  if (stored.length) customKeys.push(...stored);
  if (Array.isArray(body.eventVariables)) {
    body.eventVariables.forEach((ev) => {
      if (typeof ev === 'string') customKeys.push(ev);
      else if (ev && ev.key) customKeys.push(ev.key);
    });
  } else if (Array.isArray(body.variableKeys)) {
    body.variableKeys.forEach((k) => customKeys.push(k));
  }
  const slots = extractEventVariables(tpl, customKeys.length ? customKeys : null);
  if (Array.isArray(body.eventVariables) && body.eventVariables.length) {
    return body.eventVariables.map((ev, i) => {
      if (typeof ev === 'string') return { ...slots[i], key: ev, label: ev };
      return { ...slots[i], ...ev, key: ev.key || slots[i].key, label: ev.label || ev.key || slots[i].label };
    });
  }
  return slots;
}

async function startCampaignSend(campaign) {
  const tpl = await findTemplateDefinition(campaign.template, campaign.language);
  if (!tpl || (tpl.status || '').toLowerCase() !== 'approved') {
    return { ok: false, error: 'Plantilla no disponible o no aprobada.' };
  }
  const promoted = await CampaignStore.promoteReadyToPending(campaign.id);
  await CampaignStore.setCampaignStatus(campaign.id, 'running', { pauseReason: '' });
  const result = await CampaignRunner.processBatch({
    campaignId: campaign.id,
    templateDef: tpl,
    phoneNumberId: config.phoneNumberId,
  });
  const updated = enrichCampaign(await CampaignStore.getCampaign(campaign.id));
  return { ok: true, campaign: updated, batch: result, promoted };
}

// Phone line integrity + daily messaging limit (Meta)
app.get('/api/line-health', async (req, res) => {
  if (!config.accessToken || !config.phoneNumberId) {
    return res.json({ ok: false, error: 'Falta ACCESS_TOKEN o PHONE_NUMBER_ID.' });
  }
  try {
    const raw = await GraphApi.getPhoneLineHealth(config.phoneNumberId);
    res.json({ ok: true, line: parseLineHealth(raw) });
  } catch (err) {
    console.error('line-health error:', err.message);
    res.json({ ok: false, error: String(err.message || err) });
  }
});

function parseCampaignBody(req, res, next) {
  if (req.is('multipart/form-data')) return csvUpload.single('file')(req, res, next);
  return apiJson(req, res, next);
}

// Preview CSV for bulk campaign without creating it
app.post('/api/campaigns/preview', parseCampaignBody, async (req, res) => {
  const { template, language } = req.body || {};
  const csvText = readCsvFromRequest(req);
  if (!csvText.trim()) return res.status(400).json({ ok: false, error: 'Sube un archivo CSV.' });
  if (!template) return res.status(400).json({ ok: false, error: 'Selecciona una plantilla.' });

  const parsed = parseCsv(csvText);
  if (parsed.errors.length && !parsed.rows.length) {
    return res.json({ ok: false, errors: parsed.errors });
  }

  const tpl = await findTemplateDefinition(template, language);
  if (!tpl) return res.json({ ok: false, error: 'Plantilla no encontrada.' });
  if ((tpl.status || '').toLowerCase() !== 'approved') {
    return res.json({ ok: false, error: 'La plantilla debe estar aprobada por Meta.' });
  }

  const eventVariables = resolveEventVariables(tpl, {});
  const check = validateRowsForTemplate(tpl, parsed.rows, eventVariables);
  if (!check.ok) return res.json({ ok: false, error: check.error, errors: parsed.errors });

  let line = null;
  try {
    const raw = await GraphApi.getPhoneLineHealth(config.phoneNumberId);
    line = parseLineHealth(raw);
  } catch (_) {}

  res.json({
    ok: true,
    rowCount: parsed.rows.length,
    varColumns: parsed.varColumns,
    eventVariables,
    errors: parsed.errors,
    requiredVars: check.requiredVars,
    preview: parsed.rows.slice(0, 5),
    line,
    overDailyLimit: line && line.dailyUniqueLimit != null && parsed.rows.length > line.dailyUniqueLimit,
  });
});

// Create bulk campaign from CSV
app.post('/api/campaigns', parseCampaignBody, async (req, res) => {
  const { name, template, language } = req.body || {};
  const csvText = readCsvFromRequest(req);
  if (!csvText.trim()) return res.status(400).json({ ok: false, error: 'Sube un archivo CSV.' });
  if (!template) return res.status(400).json({ ok: false, error: 'Selecciona una plantilla.' });

  const parsed = parseCsv(csvText);
  if (!parsed.rows.length) {
    return res.json({ ok: false, error: 'No hay filas válidas.', errors: parsed.errors });
  }

  const tpl = await findTemplateDefinition(template, language);
  if (!tpl) return res.json({ ok: false, error: 'Plantilla no encontrada.' });
  if ((tpl.status || '').toLowerCase() !== 'approved') {
    return res.json({ ok: false, error: 'La plantilla debe estar aprobada.' });
  }

  const eventVariables = resolveEventVariables(tpl, {});
  const check = validateRowsForTemplate(tpl, parsed.rows, eventVariables);
  if (!check.ok) return res.json({ ok: false, error: check.error });

  try {
    const campaign = enrichCampaign(await CampaignStore.createCampaign({
      name: name || `Carga ${template}`,
      template,
      language: tpl.language || language || 'es',
      templateCategory: tpl.category || null,
      rows: parsed.rows,
      varColumns: parsed.varColumns,
      source: 'csv',
      eventVariables,
    }));
    res.json({ ok: true, campaign, parseErrors: parsed.errors });
  } catch (err) {
    console.error('create campaign error:', err.message);
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

app.get('/api/campaigns', async (req, res) => {
  try {
    const data = (await CampaignStore.listCampaigns()).map(enrichCampaign);
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err), data: [] });
  }
});

app.get('/api/campaigns/:id', async (req, res) => {
  try {
    const campaign = enrichCampaign(await CampaignStore.getCampaign(req.params.id));
    if (!campaign) return res.status(404).json({ ok: false, error: 'Campaña no encontrada.' });
    res.json({ ok: true, campaign });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

app.get('/api/campaigns/:id/rows', async (req, res) => {
  try {
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const rows = await CampaignStore.getRows(req.params.id, { offset, limit });
    res.json({ ok: true, rows, offset, limit });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err), rows: [] });
  }
});

app.post('/api/campaigns/:id/start', async (req, res) => {
  const campaign = await CampaignStore.getCampaign(req.params.id);
  if (!campaign) return res.status(404).json({ ok: false, error: 'Campaña no encontrada.' });
  if (!config.phoneNumberId || !config.accessToken) {
    return res.status(400).json({ ok: false, error: 'Falta PHONE_NUMBER_ID o ACCESS_TOKEN.' });
  }
  const t = campaign.totals || {};
  if ((t.awaiting_vars || 0) > 0) {
    return res.json({
      ok: false,
      error: `Hay ${t.awaiting_vars} destinatario(s) sin eventos variables. Complétalos vía API antes de iniciar.`,
    });
  }
  const result = await startCampaignSend(campaign);
  if (!result.ok) return res.json(result);
  res.json(result);
});

app.post('/api/campaigns/:id/pause', async (req, res) => {
  const campaign = await CampaignStore.getCampaign(req.params.id);
  if (!campaign) return res.status(404).json({ ok: false, error: 'Campaña no encontrada.' });
  await CampaignStore.setCampaignStatus(campaign.id, 'paused', { pauseReason: 'Pausada manualmente.' });
  res.json({ ok: true, campaign: enrichCampaign(await CampaignStore.getCampaign(campaign.id)) });
});

app.post('/api/campaigns/:id/tick', async (req, res) => {
  const campaign = await CampaignStore.getCampaign(req.params.id);
  if (!campaign) return res.status(404).json({ ok: false, error: 'Campaña no encontrada.' });
  if (campaign.status !== 'running') {
    return res.json({ ok: true, campaign, batch: { done: true, reason: campaign.status } });
  }

  const tpl = await findTemplateDefinition(campaign.template, campaign.language);
  if (!tpl) return res.json({ ok: false, error: 'Plantilla no encontrada.' });

  const result = await CampaignRunner.processBatch({
    campaignId: campaign.id,
    templateDef: tpl,
    phoneNumberId: config.phoneNumberId,
  });
  res.json({
    ok: true,
    campaign: enrichCampaign(await CampaignStore.getCampaign(campaign.id)),
    batch: result,
  });
});

// Variable event schema for a template (UI + integrations)
app.get('/api/templates/:name/variables', async (req, res) => {
  const tpl = await findTemplateDefinition(req.params.name, req.query.language);
  if (!tpl) return res.status(404).json({ ok: false, error: 'Plantilla no encontrada.' });
  const metaMap = await Store.getAllTemplateMeta();
  const local = metaMap[`${tpl.name}|${tpl.language}`] || {};
  const eventVariables = resolveEventVariables(tpl, req.query, local);
  res.json({
    ok: true,
    template: tpl.name,
    language: tpl.language,
    category: tpl.category,
    eventVariables,
    requiredCount: eventVariables.filter((e) => e.required !== false).length,
  });
});

// --- Integration API (external systems) ---
app.get('/api/integrations/templates/:name/variables', requireIntegrationKey, async (req, res) => {
  const tpl = await findTemplateDefinition(req.params.name, req.query.language);
  if (!tpl) return res.status(404).json({ ok: false, error: 'Plantilla no encontrada.' });
  const metaMap = await Store.getAllTemplateMeta();
  const local = metaMap[`${tpl.name}|${tpl.language}`] || {};
  res.json({
    ok: true,
    template: tpl.name,
    language: tpl.language,
    category: tpl.category,
    eventVariables: resolveEventVariables(tpl, {}, local),
  });
});

app.post('/api/integrations/campaigns', requireIntegrationKey, apiJson, async (req, res) => {
  const { name, template, language, recipients, eventVariables, variableKeys } = req.body || {};
  if (!template) return res.status(400).json({ ok: false, error: 'Se requiere "template".' });
  if (!Array.isArray(recipients) || !recipients.length) {
    return res.status(400).json({ ok: false, error: 'Se requiere "recipients" (array con phone, name, externalId).' });
  }

  const tpl = await findTemplateDefinition(template, language);
  if (!tpl) return res.json({ ok: false, error: 'Plantilla no encontrada.' });
  if ((tpl.status || '').toLowerCase() !== 'approved') {
    return res.json({ ok: false, error: 'La plantilla debe estar aprobada.' });
  }

  const evs = resolveEventVariables(tpl, { eventVariables, variableKeys });
  const rows = recipients.map((r) => ({
    phone: r.phone,
    name: r.name || '',
    externalId: r.externalId || null,
    vars: [],
  }));

  try {
    const campaign = enrichCampaign(await CampaignStore.createCampaign({
      name: name || `API ${template}`,
      template,
      language: tpl.language || language || 'es',
      templateCategory: tpl.category || null,
      rows,
      varColumns: evs.map((e) => e.key),
      source: 'api',
      eventVariables: evs,
    }));
    res.status(201).json({
      ok: true,
      campaign,
      nextStep: `POST /api/integrations/campaigns/${campaign.id}/events con las variables por destinatario.`,
    });
  } catch (err) {
    console.error('integration create campaign:', err.message);
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

app.post('/api/integrations/campaigns/:id/recipients', requireIntegrationKey, apiJson, async (req, res) => {
  const recipients = req.body && req.body.recipients;
  if (!Array.isArray(recipients) || !recipients.length) {
    return res.status(400).json({ ok: false, error: 'Se requiere "recipients".' });
  }
  const result = await CampaignStore.addRecipients(req.params.id, recipients);
  if (!result.ok) return res.status(404).json(result);
  res.json({
    ok: true,
    added: result.added,
    campaign: enrichCampaign(await CampaignStore.getCampaign(req.params.id)),
  });
});

app.post('/api/integrations/campaigns/:id/events', requireIntegrationKey, apiJson, async (req, res) => {
  const events = req.body && (req.body.events || req.body.variables);
  if (!Array.isArray(events) || !events.length) {
    return res.status(400).json({ ok: false, error: 'Se requiere "events": [{ phone|externalId, variables: { key: value } }].' });
  }
  const result = await CampaignStore.applyVariableEvents(req.params.id, events);
  if (!result.ok) return res.status(404).json(result);
  res.json({
    ok: true,
    results: result.results,
    campaign: enrichCampaign(await CampaignStore.getCampaign(req.params.id)),
  });
});

app.get('/api/integrations/campaigns/:id', requireIntegrationKey, async (req, res) => {
  const campaign = enrichCampaign(await CampaignStore.getCampaign(req.params.id));
  if (!campaign) return res.status(404).json({ ok: false, error: 'Campaña no encontrada.' });
  res.json({ ok: true, campaign });
});

app.post('/api/integrations/campaigns/:id/start', requireIntegrationKey, async (req, res) => {
  const campaign = await CampaignStore.getCampaign(req.params.id);
  if (!campaign) return res.status(404).json({ ok: false, error: 'Campaña no encontrada.' });
  if (!config.phoneNumberId || !config.accessToken) {
    return res.status(400).json({ ok: false, error: 'Falta PHONE_NUMBER_ID o ACCESS_TOKEN.' });
  }
  const t = campaign.totals || {};
  if ((t.awaiting_vars || 0) > 0) {
    return res.json({
      ok: false,
      error: `${t.awaiting_vars} destinatario(s) aún sin variables completas.`,
      awaitingVars: t.awaiting_vars,
    });
  }
  const result = await startCampaignSend(campaign);
  if (!result.ok) return res.json(result);
  res.json(result);
});

app.get('/api/campaigns/:id/export', async (req, res) => {
  try {
    const campaign = await CampaignStore.getCampaign(req.params.id);
    if (!campaign) return res.status(404).send('Not found');
    const rows = await CampaignStore.exportRows(req.params.id);
    const header = 'telefono,nombre,estado,error,wamid,enviado_en,actualizado_en\n';
    const body = rows.map((r) => [
      r.phone,
      (r.name || '').replace(/"/g, '""'),
      r.status,
      (r.error || '').replace(/"/g, '""'),
      r.wamid || '',
      r.sentAt ? new Date(r.sentAt).toISOString() : '',
      r.updatedAt ? new Date(r.updatedAt).toISOString() : '',
    ].map((c) => `"${c}"`).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="carga-${campaign.id}.csv"`);
    res.send('\uFEFF' + header + body);
  } catch (err) {
    res.status(500).send(String(err.message || err));
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

async function handleFlowResponse(rawMessage, contactNames) {
  if (rawMessage.type !== 'interactive') return null;
  const interactive = rawMessage.interactive || {};
  if (interactive.type !== 'nfm_reply' || !interactive.nfm_reply) return null;

  let responseJson = interactive.nfm_reply.response_json;
  if (typeof responseJson === 'string') {
    try { responseJson = JSON.parse(responseJson); } catch (_) { /* keep string */ }
  }

  const row = await FlowStore.saveResponse({
    phone: rawMessage.from,
    flowToken: responseJson && responseJson.flow_token,
    responseJson,
    messageId: rawMessage.id,
    contextMessageId: rawMessage.context && rawMessage.context.id,
  });

  return row;
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
      if (interactive.type === 'nfm_reply' && interactive.nfm_reply) {
        const rj = interactive.nfm_reply.response_json;
        try {
          const parsed = typeof rj === 'string' ? JSON.parse(rj) : rj;
          return `[Flow] ${JSON.stringify(parsed)}`;
        } catch (_) {
          return `[Flow] ${rj || 'completado'}`;
        }
      }
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
