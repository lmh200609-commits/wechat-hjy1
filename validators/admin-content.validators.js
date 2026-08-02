const STATUSES = new Set(["ALL", "DRAFT", "PUBLISHED", "ARCHIVED"]);
function invalid(field, message) { return { valid: false, errors: [{ field, message }] }; }
function exact(object, keys, field = "body") {
  if (!object || typeof object !== "object" || Array.isArray(object)) return invalid(field, `${field} must be an object`);
  const extra = Object.keys(object).find((key) => !keys.has(key));
  return extra ? invalid(`${field}.${extra}`, `${extra} is not allowed`) : null;
}
function text(value, field, min, max, optional = false) {
  if ((value == null || value === "") && optional) return "";
  if (typeof value !== "string") return invalid(field, `${field} must be a string`);
  const result = value.trim();
  return result.length >= min && result.length <= max ? result : invalid(field, `${field} must contain ${min} to ${max} characters`);
}
function id(value, field) { const result = String(value || "").trim(); return /^[1-9]\d*$/.test(result) ? result : invalid(field, `${field} must be a positive integer string`); }
function integer(value, field, min, max) { return Number.isInteger(value) && value >= min && value <= max ? value : invalid(field, `${field} must be an integer between ${min} and ${max}`); }
function bool(value, field) { return typeof value === "boolean" ? value : invalid(field, `${field} must be a boolean`); }
function pagination(query) {
  const page = Number(query.page || 1); const pageSize = Number(query.pageSize || 20);
  if (!Number.isInteger(page) || page < 1) return invalid("page", "page must be at least 1");
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) return invalid("pageSize", "pageSize must be between 1 and 50");
  return { page, pageSize };
}
function param(params, name) { const value = id(params[name], name); return value.valid === false ? value : { valid: true, value: { [name]: value } }; }

function blocks(value, allowEmpty = false) {
  if (!Array.isArray(value) || (!allowEmpty && !value.length) || value.length > 60) return invalid("body", `body must contain ${allowEmpty ? "0" : "1"} to 60 blocks`);
  const result = [];
  for (let index = 0; index < value.length; index += 1) {
    const block = value[index]; const field = `body[${index}]`;
    const extra = exact(block, new Set(["id", "type", "text", "mediaId", "caption"]), field); if (extra) return extra;
    const type = String(block.type || "").toUpperCase();
    const blockId = text(block.id || `block-${index + 1}`, `${field}.id`, 1, 80); if (blockId.valid === false) return blockId;
    if (type === "IMAGE") {
      const mediaId = id(block.mediaId, `${field}.mediaId`); if (mediaId.valid === false) return mediaId;
      const caption = text(block.caption, `${field}.caption`, 1, 100, true); if (caption.valid === false) return caption;
      result.push({ id: blockId, type, mediaId, caption });
    } else if (["HEADING", "PARAGRAPH"].includes(type)) {
      const valueText = text(block.text, `${field}.text`, 1, type === "HEADING" ? 80 : 1000); if (valueText.valid === false) return valueText;
      result.push({ id: blockId, type, text: valueText });
    } else return invalid(`${field}.type`, "block type must be HEADING, PARAGRAPH or IMAGE");
  }
  return result;
}

