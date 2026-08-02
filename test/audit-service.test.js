const test = require("node:test");
const assert = require("node:assert/strict");

const { sanitizeAuditValue } = require("../services/audit.service");

test("audit payloads redact secrets and identity fields recursively", () => {
  assert.deepEqual(sanitizeAuditValue({
    username: "admin",
    password: "secret",
    nested: { tokenHash: "hash", phone: "13900000000", value: 1 },
  }), {
    username: "admin",
    password: "[REDACTED]",
    nested: { tokenHash: "[REDACTED]", phone: "[REDACTED]", value: 1 },
  });
});
