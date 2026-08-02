function configurationError(code, message) {
  const error = new Error(message);
  error.name = "StorageConfigurationError";
  error.code = code;
  error.expose = true;
  return error;
}

function requireSetting(value, code, message) {
  if (!value) throw configurationError(code, message);
  return value;
}

function encodeObjectKey(key) {
  return String(key || "")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function publicObjectUrl({ bucket, region, cloudPath }) {
  return `https://${bucket}.cos.${region}.myqcloud.com/${encodeObjectKey(cloudPath)}`;
}

function invoke(client, method, params) {
  return new Promise((resolve, reject) => {
    client[method](params, (error, result) => {
      if (error) reject(error);
      else resolve(result || {});
    });
  });
}

function createCosStorage({
  bucket,
  region,
  secretId,
  secretKey,
  sessionToken,
  client,
  Cos,
} = {}) {
  let singleton = client;

  function getClient() {
    if (singleton) return singleton;
    requireSetting(
      secretId,
      "COS_CREDENTIALS_MISSING",
      "COS server credentials are not configured; set COS_SECRET_ID and COS_SECRET_KEY",
    );
    requireSetting(
      secretKey,
      "COS_CREDENTIALS_MISSING",
      "COS server credentials are not configured; set COS_SECRET_ID and COS_SECRET_KEY",
    );
    const CosClient = Cos || require("cos-nodejs-sdk-v5");
    singleton = new CosClient({
      SecretId: secretId,
      SecretKey: secretKey,
      ...(sessionToken ? { SecurityToken: sessionToken } : {}),
    });
    return singleton;
  }

  function target(cloudPath) {
    return {
      Bucket: requireSetting(bucket, "COS_BUCKET_MISSING", "COS_BUCKET is not configured"),
      Region: requireSetting(region, "COS_REGION_MISSING", "COS_REGION is not configured"),
      Key: requireSetting(cloudPath, "COS_OBJECT_KEY_MISSING", "COS object key is required"),
    };
  }

  return {
    provider: "COS",
    async upload({ cloudPath, buffer, mimeType }) {
      const object = target(cloudPath);
      await invoke(getClient(), "putObject", {
        ...object,
        Body: buffer,
        ContentLength: buffer.length,
        ContentType: mimeType,
      });
      return {
        fileID: publicObjectUrl({ bucket: object.Bucket, region: object.Region, cloudPath }),
        cloudPath,
      };
    },
    async delete({ cloudPath }) {
      const object = target(cloudPath);
      await invoke(getClient(), "deleteObject", object);
      return { deleted: true };
    },
  };
}

module.exports = { createCosStorage, publicObjectUrl, encodeObjectKey };
