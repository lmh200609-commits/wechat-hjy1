const multer = require("multer");
const express = require("express");
const env = require("../config/env");

const multipartImage = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: env.mediaStorage.maxBytes, fields: 4 },
}).single("file");
const rawImage = express.raw({
  type: ["application/octet-stream", "image/jpeg", "image/png", "image/webp"],
  limit: env.mediaStorage.maxBytes,
});

function filename(value) {
  try { return decodeURIComponent(String(value || "image")).slice(0, 255); }
  catch { return "image"; }
}

function uploadImage(req, res, next) {
  if (req.is("multipart/form-data")) return multipartImage(req, res, next);
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

module.exports = { uploadImage };
