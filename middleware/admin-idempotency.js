const crypto = require("node:crypto");
const AppError = require("../errors/app-error");
const ERROR_CODES = require("../constants/error-codes");
const createRepository = require("../repositories/idempotency.repository");

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function hashRequest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value || {}))).digest("hex");
}

function fail(code, message, statusCode, details) {
  throw new AppError({ code, message, statusCode, details });
}

function createAdminIdempotencyMiddleware(scope, { repository = createRepository(), ttlMs = 24 * 60 * 60 * 1000 } = {}) {
  return async function adminIdempotency(req, res, next) {
    const key = String(req.get("idempotency-key") || "").trim();
    if (!key) return next();
    if (!/^[A-Za-z0-9._:-]{16,80}$/.test(key)) {
      fail(ERROR_CODES.IDEMPOTENCY_KEY_REQUIRED, "Idempotency-Key must contain 16 to 80 safe characters", 400);
    }
    const adminUserId = req.admin.id;
    const requestHash = hashRequest(req.validated || req.body);
    let existing = await repository.find(adminUserId, scope, key);
    if (existing && new Date(existing.expires_at).getTime() <= Date.now()) {
      await repository.remove(adminUserId, scope, key);
      existing = null;
    }
    if (existing) {
      if (existing.request_hash !== requestHash) {
        fail(ERROR_CODES.IDEMPOTENCY_CONFLICT, "Idempotency-Key was already used with different data", 409);
      }
      if (existing.status === "COMPLETED") {
        const data = existing.response_data_json ? JSON.parse(existing.response_data_json) : null;
        return res.success(data, existing.response_message || "success", Number(existing.response_status) || 200, existing.response_code || ERROR_CODES.OK);
      }
      fail(ERROR_CODES.IDEMPOTENCY_IN_PROGRESS, "The same operation is still being processed; refresh before retrying", 409);
    }
    try {
      await repository.insert({ adminUserId, scope, key, requestHash, expiresAt: new Date(Date.now() + ttlMs) });
    } catch (error) {
      if (error?.name !== "SequelizeUniqueConstraintError") throw error;
      existing = await repository.find(adminUserId, scope, key);
      if (existing?.request_hash !== requestHash) {
        fail(ERROR_CODES.IDEMPOTENCY_CONFLICT, "Idempotency-Key was already used with different data", 409);
      }
      fail(ERROR_CODES.IDEMPOTENCY_IN_PROGRESS, "The same operation is still being processed; refresh before retrying", 409);
    }
    const originalSuccess = res.success.bind(res);
    req.idempotency = {
      release: () => repository.remove(adminUserId, scope, key),
    };
    res.success = async function idempotentSuccess(data, message = "success", statusCode = 200, code = ERROR_CODES.OK) {
      await repository.complete({
        adminUserId,
        scope,
        key,
        requestHash,
        responseStatus: statusCode,
        responseCode: code,
        responseMessage: message,
        responseDataJson: JSON.stringify(data == null ? null : data),
      });
      req.idempotency.completed = true;
      return originalSuccess(data, message, statusCode, code);
    };
    return next();
  };
}

module.exports = { createAdminIdempotencyMiddleware, hashRequest };
