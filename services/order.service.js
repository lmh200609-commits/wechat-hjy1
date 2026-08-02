const crypto = require("node:crypto");
const database = require("../database");
const AppError = require("../errors/app-error");
const ERROR_CODES = require("../constants/error-codes");
const createOrderRepository = require("../repositories/order.repository");
const { createAddressService } = require("./address.service");

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function iso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function candidateReason(row, quantity) {
  if (
    row.product_deleted_at
    || row.sale_status !== "ON_SALE"
    || !Boolean(row.category_enabled)
    || row.category_dimension !== "PRODUCT_CATEGORY"
    || !Boolean(row.material_enabled)
    || (row.material_dimension && row.material_dimension !== "MATERIAL")
  ) return "PRODUCT_OFF_SHELF";
  if (!Boolean(row.variant_enabled)) return "VARIANT_DISABLED";
  const available = number(row.on_hand_quantity) - number(row.reserved_quantity);
  if (available <= 0) return "OUT_OF_STOCK";
  if (quantity > available) return "INSUFFICIENT_STOCK";
  return null;
}

function assertCandidate(row, quantity) {
  if (!row) {
    throw new AppError({
      code: ERROR_CODES.CHECKOUT_ITEM_INVALID,
      message: "Checkout item was not found",
      statusCode: 409,
    });
  }
  const reason = candidateReason(row, quantity);
  if (reason) {
    throw new AppError({
      code: ERROR_CODES.CHECKOUT_ITEM_INVALID,
      message: "Checkout item is no longer available",
      statusCode: 409,
      details: {
        reason,
        productId: row.product_id,
        variantId: row.variant_id,
        availableQuantity: Math.max(0, number(row.on_hand_quantity) - number(row.reserved_quantity)),
      },
    });
  }
}

function checkoutItem(row, quantity) {
  return {
    cartItemId: row.cart_item_id || null,
    productId: row.product_id,
    variantId: row.variant_id,
    quantity,
    priceAmount: number(row.price_amount),
    variantVersion: number(row.variant_version),
    specLabel: row.spec_label === "默认规格" ? "" : row.spec_label,
    productName: row.product_name,
    productSubtitle: row.product_subtitle,
    primaryImageUrl: row.primary_image_url || null,
    subtotalAmount: number(row.price_amount) * quantity,
  };
}