function articlePayload(body, updating) {
  const extra = exact(body, new Set(["version", "title", "tag", "summary", "authorName", "coverMediaId", "body", "readingMinutes", "isHot", "status"])); if (extra) return extra;
  const value = {};
  if (updating) { value.version = integer(body.version, "version", 1, 4294967295); if (value.version.valid === false) return value.version; }
  value.status = String(body.status || "DRAFT").toUpperCase(); if (!STATUSES.has(value.status) || value.status === "ALL") return invalid("status", "status is invalid");
  const published = value.status === "PUBLISHED";
  value.title = text(body.title, "title", published ? 4 : 2, 40); if (value.title.valid === false) return value.title;
  value.tag = text(body.tag, "tag", 1, 20); if (value.tag.valid === false) return value.tag;
  value.summary = text(body.summary, "summary", published ? 10 : 1, 160, !published); if (value.summary.valid === false) return value.summary;
  value.authorName = text(body.authorName, "authorName", 1, 40); if (value.authorName.valid === false) return value.authorName;
  value.coverMediaId = body.coverMediaId == null || body.coverMediaId === "" ? null : id(body.coverMediaId, "coverMediaId"); if (value.coverMediaId?.valid === false) return value.coverMediaId;
  if (published && !value.coverMediaId) return invalid("coverMediaId", "coverMediaId is required when publishing");
  value.body = blocks(body.body || [], !published); if (value.body.valid === false) return value.body;
  value.readingMinutes = integer(body.readingMinutes, "readingMinutes", 1, 240); if (value.readingMinutes.valid === false) return value.readingMinutes;
  value.isHot = bool(body.isHot, "isHot"); if (value.isHot.valid === false) return value.isHot;
  return { valid: true, value };
}
function articleList({ query }) { const page = pagination(query); if (page.valid === false) return page; const status = String(query.status || "ALL").toUpperCase(); if (!STATUSES.has(status)) return invalid("status", "status is invalid"); return { valid: true, value: { ...page, status } }; }
function articleCreate({ body }) { return articlePayload(body, false); }
function articleUpdate({ params, body }) { const parsed = param(params, "articleId"); if (parsed.valid === false) return parsed; const data = articlePayload(body, true); return data.valid === false ? data : { valid: true, value: { ...parsed.value, ...data.value } }; }
function articleId({ params }) { return param(params, "articleId"); }

function productIds(value, field, min = 1, max = 50) {
  if (!Array.isArray(value) || value.length < min || value.length > max) return invalid(field, `${field} must contain ${min} to ${max} identifiers`);
  const result = value.map((item, index) => id(item, `${field}[${index}]`)); const bad = result.find((item) => item.valid === false); if (bad) return bad;
  return new Set(result).size === result.length ? result : invalid(field, `${field} must be unique`);
}
function collectionPayload(body, updating) {
  const extra = exact(body, new Set(["version", "title", "latinTitle", "description", "coverMediaId", "productIds", "visible"])); if (extra) return extra;
  const value = {};
  if (updating) { value.version = integer(body.version, "version", 1, 4294967295); if (value.version.valid === false) return value.version; }
  value.title = text(body.title, "title", 2, 20); if (value.title.valid === false) return value.title;
  value.latinTitle = text(body.latinTitle, "latinTitle", 1, 60, true); if (value.latinTitle.valid === false) return value.latinTitle;
  value.description = text(body.description, "description", 5, 60); if (value.description.valid === false) return value.description;
  value.coverMediaId = id(body.coverMediaId, "coverMediaId"); if (value.coverMediaId.valid === false) return value.coverMediaId;
  value.productIds = productIds(body.productIds, "productIds"); if (value.productIds.valid === false) return value.productIds;
  value.visible = bool(body.visible, "visible"); if (value.visible.valid === false) return value.visible;
  return { valid: true, value };
}
function collectionList({ query }) { const page = pagination(query); return page.valid === false ? page : { valid: true, value: page }; }
function collectionCreate({ body }) { return collectionPayload(body, false); }
function collectionUpdate({ params, body }) { const parsed = param(params, "collectionId"); if (parsed.valid === false) return parsed; const data = collectionPayload(body, true); return data.valid === false ? data : { valid: true, value: { ...parsed.value, ...data.value } }; }
function collectionId({ params }) { return param(params, "collectionId"); }

