const http = require("http");

const app = require("./app");
const env = require("./config/env");
const database = require("./database");
const migrator = require("./database/migrator");
const logger = require("./utils/logger");

async function prepareDatabase() {
  if (env.autoMigrate) {
    const executed = await migrator.migrate();
    logger.info("migrations_complete", { executed });
    return;
  }

  if (env.connectDatabaseOnStart) await database.connect();
}

async function startServer() {
  await prepareDatabase();

  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(env.port, () => {
      server.off("error", reject);
      resolve();
    });
  });

  logger.info("server_started", {
    port: env.port,
    environment: env.nodeEnv,
    databaseRequired: env.databaseRequired,
    autoMigrate: env.autoMigrate,
  });

  return server;
}

function installShutdownHandlers(server) {
  let shuttingDown = false;

  async function shutdown(signal, error) {
    if (shuttingDown) return;
    shuttingDown = true;
    process.exitCode = error ? 1 : 0;

    logger[error ? "error" : "info"]("server_shutdown_started", { signal, error });

    const forceTimer = setTimeout(() => {
      logger.error("server_shutdown_timeout", { timeoutMs: env.shutdownTimeoutMs });
      if (typeof server.closeAllConnections === "function") server.closeAllConnections();
      process.exit(1);
    }, env.shutdownTimeoutMs);
    forceTimer.unref();

    server.close(async () => {
      try {
        await database.close();
        logger.info("server_shutdown_complete", { signal });
      } catch (closeError) {
        process.exitCode = 1;
        logger.error("database_close_failed", { error: closeError });
      } finally {
        clearTimeout(forceTimer);
      }
    });
  }

  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("unhandledRejection", (error) => shutdown("unhandledRejection", error));
  process.once("uncaughtException", (error) => shutdown("uncaughtException", error));
}

if (require.main === module) {
  startServer()
    .then(installShutdownHandlers)
    .catch(async (error) => {
      logger.error("server_start_failed", { error });
      process.exitCode = 1;
      await database.close().catch(() => {});
    });
}

module.exports = {
  startServer,
  installShutdownHandlers,
};
