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

async function up({ queryInterface, DataTypes, Sequelize }) {
  await addColumn(queryInterface, "media_assets", "file_id", { type: DataTypes.STRING(512), allowNull: true, after: "object_key" });
  await queryInterface.changeColumn("media_assets", "file_id", { type: DataTypes.STRING(512), allowNull: true });
  await addColumn(queryInterface, "media_assets", "cloud_path", { type: DataTypes.STRING(512), allowNull: true, after: "file_id" });
  await addColumn(queryInterface, "media_assets", "storage_provider", { type: DataTypes.ENUM("CLOUDBASE", "MOCK", "LEGACY_EXTERNAL"), allowNull: false, defaultValue: "LEGACY_EXTERNAL", after: "cloud_path" });
  await addColumn(queryInterface, "media_assets", "original_filename", { type: DataTypes.STRING(255), allowNull: true, after: "storage_provider" });
  await addColumn(queryInterface, "media_assets", "reference_count", { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0, after: "sha256" });
  await addColumn(queryInterface, "media_assets", "reference_status", { type: DataTypes.ENUM("UNREFERENCED", "REFERENCED"), allowNull: false, defaultValue: "UNREFERENCED", after: "reference_count" });
  await addColumn(queryInterface, "media_assets", "updated_at", { type: DataTypes.DATE(3), allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP(3)"), after: "created_at" });
  await queryInterface.changeColumn("media_assets", "url", { type: DataTypes.STRING(1024), allowNull: true });
  await queryInterface.sequelize.query("ALTER TABLE `media_assets` MODIFY `status` ENUM('ACTIVE','QUARANTINED','DELETING','DELETED') NOT NULL DEFAULT 'ACTIVE'");
  await addIndex(queryInterface, "media_assets", ["file_id"], { name: "uk_media_assets_file_id", unique: true });
  await addIndex(queryInterface, "media_assets", ["cloud_path"], { name: "uk_media_assets_cloud_path", unique: true });
  await addIndex(queryInterface, "media_assets", ["reference_status", "status"], { name: "idx_media_assets_reference_status" });

  await addColumn(queryInterface, "articles", "version", { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1, after: "is_hot" });
  await addColumn(queryInterface, "collections", "version", { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1, after: "sort_order" });
  await addColumn(queryInterface, "banners", "version", { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1, after: "sort_order" });

  await queryInterface.sequelize.query(`
    UPDATE media_assets ma SET ma.reference_count = (
      (SELECT COUNT(*) FROM product_images pi INNER JOIN products p ON p.id = pi.product_id
       WHERE pi.media_id = ma.id AND p.deleted_at IS NULL AND p.sale_status <> 'DELETED')
      + (SELECT COUNT(*) FROM banners WHERE image_media_id = ma.id)
      + (SELECT COUNT(*) FROM collections WHERE cover_media_id = ma.id AND deleted_at IS NULL)
      + (SELECT COUNT(*) FROM articles WHERE cover_media_id = ma.id AND deleted_at IS NULL)
    )
  `);
  const [jsonSources] = await queryInterface.sequelize.query(`
    SELECT detail_sections_json AS body_json FROM products
    WHERE deleted_at IS NULL AND sale_status <> 'DELETED'
    UNION ALL
    SELECT body_json FROM articles WHERE deleted_at IS NULL
  `);
  const increments = new Map();
  for (const source of jsonSources) {
    let blocks = source.body_json;
    if (typeof blocks === "string") {
      try { blocks = JSON.parse(blocks); } catch { blocks = []; }
    }
    if (!Array.isArray(blocks)) continue;
    for (const block of blocks) {
      if (String(block?.type || "").toUpperCase() !== "IMAGE" || !/^\d+$/.test(String(block.mediaId || ""))) continue;
      const id = String(block.mediaId);
      increments.set(id, (increments.get(id) || 0) + 1);
    }
  }
  for (const [id, increment] of increments) {
    await queryInterface.sequelize.query(
      "UPDATE media_assets SET reference_count = reference_count + :increment WHERE id = :id",
      { replacements: { id, increment } },
    );
  }
  await queryInterface.sequelize.query("UPDATE media_assets SET reference_status = CASE WHEN reference_count > 0 THEN 'REFERENCED' ELSE 'UNREFERENCED' END");
}

module.exports = { up };
