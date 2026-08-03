const crypto = require("node:crypto");
const path = require("node:path");
const database = require("../database");
const env = require("../config/env");
const AppError = require("../errors/app-error");
const ERROR_CODES = require("../constants/error-codes");
const createMediaRepository = require("../repositories/media.repository");
const { getStorage } = require("../storage");
const { inspectImage } = require("../utils/image-metadata");
const logger = require("../utils/logger");
const { writeAudit } = require("./audit.service");

function fail(code, message, statusCode, details) {
  throw new AppError({ code, message, statusCode, details });
}

function dto(row) {
  return {
    id: row.id,
    fileID: row.file_id || row.url || null,
    cloudPath: row.cloud_path || row.object_key,
    storageProvider: row.storage_provider,
    originalFilename: row.original_filename || "",
    mimeType: row.mime_type,
    size: Number(row.byte_size),
    width: Number(row.width),
    height: Number(row.height),
    referenceCount: Number(row.reference_count),
    referenceStatus: row.reference_status,
    status: row.status,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

function cloudPath(prefix, extension, now = new Date()) {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${prefix}/${year}/${month}/${crypto.randomUUID()}.${extension}`;
}

function auditMeta(context, meta) {
  return { adminUserId: context.admin.id, requestId: meta?.requestId || null, ipAddress: meta?.ipAddress || null };
}

function createMediaService({
  sequelize = database.sequelize,
  repositoryFactory = createMediaRepository,
  storage = getStorage(),
  config = env.mediaStorage,
} = {}) {
  const transaction = (work) => sequelize.transaction((tx) => work(repositoryFactory({ sequelize, transaction: tx })));
  const repository = () => repositoryFactory({ sequelize });

  async function upload(file, context, meta) {
    if (!file?.buffer?.length) fail(ERROR_CODES.VALIDATION_ERROR, "An image file is required", 400);
    if (file.size > config.maxBytes) fail(ERROR_CODES.MEDIA_TOO_LARGE, "Image exceeds the configured size limit", 413);
    const image = inspectImage(file.buffer);
    if (!image) fail(ERROR_CODES.MEDIA_TYPE_UNSUPPORTED, "Only valid JPEG, PNG and WebP images are supported", 415);
    if (!image.width || !image.height || image.width * image.height > config.maxPixels) {
      fail(ERROR_CODES.MEDIA_DIMENSIONS_INVALID, "Image dimensions exceed the configured limit", 422);
    }
    const targetPath = cloudPath(config.cloudPathPrefix, image.extension);
    let uploaded;
    try {
      uploaded = await storage.upload({ cloudPath: targetPath, buffer: file.buffer, mimeType: image.mimeType });
    } catch (error) {
      logger.error("media.storage.upload_failed", {
        provider: storage.provider,
        code: error?.code || error?.name || "UNKNOWN",
        message: error?.expose ? error.message : "COS request failed",
        statusCode: error?.statusCode || null,
        requestId: error?.requestId || null,
      });
      fail(
        ERROR_CODES.MEDIA_STORAGE_FAILED,
        error?.expose ? error.message : "Media storage upload failed",
        503,
        error?.expose ? { reason: error.code } : undefined,
      );
    }
    try {
      const row = await transaction(async (repo) => {
        const id = await repo.insert({
          cloudPath: uploaded.cloudPath,
          fileID: uploaded.fileID,
          storageProvider: storage.provider,
          originalFilename: path.basename(file.originalname || `image.${image.extension}`).slice(0, 255),
          mimeType: image.mimeType,
          byteSize: file.size,
          width: image.width,
          height: image.height,
          sha256: crypto.createHash("sha256").update(file.buffer).digest("hex"),
          adminId: context.admin.id,
          userId: null,
          purpose: "CATALOG",
        });
        const created = await repo.findById(id);
        await writeAudit(repo, {
          ...auditMeta(context, meta), module: "media", action: "MEDIA_UPLOADED",
          targetType: "MEDIA", targetId: id, targetLabel: created.original_filename,
          after: { id, cloudPath: created.cloud_path, mimeType: created.mime_type, size: Number(created.byte_size) },
        });
        return created;
      });
      return dto(row);
    } catch (error) {
      await storage.delete({ fileID: uploaded.fileID, cloudPath: uploaded.cloudPath }).catch(() => {});
      throw error;
    }
  }

  async function list(input) {
    const result = await repository().list(input);
    return { items: result.rows.map(dto), page: input.page, pageSize: input.pageSize, total: result.total, hasMore: input.page * input.pageSize < result.total };
  }

  async function remove(mediaId, context, meta) {
    const marked = await transaction(async (repo) => {
      const row = await repo.findById(mediaId, true);
      if (!row || row.status === "DELETED") fail(ERROR_CODES.MEDIA_NOT_FOUND, "Media not found", 404);
      if (row.storage_provider === "LEGACY_EXTERNAL" || !row.file_id) {
        fail(ERROR_CODES.CONFLICT, "Legacy external media cannot be deleted through managed object storage", 409);
      }
      const count = await repo.computeReferenceCount(mediaId);
      await repo.updateReferenceState(mediaId, count);
      if (count > 0) fail(ERROR_CODES.MEDIA_IN_USE, "Referenced media cannot be deleted", 409, { referenceCount: count });
      await repo.setStatus(mediaId, "DELETING");
      return row;
    });
    try {
      await storage.delete({ fileID: marked.file_id, cloudPath: marked.cloud_path || marked.object_key });
    } catch (error) {
      logger.error("media.storage.delete_failed", {
        provider: storage.provider,
        code: error?.code || error?.name || "UNKNOWN",
        message: error?.expose ? error.message : "COS request failed",
        statusCode: error?.statusCode || null,
        requestId: error?.requestId || null,
      });
      await transaction((repo) => repo.setStatus(mediaId, "ACTIVE"));
      fail(ERROR_CODES.MEDIA_STORAGE_FAILED, "Media storage deletion failed", 503);
    }
    await transaction(async (repo) => {
      await repo.setStatus(mediaId, "DELETED");
      await writeAudit(repo, {
        ...auditMeta(context, meta), module: "media", action: "MEDIA_DELETED",
        targetType: "MEDIA", targetId: mediaId, targetLabel: marked.original_filename,
        before: { fileID: marked.file_id, cloudPath: marked.cloud_path }, after: { status: "DELETED" },
      });
    });
    return { id: mediaId, deleted: true };
  }

  return { upload, list, remove };
}

module.exports = { createMediaService, mediaDto: dto, cloudPath };
