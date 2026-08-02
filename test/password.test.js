const test = require("node:test");
const assert = require("node:assert/strict");

const { hashPassword, verifyPassword, DUMMY_PASSWORD_HASH } = require("../utils/password");

test("administrator passwords use salted scrypt hashes", async () => {
  const password = "Verify-Admin#2026";
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.match(first, /^scrypt\$v1\$16384\$8\$1\$/);
  assert.notEqual(first, second);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword("wrong-password", first), false);
});

test("dummy password verification performs the same encoded-hash path", async () => {
  assert.equal(await verifyPassword("anything", DUMMY_PASSWORD_HASH), false);
  assert.equal(await verifyPassword("anything", "invalid"), false);
});
