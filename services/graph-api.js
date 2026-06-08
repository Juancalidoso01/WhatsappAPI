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
  static async messageWithMedia(messageId, senderPhoneNumberId, recipientPhoneNumber, { mediaType, link, mediaId, caption, filename }) {
    const type = ["image", "document", "audio", "video"].includes(mediaType) ? mediaType : "image";
    const media = mediaId ? { id: mediaId } : { link };
    if (caption && type !== "audio") media.caption = caption;
    if (type === "document" && filename) media.filename = filename;

    const requestBody = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipientPhoneNumber,
      type,
      [type]: media,
    };

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
    const f = `pricing_analytics.start(${start}).end(${end}).granularity(${granularity}).dimensions(PRICING_CATEGORY,PRICING_TYPE,COUNTRY)`;
    const url = `https://graph.facebook.com/v21.0/${wabaId}?fields=${encodeURIComponent(f)}&access_token=${accessToken}`;
    const res = await fetch(url);
    const json = await res.json();
    if (json.error) {
      throw new Error(json.error.error_user_msg || json.error.message || "Error de Graph API");
    }
    return json.pricing_analytics ? json.pricing_analytics.data || [] : [];
  }

  // --- WhatsApp message templates management (on the WABA) ---
  static async listTemplates(wabaId, pageSize = 100) {
    const api = getApi();
    const fields = "id,name,status,category,correct_category,language,components,quality_score,last_updated_time";
    const seen = new Set();
    const all = [];
    let after = null;
    let pages = 0;

    while (pages < 50) {
      const params = { limit: pageSize, fields };
      if (after) params.after = after;

      let page;
      try {
        page = await api.call("GET", [`${wabaId}`, "message_templates"], params);
      } catch (err) {
        if (all.length) break;
        const fallbackFields = "id,name,status,category,language,components,quality_score,last_updated_time";
        page = await api.call("GET", [`${wabaId}`, "message_templates"], { ...params, fields: fallbackFields });
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

    return { data: all };
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

  static async messageWithText(messageId, senderPhoneNumberId, recipientPhoneNumber, text) {
    const requestBody = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipientPhoneNumber,
      type: "text",
      text: {
        preview_url: false,
        body: text
      }
    };

    return this.#makeApiCall(messageId, senderPhoneNumberId, requestBody);
  }

  static async messageWithInteractiveReply(messageId, senderPhoneNumberId, recipientPhoneNumber, messageText, replyCTAs) {
    const requestBody = {
      messaging_product: "whatsapp",
      to: recipientPhoneNumber,
      type: "interactive",
      interactive: {
        type: "button",
        body: {
          text: messageText
        },
        action: {
          buttons: replyCTAs.map(cta => ({
            type: "reply",
            reply: {
              id: cta.id,
              title: cta.title
            }
          }))
        }
      }
    };

    return this.#makeApiCall(messageId, senderPhoneNumberId, requestBody);
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
