const { QueryTypes } = require("sequelize");
const database = require("../database");
const { normalizeSqlReplacements } = require("../utils/sql-replacements");

function createOrderRepository({ sequelize = database.sequelize, transaction } = {}) {
  function options(replacements = {}, type) {
    return {
      replacements: normalizeSqlReplacements(replacements),
      ...(type ? { type } : {}),
      ...(transaction ? { transaction } : {}),
    };
  }

  async function lockUser(userId) {
    await sequelize.query("SELECT id FROM users WHERE id = :userId LIMIT 1 FOR UPDATE", options({ userId }, QueryTypes.SELECT));
  }

  const CANDIDATE_FIELDS = `
    CAST(p.id AS CHAR) AS product_id, p.code AS product_code, p.name AS product_name,
    p.subtitle AS product_subtitle, p.sale_status, p.deleted_at AS product_deleted_at,
    c.enabled AS category_enabled, c.dimension AS category_dimension,
    COALESCE(m.enabled, 1) AS material_enabled, m.dimension AS material_dimension,
    CAST(v.id AS CHAR) AS variant_id, v.spec_label, CAST(v.price_amount AS CHAR) AS price_amount,
    CAST(v.on_hand_quantity AS CHAR) AS on_hand_quantity,
    CAST(v.reserved_quantity AS CHAR) AS reserved_quantity,
    CAST(v.version AS CHAR) AS variant_version, v.enabled AS variant_enabled,
    media.url AS primary_image_url
  `;

  const CANDIDATE_JOINS = `
    INNER JOIN products p ON p.id = v.product_id
    INNER JOIN categories c ON c.id = p.category_id
    LEFT JOIN categories m ON m.id = p.material_id
    LEFT JOIN product_images pi ON pi.id = (
      SELECT candidate.id FROM product_images candidate
      WHERE candidate.product_id = p.id AND candidate.kind = 'PRIMARY'
      ORDER BY candidate.sort_order ASC, candidate.id ASC LIMIT 1
    )
    LEFT JOIN media_assets media ON media.id = pi.media_id AND media.status = 'ACTIVE'
  `;

  async function findCartCandidates(userId, itemIds) {
    const idFilter = itemIds === undefined ? " AND ci.checked = 1" : " AND ci.id IN (:itemIds)";
    return sequelize.query(`
      SELECT CAST(ci.id AS CHAR) AS cart_item_id, CAST(ci.quantity AS CHAR) AS quantity,
             ${CANDIDATE_FIELDS}
      FROM cart_items ci
      INNER JOIN product_variants v ON v.id = ci.variant_id AND v.product_id = ci.product_id
      ${CANDIDATE_JOINS}
      WHERE ci.user_id = :userId${idFilter}
      ORDER BY v.id ASC
    `, options({ userId, itemIds: itemIds || [] }, QueryTypes.SELECT));
  }

  async function findVariantCandidates(variantIds) {
    return sequelize.query(`
      SELECT NULL AS cart_item_id, ${CANDIDATE_FIELDS}
      FROM product_variants v
      ${CANDIDATE_JOINS}
      WHERE v.id IN (:variantIds)
      ORDER BY v.id ASC
    `, options({ variantIds }, QueryTypes.SELECT));
  }

  async function insertCheckoutSession(input) {
    await sequelize.query(`
      INSERT INTO checkout_sessions (
        user_id, token_hash, source, status, quoted_items_amount, quoted_item_count, expires_at, created_at
      ) VALUES (
        :userId, :tokenHash, :source, 'ACTIVE', :itemsAmount, :itemCount, :expiresAt, CURRENT_TIMESTAMP(3)
      )
    `, options(input));
    const rows = await sequelize.query("SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id", options({}, QueryTypes.SELECT));
    return rows[0].id;
  }

  async function insertCheckoutItems(sessionId, items) {
    for (const item of items) {
      await sequelize.query(`
        INSERT INTO checkout_session_items (
          checkout_session_id, cart_item_id, product_id, variant_id, quantity,
          quoted_unit_price_amount, quoted_variant_version, created_at
        ) VALUES (
          :sessionId, :cartItemId, :productId, :variantId, :quantity,
          :priceAmount, :variantVersion, CURRENT_TIMESTAMP(3)
        )
      `, options({ sessionId, ...item }));
    }
  }

  async function findOrderByIdempotency(userId, idempotencyKey) {
    const rows = await sequelize.query(`
      SELECT CAST(id AS CHAR) AS id FROM orders
      WHERE user_id = :userId AND idempotency_key = :idempotencyKey
      LIMIT 1
    `, options({ userId, idempotencyKey }, QueryTypes.SELECT));
    return rows[0] || null;
  }

  async function findCheckoutSessionForUpdate(userId, tokenHash) {
    const rows = await sequelize.query(`
      SELECT CAST(id AS CHAR) AS id, source, status, expires_at,
             (expires_at <= CURRENT_TIMESTAMP(3)) AS is_expired,
             CAST(consumed_order_id AS CHAR) AS consumed_order_id
      FROM checkout_sessions
      WHERE user_id = :userId AND token_hash = :tokenHash
      LIMIT 1 FOR UPDATE
    `, options({ userId, tokenHash }, QueryTypes.SELECT));
    return rows[0] || null;
  }

  async function findCheckoutItemsForUpdate(sessionId) {
    return sequelize.query(`
      SELECT CAST(csi.id AS CHAR) AS checkout_item_id, CAST(csi.cart_item_id AS CHAR) AS cart_item_id,
             CAST(csi.quantity AS CHAR) AS quantity,
             CAST(csi.quoted_unit_price_amount AS CHAR) AS quoted_price_amount,
             CAST(csi.quoted_variant_version AS CHAR) AS quoted_variant_version,
             ${CANDIDATE_FIELDS}
      FROM checkout_session_items csi
      INNER JOIN product_variants v ON v.id = csi.variant_id AND v.product_id = csi.product_id
      ${CANDIDATE_JOINS}
      WHERE csi.checkout_session_id = :sessionId
      ORDER BY v.id ASC
      FOR UPDATE
    `, options({ sessionId }, QueryTypes.SELECT));
  }

  async function findAddressForUpdate(userId, addressId) {
    const rows = await sequelize.query(`
      SELECT CAST(id AS CHAR) AS id, recipient_name, phone, province, city, district, detail
      FROM user_addresses
      WHERE id = :addressId AND user_id = :userId AND deleted_at IS NULL
      LIMIT 1 FOR UPDATE
    `, options({ userId, addressId }, QueryTypes.SELECT));
    return rows[0] || null;
  }

  async function insertOrder(input) {
    await sequelize.query(`
      INSERT INTO orders (
        order_no, user_id, status, payment_status, fulfillment_status, currency,
        items_amount, discount_amount, shipping_amount, payable_amount, paid_amount, item_count,
        source, remark, receiver_name, receiver_phone, receiver_province, receiver_city,
        receiver_district, receiver_detail, idempotency_key, expires_at, created_at, updated_at
      ) VALUES (
        :orderNo, :userId, 'PENDING_CONFIRMATION', 'NOT_ENABLED', 'NOT_APPLICABLE', 'CNY',
        :itemsAmount, 0, 0, :itemsAmount, 0, :itemCount,
        :source, :remark, :receiverName, :receiverPhone, :receiverProvince, :receiverCity,
        :receiverDistrict, :receiverDetail, :idempotencyKey, :expiresAt,
        CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
      )
    `, options(input));
    const rows = await sequelize.query("SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id", options({}, QueryTypes.SELECT));
    return rows[0].id;
  }

  async function insertOrderItem(orderId, item) {
    await sequelize.query(`
      INSERT INTO order_items (
        order_id, product_id, variant_id, product_code_snapshot, product_name_snapshot,
        product_subtitle_snapshot, image_url_snapshot, spec_snapshot, unit_price_amount,
        quantity, subtotal_amount, created_at
      ) VALUES (
        :orderId, :productId, :variantId, :productCode, :productName,
        :productSubtitle, :imageUrl, :specLabel, :priceAmount,
        :quantity, :subtotalAmount, CURRENT_TIMESTAMP(3)
      )
    `, options({ orderId, ...item }));
  }

  async function reserveInventory(orderId, item) {
    const beforeQuantity = Number(item.on_hand_quantity);
    const beforeReserved = Number(item.reserved_quantity);
    const afterReserved = beforeReserved + Number(item.quantity);
    await sequelize.query(`
      UPDATE product_variants
      SET reserved_quantity = :afterReserved, version = version + 1, updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = :variantId
    `, options({ afterReserved, variantId: item.variant_id }));
    await sequelize.query(`
      INSERT INTO inventory_movements (
        variant_id, change_quantity, reserved_change, before_quantity, after_quantity,
        before_reserved_quantity, after_reserved_quantity, reason_type,
        reference_type, reference_id, note, operator_id, created_at
      ) VALUES (
        :variantId, 0, :reservedChange, :beforeQuantity, :beforeQuantity,
        :beforeReserved, :afterReserved, 'ORDER_RESERVE',
        'ORDER', :orderId, '用户提交订单预占库存', NULL, CURRENT_TIMESTAMP(3)
      )
    `, options({
      variantId: item.variant_id,
      reservedChange: Number(item.quantity),
      beforeQuantity,
      beforeReserved,
      afterReserved,
      orderId,
    }));
  }

  async function consumeCheckout(sessionId, orderId) {
    await sequelize.query(`
      UPDATE checkout_sessions
      SET status = 'CONSUMED', consumed_order_id = :orderId, consumed_at = CURRENT_TIMESTAMP(3)
      WHERE id = :sessionId
    `, options({ sessionId, orderId }));
  }

  async function removePurchasedCartItems(userId, itemIds) {
    if (!itemIds.length) return;
    await sequelize.query(
      "DELETE FROM cart_items WHERE user_id = :userId AND id IN (:itemIds)",
      options({ userId, itemIds }),
    );
  }

  const ORDER_FIELDS = `
    CAST(o.id AS CHAR) AS id, o.order_no, o.status, o.payment_status, o.fulfillment_status,
    o.currency, CAST(o.items_amount AS CHAR) AS items_amount,
    CAST(o.discount_amount AS CHAR) AS discount_amount,
    CAST(o.shipping_amount AS CHAR) AS shipping_amount,
    CAST(o.payable_amount AS CHAR) AS payable_amount,
    CAST(o.paid_amount AS CHAR) AS paid_amount, CAST(o.item_count AS CHAR) AS item_count,
    o.source, o.remark, o.receiver_name, o.receiver_phone, o.receiver_province,
    o.receiver_city, o.receiver_district, o.receiver_detail, o.cancel_reason,
    o.expires_at, (o.expires_at <= CURRENT_TIMESTAMP(3)) AS is_expired,
    o.created_at, o.updated_at, o.confirmed_at, o.cancelled_at, o.closed_at
  `;

  async function findOrder(userId, { orderId, orderNo } = {}, lock = false) {
    const filter = orderId ? "o.id = :orderId" : "o.order_no = :orderNo";
    const rows = await sequelize.query(`
      SELECT ${ORDER_FIELDS} FROM orders o
      WHERE o.user_id = :userId AND ${filter}
      LIMIT 1 ${lock ? "FOR UPDATE" : ""}
    `, options({ userId, orderId, orderNo }, QueryTypes.SELECT));
    return rows[0] || null;
  }

  async function findOrders(userId, { page, pageSize, status }) {
    const statusFilter = status === "ALL" ? "" : " AND o.status = :status";
    const offset = (page - 1) * pageSize;
    const rows = await sequelize.query(`
      SELECT ${ORDER_FIELDS} FROM orders o
      WHERE o.user_id = :userId${statusFilter}
      ORDER BY o.created_at DESC, o.id DESC
      LIMIT :limit OFFSET :offset
    `, options({ userId, status, limit: pageSize, offset }, QueryTypes.SELECT));
    const countRows = await sequelize.query(`
      SELECT COUNT(*) AS total FROM orders o WHERE o.user_id = :userId${statusFilter}
    `, options({ userId, status }, QueryTypes.SELECT));
    return { rows, total: Number(countRows[0]?.total || 0) };
  }

  async function findOrderItems(orderIds) {
    if (!orderIds.length) return [];
    return sequelize.query(`
      SELECT CAST(id AS CHAR) AS id, CAST(order_id AS CHAR) AS order_id,
             CAST(product_id AS CHAR) AS product_id, CAST(variant_id AS CHAR) AS variant_id,
             product_code_snapshot, product_name_snapshot, product_subtitle_snapshot,
             image_url_snapshot, spec_snapshot, CAST(unit_price_amount AS CHAR) AS unit_price_amount,
             CAST(quantity AS CHAR) AS quantity, CAST(subtotal_amount AS CHAR) AS subtotal_amount,
             created_at
      FROM order_items WHERE order_id IN (:orderIds)
      ORDER BY order_id ASC, id ASC
    `, options({ orderIds }, QueryTypes.SELECT));
  }

  async function releaseInventory(orderId, item, note = "用户取消订单释放库存") {
    const beforeQuantity = Number(item.on_hand_quantity);
    const beforeReserved = Number(item.reserved_quantity);
    const released = Number(item.quantity);
    const afterReserved = beforeReserved - released;
    await sequelize.query(`
      UPDATE product_variants
      SET reserved_quantity = :afterReserved, version = version + 1, updated_at = CURRENT_TIMESTAMP(3)
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
        'ORDER', :orderId, :note, NULL, CURRENT_TIMESTAMP(3)
      )
    `, options({
      variantId: item.variant_id,
      reservedChange: -released,
      beforeQuantity,
      beforeReserved,
      afterReserved,
      orderId,
      note,
    }));
  }

  async function findOrderVariantsForUpdate(orderId) {
    return sequelize.query(`
      SELECT CAST(oi.variant_id AS CHAR) AS variant_id, CAST(oi.quantity AS CHAR) AS quantity,
             CAST(v.on_hand_quantity AS CHAR) AS on_hand_quantity,
             CAST(v.reserved_quantity AS CHAR) AS reserved_quantity
      FROM order_items oi
      INNER JOIN product_variants v ON v.id = oi.variant_id
      WHERE oi.order_id = :orderId
      ORDER BY v.id ASC FOR UPDATE
    `, options({ orderId }, QueryTypes.SELECT));
  }

  async function markCancelled(userId, orderId, reason) {
    await sequelize.query(`
      UPDATE orders SET status = 'CANCELLED', cancel_reason = :reason,
        cancelled_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = :orderId AND user_id = :userId
    `, options({ userId, orderId, reason }));
  }

  async function findExpiredPendingOrders(limit) {
    return sequelize.query(`
      SELECT CAST(id AS CHAR) AS id, CAST(user_id AS CHAR) AS user_id
      FROM orders
      WHERE status = 'PENDING_CONFIRMATION' AND expires_at <= CURRENT_TIMESTAMP(3)
      ORDER BY expires_at ASC, id ASC
      LIMIT :limit
    `, options({ limit }, QueryTypes.SELECT));
  }

  async function markClosed(orderId, reason) {
    await sequelize.query(`
      UPDATE orders SET status = 'CLOSED', cancel_reason = :reason,
        closed_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = :orderId AND status = 'PENDING_CONFIRMATION'
    `, options({ orderId, reason }));
  }

  async function expireCheckoutSessions() {
    const [, metadata] = await sequelize.query(`
      UPDATE checkout_sessions SET status = 'EXPIRED'
      WHERE status = 'ACTIVE' AND expires_at <= CURRENT_TIMESTAMP(3)
    `, options());
    return Number(metadata?.affectedRows || 0);
  }

  return {
    lockUser,
    findCartCandidates,
    findVariantCandidates,
    insertCheckoutSession,
    insertCheckoutItems,
    findOrderByIdempotency,
    findCheckoutSessionForUpdate,
    findCheckoutItemsForUpdate,
    findAddressForUpdate,
    insertOrder,
    insertOrderItem,
    reserveInventory,
    consumeCheckout,
    removePurchasedCartItems,
    findOrder,
    findOrders,
    findOrderItems,
    findOrderVariantsForUpdate,
    releaseInventory,
    markCancelled,
    findExpiredPendingOrders,
    markClosed,
    expireCheckoutSessions,
  };
}

module.exports = createOrderRepository;
