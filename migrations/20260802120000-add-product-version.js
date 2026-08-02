async function up({ queryInterface, DataTypes }) {
  await queryInterface.addColumn("products", "version", {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: false,
    defaultValue: 1,
  });
  await queryInterface.addIndex("categories", ["dimension", "name"], {
    name: "uk_categories_dimension_name",
    unique: true,
  });
}

module.exports = { up };
