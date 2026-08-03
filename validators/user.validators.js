function invalid(field, message, code = "INVALID_ARGUMENT") {
  return { valid: false, errors: [{ field, message }], code };
}

function validateKeys(body, allowed) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return invalid("body", "body must be a JSON object");
  const unknown = Object.keys(body).find((key) => !allowed.has(key));
  return unknown ? invalid(unknown, `${unknown} is not allowed`) : null;
}

function parseId(value, field) {
  const text = String(value == null ? "" : value).trim();
  return /^[1-9]\d*$/.test(text) ? text : invalid(field, `${field} must be a positive integer string`);
}

function parseQuantity(value) {
  if (!Number.isInteger(value) || value < 1 || value > 99) {
    return invalid("quantity", "quantity must be an integer between 1 and 99");
  }
  return value;
}

function parseBoolean(value, field) {
  return typeof value === "boolean" ? value : invalid(field, `${field} must be a boolean`);
}

function stringValue(value, field, min, max, { optional = false } = {}) {
  if (optional && (value === undefined || value === null || value === "")) return null;
  if (typeof value !== "string") return invalid(field, `${field} must be a string`);
  const normalized = value.trim();
  const length = [...normalized].length;
  if (length < min || length > max) return invalid(field, `${field} must contain ${min} to ${max} characters`);
  return normalized;
}

function cartAdd({ body }) {
  const keyError = validateKeys(body, new Set(["productId", "variantId", "quantity"]));
  if (keyError) return keyError;
  const productId = parseId(body.productId, "productId");
  if (productId.valid === false) return productId;
  const variantId = parseId(body.variantId, "variantId");
  if (variantId.valid === false) return variantId;
  const quantity = parseQuantity(body.quantity == null ? 1 : body.quantity);
  if (quantity.valid === false) return quantity;
  return { valid: true, value: { productId, variantId, quantity } };
}

function profilePatch({ body }) {
  const keyError = validateKeys(body, new Set(["nickname", "avatarMediaId"]));
  if (keyError) return keyError;
  if (body.nickname === undefined && body.avatarMediaId === undefined) {
    return invalid("body", "nickname or avatarMediaId is required");
  }
  const value = {};
  if (body.nickname !== undefined) {
    const nickname = stringValue(body.nickname, "nickname", 1, 32);
    if (nickname.valid === false) return nickname;
    value.nickname = nickname;
  }
  if (body.avatarMediaId !== undefined) {
    const avatarMediaId = parseId(body.avatarMediaId, "avatarMediaId");
    if (avatarMediaId.valid === false) return avatarMediaId;
    value.avatarMediaId = avatarMediaId;
  }
  return { valid: true, value };
}

function cartItemPatch({ body, params }) {
  const itemId = parseId(params.itemId, "itemId");
  if (itemId.valid === false) return itemId;
  const keyError = validateKeys(body, new Set(["quantity", "checked"]));
  if (keyError) return keyError;
  if (body.quantity === undefined && body.checked === undefined) {
    return invalid("body", "quantity or checked is required");
  }
  const value = { itemId };
  if (body.quantity !== undefined) {
    const quantity = parseQuantity(body.quantity);
    if (quantity.valid === false) return quantity;
    value.quantity = quantity;
  }
  if (body.checked !== undefined) {
    const checked = parseBoolean(body.checked, "checked");
    if (checked.valid === false) return checked;
    value.checked = checked;
  }
  return { valid: true, value };
}

function cartItemParam({ params }) {
  const itemId = parseId(params.itemId, "itemId");
  if (itemId.valid === false) return itemId;
  return { valid: true, value: { itemId } };
}

function cartSelection({ body }) {
  const keyError = validateKeys(body, new Set(["checked", "itemIds"]));
  if (keyError) return keyError;
  const checked = parseBoolean(body.checked, "checked");
  if (checked.valid === false) return checked;
  let itemIds;
  if (body.itemIds !== undefined) {
    if (!Array.isArray(body.itemIds) || body.itemIds.length > 100) {
      return invalid("itemIds", "itemIds must be an array with at most 100 entries");
    }
    itemIds = [];
    for (const value of body.itemIds) {
      const itemId = parseId(value, "itemIds");
      if (itemId.valid === false) return itemId;
      if (!itemIds.includes(itemId)) itemIds.push(itemId);
    }
  }
  return { valid: true, value: { checked, itemIds } };
}

