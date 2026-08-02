const database = require("../database");
const AppError = require("../errors/app-error");
const ERROR_CODES = require("../constants/error-codes");
const createAdminOrderRepository = require("../repositories/admin-order.repository");
const { mapOrder } = require("./order.service");
const { writeAudit } = require("./audit.service");

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function fail(code, message, statusCode = 409, details) {
  throw new AppError({ code, message, statusCode, details });
}

function isExpired(row) {
  if (row.is_expired !== undefined && row.is_expired !== null) return number(row.is_expired) === 1;
  return new Date(row.expires_at).getTime() <= Date.now();
}

function adminOrderDto(row, items) {
  return {
    ...mapOrder(row, items),
    userId: row.user_id,
    confirmable: row.status === "PENDING_CONFIRMATION" && !isExpired(row),
    adminCancellable: row.status === "PENDING_CONFIRMATION" && !isExpired(row),
  };
}

function groupItems(rows) {
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.order_id)) grouped.set(row.order_id, []);
    grouped.get(row.order_id).push(row);
  }
  return grouped;
}

function aggregateVariants(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const current = grouped.get(row.variant_id);
    if (current) current.quantity = String(number(current.quantity) + number(row.quantity));
    else grouped.set(row.variant_id, { ...row });
  }
  return [...grouped.values()].sort((a, b) => BigInt(a.variant_id) < BigInt(b.variant_id) ? -1 : 1);
}

function auditMeta(context, meta) {
  return {
    adminUserId: context.admin.id,
    requestId: meta?.requestId || null,
    ipAddress: meta?.ipAddress || null,
  };
}

