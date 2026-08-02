function createCloudBaseStorage({ envId, sdk } = {}) {
  if (!envId) throw new Error("CloudBase storage environment id is required");
  let app;

  function getApp() {
    if (app) return app;
    const cloudbase = sdk || require("@cloudbase/node-sdk");
    app = typeof cloudbase.init === "function" ? cloudbase.init({ env: envId }) : cloudbase;
    return app;
  }

  return {
    provider: "CLOUDBASE",
    async upload({ cloudPath, buffer }) {
      const result = await getApp().uploadFile({ cloudPath, fileContent: buffer });
      if (!result?.fileID) throw new Error("CloudBase upload did not return a fileID");
      return { fileID: result.fileID, cloudPath };
    },
    async delete({ fileID }) {
      const result = await getApp().deleteFile({ fileList: [fileID] });
      const item = result?.fileList?.[0];
      if (item && item.code && item.code !== "SUCCESS") {
        throw new Error(`CloudBase delete failed: ${item.code}`);
      }
      return { deleted: true };
    },
  };
}

module.exports = { createCloudBaseStorage };
