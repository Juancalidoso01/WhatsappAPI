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
const leadProfile = require('./services/lead-profile');
const templateCategory = require('./services/template-category');
const CampaignStore = require('./services/campaign-store');
const CampaignRunner = require('./services/campaign-runner');
const { parseCsv } = require('./services/csv-parse');
const { parseLineHealth } = require('./services/line-health');
const { validateRowsForTemplate, extractEventVariables } = require('./services/template-params');
const campaignMetrics = require('./services/campaign-metrics');
const { requireIntegrationKey } = require('./services/api-auth');
const dashboardAuth = require('./services/dashboard-auth');
const { getOpsStatus } = require('./services/ops-status');
const { getMetaPlatformStatus } = require('./services/meta-platform-status');
const { attachMetaError } = require('./services/meta-error-context');
const { extractInteractiveMeta, interactivePreviewText } = require('./services/interactive-meta');
const {
  validateButtonsPayload,
  validateListPayload,
  buildOutboundInteractiveMeta,
} = require('./services/interactive-send');
const AutomationStore = require('./services/automation-store');
const { runAutomationForInbound } = require('./services/automation-engine');
const WorkspaceStore = require('./services/workspace-store');
const reports = require('./services/reports');
const templateBuilder = require('./services/template-builder');
const FlowStore = require('./services/flow-store');
const flowSamples = require('./services/flow-samples');
const flowBuilder = require('./services/flow-builder');
const flowDynamic = require('./services/flow-dynamic');
const FlowKeys = require('./services/flow-keys');
const { decryptRequest, encryptResponse, FlowEndpointException, isFlowSignatureValid } = require('./services/flow-encryption');
const FlowStudioStore = require('./services/flow-studio-store');
const flowJsonImport = require('./services/flow-json-import');
const { handleFlowRequest, cardImageUrl, resolveCardImageUrl, buildPaymentAuthScreenData } = require('./services/flow-endpoint-handler');
const PaymentAuthStore = require('./services/payment-auth-store');
const templatePresets = require('./services/template-presets');
const variableSchema = require('./services/variable-schema');
const flowPerformance = require('./services/flow-performance');
const CardImageStore = require('./services/card-image-store');
const BookingStore = require('./services/booking-store');
const bookingSchedule = require('./services/booking-schedule');
const bookingSlots = require('./services/booking-slots');
const FlowStudioAssets = require('./services/flow-studio-assets');
const flowUseCases = require('./services/flow-use-cases');
const flowActivity = require('./services/flow-activity');
const { curateFlowList } = require('./services/flow-list-curate');
const redis = require('./services/upstash');
const BillingLedger = require('./services/billing-ledger');
const PortalEvents = require('./services/portal-events');

const PAYMENT_AUTH_FLOW_KEY = 'wa:flow:payment_auth_3ds_v3';
const BOOKING_FLOW_KEY = 'wa:flow:booking_v1';
const TARJETA_CREDITO_FLOW_KEY = 'wa:flow:tarjeta_credito_v1';
const FLOW_KEY_SYNCED = 'wa:flow:public_key_synced';
const app = express();

let tplCategoryCache = { at: 0, map: {} };

async function isInServiceWindow(phone) {
  try {
    const meta = await Store.getConversationMeta(phone);
    const exp = meta && meta.windowExpiresAt;
    if (!exp) return false;
    const ts = Number(exp);
    const ms = ts < 1e12 ? ts * 1000 : ts;
    return Date.now() < ms;
  } catch (_) {
    return false;
  }
}

async function resolveTemplateCategory(templateName, language = 'es') {
  const key = `${templateName}|${language || 'es'}`;
  if (Date.now() - tplCategoryCache.at < 300000 && tplCategoryCache.map[key]) {
    return tplCategoryCache.map[key];
  }
  if (!config.wabaId || !config.accessToken) return 'UTILITY';
  try {
    const result = await GraphApi.listTemplates(config.wabaId);
    const map = {};
    ((result && result.data) || []).forEach((t) => {
      map[`${t.name}|${t.language}`] = String(t.category || 'UTILITY').toUpperCase();
    });
    tplCategoryCache = { at: Date.now(), map };
    return map[key] || 'UTILITY';
  } catch (_) {
    return 'UTILITY';
  }
}

async function trackBillableSend(opts) {
  try {
    const row = { ...opts };
    if (row.phone && row.inServiceWindow == null) {
      row.inServiceWindow = await isInServiceWindow(row.phone);
    }
    return await BillingLedger.record(row);
  } catch (err) {
    console.error('trackBillableSend:', err.message);
    return null;
  }
}

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

const cardImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 },
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

        if (change.field === 'message_template_status_update') {
          Promise.resolve(Store.updateTemplateStatusFromWebhook({
            name: value.message_template_name,
            language: value.message_template_language,
            status: value.event,
            reason: value.reason || (value.rejection_info && value.rejection_info.reason) || null,
          })).catch(err => console.error('template_status webhook meta error:', err));
          Promise.resolve(PortalEvents.pushTemplateStatus({
            name: value.message_template_name,
            language: value.message_template_language,
            status: value.event,
            reason: value.reason || (value.rejection_info && value.rejection_info.reason) || null,
          })).catch(err => console.error('template_status_update error:', err));
          Promise.resolve(PortalEvents.syncTemplateStatuses([{
            name: value.message_template_name,
            language: value.message_template_language,
            status: value.event,
          }])).catch(() => {});
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
              Promise.resolve(Store.updateMessageStatus(phone, status.id, status.status, status.errors))
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
                .then((mirrored) => {
                  if (config.botEnabled || !mirrored) return null;
                  return runAutomationForInbound({
                    phone: rawMessage.from,
                    phoneNumberId: senderPhoneNumberId,
                    contactName: contactNames[rawMessage.from],
                    text: mirrored.text,
                    messageType: mirrored.type,
                  });
                })
                .catch(err => console.error('addMessage/automation error:', err));

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

app.use(dashboardAuth.requireDashboardAuth);

app.get('/api/auth/session', (req, res) => {
  const session = dashboardAuth.getSession(req);
  res.json({ ok: true, ...session });
});

app.post('/api/auth/login', apiJson, (req, res) => {
  if (!dashboardAuth.isAuthRequired()) {
    return res.json({ ok: true, authRequired: false, authenticated: true });
  }
  const password = req.body && req.body.password;
  if (!dashboardAuth.verifyPassword(password)) {
    return res.status(401).json({ ok: false, error: 'Contraseña incorrecta.' });
  }
  res.setHeader('Set-Cookie', dashboardAuth.sessionCookieHeader());
  return res.json({ ok: true, authRequired: true, authenticated: true });
});

app.post('/api/auth/logout', (req, res) => {
  res.setHeader('Set-Cookie', dashboardAuth.clearSessionCookieHeader());
  res.json({ ok: true, authenticated: false });
});

// Expose non-sensitive runtime config to the UI
app.get('/api/config', async (req, res) => {
  const workspace = await WorkspaceStore.getWorkspace(config.brandName);
  const session = dashboardAuth.getSession(req);
  res.json({
    brandName: config.brandName,
    phoneNumberId: config.phoneNumberId || null,
    hasCredentials: Boolean(config.accessToken && config.phoneNumberId),
    templatesEnabled: Boolean(config.accessToken && config.wabaId),
    metaTemplatesUrl: config.wabaId
      ? `https://business.facebook.com/wa/manage/message-templates/?waba_id=${config.wabaId}`
      : 'https://business.facebook.com/latest/whatsapp_manager/message_templates',
    flowsEnabled: Boolean(config.accessToken && config.wabaId && config.phoneNumberId),
    flowEndpointUri: config.publicBaseUrl ? `${config.publicBaseUrl}/api/flows/endpoint` : null,
    botEnabled: config.botEnabled,
    allowSimulate: config.allowSimulate,
    isProduction: config.isProduction,
    persistent: Store.isPersistent(),
    workspace: {
      displayName: workspace.displayName,
      workspaceName: workspace.workspaceName,
      hasProfilePhoto: workspace.hasProfilePhoto,
      portalLanguage: workspace.portalLanguage,
    },
    authRequired: session.authRequired,
    authenticated: session.authenticated,
    ops: getOpsStatus(),
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
      metaPlatform: await getMetaPlatformStatus(),
      portalLanguageEnabled: true,
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

app.get('/api/reports/export', async (req, res) => {
  try {
    let templates = [];
    if (config.accessToken && config.wabaId) {
      try {
        const result = await GraphApi.listTemplates(config.wabaId);
        templates = (result && result.data) || [];
      } catch (_) {}
    }
    const summary = await reports.buildSummary({ templates });
    const csv = reports.summaryToCsv(summary);
    const stamp = new Date(summary.generatedAt || Date.now()).toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="informe-${stamp}.csv"`);
    res.send('\uFEFF' + csv);
  } catch (err) {
    res.status(500).send(String(err.message || err));
  }
});

// ----- Automation (conditional rules) -----

app.get('/api/automation', async (req, res) => {
  try {
    const [{ rules, settings }, log] = await Promise.all([
      AutomationStore.listRules(),
      AutomationStore.listLog(40),
    ]);
    res.json({ ok: true, rules, settings, log, botEnabled: config.botEnabled });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

app.post('/api/automation/rules', apiJson, async (req, res) => {
  try {
    const rule = await AutomationStore.createRule(req.body || {});
    res.json({ ok: true, rule });
  } catch (err) {
    res.status(400).json({ ok: false, error: String(err.message || err) });
  }
});

app.put('/api/automation/rules/:id', apiJson, async (req, res) => {
  try {
    const rule = await AutomationStore.updateRule(req.params.id, req.body || {});
    if (!rule) return res.status(404).json({ ok: false, error: 'Regla no encontrada.' });
    res.json({ ok: true, rule });
  } catch (err) {
    res.status(400).json({ ok: false, error: String(err.message || err) });
  }
});

app.delete('/api/automation/rules/:id', async (req, res) => {
  try {
    const ok = await AutomationStore.deleteRule(req.params.id);
    if (!ok) return res.status(404).json({ ok: false, error: 'Regla no encontrada.' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

app.patch('/api/automation/settings', apiJson, async (req, res) => {
  try {
    const settings = await AutomationStore.setSettings(req.body || {});
    res.json({ ok: true, settings });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

// ----- WhatsApp Flows -----

async function ensureFlowEndpointReady(options = {}) {
  const { force = false } = options;
  const base = config.publicBaseUrl;
  if (!base) {
    throw new Error(
      'Configura PUBLIC_BASE_URL con la URL de producción (ej. https://whatsapp-api-ten-tau.vercel.app). '
      + 'No uses URLs de preview de Vercel: Meta recibe 401 Authentication Required.',
    );
  }
  if (config.isPreviewDeployUrl && config.isPreviewDeployUrl(base)) {
    throw new Error(
      'PUBLIC_BASE_URL apunta a un deploy preview de Vercel. Usa la URL de producción '
      + '(https://whatsapp-api-ten-tau.vercel.app) para el endpoint de Flows.',
    );
  }
  if (!config.phoneNumberId || !config.accessToken) {
    throw new Error('Falta PHONE_NUMBER_ID o ACCESS_TOKEN para registrar la clave del endpoint.');
  }
  const endpointUri = `${base}/api/flows/endpoint`;
  if (redis && !force) {
    const synced = await redis.get(FLOW_KEY_SYNCED);
    if (synced === '1') return endpointUri;
  }
  const { publicKey } = await FlowKeys.getKeyPair();
  await GraphApi.uploadFlowPublicKey(config.phoneNumberId, publicKey);
  if (redis) {
    await redis.set(FLOW_KEY_SYNCED, '1');
  }
  return endpointUri;
}

async function fetchFlowList({ cleanup = false } = {}) {
  const result = await GraphApi.listFlows(config.wabaId);
  const all = result.data || [];
  const { visible, draftsToDelete, latestDraftId } = curateFlowList(all);
  if (!cleanup || !draftsToDelete.length) {
    return { data: visible, totalBefore: all.length, cleaned: 0 };
  }

  let cleaned = 0;
  const deletedIds = [];
  for (const flow of draftsToDelete) {
    try {
      await GraphApi.deleteFlow(flow.id);
      cleaned += 1;
      deletedIds.push(String(flow.id));
    } catch (err) {
      console.warn(`No se pudo eliminar Flow ${flow.id}:`, err.message || err);
    }
  }

  if (redis && deletedIds.length) {
    const cached = await redis.get(PAYMENT_AUTH_FLOW_KEY);
    if (cached && deletedIds.includes(String(cached))) {
      if (latestDraftId) await redis.set(PAYMENT_AUTH_FLOW_KEY, latestDraftId);
      else await redis.del(PAYMENT_AUTH_FLOW_KEY);
    }
  }

  return { data: visible, totalBefore: all.length, cleaned, deletedIds };
}

async function cacheValidFlow(flowId) {
  if (!flowId) return false;
  try {
    const meta = await GraphApi.getFlow(flowId, 'id,name,status,validation_errors');
    if (!meta || !meta.id) return false;
    const errors = meta.validation_errors || [];
    if (errors.length) return false;
    return true;
  } catch (_) {
    return false;
  }
}

async function getOrCreateFlowFromSample(sampleKey, cacheKey) {
  const tpl = flowSamples.getSample(sampleKey);
  if (!tpl) throw new Error(`Sample ${sampleKey} no configurado.`);

  let endpointUri = null;
  if (tpl.dynamic) {
    endpointUri = await ensureFlowEndpointReady();
  }

  if (cacheKey && redis) {
    const cached = await redis.get(cacheKey);
    if (cached && await cacheValidFlow(cached)) {
      return { flowId: String(cached), endpointUri, sample: tpl };
    }
    if (cached) await redis.del(cacheKey);
  }

  const result = await GraphApi.createFlow(config.wabaId, {
    name: `${tpl.name || sampleKey}_${Date.now()}`,
    categories: tpl.categories,
    flowJson: tpl.flow_json,
    publish: false,
    endpointUri,
  });
  const validationErrors = result.validation_errors || [];
  if (validationErrors.length) {
    throw new Error(validationErrors[0].message || validationErrors[0].error || 'Flow inválido.');
  }
  if (cacheKey && redis && result.id) await redis.set(cacheKey, String(result.id));
  return { flowId: String(result.id), endpointUri, flow: result, sample: tpl };
}

/** Plantillas con botón FLOW exigen un Flow PUBLICADO en Meta (no borrador en caché). */
async function resolvePublishedFlowForTemplate(sampleKey, cacheKey) {
  const tpl = flowSamples.getSample(sampleKey);
  if (!tpl) throw new Error(`Sample ${sampleKey} no configurado.`);

  if (tpl.name && config.wabaId) {
    const result = await GraphApi.listFlows(config.wabaId);
    const flows = (result && result.data) || [];
    const published = flows.find(
      (f) => f.name === tpl.name && String(f.status || '').toUpperCase() === 'PUBLISHED'
    );
    if (published && published.id) {
      if (cacheKey && redis) await redis.set(cacheKey, String(published.id));
      return { flowId: String(published.id), sample: tpl };
    }
  }

  const resolved = await getOrCreateFlowFromSample(sampleKey, cacheKey);
  const meta = await GraphApi.getFlow(resolved.flowId, 'id,name,status');
  if (String(meta.status || '').toUpperCase() !== 'PUBLISHED') {
    throw new Error(
      `El Flow "${tpl.name}" debe estar PUBLICADO en Meta para usarlo en plantillas. Estado: ${meta.status || 'desconocido'}.`
    );
  }
  return { flowId: resolved.flowId, sample: tpl };
}

async function getOrCreatePaymentAuthFlow() {
  return getOrCreateFlowFromSample('payment_auth', PAYMENT_AUTH_FLOW_KEY);
}

async function getOrCreateBookingFlow() {
  return getOrCreateFlowFromSample('booking', BOOKING_FLOW_KEY);
}

app.post('/api/flows/endpoint', apiJson, async (req, res) => {
  try {
    if (!isFlowSignatureValid(req, config.appSecret)) {
      return res.sendStatus(401);
    }
    const { privateKey } = await FlowKeys.getKeyPair();
    const { decryptedBody, aesKeyBuffer, initialVectorBuffer } = decryptRequest(req.body, privateKey);
    const responseBody = await handleFlowRequest(decryptedBody);
    if (responseBody && responseBody.version == null) {
      responseBody.version = decryptedBody.version || "3.0";
    }
    return res.status(200).type("text/plain").send(encryptResponse(responseBody, aesKeyBuffer, initialVectorBuffer));
  } catch (err) {
    if (err instanceof FlowEndpointException) {
      return res.sendStatus(err.statusCode);
    }
    console.error("flow endpoint error:", err.stack || err.message || err);
    return res.sendStatus(500);
  }
});

app.get('/api/flows/endpoint/setup', async (req, res) => {
  try {
    const keys = await FlowKeys.getKeyPair();
    const endpointUri = config.publicBaseUrl ? `${config.publicBaseUrl}/api/flows/endpoint` : null;
    let synced = false;
    let syncError = null;
    if (endpointUri && config.phoneNumberId && config.accessToken) {
      if (redis) synced = (await redis.get(FLOW_KEY_SYNCED)) === '1';
      if (!synced) {
        try {
          await ensureFlowEndpointReady();
          synced = true;
        } catch (err) {
          syncError = String(err.message || err);
        }
      }
    }
    res.json({
      ok: true,
      endpointUri,
      synced,
      syncError,
      hasPublicBaseUrl: Boolean(config.publicBaseUrl),
      isPreviewUrl: config.isPreviewDeployUrl ? config.isPreviewDeployUrl(endpointUri) : false,
      keySource: keys.source,
      warning: config.isPreviewDeployUrl && config.isPreviewDeployUrl(endpointUri)
        ? 'URL de preview: Meta recibirá 401. Configura PUBLIC_BASE_URL con tu dominio de producción.'
        : null,
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
    const endpointUri = await ensureFlowEndpointReady({ force: true });
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
    flowCount: 0,
  };
  if (!base.hasCredentials) return res.json(base);

  try {
    const result = await GraphApi.listFlows(config.wabaId);
    base.ok = true;
    base.canListFlows = true;
    const curated = curateFlowList(result.data || []);
    base.flowCount = curated.visible.length;
    base.flowCountTotal = (result.data || []).length;
  } catch (err) {
    base.error = String(err.message || err);
  }

  res.json(base);
});

app.get('/api/flows/samples', (req, res) => {
  res.json({ ok: true, samples: flowSamples.listSamples() });
});

app.get('/api/flows/use-cases', (req, res) => {
  const cases = flowUseCases.listUseCases();
  const samples = flowSamples.listSamples();
  const byKey = Object.fromEntries(samples.map((s) => [s.key, s]));
  res.json({
    ok: true,
    useCases: cases.map((u) => ({
      ...u,
      templates: u.sampleKeys.map((k) => byKey[k]).filter(Boolean),
    })),
  });
});

app.get('/api/flows/builder/schema', (req, res) => {
  res.json({ ok: true, schema: flowBuilder.getSchema() });
});

app.post('/api/flows/studio/preview-json', apiJson, (req, res) => {
  const { name, category, cta, screens, dynamic, dynamicHandler } = req.body || {};
  const built = flowBuilder.buildFlowJson({
    name: name || 'preview',
    category,
    cta,
    screens: screens || [],
    dynamic: Boolean(dynamic),
    dynamicHandler: dynamicHandler || 'generic',
  });
  if (!built.ok) return res.status(400).json({ ok: false, error: built.error });
  res.json({
    ok: true,
    flowJson: built.flowJson,
    firstScreenId: built.firstScreenId,
    dynamic: built.dynamic,
    dynamicResultScreen: built.dynamicResultScreen,
  });
});

app.post('/api/flows/studio/import-json', apiJson, async (req, res) => {
  const { flowJson, name, category, create, cta, chatBody } = req.body || {};
  if (!flowJson) return res.status(400).json({ ok: false, error: 'Se requiere flowJson.' });
  const imported = flowJsonImport.importFlowJson(flowJson);
  if (!imported.ok) return res.status(400).json({ ok: false, error: imported.error });

  const definition = {
    name: name || 'flow_importado',
    category: category || 'OTHER',
    cta: cta || 'Abrir',
    chatBody: chatBody || '',
    screens: imported.screens,
  };

  if (!create) {
    return res.json({
      ok: true,
      definition,
      partial: imported.partial,
      dynamic: imported.dynamic,
      editable: !imported.dynamic,
    });
  }

  if (!config.accessToken || !config.wabaId) {
    return res.status(400).json({ ok: false, error: 'Falta ACCESS_TOKEN o WABA_ID.' });
  }
  if (imported.dynamic) {
    return res.status(400).json({
      ok: false,
      error: 'Flows dinámicos con data_api_version no se pueden crear desde import JSON en el Studio.',
    });
  }

  const enrichedScreens = await enrichFlowScreensWithAssets(definition.screens);
  const built = flowBuilder.buildFlowJson({ ...definition, screens: enrichedScreens });
  if (!built.ok) return res.status(400).json({ ok: false, error: built.error });

  try {
    const result = await GraphApi.createFlow(config.wabaId, {
      name: String(definition.name).trim().toLowerCase(),
      categories: [definition.category || 'OTHER'],
      flowJson: built.flowJson,
      publish: false,
    });
    await FlowStudioStore.saveDefinition(result.id, {
      ...definition,
      screens: enrichedScreens,
      source: 'import',
    });
    res.status(201).json({
      ok: true,
      flow: result,
      definition,
      defaultScreen: built.firstScreenId,
    });
  } catch (err) {
    res.status(200).json({ ok: false, error: String(err.message || err) });
  }
});

app.get('/api/flows/:id/export-json', async (req, res) => {
  if (!config.accessToken) return res.status(400).json({ ok: false, error: 'Falta ACCESS_TOKEN.' });
  try {
    const flowJson = await GraphApi.getFlowJsonAsset(req.params.id);
    res.json({ ok: true, flowJson });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

app.post('/api/flows/studio/assets', (req, res, next) => {
  cardImageUpload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ ok: false, error: err.message || 'Archivo inválido.' });
    next();
  });
}, async (req, res) => {
  if (!req.file || !req.file.buffer) {
    return res.status(400).json({ ok: false, error: 'Se requiere una imagen.' });
  }
  const mime = req.file.mimetype || 'image/png';
  if (!/^image\//.test(mime)) {
    return res.status(400).json({ ok: false, error: 'Solo se permiten imágenes PNG o JPG.' });
  }
  if (req.file.size > 100 * 1024) {
    return res.status(400).json({ ok: false, error: 'La imagen no puede superar 100 KB (límite de Meta).' });
  }
  const row = await FlowStudioAssets.save({ buffer: req.file.buffer, mimeType: mime });
  const base = config.publicBaseUrl ? config.publicBaseUrl.replace(/\/$/, "") : "";
  const previewUrl = base ? `${base}/api/flows/studio/assets/${row.id}` : null;
  res.json({
    ok: true,
    assetId: row.id,
    previewUrl,
    src: row.data,
    mimeType: row.mimeType,
  });
});

app.get('/api/flows/studio/assets/:id', async (req, res) => {
  const stored = await FlowStudioAssets.get(req.params.id);
  if (!stored || !stored.data) {
    return res.status(404).json({ ok: false, error: 'Imagen no encontrada.' });
  }
  const buf = Buffer.from(stored.data, 'base64');
  res.setHeader('Content-Type', stored.mimeType || 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  return res.send(buf);
});

async function enrichFlowScreensWithAssets(screens) {
  if (!Array.isArray(screens)) return screens;
  const resolveImage = async (img) => {
    if (!img || typeof img !== 'object') return img;
    if (img.src) return img;
    if (!img.assetId) return img;
    const row = await FlowStudioAssets.get(img.assetId);
    if (row && row.data) return { ...img, src: row.data };
    return img;
  };
  const resolveBlock = async (block) => {
    if (!block || block.type !== 'image') return block;
    const img = await resolveImage(block);
    return img.src ? img : block;
  };
  const out = [];
  for (const scr of screens) {
    const copy = { ...scr };
    if (copy.image) copy.image = await resolveImage(copy.image);
    if (Array.isArray(copy.blocks)) {
      copy.blocks = await Promise.all(copy.blocks.map(resolveBlock));
    }
    out.push(copy);
  }
  return out;
}

app.post('/api/flows/build', apiJson, async (req, res) => {
  if (!config.accessToken || !config.wabaId) {
    return res.status(400).json({ ok: false, error: 'Falta ACCESS_TOKEN o WABA_ID.' });
  }

  const {
    name, category, publish, cta, screens, dynamic, dynamicHandler, chatBody,
  } = req.body || {};
  const isDynamic = Boolean(dynamic);
  const handler = dynamicHandler || 'generic';

  let endpointUri = null;
  let flowJson;
  let built = null;

  if (isDynamic && handler === 'booking') {
    const tpl = flowSamples.getSample('booking');
    if (!tpl || !tpl.flow_json) {
      return res.status(400).json({ ok: false, error: 'Sample de reservas no disponible.' });
    }
    try {
      endpointUri = await ensureFlowEndpointReady();
    } catch (err) {
      return res.status(400).json({ ok: false, error: String(err.message || err) });
    }
    flowJson = tpl.flow_json;
    built = {
      ok: true,
      firstScreenId: tpl.defaultScreen || 'BOOK',
      defaultCta: cta || tpl.defaultCta || 'Abrir',
      fieldKeys: [],
      dynamic: true,
      dynamicHandler: 'booking',
      dataFormScreenId: 'BOOK',
      dynamicResultScreen: 'SUCCESS',
      dynamicFieldKeys: [],
    };
  } else {
    const enrichedScreens = await enrichFlowScreensWithAssets(screens);
    built = flowBuilder.buildFlowJson({
      name,
      category,
      cta,
      screens: enrichedScreens,
      dynamic: isDynamic,
      dynamicHandler: handler,
    });
    if (!built.ok) {
      return res.status(400).json({ ok: false, error: built.error });
    }
    flowJson = built.flowJson;
    if (isDynamic) {
      try {
        endpointUri = await ensureFlowEndpointReady();
      } catch (err) {
        return res.status(400).json({ ok: false, error: String(err.message || err) });
      }
    }
  }

  const cat = category || 'OTHER';
  const enrichedScreens = isDynamic && handler === 'booking'
    ? (screens || [])
    : await enrichFlowScreensWithAssets(screens);

  try {
    const result = await GraphApi.createFlow(config.wabaId, {
      name: String(name).trim().toLowerCase(),
      categories: [cat],
      flowJson,
      publish: Boolean(publish),
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
    await FlowStudioStore.saveDefinition(result.id, {
      name: String(name).trim().toLowerCase(),
      category: cat,
      cta: cta || built.defaultCta,
      chatBody: chatBody || '',
      screens: enrichedScreens,
      dynamic: isDynamic,
      dynamicHandler: handler,
      firstScreenId: built.firstScreenId,
      dataFormScreenId: built.dataFormScreenId,
      dynamicResultScreen: built.dynamicResultScreen,
      fieldKeys: built.dynamicFieldKeys || built.fieldKeys,
      source: 'studio',
    });
    res.status(201).json({
      ok: true,
      flow: result,
      defaultScreen: built.firstScreenId,
      defaultCta: built.defaultCta,
      fieldKeys: built.fieldKeys,
      flowAction: isDynamic ? 'data_exchange' : 'navigate',
      dynamic: isDynamic,
      dynamicHandler: handler,
      endpointUri,
    });
  } catch (err) {
    console.error('buildFlow error:', err.message);
    res.status(200).json({ ok: false, error: String(err.message || err) });
  }
});

app.get('/api/flows/:id/studio', async (req, res) => {
  if (!config.accessToken) return res.status(400).json({ ok: false, error: 'Falta ACCESS_TOKEN.' });
  try {
    const flow = await GraphApi.getFlow(req.params.id, 'id,name,status,categories,endpoint_uri');
    const stored = await FlowStudioStore.getDefinition(req.params.id);
    if (flow.endpoint_uri && stored && stored.screens && stored.screens.length) {
      return res.json({
        ok: true,
        editable: true,
        source: 'store',
        dynamic: true,
        definition: stored,
        flowStatus: flow.status,
        flowName: flow.name,
      });
    }
    if (flow.endpoint_uri) {
      return res.json({
        ok: false,
        editable: false,
        error: 'Los Flows dinámicos sin definición en Studio se editan recreando el sample o en Meta.',
        flowStatus: flow.status,
      });
    }
    if (stored && stored.screens && stored.screens.length) {
      return res.json({
        ok: true,
        editable: true,
        source: 'store',
        definition: stored,
        flowStatus: flow.status,
        flowName: flow.name,
      });
    }
    const flowJson = await GraphApi.getFlowJsonAsset(req.params.id);
    const imported = flowJsonImport.importFlowJson(flowJson);
    if (!imported.ok) {
      return res.json({
        ok: false,
        editable: false,
        error: imported.error,
        flowStatus: flow.status,
      });
    }
    const category = (flow.categories && flow.categories[0]) || 'OTHER';
    const definition = {
      name: flow.name || '',
      category,
      cta: '',
      chatBody: '',
      screens: imported.screens,
      source: 'import',
    };
    await FlowStudioStore.saveDefinition(req.params.id, definition);
    res.json({
      ok: true,
      editable: true,
      source: 'import',
      definition,
      flowStatus: flow.status,
      flowName: flow.name,
    });
  } catch (err) {
    res.status(200).json({ ok: false, editable: false, error: String(err.message || err) });
  }
});

app.put('/api/flows/:id', apiJson, async (req, res) => {
  if (!config.accessToken) return res.status(400).json({ ok: false, error: 'Falta ACCESS_TOKEN.' });
  const {
    name, category, cta, screens, chatBody, dynamic, dynamicHandler,
  } = req.body || {};
  try {
    const flow = await GraphApi.getFlow(req.params.id, 'id,name,status,endpoint_uri');
    if (String(flow.status || '').toUpperCase() !== 'DRAFT') {
      return res.status(400).json({ ok: false, error: 'Solo se pueden editar Flows en borrador (DRAFT).' });
    }
    const stored = await FlowStudioStore.getDefinition(req.params.id);
    const isDynamic = Boolean(flow.endpoint_uri || dynamic || (stored && stored.dynamic));
    if (flow.endpoint_uri && !(stored && stored.screens && stored.screens.length)) {
      return res.status(400).json({
        ok: false,
        error: 'No se puede editar un Flow dinámico sin definición guardada en Studio.',
      });
    }
    const handler = dynamicHandler || (stored && stored.dynamicHandler) || 'generic';
    const enrichedScreens = await enrichFlowScreensWithAssets(screens);

    let flowJson;
    let built;
    if (isDynamic && handler === 'booking') {
      const tpl = flowSamples.getSample('booking');
      if (!tpl || !tpl.flow_json) {
        return res.status(400).json({ ok: false, error: 'Sample de reservas no disponible.' });
      }
      flowJson = tpl.flow_json;
      built = {
        ok: true,
        firstScreenId: tpl.defaultScreen || 'BOOK',
        defaultCta: cta || tpl.defaultCta || 'Abrir',
        dataFormScreenId: 'BOOK',
        dynamicResultScreen: 'SUCCESS',
        dynamicFieldKeys: [],
      };
    } else {
      built = flowBuilder.buildFlowJson({
        name: name || flow.name,
        category: category || (flow.categories && flow.categories[0]) || 'OTHER',
        cta,
        screens: enrichedScreens,
        dynamic: isDynamic,
        dynamicHandler: handler,
      });
      if (!built.ok) return res.status(400).json({ ok: false, error: built.error });
      flowJson = built.flowJson;
    }

    const result = await GraphApi.updateFlowJson(req.params.id, flowJson);
    const validationErrors = result.validation_errors || [];
    if (validationErrors.length) {
      const first = validationErrors[0];
      return res.status(200).json({
        ok: false,
        error: first.message || first.error || 'Flow JSON inválido.',
        validation_errors: validationErrors,
      });
    }
    await FlowStudioStore.saveDefinition(req.params.id, {
      name: String(name || flow.name).trim().toLowerCase(),
      category: category || 'OTHER',
      cta: cta || built.defaultCta,
      chatBody: chatBody || '',
      screens: enrichedScreens,
      dynamic: isDynamic,
      dynamicHandler: handler,
      firstScreenId: built.firstScreenId,
      dataFormScreenId: built.dataFormScreenId,
      dynamicResultScreen: built.dynamicResultScreen,
      fieldKeys: built.dynamicFieldKeys || built.fieldKeys,
      source: 'studio',
    });
    res.json({
      ok: true,
      flowId: req.params.id,
      defaultScreen: built.firstScreenId,
      defaultCta: built.defaultCta,
      flowAction: isDynamic ? 'data_exchange' : 'navigate',
    });
  } catch (err) {
    console.error('updateFlow error:', err.message);
    res.status(200).json({ ok: false, error: String(err.message || err) });
  }
});

app.get('/api/flows/payment-auth/config', async (req, res) => {
  const img = await resolveCardImageUrl();
  res.json({
    ok: true,
    cardImageUrl: img,
    hasCustomCard: Boolean(await CardImageStore.get()),
    previewScreens: ["AUTH", "RESULT"],
  });
});

app.get('/api/flows/payment-auth/card-image', async (req, res) => {
  const stored = await CardImageStore.get();
  if (stored && stored.data) {
    const buf = Buffer.from(stored.data, "base64");
    res.setHeader("Content-Type", stored.mimeType || "image/png");
    res.setHeader("Cache-Control", "public, max-age=300");
    return res.send(buf);
  }
  return res.sendFile(path.join(__dirname, "public", "assets", "punto-pago-card.png"));
});

app.post('/api/flows/payment-auth/card-image', (req, res, next) => {
  cardImageUpload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ ok: false, error: err.message || 'Archivo inválido.' });
    next();
  });
}, async (req, res) => {
  if (!req.file || !req.file.buffer) {
    return res.status(400).json({ ok: false, error: 'Se requiere una imagen.' });
  }
  const mime = req.file.mimetype || 'image/png';
  if (!/^image\//.test(mime)) {
    return res.status(400).json({ ok: false, error: 'Solo se permiten imágenes.' });
  }
  await CardImageStore.save({ buffer: req.file.buffer, mimeType: mime });
  const url = await resolveCardImageUrl();
  res.json({ ok: true, cardImageUrl: url });
});

app.get('/api/flows/payment-auth/recent', async (req, res) => {
  try {
    res.json({ ok: true, data: await PaymentAuthStore.listRecent({ limit: 20 }) });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err), data: [] });
  }
});

app.post('/api/flows/payment-auth/test', apiJson, async (req, res) => {
  const { phone, merchant, amount, cardLast4, currency, customerName, bodyText, headerText, footerText, cta } = req.body || {};
  if (!phone) return res.status(400).json({ ok: false, error: 'Se requiere "phone".' });
  if (!config.phoneNumberId || !config.accessToken || !config.wabaId) {
    return res.status(400).json({ ok: false, error: 'Faltan credenciales de WhatsApp.' });
  }

  try {
    const txn = await PaymentAuthStore.create({
      phone,
      merchant: merchant || 'Supermercado XO',
      amount: amount || '45.90',
      currency: currency || 'USD',
      cardLast4: cardLast4 || '4821',
    });

    const flowCopy = templatePresets.buildFlowMessage('punto_pago_autorizacion_pago', {
      merchant: txn.merchant,
      amount: txn.amount,
      currency: txn.currency,
      cardLast4: txn.cardLast4,
      customerName: customerName || 'Cliente',
    }) || {};

    const { flowId } = await getOrCreatePaymentAuthFlow();
    const screenData = await buildPaymentAuthScreenData(txn);
    const normPhone = String(phone).replace(/\D/g, '');

    let flowStatus = 'DRAFT';
    try {
      const flowMeta = await GraphApi.getFlow(flowId, 'id,status');
      flowStatus = String(flowMeta.status || 'DRAFT').toUpperCase();
    } catch (_) {}

    const approvedTpl = await templatePresets.resolveApprovedPaymentAuthTemplate(GraphApi, config.wabaId);
    let response;
    let sendMode = 'interactive_draft';

    if (approvedTpl && approvedTpl.hasFlowButton) {
      const tplSend = templatePresets.buildPaymentAuthTemplateSend(
        txn,
        screenData,
        customerName || 'Cliente'
      );
      response = await GraphApi.sendTemplate(config.phoneNumberId, normPhone, {
        name: approvedTpl.name,
        language: approvedTpl.language || 'es',
        components: tplSend.components,
      });
      sendMode = 'template_flow';
    } else {
      response = await GraphApi.sendFlowMessage(
        config.phoneNumberId,
        normPhone,
        {
          flowId,
          flowToken: txn.flowToken,
          cta: cta || flowCopy.cta || 'Confirmar pago',
          bodyText: bodyText || flowCopy.bodyText || `Confirma tu pago de ${templatePresets.formatAmount(txn.amount, txn.currency)} en ${txn.merchant}.`,
          headerText: headerText || flowCopy.headerText,
          footerText: footerText || flowCopy.footerText,
          flowAction: 'navigate',
          screen: 'AUTH',
          initialData: screenData,
          mode: flowStatus === 'DRAFT' ? 'draft' : undefined,
        }
      );
      sendMode = flowStatus === 'DRAFT' ? 'interactive_draft' : 'interactive_published';
    }

    await FlowStore.recordSend({
      phone: txn.phone,
      flowId,
      flowToken: txn.flowToken,
      flowName: 'punto_pago_3ds_verificacion',
      mode: sendMode,
    });

    const wamid = waMessageId(response);
    const previewText = flowCopy.bodyText || `[Flow 3DS] ${txn.merchant}`;
    if (wamid) {
      await Store.addMessage({
        phone: normPhone,
        name: customerName || undefined,
        phoneNumberId: config.phoneNumberId,
        direction: 'out',
        text: previewText.slice(0, 500),
        type: sendMode === 'template_flow' ? 'template' : 'interactive',
        status: 'sent',
        id: wamid,
      });
      await Store.updateConversationMeta(normPhone, { conversationOrigin: 'business_initiated' });
    }

    await trackBillableSend({
      phone: normPhone,
      messageId: wamid,
      kind: sendMode === 'template_flow' ? 'template_flow' : 'flow_interactive',
      flowMode: sendMode,
      category: sendMode === 'template_flow' ? 'UTILITY' : undefined,
      templateName: approvedTpl && approvedTpl.hasFlowButton ? approvedTpl.name : null,
      flowName: 'punto_pago_3ds_verificacion',
      flowId,
      preview: previewText,
      source: 'payment_auth',
      recipientName: customerName,
    });

    res.json({
      ok: true,
      transaction: txn,
      flowId,
      sendMode,
      templateName: approvedTpl && approvedTpl.hasFlowButton ? approvedTpl.name : null,
      cardImageUrl: await resolveCardImageUrl(),
      messageId: wamid,
    });
  } catch (err) {
    console.error('payment-auth test error:', err.message);
    res.status(200).json({ ok: false, error: String(err.message || err) });
  }
});

app.get('/api/flows/booking/recent', async (req, res) => {
  try {
    res.json({ ok: true, data: await BookingStore.listRecent({ limit: 20 }) });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err), data: [] });
  }
});

app.get('/api/bookings/schedule', (req, res) => {
  res.json({ ok: true, schedule: bookingSchedule.getPublicConfig() });
});

app.get('/api/bookings/availability', async (req, res) => {
  const branchId = String(req.query.branch || req.query.branchId || '').trim();
  const date = String(req.query.date || '').trim();
  if (!branchId || !date) {
    return res.status(400).json({ ok: false, error: 'Parámetros branch y date requeridos (YYYY-MM-DD).' });
  }
  try {
    const { slots, source } = await bookingSlots.getAvailableSlots(branchId, date);
    const taken = await BookingStore.listTakenSlotIds(branchId, date);
    res.json({
      ok: true,
      branchId,
      date,
      source,
      slots,
      takenCount: taken.size,
      externalConfigured: Boolean(process.env.BOOKING_SLOTS_URL),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

app.post('/api/bookings/slots/sync', requireIntegrationKey, apiJson, async (req, res) => {
  const { branchId, date, availableSlots, blockedSlotIds, ttlHours } = req.body || {};
  if (!branchId || !date) {
    return res.status(400).json({ ok: false, error: 'branchId y date (YYYY-MM-DD) son obligatorios.' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
    return res.status(400).json({ ok: false, error: 'date debe ser YYYY-MM-DD.' });
  }
  try {
    const ttlSec = Math.min(Math.max(Number(ttlHours) || 24, 1), 168) * 3600;
    const row = await bookingSlots.setOverride(branchId, date, {
      availableSlots: Array.isArray(availableSlots) ? availableSlots : undefined,
      blockedSlotIds: Array.isArray(blockedSlotIds) ? blockedSlotIds.map(String) : undefined,
    }, { ttlSec });
    const { slots, source } = await bookingSlots.getAvailableSlots(branchId, date);
    res.json({ ok: true, override: row, slots, source });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

app.post('/api/flows/booking/test', apiJson, async (req, res) => {
  const { phone, customerName, bodyText, headerText, footerText, cta } = req.body || {};
  if (!phone) return res.status(400).json({ ok: false, error: 'Se requiere "phone".' });
  if (!config.phoneNumberId || !config.accessToken || !config.wabaId) {
    return res.status(400).json({ ok: false, error: 'Faltan credenciales de WhatsApp.' });
  }

  try {
    await ensureFlowEndpointReady();
    const booking = await BookingStore.create({
      phone,
      customerName: customerName || 'Cliente',
    });

    const flowCopy = templatePresets.buildFlowMessage('punto_pago_reserva_cita', {
      customerName: customerName || 'Cliente',
    }) || {};

    const { flowId } = await getOrCreateBookingFlow();
    const normPhone = String(phone).replace(/\D/g, '');

    let flowStatus = 'DRAFT';
    try {
      const flowMeta = await GraphApi.getFlow(flowId, 'id,status');
      flowStatus = String(flowMeta.status || 'DRAFT').toUpperCase();
    } catch (_) {}

    const response = await GraphApi.sendFlowMessage(
      config.phoneNumberId,
      normPhone,
      {
        flowId,
        flowToken: booking.flowToken,
        cta: cta || flowCopy.cta || 'Agendar cita',
        bodyText: bodyText || flowCopy.bodyText || 'Reserva tu cita en Punto Pago: elige sucursal, fecha y horario.',
        headerText: headerText || flowCopy.headerText,
        footerText: footerText || flowCopy.footerText,
        flowAction: 'data_exchange',
        mode: flowStatus === 'DRAFT' ? 'draft' : undefined,
      }
    );

    await FlowStore.recordSend({
      phone: booking.phone,
      flowId,
      flowToken: booking.flowToken,
      flowName: 'punto_pago_reserva_cita',
      mode: flowStatus === 'DRAFT' ? 'interactive_draft' : 'interactive_published',
    });

    const wamid = waMessageId(response);
    const previewText = flowCopy.bodyText || '[Flow reserva] Punto Pago';
    if (wamid) {
      await Store.addMessage({
        phone: normPhone,
        name: customerName || undefined,
        phoneNumberId: config.phoneNumberId,
        direction: 'out',
        text: previewText.slice(0, 500),
        type: 'interactive',
        status: 'sent',
        id: wamid,
      });
      await Store.updateConversationMeta(normPhone, { conversationOrigin: 'business_initiated' });
    }

    await trackBillableSend({
      phone: normPhone,
      messageId: wamid,
      kind: 'flow_interactive',
      flowMode: flowStatus === 'DRAFT' ? 'interactive_draft' : 'interactive_published',
      flowName: 'punto_pago_reserva_cita',
      flowId,
      preview: previewText,
      source: 'booking',
      recipientName: customerName,
    });

    res.json({
      ok: true,
      booking,
      flowId,
      sendMode: flowStatus === 'DRAFT' ? 'interactive_draft' : 'interactive_published',
      messageId: wamid,
    });
  } catch (err) {
    console.error('booking test error:', err.message);
    res.status(200).json({ ok: false, error: String(err.message || err) });
  }
});

app.get('/api/flows', async (req, res) => {
  if (!config.accessToken || !config.wabaId) {
    return res.json({ ok: false, error: 'Falta ACCESS_TOKEN o WABA_ID.', data: [] });
  }
  try {
    const { data, totalBefore, cleaned } = await fetchFlowList({ cleanup: true });
    res.json({ ok: true, data, totalBefore, cleaned, paging: null });
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

app.get('/api/flows/activity', async (req, res) => {
  try {
    let flowList = [];
    if (config.accessToken && config.wabaId) {
      try {
        const { data } = await fetchFlowList({ cleanup: false });
        flowList = data;
      } catch (_) {}
    }
    const rows = await flowActivity.getActivityReport(flowList);
    res.json({
      ok: true,
      data: rows,
      summary: {
        total: rows.length,
        sent: rows.reduce((n, r) => n + r.sent, 0),
        viewed: rows.reduce((n, r) => n + r.viewed, 0),
        completed: rows.reduce((n, r) => n + r.completed, 0),
      },
    });
  } catch (err) {
    console.error('flows activity error:', err.message);
    res.status(500).json({ ok: false, error: String(err.message || err), data: [] });
  }
});

app.get('/api/flows/:id/performance', async (req, res) => {
  if (!config.accessToken) return res.status(400).json({ ok: false, error: 'Falta ACCESS_TOKEN.' });
  try {
    let flowMeta = { id: req.params.id, name: '' };
    try {
      flowMeta = await GraphApi.getFlow(req.params.id, 'id,name,status,endpoint_uri');
    } catch (_) {}
    const performance = await flowPerformance.getFlowPerformance(req.params.id, flowMeta);
    res.json({ ok: true, ...performance, flow: flowMeta });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err) });
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

app.get('/api/flows/:id/send-profile', async (req, res) => {
  if (!config.accessToken) return res.status(400).json({ ok: false, error: 'Falta ACCESS_TOKEN.' });
  try {
    const flow = await GraphApi.getFlow(req.params.id, 'id,name,status,endpoint_uri');
    const stored = await FlowStudioStore.getDefinition(req.params.id);
    const sampleProfile = flowSamples.resolveSendProfileByFlowName(flow.name);
    if (stored && stored.dynamic) {
      res.json({
        ok: true,
        flowId: req.params.id,
        flowName: flow.name || '',
        flowStatus: flow.status || '',
        profile: {
          sampleKey: null,
          label: stored.name || flow.name || '',
          dynamic: true,
          dynamicHandler: stored.dynamicHandler || 'generic',
          flowAction: 'data_exchange',
          defaultScreen: stored.firstScreenId || stored.dataFormScreenId || 'SCREEN_A',
          defaultCta: stored.cta || 'Abrir',
          sendDefaults: {
            headerText: '',
            bodyText: stored.chatBody || '',
            footerText: '',
            cta: stored.cta || 'Abrir',
            screen: stored.firstScreenId || stored.dataFormScreenId || 'SCREEN_A',
          },
          screens: [],
        },
      });
      return;
    }
    res.json({
      ok: true,
      flowId: req.params.id,
      flowName: flow.name || '',
      flowStatus: flow.status || '',
      profile: sampleProfile || {
        sampleKey: null,
        label: flow.name || '',
        dynamic: Boolean(flow.endpoint_uri),
        flowAction: flow.endpoint_uri ? 'data_exchange' : 'navigate',
        defaultScreen: 'WELCOME_SCREEN',
        defaultCta: 'Abrir',
        sendDefaults: {
          headerText: '',
          bodyText: '',
          footerText: '',
          cta: 'Abrir',
          screen: 'WELCOME_SCREEN',
        },
        screens: [],
      },
    });
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
  if (!tpl) return res.status(400).json({ ok: false, error: 'Sample no válido.' });

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
    if (result.id && !tpl.dynamic) {
      const imported = flowJsonImport.importFlowJson(tpl.flow_json);
      if (imported.ok) {
        await FlowStudioStore.saveDefinition(result.id, {
          name: name || tpl.name,
          category: (tpl.categories && tpl.categories[0]) || 'OTHER',
          cta: tpl.defaultCta || '',
          chatBody: (tpl.sendDefaults && tpl.sendDefaults.bodyText) || '',
          screens: imported.screens,
          source: 'sample',
        });
      }
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

app.delete('/api/flows/:id', async (req, res) => {
  if (!config.accessToken) return res.status(400).json({ ok: false, error: 'Falta ACCESS_TOKEN.' });
  try {
    const flow = await GraphApi.getFlow(req.params.id, 'id,name,status');
    const st = String(flow.status || '').toUpperCase();
    if (st !== 'DRAFT') {
      return res.status(400).json({
        ok: false,
        error: 'Solo se pueden eliminar Flows en borrador (DRAFT). Para publicados usa deprecar.',
      });
    }
    await GraphApi.deleteFlow(req.params.id);
    res.json({ ok: true, deleted: req.params.id });
  } catch (err) {
    res.status(200).json({ ok: false, error: String(err.message || err) });
  }
});

app.post('/api/flows/:id/deprecate', async (req, res) => {
  if (!config.accessToken) return res.status(400).json({ ok: false, error: 'Falta ACCESS_TOKEN.' });
  try {
    const flow = await GraphApi.getFlow(req.params.id, 'id,name,status');
    const st = String(flow.status || '').toUpperCase();
    if (st !== 'PUBLISHED') {
      return res.status(400).json({
        ok: false,
        error: 'Solo se pueden deprecar Flows publicados (PUBLISHED).',
      });
    }
    const result = await GraphApi.deprecateFlow(req.params.id);
    res.json({ ok: true, result });
  } catch (err) {
    res.status(200).json({ ok: false, error: String(err.message || err) });
  }
});

app.post('/api/flows/:id/template', apiJson, async (req, res) => {
  const { name, bodyText, cta, screen, category, language, footerText } = req.body || {};
  if (!config.accessToken || !config.wabaId) {
    return res.status(400).json({ ok: false, error: 'Falta ACCESS_TOKEN o WABA_ID.' });
  }
  if (!bodyText || !cta) {
    return res.status(400).json({ ok: false, error: 'Se requieren bodyText y cta.' });
  }

  let flowMeta;
  try {
    flowMeta = await GraphApi.getFlow(req.params.id, 'id,name,status');
  } catch (err) {
    return res.json({ ok: false, error: String(err.message || err) });
  }

  const stored = await FlowStudioStore.getDefinition(req.params.id);
  const screenId = screen || 'SCREEN_A';
  const tplName = String(name || `${flowMeta.name || 'flow'}_mensaje`)
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .slice(0, 512);
  const tplCategory = String(category || stored?.category || 'UTILITY').toUpperCase();
  const tplLang = language || 'es';
  const ctaText = String(cta).slice(0, 25);

  const built = templateBuilder.buildComponents({
    bodyText,
    footerText: footerText || 'Punto Pago',
    variables: [],
  });
  if (!built.ok) {
    return res.status(400).json({ ok: false, error: built.errors.join(' ') });
  }
  built.components.push({
    type: 'BUTTONS',
    buttons: [{
      type: 'FLOW',
      text: ctaText,
      flow_id: String(req.params.id),
      flow_action: 'navigate',
      navigate_screen: screenId,
    }],
  });

  try {
    const result = await GraphApi.createTemplate(config.wabaId, {
      name: tplName,
      category: tplCategory,
      language: tplLang,
      components: built.components,
    });
    await Store.setTemplateRequestedCategory(tplName, tplLang, tplCategory, {
      syncedFrom: 'flow_studio',
      flowId: req.params.id,
      createdAt: Date.now(),
      eventVariableKeys: built.eventVariableKeys,
      placeholderCount: built.placeholderCount,
    });
    res.json({
      ok: true,
      result,
      name: tplName,
      flowId: req.params.id,
      screen: screenId,
      requestedCategory: tplCategory,
      note: 'Plantilla enviada a revisión de Meta. Cuando esté APPROVED podrás usarla fuera de la ventana de 24 h.',
    });
  } catch (err) {
    console.error('flow template error:', err.message);
    res.status(200).json({ ok: false, error: String(err.message || err) });
  }
});

app.post('/api/flows/:id/send', apiJson, async (req, res) => {
  const { phone, bodyText, cta, screen, flowToken, mode, flowAction, headerText, footerText } = req.body || {};
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
      headerText,
      footerText,
      mode: sendMode === 'draft' ? 'draft' : undefined,
      flowAction: action,
    });
    const wamid = waMessageId(response);
    const normPhone = String(phone).replace(/\D/g, '');
    await FlowStore.recordSend({
      phone: normPhone,
      flowId: req.params.id,
      flowToken: token,
      flowName: flowMeta.name || null,
      mode: sendMode,
      dynamicHandler: (await FlowStudioStore.getDefinition(req.params.id))?.dynamicHandler || null,
    });
    const stored = await Store.addMessage({
      phone: normPhone,
      phoneNumberId: config.phoneNumberId,
      direction: 'out',
      text: bodyText || `[Flow] ${flowMeta.name || req.params.id}`,
      type: 'flow',
      status: 'sent',
      id: wamid,
    });
    await trackBillableSend({
      phone: normPhone,
      messageId: wamid,
      localMessageId: stored.id,
      kind: 'flow_interactive',
      flowMode: sendMode,
      flowName: flowMeta.name || null,
      flowId: req.params.id,
      preview: bodyText || `[Flow] ${flowMeta.name}`,
      source: 'flow_send',
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
    const cached = GraphApi.getCachedTemplates(config.wabaId);
    if (cached && cached.data.length) {
      const data = (await enrichTemplatesList(cached.data))
        .sort((a, b) => (b.displayAt || 0) - (a.displayAt || 0) || String(a.name).localeCompare(String(b.name)));
      return res.json(await attachMetaError({
        data,
        total: data.length,
        summary: templateCategory.summarizeTemplates(data),
        stale: true,
        warning: 'Meta no respondió; mostrando la última copia guardada. Vuelve a sincronizar en unos minutos.',
      }, 'templates', err));
    }
    res.status(200).json(await attachMetaError({
      data: [],
      total: 0,
      summary: { total: 0 },
      error: String(err.message || err),
    }, 'templates', err));
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
    placeholderRules: templateBuilder.META_PLACEHOLDER_RULES,
    variableCatalog: variableSchema.getVariableCatalog(),
    catalogNote:
      "La biblioteca es solo referencia para operadores y futuros borradores. "
      + "No modifica plantillas ya aprobadas en Meta hasta que solicites una nueva.",
  });
});

// Validar borrador de plantilla antes de enviar a Meta (reglas de placeholders)
app.post('/api/templates/validate', apiJson, (req, res) => {
  const { headerText, bodyText, footerText, variables } = req.body || {};
  if (!bodyText || !String(bodyText).trim()) {
    return res.json({ ok: false, errors: ['El cuerpo del mensaje es obligatorio.'], warnings: [] });
  }
  const result = templateBuilder.validateTemplateDraft({
    headerText: headerText || '',
    bodyText: bodyText || '',
    footerText: footerText || '',
    variables: variables || [],
  });
  res.json({
    ok: result.ok,
    errors: result.errors || [],
    warnings: result.warnings || [],
    placeholderCount: result.placeholderCount || 0,
  });
});

// Biblioteca de variables predefinidas (guía humana, sin enviar a Meta)
app.get('/api/templates/variable-catalog', (req, res) => {
  res.json({
    ok: true,
    catalog: variableSchema.getVariableCatalog(),
    note:
      "Referencia para saber qué llenar y qué formato usar. "
      + "Las entradas «En uso» corresponden a plantillas activas; el resto es para futuras aprobaciones.",
  });
});

app.get('/api/templates/presets', async (req, res) => {
  const presets = templatePresets.listPresets();
  let metaStatus = null;
  let syncedAt = null;
  if (config.accessToken && config.wabaId) {
    try {
      const result = await GraphApi.listTemplates(config.wabaId);
      metaStatus = templatePresets.resolvePresetsMetaStatus((result && result.data) || []);
      syncedAt = Date.now();
    } catch (err) {
      console.warn('presets meta status:', err.message || err);
    }
  }
  res.json({ ok: true, presets, metaStatus, syncedAt });
});

// Sincronizar plantillas desde Meta (estado, categorías y testigos de borradores Flow)
app.post('/api/templates/sync-meta', async (req, res) => {
  if (!config.accessToken || !config.wabaId) {
    return res.status(400).json({ ok: false, error: 'Falta ACCESS_TOKEN o WABA_ID.' });
  }
  try {
    const result = await GraphApi.listTemplates(config.wabaId);
    const raw = (result && result.data) || [];
    const metaMap = await Store.getAllTemplateMeta();
    let categoriesSynced = 0;

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
      categoriesSynced += 1;
    }

    await PortalEvents.syncTemplateStatuses(raw).catch((err) =>
      console.warn('portal template sync:', err.message || err)
    );

    const data = await enrichTemplatesList(raw, metaMap);
    const metaStatus = templatePresets.resolvePresetsMetaStatus(raw);
    res.json({
      ok: true,
      syncedAt: Date.now(),
      categoriesSynced,
      total: raw.length,
      data,
      metaStatus,
      summary: templateCategory.summarizeTemplates(data),
    });
  } catch (err) {
    console.error('sync-meta error:', err.message);
    res.status(500).json(await attachMetaError({ ok: false, error: String(err.message || err) }, 'templates', err));
  }
});

app.get('/api/templates/presets/:key', (req, res) => {
  const preset = templatePresets.getPreset(req.params.key);
  if (!preset) return res.status(404).json({ ok: false, error: 'Preset no encontrado.' });
  const overrides = req.query || {};
  res.json({
    ok: true,
    preset: {
      key: preset.key,
      label: preset.label,
      description: preset.description,
      name: preset.name,
      category: preset.category,
      language: preset.language,
      headerText: preset.headerText,
      bodyText: preset.bodyText,
      footerText: preset.footerText,
      variables: preset.variables,
      variableGuide: variableSchema.enrichPresetVariables(preset.variables),
      flowCta: preset.flowCta,
      flowMessage: preset.flowMessage,
    },
    preview: templatePresets.previewPreset(req.params.key, overrides),
  });
});

// Enviar a Meta un borrador de plantilla desde preset (opcional: botón FLOW 3DS)
app.post('/api/templates/presets/:key/submit', apiJson, async (req, res) => {
  const preset = templatePresets.getPreset(req.params.key);
  if (!preset) return res.status(404).json({ ok: false, error: 'Preset no encontrado.' });
  if (!config.accessToken || !config.wabaId) {
    return res.status(400).json({ ok: false, error: 'Falta ACCESS_TOKEN o WABA_ID.' });
  }

  const includeFlow = req.body && req.body.includeFlow !== false;
  const tplCategory = String(preset.category || 'UTILITY').toUpperCase();
  const isAuth = tplCategory === 'AUTHENTICATION';

  let built;
  if (isAuth) {
    built = templateBuilder.buildAuthenticationComponents({
      addSecurityRecommendation: true,
      codeExpirationMinutes: 10,
      otpButtonText: 'Copiar código',
    });
  } else {
    built = templateBuilder.buildComponents({
      headerText: preset.headerText || '',
      bodyText: preset.bodyText,
      footerText: preset.footerText || '',
      variables: preset.variables || [],
    });
  }
  if (!built.ok) {
    return res.status(400).json({ ok: false, error: built.errors.join(' ') });
  }

  let flowId = null;
  if (!isAuth && includeFlow && preset.flowCta) {
    try {
      const sampleKey = preset.flowSampleKey || 'payment_auth';
      const cacheKey = preset.flowCacheKey
        || (sampleKey === 'tarjeta_credito' ? TARJETA_CREDITO_FLOW_KEY : PAYMENT_AUTH_FLOW_KEY);
      const { flowId: fid, sample } = await resolvePublishedFlowForTemplate(sampleKey, cacheKey);
      flowId = fid;
      const screenId = preset.flowScreenId || (sample && sample.defaultScreen) || 'WELCOME_SCREEN';
      built.components.push({
        type: 'BUTTONS',
        buttons: [{
          type: 'FLOW',
          text: String(preset.flowCta).slice(0, 25),
          flow_id: String(flowId),
          flow_action: 'navigate',
          navigate_screen: screenId,
        }],
      });
    } catch (err) {
      return res.status(200).json({
        ok: false,
        error: `No se pudo vincular el Flow: ${err.message || err}`,
      });
    }
  }

  const tplName = includeFlow && preset.templateFlowName
    ? String(preset.templateFlowName).toLowerCase().replace(/[^a-z0-9_]/g, '_')
    : String(preset.name).toLowerCase().replace(/[^a-z0-9_]/g, '_');

  try {
    const result = await GraphApi.createTemplate(config.wabaId, {
      name: tplName,
      category: tplCategory,
      language: preset.language || 'es',
      components: built.components,
    });
    await Store.setTemplateRequestedCategory(tplName, preset.language || 'es', tplCategory, {
      syncedFrom: 'preset',
      presetKey: preset.key,
      createdAt: Date.now(),
      eventVariableKeys: built.eventVariableKeys,
      placeholderCount: built.placeholderCount,
      flowId,
    });
    res.json({
      ok: true,
      result,
      name: tplName,
      flowId,
      requestedCategory: tplCategory,
      eventVariableKeys: built.eventVariableKeys,
      note: 'Plantilla enviada a revisión de Meta. Cuando esté APPROVED podrás usarla fuera de la ventana de 24 h.',
    });
  } catch (err) {
    console.error('preset submit error:', err.message);
    res.status(200).json({ ok: false, error: String(err.message || err), flowId });
  }
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

// Delete a message template from Meta (name must match exactly)
app.delete('/api/templates/:name', async (req, res) => {
  if (!config.accessToken || !config.wabaId) {
    return res.status(400).json({ ok: false, error: 'Falta ACCESS_TOKEN o WABA_ID.' });
  }
  const name = String(req.params.name || '').toLowerCase().replace(/[^a-z0-9_]/g, '_');
  if (!name) return res.status(400).json({ ok: false, error: 'Nombre de plantilla inválido.' });
  try {
    const result = await GraphApi.deleteTemplate(config.wabaId, name);
    res.json({ ok: true, result, name });
  } catch (err) {
    console.error('deleteTemplate error:', err.message);
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
  const since = start * 1000;

  let metaRows = [];
  let metaError = null;
  let metaAvailable = false;
  let totalCost = 0;
  let totalVolume = 0;
  const byCategory = {};

  try {
    const data = await GraphApi.pricingAnalytics(config.wabaId, config.accessToken, { start, end });
    const points = GraphApi.flattenPricingPoints(data);
    const map = {};
    points.forEach((p) => {
      const key = `${p.country}|${p.pricing_category}`;
      if (!map[key]) map[key] = { country: p.country, category: p.pricing_category, volume: 0, cost: 0 };
      map[key].volume += p.volume || 0;
      map[key].cost += p.cost || 0;
      totalCost += p.cost || 0;
      totalVolume += p.volume || 0;
      byCategory[p.pricing_category] = (byCategory[p.pricing_category] || 0) + (p.cost || 0);
    });
    metaRows = Object.values(map).sort((a, b) => b.cost - a.cost || b.volume - a.volume);
    metaAvailable = metaRows.length > 0;
  } catch (err) {
    metaError = String(err.message || err);
    console.error('billing meta error:', metaError);
  }

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

  let ledgerRows = [];
  let ledgerSummary = { count: 0, estimatedCost: 0, freeCount: 0, billableCount: 0, byCategory: {}, byKind: {}, flow: {} };
  try {
    ledgerRows = await BillingLedger.list({ since, limit: 200 });
    ledgerSummary = BillingLedger.summarize(ledgerRows);
  } catch (ledgerErr) {
    console.error('billing ledger error:', ledgerErr.message);
  }

  if (!metaRows.length && ledgerRows.length) {
    metaRows = BillingLedger.summarizeLedgerAsMetaRows(ledgerRows);
  }

  const rows = BillingLedger.enrichMetaRows(metaRows, ledgerRows);
  const totals = metaAvailable
    ? { cost: totalCost, volume: totalVolume, byCategory }
    : {
      cost: ledgerSummary.estimatedCost || 0,
      volume: ledgerSummary.count || 0,
      byCategory: ledgerSummary.byCategory || {},
    };

  res.json({
    ok: true,
    days,
    start,
    end,
    rows,
    totals,
    metaAvailable,
    metaError,
    dataSource: metaAvailable ? 'meta' : (ledgerRows.length ? 'portal' : 'empty'),
    templateSummary,
    flowStats,
    ledger: { rows: ledgerRows, summary: ledgerSummary },
    flowBillingNote:
      'Meta no cobra por el Flow en sí: el cargo es por el mensaje que lo abre (plantilla o interactivo). '
      + 'Dentro de la ventana de 24 h → servicio (gratis). Fuera de 24 h con plantilla → categoría de la plantilla. '
      + 'Completar el formulario Flow no genera cargo adicional.',
  });
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
    retryPayload: {
      kind: 'template',
      template,
      language: language || 'es',
      components: components || [],
      name,
    },
  });

  try {
    const response = await GraphApi.sendTemplate(phoneNumberId, phone, { name: template, language: language || 'es', components });
    await finalizeOutbound(phone, stored, response);
    await Store.updateConversationMeta(phone, { conversationOrigin: 'business_initiated' });
    const cat = await resolveTemplateCategory(template, language || 'es');
    await trackBillableSend({
      phone,
      messageId: stored.id,
      localMessageId: stored.id,
      kind: 'template',
      category: cat,
      templateName: template,
      preview: `[plantilla] ${template}`,
      source: 'send_template',
      recipientName: name,
    });
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
  const { phone, mediaType, link, caption, replyToMessageId } = req.body || {};
  const file = req.file;

  if (!phone) {
    return res.status(400).json({ error: 'Se requiere "phone".' });
  }
  if (!file && !link) {
    return res.status(400).json({ error: 'Adjunta un archivo o pega un enlace público (https).' });
  }

  const convo = await Store.getConversation(phone);
  const phoneNumberId = (convo && convo.phoneNumberId) || config.phoneNumberId;
  const isSticker = mediaType === 'sticker';
  const waType = isSticker
    ? 'sticker'
    : file
      ? resolveMediaType(file.mimetype, mediaType)
      : (mediaType === 'document' ? 'document' : mediaType === 'audio' ? 'audio' : mediaType === 'video' ? 'video' : 'image');
  const filename = file ? file.originalname : (req.body.filename || '');
  const label = caption
    || (waType === 'sticker' ? '[sticker]' : waType === 'document' ? (filename || '[documento]') : waType === 'audio' ? '[audio]' : waType === 'video' ? '[video]' : '[imagen]');

  if (!phoneNumberId || !config.accessToken) {
    return res.status(200).json({ ok: false, warning: 'Falta PHONE_NUMBER_ID o ACCESS_TOKEN.' });
  }

  const replyTo = replyToMessageId && isWaMessageId(replyToMessageId)
    ? { messageId: replyToMessageId }
    : null;

  let stored;
  try {
    let mediaId = null;
    if (file) {
      mediaId = await GraphApi.uploadMedia(phoneNumberId, {
        buffer: file.buffer,
        mimeType: file.mimetype,
        filename: file.originalname,
        type: waType === 'sticker' ? 'image' : waType,
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
      replyTo,
      retryPayload: {
        kind: 'media',
        mediaType: waType,
        link: file ? undefined : link,
        mediaId: mediaId || undefined,
        caption: caption || undefined,
        filename: filename || undefined,
        replyToMessageId: replyTo ? replyTo.messageId : undefined,
      },
    });

    const response = waType === 'sticker'
      ? await GraphApi.messageWithSticker(phoneNumberId, phone, {
        mediaId,
        replyToMessageId: replyTo ? replyTo.messageId : undefined,
      })
      : await GraphApi.messageWithMedia(undefined, phoneNumberId, phone, {
        mediaType: waType,
        link: file ? undefined : link,
        mediaId,
        caption,
        filename,
        replyToMessageId: replyTo ? replyTo.messageId : undefined,
      });

    await finalizeOutbound(phone, stored, response);
    await trackBillableSend({
      phone,
      messageId: stored.id,
      localMessageId: stored.id,
      kind: 'media',
      preview: label,
      source: 'send_media',
    });
    res.json({ ok: true, message: stored });
  } catch (err) {
    if (stored) {
      await Store.updateMessageStatus(phone, stored.id, 'failed');
      stored.status = 'failed';
    }
    res.status(200).json({ ok: false, message: stored, error: String(err.message || err) });
  }
});

app.post('/api/send-location', apiJson, async (req, res) => {
  const {
    phone, latitude, longitude, name, address, replyToMessageId,
  } = req.body || {};
  if (!phone || latitude == null || longitude == null) {
    return res.status(400).json({ error: 'Se requieren phone, latitude y longitude.' });
  }
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (Number.isNaN(lat) || Number.isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return res.status(400).json({ error: 'Coordenadas inválidas.' });
  }

  const convo = await Store.getConversation(phone);
  const phoneNumberId = (convo && convo.phoneNumberId) || config.phoneNumberId;
  if (!phoneNumberId || !config.accessToken) {
    return res.status(200).json({ ok: false, warning: 'Falta PHONE_NUMBER_ID o ACCESS_TOKEN.' });
  }

  const locName = name ? String(name).trim() : '';
  const locAddr = address ? String(address).trim() : '';
  const label = locName || locAddr || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  const replyTo = replyToMessageId && isWaMessageId(replyToMessageId)
    ? { messageId: replyToMessageId }
    : null;

  let stored;
  try {
    stored = await Store.addMessage({
      phone,
      phoneNumberId,
      direction: 'out',
      text: label,
      type: 'location',
      status: 'pending',
      location: { latitude: lat, longitude: lng, name: locName || null, address: locAddr || null },
      replyTo,
      retryPayload: {
        kind: 'location',
        latitude: lat,
        longitude: lng,
        name: locName || undefined,
        address: locAddr || undefined,
        replyToMessageId: replyTo ? replyTo.messageId : undefined,
      },
    });

    const response = await GraphApi.messageWithLocation(phoneNumberId, phone, {
      latitude: lat,
      longitude: lng,
      name: locName || undefined,
      address: locAddr || undefined,
      replyToMessageId: replyTo ? replyTo.messageId : undefined,
    });

    await finalizeOutbound(phone, stored, response);
    await trackBillableSend({
      phone,
      messageId: stored.id,
      localMessageId: stored.id,
      kind: 'location',
      preview: label,
      source: 'send_location',
    });
    res.json({ ok: true, message: stored });
  } catch (err) {
    if (stored) {
      await Store.updateMessageStatus(phone, stored.id, 'failed');
      stored.status = 'failed';
    }
    res.status(200).json({ ok: false, message: stored, error: String(err.message || err) });
  }
});

app.post('/api/send-contacts', apiJson, async (req, res) => {
  const { phone, contacts, replyToMessageId } = req.body || {};
  if (!phone || !Array.isArray(contacts) || !contacts.length) {
    return res.status(400).json({ error: 'Se requieren phone y contacts (array).' });
  }
  const normalized = contacts
    .map((c) => ({
      name: String(c.name || c.formatted_name || '').trim(),
      phone: String(c.phone || '').replace(/\D/g, ''),
      email: c.email ? String(c.email).trim() : '',
    }))
    .filter((c) => c.name && c.phone);
  if (!normalized.length) {
    return res.status(400).json({ error: 'Cada contacto necesita nombre y teléfono.' });
  }

  const convo = await Store.getConversation(phone);
  const phoneNumberId = (convo && convo.phoneNumberId) || config.phoneNumberId;
  if (!phoneNumberId || !config.accessToken) {
    return res.status(200).json({ ok: false, warning: 'Falta PHONE_NUMBER_ID o ACCESS_TOKEN.' });
  }

  const replyTo = replyToMessageId && isWaMessageId(replyToMessageId)
    ? { messageId: replyToMessageId }
    : null;
  const label = normalized.map((c) => c.name).join(', ');
  const storeContacts = normalized.map((c) => ({
    name: c.name,
    phones: [c.phone],
    email: c.email || undefined,
  }));

  let stored;
  try {
    stored = await Store.addMessage({
      phone,
      phoneNumberId,
      direction: 'out',
      text: label,
      type: 'contacts',
      status: 'pending',
      contacts: storeContacts,
      replyTo,
      retryPayload: {
        kind: 'contacts',
        contacts: normalized,
        replyToMessageId: replyTo ? replyTo.messageId : undefined,
      },
    });

    const response = await GraphApi.messageWithContacts(phoneNumberId, phone, normalized, replyTo ? replyTo.messageId : undefined);
    await finalizeOutbound(phone, stored, response);
    await trackBillableSend({
      phone,
      messageId: stored.id,
      localMessageId: stored.id,
      kind: 'contacts',
      preview: label,
      source: 'send_contacts',
    });
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

// Centro de notificaciones del portal (polling desde el UI)
app.get('/api/portal/notifications', async (req, res) => {
  try {
    const since = Number(req.query.since) || 0;
    const limit = Math.min(Number(req.query.limit) || 40, 80);
    const rows = since > 0
      ? await PortalEvents.listSince(since, limit)
      : await PortalEvents.listRecent(limit);
    const events = await PortalEvents.enrichWithRead(rows);
    const unread = events.filter((e) => !e.read).length;
    res.json({ ok: true, events, unread, serverAt: Date.now() });
  } catch (err) {
    console.error('portal notifications error:', err.message);
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

app.post('/api/portal/notifications/read', apiJson, async (req, res) => {
  try {
    const body = req.body || {};
    let result = { marked: 0 };
    if (body.all) {
      result = await PortalEvents.markAllRead();
    } else if (body.chatPhone) {
      result = await PortalEvents.markChatReadForPhone(body.chatPhone);
    } else if (body.type) {
      result = await PortalEvents.markTypeRead(String(body.type));
    } else {
      const ids = Array.isArray(body.ids) ? body.ids : [];
      result = await PortalEvents.markRead(ids);
    }
    const unread = await PortalEvents.unreadCount();
    res.json({ ok: true, ...result, unread });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

function isWaMessageId(id) {
  return id && String(id).startsWith('wamid.');
}

async function resolveLastInboundWaId(phone) {
  const msgs = await Store.getMessages(phone);
  for (let i = msgs.length - 1; i >= 0; i -= 1) {
    const m = msgs[i];
    if (m.direction === 'in' && isWaMessageId(m.id)) return m.id;
  }
  return null;
}

// Marcar conversación como no leída en el panel (estado compartido vía Redis)
app.post('/api/conversations/:phone/mark-unread', apiJson, async (req, res) => {
  const phone = String(req.params.phone || '').replace(/\D/g, '');
  if (!phone) return res.status(400).json({ ok: false, error: 'Teléfono inválido.' });
  try {
    const msgs = await Store.getMessages(phone);
    const lastIn = [...msgs].reverse().find((m) => m.direction === 'in');
    const lastReadAt = lastIn ? Math.max(0, lastIn.timestamp - 1) : 0;
    await Store.updateConversationMeta(phone, { lastReadAt: String(lastReadAt) });
    res.json({ ok: true, lastReadAt });
  } catch (err) {
    console.error('mark-unread error:', err.message);
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

// Mark customer messages as read on WhatsApp (blue ticks for the customer)
app.post('/api/conversations/:phone/mark-read', apiJson, async (req, res) => {
  const phone = req.params.phone;
  const { messageId } = req.body || {};
  const convo = await Store.getConversation(phone);
  const phoneNumberId = (convo && convo.phoneNumberId) || config.phoneNumberId;
  if (!phoneNumberId || !config.accessToken) {
    return res.json({ ok: false, skipped: true, reason: 'no_credentials' });
  }
  let waId = messageId;
  if (!isWaMessageId(waId)) {
    waId = await resolveLastInboundWaId(phone);
  }
  if (!isWaMessageId(waId)) {
    return res.json({ ok: true, skipped: true, reason: 'no_inbound_message' });
  }
  try {
    await GraphApi.markAsRead(phoneNumberId, waId);
    res.json({ ok: true, messageId: waId });
  } catch (err) {
    res.status(200).json({ ok: false, error: String(err.message || err) });
  }
});

// Send emoji reaction to a customer message
app.post('/api/send-reaction', apiJson, async (req, res) => {
  const { phone, messageId, emoji } = req.body || {};
  if (!phone || !messageId) {
    return res.status(400).json({ error: 'Se requieren "phone" y "messageId".' });
  }
  if (!isWaMessageId(messageId)) {
    return res.status(400).json({ error: 'messageId debe ser un ID de WhatsApp (wamid).' });
  }
  const convo = await Store.getConversation(phone);
  const phoneNumberId = (convo && convo.phoneNumberId) || config.phoneNumberId;
  if (!phoneNumberId || !config.accessToken) {
    return res.status(400).json({ error: 'Falta PHONE_NUMBER_ID o ACCESS_TOKEN.' });
  }
  const stored = await Store.addMessage({
    phone,
    phoneNumberId,
    direction: 'out',
    text: emoji ? `Reacción ${emoji}` : 'Reacción eliminada',
    type: 'reaction',
    status: 'pending',
    reactionEmoji: emoji || '',
    reactionTo: messageId,
  });
  try {
    const response = await GraphApi.messageWithReaction(phoneNumberId, phone, messageId, emoji || '');
    await finalizeOutbound(phone, stored, response);
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

// Enriched contact detail (country, window, stats, notes)
app.get('/api/conversations/:phone/detail', async (req, res) => {
  try {
    const detail = await Store.getConversationDetail(req.params.phone);
    if (!detail) return res.status(404).json({ error: 'Conversación no encontrada.' });
    const country = phoneMeta.inferCountry(detail.phone);
    const countryPayload = {
      code: country.code,
      name: country.name,
      flag: phoneMeta.countryFlag(country.code),
    };
    res.json({
      ...detail,
      country: countryPayload,
      phoneFormatted: phoneMeta.formatPhone(detail.phone),
      originLabel: phoneMeta.originLabel(detail.conversationOrigin),
      lead: leadProfile.buildDetailView(
        { ...detail, phoneFormatted: phoneMeta.formatPhone(detail.phone) },
        countryPayload
      ),
    });
  } catch (err) {
    console.error('getConversationDetail error:', err.message);
    res.status(500).json({ error: 'No se pudo cargar el detalle.' });
  }
});

// Eliminar conversación del panel (historial local; no borra datos en Meta/WhatsApp)
app.delete('/api/conversations/:phone', async (req, res) => {
  const phone = String(req.params.phone || '').replace(/\D/g, '');
  if (!phone) return res.status(400).json({ ok: false, error: 'Teléfono inválido.' });
  try {
    const existed = await Store.getConversationMeta(phone);
    if (!existed) {
      const msgs = await Store.getMessages(phone);
      if (!msgs.length) return res.status(404).json({ ok: false, error: 'Conversación no encontrada.' });
    }
    await Store.deleteConversation(phone);
    res.json({ ok: true, phone });
  } catch (err) {
    console.error('deleteConversation error:', err.message);
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

// Actualizar notas y perfil de lead (calificación CRM)
app.patch('/api/conversations/:phone', apiJson, async (req, res) => {
  const { notes, name, lead, archived, lastReadAt } = req.body || {};
  const fields = {};
  if (typeof notes === 'string') fields.notes = notes;
  if (typeof name === 'string' && name.trim()) fields.name = name.trim();
  if (typeof archived === 'boolean') fields.archived = archived ? '1' : '0';
  if (lastReadAt != null && !Number.isNaN(Number(lastReadAt))) {
    fields.lastReadAt = String(Math.max(0, Number(lastReadAt)));
  }
  if (lead && typeof lead === 'object') {
    const meta = await Store.getConversationMeta(req.params.phone);
    const merged = leadProfile.merge(meta && meta.leadProfile, leadProfile.sanitizePatch(lead));
    fields.leadProfile = leadProfile.serialize(merged);
  }
  if (!Object.keys(fields).length) {
    return res.status(400).json({ error: 'Nada que actualizar (notes, name o lead).' });
  }
  try {
    await Store.updateConversationMeta(req.params.phone, fields);
    res.json({ ok: true });
  } catch (err) {
    console.error('updateConversationMeta error:', err.message);
    res.status(500).json({ error: 'No se pudo guardar el perfil.' });
  }
});

// Reintentar un mensaje saliente que falló (misma burbuja, nuevo envío a Meta)
app.post('/api/conversations/:phone/messages/:messageId/retry', apiJson, async (req, res) => {
  const phone = String(req.params.phone || '').replace(/\D/g, '');
  const messageId = String(req.params.messageId || '');
  if (!phone || !messageId) {
    return res.status(400).json({ ok: false, error: 'Teléfono o mensaje inválido.' });
  }

  const msg = await Store.getMessageById(phone, messageId);
  if (!msg) return res.status(404).json({ ok: false, error: 'Mensaje no encontrado.' });
  if (msg.direction !== 'out') {
    return res.status(400).json({ ok: false, error: 'Solo se pueden reintentar mensajes salientes.' });
  }
  if (msg.status !== 'failed') {
    return res.status(400).json({ ok: false, error: 'Solo se pueden reintentar mensajes con error.' });
  }
  if (!msg.retryPayload) {
    return res.status(400).json({ ok: false, error: 'Este mensaje no guardó datos para reintento.' });
  }

  const convo = await Store.getConversation(phone);
  const phoneNumberId = (convo && convo.phoneNumberId) || config.phoneNumberId;
  if (!phoneNumberId || !config.accessToken) {
    return res.status(400).json({ ok: false, error: 'Falta PHONE_NUMBER_ID o ACCESS_TOKEN.' });
  }

  await Store.patchMessage(phone, messageId, { status: 'pending', clearError: true });

  try {
    const response = await resendFromRetryPayload(phone, phoneNumberId, msg.retryPayload);
    const updated = await finalizeOutbound(phone, { ...msg, id: messageId }, response);
    res.json({ ok: true, message: updated });
  } catch (err) {
    console.error('retry message error:', err.message);
    await Store.updateMessageStatus(phone, messageId, 'failed');
    const body = await attachMetaError(
      { ok: false, error: String(err.message || err) },
      'messaging',
      err,
    );
    res.status(200).json(body);
  }
});

// Enviar menú interactivo (botones o lista) dentro de la ventana 24 h
app.post('/api/send-interactive', apiJson, async (req, res) => {
  const {
    phone,
    variant,
    body,
    footer,
    buttons,
    listButton,
    sections,
    replyToMessageId,
  } = req.body || {};

  if (!phone) return res.status(400).json({ ok: false, error: 'Se requiere "phone".' });
  const kind = String(variant || '').toLowerCase();
  if (kind !== 'buttons' && kind !== 'list') {
    return res.status(400).json({ ok: false, error: 'variant debe ser "buttons" o "list".' });
  }

  const validated = kind === 'buttons'
    ? validateButtonsPayload({ body, footer, buttons })
    : validateListPayload({ body, footer, listButton, sections });

  if (!validated.ok) {
    return res.status(400).json({ ok: false, error: validated.errors.join(' ') });
  }

  const convo = await Store.getConversation(phone);
  const phoneNumberId = (convo && convo.phoneNumberId) || config.phoneNumberId;
  if (!phoneNumberId || !config.accessToken) {
    return res.status(400).json({ ok: false, error: 'Falta PHONE_NUMBER_ID o ACCESS_TOKEN.' });
  }

  const replyTo = replyToMessageId && isWaMessageId(replyToMessageId)
    ? { messageId: replyToMessageId }
    : null;

  const interactiveMeta = buildOutboundInteractiveMeta(kind, validated);
  const preview = validated.body;
  const retryPayload = kind === 'buttons'
    ? {
      kind: 'interactive',
      variant: 'buttons',
      body: validated.body,
      footer: validated.footer || undefined,
      buttons: validated.normalized,
      replyToMessageId: replyTo ? replyTo.messageId : undefined,
    }
    : {
      kind: 'interactive',
      variant: 'list',
      body: validated.body,
      footer: validated.footer || undefined,
      listButton: validated.listButton,
      sections: validated.normalizedSections,
      replyToMessageId: replyTo ? replyTo.messageId : undefined,
    };

  let stored;
  try {
    stored = await Store.addMessage({
      phone,
      phoneNumberId,
      direction: 'out',
      text: preview,
      type: 'interactive',
      status: 'pending',
      interactiveMeta,
      retryPayload,
      replyTo,
    });

    const response = kind === 'buttons'
      ? await GraphApi.messageWithInteractiveButtons(phoneNumberId, phone, {
        body: validated.body,
        footer: validated.footer || undefined,
        buttons: validated.normalized,
        replyToMessageId: replyTo ? replyTo.messageId : undefined,
      })
      : await GraphApi.messageWithInteractiveList(phoneNumberId, phone, {
        body: validated.body,
        footer: validated.footer || undefined,
        listButton: validated.listButton,
        sections: validated.normalizedSections,
        replyToMessageId: replyTo ? replyTo.messageId : undefined,
      });

    await finalizeOutbound(phone, stored, response);
    await trackBillableSend({
      phone,
      messageId: stored.id,
      localMessageId: stored.id,
      kind: 'interactive',
      preview,
      source: `send_interactive_${kind}`,
    });
    res.json({ ok: true, message: stored });
  } catch (err) {
    console.error('send-interactive error:', err.message);
    if (stored) await Store.updateMessageStatus(phone, stored.id, 'failed');
    const body = await attachMetaError(
      { ok: false, message: stored, error: String(err.message || err) },
      'messaging',
      err,
    );
    res.status(200).json(body);
  }
});

// Send a text message manually from the web interface
app.post('/api/send', apiJson, async (req, res) => {
  const { phone, text, replyToMessageId } = req.body || {};
  if (!phone || !text) {
    return res.status(400).json({ error: 'Se requieren "phone" y "text".' });
  }

  const convo = await Store.getConversation(phone);
  const phoneNumberId =
    (convo && convo.phoneNumberId) || process.env.PHONE_NUMBER_ID;

  const replyTo = replyToMessageId && isWaMessageId(replyToMessageId)
    ? { messageId: replyToMessageId }
    : null;

  // Store the outgoing message right away so the UI feels responsive
  const stored = await Store.addMessage({
    phone,
    phoneNumberId,
    direction: 'out',
    text,
    type: 'text',
    status: 'pending',
    replyTo,
    retryPayload: {
      kind: 'text',
      text,
      replyToMessageId: replyTo ? replyTo.messageId : undefined,
    },
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
    const response = await GraphApi.messageWithText(undefined, phoneNumberId, phone, text, {
      replyToMessageId: replyTo ? replyTo.messageId : undefined,
    });
    await finalizeOutbound(phone, stored, response);
    await trackBillableSend({
      phone,
      messageId: stored.id,
      localMessageId: stored.id,
      kind: 'text',
      preview: text,
      source: 'send_text',
    });
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
    res.json({
      ok: true,
      line: parseLineHealth(raw),
      metaPlatform: await getMetaPlatformStatus(),
    });
  } catch (err) {
    console.error('line-health error:', err.message);
    res.json(await attachMetaError({ ok: false, error: String(err.message || err) }, 'line_health', err));
  }
});

// Meta platform status (metastatus.com — Cloud API, Flows, etc.)
app.get('/api/meta-platform-status', async (req, res) => {
  try {
    const data = await getMetaPlatformStatus({ force: req.query.refresh === '1' });
    res.json(data);
  } catch (err) {
    console.error('meta-platform-status error:', err.message);
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

function isCronTickAuthorized(req) {
  const secret = config.cronSecret;
  const auth = req.get('Authorization') || '';
  const bearer = auth.replace(/^Bearer\s+/i, '').trim();
  const headerSecret = req.get('X-Cron-Secret') || bearer;
  if (secret && headerSecret === secret) return true;
  return dashboardAuth.getSession(req).authenticated;
}

app.post('/api/campaigns/cron/tick', async (req, res) => {
  if (!isCronTickAuthorized(req)) {
    return res.status(401).json({ ok: false, error: 'No autorizado.' });
  }
  if (!config.phoneNumberId || !config.accessToken) {
    return res.status(400).json({ ok: false, error: 'Falta PHONE_NUMBER_ID o ACCESS_TOKEN.' });
  }
  try {
    const result = await CampaignRunner.tickAllRunning({
      listCampaigns: () => CampaignStore.listCampaigns(),
      findTemplate: findTemplateDefinition,
      phoneNumberId: config.phoneNumberId,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('campaign cron tick:', err.message);
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
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
  const variableGuide = variableSchema.enrichEventVariables(eventVariables, tpl.name);
  res.json({
    ok: true,
    template: tpl.name,
    language: tpl.language,
    category: tpl.category,
    eventVariables,
    variableGuide,
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
    variableGuide: variableSchema.enrichEventVariables(resolveEventVariables(tpl, {}, local), tpl.name),
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
  if (config.isProduction && !config.allowSimulate) {
    return res.status(403).json({
      ok: false,
      error: 'Simulación deshabilitada en producción. Usa ALLOW_SIMULATE=true solo en entornos de prueba.',
    });
  }
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

  PortalEvents.pushChatMessage({
    phone,
    name: name || `Demo ${phone}`,
    text,
    type: 'text',
    messageId: message && message.id,
  }).catch(() => {});

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

if (config.isProduction && !dashboardAuth.isAuthRequired()) {
  console.warn('WARNING: DASHBOARD_PASSWORD no configurado — el panel está abierto sin login.');
}
if (config.isProduction && !config.integrationApiKey) {
  console.warn('WARNING: INTEGRATION_API_KEY no configurado — la API de integración está bloqueada.');
}
if (config.isProduction && !config.cronSecret) {
  console.warn('WARNING: CRON_SECRET no configurado — el cron de Vercel no procesará cargas masivas en segundo plano.');
}

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

async function resendFromRetryPayload(phone, phoneNumberId, payload) {
  if (!payload || !payload.kind) {
    throw new Error('Este mensaje no se puede reintentar.');
  }
  const replyId = payload.replyToMessageId;
  switch (payload.kind) {
    case 'text':
      return GraphApi.messageWithText(undefined, phoneNumberId, phone, payload.text, {
        replyToMessageId: replyId,
      });
    case 'template':
      return GraphApi.sendTemplate(phoneNumberId, phone, {
        name: payload.template,
        language: payload.language || 'es',
        components: payload.components || [],
      });
    case 'media': {
      const waType = payload.mediaType || 'image';
      if (waType === 'sticker') {
        if (!payload.mediaId) throw new Error('No hay mediaId para reintentar el sticker.');
        return GraphApi.messageWithSticker(phoneNumberId, phone, {
          mediaId: payload.mediaId,
          replyToMessageId: replyId,
        });
      }
      if (!payload.link && !payload.mediaId) {
        throw new Error('No se puede reintentar: el archivo original ya no está disponible.');
      }
      return GraphApi.messageWithMedia(undefined, phoneNumberId, phone, {
        mediaType: waType,
        link: payload.link,
        mediaId: payload.mediaId,
        caption: payload.caption,
        filename: payload.filename,
        replyToMessageId: replyId,
      });
    }
    case 'location':
      return GraphApi.messageWithLocation(phoneNumberId, phone, {
        latitude: payload.latitude,
        longitude: payload.longitude,
        name: payload.name,
        address: payload.address,
        replyToMessageId: replyId,
      });
    case 'contacts':
      return GraphApi.messageWithContacts(phoneNumberId, phone, payload.contacts, replyId);
    case 'interactive':
      if (payload.variant === 'list') {
        return GraphApi.messageWithInteractiveList(phoneNumberId, phone, {
          body: payload.body,
          footer: payload.footer,
          listButton: payload.listButton,
          sections: payload.sections,
          replyToMessageId: replyId,
        });
      }
      return GraphApi.messageWithInteractiveButtons(phoneNumberId, phone, {
        body: payload.body,
        footer: payload.footer,
        buttons: payload.buttons,
        replyToMessageId: replyId,
      });
    default:
      throw new Error('Tipo de mensaje no compatible con reintento.');
  }
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
  const interactiveMeta = rawMessage.type === 'interactive'
    ? extractInteractiveMeta(rawMessage)
    : null;
  const text = interactiveMeta
    ? (interactivePreviewText(interactiveMeta) || extractMessageText(rawMessage))
    : extractMessageText(rawMessage);
  const ctx = rawMessage.context;
  const replyTo = ctx && ctx.id ? { messageId: String(ctx.id), from: ctx.from || null } : null;

  let location = null;
  if (rawMessage.type === 'location' && rawMessage.location) {
    location = {
      latitude: rawMessage.location.latitude,
      longitude: rawMessage.location.longitude,
      name: rawMessage.location.name || '',
      address: rawMessage.location.address || '',
    };
  }

  let reactionEmoji = null;
  let reactionTo = null;
  if (rawMessage.type === 'reaction' && rawMessage.reaction) {
    reactionEmoji = rawMessage.reaction.emoji || '';
    reactionTo = rawMessage.reaction.message_id || null;
  }

  let contacts = null;
  if (rawMessage.type === 'contacts' && Array.isArray(rawMessage.contacts)) {
    contacts = rawMessage.contacts.map((c) => ({
      name: (c.name && (c.name.formatted_name || c.name.first_name)) || '',
      phones: (c.phones || []).map((p) => p.phone || p.wa_id).filter(Boolean),
    }));
  }

  const message = await Store.addMessage({
    phone: rawMessage.from,
    name: contactNames[rawMessage.from],
    phoneNumberId: senderPhoneNumberId,
    direction: 'in',
    text,
    type: rawMessage.type,
    id: rawMessage.id,
    mediaId: extractMediaId(rawMessage),
    voice: audio ? Boolean(audio.voice) : null,
    status: 'received',
    replyTo,
    location,
    reactionEmoji,
    reactionTo,
    contacts,
    interactiveMeta,
  });

  PortalEvents.pushChatMessage({
    phone: rawMessage.from,
    name: contactNames[rawMessage.from],
    text,
    type: rawMessage.type,
    messageId: rawMessage.id,
  }).catch(() => {});

  return message;
}

function resolveMediaType(mimeType, requested) {
  const mime = String(mimeType || '').toLowerCase();
  if (requested === 'sticker' || mime === 'image/webp') return 'sticker';
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
      const meta = extractInteractiveMeta(rawMessage);
      return interactivePreviewText(meta) || '[interactive]';
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
    case 'location': {
      const loc = rawMessage.location || {};
      const parts = [loc.name, loc.address].filter(Boolean);
      if (parts.length) return parts.join(' · ');
      if (loc.latitude != null && loc.longitude != null) {
        return `${loc.latitude}, ${loc.longitude}`;
      }
      return '[ubicación]';
    }
    case 'reaction': {
      const emoji = rawMessage.reaction && rawMessage.reaction.emoji;
      return emoji ? `Reacción ${emoji}` : '[reacción]';
    }
    case 'contacts': {
      const list = rawMessage.contacts || [];
      const names = list.map((c) => (c.name && c.name.formatted_name) || '').filter(Boolean);
      return names.length ? `Contacto: ${names.join(', ')}` : '[contacto]';
    }
    case 'sticker':
      return '';
    default:
      return `[${rawMessage.type}]`;
  }
}


var listener = app.listen(config.port, () => {
  console.log(`The app is listening on port ${listener.address().port}`);
});
