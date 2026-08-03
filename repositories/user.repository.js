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
      SELECT CAST(u.id AS CHAR) AS id, u.nickname, u.avatar_url,
        CAST(u.avatar_media_id AS CHAR) AS avatar_media_id,
        COALESCE(m.file_id, m.url) AS avatar_file_id,
        u.status, u.last_seen_at, u.created_at, u.updated_at
      FROM users u
      LEFT JOIN media_assets m ON m.id = u.avatar_media_id AND m.status = 'ACTIVE'
      WHERE u.openid = :openid
      LIMIT 1
    `, { ...options({ openid }), type: QueryTypes.SELECT });
    return rows[0] || null;
  }

  async function findById(userId, lock = false) {
    const rows = await sequelize.query(`
      SELECT CAST(u.id AS CHAR) AS id, u.nickname, u.avatar_url,
        CAST(u.avatar_media_id AS CHAR) AS avatar_media_id,
        COALESCE(m.file_id, m.url) AS avatar_file_id,
        u.status, u.last_seen_at, u.created_at, u.updated_at
      FROM users u
      LEFT JOIN media_assets m ON m.id = u.avatar_media_id AND m.status = 'ACTIVE'
      WHERE u.id = :userId
      LIMIT 1 ${lock ? "FOR UPDATE" : ""}
    `, { ...options({ userId }), type: QueryTypes.SELECT });
    return rows[0] || null;
  }

  async function findOwnedAvatarMedia(mediaId, userId) {
    const rows = await sequelize.query(`
      SELECT CAST(id AS CHAR) AS id, file_id, cloud_path, object_key, storage_provider,
        original_filename, url, mime_type, byte_size, width, height, sha256,
        reference_count, reference_status, status, created_by_admin_id, created_by_user_id,
        purpose, created_at, updated_at, deleted_at
      FROM media_assets
      WHERE id = :mediaId
        AND created_by_user_id = :userId
        AND purpose = 'USER_AVATAR'
        AND status = 'ACTIVE'
      LIMIT 1
    `, { ...options({ mediaId, userId }), type: QueryTypes.SELECT });
    return rows[0] || null;
  }

  async function updateProfile(userId, { nickname, avatarMediaId, avatarUrl }) {
    const sets = ["updated_at = CURRENT_TIMESTAMP(3)"];
    const replacements = { userId };
    if (nickname !== undefined) {
      sets.push("nickname = :nickname");
      replacements.nickname = nickname;
    }
    if (avatarMediaId !== undefined) {
      sets.push("avatar_media_id = :avatarMediaId", "avatar_url = :avatarUrl");
      replacements.avatarMediaId = avatarMediaId;
      replacements.avatarUrl = avatarUrl;
    }
    await sequelize.query(`UPDATE users SET ${sets.join(", ")} WHERE id = :userId`, options(replacements));
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

  return { findOrCreateByOpenId, findById, findOwnedAvatarMedia, updateProfile, findSummary };
}

module.exports = createUserRepository;
