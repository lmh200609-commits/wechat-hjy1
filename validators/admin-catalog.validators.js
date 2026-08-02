const DIMENSIONS = new Set(["PRODUCT_CATEGORY", "MATERIAL"]);
const PRODUCT_STATUSES = new Set(["ALL", "DRAFT", "ON_SALE", "OFF_SHELF", "DELETED"]);
const STOCK_STATUSES = new Set(["ALL", "IN_STOCK", "LOW_STOCK", "SOLD_OUT"]);
const MOVEMENT_REASONS = new Set(["PURCHASE", "ADJUSTMENT", "DAMAGE", "OFFLINE_SALE", "RETURN"]);
const BLOCK_TYPES = new Set(["HEADING", "PARAGRAPH", "IMAGE"]);

function invalid(field, message, code = "VALIDATION_ERROR") {
  return { valid: false, code, errors: [{ field, message }] };
}

function exactKeys(object, allowed, field = "body") {
  if (!object || typeof object !== "object" || Array.isArray(object)) return invalid(field, `${field} must be an object`);
  const extra = Object.keys(object).find((key) => !allowed.has(key));
  return extra ? invalid(`${field}.${extra}`, `${extra} is not allowed`) : null;
}

function positiveId(value, field) {
  const text = String(value == null ? "" : value).trim();
  return /^[1-9]\d*$/.test(text) ? text : invalid(field, `${field} must be a positive integer string`);
}

