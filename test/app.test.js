const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

process.env.NODE_ENV = "test";
process.env.DATABASE_REQUIRED = "false";
process.env.DB_CONNECT_ON_START = "false";

const app = require("../app");

let server;
let baseUrl;

test.before(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test("root returns service metadata and request context", async () => {
  const response = await fetch(`${baseUrl}/`, {
    headers: { "x-request-id": "test-request-0001" },
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-powered-by"), null);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-request-id"), "test-request-0001");
  assert.equal(body.success, true);
  assert.equal(body.code, "OK");
  assert.equal(body.requestId, "test-request-0001");
  assert.equal(body.data.service, "wenwan-api");
});

test("liveness does not depend on MySQL", async () => {
  const response = await fetch(`${baseUrl}/health/live`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.data.status, "ok");
});

test("readiness reports an unconfigured database", async () => {
  const response = await fetch(`${baseUrl}/health/ready`);
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.success, false);
  assert.equal(body.code, "DATABASE_UNAVAILABLE");
  assert.equal(body.details.database, "not_configured");
});

test("unknown routes use the stable error envelope", async () => {
  const response = await fetch(`${baseUrl}/missing?secret=ignored`);
  const body = await response.json();

  assert.equal(response.status, 404);
  assert.equal(body.success, false);
  assert.equal(body.code, "NOT_FOUND");
  assert.equal(body.message, "Route not found: GET /missing");
  assert.ok(body.requestId);
});

test("invalid JSON returns BAD_REQUEST instead of INTERNAL_ERROR", async () => {
  const response = await fetch(`${baseUrl}/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{invalid",
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.code, "BAD_REQUEST");
});
