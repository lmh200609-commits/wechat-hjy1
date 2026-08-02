const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

process.env.NODE_ENV = "test";
const { createMockStorage } = require("../storage/mock-storage");
const { createCosStorage, publicObjectUrl } = require("../storage/cos-storage");
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

test("mock storage keeps local tests isolated from COS", async () => {
  const storage = createMockStorage();
  const uploaded = await storage.upload({ cloudPath: "wenwan/media/test.png", buffer: png() });
  assert.match(uploaded.fileID, /^cloud:\/\/mock-env\./);
  assert.equal(storage.files.size, 1);
  await storage.delete({ fileID: uploaded.fileID });
  assert.equal(storage.files.size, 0);
});

test("COS adapter uploads and deletes by bucket, region, and object key", async () => {
  const calls = [];
  const client = {
    putObject(input, callback) { calls.push(["upload", input]); callback(null, { ETag: "test" }); },
    deleteObject(input, callback) { calls.push(["delete", input]); callback(null, {}); },
  };
  const storage = createCosStorage({
    bucket: "wenwan-test-1250000000",
    region: "ap-shanghai",
    client,
  });
  const uploaded = await storage.upload({ cloudPath: "文玩/path 1.png", buffer: png(), mimeType: "image/png" });
  await storage.delete({ cloudPath: uploaded.cloudPath });
  assert.equal(uploaded.fileID, "https://wenwan-test-1250000000.cos.ap-shanghai.myqcloud.com/%E6%96%87%E7%8E%A9/path%201.png");
  assert.equal(calls[0][1].Bucket, "wenwan-test-1250000000");
  assert.equal(calls[0][1].Region, "ap-shanghai");
  assert.equal(calls[0][1].Key, "文玩/path 1.png");
  assert.equal(calls[0][1].ContentType, "image/png");
  assert.deepEqual(calls[1], ["delete", {
    Bucket: "wenwan-test-1250000000",
    Region: "ap-shanghai",
    Key: "文玩/path 1.png",
  }]);
});

test("COS adapter reports missing server credentials without exposing secret data", async () => {
  const storage = createCosStorage({
    bucket: "wenwan-test-1250000000",
    region: "ap-shanghai",
  });
  await assert.rejects(
    storage.upload({ cloudPath: "path.png", buffer: png(), mimeType: "image/png" }),
    (error) => error.code === "COS_CREDENTIALS_MISSING" && error.expose === true,
  );
});

test("COS public URL uses the configured bucket and region", () => {
  assert.equal(publicObjectUrl({
    bucket: "wenwan-test-1250000000",
    region: "ap-shanghai",
    cloudPath: "wenwan/media/a.png",
  }), "https://wenwan-test-1250000000.cos.ap-shanghai.myqcloud.com/wenwan/media/a.png");
});
