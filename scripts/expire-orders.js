const database = require("../database");
const logger = require("../utils/logger");
const { createOrderService } = require("../services/order.service");

async function main() {
  let totalClosed = 0;
  let totalExpiredCheckouts = 0;
  try {
    await database.connect();
    const service = createOrderService();
    for (let batch = 0; batch < 10; batch += 1) {
      const result = await service.expireOrders(100);
      totalClosed += result.closedCount;
      totalExpiredCheckouts += result.expiredCheckoutCount;
      if (result.scannedCount < 100) break;
    }
    logger.info("expired_orders_processed", { totalClosed, totalExpiredCheckouts });
  } catch (error) {
    logger.error("expired_orders_failed", { error });
    process.exitCode = 1;
  } finally {
    await database.close().catch(() => {});
  }
}

main();
