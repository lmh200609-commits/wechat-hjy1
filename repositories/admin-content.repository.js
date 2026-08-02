const { QueryTypes } = require("sequelize");
const database = require("../database");
const createAdminRepository = require("./admin.repository");
const createMediaRepository = require("./media.repository");

function createAdminContentRepository({ sequelize = database.sequelize, transaction } = {}) {
  const options = (replacements = {}, type) => ({ replacements, ...(type ? { type } : {}), ...(transaction ? { transaction } : {}) });
  const query = (sql, replacements = {}, type) => sequelize.query(sql, options(replacements, type));
  const audit = createAdminRepository({ sequelize, transaction });
  const media = createMediaRepository({ sequelize, transaction });
  const mediaUrl = "COALESCE(m.file_id, m.url)";

  async function activeMedia(ids, lock = false) {
    if (!ids.length) return [];
    return query(`SELECT CAST(id AS CHAR) AS id FROM media_assets WHERE id IN (:ids) AND status = 'ACTIVE' ${lock ? "FOR UPDATE" : ""}`, { ids }, QueryTypes.SELECT);
  }
  async function activeProducts(ids, lock = false) {
    if (!ids.length) return [];
    return query(`SELECT CAST(id AS CHAR) AS id FROM products WHERE id IN (:ids) AND deleted_at IS NULL AND sale_status <> 'DELETED' ${lock ? "FOR UPDATE" : ""}`, { ids }, QueryTypes.SELECT);
  }
  async function productCategories(ids, lock = false) {
    if (!ids.length) return [];
    return query(`SELECT CAST(id AS CHAR) AS id FROM categories WHERE id IN (:ids) AND dimension = 'PRODUCT_CATEGORY' AND enabled = 1 ${lock ? "FOR UPDATE" : ""}`, { ids }, QueryTypes.SELECT);
  }

  const articleFields = `CAST(a.id AS CHAR) AS id, a.code, a.title, a.tag, a.summary, a.author_name,
    CAST(a.cover_media_id AS CHAR) AS cover_media_id, ${mediaUrl} AS cover_image_url, a.body_json,
    CAST(a.reading_minutes AS CHAR) AS reading_minutes, a.status, a.is_hot,
    CAST(a.version AS CHAR) AS version, a.published_at, a.created_at, a.updated_at, a.deleted_at`;
  async function articles({ page, pageSize, status }) {
    const filter = status === "ALL" ? "" : " AND a.status = :status";
    const replacements = { status, limit: pageSize, offset: (page - 1) * pageSize };
    const rows = await query(`SELECT ${articleFields} FROM articles a LEFT JOIN media_assets m ON m.id = a.cover_media_id WHERE a.deleted_at IS NULL${filter} ORDER BY a.updated_at DESC, a.id DESC LIMIT :limit OFFSET :offset`, replacements, QueryTypes.SELECT);
    const count = await query(`SELECT COUNT(*) AS total FROM articles a WHERE a.deleted_at IS NULL${filter}`, replacements, QueryTypes.SELECT);
    return { rows, total: Number(count[0]?.total || 0) };
  }
  async function article(id, lock = false) { const rows = await query(`SELECT ${articleFields} FROM articles a LEFT JOIN media_assets m ON m.id = a.cover_media_id WHERE a.id = :id AND a.deleted_at IS NULL LIMIT 1 ${lock ? "FOR UPDATE" : ""}`, { id }, QueryTypes.SELECT); return rows[0] || null; }
  async function insertArticle(input) {
    await query(`INSERT INTO articles (code,title,tag,summary,author_name,cover_media_id,body_json,reading_minutes,status,is_hot,published_at,version,created_at,updated_at)
      VALUES (:code,:title,:tag,:summary,:authorName,:coverMediaId,:bodyJson,:readingMinutes,:status,:isHot,CASE WHEN :status = 'PUBLISHED' THEN CURRENT_TIMESTAMP(3) ELSE NULL END,1,CURRENT_TIMESTAMP(3),CURRENT_TIMESTAMP(3))`, input);
    const rows = await query("SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id", {}, QueryTypes.SELECT); return rows[0].id;
  }
  async function updateArticle(id, input) { await query(`UPDATE articles SET title=:title,tag=:tag,summary=:summary,author_name=:authorName,cover_media_id=:coverMediaId,body_json=:bodyJson,reading_minutes=:readingMinutes,status=:status,is_hot=:isHot,published_at=CASE WHEN :status = 'PUBLISHED' THEN COALESCE(published_at,CURRENT_TIMESTAMP(3)) ELSE published_at END,version=version+1,updated_at=CURRENT_TIMESTAMP(3) WHERE id=:id`, { id, ...input }); }
  async function deleteArticle(id) { await query("UPDATE articles SET deleted_at=CURRENT_TIMESTAMP(3),status='ARCHIVED',version=version+1,updated_at=CURRENT_TIMESTAMP(3) WHERE id=:id", { id }); }

  const collectionFields = `CAST(c.id AS CHAR) AS id,c.code,c.title,c.latin_title,c.description,CAST(c.cover_media_id AS CHAR) AS cover_media_id,${mediaUrl} AS cover_image_url,c.visible,CAST(c.sort_order AS CHAR) AS sort_order,CAST(c.version AS CHAR) AS version,c.created_at,c.updated_at,c.deleted_at`;
  async function collections({ page, pageSize }) { const replacements = { limit: pageSize, offset: (page - 1) * pageSize }; const rows = await query(`SELECT ${collectionFields} FROM collections c INNER JOIN media_assets m ON m.id=c.cover_media_id WHERE c.deleted_at IS NULL ORDER BY c.sort_order,c.id LIMIT :limit OFFSET :offset`, replacements, QueryTypes.SELECT); const count = await query("SELECT COUNT(*) AS total FROM collections WHERE deleted_at IS NULL", {}, QueryTypes.SELECT); return { rows, total: Number(count[0]?.total || 0) }; }
  async function collection(id, lock = false) { const rows = await query(`SELECT ${collectionFields} FROM collections c INNER JOIN media_assets m ON m.id=c.cover_media_id WHERE c.id=:id AND c.deleted_at IS NULL LIMIT 1 ${lock ? "FOR UPDATE" : ""}`, { id }, QueryTypes.SELECT); if (!rows[0]) return null; rows[0].product_ids = (await query("SELECT CAST(product_id AS CHAR) AS id FROM collection_products WHERE collection_id=:id ORDER BY sort_order,product_id", { id }, QueryTypes.SELECT)).map((row) => row.id); return rows[0]; }
  async function insertCollection(input) { await query(`INSERT INTO collections (code,title,latin_title,description,cover_media_id,visible,sort_order,version,created_at,updated_at) VALUES (:code,:title,:latinTitle,:description,:coverMediaId,:visible,(SELECT COALESCE(MAX(c.sort_order),-1)+1 FROM collections c),1,CURRENT_TIMESTAMP(3),CURRENT_TIMESTAMP(3))`, input); const rows = await query("SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id", {}, QueryTypes.SELECT); return rows[0].id; }
  async function updateCollection(id, input) { await query("UPDATE collections SET title=:title,latin_title=:latinTitle,description=:description,cover_media_id=:coverMediaId,visible=:visible,version=version+1,updated_at=CURRENT_TIMESTAMP(3) WHERE id=:id", { id, ...input }); }
  async function replaceCollectionProducts(id, ids) { await query("DELETE FROM collection_products WHERE collection_id=:id", { id }); for (let index = 0; index < ids.length; index += 1) await query("INSERT INTO collection_products (collection_id,product_id,sort_order,created_at) VALUES (:id,:productId,:sortOrder,CURRENT_TIMESTAMP(3))", { id, productId: ids[index], sortOrder: index }); }
  async function deleteCollection(id) { await query("UPDATE collections SET deleted_at=CURRENT_TIMESTAMP(3),visible=0,version=version+1,updated_at=CURRENT_TIMESTAMP(3) WHERE id=:id", { id }); }

  const bannerFields = `CAST(b.id AS CHAR) AS id,b.title,b.subtitle,CAST(b.image_media_id AS CHAR) AS image_media_id,${mediaUrl} AS image_url,b.link_type,CAST(b.target_product_id AS CHAR) AS target_product_id,b.visible,CAST(b.sort_order AS CHAR) AS sort_order,CAST(b.version AS CHAR) AS version,b.starts_at,b.ends_at,b.created_at,b.updated_at`;
  async function banners({ page, pageSize }) { const replacements = { limit: pageSize, offset: (page - 1) * pageSize }; const rows = await query(`SELECT ${bannerFields} FROM banners b INNER JOIN media_assets m ON m.id=b.image_media_id ORDER BY b.sort_order,b.id LIMIT :limit OFFSET :offset`, replacements, QueryTypes.SELECT); const count = await query("SELECT COUNT(*) AS total FROM banners", {}, QueryTypes.SELECT); return { rows, total: Number(count[0]?.total || 0) }; }
  async function banner(id, lock = false) { const rows = await query(`SELECT ${bannerFields} FROM banners b INNER JOIN media_assets m ON m.id=b.image_media_id WHERE b.id=:id LIMIT 1 ${lock ? "FOR UPDATE" : ""}`, { id }, QueryTypes.SELECT); return rows[0] || null; }
  async function insertBanner(input) { await query(`INSERT INTO banners (title,subtitle,image_media_id,link_type,target_product_id,visible,sort_order,version,starts_at,ends_at,created_at,updated_at) VALUES (:title,:subtitle,:imageMediaId,:linkType,:targetProductId,:visible,(SELECT COALESCE(MAX(b.sort_order),-1)+1 FROM banners b),1,:startsAt,:endsAt,CURRENT_TIMESTAMP(3),CURRENT_TIMESTAMP(3))`, input); const rows = await query("SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id", {}, QueryTypes.SELECT); return rows[0].id; }
  async function updateBanner(id, input) { await query("UPDATE banners SET title=:title,subtitle=:subtitle,image_media_id=:imageMediaId,link_type=:linkType,target_product_id=:targetProductId,visible=:visible,starts_at=:startsAt,ends_at=:endsAt,version=version+1,updated_at=CURRENT_TIMESTAMP(3) WHERE id=:id", { id, ...input }); }
  async function deleteBanner(id) { await query("DELETE FROM banners WHERE id=:id", { id }); }
  async function bannerIds(lock = false) { return query(`SELECT CAST(id AS CHAR) AS id FROM banners ORDER BY sort_order,id ${lock ? "FOR UPDATE" : ""}`, {}, QueryTypes.SELECT); }
  async function reorderBanners(ids) { for (let index = 0; index < ids.length; index += 1) await query("UPDATE banners SET sort_order=:sortOrder,updated_at=CURRENT_TIMESTAMP(3) WHERE id=:id", { id: ids[index], sortOrder: index }); }

  async function home() {
    const settings = (await query("SELECT featured_title,show_featured,show_collections,show_journal,CAST(version AS CHAR) AS version,updated_at FROM home_settings WHERE id=1", {}, QueryTypes.SELECT))[0];
    const quickCategories = await query("SELECT CAST(h.category_id AS CHAR) AS category_id,h.icon_text,CAST(h.sort_order AS CHAR) AS sort_order,c.name FROM home_quick_categories h INNER JOIN categories c ON c.id=h.category_id ORDER BY h.sort_order,c.id", {}, QueryTypes.SELECT);
    const featuredProducts = await query("SELECT CAST(h.product_id AS CHAR) AS product_id,CAST(h.sort_order AS CHAR) AS sort_order,p.name FROM home_featured_products h INNER JOIN products p ON p.id=h.product_id ORDER BY h.sort_order,p.id", {}, QueryTypes.SELECT);
    return { settings, quickCategories, featuredProducts };
  }
  async function lockHome() { const rows = await query("SELECT CAST(version AS CHAR) AS version FROM home_settings WHERE id=1 FOR UPDATE", {}, QueryTypes.SELECT); return rows[0]; }
  async function updateHome(input, adminId) { await query("UPDATE home_settings SET featured_title=:featuredTitle,show_featured=:showFeatured,show_collections=:showCollections,show_journal=:showJournal,version=version+1,updated_by_admin_id=:adminId,updated_at=CURRENT_TIMESTAMP(3) WHERE id=1", { ...input, adminId }); }
  async function bumpHome(adminId) { await query("UPDATE home_settings SET version=version+1,updated_by_admin_id=:adminId,updated_at=CURRENT_TIMESTAMP(3) WHERE id=1", { adminId }); }
  async function replaceQuickCategories(items) { await query("DELETE FROM home_quick_categories"); for (let index = 0; index < items.length; index += 1) await query("INSERT INTO home_quick_categories (category_id,icon_text,sort_order,created_at,updated_at) VALUES (:categoryId,:iconText,:sortOrder,CURRENT_TIMESTAMP(3),CURRENT_TIMESTAMP(3))", { ...items[index], sortOrder: index }); }
  async function replaceFeaturedProducts(ids) { await query("DELETE FROM home_featured_products"); for (let index = 0; index < ids.length; index += 1) await query("INSERT INTO home_featured_products (product_id,sort_order,created_at,updated_at) VALUES (:productId,:sortOrder,CURRENT_TIMESTAMP(3),CURRENT_TIMESTAMP(3))", { productId: ids[index], sortOrder: index }); }

  return { writeLog: audit.writeLog, refreshReferenceState: media.refreshReferenceState, activeMedia, activeProducts, productCategories, articles, article, insertArticle, updateArticle, deleteArticle, collections, collection, insertCollection, updateCollection, replaceCollectionProducts, deleteCollection, banners, banner, insertBanner, updateBanner, deleteBanner, bannerIds, reorderBanners, home, lockHome, updateHome, bumpHome, replaceQuickCategories, replaceFeaturedProducts };
}

module.exports = createAdminContentRepository;
