const { QueryTypes } = require("sequelize");
const database = require("../database");

function createFavoriteRepository({ sequelize = database.sequelize, transaction } = {}) {
  function options(replacements = {}, type) {
    return { replacements, ...(type ? { type } : {}), ...(transaction ? { transaction } : {}) };
  }

  async function findAll(userId, { page, pageSize }) {
    const offset = (page - 1) * pageSize;
    const items = await sequelize.query(`
      SELECT CAST(p.id AS CHAR) AS id, p.code, p.name, p.subtitle, p.sale_status,
             CAST(p.sales_count AS CHAR) AS sales_count, p.deleted_at,
             c.enabled AS category_enabled, c.dimension AS category_dimension,
             COALESCE(m.enabled, 1) AS material_enabled, m.dimension AS material_dimension,
             media.url AS primary_image_url,
             CAST(vs.min_price_amount AS CHAR) AS min_price_amount,
             CAST(vs.max_price_amount AS CHAR) AS max_price_amount,
             CAST(vs.available_quantity AS CHAR) AS available_quantity,
             f.created_at AS favorited_at
      FROM favorites f
      INNER JOIN products p ON p.id = f.product_id
      INNER JOIN categories c ON c.id = p.category_id
      LEFT JOIN categories m ON m.id = p.material_id
      LEFT JOIN (
        SELECT product_id, MIN(price_amount) AS min_price_amount, MAX(price_amount) AS max_price_amount,
               SUM(GREATEST(CAST(on_hand_quantity AS SIGNED) - CAST(reserved_quantity AS SIGNED), 0)) AS available_quantity
        FROM product_variants WHERE enabled = 1 GROUP BY product_id
      ) vs ON vs.product_id = p.id
      LEFT JOIN product_images pi ON pi.id = (
        SELECT candidate.id FROM product_images candidate
        WHERE candidate.product_id = p.id AND candidate.kind = 'PRIMARY'
        ORDER BY candidate.sort_order ASC, candidate.id ASC LIMIT 1
      )
      LEFT JOIN media_assets media ON media.id = pi.media_id AND media.status = 'ACTIVE'
      WHERE f.user_id = :userId
      ORDER BY f.created_at DESC, p.id DESC
      LIMIT :limit OFFSET :offset
    `, options({ userId, limit: pageSize, offset }, QueryTypes.SELECT));
    const rows = await sequelize.query(
      "SELECT COUNT(*) AS total FROM favorites WHERE user_id = :userId",
      options({ userId }, QueryTypes.SELECT),
    );
    return { items, total: Number(rows[0]?.total || 0) };
  }

  async function findAvailableProduct(productId) {
    const rows = await sequelize.query(`
      SELECT CAST(p.id AS CHAR) AS id
      FROM products p
      INNER JOIN categories c ON c.id = p.category_id
      LEFT JOIN categories m ON m.id = p.material_id
      WHERE p.id = :productId AND p.sale_status = 'ON_SALE' AND p.deleted_at IS NULL
        AND c.enabled = 1 AND c.dimension = 'PRODUCT_CATEGORY'
        AND (m.id IS NULL OR (m.enabled = 1 AND m.dimension = 'MATERIAL'))
      LIMIT 1
    `, options({ productId }, QueryTypes.SELECT));
    return rows[0] || null;
  }

  async function put(userId, productId) {
    await sequelize.query(`
      INSERT INTO favorites (user_id, product_id, created_at)
      VALUES (:userId, :productId, CURRENT_TIMESTAMP(3))
      ON DUPLICATE KEY UPDATE user_id = user_id
    `, options({ userId, productId }));
  }

  async function remove(userId, productId) {
    await sequelize.query(
      "DELETE FROM favorites WHERE user_id = :userId AND product_id = :productId",
      options({ userId, productId }),
    );
  }

  return { findAll, findAvailableProduct, put, remove };
}

module.exports = createFavoriteRepository;
