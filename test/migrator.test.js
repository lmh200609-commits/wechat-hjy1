const test = require("node:test");
const assert = require("node:assert/strict");

process.env.NODE_ENV = "test";

const { discoverMigrations } = require("../database/migrator");
const { discoverSeeders } = require("../database/seeder");

test("migration discovery ignores documentation and sorts migration files", () => {
  assert.deepEqual(discoverMigrations(), []);
});

test("seeder discovery ignores documentation", () => {
  assert.deepEqual(discoverSeeders(), []);
});
