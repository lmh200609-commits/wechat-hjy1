const test = require("node:test");
const assert = require("node:assert/strict");

const validators = require("../validators/admin.validators");

test("admin login normalizes usernames and rejects trusted identity fields", () => {
  assert.deepEqual(validators.login({ body: {
    username: " Admin.User ", password: "exact password",
  } }).value, { username: "admin.user", password: "exact password" });
  assert.equal(validators.login({ body: {
    username: "admin", password: "password", role: "SUPER_ADMIN",
  } }).valid, false);
  assert.equal(validators.login({ body: { username: "../admin", password: "password" } }).valid, false);
});

test("admin log filters use the global pagination contract", () => {
  assert.deepEqual(validators.logs({ query: { page: "2", pageSize: "10", module: "Orders" } }).value, {
    page: 2, pageSize: 10, module: "orders",
  });
  assert.equal(validators.logs({ query: { pageSize: "51" } }).valid, false);
  assert.equal(validators.logs({ query: { module: "orders;drop" } }).valid, false);
});
