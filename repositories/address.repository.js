const { QueryTypes } = require("sequelize");
const database = require("../database");

function createAddressRepository({ sequelize = database.sequelize, transaction } = {}) {
  function queryOptions(replacements = {}, type) {
    return {
      replacements,
      ...(type ? { type } : {}),
      ...(transaction ? { transaction } : {}),
    };
  }

  async function lockUser(userId) {
    await sequelize.query(
      "SELECT id FROM users WHERE id = :userId LIMIT 1 FOR UPDATE",
      queryOptions({ userId }, QueryTypes.SELECT),
    );
  }

  async function findAll(userId) {
    return sequelize.query(`
      SELECT CAST(id AS CHAR) AS id, recipient_name, phone, province, city, district,
             detail, postal_code, label, is_default, created_at, updated_at
      FROM user_addresses
      WHERE user_id = :userId AND deleted_at IS NULL
      ORDER BY is_default DESC, updated_at DESC, id DESC
    `, queryOptions({ userId }, QueryTypes.SELECT));
  }

  async function countActive(userId) {
    const rows = await sequelize.query(`
      SELECT COUNT(*) AS total
      FROM user_addresses
      WHERE user_id = :userId AND deleted_at IS NULL
    `, queryOptions({ userId }, QueryTypes.SELECT));
    return Number(rows[0]?.total || 0);
  }

  async function findById(userId, addressId, lock = false) {
    const rows = await sequelize.query(`
      SELECT CAST(id AS CHAR) AS id, recipient_name, phone, province, city, district,
             detail, postal_code, label, is_default, created_at, updated_at
      FROM user_addresses
      WHERE id = :addressId AND user_id = :userId AND deleted_at IS NULL
      LIMIT 1
      ${lock ? "FOR UPDATE" : ""}
    `, queryOptions({ userId, addressId }, QueryTypes.SELECT));
    return rows[0] || null;
  }

  async function clearDefaults(userId) {
    await sequelize.query(`
      UPDATE user_addresses
      SET is_default = 0, updated_at = CURRENT_TIMESTAMP(3)
      WHERE user_id = :userId AND deleted_at IS NULL AND is_default = 1
    `, queryOptions({ userId }));
  }

  async function insert(userId, input) {
    await sequelize.query(`
      INSERT INTO user_addresses (
        user_id, recipient_name, phone, province, city, district, detail,
        postal_code, label, is_default, created_at, updated_at
      ) VALUES (
        :userId, :recipientName, :phone, :province, :city, :district, :detail,
        :postalCode, :label, :isDefault, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
      )
    `, queryOptions({ userId, ...input }));
    const rows = await sequelize.query(
      "SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id",
      queryOptions({}, QueryTypes.SELECT),
    );
    return rows[0].id;
  }

  async function update(userId, addressId, patch) {
    const columns = {
      recipientName: "recipient_name",
      phone: "phone",
      province: "province",
      city: "city",
      district: "district",
      detail: "detail",
      postalCode: "postal_code",
      label: "label",
      isDefault: "is_default",
    };
    const replacements = { userId, addressId };
    const assignments = Object.entries(columns).flatMap(([field, column]) => {
      if (patch[field] === undefined) return [];
      replacements[field] = patch[field];
      return [`${column} = :${field}`];
    });
    if (!assignments.length) return;
    assignments.push("updated_at = CURRENT_TIMESTAMP(3)");
    await sequelize.query(`
      UPDATE user_addresses
      SET ${assignments.join(", ")}
      WHERE id = :addressId AND user_id = :userId AND deleted_at IS NULL
    `, queryOptions(replacements));
  }

  async function softDelete(userId, addressId) {
    await sequelize.query(`
      UPDATE user_addresses
      SET is_default = 0, deleted_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = :addressId AND user_id = :userId AND deleted_at IS NULL
    `, queryOptions({ userId, addressId }));
  }

  async function ensureDefault(userId) {
    const defaults = await sequelize.query(`
      SELECT id FROM user_addresses
      WHERE user_id = :userId AND deleted_at IS NULL AND is_default = 1
      LIMIT 1
    `, queryOptions({ userId }, QueryTypes.SELECT));
    if (defaults.length) return;
    await sequelize.query(`
      UPDATE user_addresses
      SET is_default = 1, updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = (
        SELECT selected.id FROM (
          SELECT id FROM user_addresses
          WHERE user_id = :userId AND deleted_at IS NULL
          ORDER BY created_at ASC, id ASC
          LIMIT 1
        ) selected
      )
    `, queryOptions({ userId }));
  }

  return {
    lockUser,
    findAll,
    countActive,
    findById,
    clearDefaults,
    insert,
    update,
    softDelete,
    ensureDefault,
  };
}

module.exports = createAddressRepository;
