const crypto = require("crypto");

const SAFE_REQUEST_ID = /^[A-Za-z0-9_.:-]{8,128}$/;

function requestContext(req, res, next) {
  const provided = req.get("x-request-id");
  req.requestId = provided && SAFE_REQUEST_ID.test(provided) ? provided : crypto.randomUUID();
  req.startedAt = process.hrtime.bigint();
  res.set("x-request-id", req.requestId);
  next();
}

module.exports = requestContext;
