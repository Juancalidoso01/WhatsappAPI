"use strict";

const crypto = require("crypto");

class FlowEndpointException extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function decryptRequest(body, privatePem) {
  const { encrypted_aes_key, encrypted_flow_data, initial_vector } = body || {};
  if (!encrypted_aes_key || !encrypted_flow_data || !initial_vector) {
    throw new FlowEndpointException(421, "Invalid encrypted payload.");
  }

  let decryptedAesKey;
  try {
    decryptedAesKey = crypto.privateDecrypt(
      {
        key: privatePem,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256",
      },
      Buffer.from(encrypted_aes_key, "base64")
    );
  } catch (e) {
    throw new FlowEndpointException(421, "Failed to decrypt AES key.");
  }

  const flowDataBuffer = Buffer.from(encrypted_flow_data, "base64");
  const initialVectorBuffer = Buffer.from(initial_vector, "base64");
  const TAG_LENGTH = 16;
  const encryptedBody = flowDataBuffer.subarray(0, flowDataBuffer.length - TAG_LENGTH);
  const authTag = flowDataBuffer.subarray(flowDataBuffer.length - TAG_LENGTH);

  let decryptedJSONString;
  try {
    const decipher = crypto.createDecipheriv("aes-128-gcm", decryptedAesKey, initialVectorBuffer);
    decipher.setAuthTag(authTag);
    decryptedJSONString = Buffer.concat([decipher.update(encryptedBody), decipher.final()]).toString("utf-8");
  } catch (e) {
    throw new FlowEndpointException(421, "Failed to decrypt flow data.");
  }

  return {
    decryptedBody: JSON.parse(decryptedJSONString),
    aesKeyBuffer: decryptedAesKey,
    initialVectorBuffer,
  };
}

function flipIv(ivBuffer) {
  return Buffer.from([...ivBuffer].map((byte) => byte ^ 0xff));
}

function encryptResponse(response, aesKeyBuffer, initialVectorBuffer) {
  const flippedIV = flipIv(initialVectorBuffer);

  const cipher = crypto.createCipheriv("aes-128-gcm", aesKeyBuffer, flippedIV);
  return Buffer.concat([
    cipher.update(JSON.stringify(response), "utf-8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString("base64");
}

function isFlowSignatureValid(req, appSecret) {
  if (!appSecret) return true;
  const sig = req.get("x-hub-signature-256");
  if (!sig) return false;
  const expected = `sha256=${crypto
    .createHmac("sha256", appSecret)
    .update(JSON.stringify(req.body))
    .digest("hex")}`;
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch (_) {
    return false;
  }
}

module.exports = {
  FlowEndpointException,
  decryptRequest,
  encryptResponse,
  flipIv,
  isFlowSignatureValid,
};
