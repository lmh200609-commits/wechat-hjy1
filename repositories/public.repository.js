const { QueryTypes } = require("sequelize");
const database = require("../database");

const PRODUCT_FIELDS = `
  CAST(p.id AS CHAR) AS id,
  p.code,
  p.name,
  p.subtitle,
  p.currency,
  p.craft,
  p.tags_json AS tags,
  CAST(p.sales_count AS CHAR) AS sales_count,
  p.sale_status,
  p.published_at,
  CAST(c.id AS CHAR) AS category_id,
  c.code AS category_code,
  c.name AS category_name,
  c.icon_text AS category_icon_text,
  CAST(m.id AS CHAR) AS material_id,
  m.code AS material_code,
  m.name AS material_name,
  media.url AS primary_image_url,
  CAST(vs.min_price_amount AS CHAR) AS min_price_amount,
  CAST(vs.max_price_amount AS CHAR) AS max_price_amount,
  CAST((
    SELECT price_variant.original_price_amount
    FROM product_variants price_variant
    WHERE price_variant.product_id = p.id AND price_variant.enabled = 1
    ORDER BY price_variant.price_amount ASC, price_variant.sort_order ASC, price_variant.id ASC
    LIMIT 1
  ) AS CHAR) AS min_original_price_amount,
  CAST(vs.available_quantity AS CHAR) AS available_quantity,
  CAST(vs.low_stock_threshold AS CHAR) AS low_stock_threshold
`;

const PRODUCT_FROM = `
  FROM products p
  INNER JOIN categories c ON c.id = p.category_id
  LEFT JOIN categories m ON m.id = p.material_id
  INNER JOIN (
    SELECT
      product_id,
      MIN(price_amount) AS min_price_amount,
      MAX(price_amount) AS max_price_amount,
      SUM(GREATEST(CAST(on_hand_quantity AS SIGNED) - CAST(reserved_quantity AS SIGNED), 0)) AS available_quantity,
      SUM(low_stock_threshold) AS low_stock_threshold
    FROM product_variants
    WHERE enabled = 1
    GROUP BY product_id
  ) vs ON vs.product_id = p.id
  LEFT JOIN product_images pi ON pi.id = (
    SELECT candidate.id
    FROM product_images candidate
    WHERE candidate.product_id = p.id AND candidate.kind = 'PRIMARY'
    ORDER BY candidate.sort_order ASC, candidate.id ASC
    LIMIT 1
  )
  LEFT JOIN media_assets media ON media.id = pi.media_id AND media.status = 'ACTIVE'
`;

const PUBLIC_PRODUCT_WHERE = `
  p.sale_status = 'ON_SALE'
  AND p.deleted_at IS NULL
  AND c.enabled = 1
  AND c.dimension = 'PRODUCT_CATEGORY'
  AND (m.id IS NULL OR (m.enabled = 1 AND m.dimension = 'MATERIAL'))
`;

const SORT_SQL = Object.freeze({
  DEFAULT: "COALESCE(p.published_at, p.created_at) DESC, p.id DESC",
  NEWEST: "COALESCE(p.published_at, p.created_at) DESC, p.id DESC",
  PRICE_ASC: "vs.min_price_amount ASC, p.id DESC",
  PRICE_DESC: "vs.min_price_amount DESC, p.id DESC",
  SALES_DESC: "p.sales_count DESC, p.id DESC",
});

function escapeLike(value) {
  return String(value).replace(/=/g, "==").replace(/%/g, "=%").replace(/_/g, "=_");
}

