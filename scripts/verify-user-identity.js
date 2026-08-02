const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const { QueryTypes } = require("sequelize");

const env = require("../config/env");
const database = require("../database");
const createUserRepository = require("../repositories/user.repository");
const { createUserService } = require("../services/user.service");
const app = require("../app");

function closeServer(server) {
  if (!server) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function main() {
  let server;
  let verificationOpenId;
  try {
    assert.ok(env.wechat.cloudEnvId, "WECHAT_CLOUD_ENV_ID is required");
    assert.ok(env.wechat.miniProgramAppId, "WECHAT_MINIPROGRAM_APP_ID is required");
    await database.connect();

    verificationOpenId = `verify_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
    const service = createUserService(createUserRepository());
    const users = await Promise.all(
      Array.from({ length: 8 }, () => service.identify(verificationOpenId)),
    );
    assert.equal(new Set(users.map((user) => user.id)).size, 1);
    assert.ok(users.every((user) => !Object.hasOwn(user, "openid")));

    const rows = await database.sequelize.query(`
      SELECT COUNT(*) AS user_count
      FROM users
      WHERE openid = :openid
    `, {
      replacements: { openid: verificationOpenId },
      type: QueryTypes.SELECT,
    });
    assert.equal(Number(rows[0].user_count), 1);
    assert.deepEqual(await service.getSummary(users[0].id), {
      orderCount: 0,
      favoriteCount: 0,
      addressCount: 0,
      cartCount: 0,
    });

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const trustedHeaders = {
      "x-wx-openid": verificationOpenId,
      "x-wx-env": env.wechat.cloudEnvId,
      "x-wx-appid": env.wechat.miniProgramAppId,
      "x-wx-source": "wx_devtools",
    };

    const missingResponse = await fetch(`${baseUrl}/api/v1/me`);
    assert.equal(missingResponse.status, 401);
    assert.equal((await missingResponse.json()).code, "USER_IDENTITY_MISSING");

    const meResponse = await fetch(`${baseUrl}/api/v1/me`, { headers: trustedHeaders });
    const meBody = await meResponse.json();
    assert.equal(meResponse.status, 200);
    assert.equal(meBody.data.id, users[0].id);
    assert.equal(Object.hasOwn(meBody.data, "openid"), false);

    const summaryResponse = await fetch(`${baseUrl}/api/v1/me/summary`, { headers: trustedHeaders });
    const summaryBody = await summaryResponse.json();
    assert.equal(summaryResponse.status, 200);
    assert.deepEqual(summaryBody.data, {
      orderCount: 0,
      favoriteCount: 0,
      addressCount: 0,
      cartCount: 0,
    });

    const untrustedResponse = await fetch(`${baseUrl}/api/v1/me`, {
      headers: { ...trustedHeaders, "x-wx-env": "untrusted-environment" },
    });
    assert.equal(untrustedResponse.status, 401);
    assert.equal((await untrustedResponse.json()).code, "USER_IDENTITY_UNTRUSTED");

    console.log("WeChat user identity database contract verification passed.");
  } catch (error) {
    const reason = error.original?.code || error.code || error.name || "Error";
    console.error(`WeChat user identity database contract verification failed (${reason}).`);
    process.exitCode = 1;
  } finally {
    await closeServer(server).catch(() => {});
    if (verificationOpenId) {
      try {
        await database.sequelize.query("DELETE FROM users WHERE openid = :openid", {
          replacements: { openid: verificationOpenId },
        });
        const cleanupRows = await database.sequelize.query(`
          SELECT COUNT(*) AS user_count
          FROM users
          WHERE openid = :openid
        `, {
          replacements: { openid: verificationOpenId },
          type: QueryTypes.SELECT,
        });
        assert.equal(Number(cleanupRows[0].user_count), 0);
      } catch (error) {
        const reason = error.original?.code || error.code || error.name || "Error";
        console.error(`Temporary user cleanup verification failed (${reason}).`);
        process.exitCode = 1;
      }
    }
    await database.close().catch(() => {});
  }
}

main();