function integer(value, field, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    return invalid(field, `${field} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function text(value, field, min, max, optional = false) {
  if (value == null && optional) return null;
  if (typeof value !== "string") return invalid(field, `${field} must be a string`);
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) {
    return invalid(field, `${field} must contain ${min} to ${max} characters`);
  }
  return normalized;
}

function boolean(value, field, optional = false) {
  if (value == null && optional) return undefined;
  return typeof value === "boolean" ? value : invalid(field, `${field} must be a boolean`);
}

function queryBoolean(value, field) {
  if (value == null || value === "") return undefined;
  if ([true, "true", "1", 1].includes(value)) return true;
  if ([false, "false", "0", 0].includes(value)) return false;
  return invalid(field, `${field} must be true or false`);
}

function page(query) {
  const rawPage = query.page == null ? "1" : String(query.page);
  const rawPageSize = query.pageSize == null ? "20" : String(query.pageSize);
  if (!/^\d+$/.test(rawPage) || Number(rawPage) < 1) return invalid("page", "page must be at least 1");
  if (!/^\d+$/.test(rawPageSize) || Number(rawPageSize) < 1 || Number(rawPageSize) > 50) {
    return invalid("pageSize", "pageSize must be between 1 and 50", "PAGE_SIZE_OUT_OF_RANGE");
  }
  return { page: Number(rawPage), pageSize: Number(rawPageSize) };
}

function categoryList({ query }) {
  const dimension = String(query.dimension || "ALL").toUpperCase();
  if (dimension !== "ALL" && !DIMENSIONS.has(dimension)) return invalid("dimension", "dimension is invalid");
  const enabled = queryBoolean(query.enabled, "enabled");
  if (enabled && enabled.valid === false) return enabled;
  return { valid: true, value: { dimension, enabled } };
}

function categoryCreate({ body }) {
  const extra = exactKeys(body, new Set(["dimension", "name", "iconText"]));
  if (extra) return extra;
  const dimension = String(body.dimension || "").toUpperCase();
  if (!DIMENSIONS.has(dimension)) return invalid("dimension", "dimension is invalid");
  const name = text(body.name, "name", 1, 20);
  if (name.valid === false) return name;
  const iconText = body.iconText == null || body.iconText === "" ? null : text(body.iconText, "iconText", 1, 2);
  if (iconText?.valid === false) return iconText;
  return { valid: true, value: { dimension, name, iconText } };
}

function categoryId({ params }) {
  const categoryIdValue = positiveId(params.categoryId, "categoryId");
  if (categoryIdValue.valid === false) return categoryIdValue;
  return { valid: true, value: { categoryId: categoryIdValue } };
}

function categoryUpdate({ params, body }) {
  const parsed = categoryId({ params });
  if (parsed.valid === false) return parsed;
  const extra = exactKeys(body, new Set(["name", "iconText", "enabled"]));
  if (extra) return extra;
  if (!Object.keys(body).length) return invalid("body", "at least one category field is required");
  const value = { ...parsed.value };
  if (Object.hasOwn(body, "name")) {
    value.name = text(body.name, "name", 1, 20);
    if (value.name.valid === false) return value.name;
  }
  if (Object.hasOwn(body, "iconText")) {
    value.iconText = body.iconText == null || body.iconText === "" ? null : text(body.iconText, "iconText", 1, 2);
    if (value.iconText?.valid === false) return value.iconText;
  }
  if (Object.hasOwn(body, "enabled")) {
    value.enabled = boolean(body.enabled, "enabled");
    if (value.enabled.valid === false) return value.enabled;
  }
  return { valid: true, value };
}

function categoryReorder({ body }) {
  const extra = exactKeys(body, new Set(["dimension", "categoryIds"]));
  if (extra) return extra;
  const dimension = String(body.dimension || "").toUpperCase();
  if (!DIMENSIONS.has(dimension)) return invalid("dimension", "dimension is invalid");
  if (!Array.isArray(body.categoryIds) || !body.categoryIds.length || body.categoryIds.length > 100) {
    return invalid("categoryIds", "categoryIds must contain 1 to 100 identifiers");
  }
  const categoryIds = [];
  for (let index = 0; index < body.categoryIds.length; index += 1) {
    const id = positiveId(body.categoryIds[index], `categoryIds[${index}]`);
    if (id.valid === false) return id;
    categoryIds.push(id);
  }
  if (new Set(categoryIds).size !== categoryIds.length) return invalid("categoryIds", "categoryIds must be unique");
  return { valid: true, value: { dimension, categoryIds } };
}

function productList({ query }) {
  const pagination = page(query);
  if (pagination.valid === false) return pagination;
  const status = String(query.status || "ALL").toUpperCase();
  const stockStatus = String(query.stockStatus || "ALL").toUpperCase();
  if (!PRODUCT_STATUSES.has(status)) return invalid("status", "status is invalid");
  if (!STOCK_STATUSES.has(stockStatus)) return invalid("stockStatus", "stockStatus is invalid");
  let keyword;
  if (query.keyword != null) {
    keyword = String(query.keyword).trim();
    if (!keyword || keyword.length > 40) return invalid("keyword", "keyword must contain 1 to 40 characters");
  }
  for (const field of ["categoryId", "materialId"]) {
    if (query[field] != null && query[field] !== "") {
      const id = positiveId(query[field], field);
      if (id.valid === false) return id;
      query[field] = id;
    }
  }
  return { valid: true, value: { ...pagination, status, stockStatus, keyword, categoryId: query.categoryId || null, materialId: query.materialId || null } };
}

function contentBlocks(value, field) {
  if (!Array.isArray(value) || value.length > 60) return invalid(field, `${field} must contain at most 60 blocks`);
  const result = [];
  for (let index = 0; index < value.length; index += 1) {
    const block = value[index];
    const extra = exactKeys(block, new Set(["id", "type", "text", "mediaId", "caption"]), `${field}[${index}]`);
    if (extra) return extra;
    const type = String(block.type || "").toUpperCase();
    if (!BLOCK_TYPES.has(type)) return invalid(`${field}[${index}].type`, "content block type is invalid");
    const id = block.id == null ? `block-${index + 1}` : text(block.id, `${field}[${index}].id`, 1, 80);
    if (id.valid === false) return id;
    if (type === "IMAGE") {
      const mediaId = positiveId(block.mediaId, `${field}[${index}].mediaId`);
      if (mediaId.valid === false) return mediaId;
      const caption = block.caption == null || block.caption === "" ? "" : text(block.caption, `${field}[${index}].caption`, 1, 100);
      if (caption.valid === false) return caption;
      result.push({ id, type, mediaId, caption });
    } else {
      const blockText = text(block.text, `${field}[${index}].text`, 1, type === "HEADING" ? 80 : 1000);
      if (blockText.valid === false) return blockText;
      result.push({ id, type, text: blockText });
    }
  }
  return result;
}

function productPayload(body, updating) {
  const allowed = new Set(["version", "name", "subtitle", "categoryId", "materialId", "craft", "tags", "imageMediaIds", "primaryMediaId", "variants", "attributes", "detailSections"]);
  const extra = exactKeys(body, allowed);
  if (extra) return extra;
  const value = {};
  if (updating) {
    value.version = integer(body.version, "version", { min: 1, max: 4294967295 });
    if (value.version.valid === false) return value.version;
  } else if (Object.hasOwn(body, "version")) return invalid("version", "version is not accepted when creating a product");
  value.name = text(body.name, "name", 2, 24);
  if (value.name.valid === false) return value.name;
  value.subtitle = text(body.subtitle, "subtitle", 2, 36);
  if (value.subtitle.valid === false) return value.subtitle;
  value.categoryId = positiveId(body.categoryId, "categoryId");
  if (value.categoryId.valid === false) return value.categoryId;
  value.materialId = body.materialId == null || body.materialId === "" ? null : positiveId(body.materialId, "materialId");
  if (value.materialId?.valid === false) return value.materialId;
  value.craft = body.craft == null || body.craft === "" ? null : text(body.craft, "craft", 1, 50);
  if (value.craft?.valid === false) return value.craft;

  if (!Array.isArray(body.tags) || body.tags.length > 10) return invalid("tags", "tags must contain at most 10 items");
  value.tags = [];
  for (let i = 0; i < body.tags.length; i += 1) {
    const tag = text(body.tags[i], `tags[${i}]`, 1, 20);
    if (tag.valid === false) return tag;
    value.tags.push(tag);
  }
  if (new Set(value.tags).size !== value.tags.length) return invalid("tags", "tags must be unique");

  if (!Array.isArray(body.imageMediaIds) || body.imageMediaIds.length < 1 || body.imageMediaIds.length > 6) {
    return invalid("imageMediaIds", "imageMediaIds must contain 1 to 6 identifiers");
  }
  value.imageMediaIds = [];
  for (let i = 0; i < body.imageMediaIds.length; i += 1) {
    const id = positiveId(body.imageMediaIds[i], `imageMediaIds[${i}]`);
    if (id.valid === false) return id;
    value.imageMediaIds.push(id);
  }
  if (new Set(value.imageMediaIds).size !== value.imageMediaIds.length) return invalid("imageMediaIds", "imageMediaIds must be unique");
  value.primaryMediaId = positiveId(body.primaryMediaId, "primaryMediaId");
  if (value.primaryMediaId.valid === false) return value.primaryMediaId;
  if (!value.imageMediaIds.includes(value.primaryMediaId)) return invalid("primaryMediaId", "primaryMediaId must be included in imageMediaIds");

  if (!Array.isArray(body.variants) || body.variants.length < 1 || body.variants.length > 20) {
    return invalid("variants", "variants must contain 1 to 20 items");
  }
  value.variants = [];
  for (let i = 0; i < body.variants.length; i += 1) {
    const variant = body.variants[i];
    const variantExtra = exactKeys(variant, new Set(["id", "skuCode", "specLabel", "priceAmount", "originalPriceAmount", "initialStock", "lowStockThreshold", "enabled", "sortOrder"]), `variants[${i}]`);
    if (variantExtra) return variantExtra;
    const id = variant.id == null ? null : positiveId(variant.id, `variants[${i}].id`);
    if (id?.valid === false) return id;
    if (id && Object.hasOwn(variant, "initialStock")) return invalid(`variants[${i}].initialStock`, "initialStock is only accepted for new variants");
    const skuCode = variant.skuCode == null || variant.skuCode === "" ? null : text(variant.skuCode, `variants[${i}].skuCode`, 2, 80);
    if (skuCode?.valid === false) return skuCode;
    if (skuCode && !/^[A-Za-z0-9_-]+$/.test(skuCode)) return invalid(`variants[${i}].skuCode`, "skuCode may only contain letters, digits, underscore and hyphen");
    const specLabel = text(variant.specLabel, `variants[${i}].specLabel`, 1, 30);
    if (specLabel.valid === false) return specLabel;
    const priceAmount = integer(variant.priceAmount, `variants[${i}].priceAmount`, { min: 1, max: Number.MAX_SAFE_INTEGER });
    if (priceAmount.valid === false) return priceAmount;
    const originalPriceAmount = variant.originalPriceAmount == null ? null : integer(variant.originalPriceAmount, `variants[${i}].originalPriceAmount`, { min: priceAmount, max: Number.MAX_SAFE_INTEGER });
    if (originalPriceAmount?.valid === false) return originalPriceAmount;
    const initialStock = id ? undefined : integer(variant.initialStock ?? 0, `variants[${i}].initialStock`, { min: 0, max: 100000000 });
    if (initialStock?.valid === false) return initialStock;
    const lowStockThreshold = integer(variant.lowStockThreshold ?? 0, `variants[${i}].lowStockThreshold`, { min: 0, max: 100000000 });
    if (lowStockThreshold.valid === false) return lowStockThreshold;
    const enabled = boolean(variant.enabled, `variants[${i}].enabled`);
    if (enabled.valid === false) return enabled;
    const sortOrder = integer(variant.sortOrder ?? i, `variants[${i}].sortOrder`, { min: 0, max: 65535 });
    if (sortOrder.valid === false) return sortOrder;
    value.variants.push({ id, skuCode, specLabel, priceAmount, originalPriceAmount, initialStock, lowStockThreshold, enabled, sortOrder });
  }
  if (!value.variants.some((item) => item.enabled)) return invalid("variants", "at least one variant must be enabled");
  if (new Set(value.variants.map((item) => item.specLabel)).size !== value.variants.length) return invalid("variants", "variant specLabel values must be unique");
  const explicitSkuCodes = value.variants.map((item) => item.skuCode).filter(Boolean);
  if (new Set(explicitSkuCodes).size !== explicitSkuCodes.length) return invalid("variants", "variant skuCode values must be unique");

  if (!Array.isArray(body.attributes) || body.attributes.length > 30) return invalid("attributes", "attributes must contain at most 30 items");
  value.attributes = [];
  for (let i = 0; i < body.attributes.length; i += 1) {
    const attribute = body.attributes[i];
    const attributeExtra = exactKeys(attribute, new Set(["label", "value"]), `attributes[${i}]`);
    if (attributeExtra) return attributeExtra;
    const label = text(attribute.label, `attributes[${i}].label`, 1, 30);
    const attributeValue = text(attribute.value, `attributes[${i}].value`, 1, 100);
    if (label.valid === false) return label;
    if (attributeValue.valid === false) return attributeValue;
    value.attributes.push({ label, value: attributeValue });
  }
  value.detailSections = contentBlocks(body.detailSections || [], "detailSections");
  if (value.detailSections.valid === false) return value.detailSections;
  return { valid: true, value };
}

function productCreate({ body }) { return productPayload(body, false); }

function productUpdate({ params, body }) {
  const productId = positiveId(params.productId, "productId");
  if (productId.valid === false) return productId;
  const result = productPayload(body, true);
  if (result.valid === false) return result;
  return { valid: true, value: { productId, ...result.value } };
}

function productId({ params }) {
  const value = positiveId(params.productId, "productId");
  return value.valid === false ? value : { valid: true, value: { productId: value } };
}

function variantId({ params }) {
  const value = positiveId(params.variantId, "variantId");
  return value.valid === false ? value : { valid: true, value: { variantId: value } };
}

function inventoryAdjustment({ params, body }) {
  const parsed = variantId({ params });
  if (parsed.valid === false) return parsed;
  const extra = exactKeys(body, new Set(["expectedVersion", "changeQuantity", "reasonType", "note"]));
  if (extra) return extra;
  const expectedVersion = integer(body.expectedVersion, "expectedVersion", { min: 1, max: 4294967295 });
  if (expectedVersion.valid === false) return expectedVersion;
  const changeQuantity = integer(body.changeQuantity, "changeQuantity", { min: -100000000, max: 100000000 });
  if (changeQuantity.valid === false || changeQuantity === 0) return invalid("changeQuantity", "changeQuantity must be a non-zero integer");
  const reasonType = String(body.reasonType || "").toUpperCase();
  if (!MOVEMENT_REASONS.has(reasonType)) return invalid("reasonType", "reasonType is invalid");
  if (["PURCHASE", "RETURN"].includes(reasonType) && changeQuantity < 0) return invalid("changeQuantity", `${reasonType} requires a positive changeQuantity`);
  if (["DAMAGE", "OFFLINE_SALE"].includes(reasonType) && changeQuantity > 0) return invalid("changeQuantity", `${reasonType} requires a negative changeQuantity`);
  const note = text(body.note, "note", 2, 100);
  if (note.valid === false) return note;
  return { valid: true, value: { ...parsed.value, expectedVersion, changeQuantity, reasonType, note } };
}

function inventoryMovements({ params, query }) {
  const parsed = variantId({ params });
  if (parsed.valid === false) return parsed;
  const pagination = page(query);
  if (pagination.valid === false) return pagination;
  return { valid: true, value: { ...parsed.value, ...pagination } };
}

module.exports = {
  categoryList,
  categoryCreate,
  categoryId,
  categoryUpdate,
  categoryReorder,
  productList,
  productCreate,
  productUpdate,
  productId,
  inventoryAdjustment,
  inventoryMovements,
};
