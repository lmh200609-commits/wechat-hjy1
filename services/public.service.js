const AppError = require("../errors/app-error");
const ERROR_CODES = require("../constants/error-codes");
const createPublicRepository = require("../repositories/public.repository");

function asNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function asBoolean(value) {
  return value === true || value === 1 || value === "1";
}

function asIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (Array.isArray(value) || (typeof value === "object" && value !== null)) return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
}

function stockStatus(availableQuantity, lowStockThreshold) {
  if (availableQuantity <= 0) return "SOLD_OUT";
  if (lowStockThreshold > 0 && availableQuantity <= lowStockThreshold) return "LOW_STOCK";
  return "IN_STOCK";
}

function mapCategory(row) {
  return {
    id: row.id,
    code: row.code,
    dimension: row.dimension,
    name: row.name,
    iconText: row.icon_text || "",
    parentId: row.parent_id || null,
    sortOrder: asNumber(row.sort_order),
  };
}

function mapProductSummary(row) {
  const availableQuantity = asNumber(row.available_quantity);
  const lowStockThreshold = asNumber(row.low_stock_threshold);
  const priceAmount = asNumber(row.min_price_amount);
  const maxPriceAmount = asNumber(row.max_price_amount, priceAmount);
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    subtitle: row.subtitle,
    priceAmount,
    originalPriceAmount: row.min_original_price_amount == null ? null : asNumber(row.min_original_price_amount),
    hasPriceRange: maxPriceAmount !== priceAmount,
    currency: row.currency,
    primaryImageUrl: row.primary_image_url || null,
    category: {
      id: row.category_id,
      code: row.category_code,
      name: row.category_name,
      iconText: row.category_icon_text || "",
    },
    material: row.material_id ? {
      id: row.material_id,
      code: row.material_code,
      name: row.material_name,
    } : null,
    craft: row.craft || "",
    tags: parseJson(row.tags, []),
    salesCount: asNumber(row.sales_count),
    saleStatus: row.sale_status,
    stockStatus: stockStatus(availableQuantity, lowStockThreshold),
    publishedAt: asIso(row.published_at),
  };
}

function mapArticleSummary(row) {
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    tag: row.tag,
    summary: row.summary,
    authorName: row.author_name,
    readingMinutes: asNumber(row.reading_minutes, 1),
    isHot: asBoolean(row.is_hot),
    coverImageUrl: row.cover_image_url,
    publishedAt: asIso(row.published_at),
  };
}

function notFound(code, message) {
  throw new AppError({ code, message, statusCode: 404 });
}

function invalidArgument(field, message) {
  throw new AppError({
    code: ERROR_CODES.INVALID_ARGUMENT,
    message,
    statusCode: 400,
    details: [{ field, message }],
  });
}

function collectMediaIds(blocks) {
  return blocks
    .filter((block) => block && block.type === "IMAGE" && block.mediaId != null)
    .map((block) => String(block.mediaId));
}

async function resolveContentMedia(blocks, repository) {
  const normalized = Array.isArray(blocks) ? blocks : [];
  const ids = [...new Set(collectMediaIds(normalized))];
  if (!ids.length) return normalized;
  const mediaRows = await repository.findMediaByIds(ids);
  const urls = new Map(mediaRows.map((row) => [row.id, row.url]));
  return normalized.map((block) => {
    if (!block || block.type !== "IMAGE" || block.mediaId == null) return block;
    const mediaId = String(block.mediaId);
    return { ...block, mediaId, url: urls.get(mediaId) || null };
  });
}

