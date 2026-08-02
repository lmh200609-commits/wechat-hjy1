const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const { QueryTypes } = require("sequelize");

const env = require("../config/env");
const database = require("../database");
const app = require("../app");
const createUserRepository = require("../repositories/user.repository");
const { createUserService } = require("../services/user.service");
const { createCartService } = require("../services/cart.service");
const { createAddressService } = require("../services/address.service");
const { createFavoriteService } = require("../services/favorite.service");
const { createOrderService } = require("../services/order.service");

function closeServer(server) {
  if (!server) return Promise.resolve();
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

function addressInput(index) {
  return {
    recipientName: `订单验证用户${index}`,
    phone: `139${String(20000000 + index).slice(-8)}`,
    province: "江苏省",
    city: "苏州市",
    district: "姑苏区",
    detail: `平江路订单验证地址 ${index} 号`,
    postalCode: null,
    label: "家",
    isDefault: true,
  };
}

async function variantState(variantId) {
  const rows = await database.sequelize.query(`
    SELECT CAST(on_hand_quantity AS CHAR) AS on_hand_quantity,
           CAST(reserved_quantity AS CHAR) AS reserved_quantity
    FROM product_variants WHERE id = :variantId
  `, { replacements: { variantId }, type: QueryTypes.SELECT });
  return rows[0];
}

async function main() {
  const base = Date.now() * 1000;
  const ids = { category: base + 1, product: base + 2, variant: base + 3 };
  const suffix = crypto.randomBytes(6).toString("hex");
  const openids = [`orders_a_${suffix}`, `orders_b_${suffix}`];
  const orderIds = [];
  let server;
  try {
    assert.ok(env.wechat.cloudEnvId, "WECHAT_CLOUD_ENV_ID is required");
    assert.ok(env.wechat.miniProgramAppId, "WECHAT_MINIPROGRAM_APP_ID is required");
    await database.connect();
    const queryInterface = database.sequelize.getQueryInterface();

    await queryInterface.bulkInsert("categories", [{
      id: ids.category,
      code: `verify-order-category-${base}`,
      dimension: "PRODUCT_CATEGORY",
      name: "订单验证分类",
      icon_text: "订",
      sort_order: 1,
      enabled: true,
    }]);
    await queryInterface.bulkInsert("products", [{
      id: ids.product,
      code: `VERIFY-ORDER-${base}`,
      name: "订单验证器物",
      subtitle: "收藏、结算与订单数据库契约验证",
      category_id: ids.category,
      material_id: null,
      price_amount: 12800,
      currency: "CNY",
      sale_status: "ON_SALE",
      sales_count: 0,
      low_stock_threshold: 2,
      published_at: new Date(),
    }]);
    await queryInterface.bulkInsert("product_variants", [{
      id: ids.variant,
      product_id: ids.product,
      sku_code: `VERIFY-ORDER-SKU-${base}`,
      spec_label: "验证规格",
      price_amount: 12800,
      on_hand_quantity: 10,
      reserved_quantity: 0,
      low_stock_threshold: 2,
      enabled: true,
      sort_order: 1,
      version: 1,
    }]);

    const userService = createUserService(createUserRepository());
    const [userA, userB] = await Promise.all(openids.map((openid) => userService.identify(openid)));
    const cartService = createCartService();
    const addressService = createAddressService();
    const favoriteService = createFavoriteService();
    const orderService = createOrderService();
    const [addressA, addressB] = await Promise.all([
      addressService.createAddress(userA.id, addressInput(1)),
      addressService.createAddress(userB.id, addressInput(2)),
    ]);

    await favoriteService.putFavorite(userA.id, String(ids.product));
    await favoriteService.putFavorite(userA.id, String(ids.product));
    const favorites = await favoriteService.getFavorites(userA.id, { page: 1, pageSize: 20 });
    assert.equal(favorites.total, 1);
    assert.equal(favorites.items[0].id, String(ids.product));
    assert.equal((await favoriteService.getFavorites(userB.id, { page: 1, pageSize: 20 })).total, 0);

    await cartService.addItem(userA.id, {
      productId: String(ids.product), variantId: String(ids.variant), quantity: 2,
    });
    const cartPreview = await orderService.preview(userA.id, { source: "CART", cartItemIds: undefined });
    assert.equal(cartPreview.summary.payableAmount, 25600);
    assert.equal(cartPreview.paymentEnabled, false);
    assert.equal(cartPreview.defaultAddressId, addressA.id);

    const idempotencyKey = `verify-cart-${suffix}-0001`;
    const submissions = await Promise.all([
      orderService.createOrder(userA.id, {
        checkoutToken: cartPreview.checkoutToken,
        addressId: addressA.id,
        remark: "并发幂等验证",
        idempotencyKey,
      }),
      orderService.createOrder(userA.id, {
        checkoutToken: cartPreview.checkoutToken,
        addressId: addressA.id,
        remark: "并发幂等验证",
        idempotencyKey,
      }),
    ]);
    assert.equal(submissions[0].id, submissions[1].id);
    assert.equal(submissions.filter((item) => item.idempotentReplay).length, 1);
    orderIds.push(submissions[0].id);
    assert.equal((await variantState(ids.variant)).reserved_quantity, "2");
    assert.equal((await cartService.getCart(userA.id)).items.length, 0);

    const countRows = await database.sequelize.query(`
      SELECT COUNT(*) AS order_count FROM orders
      WHERE user_id = :userId AND idempotency_key = :idempotencyKey
    `, { replacements: { userId: userA.id, idempotencyKey }, type: QueryTypes.SELECT });
    assert.equal(Number(countRows[0].order_count), 1);
    assert.equal((await orderService.getOrderByNo(userA.id, submissions[0].orderNo)).id, submissions[0].id);
    assert.equal((await orderService.getOrders(userA.id, {
      page: 1, pageSize: 20, status: "PENDING_CONFIRMATION",
    })).total, 1);
    await assert.rejects(orderService.getOrder(userB.id, submissions[0].id), (error) => error.code === "ORDER_NOT_FOUND");

    const cancelled = await orderService.cancelOrder(userA.id, submissions[0].id, "验证取消");
    assert.equal(cancelled.status, "CANCELLED");
    assert.equal((await orderService.cancelOrder(userA.id, submissions[0].id, "重复取消")).status, "CANCELLED");
    assert.equal((await variantState(ids.variant)).reserved_quantity, "0");
    const movementRows = await database.sequelize.query(`
      SELECT reason_type, COUNT(*) AS total FROM inventory_movements
      WHERE reference_type = 'ORDER' AND reference_id = :orderId
      GROUP BY reason_type
    `, { replacements: { orderId: submissions[0].id }, type: QueryTypes.SELECT });
    assert.deepEqual(Object.fromEntries(movementRows.map((row) => [row.reason_type, Number(row.total)])), {
      ORDER_RESERVE: 1,
      ORDER_RELEASE: 1,
    });

    const changedPreview = await orderService.preview(userA.id, {
      source: "BUY_NOW",
      items: [{ productId: String(ids.product), variantId: String(ids.variant), quantity: 1 }],
    });
    await database.sequelize.query(
      "UPDATE product_variants SET price_amount = 12900 WHERE id = :variantId",
      { replacements: { variantId: ids.variant } },
    );
    await assert.rejects(orderService.createOrder(userA.id, {
      checkoutToken: changedPreview.checkoutToken,
      addressId: addressA.id,
      remark: null,
      idempotencyKey: `verify-price-${suffix}-0002`,
    }), (error) => error.code === "CHECKOUT_CHANGED");
    await database.sequelize.query(
      "UPDATE product_variants SET price_amount = 12800, on_hand_quantity = 1 WHERE id = :variantId",
      { replacements: { variantId: ids.variant } },
    );

    const [previewA, previewB] = await Promise.all([
      orderService.preview(userA.id, {
        source: "BUY_NOW",
        items: [{ productId: String(ids.product), variantId: String(ids.variant), quantity: 1 }],
      }),
      orderService.preview(userB.id, {
        source: "BUY_NOW",
        items: [{ productId: String(ids.product), variantId: String(ids.variant), quantity: 1 }],
      }),
    ]);
    const stockRace = await Promise.allSettled([
      orderService.createOrder(userA.id, {
        checkoutToken: previewA.checkoutToken,
        addressId: addressA.id,
        remark: null,
        idempotencyKey: `verify-stock-a-${suffix}`,
      }),
      orderService.createOrder(userB.id, {
        checkoutToken: previewB.checkoutToken,
        addressId: addressB.id,
        remark: null,
        idempotencyKey: `verify-stock-b-${suffix}`,
      }),
    ]);
    assert.equal(stockRace.filter((item) => item.status === "fulfilled").length, 1);
    assert.equal(stockRace.filter((item) => item.status === "rejected").length, 1);
    assert.equal(stockRace.find((item) => item.status === "rejected").reason.code, "CHECKOUT_ITEM_INVALID");
    const winner = stockRace.find((item) => item.status === "fulfilled").value;
    orderIds.push(winner.id);
    assert.equal((await variantState(ids.variant)).reserved_quantity, "1");
    const winnerUser = winner.receiver.phone === addressA.phone ? userA : userB;
    await orderService.cancelOrder(winnerUser.id, winner.id, "并发库存验证清理");
    assert.equal((await variantState(ids.variant)).reserved_quantity, "0");

    await database.sequelize.query(
      "UPDATE product_variants SET on_hand_quantity = 10 WHERE id = :variantId",
      { replacements: { variantId: ids.variant } },
    );
    const expiringPreview = await orderService.preview(userA.id, {
      source: "BUY_NOW",
      items: [{ productId: String(ids.product), variantId: String(ids.variant), quantity: 1 }],
    });
    const expiringOrder = await orderService.createOrder(userA.id, {
      checkoutToken: expiringPreview.checkoutToken,
      addressId: addressA.id,
      remark: null,
      idempotencyKey: `verify-expire-${suffix}`,
    });
    orderIds.push(expiringOrder.id);
    await database.sequelize.query(`
      UPDATE orders SET expires_at = DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 MINUTE)
      WHERE id = :orderId
    `, { replacements: { orderId: expiringOrder.id } });
    const expiration = await orderService.expireOrders(100);
    assert.ok(expiration.closedCount >= 1);
    assert.equal((await orderService.getOrder(userA.id, expiringOrder.id)).status, "CLOSED");
    assert.equal((await variantState(ids.variant)).reserved_quantity, "0");

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const headers = {
      "content-type": "application/json",
      "x-wx-openid": openids[0],
      "x-wx-env": env.wechat.cloudEnvId,
      "x-wx-appid": env.wechat.miniProgramAppId,
      "x-wx-source": "wx_devtools",
    };
    const favoriteResponse = await fetch(`${baseUrl}/api/v1/me/favorites?page=1&pageSize=20`, { headers });
    assert.equal(favoriteResponse.status, 200);
    assert.equal((await favoriteResponse.json()).data.total, 1);
    const invalidIdentityResponse = await fetch(`${baseUrl}/api/v1/me/checkout/preview`, {
      method: "POST",
      headers,
      body: JSON.stringify({ source: "CART", userId: userB.id }),
    });
    assert.equal(invalidIdentityResponse.status, 400);
    const missingIdempotencyResponse = await fetch(`${baseUrl}/api/v1/me/orders`, {
      method: "POST",
      headers,
      body: JSON.stringify({ checkoutToken: "a".repeat(43), addressId: addressA.id }),
    });
    assert.equal(missingIdempotencyResponse.status, 400);
    assert.equal((await missingIdempotencyResponse.json()).code, "IDEMPOTENCY_KEY_REQUIRED");

    console.log("Favorite, checkout, order, idempotency, and inventory database contract verification passed.");
  } catch (error) {
    const reason = error.original?.code || error.code || error.name || "Error";
    console.error(`Order flow database contract verification failed (${reason}).`);
    if (error.stack) console.error(error.stack);
    process.exitCode = 1;
  } finally {
    await closeServer(server).catch(() => {});
    try {
      await database.sequelize.query(`
        DELETE cs FROM checkout_sessions cs INNER JOIN users u ON u.id = cs.user_id
        WHERE u.openid IN (:openids)
      `, { replacements: { openids } });
      await database.sequelize.query(`
        DELETE im FROM inventory_movements im
        WHERE im.reference_type = 'ORDER' AND im.reference_id IN (
          SELECT CAST(o.id AS CHAR) FROM orders o INNER JOIN users u ON u.id = o.user_id
          WHERE u.openid IN (:openids)
        )
      `, { replacements: { openids } });
      await database.sequelize.query(`
        DELETE oi FROM order_items oi INNER JOIN orders o ON o.id = oi.order_id
        INNER JOIN users u ON u.id = o.user_id WHERE u.openid IN (:openids)
      `, { replacements: { openids } });
      await database.sequelize.query(`
        DELETE o FROM orders o INNER JOIN users u ON u.id = o.user_id WHERE u.openid IN (:openids)
      `, { replacements: { openids } });
      await database.sequelize.query(`
        DELETE f FROM favorites f INNER JOIN users u ON u.id = f.user_id WHERE u.openid IN (:openids)
      `, { replacements: { openids } });
      await database.sequelize.query(`
        DELETE ci FROM cart_items ci INNER JOIN users u ON u.id = ci.user_id WHERE u.openid IN (:openids)
      `, { replacements: { openids } });
      await database.sequelize.query(`
        DELETE ua FROM user_addresses ua INNER JOIN users u ON u.id = ua.user_id WHERE u.openid IN (:openids)
      `, { replacements: { openids } });
      await database.sequelize.query("DELETE FROM users WHERE openid IN (:openids)", { replacements: { openids } });
      await database.sequelize.query("DELETE FROM inventory_movements WHERE variant_id = :variantId", { replacements: { variantId: ids.variant } });
      await database.sequelize.query("DELETE FROM product_variants WHERE id = :variantId", { replacements: { variantId: ids.variant } });
      await database.sequelize.query("DELETE FROM products WHERE id = :productId", { replacements: { productId: ids.product } });
      await database.sequelize.query("DELETE FROM categories WHERE id = :categoryId", { replacements: { categoryId: ids.category } });
      const cleanup = await database.sequelize.query(`
        SELECT
          (SELECT COUNT(*) FROM users WHERE openid IN (:openids)) AS users_count,
          (SELECT COUNT(*) FROM products WHERE id = :productId) AS products_count,
          (SELECT COUNT(*) FROM categories WHERE id = :categoryId) AS categories_count
      `, {
        replacements: { openids, productId: ids.product, categoryId: ids.category },
        type: QueryTypes.SELECT,
      });
      assert.deepEqual([
        Number(cleanup[0].users_count),
        Number(cleanup[0].products_count),
        Number(cleanup[0].categories_count),
      ], [0, 0, 0]);
    } catch (error) {
      const reason = error.original?.code || error.code || error.name || "Error";
      console.error(`Order flow verification cleanup failed (${reason}).`);
      process.exitCode = 1;
    }
    await database.close().catch(() => {});
  }
}

main();
