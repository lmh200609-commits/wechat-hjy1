async function addColumn(queryInterface, table, name, definition) {
  const columns = await queryInterface.describeTable(table);
  if (!columns[name]) await queryInterface.addColumn(table, name, definition);
}

async function addIndex(queryInterface, table, fields, options) {
  const indexes = await queryInterface.showIndex(table);
  if (!indexes.some((index) => index.name === options.name)) {
    await queryInterface.addIndex(table, fields, options);
  }
}

async function addConstraint(queryInterface, table, options) {
  const constraints = await queryInterface.getForeignKeyReferencesForTable(table);
  if (!constraints.some((item) => item.constraintName === options.name)) {
    await queryInterface.addConstraint(table, options);
  }
}

async function up({ queryInterface, DataTypes }) {
  await queryInterface.changeColumn("media_assets", "created_by_admin_id", {
    type: DataTypes.BIGINT.UNSIGNED,
    allowNull: true,
  });
  await addColumn(queryInterface, "media_assets", "created_by_user_id", {
    type: DataTypes.BIGINT.UNSIGNED,
    allowNull: true,
    after: "created_by_admin_id",
  });
  await addColumn(queryInterface, "media_assets", "purpose", {
    type: DataTypes.ENUM("CATALOG", "USER_AVATAR"),
    allowNull: false,
    defaultValue: "CATALOG",
    after: "created_by_user_id",
  });
  await addConstraint(queryInterface, "media_assets", {
    fields: ["created_by_user_id"],
    type: "foreign key",
    name: "fk_media_assets_created_by_user",
    references: { table: "users", field: "id" },
    onUpdate: "CASCADE",
    onDelete: "RESTRICT",
  });
  await addIndex(queryInterface, "media_assets", ["created_by_user_id", "purpose", "status"], {
    name: "idx_media_assets_user_avatar",
  });

  await addColumn(queryInterface, "users", "avatar_media_id", {
    type: DataTypes.BIGINT.UNSIGNED,
    allowNull: true,
    after: "avatar_url",
  });
  await addConstraint(queryInterface, "users", {
    fields: ["avatar_media_id"],
    type: "foreign key",
    name: "fk_users_avatar_media",
    references: { table: "media_assets", field: "id" },
    onUpdate: "CASCADE",
    onDelete: "SET NULL",
  });
  await addIndex(queryInterface, "users", ["avatar_media_id"], { name: "idx_users_avatar_media" });

  await queryInterface.sequelize.query(`
    UPDATE media_assets
    SET purpose = 'CATALOG'
    WHERE purpose IS NULL OR purpose = ''
  `);
  await queryInterface.sequelize.query(`
    UPDATE media_assets ma
    SET ma.reference_count = ma.reference_count + (
      SELECT COUNT(*) FROM users u WHERE u.avatar_media_id = ma.id
    )
  `);
  await queryInterface.sequelize.query(`
    UPDATE media_assets
    SET reference_status = CASE WHEN reference_count > 0 THEN 'REFERENCED' ELSE 'UNREFERENCED' END
  `);
}

module.exports = { up };
