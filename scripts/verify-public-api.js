const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const database = require("../database");
const createPublicRepository = require("../repositories/public.repository");
const { createPublicService } = require("../services/public.service");

async function main() {
  let transaction;
  try {
    await database.connect();
    transaction = await database.sequelize.transaction();
    const queryInterface = database.sequelize.getQueryInterface();
    const base = Date.now() * 1000;
    const ids = {
      role: base + 1,
      admin: base + 2,
      primaryMedia: base + 3,
      detailMedia: base + 4,
      articleMedia: base + 5,
      category: base + 6,
      material: base + 7,
      product: base + 8,
      relatedProduct: base + 9,
      variantOne: base + 10,
      variantTwo: base + 11,
      relatedVariant: base + 12,
      primaryImage: base + 13,
      relatedImage: base + 14,
      banner: base + 15,
      collection: base + 16,
      article: base + 17,
      relatedArticle: base + 18,
      keyword: base + 19,
    };
    const now = new Date();
    const options = { transaction };
    const digest = (suffix) => crypto.createHash("sha256").update(`${base}:${suffix}`).digest("hex");

    await queryInterface.bulkInsert("admin_roles", [{
      id: ids.role, code: `VERIFY_ROLE_${base}`, name: "接口验证角色", is_system: false, enabled: true,
    }], options);
    await queryInterface.bulkInsert("admin_users", [{
      id: ids.admin,
      username: `verify_admin_${base}`,
      password_hash: "$verification-only-not-a-real-password-hash",
      name: "接口验证管理员",
      role_id: ids.role,
      status: "ACTIVE",
    }], options);
    await queryInterface.bulkInsert("media_assets", [
      {
        id: ids.primaryMedia,
        object_key: `verification/${base}/primary.jpg`,
        url: `https://example.invalid/${base}/primary.jpg`,
        mime_type: "image/jpeg",
        byte_size: 100,
        width: 100,
        height: 100,
        sha256: digest("primary"),
        status: "ACTIVE",
        created_by_admin_id: ids.admin,
      },
      {
        id: ids.detailMedia,
        object_key: `verification/${base}/detail.jpg`,
        url: `https://example.invalid/${base}/detail.jpg`,
        mime_type: "image/jpeg",
        byte_size: 100,
        width: 100,
        height: 100,
        sha256: digest("detail"),
        status: "ACTIVE",
        created_by_admin_id: ids.admin,
      },
      {
        id: ids.articleMedia,
        object_key: `verification/${base}/article.jpg`,
        url: `https://example.invalid/${base}/article.jpg`,
        mime_type: "image/jpeg",
        byte_size: 100,
        width: 100,
        height: 100,
        sha256: digest("article"),
        status: "ACTIVE",
        created_by_admin_id: ids.admin,
      },
    ], options);
    await queryInterface.bulkInsert("categories", [
      { id: ids.category, code: `verify-category-${base}`, dimension: "PRODUCT_CATEGORY", name: "验证品类", icon_text: "验", sort_order: 1, enabled: true },
      { id: ids.material, code: `verify-material-${base}`, dimension: "MATERIAL", name: "验证材质", icon_text: "材", sort_order: 1, enabled: true },
    ], options);
    await queryInterface.bulkInsert("products", [
      {
        id: ids.product,
        code: `VERIFY-P-${base}`,
        name: "验证商品",
        subtitle: "用于数据库契约验证",
        category_id: ids.category,
        material_id: ids.material,
        craft: "验证工艺",
        price_amount: 12800,
        original_price_amount: 16800,
        currency: "CNY",
        sale_status: "ON_SALE",
        sales_count: 12,
        low_stock_threshold: 2,
        tags_json: JSON.stringify(["验证", "接口"]),
        attributes_json: JSON.stringify([{ label: "材质", value: "验证材质", sortOrder: 1 }]),
        detail_sections_json: JSON.stringify([
          { id: "section-1", type: "PARAGRAPH", text: "验证详情" },
          { id: "section-2", type: "IMAGE", mediaId: String(ids.detailMedia), caption: "验证图片" },
        ]),
        published_at: now,
      },
      {
        id: ids.relatedProduct,
        code: `VERIFY-P-RELATED-${base}`,
        name: "关联验证商品",
        subtitle: "用于同类推荐验证",
        category_id: ids.category,
        material_id: ids.material,
        price_amount: 9900,
        currency: "CNY",
        sale_status: "ON_SALE",
        sales_count: 2,
        low_stock_threshold: 1,
        tags_json: JSON.stringify(["验证"]),
        published_at: new Date(now.getTime() - 1000),
      },
    ], options);
    await queryInterface.bulkInsert("product_variants", [
      { id: ids.variantOne, product_id: ids.product, sku_code: `VERIFY-SKU-A-${base}`, spec_label: "小规格", price_amount: 12800, original_price_amount: 16800, on_hand_quantity: 10, reserved_quantity: 2, low_stock_threshold: 2, enabled: true, sort_order: 1 },
      { id: ids.variantTwo, product_id: ids.product, sku_code: `VERIFY-SKU-B-${base}`, spec_label: "大规格", price_amount: 15800, original_price_amount: 18800, on_hand_quantity: 2, reserved_quantity: 1, low_stock_threshold: 1, enabled: true, sort_order: 2 },
      { id: ids.relatedVariant, product_id: ids.relatedProduct, sku_code: `VERIFY-SKU-C-${base}`, spec_label: "默认规格", price_amount: 9900, on_hand_quantity: 0, reserved_quantity: 0, low_stock_threshold: 1, enabled: true, sort_order: 1 },
    ], options);
    await queryInterface.bulkInsert("product_images", [
      { id: ids.primaryImage, product_id: ids.product, media_id: ids.primaryMedia, kind: "PRIMARY", alt_text: "验证商品", sort_order: 1 },
      { id: ids.relatedImage, product_id: ids.relatedProduct, media_id: ids.primaryMedia, kind: "PRIMARY", alt_text: "关联商品", sort_order: 1 },
    ], options);
    await queryInterface.bulkInsert("banners", [{
      id: ids.banner,
      title: "验证 Banner",
      subtitle: "验证副标题",
      image_media_id: ids.primaryMedia,
      link_type: "PRODUCT",
      target_product_id: ids.product,
      visible: true,
      sort_order: 1,
    }], options);
    await queryInterface.bulkInsert("collections", [{
      id: ids.collection,
      code: `verify-collection-${base}`,
      title: "验证合集",
      latin_title: "VERIFICATION",
      description: "用于验证合集接口",
      cover_media_id: ids.primaryMedia,
      visible: true,
      sort_order: 1,
    }], options);
    await queryInterface.bulkInsert("collection_products", [{
      collection_id: ids.collection, product_id: ids.product, sort_order: 1,
    }], options);
    await queryInterface.bulkInsert("articles", [
      {
        id: ids.article,
        code: `verify-article-${base}`,
        title: "验证文玩志文章",
        tag: "接口验证",
        summary: "用于验证文章列表和详情接口",
        author_name: "验证作者",
        cover_media_id: ids.articleMedia,
        body_json: JSON.stringify([
          { id: "block-1", type: "HEADING", text: "验证标题" },
          { id: "block-2", type: "IMAGE", mediaId: String(ids.detailMedia), caption: "验证正文图片" },
        ]),
        reading_minutes: 3,
        status: "PUBLISHED",
        is_hot: true,
        published_at: now,
      },
      {
        id: ids.relatedArticle,
        code: `verify-related-article-${base}`,
        title: "关联验证文章",
        tag: "接口验证",
        summary: "用于验证相关阅读接口",
        author_name: "验证作者",
        cover_media_id: ids.articleMedia,
        body_json: JSON.stringify([{ id: "block-1", type: "PARAGRAPH", text: "关联正文" }]),
        reading_minutes: 2,
        status: "PUBLISHED",
        is_hot: false,
        published_at: new Date(now.getTime() - 1000),
      },
    ], options);
    await queryInterface.bulkInsert("search_hot_keywords", [{
      id: ids.keyword,
      keyword: `验证热词${base}`,
      enabled: true,
      sort_order: 1,
      created_by_admin_id: ids.admin,
      updated_by_admin_id: ids.admin,
    }], options);
    const [existingHomeSettings] = await database.sequelize.query(
      "SELECT id FROM home_settings WHERE id = 1",
      { transaction },
    );
    const verificationSettings = {
      featured_title: "验证精选",
      show_featured: true,
      show_collections: true,
      show_journal: true,
      version: 1,
      updated_by_admin_id: ids.admin,
    };
    if (existingHomeSettings.length) {
      await queryInterface.bulkUpdate("home_settings", verificationSettings, { id: 1 }, options);
    } else {
      await queryInterface.bulkInsert("home_settings", [{ id: 1, ...verificationSettings }], options);
    }
    const [quickSortRows] = await database.sequelize.query(
      "SELECT sort_order FROM home_quick_categories",
      { transaction },
    );
    const [featuredSortRows] = await database.sequelize.query(
      "SELECT sort_order FROM home_featured_products",
      { transaction },
    );
    const nextSort = (rows) => {
      const used = new Set(rows.map((row) => Number(row.sort_order)));
      for (let value = 0; value <= 255; value += 1) if (!used.has(value)) return value;
      throw new Error("No verification sort slot is available");
    };
    await queryInterface.bulkInsert("home_quick_categories", [{
      category_id: ids.category, icon_text: "验", sort_order: nextSort(quickSortRows),
    }], options);
    await queryInterface.bulkInsert("home_featured_products", [{
      product_id: ids.product, sort_order: nextSort(featuredSortRows),
    }], options);

    const repository = createPublicRepository({ sequelize: database.sequelize, transaction });
    const service = createPublicService(repository);
    const categoryResult = await service.getCategories({ dimension: "ALL" });
    assert.ok(categoryResult.items.some((item) => item.id === String(ids.category)));

    const products = await service.getProducts({
      page: 1,
      pageSize: 20,
      categoryId: String(ids.category),
      materialId: String(ids.material),
      keyword: "验证",
      sort: "PRICE_ASC",
      inStock: true,
      minPriceAmount: 10000,
      maxPriceAmount: 20000,
    });
    assert.equal(products.total, 1);
    assert.equal(products.items[0].priceAmount, 12800);
    assert.equal(products.items[0].hasPriceRange, true);

    const detail = await service.getProductDetail({ productId: String(ids.product) });
    assert.equal(detail.variants.length, 2);
    assert.equal(detail.variants[0].availableQuantity, 8);
    assert.equal(detail.detailSections[1].url, `https://example.invalid/${base}/detail.jpg`);
    assert.equal(detail.relatedProducts.length, 1);

    const home = await service.getHome();
    assert.equal(home.config.featuredTitle, "验证精选");
    assert.ok(Array.isArray(home.featuredProducts));
    assert.ok(home.banners.some((item) => item.targetProductId === String(ids.product)));

    const collection = await service.getCollection({ collectionId: String(ids.collection) });
    assert.equal(collection.productCount, 1);

    const articles = await service.getArticles({ page: 1, pageSize: 20, tag: "接口验证" });
    assert.equal(articles.total, 2);
    const article = await service.getArticleDetail({ articleId: String(ids.article) });
    assert.equal(article.contentBlocks[1].url, `https://example.invalid/${base}/detail.jpg`);
    assert.equal(article.relatedArticles.length, 1);

    const tags = await service.getArticleTags();
    assert.ok(tags.items.some((item) => item.code === "接口验证"));
    const keywords = await service.getHotKeywords();
    assert.ok(keywords.items.some((item) => item.keyword === `验证热词${base}`));

    console.log("Public API database contract verification passed.");
  } catch (error) {
    const reason = error.original?.sqlMessage || error.original?.code || error.code || error.name || "Error";
    console.error(`Public API database contract verification failed (${reason}).`);
    process.exitCode = 1;
  } finally {
    if (transaction) await transaction.rollback().catch(() => {});
    await database.close().catch(() => {});
  }
}

main();
