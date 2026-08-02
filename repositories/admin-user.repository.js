const { QueryTypes } = require('sequelize');
const database = require('../database');
const { normalizeSqlReplacements } = require('../utils/sql-replacements');

function createAdminUserRepository({ sequelize = database.sequelize, transaction } = {}) {
  const options = (replacements = {}, type) => ({ replacements: normalizeSqlReplacements(replacements), ...(type ? { type } : {}), ...(transaction ? { transaction } : {}) });
  const fields = `CAST(au.id AS CHAR) AS id, au.username, au.name, au.status, au.last_login_at, au.password_changed_at, au.created_at, au.updated_at, CAST(ar.id AS CHAR) AS role_id, ar.code AS role_code, ar.name AS role_name`;
  async function listUsers() { return sequelize.query(`SELECT ${fields} FROM admin_users au INNER JOIN admin_roles ar ON ar.id = au.role_id WHERE au.deleted_at IS NULL ORDER BY au.created_at DESC, au.id DESC`, options({}, QueryTypes.SELECT)); }
  async function listRoles() { return sequelize.query(`SELECT CAST(id AS CHAR) AS id, code, name, description FROM admin_roles WHERE enabled = 1 ORDER BY id`, options({}, QueryTypes.SELECT)); }
  async function roleByCode(code) { const rows = await sequelize.query(`SELECT CAST(id AS CHAR) AS id, code, name FROM admin_roles WHERE code = :code AND enabled = 1 LIMIT 1`, options({ code }, QueryTypes.SELECT)); return rows[0] || null; }
  async function userById(id, lock = false) { const rows = await sequelize.query(`SELECT ${fields} FROM admin_users au INNER JOIN admin_roles ar ON ar.id = au.role_id WHERE au.id = :id AND au.deleted_at IS NULL LIMIT 1 ${lock ? 'FOR UPDATE' : ''}`, options({ id }, QueryTypes.SELECT)); return rows[0] || null; }
  async function usernameTaken(username, exceptId) { const rows = await sequelize.query(`SELECT CAST(id AS CHAR) AS id FROM admin_users WHERE username = :username AND deleted_at IS NULL ${exceptId ? 'AND id <> :exceptId' : ''} LIMIT 1`, options({ username, exceptId }, QueryTypes.SELECT)); return Boolean(rows[0]); }
  async function activeSuperCount(lock = false) { const rows = await sequelize.query(`SELECT au.id FROM admin_users au INNER JOIN admin_roles ar ON ar.id = au.role_id WHERE au.deleted_at IS NULL AND au.status = 'ACTIVE' AND ar.code = 'SUPER_ADMIN' ${lock ? 'FOR UPDATE' : ''}`, options({}, QueryTypes.SELECT)); return rows.length; }
  async function insertUser(input) { await sequelize.query(`INSERT INTO admin_users (username, password_hash, name, role_id, status, password_changed_at, created_at, updated_at) VALUES (:username, :passwordHash, :name, :roleId, :status, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`, options(input)); const rows = await sequelize.query('SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id', options({}, QueryTypes.SELECT)); return rows[0].id; }
  async function updateUser(id, input) { await sequelize.query(`UPDATE admin_users SET name = :name, role_id = :roleId, status = :status, password_hash = COALESCE(:passwordHash, password_hash), password_changed_at = CASE WHEN :passwordHash IS NULL THEN password_changed_at ELSE CURRENT_TIMESTAMP(3) END, failed_login_attempts = CASE WHEN :status = 'ACTIVE' THEN 0 ELSE failed_login_attempts END, locked_until = CASE WHEN :status = 'ACTIVE' THEN NULL ELSE locked_until END, updated_at = CURRENT_TIMESTAMP(3) WHERE id = :id`, options({ id, ...input })); }
  async function revokeSessions(id) { await sequelize.query(`UPDATE admin_sessions SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP(3)) WHERE admin_user_id = :id AND revoked_at IS NULL`, options({ id })); }
  return { listUsers, listRoles, roleByCode, userById, usernameTaken, activeSuperCount, insertUser, updateUser, revokeSessions };
}
module.exports = createAdminUserRepository;
