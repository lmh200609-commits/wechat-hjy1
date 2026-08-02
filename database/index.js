const sequelize = require("../config/database");
const env = require("../config/env");
const logger = require("../utils/logger");

let connected = false;
let lastError = null;

function isConfigured() {
  return Boolean(
    env.database.host
    && env.database.name
    && env.database.username
    && env.database.password,
  );
}

async function connect() {
  if (!isConfigured()) {
    connected = false;
    lastError = new Error("Database is not configured");
    if (env.databaseRequired) throw lastError;
    return false;
  }

  try {
    await sequelize.authenticate();
    connected = true;
    lastError = null;
    logger.info("database_connected");
    return true;
  } catch (error) {
    connected = false;
    lastError = error;
    throw error;
  }
}

async function check() {
  if (!isConfigured()) {
    return { ready: false, reason: "not_configured" };
  }

  try {
    await sequelize.authenticate();
    connected = true;
    lastError = null;
    return { ready: true, reason: null };
  } catch (error) {
    connected = false;
    lastError = error;
    return { ready: false, reason: "connection_failed" };
  }
}

async function close() {
  await sequelize.close();
  connected = false;
}

function getState() {
  return {
    configured: isConfigured(),
    connected,
    lastError: lastError ? lastError.message : null,
  };
}

module.exports = {
  sequelize,
  isConfigured,
  connect,
  check,
  close,
  getState,
};
