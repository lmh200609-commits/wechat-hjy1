const test = require("node:test");
const assert = require("node:assert/strict");

const validators = require("../validators/admin-catalog.validators");

function productBody(overrides = {}) {
  return {
    name: "紫檀·素工圆珠",
    subtitle: "印度小叶紫檀素面手串",
    categoryId: "10",
    materialId: "20",
    craft: "手工打磨",
    tags: ["紫檀", "素工"],
    imageMediaIds: ["100", "101"],
    primaryMediaId: "100",
    variants: [{
      specLabel: "1.8cm · 18颗",
      priceAmount: 168000,
      originalPriceAmount: 198000,
      initialStock: 10,
      lowStockThreshold: 2,
      enabled: true,
      sortOrder: 0,
    }],
    attributes: [{ label: "材质", value: "印度小叶紫檀" }],
    detailSections: [{ id: "b1", type: "PARAGRAPH", text: "器物说明内容" }],
    ...overrides,
  };
}

test("admin category validators normalize dimensions and protect reorder sets", () => {
  assert.deepEqual(validators.categoryCreate({ body: { dimension: "material", name: "小叶紫檀" } }).value, {
    dimension: "MATERIAL", name: "小叶紫檀", iconText: null,
  });
  assert.equal(validators.categoryReorder({ body: { dimension: "PRODUCT_CATEGORY", categoryIds: ["1", "1"] } }).valid, false);
  assert.equal(validators.categoryUpdate({ params: { categoryId: "1" }, body: { role: "SUPER_ADMIN" } }).valid, false);
});

test("admin product validator accepts independent SKU pricing and initial stock", () => {
  const result = validators.productCreate({ body: productBody() });
  assert.equal(result.valid, true);
  assert.equal(result.value.variants[0].priceAmount, 168000);
  assert.equal(result.value.variants[0].initialStock, 10);
  assert.equal(result.value.primaryMediaId, "100");
});

test("admin product validator normalizes the legacy origin price field and accepts an empty original price", () => {
  const legacy = productBody({
    variants: [{ specLabel: "默认规格", priceAmount: 168000, originPriceAmount: 198000, initialStock: 10, enabled: true }],
  });
  const legacyResult = validators.productCreate({ body: legacy });
  assert.equal(legacyResult.valid, true);
  assert.equal(legacyResult.value.variants[0].originalPriceAmount, 198000);

  const emptyResult = validators.productCreate({ body: productBody({
    variants: [{ specLabel: "默认规格", priceAmount: 168000, originalPriceAmount: null, initialStock: 10, enabled: true }],
  }) });
  assert.equal(emptyResult.valid, true);
  assert.equal(emptyResult.value.variants[0].originalPriceAmount, null);

  const conflictResult = validators.productCreate({ body: productBody({
    variants: [{ specLabel: "默认规格", priceAmount: 168000, originalPriceAmount: 188000, originPriceAmount: 198000, initialStock: 10, enabled: true }],
  }) });
  assert.equal(conflictResult.valid, false);
});

test("admin product validator rejects broken image and SKU contracts", () => {
  assert.equal(validators.productCreate({ body: productBody({ primaryMediaId: "999" }) }).valid, false);
  assert.equal(validators.productCreate({ body: productBody({ variants: [
    { specLabel: "同规格", priceAmount: 10, enabled: true },
    { specLabel: "同规格", priceAmount: 20, enabled: true },
  ] }) }).valid, false);
  assert.equal(validators.productCreate({ body: productBody({ variants: [
    { specLabel: "规格", priceAmount: 100, originalPriceAmount: 90, enabled: true },
  ] }) }).valid, false);
});

test("existing variants cannot silently overwrite stock", () => {
  const body = productBody({
    version: 2,
    variants: [{ id: "50", specLabel: "规格", priceAmount: 100, initialStock: 999, enabled: true }],
  });
  assert.equal(validators.productUpdate({ params: { productId: "8" }, body }).valid, false);
});

test("inventory adjustment validates direction, reason and optimistic version", () => {
  assert.equal(validators.inventoryAdjustment({
    params: { variantId: "9" },
    body: { expectedVersion: 2, changeQuantity: -3, reasonType: "DAMAGE", note: "盘点发现破损" },
  }).valid, true);
  assert.equal(validators.inventoryAdjustment({
    params: { variantId: "9" },
    body: { expectedVersion: 2, changeQuantity: 3, reasonType: "DAMAGE", note: "方向错误" },
  }).valid, false);
});
