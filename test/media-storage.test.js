const test = require("node:test");
const assert = require("node:assert/strict");

process.env.NODE_ENV = "test";
const { createMockStorage } = require("../storage/mock-storage");
const { createCloudBaseStorage } = require("../storage/cloudbase-storage");
const { inspectImage } = require("../utils/image-metadata");

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
  const uploaded = await storage.upload({ cloudPath: "path.png", buffer: png() });
  await storage.delete({ fileID: uploaded.fileID });
  assert.deepEqual(calls[0], ["init", { env: "prod-test" }]);
  assert.equal(calls[1][1].cloudPath, "path.png");
  assert.deepEqual(calls[2][1], { fileList: ["cloud://prod-test.bucket/path.png"] });
});
