const { Sequelize } = require("sequelize");
const env = require("./env");
const logger = require("../utils/logger");

const sequelize = new Sequelize(env.database.name, env.database.username, env.database.password, {
  host: env.database.host || "127.0.0.1",
  port: env.database.port,
  dialect: "mysql",
  timezone: "+00:00",
  logging: env.database.logging
    ? (sql, timing) => logger.debug("database_query", { sql, timing })
    : false,
  benchmark: env.database.logging,
  pool: {
    max: env.database.poolMax,
    min: env.database.poolMin,
    acquire: env.database.poolAcquireMs,
    idle: env.database.poolIdleMs,
  },
  dialectOptions: {
    supportBigNumbers: true,
    bigNumberStrings: true,
  },
  define: {
    underscored: true,
    freezeTableName: true,
  },
});

module.exports = sequelize;
