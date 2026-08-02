const env = require("../config/env");
const database = require("../database");
const ERROR_CODES = require("../constants/error-codes");

function serviceInfo(status) {
  return {
    status,
    service: env.serviceName,
    version: env.serviceVersion,
    environment: env.nodeEnv,
    timestamp: new Date().toISOString(),
  };
}

function getLiveness(req, res) {
  return res.success({
    ...serviceInfo("ok"),
    uptimeSeconds: Math.floor(process.uptime()),
  });
}

async function getReadiness(req, res) {
  const databaseHealth = await database.check();
  if (!databaseHealth.ready) {
    return res.failure(
      ERROR_CODES.DATABASE_UNAVAILABLE,
      "Service is not ready",
      503,
      { database: databaseHealth.reason },
    );
  }

  return res.success({
    ...serviceInfo("ready"),
    database: "ok",
  });
}

module.exports = {
  getLiveness,
  getReadiness,
};
