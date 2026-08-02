const { idColumn, createdAt, updatedAt, tableOptions } = require("./migration-helpers");

async function up({ queryInterface, Sequelize, DataTypes }) {
  const created = () => createdAt(DataTypes, Sequelize);
  const updated = () => updatedAt(DataTypes, Sequelize);
  const id = () => idColumn(DataTypes);
  const options = tableOptions();

  await queryInterface.createTable("users", {
    id: id(),
    openid: { type: DataTypes.STRING(64), allowNull: false },
    nickname: { type: DataTypes.STRING(64), allowNull: true },
    avatar_url: { type: DataTypes.STRING(512), allowNull: true },
    phone: { type: DataTypes.STRING(32), allowNull: true },
    status: { type: DataTypes.ENUM("ACTIVE", "DISABLED"), allowNull: false, defaultValue: "ACTIVE" },
    last_seen_at: { type: DataTypes.DATE(3), allowNull: true },
    created_at: created(),
    updated_at: updated(),
  }, options);
  await queryInterface.addIndex("users", ["openid"], { name: "uk_users_openid", unique: true });
  await queryInterface.addIndex("users", ["status", "id"], { name: "idx_users_status_id" });

  await queryInterface.createTable("admin_roles", {
    id: id(),
    code: { type: DataTypes.STRING(64), allowNull: false },
    name: { type: DataTypes.STRING(80), allowNull: false },
    description: { type: DataTypes.STRING(300), allowNull: true },
    is_system: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    created_at: created(),
    updated_at: updated(),
  }, options);
  await queryInterface.addIndex("admin_roles", ["code"], { name: "uk_admin_roles_code", unique: true });

  await queryInterface.createTable("admin_permissions", {
    id: id(),
    code: { type: DataTypes.STRING(100), allowNull: false },
    module: { type: DataTypes.STRING(64), allowNull: false },
    action: { type: DataTypes.STRING(64), allowNull: false },
    description: { type: DataTypes.STRING(300), allowNull: true },
    created_at: created(),
  }, options);
  await queryInterface.addIndex("admin_permissions", ["code"], { name: "uk_admin_permissions_code", unique: true });
  await queryInterface.addIndex("admin_permissions", ["module", "action"], { name: "uk_admin_permissions_module_action", unique: true });

  await queryInterface.createTable("admin_role_permissions", {
    role_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      primaryKey: true,
      references: { model: "admin_roles", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
    permission_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      primaryKey: true,
      references: { model: "admin_permissions", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
    created_at: created(),
  }, options);
  await queryInterface.addIndex("admin_role_permissions", ["permission_id"], { name: "idx_admin_role_permissions_permission" });

  await queryInterface.createTable("admin_users", {
    id: id(),
    username: { type: DataTypes.STRING(64), allowNull: false },
    password_hash: { type: DataTypes.STRING(255), allowNull: false },
    name: { type: DataTypes.STRING(80), allowNull: false },
    role_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: { model: "admin_roles", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    },
    status: { type: DataTypes.ENUM("ACTIVE", "DISABLED"), allowNull: false, defaultValue: "ACTIVE" },
    openid_binding: { type: DataTypes.STRING(64), allowNull: true },
    failed_login_attempts: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    locked_until: { type: DataTypes.DATE(3), allowNull: true },
    last_login_at: { type: DataTypes.DATE(3), allowNull: true },
    password_changed_at: { type: DataTypes.DATE(3), allowNull: true },
    created_at: created(),
    updated_at: updated(),
    deleted_at: { type: DataTypes.DATE(3), allowNull: true },
  }, options);
  await queryInterface.addIndex("admin_users", ["username"], { name: "uk_admin_users_username", unique: true });
  await queryInterface.addIndex("admin_users", ["openid_binding"], { name: "uk_admin_users_openid_binding", unique: true });
  await queryInterface.addIndex("admin_users", ["role_id", "status"], { name: "idx_admin_users_role_status" });

  await queryInterface.createTable("admin_sessions", {
    id: id(),
    admin_user_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: { model: "admin_users", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
    token_hash: { type: DataTypes.CHAR(64), allowNull: false },
    expires_at: { type: DataTypes.DATE(3), allowNull: false },
    last_seen_at: { type: DataTypes.DATE(3), allowNull: true },
    revoked_at: { type: DataTypes.DATE(3), allowNull: true },
    ip_address: { type: DataTypes.STRING(64), allowNull: true },
    user_agent: { type: DataTypes.STRING(500), allowNull: true },
    created_at: created(),
  }, options);
  await queryInterface.addIndex("admin_sessions", ["token_hash"], { name: "uk_admin_sessions_token_hash", unique: true });
  await queryInterface.addIndex("admin_sessions", ["admin_user_id", "expires_at"], { name: "idx_admin_sessions_user_expires" });

  await queryInterface.createTable("admin_operation_logs", {
    id: id(),
    admin_user_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true,
      references: { model: "admin_users", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },
    module: { type: DataTypes.STRING(64), allowNull: false },
    action: { type: DataTypes.STRING(80), allowNull: false },
    target_type: { type: DataTypes.STRING(64), allowNull: true },
    target_id: { type: DataTypes.STRING(80), allowNull: true },
    target_label: { type: DataTypes.STRING(200), allowNull: true },
    request_id: { type: DataTypes.STRING(80), allowNull: true },
    before_json: { type: DataTypes.JSON, allowNull: true },
    after_json: { type: DataTypes.JSON, allowNull: true },
    ip_address: { type: DataTypes.STRING(64), allowNull: true },
    created_at: created(),
  }, options);
  await queryInterface.addIndex("admin_operation_logs", ["admin_user_id", "created_at"], { name: "idx_admin_logs_user_created" });
  await queryInterface.addIndex("admin_operation_logs", ["module", "created_at"], { name: "idx_admin_logs_module_created" });
  await queryInterface.addIndex("admin_operation_logs", ["request_id"], { name: "idx_admin_logs_request" });

  await queryInterface.createTable("media_assets", {
    id: id(),
    object_key: { type: DataTypes.STRING(512), allowNull: false },
    url: { type: DataTypes.STRING(1024), allowNull: false },
    mime_type: { type: DataTypes.STRING(80), allowNull: false },
    byte_size: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    width: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    height: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    sha256: { type: DataTypes.CHAR(64), allowNull: false },
    status: { type: DataTypes.ENUM("ACTIVE", "QUARANTINED", "DELETED"), allowNull: false, defaultValue: "ACTIVE" },
    created_by_admin_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: { model: "admin_users", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    },
    created_at: created(),
    deleted_at: { type: DataTypes.DATE(3), allowNull: true },
  }, options);
  await queryInterface.addIndex("media_assets", ["object_key"], { name: "uk_media_assets_object_key", unique: true });
  await queryInterface.addIndex("media_assets", ["sha256", "status"], { name: "idx_media_assets_hash_status" });

  await queryInterface.createTable("categories", {
    id: id(),
    code: { type: DataTypes.STRING(64), allowNull: false },
    dimension: { type: DataTypes.ENUM("PRODUCT_CATEGORY", "MATERIAL"), allowNull: false },
    name: { type: DataTypes.STRING(40), allowNull: false },
    parent_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    icon_text: { type: DataTypes.STRING(8), allowNull: true },
    sort_order: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    created_at: created(),
    updated_at: updated(),
  }, options);
  await queryInterface.addConstraint("categories", {
    fields: ["parent_id"],
    type: "foreign key",
    name: "fk_categories_parent",
    references: { table: "categories", field: "id" },
    onUpdate: "CASCADE",
    onDelete: "RESTRICT",
  });
  await queryInterface.addIndex("categories", ["code"], { name: "uk_categories_code", unique: true });
  await queryInterface.addIndex("categories", ["dimension", "sort_order", "id"], { name: "idx_categories_dimension_sort" });
}

module.exports = { up };
