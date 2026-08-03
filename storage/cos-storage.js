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

function objectKeyFromUrl(value, bucket, region) {
  if (typeof value !== "string" || !value) return null;
  const expectedHost = `${bucket}.cos.${region}.myqcloud.com`;
  try {
    const parsed = new URL(value);
    if (parsed.hostname !== expectedHost) return null;
    return parsed.pathname.split("/").filter(Boolean).map(decodeURIComponent).join("/");
  } catch (error) {
    return null;
  }
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
  readUrlTtlSeconds = 3600,
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

  function readUrl(value) {
    const cloudPath = objectKeyFromUrl(value, bucket, region);
    if (!cloudPath) return value;
    const object = target(cloudPath);
    const authorization = getClient().getAuth({
      ...object,
      Method: "GET",
      Expires: readUrlTtlSeconds,
    });
    const token = sessionToken
      ? `&x-cos-security-token=${encodeURIComponent(sessionToken)}`
      : "";
    return `${publicObjectUrl({ bucket: object.Bucket, region: object.Region, cloudPath })}?${authorization}${token}`;
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
    resolveReadUrl: readUrl,
  };
}

module.exports = { createCosStorage, publicObjectUrl, objectKeyFromUrl, encodeObjectKey };
