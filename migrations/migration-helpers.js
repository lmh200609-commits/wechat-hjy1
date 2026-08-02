function idColumn(DataTypes) {
  return {
    type: DataTypes.BIGINT.UNSIGNED,
    allowNull: false,
    autoIncrement: true,
    primaryKey: true,
  };
}

function createdAt(DataTypes, Sequelize) {
  return {
    type: DataTypes.DATE(3),
    allowNull: false,
    defaultValue: Sequelize.literal("CURRENT_TIMESTAMP(3)"),
  };
}

function updatedAt(DataTypes, Sequelize) {
  return {
    type: DataTypes.DATE(3),
    allowNull: false,
    defaultValue: Sequelize.literal("CURRENT_TIMESTAMP(3)"),
  };
}

function tableOptions() {
  return {
    charset: "utf8mb4",
    collate: "utf8mb4_unicode_ci",
    engine: "InnoDB",
  };
}

module.exports = { idColumn, createdAt, updatedAt, tableOptions };