const ADDRESS_FIELDS = new Set([
  "recipientName", "phone", "province", "city", "district", "detail",
  "postalCode", "label", "isDefault",
]);

function parseAddressBody(body, partial) {
  const keyError = validateKeys(body, ADDRESS_FIELDS);
  if (keyError) return keyError;
  if (partial && !Object.keys(body).length) return invalid("body", "at least one address field is required");
  const definitions = [
    ["recipientName", 2, 20],
    ["province", 1, 80],
    ["city", 1, 80],
    ["district", 1, 80],
    ["detail", 5, 100],
  ];
  const value = {};
  for (const [field, min, max] of definitions) {
    if (partial && body[field] === undefined) continue;
    const parsed = stringValue(body[field], field, min, max);
    if (parsed.valid === false) return parsed;
    value[field] = parsed;
  }
  if (!partial || body.phone !== undefined) {
    if (typeof body.phone !== "string" || !/^1[3-9]\d{9}$/.test(body.phone.trim())) {
      return invalid("phone", "phone must be a valid mainland China mobile number");
    }
    value.phone = body.phone.trim();
  }
  for (const [field, max] of [["postalCode", 20], ["label", 30]]) {
    if (partial && body[field] === undefined) continue;
    const parsed = stringValue(body[field], field, 1, max, { optional: true });
    if (parsed && parsed.valid === false) return parsed;
    value[field] = parsed;
  }
  if (!partial || body.isDefault !== undefined) {
    const raw = body.isDefault === undefined ? false : body.isDefault;
    const parsed = parseBoolean(raw, "isDefault");
    if (parsed.valid === false) return parsed;
    value.isDefault = parsed;
  }
  return { valid: true, value };
}

function addressCreate({ body }) {
  return parseAddressBody(body, false);
}

function addressPatch({ body, params }) {
  const addressId = parseId(params.addressId, "addressId");
  if (addressId.valid === false) return addressId;
  const parsed = parseAddressBody(body, true);
  if (parsed.valid === false) return parsed;
  return { valid: true, value: { addressId, patch: parsed.value } };
}

function addressParam({ params }) {
  const addressId = parseId(params.addressId, "addressId");
  if (addressId.valid === false) return addressId;
  return { valid: true, value: { addressId } };
}

function pagination(query = {}) {
  const pageText = String(query.page == null ? "1" : query.page).trim();
  const pageSizeText = String(query.pageSize == null ? "20" : query.pageSize).trim();
  if (!/^[1-9]\d*$/.test(pageText)) return invalid("page", "page must be a positive integer");
  if (!/^[1-9]\d*$/.test(pageSizeText)) return invalid("pageSize", "pageSize must be a positive integer");
  const page = Number(pageText);
  const pageSize = Number(pageSizeText);
  if (page > 100000) return invalid("page", "page is out of range");
  if (pageSize > 50) return invalid("pageSize", "pageSize must not exceed 50", "PAGE_SIZE_OUT_OF_RANGE");
  return { page, pageSize };
}

function favoriteList({ query }) {
  const parsed = pagination(query);
  if (parsed.valid === false) return parsed;
  return { valid: true, value: parsed };
}

function favoriteParam({ params }) {
  const productId = parseId(params.productId, "productId");
  if (productId.valid === false) return productId;
  return { valid: true, value: { productId } };
}

function uniqueIds(values, field, { min = 1, max = 20 } = {}) {
  if (!Array.isArray(values) || values.length < min || values.length > max) {
    return invalid(field, `${field} must contain ${min} to ${max} entries`);
  }
  const result = [];
  for (const value of values) {
    const parsed = parseId(value, field);
    if (parsed.valid === false) return parsed;
    if (result.includes(parsed)) return invalid(field, `${field} must not contain duplicates`);
    result.push(parsed);
  }
  return result;
}

