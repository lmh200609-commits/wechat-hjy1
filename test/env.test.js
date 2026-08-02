const test = require("node:test");
const assert = require("node:assert/strict");

const { ConfigError, parseAddress, parseEnv } = require("../config/env");

test("parseAddress supports host, port, and bracketed IPv6", () => {
  assert.deepEqual(parseAddress("db.internal:3307"), { host: "db.internal", port: 3307 });
  assert.deepEqual(parseAddress("db.internal"), { host: "db.internal", port: undefined });
  assert.deepEqual(parseAddress("[::1]:3306"), { host: "::1", port: 3306 });
});

test("development can start without database credentials", () => {
  const result = parseEnv({ NODE_ENV: "development" });
  assert.equal(result.databaseRequired, false);
  assert.equal(result.database.name, "wenwan_mall");
  assert.equal(result.port, 3000);
});

test("production requires database credentials", () => {
  assert.throws(
    () => parseEnv({ NODE_ENV: "production" }),
    (error) => error instanceof ConfigError && error.message.includes("MYSQL_USERNAME"),
  );
});

test("invalid numeric and boolean values fail fast", () => {
  assert.throws(() => parseEnv({ PORT: "abc" }), ConfigError);
  assert.throws(() => parseEnv({ DATABASE_REQUIRED: "perhaps" }), ConfigError);
});
