const test = require("node:test");
const assert = require("node:assert/strict");

const validators = require("../validators/user.validators");

test("profile patch accepts only a nickname and an owned-avatar reference", () => {
  assert.deepEqual(validators.profilePatch({
    body: { nickname: "听松", avatarMediaId: "8" },
  }).value, { nickname: "听松", avatarMediaId: "8" });
  assert.equal(validators.profilePatch({ body: {} }).valid, false);
  assert.equal(validators.profilePatch({ body: { nickname: "", avatarMediaId: "8" } }).valid, false);
  assert.equal(validators.profilePatch({ body: { nickname: "听松", openid: "forged" } }).valid, false);
});

test("cart validators accept canonical SKU requests and reject client identity fields", () => {
  assert.deepEqual(validators.cartAdd({
    body: { productId: "10", variantId: "20", quantity: 2 },
  }), {
    valid: true,
    value: { productId: "10", variantId: "20", quantity: 2 },
  });
  assert.equal(validators.cartAdd({
    body: { productId: "10", variantId: "20", quantity: 2, userId: "999" },
  }).valid, false);
  assert.equal(validators.cartAdd({
    body: { productId: "10", variantId: "20", quantity: 100 },
  }).valid, false);
});

test("cart patch and selection require strict booleans and valid identifiers", () => {
  assert.deepEqual(validators.cartItemPatch({
    params: { itemId: "9" },
    body: { quantity: 3, checked: false },
  }).value, { itemId: "9", quantity: 3, checked: false });
  assert.equal(validators.cartItemPatch({ params: { itemId: "9" }, body: {} }).valid, false);
  assert.equal(validators.cartSelection({ body: { checked: "true" } }).valid, false);
  assert.deepEqual(validators.cartSelection({
    body: { checked: true, itemIds: ["1", "1", "2"] },
  }).value, { checked: true, itemIds: ["1", "2"] });
});

test("address validators normalize canonical fields and enforce mainland mobile numbers", () => {
  const valid = validators.addressCreate({ body: {
    recipientName: "林清和",
    phone: "13900005678",
    province: "江苏省",
    city: "苏州市",
    district: "姑苏区",
    detail: "平江路 32 号",
    postalCode: "",
    label: "家",
    isDefault: true,
  } });
  assert.equal(valid.valid, true);
  assert.equal(valid.value.postalCode, null);
  assert.equal(valid.value.recipientName, "林清和");

  assert.equal(validators.addressCreate({ body: {
    recipientName: "林清和",
    phone: "12900005678",
    province: "江苏省",
    city: "苏州市",
    district: "姑苏区",
    detail: "平江路 32 号",
  } }).valid, false);
});

test("address patch rejects empty and unknown-field payloads", () => {
  assert.equal(validators.addressPatch({ params: { addressId: "1" }, body: {} }).valid, false);
  assert.equal(validators.addressPatch({
    params: { addressId: "1" }, body: { role: "ADMIN" },
  }).valid, false);
  assert.deepEqual(validators.addressPatch({
    params: { addressId: "1" }, body: { detail: "新的详细地址 100 号" },
  }).value, { addressId: "1", patch: { detail: "新的详细地址 100 号" } });
});

test("favorite and order list validators normalize paging and status", () => {
  assert.deepEqual(validators.favoriteList({ query: {} }).value, { page: 1, pageSize: 20 });
  assert.deepEqual(validators.orderList({ query: { page: "2", pageSize: "10", status: "confirmed" } }).value, {
    page: 2, pageSize: 10, status: "CONFIRMED",
  });
  assert.equal(validators.favoriteList({ query: { pageSize: "51" } }).valid, false);
  assert.equal(validators.orderList({ query: { status: "PAID" } }).valid, false);
});

test("checkout preview keeps cart and buy-now payloads mutually exclusive", () => {
  assert.deepEqual(validators.checkoutPreview({ body: { source: "CART" } }).value, {
    source: "CART", cartItemIds: undefined,
  });
  assert.deepEqual(validators.checkoutPreview({ body: {
    source: "BUY_NOW",
    items: [{ productId: "10", variantId: "20", quantity: 2 }],
  } }).value, {
    source: "BUY_NOW",
    items: [{ productId: "10", variantId: "20", quantity: 2 }],
  });
  assert.equal(validators.checkoutPreview({ body: {
    source: "BUY_NOW",
    items: [
      { productId: "10", variantId: "20", quantity: 1 },
      { productId: "10", variantId: "20", quantity: 1 },
    ],
  } }).valid, false);
  assert.equal(validators.checkoutPreview({ body: {
    source: "CART", items: [{ productId: "10", variantId: "20", quantity: 1 }],
  } }).valid, false);
});

test("order creation requires a safe idempotency header and rejects identity fields", () => {
  const token = "a".repeat(43);
  assert.deepEqual(validators.createOrder({
    body: { checkoutToken: token, addressId: "9", remark: "请妥善包装" },
    headers: { "idempotency-key": "checkout-20260802-0001" },
  }).value, {
    checkoutToken: token,
    addressId: "9",
    remark: "请妥善包装",
    idempotencyKey: "checkout-20260802-0001",
  });
  assert.equal(validators.createOrder({
    body: { checkoutToken: token, addressId: "9" }, headers: {},
  }).code, "IDEMPOTENCY_KEY_REQUIRED");
  assert.equal(validators.createOrder({
    body: { checkoutToken: token, addressId: "9", userId: "99" },
    headers: { "idempotency-key": "checkout-20260802-0001" },
  }).valid, false);
});

test("order identifiers and cancellation reasons are strictly validated", () => {
  assert.equal(validators.orderNoParam({ params: { orderNo: "WW20260802ABCDEF123456" } }).valid, true);
  assert.equal(validators.orderNoParam({ params: { orderNo: "../other-user" } }).valid, false);
  assert.deepEqual(validators.cancelOrder({
    params: { orderId: "12" }, body: { reason: "临时不需要" },
  }).value, { orderId: "12", reason: "临时不需要" });
});
