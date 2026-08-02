const AppError = require("../errors/app-error");
const ERROR_CODES = require("../constants/error-codes");
const createUserRepository = require("../repositories/user.repository");

function asNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function asIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function mapUser(row) {
  const createdAt = asIso(row.created_at);
  return {
    id: row.id,
    nickname: row.nickname || null,
    avatarUrl: row.avatar_url || null,
    status: row.status,
    memberSince: createdAt ? new Date(createdAt).getUTCFullYear() : null,
    createdAt,
    updatedAt: asIso(row.updated_at),
    lastSeenAt: asIso(row.last_seen_at),
  };
}

function createUserService(repository = createUserRepository()) {
  async function identify(openid) {
    const row = await repository.findOrCreateByOpenId(openid);
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.INTERNAL_ERROR,
        message: "User identity could not be resolved",
        statusCode: 500,
      });
    }
    if (row.status === "DISABLED") {
      throw new AppError({
        code: ERROR_CODES.USER_DISABLED,
        message: "User account is disabled",
        statusCode: 403,
      });
    }
    return mapUser(row);
  }

  async function getSummary(userId) {
    const row = await repository.findSummary(userId);
    return {
      orderCount: asNumber(row?.order_count),
      favoriteCount: asNumber(row?.favorite_count),
      addressCount: asNumber(row?.address_count),
      cartCount: asNumber(row?.cart_count),
    };
  }

  return { identify, getSummary };
}

module.exports = { createUserService, mapUser };
