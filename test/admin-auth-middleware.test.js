const test = require("node:test");
const assert = require("node:assert/strict");

const { createAdminAuthMiddleware, requireAdminPermission, bearerToken } = require("../middleware/admin-auth");

function request(authorization) {
  return { get: (name) => (name.toLowerCase() === "authorization" ? authorization : undefined) };
}

test("admin authentication only accepts safe Bearer tokens", async () => {
  assert.equal(bearerToken(request(`Bearer ${"a".repeat(43)}`)), "a".repeat(43));
  assert.equal(bearerToken(request("Basic abc")), null);
  assert.equal(bearerToken(request("Bearer ../unsafe")), null);
  const middleware = createAdminAuthMiddleware({
    service: { authenticate: async () => assert.fail("service must not be called") },
  });
  await assert.rejects(middleware(request("Basic abc"), {}, () => {}), (error) => (
    error.code === "ADMIN_SESSION_EXPIRED" && error.statusCode === 401
  ));
});

test("admin middleware exposes only resolved server permissions", async () => {
  let nextCalled = false;
  const middleware = createAdminAuthMiddleware({ service: {
    authenticate: async () => ({
      admin: { id: "1", permissions: ["logs.read"] },
      session: { id: "2", expiresAt: "2026-08-02T10:00:00.000Z" },
    }),
  } });
  const req = request(`Bearer ${"a".repeat(43)}`);
  await middleware(req, {}, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(req.adminPermissions.has("logs.read"), true);
  assert.equal(req.adminToken, "a".repeat(43));
});

test("permission middleware denies missing RBAC grants", () => {
  const denied = requireAdminPermission("admins.write");
  let captured;
  denied({ adminPermissions: new Set(["logs.read"]) }, {}, (error) => { captured = error; });
  assert.equal(captured.code, "ADMIN_PERMISSION_DENIED");
  assert.equal(captured.statusCode, 403);
});
