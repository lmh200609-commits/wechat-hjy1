const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const { QueryTypes } = require("sequelize");

const env = require("../config/env");
const database = require("../database");
const app = require("../app");
const { hashPassword } = require("../utils/password");
const { toSqlDateTime } = require("../utils/sql-replacements");
const { scopeHash } = require("../services/admin-auth.service");

function closeServer(server) {
  if (!server) return Promise.resolve();
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

async function jsonRequest(url, { method = "GET", headers = {}, body } = {}) {
  const response = await fetch(url, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { response, body: await response.json() };
}

async function main() {
  const suffix = crypto.randomBytes(5).toString("hex");
  const base = Date.now() * 1000;
  const ids = { category: base + 1, product: base + 2, variant: base + 3 };
  const usernames = [`orders.super.${suffix}`, `orders.content.${suffix}`];
  const password = `Orders#${suffix}Aa1`;
  const adminIds = [];
  const orderIds = [];
  let userId;
  let server;
  try {
    assert.ok(env.wechat.cloudEnvId, "WECHAT_CLOUD_ENV_ID is required");
    assert.ok(env.wechat.miniProgramAppId, "WECHAT_MINIPROGRAM_APP_ID is required");
    await database.connect();
    const roles = await database.sequelize.query(`
      SELECT CAST(id AS CHAR) AS id, code FROM admin_roles
      WHERE code IN ('SUPER_ADMIN', 'CONTENT_EDITOR') AND enabled = 1
    `, { type: QueryTypes.SELECT });
    const roleByCode = new Map(roles.map((row) => [row.code, row.id]));
    assert.equal(roleByCode.size, 2);
    const passwordHash = await hashPassword(password);
    for (let index = 0; index < usernames.length; index += 1) {
      await database.sequelize.query(`
        INSERT INTO admin_users (
          username, password_hash, name, role_id, status, failed_login_attempts,
          password_changed_at, created_at, updated_at
        ) VALUES (
          :username, :passwordHash, :name, :roleId, 'ACTIVE', 0,
          CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
        )
      `, { replacements: {
        username: usernames[index], passwordHash, name: `订单验证管理员${index}`,
        roleId: roleByCode.get(index === 0 ? "SUPER_ADMIN" : "CONTENT_EDITOR"),
      } });
      adminIds.push((await database.sequelize.query("SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id", { type: QueryTypes.SELECT }))[0].id);
    }

    await database.sequelize.query(`
      INSERT INTO users (openid, nickname, status, created_at, updated_at)
      VALUES (:openid, '订单管理验证用户', 'ACTIVE', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
    `, { replacements: { openid: `admin_orders_${suffix}` } });
    userId = (await database.sequelize.query("SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id", { type: QueryTypes.SELECT }))[0].id;
    const queryInterface = database.sequelize.getQueryInterface();
    await queryInterface.bulkInsert("categories", [{
      id: ids.category, code: `admin-orders-category-${base}`, dimension: "PRODUCT_CATEGORY",
      name: `订单分类${suffix.slice(0, 3)}`, icon_text: "订", sort_order: 0, enabled: true,
    }]);
    await queryInterface.bulkInsert("products", [{
      id: ids.product, code: `ADMIN-ORDERS-${base}`, name: "管理订单验证商品",
      subtitle: "确认取消与库存事务验证", category_id: ids.category, price_amount: 12800,
      currency: "CNY", sale_status: "ON_SALE", sales_count: 0,
      low_stock_threshold: 1, version: 1, published_at: new Date(),
    }]);
    await queryInterface.bulkInsert("product_variants", [{
      id: ids.variant, product_id: ids.product, sku_code: `ADMIN-ORDERS-SKU-${base}`,
      spec_label: "验证规格", price_amount: 12800, on_hand_quantity: 10,
      reserved_quantity: 6, low_stock_threshold: 1, enabled: true, sort_order: 0, version: 1,
    }]);

    const orderSpecs = [
      { quantity: 2, expiresAt: new Date(Date.now() + 3600000), suffix: "A" },
      { quantity: 3, expiresAt: new Date(Date.now() + 3600000), suffix: "B" },
      { quantity: 1, expiresAt: new Date(Date.now() - 60000), suffix: "C" },
    ];
    for (const spec of orderSpecs) {
      await database.sequelize.query(`
        INSERT INTO orders (
          order_no, user_id, status, payment_status, fulfillment_status, currency,
          items_amount, discount_amount, shipping_amount, payable_amount, paid_amount,
          item_count, source, remark, receiver_name, receiver_phone, receiver_province,
          receiver_city, receiver_district, receiver_detail, idempotency_key, expires_at,
          created_at, updated_at
        ) VALUES (
          :orderNo, :userId, 'PENDING_CONFIRMATION', 'NOT_ENABLED', 'NOT_APPLICABLE', 'CNY',
          :amount, 0, 0, :amount, 0, :quantity, 'BUY_NOW', '管理订单验证',
          '验证用户', '13900001234', '江苏省', '苏州市', '姑苏区', '平江路验证地址',
          :idempotencyKey, :expiresAt, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
        )
      `, { replacements: {
        orderNo: `WW20260802${suffix.toUpperCase().padEnd(10, "0").slice(0, 10)}${spec.suffix}`,
        userId,
        amount: 12800 * spec.quantity,
        quantity: spec.quantity,
        idempotencyKey: `admin-order-${suffix}-${spec.suffix}`,
        expiresAt: toSqlDateTime(spec.expiresAt),
      } });
      const orderId = (await database.sequelize.query("SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id", { type: QueryTypes.SELECT }))[0].id;
      orderIds.push(orderId);
      await database.sequelize.query(`
        INSERT INTO order_items (
          order_id, product_id, variant_id, product_code_snapshot, product_name_snapshot,
          product_subtitle_snapshot, image_url_snapshot, spec_snapshot,
          unit_price_amount, quantity, subtotal_amount, created_at
        ) VALUES (
          :orderId, :productId, :variantId, :productCode, '管理订单验证商品',
          '确认取消与库存事务验证', NULL, '验证规格', 12800, :quantity, :amount,
          CURRENT_TIMESTAMP(3)
        )
      `, { replacements: {
        orderId, productId: ids.product, variantId: ids.variant,
        productCode: `ADMIN-ORDERS-${base}`, quantity: spec.quantity, amount: 12800 * spec.quantity,
      } });
      await database.sequelize.query(`
        INSERT INTO inventory_movements (
          variant_id, change_quantity, reserved_change, before_quantity, after_quantity,
          before_reserved_quantity, after_reserved_quantity, reason_type,
          reference_type, reference_id, note, operator_id, created_at
        ) VALUES (
          :variantId, 0, :quantity, 10, 10, 0, :quantity, 'ORDER_RESERVE',
          'ORDER', :orderId, '验证预占', NULL, CURRENT_TIMESTAMP(3)
        )
      `, { replacements: { variantId: ids.variant, quantity: spec.quantity, orderId } });
    }

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const gatewayHeaders = {
      "content-type": "application/json",
      "x-wx-env": env.wechat.cloudEnvId,
      "x-wx-appid": env.wechat.miniProgramAppId,
      "x-wx-source": "wx_devtools",
    };
    async function login(username) {
      const result = await jsonRequest(`${baseUrl}/api/admin/auth/login`, {
        method: "POST", headers: gatewayHeaders, body: { username, password },
      });
      assert.equal(result.response.status, 200);
      return { ...gatewayHeaders, authorization: `Bearer ${result.body.data.token}` };
    }
    const authHeaders = await login(usernames[0]);
    const contentHeaders = await login(usernames[1]);

    const denied = await jsonRequest(`${baseUrl}/api/admin/orders`, { headers: contentHeaders });
    assert.equal(denied.response.status, 403);
    assert.equal(denied.body.code, "ADMIN_PERMISSION_DENIED");

    const dashboardBefore = await jsonRequest(`${baseUrl}/api/admin/dashboard`, { headers: authHeaders });
    assert.equal(dashboardBefore.response.status, 200);
    assert.ok(dashboardBefore.body.data.orders.pendingCount >= 3);

    const list = await jsonRequest(`${baseUrl}/api/admin/orders?status=PENDING_CONFIRMATION&keyword=13900001234&page=1&pageSize=20`, { headers: authHeaders });
    assert.equal(list.response.status, 200);
    assert.equal(list.body.data.total, 3);
    assert.equal(list.body.data.items[0].receiver.phone, "13900001234");
    const from = encodeURIComponent(new Date(Date.now() - 5 * 60 * 1000).toISOString());
    const to = encodeURIComponent(new Date(Date.now() + 5 * 60 * 1000).toISOString());
    const dateList = await jsonRequest(`${baseUrl}/api/admin/orders?status=PENDING_CONFIRMATION&from=${from}&to=${to}`, { headers: authHeaders });
    assert.equal(dateList.response.status, 200);
    assert.equal(dateList.body.data.total, 3);
    const detail = await jsonRequest(`${baseUrl}/api/admin/orders/${orderIds[0]}`, { headers: authHeaders });
    assert.equal(detail.response.status, 200);
    assert.equal(detail.body.data.items[0].productName, "管理订单验证商品");

    const confirmed = await jsonRequest(`${baseUrl}/api/admin/orders/${orderIds[0]}/confirm`, {
      method: "POST", headers: authHeaders, body: {},
    });
    assert.equal(confirmed.response.status, 200);
    assert.equal(confirmed.body.data.status, "CONFIRMED");
    assert.equal(confirmed.body.data.paymentStatus, "NOT_ENABLED");
    assert.equal(confirmed.body.data.idempotentReplay, false);
    const confirmedAgain = await jsonRequest(`${baseUrl}/api/admin/orders/${orderIds[0]}/confirm`, {
      method: "POST", headers: authHeaders, body: {},
    });
    assert.equal(confirmedAgain.response.status, 200);
    assert.equal(confirmedAgain.body.data.idempotentReplay, true);

    const cancelled = await jsonRequest(`${baseUrl}/api/admin/orders/${orderIds[1]}/cancel`, {
      method: "POST", headers: authHeaders, body: { reason: "管理员验证取消" },
    });
    assert.equal(cancelled.response.status, 200);
    assert.equal(cancelled.body.data.status, "CANCELLED");
    const cancelledAgain = await jsonRequest(`${baseUrl}/api/admin/orders/${orderIds[1]}/cancel`, {
      method: "POST", headers: authHeaders, body: { reason: "重复请求不应重复释放" },
    });
    assert.equal(cancelledAgain.response.status, 200);
    assert.equal(cancelledAgain.body.data.idempotentReplay, true);

    const expired = await jsonRequest(`${baseUrl}/api/admin/orders/${orderIds[2]}/confirm`, {
      method: "POST", headers: authHeaders, body: {},
    });
    assert.equal(expired.response.status, 409);
    assert.equal(expired.body.code, "ORDER_NOT_CONFIRMABLE");
    assert.equal(expired.body.details.status, "CLOSED");

    const invalidCancel = await jsonRequest(`${baseUrl}/api/admin/orders/${orderIds[0]}/cancel`, {
      method: "POST", headers: authHeaders, body: { reason: "已确认订单不可直接取消" },
    });
    assert.equal(invalidCancel.response.status, 409);
    assert.equal(invalidCancel.body.code, "ORDER_NOT_CANCELLABLE");

    const states = await database.sequelize.query(`
      SELECT CAST(on_hand_quantity AS CHAR) AS on_hand_quantity,
             CAST(reserved_quantity AS CHAR) AS reserved_quantity
      FROM product_variants WHERE id = :variantId
    `, { replacements: { variantId: ids.variant }, type: QueryTypes.SELECT });
    assert.deepEqual([states[0].on_hand_quantity, states[0].reserved_quantity], ["8", "0"]);
    const productRows = await database.sequelize.query(
      "SELECT CAST(sales_count AS CHAR) AS sales_count FROM products WHERE id = :productId",
      { replacements: { productId: ids.product }, type: QueryTypes.SELECT },
    );
    assert.equal(productRows[0].sales_count, "2");

    const movements = await database.sequelize.query(`
      SELECT reason_type, reference_id, COUNT(*) AS total FROM inventory_movements
      WHERE reference_type = 'ORDER' AND reference_id IN (:orderIds)
      GROUP BY reason_type, reference_id
    `, { replacements: { orderIds }, type: QueryTypes.SELECT });
    assert.equal(Number(movements.find((row) => row.reason_type === "ORDER_CONFIRM" && row.reference_id === orderIds[0]).total), 1);
    assert.equal(Number(movements.find((row) => row.reason_type === "ORDER_RELEASE" && row.reference_id === orderIds[1]).total), 1);
    assert.equal(Number(movements.find((row) => row.reason_type === "ORDER_RELEASE" && row.reference_id === orderIds[2]).total), 1);

    const auditRows = await database.sequelize.query(`
      SELECT action, after_json FROM admin_operation_logs
      WHERE admin_user_id = :adminId AND target_id IN (:orderIds)
    `, { replacements: { adminId: adminIds[0], orderIds }, type: QueryTypes.SELECT });
    for (const action of ["ORDER_CONFIRMED", "ORDER_CANCELLED_BY_ADMIN", "ORDER_CLOSED_EXPIRED"]) {
      assert.ok(auditRows.some((row) => row.action === action), `missing audit action ${action}`);
    }
    assert.equal(JSON.stringify(auditRows).includes("13900001234"), false);

    const dashboardAfter = await jsonRequest(`${baseUrl}/api/admin/dashboard`, { headers: authHeaders });
    assert.equal(dashboardAfter.response.status, 200);
    assert.ok(dashboardAfter.body.data.orders.confirmedCount >= 1);

    console.log("Administrator dashboard, order query, confirmation, cancellation, inventory, RBAC, and audit verification passed.");
  } catch (error) {
    const reason = error.original?.code || error.code || error.name || "Error";
    console.error(`Administrator order verification failed (${reason}).`);
    if (error.stack) console.error(error.stack);
    process.exitCode = 1;
  } finally {
    await closeServer(server).catch(() => {});
    try {
      if (orderIds.length) {
        await database.sequelize.query("DELETE FROM inventory_movements WHERE reference_type = 'ORDER' AND reference_id IN (:orderIds)", { replacements: { orderIds } });
        await database.sequelize.query("DELETE FROM order_items WHERE order_id IN (:orderIds)", { replacements: { orderIds } });
        await database.sequelize.query("DELETE FROM orders WHERE id IN (:orderIds)", { replacements: { orderIds } });
      }
      await database.sequelize.query("DELETE FROM inventory_movements WHERE variant_id = :variantId", { replacements: { variantId: ids.variant } });
      await database.sequelize.query("DELETE FROM product_variants WHERE id = :variantId", { replacements: { variantId: ids.variant } });
      await database.sequelize.query("DELETE FROM products WHERE id = :productId", { replacements: { productId: ids.product } });
      await database.sequelize.query("DELETE FROM categories WHERE id = :categoryId", { replacements: { categoryId: ids.category } });
      if (userId) await database.sequelize.query("DELETE FROM users WHERE id = :userId", { replacements: { userId } });
      if (adminIds.length) {
        await database.sequelize.query("DELETE FROM admin_sessions WHERE admin_user_id IN (:adminIds)", { replacements: { adminIds } });
        await database.sequelize.query("DELETE FROM admin_operation_logs WHERE admin_user_id IN (:adminIds)", { replacements: { adminIds } });
        await database.sequelize.query("DELETE FROM admin_users WHERE id IN (:adminIds)", { replacements: { adminIds } });
      }
      const guardHashes = usernames.map((username) => scopeHash(username, "127.0.0.1"));
      await database.sequelize.query("DELETE FROM admin_login_guards WHERE scope_hash IN (:guardHashes)", { replacements: { guardHashes } });
      const cleanup = await database.sequelize.query(`
        SELECT
          (SELECT COUNT(*) FROM orders WHERE id IN (:orderIds)) AS order_count,
          (SELECT COUNT(*) FROM products WHERE id = :productId) AS product_count,
          (SELECT COUNT(*) FROM admin_users WHERE username IN (:usernames)) AS admin_count
      `, {
        replacements: { orderIds: orderIds.length ? orderIds : ["0"], productId: ids.product, usernames },
        type: QueryTypes.SELECT,
      });
      assert.deepEqual([
        Number(cleanup[0].order_count), Number(cleanup[0].product_count), Number(cleanup[0].admin_count),
      ], [0, 0, 0]);
    } catch (error) {
      const reason = error.original?.code || error.code || error.name || "Error";
      console.error(`Administrator order verification cleanup failed (${reason}).`);
      process.exitCode = 1;
    }
    await database.close().catch(() => {});
  }
}

main();
