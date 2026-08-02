const logger = require("../utils/logger");

function requestLogger(req, res, next) {
  res.on("finish", () => {
    const elapsed = req.startedAt
      ? Number(process.hrtime.bigint() - req.startedAt) / 1_000_000
      : 0;

    logger.info("http_request", {
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl.split("?")[0],
      statusCode: res.statusCode,
      durationMs: Number(elapsed.toFixed(2)),
      contentLength: res.getHeader("content-length") || null,
      ip: req.ip,
      userAgent: req.get("user-agent") || null,
    });
  });
  next();
}

module.exports = requestLogger;
