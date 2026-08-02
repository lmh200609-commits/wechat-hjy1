const test = require("node:test");
const assert = require("node:assert/strict");

const AppError = require("../errors/app-error");
const { createPublicService } = require("../services/public.service");

function productRow(overrides = {}) {
  return {
    id: "101",
    code: "P-101",
    name: "紫檀手串",
    subtitle: "高密老料",
    currency: "CNY",
    craft: "手工打磨",
    tags: ["高密"],
    sales_count: "12",
    sale_status: "ON_SALE",
    published_at: new Date("2026-08-01T00:00:00.000Z"),
    category_id: "10",
    category_code: "bracelet",
    category_name: "手串",
    category_icon_text: "手",
    material_id: "20",
    material_code: "zitan",
    material_name: "小叶紫檀",
    primary_image_url: "https://example.invalid/product.jpg",
    min_price_amount: "12800",
    max_price_amount: "15800",
    min_original_price_amount: "16800",
    available_quantity: "3",
    low_stock_threshold: "3",
    ...overrides,
  };
}

function repository(overrides = {}) {
  return {
    findCategories: async () => [],
    findCategoryById: async () => ({ id: "valid" }),
    findProducts: async () => ({ items: [productRow()], total: 1 }),
    findProductById: async () => ({
      ...productRow(),
      attributes: [{ label: "材质", value: "小叶紫檀" }],
      detail_sections: [{ id: "d1", type: "IMAGE", mediaId: "501" }],
    }),
    findProductImages: async () => [{ id: "301", url: "https://example.invalid/product.jpg", kind: "PRIMARY", alt_text: "", sort_order: "1" }],
    findProductVariants: async () => [{ id: "201", sku_code: "SKU-1", spec_label: "默认规格", price_amount: "12800", original_price_amount: null, available_quantity: "3", low_stock_threshold: "3", enabled: 1, sort_order: "1" }],
    findRelatedProducts: async () => [],
    findMediaByIds: async () => [{ id: "501", url: "https://example.invalid/detail.jpg" }],
    findHomeSettings: async () => null,
    findVisibleBanners: async () => [],
    findHomeQuickCategories: async () => [],
    findHomeFeaturedProducts: async () => [],
    findNewArrivals: async () => [],
    findHomeCollections: async () => [],
    findHomeArticles: async () => [],
    findCollectionById: async () => null,
    findCollectionProducts: async () => [],
    findArticleTags: async () => [],
    findArticles: async () => ({ items: [], total: 0 }),
    findArticleById: async () => null,
    findRelatedArticles: async () => [],
    findHotKeywords: async () => [],
    ...overrides,
  };
}

test("product list maps integer money, price ranges, and low stock", async () => {
  const service = createPublicService(repository());
  const result = await service.getProducts({ page: 1, pageSize: 20, sort: "DEFAULT" });
  assert.equal(result.total, 1);
  assert.equal(result.hasMore, false);
  assert.equal(result.items[0].priceAmount, 12800);
  assert.equal(result.items[0].hasPriceRange, true);
  assert.equal(result.items[0].stockStatus, "LOW_STOCK");
  assert.equal(result.items[0].category.id, "10");
});

test("product detail exposes SKU inventory and resolves structured media", async () => {
  const service = createPublicService(repository());
  const result = await service.getProductDetail({ productId: "101" });
  assert.equal(result.variants[0].availableQuantity, 3);
  assert.equal(result.variants[0].stockStatus, "LOW_STOCK");
  assert.equal(result.detailSections[0].url, "https://example.invalid/detail.jpg");
  assert.deepEqual(result.purchaseLimits, { minQuantity: 1, maxQuantity: 99 });
});

test("home has a stable empty configuration before administrators publish content", async () => {
  const service = createPublicService(repository());
  const result = await service.getHome();
  assert.deepEqual(result.config, {
    featuredTitle: "精选雅物",
    showFeatured: true,
    showCollections: true,
    showJournal: true,
    version: 0,
  });
  assert.deepEqual(result.banners, []);
});

test("invalid category filters and hidden resources return stable business errors", async () => {
  const service = createPublicService(repository({ findCategoryById: async () => null }));
  await assert.rejects(
    service.getProducts({ page: 1, pageSize: 20, categoryId: "999", sort: "DEFAULT" }),
    (error) => error instanceof AppError && error.code === "INVALID_ARGUMENT" && error.statusCode === 400,
  );
  await assert.rejects(
    service.getCollection({ collectionId: "999" }),
    (error) => error instanceof AppError && error.code === "COLLECTION_NOT_FOUND" && error.statusCode === 404,
  );
});
