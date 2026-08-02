const AppError = require("../errors/app-error");
const ERROR_CODES = require("../constants/error-codes");
const { createAdminAuthService } = require("../services/admin-auth.service");

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

function bearerToken(req) {
  const authorization = req.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+([^\s]+)$/i);
  return match && TOKEN_PATTERN.test(match[1]) ? match[1] : null;
}

function createAdminAuthMiddleware({ service = createAdminAuthService() } = {}) {
  return async function requireAdmin(req, res, next) {
    const token = bearerToken(req);
    if (!token) {
      throw new AppError({
        code: ERROR_CODES.ADMIN_SESSION_EXPIRED,
        message: "Administrator session is required",
        statusCode: 401,
      });
    }
    const context = await service.authenticate(token);
    req.admin = context.admin;
    req.adminSession = context.session;
    req.adminToken = token;
    req.adminPermissions = new Set(context.admin.permissions);
    return next();
  };
}

function requireAdminPermission(permissionCode) {
  return function permissionMiddleware(req, res, next) {
    if (!req.adminPermissions?.has(permissionCode)) {
      return next(new AppError({
        code: ERROR_CODES.ADMIN_PERMISSION_DENIED,
        message: "Administrator permission is required",
        statusCode: 403,
        details: { permission: permissionCode },
      }));
    }
    return next();
  };
}

module.exports = { createAdminAuthMiddleware, requireAdminPermission, bearerToken, TOKEN_PATTERN };
