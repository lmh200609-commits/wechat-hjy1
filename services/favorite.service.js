const database = require("../database");
const AppError = require("../errors/app-error");
const ERROR_CODES = require("../constants/error-codes");
const createFavoriteRepository = require("../repositories/favorite.repository");

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapFavorite(row) {
  const available = !row.deleted_at
    && row.sale_status === "ON_SALE"
    && Boolean(row.category_enabled)
    && row.category_dimension === "PRODUCT_CATEGORY"
    && Boolean(row.material_enabled)
    && (!row.material_dimension || row.material_dimension === "MATERIAL");
  const minPriceAmount = number(row.min_price_amount);
  const maxPriceAmount = number(row.max_price_amount);
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    subtitle: row.subtitle,
    primaryImageUrl: row.primary_image_url || null,
    priceAmount: minPriceAmount,
    hasPriceRange: maxPriceAmount > minPriceAmount,
    availableQuantity: number(row.available_quantity),
    salesCount: number(row.sales_count),
    saleStatus: row.sale_status,
    available,
    favoritedAt: row.favorited_at instanceof Date
      ? row.favorited_at.toISOString()
      : new Date(row.favorited_at).toISOString(),
  };
}

function createFavoriteService({
  sequelize = database.sequelize,
  repositoryFactory = createFavoriteRepository,
} = {}) {
  const repo = () => repositoryFactory({ sequelize });

  async function getFavorites(userId, pagination) {
    const result = await repo().findAll(userId, pagination);
    return {
      items: result.items.map(mapFavorite),
      page: pagination.page,
      pageSize: pagination.pageSize,
      total: result.total,
      hasMore: pagination.page * pagination.pageSize < result.total,
    };
  }

  async function putFavorite(userId, productId) {
    const repository = repo();
    if (!await repository.findAvailableProduct(productId)) {
      throw new AppError({
        code: ERROR_CODES.FAVORITE_NOT_AVAILABLE,
        message: "Product is not available for favorites",
        statusCode: 409,
      });
    }
    await repository.put(userId, productId);
    return { productId, favorited: true };
  }

  async function removeFavorite(userId, productId) {
    await repo().remove(userId, productId);
    return { productId, favorited: false };
  }

  return { getFavorites, putFavorite, removeFavorite };
}

module.exports = { createFavoriteService, mapFavorite };
