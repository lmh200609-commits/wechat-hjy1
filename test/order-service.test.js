const test = require("node:test");
const assert = require("node:assert/strict");

const { candidateReason, hashToken, mapOrder } = require("../services/order.service");

function candidate(overrides = {}) {
  return {
    product_deleted_at: null,
    sale_status: "ON_SALE",
    category_enabled: 1,
    category_dimension: "PRODUCT_CATEGORY",
    material_enabled: 1,
    material_dimension: "MATERIAL",
    variant_enabled: 1,
    on_hand_quantity: "10",
    reserved_quantity: "2",
    ...overrides,
  };
}

test("checkout candidate validation uses available rather than physical inventory", () => {
  assert.equal(candidateReason(candidate(), 8), null);
  assert.equal(candidateReason(candidate(), 9), "INSUFFICIENT_STOCK");
  assert.equal(candidateReason(candidate({ reserved_quantity: "10" }), 1), "OUT_OF_STOCK");
  assert.equal(candidateReason(candidate({ sale_status: "OFF_SHELF" }), 1), "PRODUCT_OFF_SHELF");
});

test("checkout tokens are stored as deterministic hashes", () => {
  assert.equal(hashToken("token"), hashToken("token"));
  assert.notEqual(hashToken("token"), hashToken("other"));
  assert.match(hashToken("token"), /^[a-f0-9]{64}$/);
});

test("order mapping returns snapshots without exposing internal idempotency data", () => {
  const order = mapOrder({
    id: "1", order_no: "WW20260802ABCDEF123456", status: "PENDING_CONFIRMATION",
    payment_status: "NOT_ENABLED", fulfillment_status: "NOT_APPLICABLE", currency: "CNY",
    items_amount: "1200", discount_amount: "0", shipping_amount: "0", payable_amount: "1200",
    paid_amount: "0", item_count: "1", source: "BUY_NOW", remark: null,
    receiver_name: "林清和", receiver_phone: "13900005678", receiver_province: "江苏省",
    receiver_city: "苏州市", receiver_district: "姑苏区", receiver_detail: "平江路 32 号",
    expires_at: new Date("2026-08-03T00:00:00Z"), created_at: new Date("2026-08-02T00:00:00Z"),
    updated_at: new Date("2026-08-02T00:00:00Z"),
  }, [{
    id: "2", product_id: "3", variant_id: "4", product_code_snapshot: "P-3",
    product_name_snapshot: "器物", product_subtitle_snapshot: "副标题", image_url_snapshot: "/a.jpg",
    spec_snapshot: "18mm", unit_price_amount: "1200", quantity: "1", subtotal_amount: "1200",
  }]);
  assert.equal(order.cancellable, true);
  assert.equal(order.items[0].productName, "器物");
  assert.equal(order.payableAmount, 1200);
  assert.equal("idempotencyKey" in order, false);
});
