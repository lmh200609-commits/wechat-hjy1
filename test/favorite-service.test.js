const test = require("node:test");
const assert = require("node:assert/strict");

const { createFavoriteService } = require("../services/favorite.service");

test("favorite service maps availability and preserves idempotent semantics", async () => {
  const calls = [];
  const repository = {
    findAll: async () => ({
      items: [{
        id: "10", code: "P-10", name: "器物", subtitle: "副标题", sale_status: "ON_SALE",
        sales_count: "3", deleted_at: null, category_enabled: 1,
        category_dimension: "PRODUCT_CATEGORY", material_enabled: 1, material_dimension: "MATERIAL",
        primary_image_url: "/image.jpg", min_price_amount: "1200", max_price_amount: "1500",
        available_quantity: "2", favorited_at: new Date("2026-08-02T00:00:00Z"),
      }],
      total: 1,
    }),
    findAvailableProduct: async () => ({ id: "10" }),
    put: async (...args) => calls.push(["put", ...args]),
    remove: async (...args) => calls.push(["remove", ...args]),
  };
  const service = createFavoriteService({ sequelize: {}, repositoryFactory: () => repository });
  const result = await service.getFavorites("1", { page: 1, pageSize: 20 });
  assert.equal(result.items[0].hasPriceRange, true);
  assert.equal(result.items[0].priceAmount, 1200);
  assert.equal(result.items[0].available, true);
  assert.equal(result.total, 1);
  assert.deepEqual(await service.putFavorite("1", "10"), { productId: "10", favorited: true });
  assert.deepEqual(await service.removeFavorite("1", "10"), { productId: "10", favorited: false });
  assert.deepEqual(calls, [["put", "1", "10"], ["remove", "1", "10"]]);
});

test("favorite service rejects products outside the public catalog", async () => {
  const repository = { findAvailableProduct: async () => null };
  const service = createFavoriteService({ sequelize: {}, repositoryFactory: () => repository });
  await assert.rejects(service.putFavorite("1", "10"), (error) => error.code === "FAVORITE_NOT_AVAILABLE");
});
