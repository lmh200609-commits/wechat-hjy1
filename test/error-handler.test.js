const test = require("node:test");
const assert = require("node:assert/strict");

const errorHandler = require("../middleware/error-handler");

test("database uniqueness conflicts use the stable 409 envelope", () => {
  const req = { requestId: "test-conflict", method: "POST", originalUrl: "/api/admin/categories" };
  let result;
  const res = {
    headersSent: false,
    status(statusCode) {
      result = { statusCode };
      return { json(body) { result.body = body; return body; } };
    },
  };
  errorHandler({ name: "SequelizeUniqueConstraintError", message: "duplicate" }, req, res, () => {});
  assert.equal(result.statusCode, 409);
  assert.equal(result.body.code, "CONFLICT");
  assert.equal(result.body.message, "The requested change conflicts with existing data");
});
