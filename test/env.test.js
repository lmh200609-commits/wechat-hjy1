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
  assert.equal(result.adminAuth.sessionTtlSeconds, 7200);
  assert.equal(result.adminAuth.accountMaxAttempts, 5);
  assert.equal(result.mediaStorage.driver, "mock");
});

test("production requires database credentials", () => {
  assert.throws(
    () => parseEnv({ NODE_ENV: "production" }),
    (error) => error instanceof ConfigError && error.message.includes("MYSQL_USERNAME"),
  );
});

test("production requires trusted WeChat routing configuration", () => {
  assert.throws(
    () => parseEnv({
      NODE_ENV: "production",
      MYSQL_HOST: "db.internal",
      MYSQL_DATABASE: "wenwan_mall",
      MYSQL_USERNAME: "app",
      MYSQL_PASSWORD: "test-only",
    }),
    (error) => error instanceof ConfigError && error.message.includes("WECHAT_CLOUD_ENV_ID"),
  );
});

test("production accepts complete database and WeChat routing configuration", () => {
  const result = parseEnv({
    NODE_ENV: "production",
    MYSQL_HOST: "db.internal",
    MYSQL_DATABASE: "wenwan_mall",
    MYSQL_USERNAME: "app",
    MYSQL_PASSWORD: "test-only",
    WECHAT_CLOUD_ENV_ID: "prod-d9g4jzwa5832354ed",
    WECHAT_MINIPROGRAM_APP_ID: "wx14a6f266208130dd",
    WECHAT_CLOUD_SERVICE_NAME: "express-zaiy",
    COS_BUCKET: "wenwan-test-1250000000",
    COS_REGION: "ap-shanghai",
  });
  assert.equal(result.wechat.cloudEnvId, "prod-d9g4jzwa5832354ed");
  assert.equal(result.wechat.miniProgramAppId, "wx14a6f266208130dd");
  assert.equal(result.mediaStorage.driver, "cos");
  assert.equal(result.mediaStorage.cosBucket, "wenwan-test-1250000000");
  assert.equal(result.mediaStorage.cosRegion, "ap-shanghai");
});

test("COS credentials support Cloud Hosting standard Tencent Cloud variable names", () => {
  const result = parseEnv({
    NODE_ENV: "development",
    MEDIA_STORAGE_DRIVER: "cos",
    COS_BUCKET: "wenwan-test-1250000000",
    COS_REGION: "ap-shanghai",
    TENCENTCLOUD_SECRETID: "temporary-id",
    TENCENTCLOUD_SECRETKEY: "temporary-key",
    TENCENTCLOUD_SESSIONTOKEN: "temporary-token",
  });
  assert.equal(result.mediaStorage.cosSecretId, "temporary-id");
  assert.equal(result.mediaStorage.cosSecretKey, "temporary-key");
  assert.equal(result.mediaStorage.cosSessionToken, "temporary-token");
});

test("COS driver requires bucket and region but resolves credentials lazily", () => {
  assert.throws(
    () => parseEnv({ MEDIA_STORAGE_DRIVER: "cos" }),
    (error) => error instanceof ConfigError && error.message.includes("COS_BUCKET"),
  );
  const result = parseEnv({
    MEDIA_STORAGE_DRIVER: "cos",
    COS_BUCKET: "wenwan-test-1250000000",
    COS_REGION: "ap-shanghai",
  });
  assert.equal(result.mediaStorage.cosSecretId, "");
});

test("invalid numeric and boolean values fail fast", () => {
  assert.throws(() => parseEnv({ PORT: "abc" }), ConfigError);
  assert.throws(() => parseEnv({ DATABASE_REQUIRED: "perhaps" }), ConfigError);
  assert.throws(() => parseEnv({ ADMIN_SESSION_TTL_SECONDS: "10" }), ConfigError);
});
