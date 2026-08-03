const AppError = require("../errors/app-error");
const ERROR_CODES = require("../constants/error-codes");
const logger = require("../utils/logger");

function errorHandlerMiddleware(error, req, res, next) {
  if (res.headersSent) return next(error);

  let normalizedError = error;
  if (error && error.name === "MulterError") {
    normalizedError = new AppError({
      code: error.code === "LIMIT_FILE_SIZE" ? ERROR_CODES.MEDIA_TOO_LARGE : ERROR_CODES.BAD_REQUEST,
      message: error.code === "LIMIT_FILE_SIZE" ? "Image exceeds the configured size limit" : "Invalid media upload",
      statusCode: error.code === "LIMIT_FILE_SIZE" ? 413 : 400,
      cause: error,
    });
  } else if (error && error.type === "entity.parse.failed") {
    normalizedError = new AppError({
      code: ERROR_CODES.BAD_REQUEST,
      message: "Invalid JSON request body",
      statusCode: 400,
      cause: error,
    });
  } else if (error && error.type === "entity.too.large") {
    normalizedError = new AppError({
      code: ERROR_CODES.BAD_REQUEST,
      message: "Request body is too large",
      statusCode: 413,
      cause: error,
    });
  } else if (error && [
    "SequelizeUniqueConstraintError",
    "SequelizeForeignKeyConstraintError",
  ].includes(error.name)) {
    normalizedError = new AppError({
      code: ERROR_CODES.CONFLICT,
      message: "The requested change conflicts with existing data",
      statusCode: 409,
      cause: error,
    });
  } else if (error && (
    String(error.name || "").startsWith("SequelizeConnection")
    || ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "PROTOCOL_CONNECTION_LOST"].includes(error.code)
  )) {
    normalizedError = new AppError({
      code: ERROR_CODES.SERVICE_UNAVAILABLE,
      message: "Service temporarily unavailable",
      statusCode: 503,
      expose: true,
      cause: error,
    });
  }

  const knownError = normalizedError instanceof AppError;
  const statusCode = knownError ? normalizedError.statusCode : 500;
  const expose = knownError && normalizedError.expose;
  const code = knownError ? normalizedError.code : ERROR_CODES.INTERNAL_ERROR;

  const logFields = {
    requestId: req.requestId,
    method: req.method,
    path: req.originalUrl.split("?")[0],
    statusCode,
    code,
  };

  if (statusCode >= 500) {
    logger.error("request_failed", { ...logFields, error: normalizedError });
  } else {
    logger.warn("request_rejected", {
      ...logFields,
      errorName: normalizedError.name,
      errorMessage: normalizedError.message,
    });
  }

  const send = () => res.status(statusCode).json({
      success: false,
      code,
      message: expose ? normalizedError.message : "Internal server error",
      data: null,
      details: expose ? normalizedError.details : undefined,
      requestId: req.requestId,
      timestamp: new Date().toISOString(),
    });

  if (req.idempotency && !req.idempotency.completed && statusCode < 500) {
    return req.idempotency.release().then(send, send);
  }
  return send();
}

module.exports = errorHandlerMiddleware;
