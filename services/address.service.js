const database = require("../database");
const AppError = require("../errors/app-error");
const ERROR_CODES = require("../constants/error-codes");
const createAddressRepository = require("../repositories/address.repository");

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function mapAddress(row) {
  return {
    id: row.id,
    recipientName: row.recipient_name,
    phone: row.phone,
    province: row.province,
    city: row.city,
    district: row.district,
    region: [row.province, row.city, row.district].filter(Boolean).join(" "),
    detail: row.detail,
    postalCode: row.postal_code || null,
    label: row.label || null,
    isDefault: Boolean(row.is_default),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function notFound() {
  return new AppError({
    code: ERROR_CODES.ADDRESS_NOT_FOUND,
    message: "Address was not found",
    statusCode: 404,
  });
}

function createAddressService({
  sequelize = database.sequelize,
  repositoryFactory = createAddressRepository,
} = {}) {
  const repository = () => repositoryFactory({ sequelize });
  const inTransaction = (work) => sequelize.transaction(
    async (transaction) => work(repositoryFactory({ sequelize, transaction })),
  );

  async function getAddresses(userId) {
    const items = (await repository().findAll(userId)).map(mapAddress);
    return { items, total: items.length };
  }

  async function createAddress(userId, input) {
    const addressId = await inTransaction(async (repo) => {
      await repo.lockUser(userId);
      const total = await repo.countActive(userId);
      if (total >= 20) {
        throw new AppError({
          code: ERROR_CODES.ADDRESS_LIMIT_REACHED,
          message: "A user can save at most 20 addresses",
          statusCode: 409,
        });
      }
      const isDefault = total === 0 || input.isDefault === true;
      if (isDefault) await repo.clearDefaults(userId);
      return repo.insert(userId, { ...input, isDefault });
    });
    const row = await repository().findById(userId, addressId);
    return mapAddress(row);
  }

  async function updateAddress(userId, addressId, patch) {
    await inTransaction(async (repo) => {
      await repo.lockUser(userId);
      const current = await repo.findById(userId, addressId, true);
      if (!current) throw notFound();
      if (patch.isDefault === true) await repo.clearDefaults(userId);
      await repo.update(userId, addressId, patch);
      await repo.ensureDefault(userId);
    });
    return mapAddress(await repository().findById(userId, addressId));
  }

  async function removeAddress(userId, addressId) {
    await inTransaction(async (repo) => {
      await repo.lockUser(userId);
      const current = await repo.findById(userId, addressId, true);
      if (!current) return;
      await repo.softDelete(userId, addressId);
      await repo.ensureDefault(userId);
    });
    return getAddresses(userId);
  }

  async function setDefault(userId, addressId) {
    await inTransaction(async (repo) => {
      await repo.lockUser(userId);
      const current = await repo.findById(userId, addressId, true);
      if (!current) throw notFound();
      await repo.clearDefaults(userId);
      await repo.update(userId, addressId, { isDefault: true });
    });
    return mapAddress(await repository().findById(userId, addressId));
  }

  return { getAddresses, createAddress, updateAddress, removeAddress, setDefault };
}

module.exports = { createAddressService, mapAddress };
