function invalid(field, message) { return { valid: false, errors: [{ field, message }] }; }
function positiveId(value, field) {
  const text = String(value || "").trim();
  return /^[1-9]\d*$/.test(text) ? text : invalid(field, `${field} must be a positive integer string`);
}
function list({ query }) {
  const page = Number(query.page || 1);
  const pageSize = Number(query.pageSize || 20);
  const referenceStatus = String(query.referenceStatus || "ALL").toUpperCase();
  if (!Number.isInteger(page) || page < 1) return invalid("page", "page must be at least 1");
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) return invalid("pageSize", "pageSize must be between 1 and 50");
  if (!["ALL", "REFERENCED", "UNREFERENCED"].includes(referenceStatus)) return invalid("referenceStatus", "referenceStatus is invalid");
  return { valid: true, value: { page, pageSize, referenceStatus } };
}
function id({ params }) {
  const mediaId = positiveId(params.mediaId, "mediaId");
  return mediaId.valid === false ? mediaId : { valid: true, value: { mediaId } };
}
module.exports = { list, id };
