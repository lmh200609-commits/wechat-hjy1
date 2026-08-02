const seeder = require("../database/seeder");
const database = require("../database");
const logger = require("../utils/logger");

async function main() {
  try {
    const executed = await seeder.seed();
    logger.info("seeders_complete", { executed });
  } catch (error) {
    logger.error("seeders_failed", { error });
    process.exitCode = 1;
  } finally {
    await database.close().catch(() => {});
  }
}

main();
