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
