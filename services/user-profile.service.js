const crypto = require("node:crypto");
const path = require("node:path");
const database = require("../database");
const env = require("../config/env");
const AppError = require("../errors/app-error");
const ERROR_CODES = require("../constants/error-codes");
const createUserRepository = require("../repositories/user.repository");
const createMediaRepository = require("../repositories/media.repository");
const { getStorage, resolveStorageUrls } = require("../storage");
const { inspectImage } = require("../utils/image-metadata");
const { cloudPath } = require("./media.service");

function fail(code, message, statusCode, details) {
  throw new AppError({ code, message, statusCode, details });
}

function avatarPath(userId, extension) {
  return cloudPath(`${env.mediaStorage.cloudPathPrefix}/avatars/${userId}`, extension);
}

function avatarDto(row) {
  const fileID = row.file_id || row.url || null;
  return {
    id: String(row.id),
    avatarUrl: fileID ? resolveStorageUrls(fileID) : null,
  };
}

function createUserProfileService({
  sequelize = database.sequelize,
  userRepositoryFactory = createUserRepository,
  mediaRepositoryFactory = createMediaRepository,
  storage = getStorage(),
  config = env.mediaStorage,
} = {}) {
  const transaction = (work) => sequelize.transaction((tx) => work({
    userRepository: userRepositoryFactory({ sequelize, transaction: tx }),
    mediaRepository: mediaRepositoryFactory({ sequelize, transaction: tx }),
  }));

  async function uploadAvatar(file, user) {
    if (!file?.buffer?.length) fail(ERROR_CODES.VALIDATION_ERROR, "An avatar image is required", 400);
    if (file.size > config.maxBytes) fail(ERROR_CODES.MEDIA_TOO_LARGE, "Avatar exceeds the configured size limit", 413);
    const image = inspectImage(file.buffer);
    if (!image) fail(ERROR_CODES.MEDIA_TYPE_UNSUPPORTED, "Only valid JPEG, PNG and WebP images are supported", 415);
    if (!image.width || !image.height || image.width * image.height > config.maxPixels) {
      fail(ERROR_CODES.MEDIA_DIMENSIONS_INVALID, "Avatar dimensions exceed the configured limit", 422);
    }

    const targetPath = avatarPath(user.id, image.extension);
    let uploaded;
    try {
      uploaded = await storage.upload({ cloudPath: targetPath, buffer: file.buffer, mimeType: image.mimeType });
    } catch (error) {
      fail(ERROR_CODES.MEDIA_STORAGE_FAILED, error?.expose ? error.message : "Avatar storage upload failed", 503);
    }

    try {
      const row = await transaction(async ({ mediaRepository }) => {
        const id = await mediaRepository.insert({
          cloudPath: uploaded.cloudPath,
          fileID: uploaded.fileID,
          storageProvider: storage.provider,
          originalFilename: path.basename(file.originalname || `avatar.${image.extension}`).slice(0, 255),
          mimeType: image.mimeType,
          byteSize: file.size,
          width: image.width,
          height: image.height,
          sha256: crypto.createHash("sha256").update(file.buffer).digest("hex"),
          adminId: null,
          userId: user.id,
          purpose: "USER_AVATAR",
        });
        return mediaRepository.findById(id);
      });
      return avatarDto(row);
    } catch (error) {
      await storage.delete({ fileID: uploaded.fileID, cloudPath: uploaded.cloudPath }).catch(() => {});
      throw error;
    }
  }

  async function updateProfile(user, patch) {
    const row = await transaction(async ({ userRepository, mediaRepository }) => {
      const current = await userRepository.findById(user.id, true);
      if (!current || current.status !== "ACTIVE") {
        fail(ERROR_CODES.USER_DISABLED, "User account is unavailable", 403);
      }

      let avatarMedia = null;
      if (patch.avatarMediaId !== undefined) {
        avatarMedia = await userRepository.findOwnedAvatarMedia(patch.avatarMediaId, user.id);
        if (!avatarMedia) fail(ERROR_CODES.MEDIA_NOT_FOUND, "Avatar media was not found", 404);
      }

      await userRepository.updateProfile(user.id, {
        nickname: patch.nickname,
        avatarMediaId: avatarMedia ? avatarMedia.id : undefined,
        avatarUrl: avatarMedia ? (avatarMedia.file_id || avatarMedia.url) : undefined,
      });

      if (avatarMedia) {
        await mediaRepository.refreshReferenceState([current.avatar_media_id, avatarMedia.id].filter(Boolean));
      }
      return userRepository.findById(user.id);
    });

    return {
      id: row.id,
      nickname: row.nickname || null,
      avatarUrl: row.avatar_file_id || row.avatar_url ? resolveStorageUrls(row.avatar_file_id || row.avatar_url) : null,
      avatarMediaId: row.avatar_media_id || null,
      profileComplete: Boolean(row.nickname && (row.avatar_file_id || row.avatar_url)),
    };
  }

  return { uploadAvatar, updateProfile };
}

module.exports = { createUserProfileService };
