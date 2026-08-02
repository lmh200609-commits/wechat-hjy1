const test = require("node:test");
const assert = require("node:assert/strict");

const { createCartService, mapCart } = require("../services/cart.service");

function availableRow(overrides = {}) {
  return {
    id: "1",
    product_id: "10",
    variant_id: "20",
    quantity: "2",
    checked: 1,
    product_name: "紫檀·素工圆珠",
    product_subtitle: "小叶紫檀 素面无瑕手串",
    sale_status: "ON_SALE",
    product_deleted_at: null,
    category_enabled: 1,
    category_dimension: "PRODUCT_CATEGORY",
    material_enabled: 1,
    material_dimension: "MATERIAL",
    spec_label: "1.8cm · 18颗",
    price_amount: "168000",
    original_price_amount: "198200",
    available_quantity: "8",
    variant_enabled: 1,
    primary_image_url: "https://example.invalid/product.jpg",
    created_at: "2026-08-02T00:00:00.000Z",
    updated_at: "2026-08-02T00:00:00.000Z",
    ...overrides,
  };
}

test("cart mapping uses live SKU price and excludes unavailable rows from totals", () => {
  const result = mapCart([
    availableRow(),
    availableRow({ id: "2", quantity: "3", available_quantity: "0", price_amount: "46000" }),
  ]);
  assert.equal(result.items[0].variant.priceAmount, 168000);
  assert.equal(result.items[1].available, false);
  assert.equal(result.items[1].availabilityReason, "OUT_OF_STOCK");
  assert.deepEqual(result.summary, {
    cartCount: 5,
    selectedCount: 2,
    selectedAmount: 336000,
    allChecked: true,
    currency: "CNY",
  });
});

test("adding an existing SKU merges quantity inside a transaction", async () => {
  let updated;
  const repo = {
    findPurchaseContext: async () => availableRow(),
    findItemByVariant: async () => ({ id: "1", quantity: "2" }),
    updateItem: async (userId, itemId, patch) => { updated = { userId, itemId, patch }; },
    findItems: async () => [availableRow({ quantity: "5" })],
  };
  const sequelize = { transaction: async (work) => work({}) };
  const service = createCartService({ sequelize, repositoryFactory: () => repo });
  const cart = await service.addItem("7", { productId: "10", variantId: "20", quantity: 3 });
  assert.deepEqual(updated, { userId: "7", itemId: "1", patch: { quantity: 5, checked: true } });
  assert.equal(cart.summary.cartCount, 5);
});

test("cart rejects quantities above live available stock", async () => {
  const repo = {
    findPurchaseContext: async () => availableRow({ available_quantity: "3" }),
    findItemByVariant: async () => ({ id: "1", quantity: "2" }),
  };
  const sequelize = { transaction: async (work) => work({}) };
  const service = createCartService({ sequelize, repositoryFactory: () => repo });
  await assert.rejects(
    service.addItem("7", { productId: "10", variantId: "20", quantity: 2 }),
    (error) => error.code === "CART_QUANTITY_EXCEEDS_STOCK" && error.statusCode === 409,
  );
});
