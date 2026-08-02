const database = require("../database");
const logger = require("../utils/logger");
const createAdminRepository = require("../repositories/admin.repository");

async function main() {
  try {
    await database.connect();
    const before = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const result = await createAdminRepository().cleanupSecurityState(before);
    logger.info("admin_security_cleanup_complete", result);
  } catch (error) {
    logger.error("admin_security_cleanup_failed", { error });
    process.exitCode = 1;
  } finally {
    await database.close().catch(() => {});
  }
}

main();
