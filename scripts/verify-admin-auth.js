const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const { QueryTypes } = require("sequelize");

const env = require("../config/env");
const database = require("../database");
const app = require("../app");
const { hashPassword } = require("../utils/password");
const { tokenHash, scopeHash } = require("../services/admin-auth.service");

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
  const suffix = crypto.randomBytes(6).toString("hex");
  const usernames = {
    success: `verify.admin.${suffix}`,
    locked: `verify.locked.${suffix}`,
    limited: `verify.limited.${suffix}`,
  };
  const passwords = {
    success: `Success#${suffix}Aa1`,
    locked: `Locked#${suffix}Aa1`,
    limited: `Limited#${suffix}Aa1`,
  };
  const adminIds = [];
  const customRoleCode = `VERIFY_LIMITED_${suffix.toUpperCase()}`;
  let customRoleId;
  let server;
  try {
    assert.ok(env.wechat.cloudEnvId, "WECHAT_CLOUD_ENV_ID is required");
    assert.ok(env.wechat.miniProgramAppId, "WECHAT_MINIPROGRAM_APP_ID is required");
    await database.connect();
    const roles = await database.sequelize.query(`
      SELECT CAST(id AS CHAR) AS id, code FROM admin_roles
      WHERE code IN ('SUPER_ADMIN', 'OPERATOR', 'CONTENT_EDITOR') AND enabled = 1
    `, { type: QueryTypes.SELECT });
    assert.equal(roles.length, 3);
    const superRoleId = roles.find((row) => row.code === "SUPER_ADMIN").id;
    const permissionRows = await database.sequelize.query(`
      SELECT ap.code FROM admin_role_permissions arp
      INNER JOIN admin_roles ar ON ar.id = arp.role_id
      INNER JOIN admin_permissions ap ON ap.id = arp.permission_id
      WHERE ar.code = 'SUPER_ADMIN'
    `, { type: QueryTypes.SELECT });
    assert.ok(permissionRows.some((row) => row.code === "logs.read"));
    assert.ok(permissionRows.some((row) => row.code === "admins.write"));

    await database.sequelize.query(`
      INSERT INTO admin_roles (code, name, description, is_system, enabled, created_at, updated_at)
      VALUES (:code, '验证受限角色', '仅用于管理员鉴权契约验证', 0, 1, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
    `, { replacements: { code: customRoleCode } });
    customRoleId = (await database.sequelize.query(
      "SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id",
      { type: QueryTypes.SELECT },
    ))[0].id;

    for (const [key, username] of Object.entries(usernames)) {
      const passwordHash = await hashPassword(passwords[key]);
      const roleId = key === "limited" ? customRoleId : superRoleId;
      await database.sequelize.query(`
        INSERT INTO admin_users (
          username, password_hash, name, role_id, status, failed_login_attempts,
          password_changed_at, created_at, updated_at
        ) VALUES (
          :username, :passwordHash, :name, :roleId, 'ACTIVE', 0,
          CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
        )
      `, { replacements: { username, passwordHash, name: `验证管理员-${key}`, roleId } });
      adminIds.push((await database.sequelize.query(
        "SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id",
        { type: QueryTypes.SELECT },
      ))[0].id);
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

    const noGateway = await jsonRequest(`${baseUrl}/api/admin/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: { username: usernames.success, password: passwords.success },
    });
    assert.equal(noGateway.response.status, 401);
    assert.equal(noGateway.body.code, "WECHAT_GATEWAY_UNTRUSTED");

    const forgedRole = await jsonRequest(`${baseUrl}/api/admin/auth/login`, {
      method: "POST", headers: gatewayHeaders,
      body: { username: usernames.success, password: passwords.success, role: "SUPER_ADMIN" },
    });
    assert.equal(forgedRole.response.status, 400);

    for (let attempt = 1; attempt <= env.adminAuth.accountMaxAttempts; attempt += 1) {
      const failed = await jsonRequest(`${baseUrl}/api/admin/auth/login`, {
        method: "POST", headers: gatewayHeaders,
        body: { username: usernames.locked, password: "Wrong#Password1" },
      });
      assert.equal(failed.response.status, attempt === env.adminAuth.accountMaxAttempts ? 429 : 401);
    }
    const locked = await jsonRequest(`${baseUrl}/api/admin/auth/login`, {
      method: "POST", headers: gatewayHeaders,
      body: { username: usernames.locked, password: passwords.locked },
    });
    assert.equal(locked.response.status, 429);

    const login = await jsonRequest(`${baseUrl}/api/admin/auth/login`, {
      method: "POST", headers: { ...gatewayHeaders, "x-request-id": `verify-login-${suffix}` },
      body: { username: usernames.success, password: passwords.success },
    });
    assert.equal(login.response.status, 200);
    assert.equal(login.body.data.tokenType, "Bearer");
    assert.match(login.body.data.token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(login.body.data.admin.username, usernames.success);
    assert.equal(Object.hasOwn(login.body.data.admin, "passwordHash"), false);
    assert.equal(Object.hasOwn(login.body.data.admin, "openid"), false);
    const firstToken = login.body.data.token;

    const sessions = await database.sequelize.query(`
      SELECT token_hash FROM admin_sessions WHERE admin_user_id = :adminId AND revoked_at IS NULL
    `, { replacements: { adminId: login.body.data.admin.id }, type: QueryTypes.SELECT });
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].token_hash, tokenHash(firstToken));
    assert.notEqual(sessions[0].token_hash, firstToken);

    const authHeaders = { ...gatewayHeaders, authorization: `Bearer ${firstToken}` };
    const me = await jsonRequest(`${baseUrl}/api/admin/me`, { headers: authHeaders });
    assert.equal(me.response.status, 200);
    assert.ok(me.body.data.admin.permissions.includes("logs.read"));
    const logs = await jsonRequest(`${baseUrl}/api/admin/logs?page=1&pageSize=20`, { headers: authHeaders });
    assert.equal(logs.response.status, 200);
    assert.ok(logs.body.data.items.some((item) => item.action === "LOGIN_SUCCEEDED"));

    const limitedLogin = await jsonRequest(`${baseUrl}/api/admin/auth/login`, {
      method: "POST", headers: gatewayHeaders,
      body: { username: usernames.limited, password: passwords.limited },
    });
    assert.equal(limitedLogin.response.status, 200);
    const denied = await jsonRequest(`${baseUrl}/api/admin/logs`, {
      headers: { ...gatewayHeaders, authorization: `Bearer ${limitedLogin.body.data.token}` },
    });
    assert.equal(denied.response.status, 403);
    assert.equal(denied.body.code, "ADMIN_PERMISSION_DENIED");

    const refreshed = await jsonRequest(`${baseUrl}/api/admin/auth/refresh`, {
      method: "POST", headers: authHeaders, body: {},
    });
    assert.equal(refreshed.response.status, 200);
    const secondToken = refreshed.body.data.token;
    assert.notEqual(secondToken, firstToken);
    const oldToken = await jsonRequest(`${baseUrl}/api/admin/me`, { headers: authHeaders });
    assert.equal(oldToken.response.status, 401);
    const refreshedHeaders = { ...gatewayHeaders, authorization: `Bearer ${secondToken}` };
    assert.equal((await jsonRequest(`${baseUrl}/api/admin/me`, { headers: refreshedHeaders })).response.status, 200);

    const logout = await jsonRequest(`${baseUrl}/api/admin/auth/logout`, {
      method: "POST", headers: refreshedHeaders, body: {},
    });
    assert.equal(logout.response.status, 200);
    assert.equal(logout.body.data.loggedOut, true);
    assert.equal((await jsonRequest(`${baseUrl}/api/admin/me`, { headers: refreshedHeaders })).response.status, 401);

    const auditRows = await database.sequelize.query(`
      SELECT action, after_json FROM admin_operation_logs
      WHERE admin_user_id IN (:adminIds) ORDER BY id ASC
    `, { replacements: { adminIds }, type: QueryTypes.SELECT });
    assert.ok(auditRows.some((row) => row.action === "LOGIN_FAILED"));
    assert.ok(auditRows.some((row) => row.action === "LOGIN_SUCCEEDED"));
    assert.ok(auditRows.some((row) => row.action === "SESSION_REFRESHED"));
    assert.ok(auditRows.some((row) => row.action === "LOGOUT"));
    assert.equal(JSON.stringify(auditRows).includes(passwords.success), false);

    console.log("Administrator authentication, session rotation, RBAC, lockout, and audit verification passed.");
  } catch (error) {
    const reason = error.original?.code || error.code || error.name || "Error";
    console.error(`Administrator authentication verification failed (${reason}).`);
    if (error.stack) console.error(error.stack);
    process.exitCode = 1;
  } finally {
    await closeServer(server).catch(() => {});
    try {
      if (adminIds.length) {
        await database.sequelize.query("DELETE FROM admin_sessions WHERE admin_user_id IN (:adminIds)", { replacements: { adminIds } });
        await database.sequelize.query("DELETE FROM admin_operation_logs WHERE admin_user_id IN (:adminIds)", { replacements: { adminIds } });
        await database.sequelize.query("DELETE FROM admin_users WHERE id IN (:adminIds)", { replacements: { adminIds } });
      }
      const guardHashes = Object.values(usernames).map((username) => scopeHash(username, "127.0.0.1"));
      await database.sequelize.query("DELETE FROM admin_login_guards WHERE scope_hash IN (:guardHashes)", { replacements: { guardHashes } });
      if (customRoleId) await database.sequelize.query("DELETE FROM admin_roles WHERE id = :customRoleId", { replacements: { customRoleId } });
      const cleanup = await database.sequelize.query(`
        SELECT
          (SELECT COUNT(*) FROM admin_users WHERE username IN (:usernames)) AS admin_count,
          (SELECT COUNT(*) FROM admin_roles WHERE code = :customRoleCode) AS role_count
      `, {
        replacements: { usernames: Object.values(usernames), customRoleCode },
        type: QueryTypes.SELECT,
      });
      assert.deepEqual([Number(cleanup[0].admin_count), Number(cleanup[0].role_count)], [0, 0]);
    } catch (error) {
      const reason = error.original?.code || error.code || error.name || "Error";
      console.error(`Administrator verification cleanup failed (${reason}).`);
      process.exitCode = 1;
    }
    await database.close().catch(() => {});
  }
}

main();
