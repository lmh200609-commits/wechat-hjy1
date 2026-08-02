const migrator = require("../database/migrator");
const database = require("../database");
const logger = require("../utils/logger");

async function main() {
  try {
    const executed = await migrator.migrate();
    logger.info("migrations_complete", { executed });
  } catch (error) {
    logger.error("migrations_failed", { error });
    process.exitCode = 1;
  } finally {
    await database.close().catch(() => {});
  }
}

main();
