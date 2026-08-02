const test = require("node:test");
const assert = require("node:assert/strict");

const validators = require("../validators/admin-order.validators");
const { aggregateVariants, adminOrderDto } = require("../services/admin-order.service");

test("admin order list validator normalizes filters and ISO dates", () => {
  const result = validators.list({ query: {
    page: "2",
    pageSize: "10",
    status: "pending_confirmation",
    keyword: "  WW2026  ",
    from: "2026-08-01T00:00:00+08:00",
    to: "2026-08-31T23:59:59+08:00",
  } });
  assert.equal(result.valid, true);
  assert.equal(result.value.status, "PENDING_CONFIRMATION");
  assert.equal(result.value.keyword, "WW2026");
  assert.ok(result.value.from instanceof Date);
});

test("admin order actions reject client identity and require cancellation reason", () => {
  assert.equal(validators.confirm({ params: { orderId: "1" }, body: { adminId: "1" } }).valid, false);
  assert.equal(validators.cancel({ params: { orderId: "1" }, body: {} }).valid, false);
  assert.equal(validators.cancel({ params: { orderId: "1" }, body: { reason: "客户申请取消" } }).valid, true);
});

test("order variant aggregation prevents duplicate SKU rows from double-applying stale stock", () => {
  const rows = aggregateVariants([
    { variant_id: "9", product_id: "2", quantity: "1", on_hand_quantity: "10", reserved_quantity: "3" },
    { variant_id: "9", product_id: "2", quantity: "2", on_hand_quantity: "10", reserved_quantity: "3" },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].quantity, "3");
});

test("admin order DTO retains immutable snapshots and adds management capabilities", () => {
  const future = new Date(Date.now() + 60000);
  const dto = adminOrderDto({
    id: "1", order_no: "WW20260801ABCDEF123456", user_id: "2",
    status: "PENDING_CONFIRMATION", payment_status: "NOT_ENABLED",
    fulfillment_status: "NOT_APPLICABLE", currency: "CNY",
    items_amount: "100", discount_amount: "0", shipping_amount: "0",
    payable_amount: "100", paid_amount: "0", item_count: "1", source: "BUY_NOW",
    receiver_name: "验证用户", receiver_phone: "13900000000",
    receiver_province: "江苏省", receiver_city: "苏州市", receiver_district: "姑苏区",
    receiver_detail: "平江路一号", expires_at: future, created_at: new Date(), updated_at: new Date(),
  }, [{
    id: "3", order_id: "1", product_id: "4", variant_id: "5",
    product_code_snapshot: "P1", product_name_snapshot: "快照商品",
    unit_price_amount: "100", quantity: "1", subtotal_amount: "100",
  }]);
  assert.equal(dto.userId, "2");
  assert.equal(dto.items[0].productName, "快照商品");
  assert.equal(dto.confirmable, true);
  assert.equal(dto.adminCancellable, true);
});
