const { QueryTypes } = require("sequelize");
const database = require("../database");

function createIdempotencyRepository({ sequelize = database.sequelize } = {}) {
  async function find(adminUserId, scope, key) {
    const rows = await sequelize.query(`
      SELECT CAST(id AS CHAR) AS id, request_hash, status, response_status,
             response_code, response_message, response_data_json, expires_at
      FROM admin_idempotency_records
      WHERE admin_user_id = :adminUserId AND scope = :scope AND idempotency_key = :key
      LIMIT 1
    `, { replacements: { adminUserId, scope, key }, type: QueryTypes.SELECT });
    return rows[0] || null;
  }

  async function insert(input) {
    await sequelize.query(`
      INSERT INTO admin_idempotency_records (
        admin_user_id, scope, idempotency_key, request_hash, status, expires_at, created_at, updated_at
      ) VALUES (
        :adminUserId, :scope, :key, :requestHash, 'PROCESSING', :expiresAt,
        CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
      )
    `, { replacements: input });
  }

  async function complete(input) {
    await sequelize.query(`
      UPDATE admin_idempotency_records
      SET status = 'COMPLETED', response_status = :responseStatus,
          response_code = :responseCode, response_message = :responseMessage,
          response_data_json = :responseDataJson, updated_at = CURRENT_TIMESTAMP(3)
      WHERE admin_user_id = :adminUserId AND scope = :scope AND idempotency_key = :key
        AND request_hash = :requestHash
    `, { replacements: input });
  }

  async function remove(adminUserId, scope, key) {
    await sequelize.query(`
      DELETE FROM admin_idempotency_records
      WHERE admin_user_id = :adminUserId AND scope = :scope AND idempotency_key = :key
    `, { replacements: { adminUserId, scope, key } });
  }

  return { find, insert, complete, remove };
}

module.exports = createIdempotencyRepository;
