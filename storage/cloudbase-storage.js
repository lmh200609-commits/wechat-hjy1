function createCloudBaseStorage({ envId, sdk } = {}) {
  if (!envId) throw new Error("CloudBase storage environment id is required");
  const cloudbase = sdk || require("@cloudbase/node-sdk");
  const app = typeof cloudbase.init === "function" ? cloudbase.init({ env: envId }) : cloudbase;

  return {
    provider: "CLOUDBASE",
    async upload({ cloudPath, buffer }) {
      const result = await app.uploadFile({ cloudPath, fileContent: buffer });
      if (!result?.fileID) throw new Error("CloudBase upload did not return a fileID");
      return { fileID: result.fileID, cloudPath };
    },
    async delete({ fileID }) {
      const result = await app.deleteFile({ fileList: [fileID] });
      const item = result?.fileList?.[0];
      if (item && item.code && item.code !== "SUCCESS") {
        throw new Error(`CloudBase delete failed: ${item.code}`);
      }
      return { deleted: true };
    },
  };
}

module.exports = { createCloudBaseStorage };
