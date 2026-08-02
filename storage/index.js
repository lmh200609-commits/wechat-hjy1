const env = require("../config/env");
const { createCloudBaseStorage } = require("./cloudbase-storage");
const { createMockStorage } = require("./mock-storage");

let singleton;

function createStorage(config = env.mediaStorage) {
  if (config.driver === "cloudbase") {
    return createCloudBaseStorage({
      envId: config.cloudEnvId,
      useCurrentEnvironment: config.useCurrentEnvironment,
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