function createAdminOrderService({
  sequelize = database.sequelize,
  repositoryFactory = createAdminOrderRepository,
} = {}) {
  const repo = () => repositoryFactory({ sequelize });
  const transaction = (work) => sequelize.transaction(
    async (tx) => work(repositoryFactory({ sequelize, transaction: tx })),
  );

  async function getDashboard() {
    const row = await repo().dashboard();
    return {
      users: { activeCount: number(row.user_count) },
      products: {
        totalCount: number(row.product_count),
        onSaleCount: number(row.on_sale_product_count),
        draftCount: number(row.draft_product_count),
        lowStockVariantCount: number(row.low_stock_variant_count),
        soldOutVariantCount: number(row.sold_out_variant_count),
      },
      orders: {
        pendingCount: number(row.pending_order_count),
        confirmedCount: number(row.confirmed_order_count),
        todayCount: number(row.today_order_count),
        todayConfirmedAmount: number(row.today_confirmed_amount),
        currency: "CNY",
      },
      content: {
        publishedArticleCount: number(row.published_article_count),
        draftArticleCount: number(row.draft_article_count),
        visibleCollectionCount: number(row.visible_collection_count),
        visibleBannerCount: number(row.visible_banner_count),
      },
      generatedAt: new Date().toISOString(),
    };
  }

  async function getOrders(filters) {
    const repository = repo();
    const result = await repository.findOrders(filters);
    const items = await repository.findOrderItems(result.rows.map((row) => row.id));
    const byOrder = groupItems(items);
    return {
      items: result.rows.map((row) => adminOrderDto(row, byOrder.get(row.id) || [])),
      page: filters.page,
      pageSize: filters.pageSize,
      total: result.total,
      hasMore: filters.page * filters.pageSize < result.total,
    };
  }

  async function getOrder(orderId) {
    const repository = repo();
    const row = await repository.findOrder(orderId);
    if (!row) fail(ERROR_CODES.ORDER_NOT_FOUND, "Order not found", 404);
    const items = await repository.findOrderItems([row.id]);
    return adminOrderDto(row, items);
  }

  function assertReserved(items, operation) {
    for (const item of items) {
      const quantity = number(item.quantity);
      const onHand = number(item.on_hand_quantity);
      const reserved = number(item.reserved_quantity);
      if (reserved < quantity || (operation === "CONFIRM" && onHand < quantity)) {
        fail(ERROR_CODES.INTERNAL_ERROR, "Reserved inventory is inconsistent", 500, {
          variantId: item.variant_id,
        });
      }
    }
  }

  async function closeExpired(repository, row, variants, context, meta) {
    assertReserved(variants, "RELEASE");
    for (const item of variants) {
      await repository.releaseInventory(row.id, item, context.admin.id, "管理员操作时发现订单已超时，释放库存");
    }
    await repository.markClosed(row.id);
    await writeAudit(repository, {
      ...auditMeta(context, meta), module: "orders", action: "ORDER_CLOSED_EXPIRED",
      targetType: "ORDER", targetId: row.id, targetLabel: row.order_no,
      before: { status: row.status }, after: { status: "CLOSED" },
    });
  }

  async function confirmOrder(orderId, context, meta) {
    const outcome = await transaction(async (repository) => {
      const row = await repository.findOrder(orderId, true);
      if (!row) fail(ERROR_CODES.ORDER_NOT_FOUND, "Order not found", 404);
      if (row.status === "CONFIRMED") return { type: "IDEMPOTENT" };
      if (row.status !== "PENDING_CONFIRMATION") {
        fail(ERROR_CODES.ORDER_NOT_CONFIRMABLE, "Order cannot be confirmed in its current state", 409, { status: row.status });
      }
      const variants = aggregateVariants(await repository.findOrderVariantsForUpdate(row.id));
      if (isExpired(row)) {
        await closeExpired(repository, row, variants, context, meta);
        return { type: "EXPIRED" };
      }
      assertReserved(variants, "CONFIRM");
      for (const item of variants) await repository.confirmInventory(row.id, item, context.admin.id);
      await repository.increaseProductSales(row.id);
      await repository.markConfirmed(row.id);
      await writeAudit(repository, {
        ...auditMeta(context, meta), module: "orders", action: "ORDER_CONFIRMED",
        targetType: "ORDER", targetId: row.id, targetLabel: row.order_no,
        before: { status: row.status }, after: { status: "CONFIRMED" },
      });
      return { type: "CONFIRMED" };
    });
    if (outcome.type === "EXPIRED") {
      fail(ERROR_CODES.ORDER_NOT_CONFIRMABLE, "Order expired and has been closed", 409, { status: "CLOSED" });
    }
    return { ...(await getOrder(orderId)), idempotentReplay: outcome.type === "IDEMPOTENT" };
  }

  async function cancelOrder(orderId, reason, context, meta) {
    const outcome = await transaction(async (repository) => {
      const row = await repository.findOrder(orderId, true);
      if (!row) fail(ERROR_CODES.ORDER_NOT_FOUND, "Order not found", 404);
      if (row.status === "CANCELLED") return { type: "IDEMPOTENT" };
      if (row.status !== "PENDING_CONFIRMATION") {
        fail(ERROR_CODES.ORDER_NOT_CANCELLABLE, "Order cannot be cancelled in its current state", 409, { status: row.status });
      }
      const variants = aggregateVariants(await repository.findOrderVariantsForUpdate(row.id));
      if (isExpired(row)) {
        await closeExpired(repository, row, variants, context, meta);
        return { type: "EXPIRED" };
      }
      assertReserved(variants, "RELEASE");
      for (const item of variants) await repository.releaseInventory(row.id, item, context.admin.id, reason);
      await repository.markCancelled(row.id, reason);
      await writeAudit(repository, {
        ...auditMeta(context, meta), module: "orders", action: "ORDER_CANCELLED_BY_ADMIN",
        targetType: "ORDER", targetId: row.id, targetLabel: row.order_no,
        before: { status: row.status }, after: { status: "CANCELLED", reason },
      });
      return { type: "CANCELLED" };
    });
    if (outcome.type === "EXPIRED") {
      fail(ERROR_CODES.ORDER_NOT_CANCELLABLE, "Order expired and has been closed", 409, { status: "CLOSED" });
    }
    return { ...(await getOrder(orderId)), idempotentReplay: outcome.type === "IDEMPOTENT" };
  }

  return { getDashboard, getOrders, getOrder, confirmOrder, cancelOrder };
}

module.exports = { createAdminOrderService, adminOrderDto, aggregateVariants };
