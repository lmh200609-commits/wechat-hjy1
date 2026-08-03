const { idColumn, createdAt, updatedAt, tableOptions } = require("./migration-helpers");

async function up({ queryInterface, DataTypes, Sequelize }) {
  await queryInterface.createTable("admin_idempotency_records", {
    id: idColumn(DataTypes),
    admin_user_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: { model: "admin_users", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    },
    scope: { type: DataTypes.STRING(80), allowNull: false },
    idempotency_key: { type: DataTypes.STRING(80), allowNull: false },
    request_hash: { type: DataTypes.STRING(64), allowNull: false },
    status: { type: DataTypes.ENUM("PROCESSING", "COMPLETED"), allowNull: false, defaultValue: "PROCESSING" },
    response_status: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: true },
    response_code: { type: DataTypes.STRING(64), allowNull: true },
    response_message: { type: DataTypes.STRING(255), allowNull: true },
    response_data_json: { type: DataTypes.TEXT("long"), allowNull: true },
    expires_at: { type: DataTypes.DATE(3), allowNull: false },
    created_at: createdAt(DataTypes, Sequelize),
    updated_at: updatedAt(DataTypes, Sequelize),
  }, tableOptions());
  await queryInterface.addIndex("admin_idempotency_records", ["admin_user_id", "scope", "idempotency_key"], {
    name: "uk_admin_idempotency_scope_key",
    unique: true,
  });
  await queryInterface.addIndex("admin_idempotency_records", ["expires_at"], {
    name: "idx_admin_idempotency_expires_at",
  });
}

module.exports = { up };
