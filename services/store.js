/**
 * Lightweight in-memory store for conversations and messages.
 *
 * Keeps the chat history that powers the local web interface and exposes a
 * tiny pub/sub so the UI can receive new messages in real time via SSE.
 * This is intentionally simple (process memory only) so the demo works
 * without extra infrastructure. Restarting the server clears the history.
 */

"use strict";

const EventEmitter = require("events");

const conversations = new Map();
const emitter = new EventEmitter();
emitter.setMaxListeners(0);

function getOrCreateConversation(phone, name, phoneNumberId) {
  let convo = conversations.get(phone);
  if (!convo) {
    convo = {
      phone,
      name: name || phone,
      phoneNumberId: phoneNumberId || null,
      messages: [],
      lastActivity: Date.now(),
    };
    conversations.set(phone, convo);
  }
  if (name && (!convo.name || convo.name === convo.phone)) {
    convo.name = name;
  }
  if (phoneNumberId) {
    convo.phoneNumberId = phoneNumberId;
  }
  return convo;
}

function addMessage({
  phone,
  name,
  phoneNumberId,
  direction,
  text,
  type = "text",
  status = null,
  id = null,
}) {
  const convo = getOrCreateConversation(phone, name, phoneNumberId);
  const message = {
    id: id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    direction,
    text,
    type,
    status,
    timestamp: Date.now(),
  };
  convo.messages.push(message);
  convo.lastActivity = message.timestamp;
  emitter.emit("message", { phone: convo.phone, name: convo.name, message });
  return message;
}

function updateMessageStatus(phone, messageId, status) {
  const convo = conversations.get(phone);
  if (!convo) return;
  const message = convo.messages.find((m) => m.id === messageId);
  if (message) {
    message.status = status;
    emitter.emit("message", { phone: convo.phone, name: convo.name, message });
  }
}

function getConversation(phone) {
  return conversations.get(phone) || null;
}

function listConversations() {
  return Array.from(conversations.values())
    .sort((a, b) => b.lastActivity - a.lastActivity)
    .map((c) => ({
      phone: c.phone,
      name: c.name,
      lastActivity: c.lastActivity,
      lastMessage: c.messages[c.messages.length - 1] || null,
    }));
}

function getMessages(phone) {
  const convo = conversations.get(phone);
  return convo ? convo.messages : [];
}

function subscribe(listener) {
  emitter.on("message", listener);
  return () => emitter.off("message", listener);
}

module.exports = {
  addMessage,
  updateMessageStatus,
  getConversation,
  listConversations,
  getMessages,
  subscribe,
};
