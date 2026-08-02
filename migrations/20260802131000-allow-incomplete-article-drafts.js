async function up({ queryInterface, DataTypes }) {
  await queryInterface.changeColumn("articles", "cover_media_id", {
    type: DataTypes.BIGINT.UNSIGNED,
    allowNull: true,
    references: { model: "media_assets", key: "id" },
    onUpdate: "CASCADE",
    onDelete: "RESTRICT",
  });
}

module.exports = { up };
