const SENSITIVE_PARTS = ["password", "token", "secret", "authorization", "openid", "phone"];

function sensitive(key) {
  const normalized = String(key).toLowerCase().replace(/[-_]/g, "");
  return SENSITIVE_PARTS.some((part) => normalized.includes(part));
}

function sanitizeAuditValue(value, seen = new WeakSet()) {
  if (value == null || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeAuditValue(item, seen));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    sensitive(key) ? "[REDACTED]" : sanitizeAuditValue(item, seen),
  ]));
}

async function writeAudit(repository, input) {
  return repository.writeLog({
    ...input,
    before: sanitizeAuditValue(input.before),
    after: sanitizeAuditValue(input.after),
  });
}

module.exports = { sanitizeAuditValue, writeAudit };
