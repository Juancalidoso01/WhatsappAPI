/**
 * Copyright 2021-present, Facebook, Inc. All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree.
 */

"use strict";

const { FacebookAdsApi } = require('facebook-nodejs-business-sdk');
const config = require("./config");

// Lazily create the SDK client. Building it at import time throws
// "Access token required" when no token is configured, which would crash
// the whole server (and every serverless invocation on Vercel).
let api;
function getApi() {
  if (!api) {
    if (!config.accessToken) {
      throw new Error('ACCESS_TOKEN no configurado: no se puede llamar a la API de WhatsApp.');
    }
    api = new FacebookAdsApi(config.accessToken);
  }
  return api;
}

module.exports = class GraphApi {
  static async #makeApiCall(messageId, senderPhoneNumberId, requestBody) {
    try {
      const api = getApi();
      // Mark as read and send typing indicator
      if (messageId) {
        const typingBody = {
          messaging_product: "whatsapp",
          status: "read",
          message_id: messageId,
          "typing_indicator": {
            "type": "text"
          }
        };

        await api.call(
          'POST',
          [`${senderPhoneNumberId}`, 'messages'],
          typingBody
        );
      }


      const response = await api.call(
        'POST',
        [`${senderPhoneNumberId}`, 'messages'],
        requestBody
      );
      console.log('API call successful:', response);
      return response;
    } catch (error) {
      console.error('Error making API call:', error);
      throw error;
    }
  }

  static async markAsRead(senderPhoneNumberId, messageId) {
    if (!messageId || !senderPhoneNumberId) return null;
    const api = getApi();
    return api.call(
      'POST',
      [`${senderPhoneNumberId}`, 'messages'],
      {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      },
    );
  }

  static async messageWithReaction(senderPhoneNumberId, recipientPhoneNumber, targetMessageId, emoji) {
    const requestBody = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipientPhoneNumber,
      type: 'reaction',
      reaction: {
        message_id: targetMessageId,
        emoji: emoji || '',
      },
    };
    const api = getApi();
    return api.call('POST', [`${senderPhoneNumberId}`, 'messages'], requestBody);
  }

  static #withReplyContext(requestBody, replyToMessageId) {
    if (replyToMessageId) {
      requestBody.context = { message_id: replyToMessageId };
    }
    return requestBody;
  }

  // --- Upload media to WhatsApp (returns media id for sending) ---
  static async uploadMedia(phoneNumberId, { buffer, mimeType, filename, type }) {
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", type);
    form.append("file", new Blob([buffer], { type: mimeType }), filename || "file");

    const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/media?access_token=${config.accessToken}`;
    const res = await fetch(url, { method: "POST", body: form });
    const json = await res.json();
    if (json.error) {
      throw new Error(json.error.error_user_msg || json.error.message || "Error al subir media");
    }
    return json.id;
  }

  // --- Media (image / document / audio / video) by link or uploaded media id ---
  static async messageWithLocation(senderPhoneNumberId, recipientPhoneNumber, {
    latitude, longitude, name, address, replyToMessageId,
  }) {
    const location = {
      latitude: Number(latitude),
      longitude: Number(longitude),
    };
    if (name) location.name = String(name).slice(0, 256);
    if (address) location.address = String(address).slice(0, 256);

    const requestBody = this.#withReplyContext({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipientPhoneNumber,
      type: "location",
      location,
    }, replyToMessageId);

    const api = getApi();
    return api.call("POST", [`${senderPhoneNumberId}`, "messages"], requestBody);
  }

  static async messageWithContacts(senderPhoneNumberId, recipientPhoneNumber, contacts, replyToMessageId) {
    const requestBody = this.#withReplyContext({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipientPhoneNumber,
      type: "contacts",
      contacts: (contacts || []).map((c) => {
        const name = String(c.name || c.formatted_name || "Contacto").trim();
        const parts = name.split(/\s+/);
        const entry = {
          name: {
            formatted_name: name.slice(0, 256),
            first_name: parts[0] || name,
          },
          phones: [{
            phone: String(c.phone || "").replace(/\D/g, ""),
            type: c.phone_type || "CELL",
          }],
        };
        if (parts.length > 1) entry.name.last_name = parts.slice(1).join(" ").slice(0, 256);
        if (c.email) entry.emails = [{ email: String(c.email).trim(), type: "WORK" }];
        return entry;
      }),
    }, replyToMessageId);

    const api = getApi();
    return api.call("POST", [`${senderPhoneNumberId}`, "messages"], requestBody);
  }

  static async messageWithSticker(senderPhoneNumberId, recipientPhoneNumber, { mediaId, replyToMessageId }) {
    const requestBody = this.#withReplyContext({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipientPhoneNumber,
      type: "sticker",
      sticker: { id: String(mediaId) },
    }, replyToMessageId);

    const api = getApi();
    return api.call("POST", [`${senderPhoneNumberId}`, "messages"], requestBody);
  }

  static async messageWithMedia(messageId, senderPhoneNumberId, recipientPhoneNumber, { mediaType, link, mediaId, caption, filename, replyToMessageId }) {
    const type = ["image", "document", "audio", "video"].includes(mediaType) ? mediaType : "image";
    const media = mediaId ? { id: mediaId } : { link };
    if (caption && type !== "audio") media.caption = caption;
    if (type === "document" && filename) media.filename = filename;

    const requestBody = this.#withReplyContext({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipientPhoneNumber,
      type,
      [type]: media,
    }, replyToMessageId);

    return this.#makeApiCall(messageId, senderPhoneNumberId, requestBody);
  }

  // --- Generic approved-template sender (used to start conversations) ---
  static async sendTemplate(senderPhoneNumberId, recipientPhoneNumber, { name, language = "es", components = [] }) {
    const template = { name, language: { code: language } };
    if (components && components.length) template.components = components;

    const requestBody = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipientPhoneNumber,
      type: "template",
      template,
    };

    return this.#makeApiCall(undefined, senderPhoneNumberId, requestBody);
  }

  // --- Download media metadata (image, audio, video, document) ---
  static async getMediaInfo(mediaId) {
    const url = `https://graph.facebook.com/v21.0/${mediaId}?access_token=${config.accessToken}`;
    const res = await fetch(url);
    const json = await res.json();
    if (json.error) {
      throw new Error(json.error.error_user_msg || json.error.message || "Error al obtener media");
    }
    return json;
  }

  // --- WhatsApp Business profile (what clients see) ---
  static async getBusinessProfile(phoneNumberId) {
    const id = phoneNumberId || config.phoneNumberId;
    if (!id || !config.accessToken) {
      throw new Error("PHONE_NUMBER_ID o ACCESS_TOKEN no configurados.");
    }
    const fields = [
      "about",
      "address",
      "description",
      "email",
      "profile_picture_url",
      "websites",
      "vertical",
    ].join(",");
    const url = `https://graph.facebook.com/v21.0/${id}/whatsapp_business_profile?fields=${encodeURIComponent(fields)}&access_token=${config.accessToken}`;
    const res = await fetch(url);
    const json = await res.json();
    if (json.error) {
      throw new Error(json.error.error_user_msg || json.error.message || "Error al leer perfil de WhatsApp.");
    }
    return json.data && json.data[0] ? json.data[0] : json;
  }

  static async updateBusinessProfile(phoneNumberId, { about, description, email, websites, address, vertical }) {
    const id = phoneNumberId || config.phoneNumberId;
    if (!id || !config.accessToken) {
      throw new Error("PHONE_NUMBER_ID o ACCESS_TOKEN no configurados.");
    }
    const body = { messaging_product: "whatsapp" };
    if (about != null) body.about = String(about).slice(0, 139);
    if (description != null) body.description = String(description).slice(0, 512);
    if (email != null) body.email = String(email);
    if (address != null) body.address = String(address);
    if (vertical != null) body.vertical = String(vertical);
    if (Array.isArray(websites)) body.websites = websites.map(String).slice(0, 2);

    const url = `https://graph.facebook.com/v21.0/${id}/whatsapp_business_profile?access_token=${config.accessToken}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (json.error) {
      throw new Error(json.error.error_user_msg || json.error.message || "Error al actualizar perfil.");
    }
    return json;
  }

  // --- Phone line health: quality rating + daily unique messaging limit ---
  static async getPhoneLineHealth(phoneNumberId) {
    const id = phoneNumberId || config.phoneNumberId;
    if (!id || !config.accessToken) {
      throw new Error("PHONE_NUMBER_ID o ACCESS_TOKEN no configurados.");
    }
    const fields = [
      "display_phone_number",
      "verified_name",
      "quality_rating",
      "whatsapp_business_manager_messaging_limit",
      "messaging_limit_tier",
      "code_verification_status",
      "health_status",
    ].join(",");
    const url = `https://graph.facebook.com/v21.0/${id}?fields=${encodeURIComponent(fields)}&access_token=${config.accessToken}`;
    const res = await fetch(url);
    const json = await res.json();
    if (json.error) {
      throw new Error(json.error.error_user_msg || json.error.message || "Error al consultar la línea.");
    }
    json.id = json.id || id;
    return json;
  }

  // --- Billing / pricing analytics (cost & volume by country + category) ---
  static async pricingAnalytics(wabaId, accessToken, { start, end, granularity = "DAILY" }) {
    const versions = ["v25.0", "v22.0", "v21.0"];
    let lastMsg = "pricing_analytics no disponible";

    for (const ver of versions) {
      const qs = new URLSearchParams({
        start: String(start),
        end: String(end),
        granularity,
        access_token: accessToken,
      });
      ["PRICING_CATEGORY", "COUNTRY"].forEach((dim) => qs.append("dimensions", dim));

      const url = `https://graph.facebook.com/${ver}/${wabaId}/pricing_analytics?${qs}`;
      const res = await fetch(url);
      const json = await res.json();
      if (!json.error) return Array.isArray(json.data) ? json.data : [];

      lastMsg = json.error.error_user_msg || json.error.message || lastMsg;
      if (json.error.code === 190) break;
    }

    throw new Error(lastMsg);
  }

  static flattenPricingPoints(data) {
    const points = [];
    (data || []).forEach((d) => {
      if (Array.isArray(d.data_points)) {
        d.data_points.forEach((p) => points.push(p));
      } else if (d.pricing_category || d.country) {
        points.push(d);
      }
    });
    return points;
  }

  static #templatesCache = { wabaId: null, at: 0, data: [] };
  static #TEMPLATES_CACHE_MS = 3 * 60 * 1000;

  static #metaErrorMessage(json) {
    const err = json && json.error;
    if (!err) return "Error al consultar plantillas en Meta.";
    return err.error_user_msg || err.message || "Error al consultar plantillas en Meta.";
  }

  static #isTransientMetaError(json) {
    const code = json && json.error && Number(json.error.code);
    return [1, 2, 4, 17, 32, 613, 80007].includes(code);
  }

  static async #fetchTemplatePage(wabaId, { fields, limit, after, version }) {
    const qs = new URLSearchParams({
      fields,
      limit: String(limit),
      access_token: config.accessToken,
    });
    if (after) qs.set("after", after);
    const url = `https://graph.facebook.com/${version}/${wabaId}/message_templates?${qs}`;
    const res = await fetch(url);
    const json = await res.json();
    if (json.error) {
      const err = new Error(GraphApi.#metaErrorMessage(json));
      err.meta = json.error;
      throw err;
    }
    return json;
  }

  static async #fetchTemplatesPageWithFallbacks(wabaId, { limit, after }) {
    const fieldSets = [
      "id,name,status,category,correct_category,language,components,quality_score,last_updated_time",
      "id,name,status,category,language,components,quality_score,last_updated_time",
      "id,name,status,category,language,components,last_updated_time",
      "id,name,status,category,language,components",
    ];
    const versions = ["v22.0", "v21.0"];
    let lastErr = new Error("No se pudieron cargar las plantillas desde Meta.");

    for (const version of versions) {
      for (const fields of fieldSets) {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            return await GraphApi.#fetchTemplatePage(wabaId, { fields, limit, after, version });
          } catch (err) {
            lastErr = err;
            const transient = err.meta && GraphApi.#isTransientMetaError({ error: err.meta });
            if (transient && attempt === 0) {
              await new Promise((r) => setTimeout(r, 600));
              continue;
            }
            break;
          }
        }
      }
    }

    throw lastErr;
  }

  // --- WhatsApp message templates management (on the WABA) ---
  static async listTemplates(wabaId, pageSize = 100) {
    const seen = new Set();
    const all = [];
    let after = null;
    let pages = 0;

    while (pages < 50) {
      let page;
      try {
        page = await GraphApi.#fetchTemplatesPageWithFallbacks(wabaId, {
          limit: pageSize,
          after,
        });
      } catch (err) {
        if (all.length) {
          GraphApi.#templatesCache = { wabaId: String(wabaId), at: Date.now(), data: all };
          return { data: all, partial: true };
        }
        throw err;
      }

      ((page && page.data) || []).forEach((tpl) => {
        const key = `${tpl.name}|${tpl.language}`;
        if (seen.has(key)) return;
        seen.add(key);
        all.push(tpl);
      });

      const next = page && page.paging && page.paging.cursors && page.paging.cursors.after;
      if (!next || next === after || !page.paging || !page.paging.next) break;
      after = next;
      pages++;
    }

    GraphApi.#templatesCache = { wabaId: String(wabaId), at: Date.now(), data: all };
    return { data: all };
  }

  static getCachedTemplates(wabaId) {
    const cache = GraphApi.#templatesCache;
    if (!cache || cache.wabaId !== String(wabaId) || !cache.data.length) return null;
    if (Date.now() - cache.at > GraphApi.#TEMPLATES_CACHE_MS) return null;
    return { data: cache.data, cachedAt: cache.at };
  }

  static async createTemplate(wabaId, { name, category, language, components }) {
    const api = getApi();
    return api.call("POST", [`${wabaId}`, "message_templates"], {
      name,
      category,
      language,
      components,
    });
  }

  static async deleteTemplate(wabaId, name) {
    const api = getApi();
    return api.call("DELETE", [`${wabaId}`, "message_templates"], { name });
  }

  // --- WhatsApp Flows ---
  static async listFlows(wabaId) {
    const fields = "id,name,status,categories,updated_time";
    const url = `https://graph.facebook.com/v21.0/${wabaId}/flows?fields=${encodeURIComponent(fields)}&access_token=${config.accessToken}`;
    const res = await fetch(url);
    const json = await res.json();
    if (json.error) {
      throw new Error(json.error.error_user_msg || json.error.message || "Error al listar Flows.");
    }
    return json;
  }

  static async deleteFlow(flowId) {
    const url = `https://graph.facebook.com/v21.0/${flowId}?access_token=${config.accessToken}`;
    const res = await fetch(url, { method: "DELETE" });
    const json = await res.json().catch(() => ({}));
    if (json.error) {
      throw new Error(json.error.error_user_msg || json.error.message || "Error al eliminar Flow.");
    }
    return json;
  }

  static async getFlow(flowId, fields) {
    const f = fields || "id,name,status,categories,validation_errors,json_version,endpoint_uri,preview,health_status";
    const url = `https://graph.facebook.com/v21.0/${flowId}?fields=${encodeURIComponent(f)}&access_token=${config.accessToken}`;
    const res = await fetch(url);
    const json = await res.json();
    if (json.error) {
      throw new Error(json.error.error_user_msg || json.error.message || "Error al leer Flow.");
    }
    return json;
  }

  static async getFlowHealthForPhone(flowId, phoneNumberId) {
    const f = `health_status.phone_number(${phoneNumberId})`;
    return this.getFlow(flowId, f);
  }

  static async createFlow(wabaId, { name, categories, flowJson, publish, endpointUri }) {
    const body = {
      name,
      categories: categories || ["OTHER"],
      flow_json: typeof flowJson === "string" ? flowJson : JSON.stringify(flowJson),
    };
    if (publish) body.publish = true;
    if (endpointUri) body.endpoint_uri = endpointUri;

    const url = `https://graph.facebook.com/v21.0/${wabaId}/flows?access_token=${config.accessToken}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (json.error) {
      throw new Error(json.error.error_user_msg || json.error.message || "Error al crear Flow.");
    }
    return json;
  }

  static async publishFlow(flowId) {
    const url = `https://graph.facebook.com/v21.0/${flowId}/publish?access_token=${config.accessToken}`;
    const res = await fetch(url, { method: "POST" });
    const json = await res.json();
    if (json.error) {
      throw new Error(json.error.error_user_msg || json.error.message || "Error al publicar Flow.");
    }
    return json;
  }

  static async deprecateFlow(flowId) {
    const url = `https://graph.facebook.com/v21.0/${flowId}/deprecate?access_token=${config.accessToken}`;
    const res = await fetch(url, { method: "POST" });
    const json = await res.json();
    if (json.error) {
      throw new Error(json.error.error_user_msg || json.error.message || "Error al deprecar Flow.");
    }
    return json;
  }

  static async getFlowJsonAsset(flowId) {
    const url = `https://graph.facebook.com/v21.0/${flowId}/assets?access_token=${config.accessToken}`;
    const res = await fetch(url);
    const json = await res.json();
    if (json.error) {
      throw new Error(json.error.error_user_msg || json.error.message || "Error al listar assets del Flow.");
    }
    const assets = json.data || [];
    const flowAsset = assets.find((a) =>
      a.asset_type === "FLOW_JSON" || a.name === "flow.json" || a.mime_type === "application/json"
    );
    if (!flowAsset) {
      throw new Error("No se encontró flow.json en Meta.");
    }
    const downloadUrl = flowAsset.download_url
      || (flowAsset.id ? `https://graph.facebook.com/v21.0/${flowAsset.id}?access_token=${config.accessToken}` : null);
    if (!downloadUrl) throw new Error("Meta no devolvió URL de descarga para flow.json.");
    const dl = await fetch(downloadUrl);
    const flowJson = await dl.json();
    if (flowJson.error) {
      throw new Error(flowJson.error.error_user_msg || flowJson.error.message || "Error al descargar flow.json.");
    }
    return flowJson;
  }

  static async updateFlowJson(flowId, flowJson) {
    const jsonStr = typeof flowJson === "string" ? flowJson : JSON.stringify(flowJson);
    const form = new FormData();
    form.append("name", "flow.json");
    form.append("asset_type", "FLOW_JSON");
    form.append("file", new Blob([jsonStr], { type: "application/json" }), "flow.json");

    const url = `https://graph.facebook.com/v21.0/${flowId}/assets?access_token=${config.accessToken}`;
    const res = await fetch(url, { method: "POST", body: form });
    const json = await res.json();
    if (json.error) {
      throw new Error(json.error.error_user_msg || json.error.message || "Error al actualizar Flow JSON.");
    }
    return json;
  }

  static async uploadFlowPublicKey(phoneNumberId, publicKeyPem) {
    const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/whatsapp_business_encryption?access_token=${config.accessToken}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ business_public_key: publicKeyPem }),
    });
    const json = await res.json();
    if (json.error) {
      throw new Error(json.error.error_user_msg || json.error.message || "Error al registrar clave pública.");
    }
    return json;
  }

  static async sendFlowMessage(senderPhoneNumberId, recipientPhoneNumber, {
    flowId,
    flowToken,
    cta,
    bodyText,
    screen,
    initialData,
    mode,
    headerText,
    footerText,
    flowAction,
  }) {
    const parameters = {
      flow_message_version: "3",
      flow_token: flowToken || `ptp_${Date.now()}`,
      flow_id: String(flowId),
      flow_cta: cta || "Abrir",
    };
    if (flowAction === "data_exchange") {
      parameters.flow_action = "data_exchange";
    } else {
      parameters.flow_action = "navigate";
      const payload = { screen: screen || "WELCOME_SCREEN" };
      if (initialData && Object.keys(initialData).length) payload.data = initialData;
      parameters.flow_action_payload = payload;
    }
    if (mode === "draft") parameters.mode = "draft";

    const interactive = {
      type: "flow",
      body: { text: bodyText || "Confirma tu pago para continuar con la transacción." },
      action: { name: "flow", parameters },
    };
    if (headerText) interactive.header = { type: "text", text: headerText };
    if (footerText) interactive.footer = { text: footerText };

    const requestBody = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipientPhoneNumber,
      type: "interactive",
      interactive,
    };

    const api = getApi();
    return api.call("POST", [`${senderPhoneNumberId}`, "messages"], requestBody);
  }

  static async messageWithText(messageId, senderPhoneNumberId, recipientPhoneNumber, text, options = {}) {
    const requestBody = this.#withReplyContext({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipientPhoneNumber,
      type: "text",
      text: {
        preview_url: false,
        body: text
      }
    }, options.replyToMessageId);

    return this.#makeApiCall(messageId, senderPhoneNumberId, requestBody);
  }

  static async messageWithInteractiveReply(messageId, senderPhoneNumberId, recipientPhoneNumber, messageText, replyCTAs) {
    return this.messageWithInteractiveButtons(senderPhoneNumberId, recipientPhoneNumber, {
      body: messageText,
      buttons: replyCTAs,
      replyToMessageId: undefined,
      useTypingCall: true,
      inboundMessageId: messageId,
    });
  }

  static async messageWithInteractiveButtons(senderPhoneNumberId, recipientPhoneNumber, {
    body, footer, buttons, replyToMessageId, useTypingCall, inboundMessageId,
  }) {
    const interactive = {
      type: "button",
      body: { text: String(body) },
      action: {
        buttons: (buttons || []).map((cta) => ({
          type: "reply",
          reply: {
            id: String(cta.id),
            title: String(cta.title),
          },
        })),
      },
    };
    if (footer) interactive.footer = { text: String(footer) };

    const requestBody = this.#withReplyContext({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipientPhoneNumber,
      type: "interactive",
      interactive,
    }, replyToMessageId);

    if (useTypingCall && inboundMessageId) {
      return this.#makeApiCall(inboundMessageId, senderPhoneNumberId, requestBody);
    }
    const api = getApi();
    return api.call("POST", [`${senderPhoneNumberId}`, "messages"], requestBody);
  }

  static async messageWithInteractiveList(senderPhoneNumberId, recipientPhoneNumber, {
    body, footer, listButton, sections, replyToMessageId,
  }) {
    const interactive = {
      type: "list",
      body: { text: String(body) },
      action: {
        button: String(listButton),
        sections: (sections || []).map((sec) => ({
          title: sec.title || undefined,
          rows: (sec.rows || []).map((row) => ({
            id: String(row.id),
            title: String(row.title),
            description: row.description ? String(row.description) : undefined,
          })),
        })),
      },
    };
    if (footer) interactive.footer = { text: String(footer) };

    const requestBody = this.#withReplyContext({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipientPhoneNumber,
      type: "interactive",
      interactive,
    }, replyToMessageId);

    const api = getApi();
    return api.call("POST", [`${senderPhoneNumberId}`, "messages"], requestBody);
  }

  static async messageWithUtilityTemplate(messageId, senderPhoneNumberId, recipientPhoneNumber, options) {
    const { templateName, locale, imageLink } = options;
    const requestBody = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipientPhoneNumber,
      type: "template",
      template: {
        "name": templateName,
        "language": {
          "code": locale
        },
        "components": [
          {
            "type": "header",
            "parameters": [
              {
                "type": "image",
                "image": {
                  "link": imageLink
                }
              }
            ]
          },
        ]
      }
    };

    return this.#makeApiCall(messageId, senderPhoneNumberId, requestBody);
  }

  static async messageWithLimitedTimeOfferTemplate(messageId, senderPhoneNumberId, recipientPhoneNumber, options) {

    const { templateName, locale, imageLink, offerCode } = options;

    const currentTime = new Date();
    const futureTime = new Date(currentTime.getTime() + (48 * 60 * 60 * 1000));

    const requestBody = {
      "messaging_product": "whatsapp",
      "recipient_type": "individual",
      "to": recipientPhoneNumber,
      "type": "template",
      "template": {
        "name": templateName,
        "language": {
          "code": locale
        },
        "components": [
          {
            "type": "header",
            "parameters": [
              {
                "type": "image",
                "image": {
                  "link": imageLink
                }
              }
            ]
          },
          {
            "type": "limited_time_offer",
            "parameters": [
              {
                "type": "limited_time_offer",
                "limited_time_offer": {
                  "expiration_time_ms": futureTime.getTime()
                }
              }
            ]
          },
          {
            "type": "button",
            "sub_type": "copy_code",
            "index": 0,
            "parameters": [
              {
                "type": "coupon_code",
                "coupon_code": offerCode
              }
            ]
          }
        ]
      }
    };

    return this.#makeApiCall(messageId, senderPhoneNumberId, requestBody);
  }

  static async messageWithMediaCardCarousel(messageId, senderPhoneNumberId, recipientPhoneNumber, options) {
    const { templateName, locale, imageLinks } = options;
    const requestBody = {
      "messaging_product": "whatsapp",
      "recipient_type": "individual",
      "to": recipientPhoneNumber,
      "type": "template",
      "template": {
        "name": templateName,
        "language": {
          "code": locale
        },
        "components": [
          {
            "type": "carousel",
            "cards": imageLinks.map((imageLink, idx) => ({
              "card_index": idx,
              "components": [
                {
                  "type": "header",
                  "parameters": [
                    {
                      "type": "image",
                      "image": {
                        "link": imageLink
                      }
                    }
                  ]
                }
              ]
            }))
          }
        ]
      }
    };

    return this.#makeApiCall(messageId, senderPhoneNumberId, requestBody);
  }

};
