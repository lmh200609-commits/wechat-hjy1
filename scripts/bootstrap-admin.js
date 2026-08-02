const { QueryTypes } = require("sequelize");
const database = require("../database");
const logger = require("../utils/logger");
const { hashPassword } = require("../utils/password");

function validateInput() {
  const username = String(process.env.ADMIN_BOOTSTRAP_USERNAME || "").trim().toLowerCase();
  const name = String(process.env.ADMIN_BOOTSTRAP_NAME || "").trim();
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  if (!/^[a-z][a-z0-9._-]{2,63}$/.test(username)) throw new Error("ADMIN_BOOTSTRAP_USERNAME is invalid");
  if ([...name].length < 2 || [...name].length > 40) throw new Error("ADMIN_BOOTSTRAP_NAME is invalid");
  if (
    typeof password !== "string"
    || password.length < 12
    || password.length > 128
    || !/[a-z]/.test(password)
    || !/[A-Z]/.test(password)
    || !/\d/.test(password)
    || !/[^A-Za-z0-9]/.test(password)
  ) {
    throw new Error("ADMIN_BOOTSTRAP_PASSWORD must be 12-128 characters with upper, lower, digit, and symbol");
  }
  return { username, name, password };
}

async function main() {
  try {
    await database.connect();
    const rows = await database.sequelize.query(
      "SELECT CAST(id AS CHAR) AS id FROM admin_users WHERE deleted_at IS NULL ORDER BY id ASC LIMIT 1",
      { type: QueryTypes.SELECT },
    );
    if (rows[0]) {
      await database.sequelize.query(`
        INSERT INTO home_settings (
          id, featured_title, show_featured, show_collections, show_journal,
          version, updated_by_admin_id, updated_at
        ) VALUES (1, '精选雅物', 1, 1, 1, 1, :adminId, CURRENT_TIMESTAMP(3))
        ON DUPLICATE KEY UPDATE id = id
      `, { replacements: { adminId: rows[0].id } });
      logger.info("admin_bootstrap_skipped", { reason: "administrator_already_exists" });
      return;
    }
    const input = validateInput();
    const passwordHash = await hashPassword(input.password);
    await database.sequelize.transaction(async (transaction) => {
      const roles = await database.sequelize.query(`
        SELECT CAST(id AS CHAR) AS id FROM admin_roles
        WHERE code = 'SUPER_ADMIN' AND enabled = 1 LIMIT 1 FOR UPDATE
      `, { type: QueryTypes.SELECT, transaction });
      if (!roles[0]) throw new Error("SUPER_ADMIN role is unavailable; run migrations first");
      await database.sequelize.query(`
        INSERT INTO admin_users (
          username, password_hash, name, role_id, status, failed_login_attempts,
          password_changed_at, created_at, updated_at
        ) VALUES (
          :username, :passwordHash, :name, :roleId, 'ACTIVE', 0,
          CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
        )
      `, {
        replacements: { username: input.username, passwordHash, name: input.name, roleId: roles[0].id },
        transaction,
      });
      const ids = await database.sequelize.query(
        "SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id",
        { type: QueryTypes.SELECT, transaction },
      );
      await database.sequelize.query(`
        INSERT INTO home_settings (
          id, featured_title, show_featured, show_collections, show_journal,
          version, updated_by_admin_id, updated_at
        ) VALUES (1, '精选雅物', 1, 1, 1, 1, :adminId, CURRENT_TIMESTAMP(3))
        ON DUPLICATE KEY UPDATE id = id
      `, { replacements: { adminId: ids[0].id }, transaction });
      await database.sequelize.query(`
        INSERT INTO admin_operation_logs (
          admin_user_id, module, action, target_type, target_id, target_label, created_at
        ) VALUES (:adminId, 'admins', 'BOOTSTRAP_SUPER_ADMIN', 'ADMIN_USER', :adminId, :username, CURRENT_TIMESTAMP(3))
      `, { replacements: { adminId: ids[0].id, username: input.username }, transaction });
    });
    logger.info("admin_bootstrap_complete");
  } catch (error) {
    logger.error("admin_bootstrap_failed", { error });
    process.exitCode = 1;
  } finally {
    await database.close().catch(() => {});
  }
}

main();
