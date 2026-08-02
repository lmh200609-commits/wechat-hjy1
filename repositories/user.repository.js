const { QueryTypes } = require("sequelize");
const database = require("../database");
const { normalizeSqlReplacements } = require("../utils/sql-replacements");

function createUserRepository({ sequelize = database.sequelize, transaction } = {}) {
  function options(replacements = {}) {
    return {
      replacements: normalizeSqlReplacements(replacements),
      ...(transaction ? { transaction } : {}),
    };
  }

  async function findOrCreateByOpenId(openid) {
    const now = new Date();
    await sequelize.query(`
      INSERT INTO users (openid, status, last_seen_at, created_at, updated_at)
      VALUES (:openid, 'ACTIVE', :now, :now, :now)
      ON DUPLICATE KEY UPDATE
        last_seen_at = IF(last_seen_at IS NULL OR last_seen_at < DATE_SUB(:now, INTERVAL 5 MINUTE), :now, last_seen_at)
    `, options({ openid, now }));
    const rows = await sequelize.query(`
      SELECT CAST(id AS CHAR) AS id, nickname, avatar_url, status, last_seen_at, created_at, updated_at
      FROM users
      WHERE openid = :openid
      LIMIT 1
    `, { ...options({ openid }), type: QueryTypes.SELECT });
    return rows[0] || null;
  }

  async function findSummary(userId) {
    const rows = await sequelize.query(`
      SELECT
        (SELECT COUNT(*) FROM orders WHERE user_id = :userId) AS order_count,
        (SELECT COUNT(*) FROM favorites WHERE user_id = :userId) AS favorite_count,
        (SELECT COUNT(*) FROM user_addresses WHERE user_id = :userId AND deleted_at IS NULL) AS address_count,
        (SELECT COALESCE(SUM(quantity), 0) FROM cart_items WHERE user_id = :userId) AS cart_count
    `, { ...options({ userId }), type: QueryTypes.SELECT });
    return rows[0];
  }

  return { findOrCreateByOpenId, findSummary };
}

module.exports = createUserRepository;
