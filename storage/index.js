const env = require("../config/env");
const { createCosStorage } = require("./cos-storage");
const { createMockStorage } = require("./mock-storage");

let singleton;

function createStorage(config = env.mediaStorage) {
  if (config.driver === "cos") {
    return createCosStorage({
      bucket: config.cosBucket,
      region: config.cosRegion,
      secretId: config.cosSecretId,
      secretKey: config.cosSecretKey,
      sessionToken: config.cosSessionToken,
      readUrlTtlSeconds: config.readUrlTtlSeconds,
    });
  }
  return createMockStorage();
}

function resolveStorageUrls(value, storage = getStorage(), seen = new WeakSet()) {
  if (typeof value === "string") {
    return typeof storage.resolveReadUrl === "function" ? storage.resolveReadUrl(value) : value;
  }
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return value;
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => resolveStorageUrls(item, storage, seen));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    resolveStorageUrls(item, storage, seen),
  ]));
}

function getStorage() {
  if (!singleton) singleton = createStorage();
  return singleton;
}

function resetStorageForTests() {
  singleton = null;
}

module.exports = { createStorage, getStorage, resolveStorageUrls, resetStorageForTests };
