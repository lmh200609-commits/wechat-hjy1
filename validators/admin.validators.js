function invalid(field, message, code = "INVALID_ARGUMENT") {
  return { valid: false, errors: [{ field, message }], code };
}

function validateKeys(body, allowed) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return invalid("body", "body must be a JSON object");
  const unknown = Object.keys(body).find((key) => !allowed.has(key));
  return unknown ? invalid(unknown, `${unknown} is not allowed`) : null;
}

function login({ body }) {
  const keyError = validateKeys(body, new Set(["username", "password"]));
  if (keyError) return keyError;
  const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
  if (!/^[a-z][a-z0-9._-]{2,63}$/.test(username)) {
    return invalid("username", "username format is invalid");
  }
  if (typeof body.password !== "string" || body.password.length < 1 || body.password.length > 128) {
    return invalid("password", "password must contain 1 to 128 characters");
  }
  return { valid: true, value: { username, password: body.password } };
}

function emptyBody({ body }) {
  const normalized = body == null ? {} : body;
  const keyError = validateKeys(normalized, new Set());
  if (keyError) return keyError;
  return { valid: true, value: {} };
}

function logs({ query = {} }) {
  const pageText = String(query.page == null ? "1" : query.page).trim();
  const pageSizeText = String(query.pageSize == null ? "20" : query.pageSize).trim();
  if (!/^[1-9]\d*$/.test(pageText)) return invalid("page", "page must be a positive integer");
  if (!/^[1-9]\d*$/.test(pageSizeText)) return invalid("pageSize", "pageSize must be a positive integer");
  const page = Number(pageText);
  const pageSize = Number(pageSizeText);
  if (page > 100000) return invalid("page", "page is out of range");
  if (pageSize > 50) return invalid("pageSize", "pageSize must not exceed 50", "PAGE_SIZE_OUT_OF_RANGE");
  let module = null;
  if (query.module !== undefined && query.module !== "") {
    module = String(query.module).trim().toLowerCase();
    if (!/^[a-z][a-z0-9_-]{1,63}$/.test(module)) return invalid("module", "module is invalid");
  }
  return { valid: true, value: { page, pageSize, module } };
}

module.exports = { login, emptyBody, logs };
