const STATUSES = new Set(["ALL", "PENDING_CONFIRMATION", "CONFIRMED", "CANCELLED", "CLOSED"]);

function invalid(field, message, code = "VALIDATION_ERROR") {
  return { valid: false, code, errors: [{ field, message }] };
}

function exactKeys(body, allowed) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return invalid("body", "body must be an object");
  const extra = Object.keys(body).find((key) => !allowed.has(key));
  return extra ? invalid(extra, `${extra} is not allowed`) : null;
}

function positiveId(value, field) {
  const text = String(value == null ? "" : value).trim();
  return /^[1-9]\d*$/.test(text) ? text : invalid(field, `${field} must be a positive integer string`);
}

function pagination(query) {
  const rawPage = query.page == null ? "1" : String(query.page);
  const rawPageSize = query.pageSize == null ? "20" : String(query.pageSize);
  if (!/^\d+$/.test(rawPage) || Number(rawPage) < 1) return invalid("page", "page must be at least 1");
  if (!/^\d+$/.test(rawPageSize) || Number(rawPageSize) < 1 || Number(rawPageSize) > 50) {
    return invalid("pageSize", "pageSize must be between 1 and 50", "PAGE_SIZE_OUT_OF_RANGE");
  }
  return { page: Number(rawPage), pageSize: Number(rawPageSize) };
}

function dateValue(value, field) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return invalid(field, `${field} must be an ISO date-time with timezone`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return invalid(field, `${field} must be a valid ISO date-time`);
  return date;
}

function list({ query }) {
  const page = pagination(query);
  if (page.valid === false) return page;
  const status = String(query.status || "ALL").trim().toUpperCase();
  if (!STATUSES.has(status)) return invalid("status", "status is invalid");
  let keyword;
  if (query.keyword != null) {
    keyword = String(query.keyword).trim();
    if (!keyword || [...keyword].length > 40) return invalid("keyword", "keyword must contain 1 to 40 characters");
  }
  const from = dateValue(query.from, "from");
  if (from?.valid === false) return from;
  const to = dateValue(query.to, "to");
  if (to?.valid === false) return to;
  if (from && to && from.getTime() > to.getTime()) return invalid("from", "from cannot be later than to");
  return { valid: true, value: { ...page, status, keyword, from, to } };
}

function orderParam({ params }) {
  const orderId = positiveId(params.orderId, "orderId");
  return orderId.valid === false ? orderId : { valid: true, value: { orderId } };
}

function confirm({ params, body = {} }) {
  const parsed = orderParam({ params });
  if (parsed.valid === false) return parsed;
  const extra = exactKeys(body, new Set());
  return extra || { valid: true, value: parsed.value };
}

function cancel({ params, body }) {
  const parsed = orderParam({ params });
  if (parsed.valid === false) return parsed;
  const extra = exactKeys(body, new Set(["reason"]));
  if (extra) return extra;
  if (typeof body.reason !== "string") return invalid("reason", "reason must be a string");
  const reason = body.reason.trim();
  if ([...reason].length < 2 || [...reason].length > 100) return invalid("reason", "reason must contain 2 to 100 characters");
  return { valid: true, value: { ...parsed.value, reason } };
}

module.exports = { list, orderParam, confirm, cancel };
