const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const { QueryTypes } = require("sequelize");

const env = require("../config/env");
const database = require("../database");
const createUserRepository = require("../repositories/user.repository");
const { createUserService } = require("../services/user.service");
const { createCartService } = require("../services/cart.service");
const { createAddressService } = require("../services/address.service");
const app = require("../app");

function closeServer(server) {
  if (!server) return Promise.resolve();
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

function addressInput(index, isDefault = false) {
  return {
    recipientName: `验证用户${index}`,
    phone: `139${String(10000000 + index).slice(-8)}`,
    province: "江苏省",
    city: "苏州市",
    district: "姑苏区",
    detail: `平江路验证地址 ${index} 号`,
    postalCode: null,
    label: index % 2 ? "家" : null,
    isDefault,
  };
}

async function main() {
  const base = Date.now() * 1000;
  const ids = { category: base + 1, product: base + 2, variant: base + 3 };
  const suffix = crypto.randomBytes(6).toString("hex");
  const openids = [`commerce_a_${suffix}`, `commerce_b_${suffix}`];
  let server;
  try {
    assert.ok(env.wechat.cloudEnvId, "WECHAT_CLOUD_ENV_ID is required");
    assert.ok(env.wechat.miniProgramAppId, "WECHAT_MINIPROGRAM_APP_ID is required");
    await database.connect();
    const queryInterface = database.sequelize.getQueryInterface();

    await queryInterface.bulkInsert("categories", [{
      id: ids.category,
      code: `verify-commerce-category-${base}`,
      dimension: "PRODUCT_CATEGORY",
      name: "交易验证分类",
      icon_text: "验",
      sort_order: 1,
      enabled: true,
    }]);
    await queryInterface.bulkInsert("products", [{
      id: ids.product,
      code: `VERIFY-COMMERCE-${base}`,
      name: "交易验证器物",
      subtitle: "购物车与地址数据库契约验证",
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
      sku_code: `VERIFY-COMMERCE-SKU-${base}`,
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

    await cartService.addItem(userA.id, {
      productId: String(ids.product), variantId: String(ids.variant), quantity: 2,
    });
    await Promise.all(Array.from({ length: 4 }, () => cartService.addItem(userA.id, {
      productId: String(ids.product), variantId: String(ids.variant), quantity: 1,
    })));
    let cartA = await cartService.getCart(userA.id);
    assert.equal(cartA.items.length, 1);
    assert.equal(cartA.items[0].quantity, 6);
    assert.equal(cartA.summary.selectedAmount, 76800);
    assert.equal((await cartService.getCart(userB.id)).items.length, 0);

    const cartItemId = cartA.items[0].id;
    cartA = await cartService.updateItem(userA.id, cartItemId, { checked: false });
    assert.equal(cartA.summary.selectedCount, 0);
    cartA = await cartService.setSelection(userA.id, { checked: true, itemIds: [cartItemId] });
    assert.equal(cartA.summary.selectedCount, 6);

    await database.sequelize.query(`
      UPDATE product_variants SET on_hand_quantity = 5 WHERE id = :variantId
    `, { replacements: { variantId: ids.variant } });
    cartA = await cartService.getCart(userA.id);
    assert.equal(cartA.items[0].availabilityReason, "INSUFFICIENT_STOCK");
    await assert.rejects(
      cartService.updateItem(userA.id, cartItemId, { checked: true }),
      (error) => error.code === "CART_QUANTITY_EXCEEDS_STOCK",
    );
    await database.sequelize.query(`
      UPDATE product_variants SET on_hand_quantity = 10 WHERE id = :variantId
    `, { replacements: { variantId: ids.variant } });

    const first = await addressService.createAddress(userA.id, addressInput(1, false));
    assert.equal(first.isDefault, true);
    const second = await addressService.createAddress(userA.id, addressInput(2, true));
    assert.equal(second.isDefault, true);
    let addresses = await addressService.getAddresses(userA.id);
    assert.equal(addresses.items.filter((item) => item.isDefault).length, 1);
    assert.equal(addresses.items.find((item) => item.id === first.id).isDefault, false);

    await Promise.all(Array.from({ length: 18 }, (_, index) => (
      addressService.createAddress(userA.id, addressInput(index + 3, false))
    )));
    addresses = await addressService.getAddresses(userA.id);
    assert.equal(addresses.total, 20);
    await assert.rejects(
      addressService.createAddress(userA.id, addressInput(21, false)),
      (error) => error.code === "ADDRESS_LIMIT_REACHED",
    );
    await assert.rejects(
      addressService.updateAddress(userB.id, first.id, { detail: "越权修改验证地址 100 号" }),
      (error) => error.code === "ADDRESS_NOT_FOUND",
    );
    addresses = await addressService.removeAddress(userA.id, second.id);
    assert.equal(addresses.total, 19);
    assert.equal(addresses.items.filter((item) => item.isDefault).length, 1);

    const summary = await userService.getSummary(userA.id);
    assert.equal(summary.cartCount, 6);
    assert.equal(summary.addressCount, 19);

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const headersA = {
      "content-type": "application/json",
      "x-wx-openid": openids[0],
      "x-wx-env": env.wechat.cloudEnvId,
      "x-wx-appid": env.wechat.miniProgramAppId,
      "x-wx-source": "wx_devtools",
    };
    const headersB = { ...headersA, "x-wx-openid": openids[1] };

    const cartResponse = await fetch(`${baseUrl}/api/v1/me/cart`, { headers: headersA });
    assert.equal(cartResponse.status, 200);
    assert.equal((await cartResponse.json()).data.summary.cartCount, 6);

    const foreignCartResponse = await fetch(`${baseUrl}/api/v1/me/cart`, { headers: headersB });
    assert.equal((await foreignCartResponse.json()).data.items.length, 0);

    const invalidResponse = await fetch(`${baseUrl}/api/v1/me/cart/items`, {
      method: "POST",
      headers: headersA,
      body: JSON.stringify({
        productId: String(ids.product), variantId: String(ids.variant), quantity: 1, userId: userB.id,
      }),
    });
    assert.equal(invalidResponse.status, 400);

    const addressResponse = await fetch(`${baseUrl}/api/v1/me/addresses`, { headers: headersA });
    assert.equal(addressResponse.status, 200);
    assert.equal((await addressResponse.json()).data.total, 19);

    const createAddressResponse = await fetch(`${baseUrl}/api/v1/me/addresses`, {
      method: "POST",
      headers: headersB,
      body: JSON.stringify(addressInput(30, false)),
    });
    assert.equal(createAddressResponse.status, 201);
    assert.equal((await createAddressResponse.json()).data.isDefault, true);

    console.log("Cart and address database contract verification passed.");
  } catch (error) {
    const reason = error.original?.code || error.code || error.name || "Error";
    console.error(`Cart and address database contract verification failed (${reason}).`);
    process.exitCode = 1;
  } finally {
    await closeServer(server).catch(() => {});
    try {
      await database.sequelize.query(`
        DELETE ci FROM cart_items ci INNER JOIN users u ON u.id = ci.user_id
        WHERE u.openid IN (:openids)
      `, { replacements: { openids } });
      await database.sequelize.query(`
        DELETE ua FROM user_addresses ua INNER JOIN users u ON u.id = ua.user_id
        WHERE u.openid IN (:openids)
      `, { replacements: { openids } });
      await database.sequelize.query("DELETE FROM users WHERE openid IN (:openids)", { replacements: { openids } });
      await database.sequelize.query("DELETE FROM product_variants WHERE id = :variantId", { replacements: { variantId: ids.variant } });
      await database.sequelize.query("DELETE FROM products WHERE id = :productId", { replacements: { productId: ids.product } });
      await database.sequelize.query("DELETE FROM categories WHERE id = :categoryId", { replacements: { categoryId: ids.category } });
      const cleanupRows = await database.sequelize.query(`
        SELECT
          (SELECT COUNT(*) FROM users WHERE openid IN (:openids)) AS users_count,
          (SELECT COUNT(*) FROM products WHERE id = :productId) AS products_count,
          (SELECT COUNT(*) FROM categories WHERE id = :categoryId) AS categories_count
      `, {
        replacements: { openids, productId: ids.product, categoryId: ids.category },
        type: QueryTypes.SELECT,
      });
      assert.deepEqual([
        Number(cleanupRows[0].users_count),
        Number(cleanupRows[0].products_count),
        Number(cleanupRows[0].categories_count),
      ], [0, 0, 0]);
    } catch (error) {
      const reason = error.original?.code || error.code || error.name || "Error";
      console.error(`Commerce verification cleanup failed (${reason}).`);
      process.exitCode = 1;
    }
    await database.close().catch(() => {});
  }
}

main();
