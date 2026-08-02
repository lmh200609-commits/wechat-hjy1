const { QueryTypes } = require("sequelize");
const database = require("../database");
const { normalizeSqlReplacements } = require("../utils/sql-replacements");

function jsonValue(value) {
  return value == null ? null : JSON.stringify(value);
}

function createAdminRepository({ sequelize = database.sequelize, transaction } = {}) {
  function options(replacements = {}, type) {
    return {
      replacements: normalizeSqlReplacements(replacements),
      ...(type ? { type } : {}),
      ...(transaction ? { transaction } : {}),
    };
  }

  const ADMIN_FIELDS = `
    CAST(au.id AS CHAR) AS id, au.username, au.password_hash, au.name, au.status,
    CAST(au.failed_login_attempts AS CHAR) AS failed_login_attempts, au.locked_until,
    au.last_login_at, au.password_changed_at, au.created_at, au.updated_at, au.deleted_at,
    CAST(ar.id AS CHAR) AS role_id, ar.code AS role_code, ar.name AS role_name, ar.enabled AS role_enabled
  `;

  async function findAdminByUsername(username, lock = false) {
    const rows = await sequelize.query(`
      SELECT ${ADMIN_FIELDS}
      FROM admin_users au INNER JOIN admin_roles ar ON ar.id = au.role_id
      WHERE au.username = :username AND au.deleted_at IS NULL
      LIMIT 1 ${lock ? "FOR UPDATE" : ""}
    `, options({ username }, QueryTypes.SELECT));
    return rows[0] || null;
  }

  async function ensureLoginGuard(scopeHash, now, expiresAt) {
    await sequelize.query(`
      INSERT INTO admin_login_guards (
        scope_hash, attempt_count, window_started_at, blocked_until, expires_at, created_at, updated_at
      ) VALUES (:scopeHash, 0, :now, NULL, :expiresAt, :now, :now)
      ON DUPLICATE KEY UPDATE scope_hash = scope_hash
    `, options({ scopeHash, now, expiresAt }));
  }

  async function findLoginGuard(scopeHash, lock = false) {
    const rows = await sequelize.query(`
      SELECT scope_hash, CAST(attempt_count AS CHAR) AS attempt_count,
             window_started_at, blocked_until, expires_at
      FROM admin_login_guards WHERE scope_hash = :scopeHash
      LIMIT 1 ${lock ? "FOR UPDATE" : ""}
    `, options({ scopeHash }, QueryTypes.SELECT));
    return rows[0] || null;
  }

  async function updateLoginGuard(scopeHash, input) {
    await sequelize.query(`
      UPDATE admin_login_guards SET attempt_count = :attemptCount,
        window_started_at = :windowStartedAt, blocked_until = :blockedUntil,
        expires_at = :expiresAt, updated_at = :now
      WHERE scope_hash = :scopeHash
    `, options({ scopeHash, ...input }));
  }

  async function clearLoginGuard(scopeHash) {
    await sequelize.query("DELETE FROM admin_login_guards WHERE scope_hash = :scopeHash", options({ scopeHash }));
  }

  async function recordAccountFailure(adminId, attempts, lockedUntil) {
    await sequelize.query(`
      UPDATE admin_users SET failed_login_attempts = :attempts,
        locked_until = :lockedUntil, updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = :adminId
    `, options({ adminId, attempts, lockedUntil }));
  }

  async function recordLoginSuccess(adminId, now) {
    await sequelize.query(`
      UPDATE admin_users SET failed_login_attempts = 0, locked_until = NULL,
        last_login_at = :now, updated_at = :now WHERE id = :adminId
    `, options({ adminId, now }));
  }

  async function createSession(input) {
    await sequelize.query(`
      INSERT INTO admin_sessions (
        admin_user_id, token_hash, expires_at, last_seen_at, revoked_at,
        ip_address, user_agent, created_at
      ) VALUES (
        :adminId, :tokenHash, :expiresAt, :now, NULL,
        :ipAddress, :userAgent, :now
      )
    `, options(input));
    const rows = await sequelize.query("SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id", options({}, QueryTypes.SELECT));
    return rows[0].id;
  }

  async function findSessionByTokenHash(tokenHash) {
    const rows = await sequelize.query(`
      SELECT CAST(s.id AS CHAR) AS session_id, s.token_hash, s.expires_at, s.last_seen_at,
             ${ADMIN_FIELDS},
             GROUP_CONCAT(ap.code ORDER BY ap.code SEPARATOR ',') AS permission_codes
      FROM admin_sessions s
      INNER JOIN admin_users au ON au.id = s.admin_user_id
      INNER JOIN admin_roles ar ON ar.id = au.role_id
      LEFT JOIN admin_role_permissions arp ON arp.role_id = ar.id
      LEFT JOIN admin_permissions ap ON ap.id = arp.permission_id
      WHERE s.token_hash = :tokenHash AND s.revoked_at IS NULL AND s.expires_at > CURRENT_TIMESTAMP(3)
        AND au.deleted_at IS NULL AND au.status = 'ACTIVE' AND ar.enabled = 1
      GROUP BY s.id, au.id, ar.id
      LIMIT 1
    `, options({ tokenHash }, QueryTypes.SELECT));
    return rows[0] || null;
  }

  async function touchSession(sessionId, now) {
    await sequelize.query(`
      UPDATE admin_sessions SET last_seen_at = :now
      WHERE id = :sessionId AND (last_seen_at IS NULL OR last_seen_at < DATE_SUB(:now, INTERVAL 5 MINUTE))
    `, options({ sessionId, now }));
  }

  async function findSessionForUpdate(sessionId, tokenHash) {
    const rows = await sequelize.query(`
      SELECT CAST(id AS CHAR) AS id, CAST(admin_user_id AS CHAR) AS admin_user_id,
             token_hash, expires_at, revoked_at
      FROM admin_sessions
      WHERE id = :sessionId AND token_hash = :tokenHash AND revoked_at IS NULL
        AND expires_at > CURRENT_TIMESTAMP(3)
      LIMIT 1 FOR UPDATE
    `, options({ sessionId, tokenHash }, QueryTypes.SELECT));
    return rows[0] || null;
  }

  async function rotateSession(sessionId, input) {
    await sequelize.query(`
      UPDATE admin_sessions SET token_hash = :tokenHash, expires_at = :expiresAt,
        last_seen_at = :now, ip_address = :ipAddress, user_agent = :userAgent
      WHERE id = :sessionId
    `, options({ sessionId, ...input }));
  }

  async function revokeSession(sessionId, tokenHash, now) {
    await sequelize.query(`
      UPDATE admin_sessions SET revoked_at = COALESCE(revoked_at, :now)
      WHERE id = :sessionId AND token_hash = :tokenHash
    `, options({ sessionId, tokenHash, now }));
  }

  async function writeLog(input) {
    await sequelize.query(`
      INSERT INTO admin_operation_logs (
        admin_user_id, module, action, target_type, target_id, target_label,
        request_id, before_json, after_json, ip_address, created_at
      ) VALUES (
        :adminUserId, :module, :action, :targetType, :targetId, :targetLabel,
        :requestId, :beforeJson, :afterJson, :ipAddress, CURRENT_TIMESTAMP(3)
      )
    `, options({
      adminUserId: input.adminUserId || null,
      module: input.module,
      action: input.action,
      targetType: input.targetType || null,
      targetId: input.targetId || null,
      targetLabel: input.targetLabel || null,
      requestId: input.requestId || null,
      beforeJson: jsonValue(input.before),
      afterJson: jsonValue(input.after),
      ipAddress: input.ipAddress || null,
    }));
  }

  async function findLogs({ page, pageSize, module }) {
    const offset = (page - 1) * pageSize;
    const moduleFilter = module ? " AND l.module = :module" : "";
    const rows = await sequelize.query(`
      SELECT CAST(l.id AS CHAR) AS id, CAST(l.admin_user_id AS CHAR) AS admin_user_id,
             l.module, l.action, l.target_type, l.target_id, l.target_label,
             l.request_id, l.before_json, l.after_json, l.created_at,
             au.username, au.name AS admin_name
      FROM admin_operation_logs l
      LEFT JOIN admin_users au ON au.id = l.admin_user_id
      WHERE 1 = 1${moduleFilter}
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT :limit OFFSET :offset
    `, options({ module, limit: pageSize, offset }, QueryTypes.SELECT));
    const countRows = await sequelize.query(`
      SELECT COUNT(*) AS total FROM admin_operation_logs l WHERE 1 = 1${moduleFilter}
    `, options({ module }, QueryTypes.SELECT));
    return { rows, total: Number(countRows[0]?.total || 0) };
  }

  async function cleanupSecurityState(before) {
    const [, sessionMeta] = await sequelize.query(`
      DELETE FROM admin_sessions
      WHERE (expires_at < :before OR revoked_at < :before)
    `, options({ before }));
    const [, guardMeta] = await sequelize.query(
      "DELETE FROM admin_login_guards WHERE expires_at < CURRENT_TIMESTAMP(3)",
      options(),
    );
    return {
      sessionsDeleted: Number(sessionMeta?.affectedRows || 0),
      guardsDeleted: Number(guardMeta?.affectedRows || 0),
    };
  }

  return {
    findAdminByUsername,
    ensureLoginGuard,
    findLoginGuard,
    updateLoginGuard,
    clearLoginGuard,
    recordAccountFailure,
    recordLoginSuccess,
    createSession,
    findSessionByTokenHash,
    touchSession,
    findSessionForUpdate,
    rotateSession,
    revokeSession,
    writeLog,
    findLogs,
    cleanupSecurityState,
  };
}

module.exports = createAdminRepository;