function createPublicRepository({ sequelize = database.sequelize, transaction } = {}) {
  function select(sql, replacements = {}) {
    return sequelize.query(sql, {
      replacements,
      type: QueryTypes.SELECT,
      ...(transaction ? { transaction } : {}),
    });
  }

  async function findCategories(dimension) {
    const dimensionSql = dimension === "ALL" ? "" : " AND dimension = :dimension";
    return select(`
      SELECT CAST(id AS CHAR) AS id, code, dimension, name, icon_text, CAST(parent_id AS CHAR) AS parent_id,
             CAST(sort_order AS CHAR) AS sort_order
      FROM categories
      WHERE enabled = 1${dimensionSql}
      ORDER BY FIELD(dimension, 'PRODUCT_CATEGORY', 'MATERIAL') ASC, sort_order ASC, id ASC
    `, { dimension });
  }

  async function findCategoryById(id, dimension) {
    const rows = await select(`
      SELECT CAST(id AS CHAR) AS id, code, dimension, name, icon_text, CAST(parent_id AS CHAR) AS parent_id,
             CAST(sort_order AS CHAR) AS sort_order
      FROM categories
      WHERE id = :id AND dimension = :dimension AND enabled = 1
      LIMIT 1
    `, { id, dimension });
    return rows[0] || null;
  }

  function productFilters(filters) {
    const conditions = [PUBLIC_PRODUCT_WHERE];
    const replacements = {};
    if (filters.categoryId) {
      conditions.push("p.category_id = :categoryId");
      replacements.categoryId = filters.categoryId;
    }
    if (filters.materialId) {
      conditions.push("p.material_id = :materialId");
      replacements.materialId = filters.materialId;
    }
    if (filters.keyword) {
      conditions.push(`(
        p.name LIKE :keyword ESCAPE '=' OR p.subtitle LIKE :keyword ESCAPE '='
        OR COALESCE(p.craft, '') LIKE :keyword ESCAPE '='
        OR c.name LIKE :keyword ESCAPE '=' OR COALESCE(m.name, '') LIKE :keyword ESCAPE '='
        OR CAST(COALESCE(p.tags_json, JSON_ARRAY()) AS CHAR) LIKE :keyword ESCAPE '='
      )`);
      replacements.keyword = `%${escapeLike(filters.keyword)}%`;
    }
    if (filters.inStock === true) conditions.push("vs.available_quantity > 0");
    if (filters.minPriceAmount !== undefined) {
      conditions.push("vs.min_price_amount >= :minPriceAmount");
      replacements.minPriceAmount = filters.minPriceAmount;
    }
    if (filters.maxPriceAmount !== undefined) {
      conditions.push("vs.min_price_amount <= :maxPriceAmount");
      replacements.maxPriceAmount = filters.maxPriceAmount;
    }
    return { where: conditions.join(" AND "), replacements };
  }

  async function findProducts(filters) {
    const { where, replacements } = productFilters(filters);
    const offset = (filters.page - 1) * filters.pageSize;
    const items = await select(`
      SELECT ${PRODUCT_FIELDS}
      ${PRODUCT_FROM}
      WHERE ${where}
      ORDER BY ${SORT_SQL[filters.sort] || SORT_SQL.DEFAULT}
      LIMIT :limit OFFSET :offset
    `, { ...replacements, limit: filters.pageSize, offset });
    const countRows = await select(`
      SELECT COUNT(*) AS total
      ${PRODUCT_FROM}
      WHERE ${where}
    `, replacements);
    return { items, total: Number(countRows[0]?.total || 0) };
  }

  async function findProductById(productId) {
    const rows = await select(`
      SELECT ${PRODUCT_FIELDS}, p.attributes_json AS attributes, p.detail_sections_json AS detail_sections
      ${PRODUCT_FROM}
      WHERE ${PUBLIC_PRODUCT_WHERE} AND p.id = :productId
      LIMIT 1
    `, { productId });
    return rows[0] || null;
  }

  async function findProductImages(productId) {
    return select(`
      SELECT CAST(pi.id AS CHAR) AS id, media.url, pi.kind, pi.alt_text, CAST(pi.sort_order AS CHAR) AS sort_order
      FROM product_images pi
      INNER JOIN media_assets media ON media.id = pi.media_id AND media.status = 'ACTIVE'
      WHERE pi.product_id = :productId
      ORDER BY pi.sort_order ASC, pi.id ASC
    `, { productId });
  }

  async function findProductVariants(productId) {
    return select(`
      SELECT CAST(id AS CHAR) AS id, sku_code, spec_label, CAST(price_amount AS CHAR) AS price_amount,
             CAST(original_price_amount AS CHAR) AS original_price_amount,
             CAST(GREATEST(CAST(on_hand_quantity AS SIGNED) - CAST(reserved_quantity AS SIGNED), 0) AS CHAR) AS available_quantity,
             CAST(low_stock_threshold AS CHAR) AS low_stock_threshold, enabled, CAST(sort_order AS CHAR) AS sort_order
      FROM product_variants
      WHERE product_id = :productId AND enabled = 1
      ORDER BY sort_order ASC, id ASC
    `, { productId });
  }

  async function findRelatedProducts(categoryId, excludeProductId, limit = 4) {
    return select(`
      SELECT ${PRODUCT_FIELDS}
      ${PRODUCT_FROM}
      WHERE ${PUBLIC_PRODUCT_WHERE} AND p.category_id = :categoryId AND p.id <> :excludeProductId
      ORDER BY p.sales_count DESC, p.id DESC
      LIMIT :limit
    `, { categoryId, excludeProductId, limit });
  }

  async function findMediaByIds(ids) {
    if (!ids.length) return [];
    return select(`
      SELECT CAST(id AS CHAR) AS id, url
      FROM media_assets
      WHERE id IN (:ids) AND status = 'ACTIVE'
    `, { ids });
  }

  async function findHomeSettings() {
    const rows = await select(`
      SELECT featured_title, show_featured, show_collections, show_journal, CAST(version AS CHAR) AS version
      FROM home_settings
      WHERE id = 1
      LIMIT 1
    `);
    return rows[0] || null;
  }

  async function findVisibleBanners(now) {
    return select(`
      SELECT CAST(b.id AS CHAR) AS id, b.title, b.subtitle, media.url AS image_url, b.link_type,
             CAST(b.target_product_id AS CHAR) AS target_product_id
      FROM banners b
      INNER JOIN media_assets media ON media.id = b.image_media_id AND media.status = 'ACTIVE'
      LEFT JOIN products target ON target.id = b.target_product_id
      LEFT JOIN categories target_category ON target_category.id = target.category_id
      LEFT JOIN categories target_material ON target_material.id = target.material_id
      WHERE b.visible = 1
        AND (b.starts_at IS NULL OR b.starts_at <= :now)
        AND (b.ends_at IS NULL OR b.ends_at > :now)
        AND (b.link_type = 'NONE' OR (
          target.sale_status = 'ON_SALE' AND target.deleted_at IS NULL
          AND target_category.enabled = 1 AND target_category.dimension = 'PRODUCT_CATEGORY'
          AND (target_material.id IS NULL OR (target_material.enabled = 1 AND target_material.dimension = 'MATERIAL'))
        ))
      ORDER BY b.sort_order ASC, b.id ASC
    `, { now });
  }

  async function findHomeQuickCategories() {
    return select(`
      SELECT CAST(c.id AS CHAR) AS id, c.code, c.name, hqc.icon_text, CAST(hqc.sort_order AS CHAR) AS sort_order
      FROM home_quick_categories hqc
      INNER JOIN categories c ON c.id = hqc.category_id
      WHERE c.enabled = 1 AND c.dimension = 'PRODUCT_CATEGORY'
      ORDER BY hqc.sort_order ASC, c.id ASC
    `);
  }

  async function findHomeFeaturedProducts(limit = 8) {
    return select(`
      SELECT ${PRODUCT_FIELDS}
      ${PRODUCT_FROM}
      INNER JOIN home_featured_products hfp ON hfp.product_id = p.id
      WHERE ${PUBLIC_PRODUCT_WHERE}
      ORDER BY hfp.sort_order ASC, p.id ASC
      LIMIT :limit
    `, { limit });
  }

  async function findNewArrivals(limit = 6) {
    return select(`
      SELECT ${PRODUCT_FIELDS}
      ${PRODUCT_FROM}
      WHERE ${PUBLIC_PRODUCT_WHERE}
      ORDER BY COALESCE(p.published_at, p.created_at) DESC, p.id DESC
      LIMIT :limit
    `, { limit });
  }

  async function findHomeCollections(limit = 6) {
    return select(`
      SELECT CAST(col.id AS CHAR) AS id, col.code, col.title, col.latin_title, col.description,
             media.url AS cover_image_url,
             CAST((
               SELECT COUNT(*)
               FROM collection_products cp
               INNER JOIN products p2 ON p2.id = cp.product_id
               INNER JOIN categories c2 ON c2.id = p2.category_id AND c2.enabled = 1 AND c2.dimension = 'PRODUCT_CATEGORY'
               LEFT JOIN categories m2 ON m2.id = p2.material_id
               WHERE cp.collection_id = col.id AND p2.sale_status = 'ON_SALE' AND p2.deleted_at IS NULL
                 AND (m2.id IS NULL OR (m2.enabled = 1 AND m2.dimension = 'MATERIAL'))
             ) AS CHAR) AS product_count
      FROM collections col
      INNER JOIN media_assets media ON media.id = col.cover_media_id AND media.status = 'ACTIVE'
      WHERE col.visible = 1 AND col.deleted_at IS NULL
      ORDER BY col.sort_order ASC, col.id ASC
      LIMIT :limit
    `, { limit });
  }

  async function findHomeArticles(limit = 4) {
    return select(`
      SELECT CAST(a.id AS CHAR) AS id, a.code, a.title, a.tag, a.summary, a.author_name,
             CAST(a.reading_minutes AS CHAR) AS reading_minutes, a.published_at, media.url AS cover_image_url
      FROM articles a
      INNER JOIN media_assets media ON media.id = a.cover_media_id AND media.status = 'ACTIVE'
      WHERE a.status = 'PUBLISHED' AND a.deleted_at IS NULL
      ORDER BY a.is_hot DESC, a.published_at DESC, a.id DESC
      LIMIT :limit
    `, { limit });
  }

  async function findCollectionById(collectionId) {
    const rows = await select(`
      SELECT CAST(col.id AS CHAR) AS id, col.code, col.title, col.latin_title, col.description,
             media.url AS cover_image_url
      FROM collections col
      INNER JOIN media_assets media ON media.id = col.cover_media_id AND media.status = 'ACTIVE'
      WHERE col.id = :collectionId AND col.visible = 1 AND col.deleted_at IS NULL
      LIMIT 1
    `, { collectionId });
    return rows[0] || null;
  }

  async function findCollectionProducts(collectionId, limit = 50) {
    return select(`
      SELECT ${PRODUCT_FIELDS}
      ${PRODUCT_FROM}
      INNER JOIN collection_products cp ON cp.product_id = p.id AND cp.collection_id = :collectionId
      WHERE ${PUBLIC_PRODUCT_WHERE}
      ORDER BY cp.sort_order ASC, p.id ASC
      LIMIT :limit
    `, { collectionId, limit });
  }

  async function findArticleTags() {
    return select(`
      SELECT tag, MIN(published_at) AS first_published_at
      FROM articles
      WHERE status = 'PUBLISHED' AND deleted_at IS NULL
      GROUP BY tag
      ORDER BY first_published_at ASC, tag ASC
    `);
  }

  async function findArticles({ page, pageSize, tag }) {
    const tagSql = tag ? " AND a.tag = :tag" : "";
    const replacements = { tag };
    const items = await select(`
      SELECT CAST(a.id AS CHAR) AS id, a.code, a.title, a.tag, a.summary, a.author_name,
             CAST(a.reading_minutes AS CHAR) AS reading_minutes, a.is_hot, a.published_at,
             media.url AS cover_image_url
      FROM articles a
      INNER JOIN media_assets media ON media.id = a.cover_media_id AND media.status = 'ACTIVE'
      WHERE a.status = 'PUBLISHED' AND a.deleted_at IS NULL${tagSql}
      ORDER BY a.is_hot DESC, a.published_at DESC, a.id DESC
      LIMIT :limit OFFSET :offset
    `, { ...replacements, limit: pageSize, offset: (page - 1) * pageSize });
    const countRows = await select(`
      SELECT COUNT(*) AS total
      FROM articles a
      WHERE a.status = 'PUBLISHED' AND a.deleted_at IS NULL${tagSql}
    `, replacements);
    return { items, total: Number(countRows[0]?.total || 0) };
  }

  async function findArticleById(articleId) {
    const rows = await select(`
      SELECT CAST(a.id AS CHAR) AS id, a.code, a.title, a.tag, a.summary, a.author_name,
             CAST(a.reading_minutes AS CHAR) AS reading_minutes, a.is_hot, a.published_at,
             a.body_json AS body, media.url AS cover_image_url
      FROM articles a
      INNER JOIN media_assets media ON media.id = a.cover_media_id AND media.status = 'ACTIVE'
      WHERE a.id = :articleId AND a.status = 'PUBLISHED' AND a.deleted_at IS NULL
      LIMIT 1
    `, { articleId });
    return rows[0] || null;
  }

  async function findRelatedArticles(tag, excludeArticleId, limit = 4) {
    return select(`
      SELECT CAST(a.id AS CHAR) AS id, a.code, a.title, a.tag, a.summary, a.author_name,
             CAST(a.reading_minutes AS CHAR) AS reading_minutes, a.published_at,
             media.url AS cover_image_url
      FROM articles a
      INNER JOIN media_assets media ON media.id = a.cover_media_id AND media.status = 'ACTIVE'
      WHERE a.status = 'PUBLISHED' AND a.deleted_at IS NULL AND a.tag = :tag AND a.id <> :excludeArticleId
      ORDER BY a.is_hot DESC, a.published_at DESC, a.id DESC
      LIMIT :limit
    `, { tag, excludeArticleId, limit });
  }

  async function findHotKeywords(limit = 10) {
    return select(`
      SELECT CAST(id AS CHAR) AS id, keyword, CAST(sort_order AS CHAR) AS sort_order
      FROM search_hot_keywords
      WHERE enabled = 1
      ORDER BY sort_order ASC, id ASC
      LIMIT :limit
    `, { limit });
  }

  return {
    findCategories,
    findCategoryById,
    findProducts,
    findProductById,
    findProductImages,
    findProductVariants,
    findRelatedProducts,
    findMediaByIds,
    findHomeSettings,
    findVisibleBanners,
    findHomeQuickCategories,
    findHomeFeaturedProducts,
    findNewArrivals,
    findHomeCollections,
    findHomeArticles,
    findCollectionById,
    findCollectionProducts,
    findArticleTags,
    findArticles,
    findArticleById,
    findRelatedArticles,
    findHotKeywords,
  };
}

module.exports = createPublicRepository;