function mapOrder(row, items) {
  return {
    id: row.id,
    orderNo: row.order_no,
    status: row.status,
    paymentStatus: row.payment_status,
    fulfillmentStatus: row.fulfillment_status,
    currency: row.currency,
    itemsAmount: number(row.items_amount),
    discountAmount: number(row.discount_amount),
    shippingAmount: number(row.shipping_amount),
    payableAmount: number(row.payable_amount),
    paidAmount: number(row.paid_amount),
    itemCount: number(row.item_count),
    source: row.source,
    remark: row.remark || "",
    receiver: {
      recipientName: row.receiver_name,
      phone: row.receiver_phone,
      province: row.receiver_province,
      city: row.receiver_city,
      district: row.receiver_district,
      region: [row.receiver_province, row.receiver_city, row.receiver_district].join(" "),
      detail: row.receiver_detail,
    },
    items: items.map((item) => ({
      id: item.id,
      productId: item.product_id,
      variantId: item.variant_id,
      productCode: item.product_code_snapshot,
      productName: item.product_name_snapshot,
      productSubtitle: item.product_subtitle_snapshot || "",
      productImageUrl: item.image_url_snapshot || null,
      specLabel: item.spec_snapshot || "",
      unitPriceAmount: number(item.unit_price_amount),
      quantity: number(item.quantity),
      subtotalAmount: number(item.subtotal_amount),
    })),
    cancellable: row.status === "PENDING_CONFIRMATION",
    cancelReason: row.cancel_reason || null,
    expiresAt: iso(row.expires_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    confirmedAt: iso(row.confirmed_at),
    cancelledAt: iso(row.cancelled_at),
    closedAt: iso(row.closed_at),
  };
}

function createOrderService({
  sequelize = database.sequelize,
  repositoryFactory = createOrderRepository,
  addressService = createAddressService(),
} = {}) {
  const repo = () => repositoryFactory({ sequelize });
  const inTransaction = (work) => sequelize.transaction(
    async (transaction) => work(repositoryFactory({ sequelize, transaction })),
  );

  async function preview(userId, input) {
    const token = crypto.randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const items = await inTransaction(async (repository) => {
      let rows;
      let normalized;
      if (input.source === "CART") {
        rows = await repository.findCartCandidates(userId, input.cartItemIds);
        if (input.cartItemIds && rows.length !== input.cartItemIds.length) {
          throw new AppError({
            code: ERROR_CODES.CHECKOUT_ITEM_INVALID,
            message: "One or more cart items were not found",
            statusCode: 409,
          });
        }
        normalized = rows.map((row) => ({ row, quantity: number(row.quantity) }));
      } else {
        rows = await repository.findVariantCandidates(input.items.map((item) => item.variantId));
        const byVariant = new Map(rows.map((row) => [row.variant_id, row]));
        normalized = input.items.map((item) => ({
          row: byVariant.get(item.variantId),
          quantity: item.quantity,
          expectedProductId: item.productId,
        }));
      }
      if (!normalized.length) {
        throw new AppError({
          code: ERROR_CODES.CHECKOUT_EMPTY,
          message: "No items were selected for checkout",
          statusCode: 409,
        });
      }
      const mapped = normalized.map(({ row, quantity, expectedProductId }) => {
        if (expectedProductId && row?.product_id !== expectedProductId) row = null;
        assertCandidate(row, quantity);
        return checkoutItem(row, quantity);
      });
      const itemsAmount = mapped.reduce((sum, item) => sum + item.subtotalAmount, 0);
      const itemCount = mapped.reduce((sum, item) => sum + item.quantity, 0);
      const sessionId = await repository.insertCheckoutSession({
        userId,
        tokenHash: hashToken(token),
        source: input.source,
        itemsAmount,
        itemCount,
        expiresAt,
      });
      await repository.insertCheckoutItems(sessionId, mapped);
      return mapped;
    });
    const itemsAmount = items.reduce((sum, item) => sum + item.subtotalAmount, 0);
    const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
    const addresses = await addressService.getAddresses(userId);
    return {
      checkoutToken: token,
      source: input.source,
      items,
      summary: { itemsAmount, discountAmount: 0, shippingAmount: 0, payableAmount: itemsAmount, itemCount, currency: "CNY" },
      addresses: addresses.items,
      defaultAddressId: addresses.items.find((item) => item.isDefault)?.id || null,
      expiresAt: expiresAt.toISOString(),
      paymentEnabled: false,
    };
  }

  function generateOrderNo() {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    return `WW${date}${crypto.randomBytes(6).toString("hex").toUpperCase()}`;
  }

  async function createOrder(userId, input) {
    const result = await inTransaction(async (repository) => {
      await repository.lockUser(userId);
      const existing = await repository.findOrderByIdempotency(userId, input.idempotencyKey);
      if (existing) return { orderId: existing.id, reused: true };

      const session = await repository.findCheckoutSessionForUpdate(userId, hashToken(input.checkoutToken));
      if (!session || session.status !== "ACTIVE" || Number(session.is_expired) === 1) {
        throw new AppError({
          code: ERROR_CODES.CHECKOUT_TOKEN_INVALID,
          message: "Checkout session is invalid or expired",
          statusCode: 409,
        });
      }
      const address = await repository.findAddressForUpdate(userId, input.addressId);
      if (!address) {
        throw new AppError({ code: ERROR_CODES.ADDRESS_NOT_FOUND, message: "Address was not found", statusCode: 404 });
      }
      const items = await repository.findCheckoutItemsForUpdate(session.id);
      if (!items.length) {
        throw new AppError({ code: ERROR_CODES.CHECKOUT_EMPTY, message: "Checkout session has no items", statusCode: 409 });
      }
      for (const item of items) {
        const quantity = number(item.quantity);
        assertCandidate(item, quantity);
        if (number(item.price_amount) !== number(item.quoted_price_amount)) {
          throw new AppError({
            code: ERROR_CODES.CHECKOUT_CHANGED,
            message: "Product price changed; refresh checkout before ordering",
            statusCode: 409,
            details: { productId: item.product_id, variantId: item.variant_id },
          });
        }
      }
      const itemsAmount = items.reduce((sum, item) => sum + number(item.price_amount) * number(item.quantity), 0);
      const itemCount = items.reduce((sum, item) => sum + number(item.quantity), 0);
      const orderId = await repository.insertOrder({
        orderNo: generateOrderNo(),
        userId,
        itemsAmount,
        itemCount,
        source: session.source,
        remark: input.remark || null,
        receiverName: address.recipient_name,
        receiverPhone: address.phone,
        receiverProvince: address.province,
        receiverCity: address.city,
        receiverDistrict: address.district,
        receiverDetail: address.detail,
        idempotencyKey: input.idempotencyKey,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
      for (const item of items) {
        const quantity = number(item.quantity);
        const priceAmount = number(item.price_amount);
        await repository.insertOrderItem(orderId, {
          productId: item.product_id,
          variantId: item.variant_id,
          productCode: item.product_code,
          productName: item.product_name,
          productSubtitle: item.product_subtitle || null,
          imageUrl: item.primary_image_url || null,
          specLabel: item.spec_label === "默认规格" ? null : item.spec_label,
          priceAmount,
          quantity,
          subtotalAmount: priceAmount * quantity,
        });
        await repository.reserveInventory(orderId, item);
      }
      await repository.consumeCheckout(session.id, orderId);
      if (session.source === "CART") {
        await repository.removePurchasedCartItems(userId, items.map((item) => item.cart_item_id).filter(Boolean));
      }
      return { orderId, reused: false };
    });
    const order = await getOrder(userId, result.orderId);
    return { ...order, idempotentReplay: result.reused };
  }

  async function attachItems(repository, rows) {
    const allItems = await repository.findOrderItems(rows.map((row) => row.id));
    const byOrder = new Map();
    for (const item of allItems) {
      if (!byOrder.has(item.order_id)) byOrder.set(item.order_id, []);
      byOrder.get(item.order_id).push(item);
    }
    return rows.map((row) => mapOrder(row, byOrder.get(row.id) || []));
  }

  async function getOrders(userId, filters) {
    const repository = repo();
    const result = await repository.findOrders(userId, filters);
    return {
      items: await attachItems(repository, result.rows),
      page: filters.page,
      pageSize: filters.pageSize,
      total: result.total,
      hasMore: filters.page * filters.pageSize < result.total,
    };
  }

  async function getOrder(userId, orderId) {
    const repository = repo();
    const row = await repository.findOrder(userId, { orderId });
    if (!row) throw new AppError({ code: ERROR_CODES.ORDER_NOT_FOUND, message: "Order was not found", statusCode: 404 });
    return (await attachItems(repository, [row]))[0];
  }

  async function getOrderByNo(userId, orderNo) {
    const repository = repo();
    const row = await repository.findOrder(userId, { orderNo });
    if (!row) throw new AppError({ code: ERROR_CODES.ORDER_NOT_FOUND, message: "Order was not found", statusCode: 404 });
    return (await attachItems(repository, [row]))[0];
  }

  async function cancelOrder(userId, orderId, reason) {
    const resolvedId = await inTransaction(async (repository) => {
      await repository.lockUser(userId);
      const order = await repository.findOrder(userId, { orderId }, true);
      if (!order) throw new AppError({ code: ERROR_CODES.ORDER_NOT_FOUND, message: "Order was not found", statusCode: 404 });
      if (["CANCELLED", "CLOSED"].includes(order.status)) return order.id;
      if (order.status !== "PENDING_CONFIRMATION") {
        throw new AppError({
          code: ERROR_CODES.ORDER_NOT_CANCELLABLE,
          message: "Order cannot be cancelled in its current status",
          statusCode: 409,
        });
      }
      const variants = await repository.findOrderVariantsForUpdate(order.id);
      for (const item of variants) {
        if (number(item.reserved_quantity) < number(item.quantity)) {
          throw new AppError({
            code: ERROR_CODES.INTERNAL_ERROR,
            message: "Reserved inventory is inconsistent",
            statusCode: 500,
          });
        }
        await repository.releaseInventory(order.id, item);
      }
      await repository.markCancelled(userId, order.id, reason || "用户取消");
      return order.id;
    });
    return getOrder(userId, resolvedId);
  }

  async function expireOrders(limit = 100) {
    const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
    const candidates = await repo().findExpiredPendingOrders(safeLimit);
    let closedCount = 0;
    for (const candidate of candidates) {
      const closed = await inTransaction(async (repository) => {
        await repository.lockUser(candidate.user_id);
        const order = await repository.findOrder(candidate.user_id, { orderId: candidate.id }, true);
        if (!order || order.status !== "PENDING_CONFIRMATION" || Number(order.is_expired) !== 1) {
          return false;
        }
        const variants = await repository.findOrderVariantsForUpdate(order.id);
        for (const item of variants) {
          if (number(item.reserved_quantity) < number(item.quantity)) {
            throw new AppError({
              code: ERROR_CODES.INTERNAL_ERROR,
              message: "Reserved inventory is inconsistent",
              statusCode: 500,
            });
          }
          await repository.releaseInventory(order.id, item, "订单超时关闭释放库存");
        }
        await repository.markClosed(order.id, "订单超过 24 小时未确认");
        return true;
      });
      if (closed) closedCount += 1;
    }
    const expiredCheckoutCount = await repo().expireCheckoutSessions();
    return { scannedCount: candidates.length, closedCount, expiredCheckoutCount };
  }

  return { preview, createOrder, getOrders, getOrder, getOrderByNo, cancelOrder, expireOrders };
}

module.exports = { createOrderService, mapOrder, candidateReason, hashToken };
