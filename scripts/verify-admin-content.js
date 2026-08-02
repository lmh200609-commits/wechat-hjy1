process.env.MEDIA_STORAGE_DRIVER = "mock";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { QueryTypes } = require("sequelize");
const database = require("../database");
const { createMockStorage } = require("../storage/mock-storage");
const { createMediaService } = require("../services/media.service");
const { createAdminContentService } = require("../services/admin-content.service");
const { createPublicService } = require("../services/public.service");

function png(width = 64, height = 64) {
  const buffer = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a", "hex").copy(buffer);
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

async function lastId(transaction) {
  return (await database.sequelize.query("SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id", { type: QueryTypes.SELECT, transaction }))[0].id;
}

async function main() {
  const suffix = crypto.randomBytes(5).toString("hex");
  const ids = { categories: [], media: [], articles: [], collections: [], banners: [], products: [], admins: [] };
  const storage = createMockStorage();
  let homeCreated = false;
  try {
    await database.connect();
    const role = (await database.sequelize.query("SELECT CAST(id AS CHAR) AS id FROM admin_roles WHERE code='SUPER_ADMIN' AND enabled=1 LIMIT 1", { type: QueryTypes.SELECT }))[0];
    assert.ok(role, "SUPER_ADMIN role is required");
    await database.sequelize.query(`INSERT INTO admin_users (username,password_hash,name,role_id,status,failed_login_attempts,password_changed_at,created_at,updated_at)
      VALUES (:username,'integration-test-only','内容集成验证',:roleId,'ACTIVE',0,CURRENT_TIMESTAMP(3),CURRENT_TIMESTAMP(3),CURRENT_TIMESTAMP(3))`, { replacements: { username: `content.verify.${suffix}`, roleId: role.id } });
    const adminId = await lastId(); ids.admins.push(adminId);
    const context = { admin: { id: adminId, username: `content.verify.${suffix}` } };
    const request = { requestId: `content-${suffix}`, ipAddress: "127.0.0.1" };

    const homeRows = await database.sequelize.query("SELECT id FROM home_settings WHERE id=1", { type: QueryTypes.SELECT });
    if (!homeRows.length) {
      await database.sequelize.query("INSERT INTO home_settings (id,featured_title,show_featured,show_collections,show_journal,version,updated_by_admin_id,updated_at) VALUES (1,'精选雅物',1,1,1,1,:adminId,CURRENT_TIMESTAMP(3))", { replacements: { adminId } });
      homeCreated = true;
    }

    for (let index = 0; index < 5; index += 1) {
      await database.sequelize.query(`INSERT INTO categories (code,dimension,name,parent_id,icon_text,sort_order,enabled,created_at,updated_at)
        VALUES (:code,'PRODUCT_CATEGORY',:name,NULL,:iconText,:sortOrder,1,CURRENT_TIMESTAMP(3),CURRENT_TIMESTAMP(3))`, { replacements: { code: `VERIFY-CAT-${suffix}-${index}`, name: `验证品类${index + 1}`, iconText: `雅`, sortOrder: 900 + index } });
      ids.categories.push(await lastId());
    }
    await database.sequelize.query(`INSERT INTO products (code,name,subtitle,category_id,material_id,craft,price_amount,original_price_amount,currency,sale_status,sales_count,low_stock_threshold,tags_json,attributes_json,detail_sections_json,published_at,version,created_at,updated_at)
      VALUES (:code,'验证雅物','内容管理集成验证商品',:categoryId,NULL,'手作',10000,NULL,'CNY','ON_SALE',0,1,JSON_ARRAY(),JSON_ARRAY(),JSON_ARRAY(),CURRENT_TIMESTAMP(3),1,CURRENT_TIMESTAMP(3),CURRENT_TIMESTAMP(3))`, { replacements: { code: `VERIFY-P-${suffix}`, categoryId: ids.categories[0] } });
    const productId = await lastId(); ids.products.push(productId);
    await database.sequelize.query(`INSERT INTO product_variants (product_id,sku_code,spec_label,price_amount,original_price_amount,on_hand_quantity,reserved_quantity,low_stock_threshold,enabled,sort_order,version,created_at,updated_at)
      VALUES (:productId,:sku,'标准款',10000,NULL,10,0,1,1,0,1,CURRENT_TIMESTAMP(3),CURRENT_TIMESTAMP(3))`, { replacements: { productId, sku: `VERIFY-SKU-${suffix}` } });

    const mediaService = createMediaService({ storage });
    const contentService = createAdminContentService();
    for (const name of ["cover.png", "article-body.png"]) {
      const media = await mediaService.upload({ buffer: png(), size: 24, originalname: name }, context, request);
      ids.media.push(media.id);
      assert.match(media.fileID, /^cloud:\/\/mock-env\./);
    }

    const article = await contentService.createArticle({ title: "紫檀纹理集成验证", tag: "材质辨识", summary: "验证多图文文章、媒体引用与公开读取链路能够正常工作。", authorName: "永乐文玩", coverMediaId: ids.media[0], body: [{ id: "h", type: "HEADING", text: "细看其里" }, { id: "p", type: "PARAGRAPH", text: "纹理、密度和棕眼需要结合实物图片进行综合判断。" }, { id: "i1", type: "IMAGE", mediaId: ids.media[1], caption: "纹理实物" }, { id: "i2", type: "IMAGE", mediaId: ids.media[1], caption: "细节对照" }], readingMinutes: 5, isHot: true, status: "PUBLISHED" }, context, request);
    ids.articles.push(article.id);
    assert.equal(article.body.filter((block) => block.type === "IMAGE").length, 2);

    const collection = await contentService.createCollection({ title: "集成验证合集", latinTitle: "VERIFY", description: "验证合集商品排序和封面媒体引用", coverMediaId: ids.media[0], productIds: [productId], visible: true }, context, request);
    ids.collections.push(collection.id);
    const banner = await contentService.createBanner({ title: "集成验证 Banner", subtitle: "已有商品可选跳转", imageMediaId: ids.media[0], targetProductId: productId, visible: true, startsAt: null, endsAt: null }, context, request);
    ids.banners.push(banner.id);

    let currentHome = await contentService.getHome();
    currentHome = await contentService.setQuickCategories({ version: currentHome.version, items: ids.categories.map((categoryId, index) => ({ categoryId, iconText: ["手", "茶", "印", "玉", "把"][index] })) }, context, request);
    currentHome = await contentService.setFeaturedProducts({ version: currentHome.version, productIds: [productId] }, context, request);
    await contentService.updateHome({ version: currentHome.version, featuredTitle: "验证雅物", showFeatured: true, showCollections: true, showJournal: true }, context, request);

    const publicService = createPublicService();
    const publicHome = await publicService.getHome();
    assert.ok(publicHome.banners.some((item) => item.id === banner.id));
    assert.ok(publicHome.collections.some((item) => item.id === collection.id));
    assert.ok(publicHome.articles.some((item) => item.id === article.id));
    const publicArticle = await publicService.getArticleDetail({ articleId: article.id });
    assert.equal(publicArticle.contentBlocks.filter((block) => block.type === "IMAGE").length, 2);

    await assert.rejects(() => mediaService.remove(ids.media[0], context, request), (error) => error.code === "MEDIA_IN_USE");

    await contentService.deleteBanner(banner.id, context, request);
    await contentService.deleteCollection(collection.id, context, request);
    await contentService.deleteArticle(article.id, context, request);
    await database.sequelize.query("DELETE FROM home_featured_products WHERE product_id=:productId", { replacements: { productId } });
    await database.sequelize.query("DELETE FROM home_quick_categories WHERE category_id IN (:ids)", { replacements: { ids: ids.categories } });
    await mediaService.remove(ids.media[0], context, request);
    await mediaService.remove(ids.media[1], context, request);
    assert.equal(storage.files.size, 0);
    console.log("Admin content and mock media integration verification passed.");
  } finally {
    await database.sequelize.query("DELETE FROM home_featured_products WHERE product_id IN (:ids)", { replacements: { ids: ids.products.length ? ids.products : [0] } }).catch(() => {});
    await database.sequelize.query("DELETE FROM home_quick_categories WHERE category_id IN (:ids)", { replacements: { ids: ids.categories.length ? ids.categories : [0] } }).catch(() => {});
    await database.sequelize.query("DELETE FROM banners WHERE id IN (:ids)", { replacements: { ids: ids.banners.length ? ids.banners : [0] } }).catch(() => {});
    await database.sequelize.query("DELETE FROM collections WHERE id IN (:ids)", { replacements: { ids: ids.collections.length ? ids.collections : [0] } }).catch(() => {});
    await database.sequelize.query("DELETE FROM articles WHERE id IN (:ids)", { replacements: { ids: ids.articles.length ? ids.articles : [0] } }).catch(() => {});
    await database.sequelize.query("DELETE FROM product_variants WHERE product_id IN (:ids)", { replacements: { ids: ids.products.length ? ids.products : [0] } }).catch(() => {});
    await database.sequelize.query("DELETE FROM products WHERE id IN (:ids)", { replacements: { ids: ids.products.length ? ids.products : [0] } }).catch(() => {});
    await database.sequelize.query("DELETE FROM categories WHERE id IN (:ids)", { replacements: { ids: ids.categories.length ? ids.categories : [0] } }).catch(() => {});
    await database.sequelize.query("DELETE FROM admin_operation_logs WHERE admin_user_id IN (:ids)", { replacements: { ids: ids.admins.length ? ids.admins : [0] } }).catch(() => {});
    await database.sequelize.query("DELETE FROM media_assets WHERE id IN (:ids)", { replacements: { ids: ids.media.length ? ids.media : [0] } }).catch(() => {});
    if (homeCreated) await database.sequelize.query("DELETE FROM home_settings WHERE id=1").catch(() => {});
    await database.sequelize.query("DELETE FROM admin_users WHERE id IN (:ids)", { replacements: { ids: ids.admins.length ? ids.admins : [0] } }).catch(() => {});
    await database.close().catch(() => {});
  }
}

main().catch((error) => { console.error(`Admin content integration verification failed (${error.code || error.name}): ${error.stack || error.message}`); process.exitCode = 1; });
