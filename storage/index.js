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
    });
  }
  return createMockStorage();
}

function getStorage() {
  if (!singleton) singleton = createStorage();
  return singleton;
}

function resetStorageForTests() {
  singleton = null;
}

module.exports = { createStorage, getStorage, resetStorageForTests };