function bannerPayload(body, updating) {
  const extra = exact(body, new Set(["version", "title", "subtitle", "imageMediaId", "targetProductId", "visible", "startsAt", "endsAt"])); if (extra) return extra;
  const value = {};
  if (updating) { value.version = integer(body.version, "version", 1, 4294967295); if (value.version.valid === false) return value.version; }
  value.title = text(body.title, "title", 2, 20); if (value.title.valid === false) return value.title;
  value.subtitle = text(body.subtitle, "subtitle", 2, 24); if (value.subtitle.valid === false) return value.subtitle;
  value.imageMediaId = id(body.imageMediaId, "imageMediaId"); if (value.imageMediaId.valid === false) return value.imageMediaId;
  value.targetProductId = body.targetProductId == null || body.targetProductId === "" ? null : id(body.targetProductId, "targetProductId"); if (value.targetProductId?.valid === false) return value.targetProductId;
  value.visible = bool(body.visible, "visible"); if (value.visible.valid === false) return value.visible;
  for (const field of ["startsAt", "endsAt"]) { value[field] = body[field] ? new Date(body[field]) : null; if (value[field] && Number.isNaN(value[field].getTime())) return invalid(field, `${field} must be an ISO date-time`); }
  if (value.startsAt && value.endsAt && value.startsAt >= value.endsAt) return invalid("endsAt", "endsAt must be later than startsAt");
  return { valid: true, value };
}
function bannerList({ query }) { const page = pagination(query); return page.valid === false ? page : { valid: true, value: page }; }
function bannerCreate({ body }) { return bannerPayload(body, false); }
function bannerUpdate({ params, body }) { const parsed = param(params, "bannerId"); if (parsed.valid === false) return parsed; const data = bannerPayload(body, true); return data.valid === false ? data : { valid: true, value: { ...parsed.value, ...data.value } }; }
function bannerId({ params }) { return param(params, "bannerId"); }
function bannerReorder({ body }) { const extra = exact(body, new Set(["bannerIds"])); if (extra) return extra; const ids = productIds(body.bannerIds, "bannerIds", 1, 30); return ids.valid === false ? ids : { valid: true, value: { bannerIds: ids } }; }

function homeSettings({ body }) {
  const extra = exact(body, new Set(["version", "featuredTitle", "showFeatured", "showCollections", "showJournal"])); if (extra) return extra;
  const version = integer(body.version, "version", 1, 4294967295); if (version.valid === false) return version;
  const featuredTitle = text(body.featuredTitle, "featuredTitle", 2, 12); if (featuredTitle.valid === false) return featuredTitle;
  for (const field of ["showFeatured", "showCollections", "showJournal"]) { const value = bool(body[field], field); if (value.valid === false) return value; }
  return { valid: true, value: { version, featuredTitle, showFeatured: body.showFeatured, showCollections: body.showCollections, showJournal: body.showJournal } };
}
function quickCategories({ body }) {
  const extra = exact(body, new Set(["version", "items"])); if (extra) return extra;
  const version = integer(body.version, "version", 1, 4294967295); if (version.valid === false) return version;
  if (!Array.isArray(body.items) || body.items.length !== 5) return invalid("items", "exactly 5 quick categories are required");
  const items = [];
  for (let i = 0; i < body.items.length; i += 1) { const row = body.items[i]; const e = exact(row, new Set(["categoryId", "iconText"]), `items[${i}]`); if (e) return e; const categoryId = id(row.categoryId, `items[${i}].categoryId`); if (categoryId.valid === false) return categoryId; const iconText = text(row.iconText, `items[${i}].iconText`, 1, 2); if (iconText.valid === false) return iconText; items.push({ categoryId, iconText }); }
  if (new Set(items.map((row) => row.categoryId)).size !== 5) return invalid("items", "quick categories must be unique");
  return { valid: true, value: { version, items } };
}
function featuredProducts({ body }) { const extra = exact(body, new Set(["version", "productIds"])); if (extra) return extra; const version = integer(body.version, "version", 1, 4294967295); if (version.valid === false) return version; const ids = productIds(body.productIds, "productIds", 1, 8); return ids.valid === false ? ids : { valid: true, value: { version, productIds: ids } }; }

module.exports = { articleList, articleCreate, articleUpdate, articleId, collectionList, collectionCreate, collectionUpdate, collectionId, bannerList, bannerCreate, bannerUpdate, bannerId, bannerReorder, homeSettings, quickCategories, featuredProducts };
