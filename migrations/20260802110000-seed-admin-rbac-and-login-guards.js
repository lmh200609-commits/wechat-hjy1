const { createdAt, updatedAt, tableOptions } = require("./migration-helpers");
const { PERMISSIONS, ROLES } = require("../constants/admin-rbac");

async function up({ queryInterface, Sequelize, DataTypes }) {
  const created = () => createdAt(DataTypes, Sequelize);
  const updated = () => updatedAt(DataTypes, Sequelize);

  await queryInterface.createTable("admin_login_guards", {
    scope_hash: { type: DataTypes.CHAR(64), allowNull: false, primaryKey: true },
    attempt_count: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    window_started_at: { type: DataTypes.DATE(3), allowNull: false },
    blocked_until: { type: DataTypes.DATE(3), allowNull: true },
    expires_at: { type: DataTypes.DATE(3), allowNull: false },
    created_at: created(),
    updated_at: updated(),
  }, tableOptions());
  await queryInterface.addIndex("admin_login_guards", ["expires_at"], {
    name: "idx_admin_login_guards_expires",
  });
  await queryInterface.addIndex("admin_sessions", ["expires_at", "revoked_at"], {
    name: "idx_admin_sessions_expiry_revoked",
  });

  await queryInterface.sequelize.transaction(async (transaction) => {
    for (const permission of PERMISSIONS) {
      await queryInterface.sequelize.query(`
        INSERT INTO admin_permissions (code, module, action, description, created_at)
        VALUES (:code, :module, :action, :description, CURRENT_TIMESTAMP(3))
        ON DUPLICATE KEY UPDATE module = VALUES(module), action = VALUES(action), description = VALUES(description)
      `, { replacements: permission, transaction });
    }
    for (const role of ROLES) {
      await queryInterface.sequelize.query(`
        INSERT INTO admin_roles (code, name, description, is_system, enabled, created_at, updated_at)
        VALUES (:code, :name, :description, 1, 1, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
        ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description),
          is_system = 1, enabled = 1, updated_at = CURRENT_TIMESTAMP(3)
      `, { replacements: role, transaction });
      await queryInterface.sequelize.query(`
        DELETE arp FROM admin_role_permissions arp
        INNER JOIN admin_roles ar ON ar.id = arp.role_id
        WHERE ar.code = :code
      `, { replacements: { code: role.code }, transaction });
      for (const permissionCode of role.permissionCodes) {
        await queryInterface.sequelize.query(`
          INSERT INTO admin_role_permissions (role_id, permission_id, created_at)
          SELECT ar.id, ap.id, CURRENT_TIMESTAMP(3)
          FROM admin_roles ar INNER JOIN admin_permissions ap
          WHERE ar.code = :roleCode AND ap.code = :permissionCode
        `, { replacements: { roleCode: role.code, permissionCode }, transaction });
      }
    }
  });
}

module.exports = { up };
