const { QueryTypes } = require("sequelize");
const database = require("../database");

function createCartRepository({ sequelize = database.sequelize, transaction } = {}) {
  function queryOptions(replacements = {}, type) {
    return {
      replacements,
      ...(type ? { type } : {}),
      ...(transaction ? { transaction } : {}),
    };
  }

  async function findItems(userId) {
    return sequelize.query(`
      SELECT
        CAST(ci.id AS CHAR) AS id,
        CAST(ci.product_id AS CHAR) AS product_id,
        CAST(ci.variant_id AS CHAR) AS variant_id,
        CAST(ci.quantity AS CHAR) AS quantity,
        ci.checked,
        p.name AS product_name,
        p.subtitle AS product_subtitle,
        p.sale_status,
        p.deleted_at AS product_deleted_at,
        c.enabled AS category_enabled,
        c.dimension AS category_dimension,
        COALESCE(m.enabled, 1) AS material_enabled,
        m.dimension AS material_dimension,
        v.spec_label,
        CAST(v.price_amount AS CHAR) AS price_amount,
        CAST(v.original_price_amount AS CHAR) AS original_price_amount,
        CAST(GREATEST(CAST(v.on_hand_quantity AS SIGNED) - CAST(v.reserved_quantity AS SIGNED), 0) AS CHAR) AS available_quantity,
        v.enabled AS variant_enabled,
        COALESCE(media.file_id, media.url) AS primary_image_url,
        ci.created_at,
        ci.updated_at
      FROM cart_items ci
      INNER JOIN products p ON p.id = ci.product_id
      INNER JOIN product_variants v ON v.id = ci.variant_id AND v.product_id = ci.product_id
      INNER JOIN categories c ON c.id = p.category_id
      LEFT JOIN categories m ON m.id = p.material_id
      LEFT JOIN product_images pi ON pi.id = (
        SELECT candidate.id
        FROM product_images candidate
        WHERE candidate.product_id = p.id AND candidate.kind = 'PRIMARY'
        ORDER BY candidate.sort_order ASC, candidate.id ASC
        LIMIT 1
      )
      LEFT JOIN media_assets media ON media.id = pi.media_id AND media.status = 'ACTIVE'
      WHERE ci.user_id = :userId
      ORDER BY ci.updated_at DESC, ci.id DESC
    `, queryOptions({ userId }, QueryTypes.SELECT));
  }

  async function findPurchaseContext(productId, variantId, lock = false) {
    const rows = await sequelize.query(`
      SELECT
        CAST(p.id AS CHAR) AS product_id,
        p.sale_status,
        p.deleted_at AS product_deleted_at,
        c.enabled AS category_enabled,
        c.dimension AS category_dimension,
        COALESCE(m.enabled, 1) AS material_enabled,
        m.dimension AS material_dimension,
        CAST(v.id AS CHAR) AS variant_id,
        v.enabled AS variant_enabled,
        CAST(v.price_amount AS CHAR) AS price_amount,
        CAST(GREATEST(CAST(v.on_hand_quantity AS SIGNED) - CAST(v.reserved_quantity AS SIGNED), 0) AS CHAR) AS available_quantity
      FROM products p
      INNER JOIN product_variants v ON v.product_id = p.id
      INNER JOIN categories c ON c.id = p.category_id
      LEFT JOIN categories m ON m.id = p.material_id
      WHERE p.id = :productId AND v.id = :variantId
      LIMIT 1
      ${lock ? "FOR UPDATE" : ""}
    `, queryOptions({ productId, variantId }, QueryTypes.SELECT));
    return rows[0] || null;
  }

  async function findItemById(userId, itemId, lock = false) {
    const rows = await sequelize.query(`
      SELECT CAST(id AS CHAR) AS id, CAST(product_id AS CHAR) AS product_id,
             CAST(variant_id AS CHAR) AS variant_id, CAST(quantity AS CHAR) AS quantity, checked
      FROM cart_items
      WHERE id = :itemId AND user_id = :userId
      LIMIT 1
      ${lock ? "FOR UPDATE" : ""}
    `, queryOptions({ userId, itemId }, QueryTypes.SELECT));
    return rows[0] || null;
  }

  async function findItemByVariant(userId, productId, variantId, lock = false) {
    const rows = await sequelize.query(`
      SELECT CAST(id AS CHAR) AS id, CAST(quantity AS CHAR) AS quantity, checked
      FROM cart_items
      WHERE user_id = :userId AND product_id = :productId AND variant_id = :variantId
      LIMIT 1
      ${lock ? "FOR UPDATE" : ""}
    `, queryOptions({ userId, productId, variantId }, QueryTypes.SELECT));
    return rows[0] || null;
  }

  async function insertItem(userId, productId, variantId, quantity) {
    await sequelize.query(`
      INSERT INTO cart_items (user_id, product_id, variant_id, quantity, checked, created_at, updated_at)
      VALUES (:userId, :productId, :variantId, :quantity, 1, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
    `, queryOptions({ userId, productId, variantId, quantity }));
  }

  async function updateItem(userId, itemId, patch) {
    const assignments = [];
    const replacements = { userId, itemId };
    if (patch.quantity !== undefined) {
      assignments.push("quantity = :quantity");
      replacements.quantity = patch.quantity;
    }
    if (patch.checked !== undefined) {
      assignments.push("checked = :checked");
      replacements.checked = patch.checked;
    }
    if (!assignments.length) return;
    assignments.push("updated_at = CURRENT_TIMESTAMP(3)");
    await sequelize.query(`
      UPDATE cart_items
      SET ${assignments.join(", ")}
      WHERE id = :itemId AND user_id = :userId
    `, queryOptions(replacements));
  }

  async function deleteItem(userId, itemId) {
    await sequelize.query(
      "DELETE FROM cart_items WHERE id = :itemId AND user_id = :userId",
      queryOptions({ userId, itemId }),
    );
  }

  async function updateSelection(userId, checked, itemIds) {
    const filter = itemIds === undefined ? "" : " AND ci.id IN (:itemIds)";
    const replacements = { userId, checked, itemIds: itemIds || [] };
    if (checked) {
      await sequelize.query(`
        UPDATE cart_items ci
        SET ci.checked = 0, ci.updated_at = CURRENT_TIMESTAMP(3)
        WHERE ci.user_id = :userId${filter}
      `, queryOptions(replacements));
      await sequelize.query(`
        UPDATE cart_items ci
        INNER JOIN products p ON p.id = ci.product_id
        INNER JOIN product_variants v ON v.id = ci.variant_id AND v.product_id = ci.product_id
        INNER JOIN categories c ON c.id = p.category_id
        LEFT JOIN categories m ON m.id = p.material_id
        SET ci.checked = 1, ci.updated_at = CURRENT_TIMESTAMP(3)
        WHERE ci.user_id = :userId${filter}
          AND p.sale_status = 'ON_SALE' AND p.deleted_at IS NULL
          AND c.enabled = 1 AND c.dimension = 'PRODUCT_CATEGORY'
          AND COALESCE(m.enabled, 1) = 1 AND (m.id IS NULL OR m.dimension = 'MATERIAL')
          AND v.enabled = 1
          AND ci.quantity <= GREATEST(CAST(v.on_hand_quantity AS SIGNED) - CAST(v.reserved_quantity AS SIGNED), 0)
      `, queryOptions(replacements));
      return;
    }
    await sequelize.query(`
      UPDATE cart_items ci
      SET ci.checked = 0, ci.updated_at = CURRENT_TIMESTAMP(3)
      WHERE ci.user_id = :userId${filter}
    `, queryOptions(replacements));
  }

  return {
    findItems,
    findPurchaseContext,
    findItemById,
    findItemByVariant,
    insertItem,
    updateItem,
    deleteItem,
    updateSelection,
  };
}

module.exports = createCartRepository;
