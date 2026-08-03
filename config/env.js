const path = require("path");

function loadLocalEnv() {
  if (process.env.NODE_ENV === "test" || typeof process.loadEnvFile !== "function") return;
  try {
    process.loadEnvFile(path.join(__dirname, "..", ".env"));
  } catch (error) {
    if (error && error.code !== "ENOENT") throw error;
  }
}

loadLocalEnv();

const VALID_NODE_ENVS = new Set(["development", "test", "production"]);

class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigError";
  }
}

function readString(source, name, defaultValue = "") {
  const value = source[name];
  return typeof value === "string" && value.trim() ? value.trim() : defaultValue;
}

function readBoolean(source, name, defaultValue) {
  const raw = readString(source, name);
  if (!raw) return defaultValue;
  if (["1", "true", "yes", "on"].includes(raw.toLowerCase())) return true;
  if (["0", "false", "no", "off"].includes(raw.toLowerCase())) return false;
  throw new ConfigError(`${name} must be a boolean`);
}

function readInteger(source, name, defaultValue, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = readString(source, name);
  if (!raw) return defaultValue;

  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ConfigError(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function parseAddress(address) {
  if (!address) return { host: "", port: undefined };

  const ipv6Match = address.match(/^\[([^\]]+)](?::(\d+))?$/);
  if (ipv6Match) {
    return {
      host: ipv6Match[1],
      port: ipv6Match[2] ? Number(ipv6Match[2]) : undefined,
    };
  }

  const separator = address.lastIndexOf(":");
  if (separator > -1 && address.indexOf(":") === separator) {
    const portText = address.slice(separator + 1);
    if (/^\d+$/.test(portText)) {
      return { host: address.slice(0, separator), port: Number(portText) };
    }
  }

  return { host: address, port: undefined };
}

function parseEnv(source = process.env) {
  const nodeEnv = readString(source, "NODE_ENV", "development").toLowerCase();
  if (!VALID_NODE_ENVS.has(nodeEnv)) {
    throw new ConfigError("NODE_ENV must be development, test, or production");
  }

  const isProduction = nodeEnv === "production";
  const parsedAddress = parseAddress(readString(source, "MYSQL_ADDRESS"));
  const database = {
    host: readString(source, "MYSQL_HOST", parsedAddress.host),
    port: readInteger(source, "MYSQL_PORT", parsedAddress.port || 3306, { min: 1, max: 65535 }),
    name: readString(source, "MYSQL_DATABASE", "wenwan_mall"),
    username: readString(source, "MYSQL_USERNAME"),
    password: typeof source.MYSQL_PASSWORD === "string" ? source.MYSQL_PASSWORD : "",
    poolMax: readInteger(source, "MYSQL_POOL_MAX", 10, { min: 1, max: 100 }),
    poolMin: readInteger(source, "MYSQL_POOL_MIN", 0, { min: 0, max: 100 }),
    poolAcquireMs: readInteger(source, "MYSQL_POOL_ACQUIRE_MS", 10000, { min: 1000, max: 120000 }),
    poolIdleMs: readInteger(source, "MYSQL_POOL_IDLE_MS", 10000, { min: 1000, max: 120000 }),
    logging: readBoolean(source, "MYSQL_LOGGING", false),
  };

  if (database.poolMin > database.poolMax) {
    throw new ConfigError("MYSQL_POOL_MIN cannot be greater than MYSQL_POOL_MAX");
  }

  const databaseRequired = readBoolean(source, "DATABASE_REQUIRED", isProduction);
  const wechat = {
    cloudEnvId: readString(source, "WECHAT_CLOUD_ENV_ID"),
    miniProgramAppId: readString(source, "WECHAT_MINIPROGRAM_APP_ID"),
    cloudServiceName: readString(source, "WECHAT_CLOUD_SERVICE_NAME", "express-zaiy"),
  };
  const adminAuth = {
    sessionTtlSeconds: readInteger(source, "ADMIN_SESSION_TTL_SECONDS", 7200, { min: 900, max: 86400 }),
    loginWindowSeconds: readInteger(source, "ADMIN_LOGIN_WINDOW_SECONDS", 900, { min: 60, max: 86400 }),
    loginMaxAttempts: readInteger(source, "ADMIN_LOGIN_MAX_ATTEMPTS", 10, { min: 3, max: 100 }),
    accountMaxAttempts: readInteger(source, "ADMIN_ACCOUNT_MAX_ATTEMPTS", 5, { min: 3, max: 20 }),
    lockSeconds: readInteger(source, "ADMIN_LOCK_SECONDS", 1800, { min: 60, max: 86400 }),
  };
  const mediaStorage = {
    driver: readString(source, "MEDIA_STORAGE_DRIVER", isProduction ? "cos" : "mock").toLowerCase(),
    cosBucket: readString(source, "COS_BUCKET"),
    cosRegion: readString(source, "COS_REGION"),
    cosSecretId: readString(
      source,
      "COS_SECRET_ID",
      readString(source, "TENCENTCLOUD_SECRETID"),
    ),
    cosSecretKey: readString(
      source,
      "COS_SECRET_KEY",
      readString(source, "TENCENTCLOUD_SECRETKEY"),
    ),
    cosSessionToken: readString(
      source,
      "COS_SESSION_TOKEN",
      readString(source, "TENCENTCLOUD_SESSIONTOKEN"),
    ),
    cloudPathPrefix: readString(source, "MEDIA_CLOUD_PATH_PREFIX", "wenwan/media").replace(/^\/+|\/+$/g, ""),
    maxBytes: readInteger(source, "MEDIA_MAX_BYTES", 8388608, { min: 1024, max: 20971520 }),
    maxPixels: readInteger(source, "MEDIA_MAX_PIXELS", 25000000, { min: 10000, max: 100000000 }),
    readUrlTtlSeconds: readInteger(source, "MEDIA_READ_URL_TTL_SECONDS", 3600, { min: 300, max: 86400 }),
  };
  if (!["mock", "cos"].includes(mediaStorage.driver)) {
    throw new ConfigError("MEDIA_STORAGE_DRIVER must be mock or cos");
  }
  if (databaseRequired) {
    const missing = [];
    if (!database.host) missing.push("MYSQL_ADDRESS or MYSQL_HOST");
    if (!database.username) missing.push("MYSQL_USERNAME");
    if (!database.password) missing.push("MYSQL_PASSWORD");
    if (!database.name) missing.push("MYSQL_DATABASE");
    if (missing.length) {
      throw new ConfigError(`Missing required database configuration: ${missing.join(", ")}`);
    }
  }

  if (isProduction) {
    const missingWechat = [];
    if (!wechat.cloudEnvId) missingWechat.push("WECHAT_CLOUD_ENV_ID");
    if (!wechat.miniProgramAppId) missingWechat.push("WECHAT_MINIPROGRAM_APP_ID");
    if (!wechat.cloudServiceName) missingWechat.push("WECHAT_CLOUD_SERVICE_NAME");
    if (missingWechat.length) {
      throw new ConfigError(`Missing required WeChat configuration: ${missingWechat.join(", ")}`);
    }
  }
  if (mediaStorage.driver === "cos") {
    const missingCos = [];
    if (!mediaStorage.cosBucket) missingCos.push("COS_BUCKET");
    if (!mediaStorage.cosRegion) missingCos.push("COS_REGION");
    if (missingCos.length) {
      throw new ConfigError(`Missing required COS storage configuration: ${missingCos.join(", ")}`);
    }
  }

  return Object.freeze({
    nodeEnv,
    isProduction,
    serviceName: readString(source, "SERVICE_NAME", "wenwan-api"),
    serviceVersion: readString(source, "SERVICE_VERSION", "1.0.0"),
    port: readInteger(source, "PORT", isProduction ? 80 : 3000, { min: 1, max: 65535 }),
    trustProxy: readBoolean(source, "TRUST_PROXY", isProduction),
    requestBodyLimit: readString(source, "REQUEST_BODY_LIMIT", "1mb"),
    shutdownTimeoutMs: readInteger(source, "SHUTDOWN_TIMEOUT_MS", 10000, { min: 1000, max: 60000 }),
    databaseRequired,
    connectDatabaseOnStart: readBoolean(source, "DB_CONNECT_ON_START", databaseRequired),
    autoMigrate: readBoolean(source, "AUTO_MIGRATE", false),
    allowDatabaseSeed: readBoolean(source, "ALLOW_DATABASE_SEED", !isProduction),
    corsOrigins: readString(source, "CORS_ORIGINS")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    wechat: Object.freeze(wechat),
    mediaStorage: Object.freeze(mediaStorage),
    adminAuth: Object.freeze(adminAuth),
    database: Object.freeze(database),
  });
}

const env = parseEnv();

module.exports = Object.freeze({
  ...env,
  ConfigError,
  parseAddress,
  parseEnv,
});
