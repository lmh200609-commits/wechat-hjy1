const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

process.env.NODE_ENV = "test";
const { createMockStorage } = require("../storage/mock-storage");
const { createCloudBaseStorage } = require("../storage/cloudbase-storage");
const { inspectImage } = require("../utils/image-metadata");
const { decodeBase64Image, uploadImage } = require("../middleware/media-upload");

function png(width = 2, height = 3) {
  const buffer = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a", "hex").copy(buffer);
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

test("image inspection trusts file signatures rather than client MIME labels", () => {
  assert.deepEqual(inspectImage(png()), { mimeType: "image/png", extension: "png", width: 2, height: 3 });
  assert.equal(inspectImage(Buffer.from("not-an-image")), null);
});

test("JSON media upload decodes canonical Base64 image data", () => {
  const source = png();
  assert.deepEqual(decodeBase64Image(source.toString("base64")), source);
  assert.deepEqual(decodeBase64Image(`data:image/png;base64,${source.toString("base64")}`), source);
});

test("JSON media upload rejects malformed Base64 data", () => {
  assert.throws(() => decodeBase64Image("not@base64"), /Invalid Base64 image data/);
  assert.equal(decodeBase64Image(""), null);
});

test("JSON media upload middleware exposes the decoded image to the route", async (context) => {
  const app = express();
  app.post("/upload", uploadImage, (req, res) => {
    res.json({ size: req.file?.size, name: req.file?.originalname });
  });
  const server = app.listen(0);
  context.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/upload`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fileName: "test.png", contentBase64: png().toString("base64") }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { size: 24, name: "test.png" });
});

test("mock storage keeps local tests isolated from CloudBase", async () => {
  const storage = createMockStorage();
  const uploaded = await storage.upload({ cloudPath: "wenwan/media/test.png", buffer: png() });
  assert.match(uploaded.fileID, /^cloud:\/\/mock-env\./);
  assert.equal(storage.files.size, 1);
  await storage.delete({ fileID: uploaded.fileID });
  assert.equal(storage.files.size, 0);
});

test("CloudBase adapter uses fileID upload and delete contracts", async () => {
  const calls = [];
  const storage = createCloudBaseStorage({
    envId: "prod-test",
    sdk: { init(input) { calls.push(["init", input]); return {
      async uploadFile(input) { calls.push(["upload", input]); return { fileID: "cloud://prod-test.bucket/path.png" }; },
      async deleteFile(input) { calls.push(["delete", input]); return { fileList: [{ code: "SUCCESS" }] }; },
    }; } },
  });
  assert.deepEqual(calls, []);
  const uploaded = await storage.upload({ cloudPath: "path.png", buffer: png() });
  await storage.delete({ fileID: uploaded.fileID });
  assert.deepEqual(calls[0], ["init", { env: "prod-test" }]);
  assert.equal(calls[1][1].cloudPath, "path.png");
  assert.deepEqual(calls[2][1], { fileList: ["cloud://prod-test.bucket/path.png"] });
});

test("CloudBase adapter always initializes with the configured environment id", async () => {
  const calls = [];
  const storage = createCloudBaseStorage({
    envId: "prod-test",
    sdk: {
      init(input) {
        calls.push(input);
        return {
          async uploadFile() { return { fileID: "cloud://prod-test.bucket/path.png" }; },
          async deleteFile() { return { fileList: [{ code: "SUCCESS" }] }; },
        };
      },
    },
  });
  assert.deepEqual(calls, []);
  await storage.upload({ cloudPath: "path.png", buffer: png() });
  assert.deepEqual(calls, [{ env: "prod-test" }]);
});
