const { QueryTypes } = require("sequelize");
const database = require("../database");
const createAdminRepository = require("./admin.repository");
const { normalizeSqlReplacements } = require("../utils/sql-replacements");

function createAdminOrderRepository({ sequelize = database.sequelize, transaction } = {}) {
  function options(replacements = {}, type) {
    return {
      replacements: normalizeSqlReplacements(replacements),
      ...(type ? { type } : {}),
      ...(transaction ? { transaction } : {}),
    };
  }
  const auditRepository = createAdminRepository({ sequelize, transaction });

  const ORDER_FIELDS = `
    CAST(o.id AS CHAR) AS id, o.order_no, CAST(o.user_id AS CHAR) AS user_id,
    o.status, o.payment_status, o.fulfillment_status, o.currency,
    CAST(o.items_amount AS CHAR) AS items_amount,
    CAST(o.discount_amount AS CHAR) AS discount_amount,
    CAST(o.shipping_amount AS CHAR) AS shipping_amount,
    CAST(o.payable_amount AS CHAR) AS payable_amount,
    CAST(o.paid_amount AS CHAR) AS paid_amount,
    CAST(o.item_count AS CHAR) AS item_count, o.source, o.remark,
    o.receiver_name, o.receiver_phone, o.receiver_province, o.receiver_city,
    o.receiver_district, o.receiver_detail, o.cancel_reason, o.expires_at,
    (o.expires_at <= CURRENT_TIMESTAMP(3)) AS is_expired,
    o.created_at, o.updated_at, o.confirmed_at, o.cancelled_at, o.closed_at
  `;

  async function dashboard() {
    const rows = await sequelize.query(`
      SELECT
        (SELECT COUNT(*) FROM users WHERE status = 'ACTIVE') AS user_count,
        (SELECT COUNT(*) FROM products WHERE sale_status <> 'DELETED' AND deleted_at IS NULL) AS product_count,
        (SELECT COUNT(*) FROM products WHERE sale_status = 'ON_SALE' AND deleted_at IS NULL) AS on_sale_product_count,
        (SELECT COUNT(*) FROM products WHERE sale_status = 'DRAFT' AND deleted_at IS NULL) AS draft_product_count,
        (SELECT COUNT(*) FROM product_variants v INNER JOIN products p ON p.id = v.product_id
          WHERE v.enabled = 1 AND p.sale_status <> 'DELETED' AND p.deleted_at IS NULL
            AND v.on_hand_quantity > v.reserved_quantity
            AND v.on_hand_quantity - v.reserved_quantity <= v.low_stock_threshold) AS low_stock_variant_count,
        (SELECT COUNT(*) FROM product_variants v INNER JOIN products p ON p.id = v.product_id
          WHERE v.enabled = 1 AND p.sale_status <> 'DELETED' AND p.deleted_at IS NULL
            AND v.on_hand_quantity - v.reserved_quantity <= 0) AS sold_out_variant_count,
        (SELECT COUNT(*) FROM orders WHERE status = 'PENDING_CONFIRMATION') AS pending_order_count,
        (SELECT COUNT(*) FROM orders WHERE status = 'CONFIRMED') AS confirmed_order_count,
        (SELECT COUNT(*) FROM orders WHERE created_at >= CURRENT_DATE()) AS today_order_count,
        (SELECT COALESCE(SUM(payable_amount), 0) FROM orders
          WHERE status = 'CONFIRMED' AND confirmed_at >= CURRENT_DATE()) AS today_confirmed_amount,
        (SELECT COUNT(*) FROM articles WHERE status = 'PUBLISHED' AND deleted_at IS NULL) AS published_article_count,
        (SELECT COUNT(*) FROM articles WHERE status = 'DRAFT' AND deleted_at IS NULL) AS draft_article_count,
        (SELECT COUNT(*) FROM collections WHERE visible = 1 AND deleted_at IS NULL) AS visible_collection_count,
        (SELECT COUNT(*) FROM banners WHERE visible = 1) AS visible_banner_count
    `, options({}, QueryTypes.SELECT));
    return rows[0];
  }

  async function findOrders(filters) {
    const where = [];
    const replacements = { limit: filters.pageSize, offset: (filters.page - 1) * filters.pageSize };
    if (filters.status !== "ALL") {
      where.push("o.status = :status");
      replacements.status = filters.status;
    }
    if (filters.keyword) {
      where.push("(o.order_no LIKE :keyword ESCAPE '!' OR o.receiver_name LIKE :keyword ESCAPE '!' OR o.receiver_phone LIKE :keyword ESCAPE '!')");
      replacements.keyword = `%${filters.keyword.replace(/!/g, "!!").replace(/%/g, "!%").replace(/_/g, "!_")}%`;
    }
    if (filters.from) {
      where.push("o.created_at >= :from");
      replacements.from = filters.from;
    }
    if (filters.to) {
      where.push("o.created_at <= :to");
      replacements.to = filters.to;
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const rows = await sequelize.query(`
      SELECT ${ORDER_FIELDS} FROM orders o ${whereSql}
      ORDER BY o.created_at DESC, o.id DESC LIMIT :limit OFFSET :offset
    `, options(replacements, QueryTypes.SELECT));
    const countRows = await sequelize.query(
      `SELECT COUNT(*) AS total FROM orders o ${whereSql}`,
      options(replacements, QueryTypes.SELECT),
    );
    return { rows, total: Number(countRows[0]?.total || 0) };
  }

  async function findOrder(orderId, lock = false) {
    const rows = await sequelize.query(`
      SELECT ${ORDER_FIELDS} FROM orders o WHERE o.id = :orderId
      LIMIT 1 ${lock ? "FOR UPDATE" : ""}
    `, options({ orderId }, QueryTypes.SELECT));
    return rows[0] || null;
  }

  async function findOrderItems(orderIds) {
    if (!orderIds.length) return [];
    return sequelize.query(`
      SELECT CAST(id AS CHAR) AS id, CAST(order_id AS CHAR) AS order_id,
             CAST(product_id AS CHAR) AS product_id, CAST(variant_id AS CHAR) AS variant_id,
             product_code_snapshot, product_name_snapshot, product_subtitle_snapshot,
             image_url_snapshot, spec_snapshot,
             CAST(unit_price_amount AS CHAR) AS unit_price_amount,
             CAST(quantity AS CHAR) AS quantity,
             CAST(subtotal_amount AS CHAR) AS subtotal_amount, created_at
      FROM order_items WHERE order_id IN (:orderIds)
      ORDER BY order_id ASC, id ASC
    `, options({ orderIds }, QueryTypes.SELECT));
  }

  async function findOrderVariantsForUpdate(orderId) {
    return sequelize.query(`
      SELECT CAST(oi.variant_id AS CHAR) AS variant_id,
             CAST(oi.product_id AS CHAR) AS product_id,
             CAST(oi.quantity AS CHAR) AS quantity,
             CAST(v.on_hand_quantity AS CHAR) AS on_hand_quantity,
             CAST(v.reserved_quantity AS CHAR) AS reserved_quantity,
             CAST(v.version AS CHAR) AS version
      FROM order_items oi INNER JOIN product_variants v ON v.id = oi.variant_id
      WHERE oi.order_id = :orderId ORDER BY v.id ASC FOR UPDATE
    `, options({ orderId }, QueryTypes.SELECT));
  }

  async function confirmInventory(orderId, item, operatorId) {
    const quantity = Number(item.quantity);
    const beforeQuantity = Number(item.on_hand_quantity);
    const beforeReserved = Number(item.reserved_quantity);
    const afterQuantity = beforeQuantity - quantity;
    const afterReserved = beforeReserved - quantity;
    await sequelize.query(`
      UPDATE product_variants SET on_hand_quantity = :afterQuantity,
        reserved_quantity = :afterReserved, version = version + 1,
        updated_at = CURRENT_TIMESTAMP(3) WHERE id = :variantId
    `, options({ afterQuantity, afterReserved, variantId: item.variant_id }));
    await sequelize.query(`
      INSERT INTO inventory_movements (
        variant_id, change_quantity, reserved_change, before_quantity, after_quantity,
        before_reserved_quantity, after_reserved_quantity, reason_type,
        reference_type, reference_id, note, operator_id, created_at
      ) VALUES (
        :variantId, :changeQuantity, :reservedChange, :beforeQuantity, :afterQuantity,
        :beforeReserved, :afterReserved, 'ORDER_CONFIRM',
        'ORDER', :orderId, '管理员确认订单，预占转为正式扣减', :operatorId, CURRENT_TIMESTAMP(3)
      )
    `, options({
      variantId: item.variant_id,
      changeQuantity: -quantity,
      reservedChange: -quantity,
      beforeQuantity,
      afterQuantity,
      beforeReserved,
      afterReserved,
      orderId,
      operatorId,
    }));
  }

  async function releaseInventory(orderId, item, operatorId, note) {
    const quantity = Number(item.quantity);
    const beforeQuantity = Number(item.on_hand_quantity);
    const beforeReserved = Number(item.reserved_quantity);
    const afterReserved = beforeReserved - quantity;
    await sequelize.query(`
      UPDATE product_variants SET reserved_quantity = :afterReserved,
        version = version + 1, updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = :variantId
    `, options({ afterReserved, variantId: item.variant_id }));
    await sequelize.query(`
      INSERT INTO inventory_movements (
        variant_id, change_quantity, reserved_change, before_quantity, after_quantity,
        before_reserved_quantity, after_reserved_quantity, reason_type,
        reference_type, reference_id, note, operator_id, created_at
      ) VALUES (
        :variantId, 0, :reservedChange, :beforeQuantity, :beforeQuantity,
        :beforeReserved, :afterReserved, 'ORDER_RELEASE',
        'ORDER', :orderId, :note, :operatorId, CURRENT_TIMESTAMP(3)
      )
    `, options({
      variantId: item.variant_id,
      reservedChange: -quantity,
      beforeQuantity,
      beforeReserved,
      afterReserved,
      orderId,
      note,
      operatorId,
    }));
  }

  async function increaseProductSales(orderId) {
    await sequelize.query(`
      UPDATE products p INNER JOIN (
        SELECT product_id, SUM(quantity) AS sold_quantity FROM order_items
        WHERE order_id = :orderId AND product_id IS NOT NULL GROUP BY product_id
      ) sold ON sold.product_id = p.id
      SET p.sales_count = p.sales_count + sold.sold_quantity,
          p.updated_at = CURRENT_TIMESTAMP(3)
    `, options({ orderId }));
  }

  async function markConfirmed(orderId) {
    await sequelize.query(`
      UPDATE orders SET status = 'CONFIRMED', confirmed_at = CURRENT_TIMESTAMP(3),
        updated_at = CURRENT_TIMESTAMP(3) WHERE id = :orderId
    `, options({ orderId }));
  }

  async function markCancelled(orderId, reason) {
    await sequelize.query(`
      UPDATE orders SET status = 'CANCELLED', cancel_reason = :reason,
        cancelled_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = :orderId
    `, options({ orderId, reason }));
  }

  async function markClosed(orderId) {
    await sequelize.query(`
      UPDATE orders SET status = 'CLOSED', cancel_reason = '订单超过 24 小时未确认',
        closed_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = :orderId
    `, options({ orderId }));
  }

  return {
    writeLog: auditRepository.writeLog,
    dashboard,
    findOrders,
    findOrder,
    findOrderItems,
    findOrderVariantsForUpdate,
    confirmInventory,
    releaseInventory,
    increaseProductSales,
    markConfirmed,
    markCancelled,
    markClosed,
  };
}

module.exports = createAdminOrderRepository;
