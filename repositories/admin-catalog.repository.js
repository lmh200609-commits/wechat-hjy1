const { QueryTypes } = require("sequelize");
const database = require("../database");
const createAdminRepository = require("./admin.repository");

function json(value) {
  return value == null ? null : JSON.stringify(value);
}

function createAdminCatalogRepository({ sequelize = database.sequelize, transaction } = {}) {
  function options(replacements = {}, type) {
    return { replacements, ...(type ? { type } : {}), ...(transaction ? { transaction } : {}) };
  }
  const auditRepository = createAdminRepository({ sequelize, transaction });

  async function findCategories({ dimension, enabled }) {
    const dimensionFilter = dimension === "ALL" ? "" : " AND c.dimension = :dimension";
    const enabledFilter = enabled === undefined ? "" : " AND c.enabled = :enabled";
    return sequelize.query(`
      SELECT CAST(c.id AS CHAR) AS id, c.code, c.dimension, c.name,
             CAST(c.parent_id AS CHAR) AS parent_id, c.icon_text,
             CAST(c.sort_order AS CHAR) AS sort_order, c.enabled,
             CAST((SELECT COUNT(*) FROM products p
                   WHERE (p.category_id = c.id OR p.material_id = c.id)
                     AND p.deleted_at IS NULL) AS CHAR) AS product_count,
             c.created_at, c.updated_at
      FROM categories c
      WHERE 1 = 1${dimensionFilter}${enabledFilter}
      ORDER BY c.dimension ASC, c.sort_order ASC, c.id ASC
    `, options({ dimension, enabled: enabled ? 1 : 0 }, QueryTypes.SELECT));
  }

  async function findCategory(categoryId, lock = false) {
    const rows = await sequelize.query(`
      SELECT CAST(id AS CHAR) AS id, code, dimension, name,
             CAST(parent_id AS CHAR) AS parent_id, icon_text,
             CAST(sort_order AS CHAR) AS sort_order, enabled, created_at, updated_at
      FROM categories WHERE id = :categoryId
      LIMIT 1 ${lock ? "FOR UPDATE" : ""}
    `, options({ categoryId }, QueryTypes.SELECT));
    return rows[0] || null;
  }

  async function findCategoryByCodeOrName(code, dimension, name, excludeId = null) {
    const exclude = excludeId ? " AND id <> :excludeId" : "";
    const rows = await sequelize.query(`
      SELECT CAST(id AS CHAR) AS id, code, name FROM categories
      WHERE (code = :code OR (dimension = :dimension AND name = :name))${exclude}
      LIMIT 1
    `, options({ code, dimension, name, excludeId }, QueryTypes.SELECT));
    return rows[0] || null;
  }

  async function nextCategorySortOrder(dimension) {
    const rows = await sequelize.query(
      "SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_value FROM categories WHERE dimension = :dimension",
      options({ dimension }, QueryTypes.SELECT),
    );
    return Number(rows[0].next_value);
  }

  async function insertCategory(input) {
    await sequelize.query(`
      INSERT INTO categories (
        code, dimension, name, parent_id, icon_text, sort_order, enabled, created_at, updated_at
      ) VALUES (
        :code, :dimension, :name, NULL, :iconText, :sortOrder, 1,
        CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
      )
    `, options(input));
    const rows = await sequelize.query("SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id", options({}, QueryTypes.SELECT));
    return rows[0].id;
  }

  async function updateCategory(categoryId, input) {
    await sequelize.query(`
      UPDATE categories SET name = :name, icon_text = :iconText, enabled = :enabled,
        updated_at = CURRENT_TIMESTAMP(3) WHERE id = :categoryId
    `, options({ categoryId, ...input }));
  }

  async function categoryReferences(categoryId) {
    const rows = await sequelize.query(`
      SELECT
        (SELECT COUNT(*) FROM products WHERE (category_id = :categoryId OR material_id = :categoryId)) AS product_count,
        (SELECT COUNT(*) FROM home_quick_categories WHERE category_id = :categoryId) AS home_count,
        (SELECT COUNT(*) FROM categories WHERE parent_id = :categoryId) AS child_count
    `, options({ categoryId }, QueryTypes.SELECT));
    return {
      productCount: Number(rows[0].product_count),
      homeCount: Number(rows[0].home_count),
      childCount: Number(rows[0].child_count),
    };
  }

  async function deleteCategory(categoryId) {
    await sequelize.query("DELETE FROM categories WHERE id = :categoryId", options({ categoryId }));
  }

  async function findCategoryIdsByDimension(dimension, lock = false) {
    return sequelize.query(`
      SELECT CAST(id AS CHAR) AS id FROM categories
      WHERE dimension = :dimension ORDER BY sort_order ASC, id ASC
      ${lock ? "FOR UPDATE" : ""}
    `, options({ dimension }, QueryTypes.SELECT));
  }

  async function reorderCategories(categoryIds) {
    for (let index = 0; index < categoryIds.length; index += 1) {
      await sequelize.query(
        "UPDATE categories SET sort_order = :sortOrder, updated_at = CURRENT_TIMESTAMP(3) WHERE id = :categoryId",
        options({ categoryId: categoryIds[index], sortOrder: index }),
      );
    }
  }

  const PRODUCT_ADMIN_FIELDS = `
    CAST(p.id AS CHAR) AS id, p.code, p.name, p.subtitle,
    CAST(p.category_id AS CHAR) AS category_id, c.name AS category_name,
    CAST(p.material_id AS CHAR) AS material_id, m.name AS material_name,
    p.craft, p.currency, p.sale_status, CAST(p.sales_count AS CHAR) AS sales_count,
    CAST(p.version AS CHAR) AS version, p.published_at, p.created_at, p.updated_at, p.deleted_at,
    CAST(COALESCE((SELECT MIN(v.price_amount) FROM product_variants v
                  WHERE v.product_id = p.id AND v.enabled = 1), p.price_amount) AS CHAR) AS min_price_amount,
    CAST(COALESCE((SELECT MAX(v.price_amount) FROM product_variants v
                  WHERE v.product_id = p.id AND v.enabled = 1), p.price_amount) AS CHAR) AS max_price_amount,
    CAST(COALESCE((SELECT SUM(v.on_hand_quantity) FROM product_variants v
                  WHERE v.product_id = p.id AND v.enabled = 1), 0) AS CHAR) AS on_hand_quantity,
    CAST(COALESCE((SELECT SUM(v.reserved_quantity) FROM product_variants v
                  WHERE v.product_id = p.id AND v.enabled = 1), 0) AS CHAR) AS reserved_quantity,
    CAST(COALESCE((SELECT SUM(v.on_hand_quantity - v.reserved_quantity) FROM product_variants v
                  WHERE v.product_id = p.id AND v.enabled = 1), 0) AS CHAR) AS available_quantity,
    media.url AS primary_image_url
  `;

  const PRODUCT_ADMIN_FROM = `
    FROM products p
    INNER JOIN categories c ON c.id = p.category_id
    LEFT JOIN categories m ON m.id = p.material_id
    LEFT JOIN product_images primary_image ON primary_image.id = (
      SELECT candidate.id FROM product_images candidate
      WHERE candidate.product_id = p.id AND candidate.kind = 'PRIMARY'
      ORDER BY candidate.sort_order ASC, candidate.id ASC LIMIT 1
    )
    LEFT JOIN media_assets media ON media.id = primary_image.media_id
  `;

  async function findProducts(filters) {
    const where = [];
    const replacements = { limit: filters.pageSize, offset: (filters.page - 1) * filters.pageSize };
    if (filters.status !== "ALL") {
      where.push("p.sale_status = :status");
      replacements.status = filters.status;
    }
    if (filters.categoryId) {
      where.push("p.category_id = :categoryId");
      replacements.categoryId = filters.categoryId;
    }
    if (filters.materialId) {
      where.push("p.material_id = :materialId");
      replacements.materialId = filters.materialId;
    }
    if (filters.keyword) {
      where.push("(p.name LIKE :keyword ESCAPE '!' OR p.subtitle LIKE :keyword ESCAPE '!' OR p.code LIKE :keyword ESCAPE '!')");
      replacements.keyword = `%${filters.keyword.replace(/!/g, "!!").replace(/%/g, "!%").replace(/_/g, "!_")}%`;
    }
    if (filters.stockStatus === "SOLD_OUT") {
      where.push("COALESCE((SELECT SUM(v.on_hand_quantity - v.reserved_quantity) FROM product_variants v WHERE v.product_id = p.id AND v.enabled = 1), 0) <= 0");
    } else if (filters.stockStatus === "LOW_STOCK") {
      where.push("EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.enabled = 1 AND v.on_hand_quantity > v.reserved_quantity AND v.on_hand_quantity - v.reserved_quantity <= v.low_stock_threshold)");
    } else if (filters.stockStatus === "IN_STOCK") {
      where.push("COALESCE((SELECT SUM(v.on_hand_quantity - v.reserved_quantity) FROM product_variants v WHERE v.product_id = p.id AND v.enabled = 1), 0) > 0");
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const rows = await sequelize.query(`
      SELECT ${PRODUCT_ADMIN_FIELDS} ${PRODUCT_ADMIN_FROM}
      ${whereSql}
      ORDER BY p.updated_at DESC, p.id DESC LIMIT :limit OFFSET :offset
    `, options(replacements, QueryTypes.SELECT));
    const countRows = await sequelize.query(
      `SELECT COUNT(*) AS total FROM products p ${whereSql}`,
      options(replacements, QueryTypes.SELECT),
    );
    return { rows, total: Number(countRows[0]?.total || 0) };
  }

  async function findProduct(productId, lock = false) {
    const rows = await sequelize.query(`
      SELECT ${PRODUCT_ADMIN_FIELDS}, p.tags_json, p.attributes_json, p.detail_sections_json,
             c.enabled AS category_enabled, c.dimension AS category_dimension,
             COALESCE(m.enabled, 1) AS material_enabled, m.dimension AS material_dimension
      ${PRODUCT_ADMIN_FROM}
      WHERE p.id = :productId
      LIMIT 1 ${lock ? "FOR UPDATE" : ""}
    `, options({ productId }, QueryTypes.SELECT));
    return rows[0] || null;
  }

  async function findProductImages(productId) {
    return sequelize.query(`
      SELECT CAST(pi.id AS CHAR) AS id, CAST(pi.media_id AS CHAR) AS media_id,
             pi.kind, pi.alt_text, CAST(pi.sort_order AS CHAR) AS sort_order,
             media.url, media.status AS media_status
      FROM product_images pi INNER JOIN media_assets media ON media.id = pi.media_id
      WHERE pi.product_id = :productId ORDER BY pi.sort_order ASC, pi.id ASC
    `, options({ productId }, QueryTypes.SELECT));
  }

  async function findProductVariants(productId, lock = false) {
    return sequelize.query(`
      SELECT CAST(id AS CHAR) AS id, CAST(product_id AS CHAR) AS product_id, sku_code, spec_label,
             CAST(price_amount AS CHAR) AS price_amount, CAST(original_price_amount AS CHAR) AS original_price_amount,
             CAST(on_hand_quantity AS CHAR) AS on_hand_quantity,
             CAST(reserved_quantity AS CHAR) AS reserved_quantity,
             CAST(on_hand_quantity - reserved_quantity AS CHAR) AS available_quantity,
             CAST(low_stock_threshold AS CHAR) AS low_stock_threshold, enabled,
             CAST(sort_order AS CHAR) AS sort_order, CAST(version AS CHAR) AS version,
             created_at, updated_at
      FROM product_variants WHERE product_id = :productId
      ORDER BY sort_order ASC, id ASC ${lock ? "FOR UPDATE" : ""}
    `, options({ productId }, QueryTypes.SELECT));
  }

  async function findActiveMedia(mediaIds) {
    if (!mediaIds.length) return [];
    return sequelize.query(`
      SELECT CAST(id AS CHAR) AS id, url, status FROM media_assets
      WHERE id IN (:mediaIds) AND status = 'ACTIVE'
    `, options({ mediaIds }, QueryTypes.SELECT));
  }

  async function findCategoryForProduct(categoryId, dimension) {
    const rows = await sequelize.query(`
      SELECT CAST(id AS CHAR) AS id, code, name, enabled FROM categories
      WHERE id = :categoryId AND dimension = :dimension LIMIT 1
    `, options({ categoryId, dimension }, QueryTypes.SELECT));
    return rows[0] || null;
  }

  async function findProductByCode(code) {
    const rows = await sequelize.query(
      "SELECT CAST(id AS CHAR) AS id FROM products WHERE code = :code LIMIT 1",
      options({ code }, QueryTypes.SELECT),
    );
    return rows[0] || null;
  }

  async function findVariantBySkuCode(skuCode) {
    const rows = await sequelize.query(`
      SELECT CAST(id AS CHAR) AS id, CAST(product_id AS CHAR) AS product_id
      FROM product_variants WHERE sku_code = :skuCode LIMIT 1
    `, options({ skuCode }, QueryTypes.SELECT));
    return rows[0] || null;
  }

  async function insertProduct(input) {
    await sequelize.query(`
      INSERT INTO products (
        code, name, subtitle, category_id, material_id, craft, price_amount,
        original_price_amount, currency, sale_status, sales_count, low_stock_threshold,
        tags_json, attributes_json, detail_sections_json, version, created_at, updated_at
      ) VALUES (
        :code, :name, :subtitle, :categoryId, :materialId, :craft, :priceAmount,
        :originalPriceAmount, 'CNY', 'DRAFT', 0, :lowStockThreshold,
        :tagsJson, :attributesJson, :detailSectionsJson, 1,
        CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
      )
    `, options(input));
    const rows = await sequelize.query("SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id", options({}, QueryTypes.SELECT));
    return rows[0].id;
  }

  async function updateProduct(productId, input) {
    await sequelize.query(`
      UPDATE products SET name = :name, subtitle = :subtitle,
        category_id = :categoryId, material_id = :materialId, craft = :craft,
        price_amount = :priceAmount, original_price_amount = :originalPriceAmount,
        low_stock_threshold = :lowStockThreshold, tags_json = :tagsJson,
        attributes_json = :attributesJson, detail_sections_json = :detailSectionsJson,
        version = version + 1, updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = :productId
    `, options({ productId, ...input }));
  }

  async function insertVariant(productId, input) {
    await sequelize.query(`
      INSERT INTO product_variants (
        product_id, sku_code, spec_label, price_amount, original_price_amount,
        on_hand_quantity, reserved_quantity, low_stock_threshold, enabled,
        sort_order, version, created_at, updated_at
      ) VALUES (
        :productId, :skuCode, :specLabel, :priceAmount, :originalPriceAmount,
        :initialStock, 0, :lowStockThreshold, :enabled,
        :sortOrder, 1, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
      )
    `, options({ productId, ...input, enabled: input.enabled ? 1 : 0 }));
    const rows = await sequelize.query("SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id", options({}, QueryTypes.SELECT));
    return rows[0].id;
  }

  async function updateVariant(variantId, input) {
    await sequelize.query(`
      UPDATE product_variants SET sku_code = :skuCode, spec_label = :specLabel,
        price_amount = :priceAmount, original_price_amount = :originalPriceAmount,
        low_stock_threshold = :lowStockThreshold, enabled = :enabled,
        sort_order = :sortOrder, version = version + 1, updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = :variantId
    `, options({ variantId, ...input, enabled: input.enabled ? 1 : 0 }));
  }

  async function disableVariants(variantIds) {
    if (!variantIds.length) return;
    await sequelize.query(`
      UPDATE product_variants SET enabled = 0, version = version + 1,
        updated_at = CURRENT_TIMESTAMP(3) WHERE id IN (:variantIds)
    `, options({ variantIds }));
  }

  async function insertInitialMovement(variantId, quantity, operatorId, note) {
    await sequelize.query(`
      INSERT INTO inventory_movements (
        variant_id, change_quantity, reserved_change, before_quantity, after_quantity,
        before_reserved_quantity, after_reserved_quantity, reason_type,
        reference_type, reference_id, note, operator_id, created_at
      ) VALUES (
        :variantId, :quantity, 0, 0, :quantity, 0, 0, 'INITIAL',
        'PRODUCT', NULL, :note, :operatorId, CURRENT_TIMESTAMP(3)
      )
    `, options({ variantId, quantity, operatorId, note }));
  }

  async function replaceProductImages(productId, mediaIds, primaryMediaId, name) {
    await sequelize.query("DELETE FROM product_images WHERE product_id = :productId", options({ productId }));
    for (let index = 0; index < mediaIds.length; index += 1) {
      const mediaId = mediaIds[index];
      await sequelize.query(`
        INSERT INTO product_images (product_id, media_id, kind, alt_text, sort_order, created_at)
        VALUES (:productId, :mediaId, :kind, :altText, :sortOrder, CURRENT_TIMESTAMP(3))
      `, options({
        productId,
        mediaId,
        kind: mediaId === primaryMediaId ? "PRIMARY" : "GALLERY",
        altText: name,
        sortOrder: index,
      }));
    }
  }

  async function setProductSaleStatus(productId, saleStatus) {
    await sequelize.query(`
      UPDATE products SET sale_status = :saleStatus,
        published_at = CASE WHEN :saleStatus = 'ON_SALE' THEN COALESCE(published_at, CURRENT_TIMESTAMP(3)) ELSE published_at END,
        version = version + 1, updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = :productId
    `, options({ productId, saleStatus }));
  }

  async function softDeleteProduct(productId) {
    await sequelize.query(`
      UPDATE products SET sale_status = 'DELETED', deleted_at = CURRENT_TIMESTAMP(3),
        version = version + 1, updated_at = CURRENT_TIMESTAMP(3) WHERE id = :productId
    `, options({ productId }));
    await sequelize.query("DELETE FROM home_featured_products WHERE product_id = :productId", options({ productId }));
    await sequelize.query("DELETE FROM collection_products WHERE product_id = :productId", options({ productId }));
    await sequelize.query(`
      UPDATE banners SET link_type = 'NONE', target_product_id = NULL, updated_at = CURRENT_TIMESTAMP(3)
      WHERE target_product_id = :productId
    `, options({ productId }));
  }

  async function findVariant(variantId, lock = false) {
    const rows = await sequelize.query(`
      SELECT CAST(v.id AS CHAR) AS id, CAST(v.product_id AS CHAR) AS product_id,
             v.sku_code, v.spec_label, CAST(v.on_hand_quantity AS CHAR) AS on_hand_quantity,
             CAST(v.reserved_quantity AS CHAR) AS reserved_quantity,
             CAST(v.on_hand_quantity - v.reserved_quantity AS CHAR) AS available_quantity,
             CAST(v.low_stock_threshold AS CHAR) AS low_stock_threshold,
             CAST(v.version AS CHAR) AS version, v.enabled, p.name AS product_name,
             p.sale_status, p.deleted_at AS product_deleted_at
      FROM product_variants v INNER JOIN products p ON p.id = v.product_id
      WHERE v.id = :variantId LIMIT 1 ${lock ? "FOR UPDATE" : ""}
    `, options({ variantId }, QueryTypes.SELECT));
    return rows[0] || null;
  }

  async function adjustInventory(variantId, input) {
    await sequelize.query(`
      UPDATE product_variants SET on_hand_quantity = :afterQuantity,
        version = version + 1, updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = :variantId
    `, options({ variantId, afterQuantity: input.afterQuantity }));
    await sequelize.query(`
      INSERT INTO inventory_movements (
        variant_id, change_quantity, reserved_change, before_quantity, after_quantity,
        before_reserved_quantity, after_reserved_quantity, reason_type,
        reference_type, reference_id, note, operator_id, created_at
      ) VALUES (
        :variantId, :changeQuantity, 0, :beforeQuantity, :afterQuantity,
        :reservedQuantity, :reservedQuantity, :reasonType,
        'ADMIN_ADJUSTMENT', :referenceId, :note, :operatorId, CURRENT_TIMESTAMP(3)
      )
    `, options({ variantId, ...input }));
  }

  async function findInventoryMovements(variantId, { page, pageSize }) {
    const rows = await sequelize.query(`
      SELECT CAST(m.id AS CHAR) AS id, CAST(m.variant_id AS CHAR) AS variant_id,
             CAST(m.change_quantity AS CHAR) AS change_quantity,
             CAST(m.reserved_change AS CHAR) AS reserved_change,
             CAST(m.before_quantity AS CHAR) AS before_quantity,
             CAST(m.after_quantity AS CHAR) AS after_quantity,
             CAST(m.before_reserved_quantity AS CHAR) AS before_reserved_quantity,
             CAST(m.after_reserved_quantity AS CHAR) AS after_reserved_quantity,
             m.reason_type, m.reference_type, m.reference_id, m.note,
             CAST(m.operator_id AS CHAR) AS operator_id, au.name AS operator_name, m.created_at
      FROM inventory_movements m
      LEFT JOIN admin_users au ON au.id = m.operator_id
      WHERE m.variant_id = :variantId
      ORDER BY m.created_at DESC, m.id DESC LIMIT :limit OFFSET :offset
    `, options({ variantId, limit: pageSize, offset: (page - 1) * pageSize }, QueryTypes.SELECT));
    const countRows = await sequelize.query(
      "SELECT COUNT(*) AS total FROM inventory_movements WHERE variant_id = :variantId",
      options({ variantId }, QueryTypes.SELECT),
    );
    return { rows, total: Number(countRows[0]?.total || 0) };
  }

  return {
    writeLog: auditRepository.writeLog,
    findCategories,
    findCategory,
    findCategoryByCodeOrName,
    nextCategorySortOrder,
    insertCategory,
    updateCategory,
    categoryReferences,
    deleteCategory,
    findCategoryIdsByDimension,
    reorderCategories,
    findProducts,
    findProduct,
    findProductImages,
    findProductVariants,
    findActiveMedia,
    findCategoryForProduct,
    findProductByCode,
    findVariantBySkuCode,
    insertProduct,
    updateProduct,
    insertVariant,
    updateVariant,
    disableVariants,
    insertInitialMovement,
    replaceProductImages,
    setProductSaleStatus,
    softDeleteProduct,
    findVariant,
    adjustInventory,
    findInventoryMovements,
  };
}

module.exports = createAdminCatalogRepository;
