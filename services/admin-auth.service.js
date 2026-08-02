const crypto = require("node:crypto");
const database = require("../database");
const env = require("../config/env");
const AppError = require("../errors/app-error");
const ERROR_CODES = require("../constants/error-codes");
const createAdminRepository = require("../repositories/admin.repository");
const { DUMMY_PASSWORD_HASH, verifyPassword } = require("../utils/password");
const { writeAudit } = require("./audit.service");

function iso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function scopeHash(username, ipAddress) {
  return crypto.createHash("sha256").update(`${username}|${ipAddress || "unknown"}`).digest("hex");
}

function mapAdmin(row) {
  const permissions = String(row.permission_codes || "").split(",").filter(Boolean);
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    status: row.status,
    role: { id: row.role_id, code: row.role_code, name: row.role_name },
    permissions,
    lastLoginAt: iso(row.last_login_at),
    passwordChangedAt: iso(row.password_changed_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function requestMeta(input = {}) {
  return {
    ipAddress: String(input.ipAddress || "").slice(0, 64) || null,
    userAgent: String(input.userAgent || "").slice(0, 500) || null,
    requestId: String(input.requestId || "").slice(0, 80) || null,
  };
}

function createAdminAuthService({
  sequelize = database.sequelize,
  repositoryFactory = createAdminRepository,
  config = env.adminAuth,
} = {}) {
  const repo = () => repositoryFactory({ sequelize });
  const inTransaction = (work) => sequelize.transaction(
    async (transaction) => work(repositoryFactory({ sequelize, transaction })),
  );

  function lockedError(retryAfterSeconds) {
    return new AppError({
      code: ERROR_CODES.ADMIN_ACCOUNT_LOCKED,
      message: "Too many login attempts; try again later",
      statusCode: 429,
      details: { retryAfterSeconds: Math.max(1, Math.ceil(retryAfterSeconds)) },
    });
  }

  function authFailedError() {
    return new AppError({
      code: ERROR_CODES.ADMIN_AUTH_FAILED,
      message: "Invalid administrator credentials",
      statusCode: 401,
    });
  }

  async function login(credentials, rawMeta) {
    const meta = requestMeta(rawMeta);
    const now = new Date();
    const guardKey = scopeHash(credentials.username, meta.ipAddress);
    const existingGuard = await repo().findLoginGuard(guardKey);
    if (existingGuard?.blocked_until && new Date(existingGuard.blocked_until).getTime() > now.getTime()) {
      throw lockedError((new Date(existingGuard.blocked_until).getTime() - now.getTime()) / 1000);
    }

    const candidate = await repo().findAdminByUsername(credentials.username);
    let passwordValid = await verifyPassword(
      credentials.password,
      candidate?.password_hash || DUMMY_PASSWORD_HASH,
    );

    const outcome = await inTransaction(async (repository) => {
      const expiresGuardAt = new Date(now.getTime() + (config.loginWindowSeconds + config.lockSeconds) * 1000);
      await repository.ensureLoginGuard(guardKey, now, expiresGuardAt);
      const guard = await repository.findLoginGuard(guardKey, true);
      if (guard.blocked_until && new Date(guard.blocked_until).getTime() > now.getTime()) {
        return {
          type: "LOCKED",
          retryAfterSeconds: (new Date(guard.blocked_until).getTime() - now.getTime()) / 1000,
        };
      }

      const current = await repository.findAdminByUsername(credentials.username, true);
      if (current && candidate?.password_hash !== current.password_hash) {
        passwordValid = await verifyPassword(credentials.password, current.password_hash);
      }

      async function recordGuardFailure() {
        const windowStart = new Date(guard.window_started_at);
        const resetWindow = now.getTime() - windowStart.getTime() >= config.loginWindowSeconds * 1000;
        const attemptCount = resetWindow ? 1 : Number(guard.attempt_count) + 1;
        const blockedUntil = attemptCount >= config.loginMaxAttempts
          ? new Date(now.getTime() + config.lockSeconds * 1000)
          : null;
        await repository.updateLoginGuard(guardKey, {
          attemptCount,
          windowStartedAt: resetWindow ? now : windowStart,
          blockedUntil,
          expiresAt: new Date(now.getTime() + (config.loginWindowSeconds + config.lockSeconds) * 1000),
          now,
        });
        return { attemptCount, blockedUntil };
      }

      if (!current || !passwordValid) {
        const guardFailure = await recordGuardFailure();
        let accountLockedUntil = null;
        if (current) {
          const previousLockExpired = current.locked_until && new Date(current.locked_until).getTime() <= now.getTime();
          const attempts = (previousLockExpired ? 0 : Number(current.failed_login_attempts)) + 1;
          accountLockedUntil = attempts >= config.accountMaxAttempts
            ? new Date(now.getTime() + config.lockSeconds * 1000)
            : null;
          await repository.recordAccountFailure(current.id, attempts, accountLockedUntil);
        }
        await writeAudit(repository, {
          adminUserId: current?.id || null,
          module: "auth",
          action: "LOGIN_FAILED",
          targetType: "ADMIN_USER",
          targetId: current?.id || null,
          targetLabel: credentials.username,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          after: { reason: "INVALID_CREDENTIALS" },
        });
        const blockedUntil = accountLockedUntil || guardFailure.blockedUntil;
        return blockedUntil
          ? { type: "LOCKED", retryAfterSeconds: (blockedUntil.getTime() - now.getTime()) / 1000 }
          : { type: "FAILED" };
      }

      if (current.locked_until && new Date(current.locked_until).getTime() > now.getTime()) {
        return {
          type: "LOCKED",
          retryAfterSeconds: (new Date(current.locked_until).getTime() - now.getTime()) / 1000,
        };
      }
      if (current.status !== "ACTIVE" || !Boolean(current.role_enabled)) {
        await writeAudit(repository, {
          adminUserId: current.id,
          module: "auth",
          action: "LOGIN_DENIED",
          targetType: "ADMIN_USER",
          targetId: current.id,
          targetLabel: current.username,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          after: { reason: "ACCOUNT_DISABLED" },
        });
        return { type: "DISABLED" };
      }

      const token = crypto.randomBytes(32).toString("base64url");
      const expiresAt = new Date(now.getTime() + config.sessionTtlSeconds * 1000);
      await repository.clearLoginGuard(guardKey);
      await repository.recordLoginSuccess(current.id, now);
      const sessionId = await repository.createSession({
        adminId: current.id,
        tokenHash: tokenHash(token),
        expiresAt,
        now,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      await writeAudit(repository, {
        adminUserId: current.id,
        module: "auth",
        action: "LOGIN_SUCCEEDED",
        targetType: "ADMIN_SESSION",
        targetId: sessionId,
        targetLabel: current.username,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
      });
      return { type: "SUCCESS", token, expiresAt };
    });

    if (outcome.type === "FAILED") throw authFailedError();
    if (outcome.type === "LOCKED") throw lockedError(outcome.retryAfterSeconds);
    if (outcome.type === "DISABLED") {
      throw new AppError({
        code: ERROR_CODES.ADMIN_ACCOUNT_DISABLED,
        message: "Administrator account is disabled",
        statusCode: 403,
      });
    }
    const authenticated = await authenticate(outcome.token);
    return {
      token: outcome.token,
      tokenType: "Bearer",
      expiresAt: outcome.expiresAt.toISOString(),
      admin: authenticated.admin,
    };
  }

  async function authenticate(token) {
    const repository = repo();
    const row = await repository.findSessionByTokenHash(tokenHash(token));
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.ADMIN_SESSION_EXPIRED,
        message: "Administrator session is invalid or expired",
        statusCode: 401,
      });
    }
    await repository.touchSession(row.session_id, new Date());
    return {
      admin: mapAdmin(row),
      session: { id: row.session_id, expiresAt: iso(row.expires_at), lastSeenAt: iso(row.last_seen_at) },
    };
  }

  async function refresh(context, oldToken, rawMeta) {
    const meta = requestMeta(rawMeta);
    const now = new Date();
    const token = crypto.randomBytes(32).toString("base64url");
    const expiresAt = new Date(now.getTime() + config.sessionTtlSeconds * 1000);
    await inTransaction(async (repository) => {
      const session = await repository.findSessionForUpdate(context.session.id, tokenHash(oldToken));
      if (!session) {
        throw new AppError({
          code: ERROR_CODES.ADMIN_SESSION_EXPIRED,
          message: "Administrator session is invalid or expired",
          statusCode: 401,
        });
      }
      await repository.rotateSession(session.id, {
        tokenHash: tokenHash(token), expiresAt, now,
        ipAddress: meta.ipAddress, userAgent: meta.userAgent,
      });
      await writeAudit(repository, {
        adminUserId: context.admin.id,
        module: "auth",
        action: "SESSION_REFRESHED",
        targetType: "ADMIN_SESSION",
        targetId: session.id,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
      });
    });
    return { token, tokenType: "Bearer", expiresAt: expiresAt.toISOString(), admin: context.admin };
  }

  async function logout(context, token, rawMeta) {
    const meta = requestMeta(rawMeta);
    await inTransaction(async (repository) => {
      await repository.revokeSession(context.session.id, tokenHash(token), new Date());
      await writeAudit(repository, {
        adminUserId: context.admin.id,
        module: "auth",
        action: "LOGOUT",
        targetType: "ADMIN_SESSION",
        targetId: context.session.id,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
      });
    });
    return { loggedOut: true };
  }

  async function getLogs(filters) {
    const result = await repo().findLogs(filters);
    return {
      items: result.rows.map((row) => ({
        id: row.id,
        module: row.module,
        action: row.action,
        targetType: row.target_type || null,
        targetId: row.target_id || null,
        targetLabel: row.target_label || null,
        requestId: row.request_id || null,
        before: row.before_json || null,
        after: row.after_json || null,
        operator: row.admin_user_id ? {
          id: row.admin_user_id,
          username: row.username || null,
          name: row.admin_name || null,
        } : null,
        createdAt: iso(row.created_at),
      })),
      page: filters.page,
      pageSize: filters.pageSize,
      total: result.total,
      hasMore: filters.page * filters.pageSize < result.total,
    };
  }

  return { login, authenticate, refresh, logout, getLogs };
}

module.exports = { createAdminAuthService, mapAdmin, tokenHash, scopeHash, requestMeta };
