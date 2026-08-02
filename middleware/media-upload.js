const multer = require("multer");
const express = require("express");
const env = require("../config/env");
const AppError = require("../errors/app-error");
const ERROR_CODES = require("../constants/error-codes");

const multipartImage = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: env.mediaStorage.maxBytes, fields: 4 },
}).single("file");
const rawImage = express.raw({
  type: ["application/octet-stream", "image/jpeg", "image/png", "image/webp"],
  limit: env.mediaStorage.maxBytes,
});
const jsonImage = express.json({
  type: "application/json",
  limit: Math.ceil(env.mediaStorage.maxBytes * 4 / 3) + 65536,
});

function filename(value) {
  try { return decodeURIComponent(String(value || "image")).slice(0, 255); }
  catch { return "image"; }
}

function uploadError(code, message, statusCode) {
  return new AppError({ code, message, statusCode });
}

function decodeBase64Image(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const input = value.trim();
  const dataUrl = input.match(/^data:image\/(?:jpeg|png|webp);base64,(.+)$/i);
  const encoded = (dataUrl ? dataUrl[1] : input).replace(/\s+/g, "");
  if (!encoded || encoded.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw uploadError(ERROR_CODES.BAD_REQUEST, "Invalid Base64 image data", 400);
  }
  const buffer = Buffer.from(encoded, "base64");
  const canonicalInput = encoded.replace(/=+$/, "");
  const canonicalOutput = buffer.toString("base64").replace(/=+$/, "");
  if (!buffer.length || canonicalInput !== canonicalOutput) {
    throw uploadError(ERROR_CODES.BAD_REQUEST, "Invalid Base64 image data", 400);
  }
  if (buffer.length > env.mediaStorage.maxBytes) {
    throw uploadError(ERROR_CODES.MEDIA_TOO_LARGE, "Image exceeds the configured size limit", 413);
  }
  return buffer;
}

function parseJsonImage(req, res, next) {
  return jsonImage(req, res, (error) => {
    if (error) return next(error);
    try {
      const buffer = decodeBase64Image(req.body && req.body.contentBase64);
      if (buffer) {
        req.file = {
          buffer,
          size: buffer.length,
          originalname: filename(req.body.fileName),
        };
      }
      return next();
    } catch (decodeError) {
      return next(decodeError);
    }
  });
}

function uploadImage(req, res, next) {
  if (req.is("multipart/form-data")) return multipartImage(req, res, next);
  if (req.is("application/json")) return parseJsonImage(req, res, next);
  return rawImage(req, res, (error) => {
    if (error) return next(error);
    if (Buffer.isBuffer(req.body) && req.body.length) {
      req.file = {
        buffer: req.body,
        size: req.body.length,
        originalname: filename(req.get("x-file-name")),
      };
    }
    return next();
  });
}

module.exports = { uploadImage, decodeBase64Image };
