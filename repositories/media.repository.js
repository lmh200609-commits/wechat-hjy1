const { QueryTypes } = require("sequelize");
const database = require("../database");
const createAdminRepository = require("./admin.repository");

function createMediaRepository({ sequelize = database.sequelize, transaction } = {}) {
  const query = (sql, replacements = {}, type) => sequelize.query(sql, {
    replacements,
    ...(type ? { type } : {}),
    ...(transaction ? { transaction } : {}),
  });
  const audit = createAdminRepository({ sequelize, transaction });
  const fields = `CAST(id AS CHAR) AS id, object_key, file_id, cloud_path, storage_provider,
    original_filename, url, mime_type, CAST(byte_size AS CHAR) AS byte_size,
    CAST(width AS CHAR) AS width, CAST(height AS CHAR) AS height, sha256,
    CAST(reference_count AS CHAR) AS reference_count, reference_status, status,
    CAST(created_by_admin_id AS CHAR) AS created_by_admin_id,
    CAST(created_by_user_id AS CHAR) AS created_by_user_id, purpose,
    created_at, updated_at, deleted_at`;

  async function insert(input) {
    await query(`
      INSERT INTO media_assets (
        object_key, file_id, cloud_path, storage_provider, original_filename, url,
        mime_type, byte_size, width, height, sha256, reference_count, reference_status,
        status, created_by_admin_id, created_by_user_id, purpose, created_at, updated_at
      ) VALUES (
        :cloudPath, :fileID, :cloudPath, :storageProvider, :originalFilename, NULL,
        :mimeType, :byteSize, :width, :height, :sha256, 0, 'UNREFERENCED',
        'ACTIVE', :adminId, :userId, :purpose, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
      )
    `, input);
    const rows = await query("SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id", {}, QueryTypes.SELECT);
    return rows[0].id;
  }

  async function findById(id, lock = false) {
    const rows = await query(`SELECT ${fields} FROM media_assets WHERE id = :id LIMIT 1 ${lock ? "FOR UPDATE" : ""}`, { id }, QueryTypes.SELECT);
    return rows[0] || null;
  }

  async function list({ page, pageSize, referenceStatus }) {
    const filter = referenceStatus === "ALL" ? "" : " AND reference_status = :referenceStatus";
    const replacements = { referenceStatus, limit: pageSize, offset: (page - 1) * pageSize };
    const rows = await query(`SELECT ${fields} FROM media_assets WHERE status <> 'DELETED'${filter} ORDER BY created_at DESC, id DESC LIMIT :limit OFFSET :offset`, replacements, QueryTypes.SELECT);
    const counts = await query(`SELECT COUNT(*) AS total FROM media_assets WHERE status <> 'DELETED'${filter}`, replacements, QueryTypes.SELECT);
    return { rows, total: Number(counts[0]?.total || 0) };
  }

  async function computeReferenceCount(id) {
    const rows = await query(`
      SELECT (
        (SELECT COUNT(*) FROM product_images pi INNER JOIN products p ON p.id = pi.product_id
          WHERE pi.media_id = :id AND p.deleted_at IS NULL AND p.sale_status <> 'DELETED')
        + (SELECT COUNT(*) FROM banners WHERE image_media_id = :id)
        + (SELECT COUNT(*) FROM collections WHERE cover_media_id = :id AND deleted_at IS NULL)
        + (SELECT COUNT(*) FROM articles WHERE cover_media_id = :id AND deleted_at IS NULL)
        + (SELECT COUNT(*) FROM users WHERE avatar_media_id = :id)
      ) AS reference_count
    `, { id }, QueryTypes.SELECT);
    const jsonSources = await query(`
      SELECT detail_sections_json AS body_json FROM products
      WHERE deleted_at IS NULL AND sale_status <> 'DELETED'
      UNION ALL
      SELECT body_json FROM articles WHERE deleted_at IS NULL
    `, {}, QueryTypes.SELECT);
    let structuredCount = 0;
    for (const source of jsonSources) {
      let blocks = source.body_json;
      if (typeof blocks === "string") {
        try { blocks = JSON.parse(blocks); } catch { blocks = []; }
      }
      if (!Array.isArray(blocks)) continue;
      structuredCount += blocks.filter((block) => (
        String(block?.type || "").toUpperCase() === "IMAGE" && String(block.mediaId) === String(id)
      )).length;
    }
    return Number(rows[0]?.reference_count || 0) + structuredCount;
  }

  async function updateReferenceState(id, count) {
    await query(`UPDATE media_assets SET reference_count = :count,
      reference_status = CASE WHEN :count > 0 THEN 'REFERENCED' ELSE 'UNREFERENCED' END,
      updated_at = CURRENT_TIMESTAMP(3) WHERE id = :id`, { id, count });
  }

  async function refreshReferenceState(ids) {
    for (const id of [...new Set(ids.map(String))]) {
      const count = await computeReferenceCount(id);
      await updateReferenceState(id, count);
    }
  }

  async function setStatus(id, status) {
    await query(`UPDATE media_assets SET status = :status,
      deleted_at = CASE WHEN :status = 'DELETED' THEN CURRENT_TIMESTAMP(3) ELSE NULL END,
      updated_at = CURRENT_TIMESTAMP(3) WHERE id = :id`, { id, status });
  }

  return {
    writeLog: audit.writeLog,
    insert,
    findById,
    list,
    computeReferenceCount,
    updateReferenceState,
    refreshReferenceState,
    setStatus,
  };
}

module.exports = createMediaRepository;
