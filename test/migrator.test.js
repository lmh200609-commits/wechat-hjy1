const test = require("node:test");
const assert = require("node:assert/strict");

process.env.NODE_ENV = "test";

const { discoverMigrations } = require("../database/migrator");
const { discoverSeeders } = require("../database/seeder");

test("migration discovery ignores documentation and sorts migration files", () => {
  const migrations = discoverMigrations();
  assert.deepEqual(migrations.map(({ name }) => name), [
    "20260802090000-create-identity-and-foundation.js",
    "20260802091000-create-catalog-and-content.js",
    "20260802092000-create-commerce-and-inventory.js",
    "20260802100000-create-checkout-sessions.js",
    "20260802110000-seed-admin-rbac-and-login-guards.js",
    "20260802120000-add-product-version.js",
    "20260802130000-add-cloudbase-media-and-content-versions.js",
    "20260802131000-allow-incomplete-article-drafts.js",
    "20260803120000-add-cos-media-provider.js",
  ]);
  for (const { migration } of migrations) assert.equal(typeof migration.up, "function");
});

test("seeder discovery ignores documentation", () => {
  assert.deepEqual(discoverSeeders(), []);
});
