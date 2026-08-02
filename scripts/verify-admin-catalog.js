const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const { QueryTypes } = require("sequelize");

const env = require("../config/env");
const database = require("../database");
const app = require("../app");
const { hashPassword } = require("../utils/password");
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
  const usernames = [`catalog.super.${suffix}`, `catalog.content.${suffix}`];
  const password = `Catalog#${suffix}Aa1`;
  const adminIds = [];
  const categoryIds = [];
  const productIds = [];
  const mediaIds = [];
  let server;
  try {
    assert.ok(env.wechat.cloudEnvId, "WECHAT_CLOUD_ENV_ID is required");
    assert.ok(env.wechat.miniProgramAppId, "WECHAT_MINIPROGRAM_APP_ID is required");
    await database.connect();
    const roles = await database.sequelize.query(`
      SELECT CAST(id AS CHAR) AS id, code FROM admin_roles
      WHERE code IN ('SUPER_ADMIN', 'CONTENT_EDITOR') AND enabled = 1
    `, { type: QueryTypes.SELECT });
    assert.equal(roles.length, 2);
    const roleByCode = new Map(roles.map((row) => [row.code, row.id]));
    const passwordHash = await hashPassword(password);
    for (let index = 0; index < usernames.length; index += 1) {
      const roleId = roleByCode.get(index === 0 ? "SUPER_ADMIN" : "CONTENT_EDITOR");
      await database.sequelize.query(`
        INSERT INTO admin_users (
          username, password_hash, name, role_id, status, failed_login_attempts,
          password_changed_at, created_at, updated_at
        ) VALUES (
          :username, :passwordHash, :name, :roleId, 'ACTIVE', 0,
          CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
        )
      `, { replacements: { username: usernames[index], passwordHash, name: `目录验证管理员${index}`, roleId } });
      adminIds.push((await database.sequelize.query(
        "SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id",
        { type: QueryTypes.SELECT },
      ))[0].id);
    }

    const objectKey = `verify/catalog/${suffix}.jpg`;
    await database.sequelize.query(`
      INSERT INTO media_assets (
        object_key, url, mime_type, byte_size, width, height, sha256,
        status, created_by_admin_id, created_at
      ) VALUES (
        :objectKey, :url, 'image/jpeg', 1024, 1200, 1200, :sha256,
        'ACTIVE', :adminId, CURRENT_TIMESTAMP(3)
      )
    `, { replacements: {
      objectKey,
      url: `https://example.invalid/${objectKey}`,
      sha256: crypto.createHash("sha256").update(objectKey).digest("hex"),
      adminId: adminIds[0],
    } });
    mediaIds.push((await database.sequelize.query(
      "SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id",
      { type: QueryTypes.SELECT },
    ))[0].id);

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
    const denied = await jsonRequest(`${baseUrl}/api/admin/products`, { headers: contentHeaders });
    assert.equal(denied.response.status, 403);
    assert.equal(denied.body.code, "ADMIN_PERMISSION_DENIED");

    async function createCategory(dimension, name, iconText) {
      const result = await jsonRequest(`${baseUrl}/api/admin/categories`, {
        method: "POST", headers: authHeaders, body: { dimension, name, iconText },
      });
      assert.equal(result.response.status, 201);
      categoryIds.push(result.body.data.id);
      return result.body.data;
    }

    const productCategory = await createCategory("PRODUCT_CATEGORY", `串珠${suffix.slice(0, 3)}`, "串");
    const material = await createCategory("MATERIAL", `紫檀${suffix.slice(0, 3)}`, "檀");
    const renamed = await jsonRequest(`${baseUrl}/api/admin/categories/${productCategory.id}`, {
      method: "PATCH", headers: authHeaders, body: { name: `手串${suffix.slice(0, 3)}` },
    });
    assert.equal(renamed.response.status, 200);
    assert.equal(renamed.body.data.id, productCategory.id);
    assert.equal(renamed.body.data.name, `手串${suffix.slice(0, 3)}`);

    const publicCategories = await jsonRequest(`${baseUrl}/api/v1/categories?dimension=PRODUCT_CATEGORY`);
    assert.equal(publicCategories.response.status, 200);
    assert.ok(publicCategories.body.data.items.some((item) => item.id === productCategory.id && item.name === renamed.body.data.name));

    const createBody = {
      name: "紫檀·验证圆珠",
      subtitle: "管理员目录接口验证商品",
      categoryId: productCategory.id,
      materialId: material.id,
      craft: "手工打磨",
      tags: ["验证", "紫檀"],
      imageMediaIds: mediaIds,
      primaryMediaId: mediaIds[0],
      variants: [
        { specLabel: "1.8cm · 18颗", priceAmount: 168000, originalPriceAmount: 198000, initialStock: 10, lowStockThreshold: 2, enabled: true, sortOrder: 0 },
        { specLabel: "2.0cm · 15颗", priceAmount: 388000, originalPriceAmount: 457800, initialStock: 5, lowStockThreshold: 1, enabled: true, sortOrder: 1 },
      ],
      attributes: [{ label: "材质", value: "印度小叶紫檀" }],
      detailSections: [{ id: "intro", type: "PARAGRAPH", text: "验证商品详情结构化内容" }],
    };
    const created = await jsonRequest(`${baseUrl}/api/admin/products`, {
      method: "POST", headers: authHeaders, body: createBody,
    });
    assert.equal(created.response.status, 201);
    const product = created.body.data;
    productIds.push(product.id);
    assert.equal(product.variants.length, 2);
    assert.deepEqual(product.variants.map((item) => item.onHandQuantity), [10, 5]);
    assert.equal(product.minPriceAmount, 168000);
    assert.equal(product.version, 1);

    const inUse = await jsonRequest(`${baseUrl}/api/admin/categories/${productCategory.id}`, {
      method: "DELETE", headers: authHeaders,
    });
    assert.equal(inUse.response.status, 409);
    assert.equal(inUse.body.code, "CATEGORY_IN_USE");

    const publish = await jsonRequest(`${baseUrl}/api/admin/products/${product.id}/on-sale`, {
      method: "POST", headers: authHeaders, body: {},
    });
    assert.equal(publish.response.status, 200);
    assert.equal(publish.body.data.saleStatus, "ON_SALE");

    const publicProduct = await jsonRequest(`${baseUrl}/api/v1/products/${product.id}`);
    assert.equal(publicProduct.response.status, 200);
    assert.equal(publicProduct.body.data.category.name, renamed.body.data.name);
    assert.deepEqual(publicProduct.body.data.variants.map((item) => item.priceAmount), [168000, 388000]);

    function updateBody(version) {
      return {
        version,
        ...createBody,
        subtitle: "更新后的管理员目录接口验证商品",
        variants: product.variants.map((variant, index) => ({
          id: variant.id,
          skuCode: variant.skuCode,
          specLabel: variant.specLabel,
          priceAmount: index === 0 ? 178000 : variant.priceAmount,
          originalPriceAmount: variant.originalPriceAmount,
          lowStockThreshold: variant.lowStockThreshold,
          enabled: variant.enabled,
          sortOrder: variant.sortOrder,
        })),
      };
    }
    const stale = await jsonRequest(`${baseUrl}/api/admin/products/${product.id}`, {
      method: "PATCH", headers: authHeaders, body: updateBody(999),
    });
    assert.equal(stale.response.status, 409);
    assert.equal(stale.body.code, "RESOURCE_VERSION_CONFLICT");

    const currentAfterPublish = publish.body.data;
    const updated = await jsonRequest(`${baseUrl}/api/admin/products/${product.id}`, {
      method: "PATCH", headers: authHeaders, body: updateBody(currentAfterPublish.version),
    });
    assert.equal(updated.response.status, 200);
    assert.equal(updated.body.data.minPriceAmount, 178000);
    assert.equal(updated.body.data.variants[0].onHandQuantity, 10);

    const adjustedVariant = updated.body.data.variants[0];
    const adjusted = await jsonRequest(`${baseUrl}/api/admin/variants/${adjustedVariant.id}/inventory-adjustments`, {
      method: "POST",
      headers: { ...authHeaders, "x-request-id": `catalog-stock-${suffix}` },
      body: { expectedVersion: adjustedVariant.version, changeQuantity: -2, reasonType: "DAMAGE", note: "验证盘点破损" },
    });
    assert.equal(adjusted.response.status, 200);
    assert.equal(adjusted.body.data.onHandQuantity, 8);
    assert.equal(adjusted.body.data.availableQuantity, 8);

    const invalidAdjustment = await jsonRequest(`${baseUrl}/api/admin/variants/${adjustedVariant.id}/inventory-adjustments`, {
      method: "POST", headers: authHeaders,
      body: { expectedVersion: adjusted.body.data.version, changeQuantity: -99, reasonType: "ADJUSTMENT", note: "验证非法负库存" },
    });
    assert.equal(invalidAdjustment.response.status, 409);
    assert.equal(invalidAdjustment.body.code, "INVENTORY_ADJUSTMENT_INVALID");

    const movements = await jsonRequest(`${baseUrl}/api/admin/variants/${adjustedVariant.id}/inventory-movements?page=1&pageSize=20`, { headers: authHeaders });
    assert.equal(movements.response.status, 200);
    assert.ok(movements.body.data.items.some((item) => item.reasonType === "INITIAL"));
    assert.ok(movements.body.data.items.some((item) => item.reasonType === "DAMAGE" && item.changeQuantity === -2));

    const offShelf = await jsonRequest(`${baseUrl}/api/admin/products/${product.id}/off-shelf`, {
      method: "POST", headers: authHeaders, body: {},
    });
    assert.equal(offShelf.response.status, 200);
    assert.equal((await jsonRequest(`${baseUrl}/api/v1/products/${product.id}`)).response.status, 404);

    const deleted = await jsonRequest(`${baseUrl}/api/admin/products/${product.id}`, {
      method: "DELETE", headers: authHeaders,
    });
    assert.equal(deleted.response.status, 200);
    assert.equal(deleted.body.data.deleted, true);

    const auditRows = await database.sequelize.query(`
      SELECT action FROM admin_operation_logs
      WHERE admin_user_id = :adminId AND target_id IN (:targetIds)
    `, { replacements: { adminId: adminIds[0], targetIds: [...categoryIds, ...productIds, adjustedVariant.id] }, type: QueryTypes.SELECT });
    for (const action of ["CATEGORY_CREATED", "CATEGORY_UPDATED", "PRODUCT_CREATED", "PRODUCT_PUBLISHED", "PRODUCT_UPDATED", "INVENTORY_ADJUSTED", "PRODUCT_UNPUBLISHED", "PRODUCT_DELETED"]) {
      assert.ok(auditRows.some((row) => row.action === action), `missing audit action ${action}`);
    }

    console.log("Administrator category, product, SKU pricing, lifecycle, inventory, RBAC, and audit verification passed.");
  } catch (error) {
    const reason = error.original?.code || error.code || error.name || "Error";
    console.error(`Administrator catalog verification failed (${reason}).`);
    if (error.stack) console.error(error.stack);
    process.exitCode = 1;
  } finally {
    await closeServer(server).catch(() => {});
    try {
      if (productIds.length) {
        const variantRows = await database.sequelize.query(
          "SELECT CAST(id AS CHAR) AS id FROM product_variants WHERE product_id IN (:productIds)",
          { replacements: { productIds }, type: QueryTypes.SELECT },
        );
        const variantIds = variantRows.map((row) => row.id);
        if (variantIds.length) {
          await database.sequelize.query("DELETE FROM inventory_movements WHERE variant_id IN (:variantIds)", { replacements: { variantIds } });
          await database.sequelize.query("DELETE FROM product_variants WHERE id IN (:variantIds)", { replacements: { variantIds } });
        }
        await database.sequelize.query("DELETE FROM product_images WHERE product_id IN (:productIds)", { replacements: { productIds } });
        await database.sequelize.query("DELETE FROM products WHERE id IN (:productIds)", { replacements: { productIds } });
      }
      if (categoryIds.length) await database.sequelize.query("DELETE FROM categories WHERE id IN (:categoryIds)", { replacements: { categoryIds } });
      if (mediaIds.length) await database.sequelize.query("DELETE FROM media_assets WHERE id IN (:mediaIds)", { replacements: { mediaIds } });
      if (adminIds.length) {
        await database.sequelize.query("DELETE FROM admin_sessions WHERE admin_user_id IN (:adminIds)", { replacements: { adminIds } });
        await database.sequelize.query("DELETE FROM admin_operation_logs WHERE admin_user_id IN (:adminIds)", { replacements: { adminIds } });
        await database.sequelize.query("DELETE FROM admin_users WHERE id IN (:adminIds)", { replacements: { adminIds } });
      }
      const guardHashes = usernames.map((username) => scopeHash(username, "127.0.0.1"));
      await database.sequelize.query("DELETE FROM admin_login_guards WHERE scope_hash IN (:guardHashes)", { replacements: { guardHashes } });
      const cleanup = await database.sequelize.query(`
        SELECT
          (SELECT COUNT(*) FROM admin_users WHERE username IN (:usernames)) AS admin_count,
          (SELECT COUNT(*) FROM categories WHERE id IN (:categoryIds)) AS category_count,
          (SELECT COUNT(*) FROM products WHERE id IN (:productIds)) AS product_count,
          (SELECT COUNT(*) FROM media_assets WHERE id IN (:mediaIds)) AS media_count
      `, {
        replacements: {
          usernames,
          categoryIds: categoryIds.length ? categoryIds : ["0"],
          productIds: productIds.length ? productIds : ["0"],
          mediaIds: mediaIds.length ? mediaIds : ["0"],
        },
        type: QueryTypes.SELECT,
      });
      assert.deepEqual([
        Number(cleanup[0].admin_count), Number(cleanup[0].category_count),
        Number(cleanup[0].product_count), Number(cleanup[0].media_count),
      ], [0, 0, 0, 0]);
    } catch (error) {
      const reason = error.original?.code || error.code || error.name || "Error";
      console.error(`Administrator catalog verification cleanup failed (${reason}).`);
      process.exitCode = 1;
    }
    await database.close().catch(() => {});
  }
}

main();