function checkoutPreview({ body }) {
  const keyError = validateKeys(body, new Set(["source", "cartItemIds", "items"]));
  if (keyError) return keyError;
  if (!body || !["CART", "BUY_NOW"].includes(body.source)) {
    return invalid("source", "source must be CART or BUY_NOW");
  }
  if (body.source === "CART") {
    if (body.items !== undefined) return invalid("items", "items is not allowed for CART checkout");
    let cartItemIds;
    if (body.cartItemIds !== undefined) {
      cartItemIds = uniqueIds(body.cartItemIds, "cartItemIds");
      if (cartItemIds.valid === false) return cartItemIds;
    }
    return { valid: true, value: { source: "CART", cartItemIds } };
  }
  if (body.cartItemIds !== undefined) {
    return invalid("cartItemIds", "cartItemIds is not allowed for BUY_NOW checkout");
  }
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 20) {
    return invalid("items", "items must contain 1 to 20 entries");
  }
  const items = [];
  const variants = new Set();
  for (const [index, item] of body.items.entries()) {
    const itemKeys = validateKeys(item, new Set(["productId", "variantId", "quantity"]));
    if (itemKeys) return invalid(`items[${index}].${itemKeys.errors[0].field}`, itemKeys.errors[0].message);
    const productId = parseId(item.productId, `items[${index}].productId`);
    if (productId.valid === false) return productId;
    const variantId = parseId(item.variantId, `items[${index}].variantId`);
    if (variantId.valid === false) return variantId;
    if (variants.has(variantId)) return invalid("items", "items must not contain duplicate variantId values");
    variants.add(variantId);
    const quantity = parseQuantity(item.quantity == null ? 1 : item.quantity);
    if (quantity.valid === false) return invalid(`items[${index}].quantity`, quantity.errors[0].message);
    items.push({ productId, variantId, quantity });
  }
  return { valid: true, value: { source: "BUY_NOW", items } };
}

function createOrder({ body, headers = {} }) {
  const keyError = validateKeys(body, new Set(["checkoutToken", "addressId", "remark"]));
  if (keyError) return keyError;
  if (typeof body.checkoutToken !== "string" || !/^[A-Za-z0-9_-]{32,100}$/.test(body.checkoutToken)) {
    return invalid("checkoutToken", "checkoutToken is invalid");
  }
  const addressId = parseId(body.addressId, "addressId");
  if (addressId.valid === false) return addressId;
  let remark = null;
  if (body.remark !== undefined && body.remark !== null && body.remark !== "") {
    remark = stringValue(body.remark, "remark", 1, 100);
    if (remark.valid === false) return remark;
  }
  const rawKey = headers["idempotency-key"];
  if (typeof rawKey !== "string" || !/^[A-Za-z0-9._:-]{16,80}$/.test(rawKey)) {
    return invalid("Idempotency-Key", "Idempotency-Key header must contain 16 to 80 safe characters", "IDEMPOTENCY_KEY_REQUIRED");
  }
  return {
    valid: true,
    value: {
      checkoutToken: body.checkoutToken,
      addressId,
      remark,
      idempotencyKey: rawKey,
    },
  };
}

const ORDER_STATUSES = new Set(["ALL", "PENDING_CONFIRMATION", "CONFIRMED", "CANCELLED", "CLOSED"]);

function orderList({ query }) {
  const parsed = pagination(query);
  if (parsed.valid === false) return parsed;
  const status = String(query.status == null ? "ALL" : query.status).trim().toUpperCase();
  if (!ORDER_STATUSES.has(status)) return invalid("status", "status is invalid");
  return { valid: true, value: { ...parsed, status } };
}

function orderParam({ params }) {
  const orderId = parseId(params.orderId, "orderId");
  if (orderId.valid === false) return orderId;
  return { valid: true, value: { orderId } };
}

function orderNoParam({ params }) {
  const orderNo = String(params.orderNo == null ? "" : params.orderNo).trim().toUpperCase();
  if (!/^WW\d{8}[A-F0-9]{12}$/.test(orderNo)) return invalid("orderNo", "orderNo is invalid");
  return { valid: true, value: { orderNo } };
}

function cancelOrder({ body = {}, params }) {
  const order = orderParam({ params });
  if (order.valid === false) return order;
  const keyError = validateKeys(body, new Set(["reason"]));
  if (keyError) return keyError;
  let reason = null;
  if (body.reason !== undefined && body.reason !== null && body.reason !== "") {
    reason = stringValue(body.reason, "reason", 1, 100);
    if (reason.valid === false) return reason;
  }
  return { valid: true, value: { orderId: order.value.orderId, reason } };
}

module.exports = {
  cartAdd,
  profilePatch,
  cartItemPatch,
  cartItemParam,
  cartSelection,
  addressCreate,
  addressPatch,
  addressParam,
  favoriteList,
  favoriteParam,
  checkoutPreview,
  createOrder,
  orderList,
  orderParam,
  orderNoParam,
  cancelOrder,
};
