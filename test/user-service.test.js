const test = require("node:test");
const assert = require("node:assert/strict");

const { createUserService } = require("../services/user.service");

test("identify maps the internal profile and never returns OpenID", async () => {
  const service = createUserService({
    async findOrCreateByOpenId(openid) {
      assert.equal(openid, "openid_12345678");
      return {
        id: "7",
        openid,
        nickname: "听松居士",
        avatar_url: "https://example.invalid/avatar.jpg",
        status: "ACTIVE",
        created_at: "2024-02-03T00:00:00.000Z",
        updated_at: "2026-08-02T00:00:00.000Z",
        last_seen_at: "2026-08-02T00:00:00.000Z",
      };
    },
  });
  const user = await service.identify("openid_12345678");
  assert.equal(user.id, "7");
  assert.equal(user.memberSince, 2024);
  assert.equal(user.avatarUrl, "https://example.invalid/avatar.jpg");
  assert.equal(Object.hasOwn(user, "openid"), false);
});

test("disabled users are denied", async () => {
  const service = createUserService({
    findOrCreateByOpenId: async () => ({ id: "7", status: "DISABLED" }),
  });
  await assert.rejects(
    service.identify("openid_12345678"),
    (error) => error.code === "USER_DISABLED" && error.statusCode === 403,
  );
});

test("summary normalizes database scalar values", async () => {
  const service = createUserService({
    findSummary: async () => ({
      order_count: "3",
      favorite_count: 2,
      address_count: "1",
      cart_count: null,
    }),
  });
  assert.deepEqual(await service.getSummary("7"), {
    orderCount: 3,
    favoriteCount: 2,
    addressCount: 1,
    cartCount: 0,
  });
});
