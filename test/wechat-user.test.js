const test = require("node:test");
const assert = require("node:assert/strict");

process.env.NODE_ENV = "test";

const { createWechatUserMiddleware, createWechatGatewayMiddleware } = require("../middleware/wechat-user");
const requireCompleteUserProfile = require("../middleware/require-complete-user-profile");

const config = {
  cloudEnvId: "prod-test-env",
  miniProgramAppId: "wx-test-app",
};

function createRequest(headers = {}, extras = {}) {
  const normalized = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
  return {
    ...extras,
    get(name) {
      return normalized[name.toLowerCase()];
    },
  };
}

function trustedHeaders(overrides = {}) {
  return {
    "x-wx-openid": "openid_test_123456",
    "x-wx-env": config.cloudEnvId,
    "x-wx-appid": config.miniProgramAppId,
    "x-wx-source": "wx_client",
    ...overrides,
  };
}

test("missing trusted OpenID is rejected even when body supplies identity fields", async () => {
  const middleware = createWechatUserMiddleware({
    config,
    userService: { identify: async () => assert.fail("identity service must not be called") },
  });
  const req = createRequest({}, { body: { openid: "forged", userId: "1", role: "ADMIN" } });
  await assert.rejects(
    middleware(req, {}, () => {}),
    (error) => error.code === "USER_IDENTITY_MISSING" && error.statusCode === 401,
  );
});

test("mismatched CloudBase routing context is rejected", async () => {
  const middleware = createWechatUserMiddleware({
    config,
    userService: { identify: async () => assert.fail("identity service must not be called") },
  });
  for (const headers of [
    trustedHeaders({ "x-wx-env": "another-env" }),
    trustedHeaders({ "x-wx-appid": "another-app" }),
    trustedHeaders({ "x-wx-source": "" }),
    trustedHeaders({ "x-wx-openid": "bad value" }),
  ]) {
    await assert.rejects(
      middleware(createRequest(headers), {}, () => {}),
      (error) => error.code === "USER_IDENTITY_UNTRUSTED" && error.statusCode === 401,
    );
  }
});

test("trusted headers resolve the internal user without exposing OpenID on request context", async () => {
  let receivedOpenId;
  let nextCalled = false;
  const middleware = createWechatUserMiddleware({
    config,
    userService: {
      async identify(openid) {
        receivedOpenId = openid;
        return { id: "42", nickname: null, status: "ACTIVE" };
      },
    },
  });
  const req = createRequest(trustedHeaders());
  await middleware(req, {}, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.equal(receivedOpenId, "openid_test_123456");
  assert.equal(req.user.id, "42");
  assert.equal(Object.hasOwn(req.user, "openid"), false);
  assert.equal(Object.hasOwn(req.wechatContext, "openid"), false);
});

test("administrator gateway validation does not require or trust an OpenID", () => {
  const middleware = createWechatGatewayMiddleware({ config });
  let nextCalled = false;
  const req = createRequest({
    "x-wx-env": config.cloudEnvId,
    "x-wx-appid": config.miniProgramAppId,
    "x-wx-source": "wx_client",
    "x-wx-openid": "untrusted-for-admin-role",
  });
  middleware(req, {}, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(Object.hasOwn(req.wechatContext, "openid"), false);
});

test("transaction middleware requires a completed profile after trusted identity resolution", () => {
  let nextCalled = false;
  requireCompleteUserProfile({ user: { id: "42", profileComplete: true } }, {}, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  let received;
  requireCompleteUserProfile({ user: { id: "42", profileComplete: false } }, {}, (error) => { received = error; });
  assert.equal(received.code, "USER_PROFILE_REQUIRED");
  assert.equal(received.statusCode, 403);
});
