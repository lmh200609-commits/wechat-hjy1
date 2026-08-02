const { idColumn, createdAt, tableOptions } = require("./migration-helpers");

async function up({ queryInterface, Sequelize, DataTypes }) {
  const id = () => idColumn(DataTypes);
  const created = () => createdAt(DataTypes, Sequelize);
  const options = tableOptions();

  await queryInterface.createTable("checkout_sessions", {
    id: id(),
    user_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: { model: "users", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
    token_hash: { type: DataTypes.CHAR(64), allowNull: false },
    source: { type: DataTypes.ENUM("CART", "BUY_NOW"), allowNull: false },
    status: {
      type: DataTypes.ENUM("ACTIVE", "CONSUMED", "EXPIRED"),
      allowNull: false,
      defaultValue: "ACTIVE",
    },
    quoted_items_amount: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    quoted_item_count: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    expires_at: { type: DataTypes.DATE(3), allowNull: false },
    consumed_order_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true,
      references: { model: "orders", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },
    created_at: created(),
    consumed_at: { type: DataTypes.DATE(3), allowNull: true },
  }, options);
  await queryInterface.addIndex("checkout_sessions", ["token_hash"], {
    name: "uk_checkout_sessions_token_hash", unique: true,
  });
  await queryInterface.addIndex("checkout_sessions", ["user_id", "status", "expires_at"], {
    name: "idx_checkout_sessions_user_status_expires",
  });
  await queryInterface.addIndex("checkout_sessions", ["consumed_order_id"], {
    name: "idx_checkout_sessions_order",
  });
  await queryInterface.sequelize.query(
    "ALTER TABLE `checkout_sessions` ADD CONSTRAINT `chk_checkout_session_totals` CHECK (`quoted_items_amount` > 0 AND `quoted_item_count` > 0)",
  );

  await queryInterface.createTable("checkout_session_items", {
    id: id(),
    checkout_session_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: { model: "checkout_sessions", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
    cart_item_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true,
      references: { model: "cart_items", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },
    product_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: { model: "products", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    },
    variant_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: { model: "product_variants", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    },
    quantity: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    quoted_unit_price_amount: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    quoted_variant_version: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    created_at: created(),
  }, options);
  await queryInterface.addIndex("checkout_session_items", ["checkout_session_id", "id"], {
    name: "idx_checkout_items_session",
  });
  await queryInterface.addIndex("checkout_session_items", ["variant_id", "checkout_session_id"], {
    name: "idx_checkout_items_variant_session",
  });
  await queryInterface.sequelize.query(
    "ALTER TABLE `checkout_session_items` ADD CONSTRAINT `chk_checkout_item_values` CHECK (`quantity` BETWEEN 1 AND 99 AND `quoted_unit_price_amount` > 0)",
  );
}

module.exports = { up };