function createPublicService(repository = createPublicRepository()) {
  async function getCategories({ dimension }) {
    const rows = await repository.findCategories(dimension);
    return { items: rows.map(mapCategory) };
  }

  async function getProducts(filters) {
    if (filters.categoryId && !(await repository.findCategoryById(filters.categoryId, "PRODUCT_CATEGORY"))) {
      invalidArgument("categoryId", "categoryId does not reference an enabled product category");
    }
    if (filters.materialId && !(await repository.findCategoryById(filters.materialId, "MATERIAL"))) {
      invalidArgument("materialId", "materialId does not reference an enabled material");
    }
    const result = await repository.findProducts(filters);
    return {
      items: result.items.map(mapProductSummary),
      page: filters.page,
      pageSize: filters.pageSize,
      total: result.total,
      hasMore: filters.page * filters.pageSize < result.total,
    };
  }

  async function getProductDetail({ productId }) {
    const row = await repository.findProductById(productId);
    if (!row) notFound(ERROR_CODES.PRODUCT_NOT_FOUND, "Product not found");
    const [images, variants, relatedRows] = await Promise.all([
      repository.findProductImages(productId),
      repository.findProductVariants(productId),
      repository.findRelatedProducts(row.category_id, productId, 4),
    ]);
    const attributes = parseJson(row.attributes, []);
    const rawSections = parseJson(row.detail_sections, []);
    const detailSections = await resolveContentMedia(rawSections, repository);
    return {
      ...mapProductSummary(row),
      images: images.map((image) => ({
        id: image.id,
        url: image.url,
        kind: image.kind,
        altText: image.alt_text || "",
        sortOrder: asNumber(image.sort_order),
      })),
      variants: variants.map((variant) => {
        const availableQuantity = asNumber(variant.available_quantity);
        const lowStockThreshold = asNumber(variant.low_stock_threshold);
        return {
          id: variant.id,
          skuCode: variant.sku_code,
          specLabel: variant.spec_label,
          priceAmount: asNumber(variant.price_amount),
          originalPriceAmount: variant.original_price_amount == null ? null : asNumber(variant.original_price_amount),
          stockStatus: stockStatus(availableQuantity, lowStockThreshold),
          availableQuantity,
          enabled: asBoolean(variant.enabled),
          sortOrder: asNumber(variant.sort_order),
        };
      }),
      attributes: Array.isArray(attributes) ? attributes : [],
      detailSections,
      relatedProducts: relatedRows.map(mapProductSummary),
      purchaseLimits: { minQuantity: 1, maxQuantity: 99 },
    };
  }

  async function getHome() {
    const now = new Date();
    const [settings, banners, categories, featured, newest, collections, articles] = await Promise.all([
      repository.findHomeSettings(),
      repository.findVisibleBanners(now),
      repository.findHomeQuickCategories(),
      repository.findHomeFeaturedProducts(8),
      repository.findNewArrivals(6),
      repository.findHomeCollections(6),
      repository.findHomeArticles(4),
    ]);
    return {
      config: settings ? {
        featuredTitle: settings.featured_title,
        showFeatured: asBoolean(settings.show_featured),
        showCollections: asBoolean(settings.show_collections),
        showJournal: asBoolean(settings.show_journal),
        version: asNumber(settings.version),
      } : {
        featuredTitle: "精选雅物",
        showFeatured: true,
        showCollections: true,
        showJournal: true,
        version: 0,
      },
      banners: banners.map((banner) => ({
        id: banner.id,
        title: banner.title,
        subtitle: banner.subtitle || "",
        imageUrl: banner.image_url,
        linkType: banner.link_type,
        targetProductId: banner.target_product_id || null,
      })),
      categories: categories.map((category) => ({
        id: category.id,
        code: category.code,
        name: category.name,
        iconText: category.icon_text,
        sortOrder: asNumber(category.sort_order),
      })),
      featuredProducts: featured.map(mapProductSummary),
      newArrivals: newest.map(mapProductSummary),
      collections: collections.map((collection) => ({
        id: collection.id,
        code: collection.code,
        title: collection.title,
        latinTitle: collection.latin_title || "",
        description: collection.description,
        coverImageUrl: collection.cover_image_url,
        productCount: asNumber(collection.product_count),
      })),
      articles: articles.map(mapArticleSummary),
    };
  }

  async function getCollection({ collectionId }) {
    const collection = await repository.findCollectionById(collectionId);
    if (!collection) notFound(ERROR_CODES.COLLECTION_NOT_FOUND, "Collection not found");
    const rows = await repository.findCollectionProducts(collectionId, 50);
    const products = rows.map(mapProductSummary);
    return {
      id: collection.id,
      code: collection.code,
      title: collection.title,
      latinTitle: collection.latin_title || "",
      description: collection.description,
      coverImageUrl: collection.cover_image_url,
      products,
      productCount: products.length,
    };
  }

  async function getArticleTags() {
    const rows = await repository.findArticleTags();
    return { items: rows.map((row) => ({ code: row.tag, label: row.tag })) };
  }

  async function getArticles(filters) {
    const result = await repository.findArticles(filters);
    return {
      items: result.items.map(mapArticleSummary),
      page: filters.page,
      pageSize: filters.pageSize,
      total: result.total,
      hasMore: filters.page * filters.pageSize < result.total,
    };
  }

  async function getArticleDetail({ articleId }) {
    const row = await repository.findArticleById(articleId);
    if (!row) notFound(ERROR_CODES.ARTICLE_NOT_FOUND, "Article not found");
    const body = await resolveContentMedia(parseJson(row.body, []), repository);
    const relatedRows = await repository.findRelatedArticles(row.tag, articleId, 4);
    return {
      ...mapArticleSummary(row),
      contentBlocks: body,
      relatedArticles: relatedRows.map(mapArticleSummary),
    };
  }

  async function getHotKeywords() {
    const rows = await repository.findHotKeywords(10);
    return { items: rows.map((row) => ({ id: row.id, keyword: row.keyword, sortOrder: asNumber(row.sort_order) })) };
  }

  return {
    getCategories,
    getProducts,
    getProductDetail,
    getHome,
    getCollection,
    getArticleTags,
    getArticles,
    getArticleDetail,
    getHotKeywords,
  };
}

module.exports = {
  createPublicService,
  mapCategory,
  mapProductSummary,
};
