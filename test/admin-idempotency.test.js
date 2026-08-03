const test = require("node:test");
const assert = require("node:assert/strict");

process.env.NODE_ENV = "test";
const { createAdminIdempotencyMiddleware } = require("../middleware/admin-idempotency");

function response() {
  return {
    success(data, message = "success", statusCode = 200, code = "OK") {
      this.sent = { data, message, statusCode, code };
      return this.sent;
    },
  };
}

test("administrator idempotency replays a completed mutation and rejects changed data", async () => {
  let record = null;
  const repository = {
    async find() { return record; },
    async insert(input) {
      record = { request_hash: input.requestHash, status: "PROCESSING", expires_at: input.expiresAt };
    },
    async complete(input) {
      record = {
        ...record,
        status: "COMPLETED",
        response_status: input.responseStatus,
        response_code: input.responseCode,
        response_message: input.responseMessage,
        response_data_json: input.responseDataJson,
      };
    },
    async remove() { record = null; },
  };
  const middleware = createAdminIdempotencyMiddleware("product:create", { repository });
  const key = "wx-admin-product-00000001";
  const firstReq = { admin: { id: "1" }, validated: { name: "器物" }, get: () => key };
  const firstRes = response();
  let continued = false;
  await middleware(firstReq, firstRes, () => { continued = true; });
  assert.equal(continued, true);
  await firstRes.success({ id: "9" }, "created", 201);
  assert.equal(record.status, "COMPLETED");

  const replayRes = response();
  await middleware({ admin: { id: "1" }, validated: { name: "器物" }, get: () => key }, replayRes, () => {});
  assert.deepEqual(replayRes.sent, { data: { id: "9" }, message: "created", statusCode: 201, code: "OK" });

  await assert.rejects(
    middleware({ admin: { id: "1" }, validated: { name: "另一件" }, get: () => key }, response(), () => {}),
    (error) => error.code === "IDEMPOTENCY_CONFLICT" && error.statusCode === 409,
  );
});
