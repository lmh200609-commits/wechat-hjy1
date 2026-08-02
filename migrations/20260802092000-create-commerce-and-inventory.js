const { idColumn, createdAt, updatedAt, tableOptions } = require("./migration-helpers");

async function up({ queryInterface, Sequelize, DataTypes }) {
  const created = () => createdAt(DataTypes, Sequelize);
  const updated = () => updatedAt(DataTypes, Sequelize);
  const id = () => idColumn(DataTypes);
  const options = tableOptions();

  await queryInterface.createTable("favorites", {
    user_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      primaryKey: true,
      references: { model: "users", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
    product_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      primaryKey: true,
      references: { model: "products", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
    created_at: created(),
  }, options);
  await queryInterface.addIndex("favorites", ["user_id", "created_at"], { name: "idx_favorites_user_created" });

  await queryInterface.createTable("cart_items", {
    id: id(),
    user_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: { model: "users", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
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
    checked: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    created_at: created(),
    updated_at: updated(),
  }, options);
  await queryInterface.addIndex("cart_items", ["user_id", "product_id", "variant_id"], { name: "uk_cart_items_user_product_variant", unique: true });
  await queryInterface.addIndex("cart_items", ["user_id", "updated_at", "id"], { name: "idx_cart_items_user_updated" });
  await queryInterface.sequelize.query(
    "ALTER TABLE `cart_items` ADD CONSTRAINT `chk_cart_items_quantity` CHECK (`quantity` BETWEEN 1 AND 99)",
  );

  await queryInterface.createTable("user_addresses", {
    id: id(),
    user_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: { model: "users", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
    recipient_name: { type: DataTypes.STRING(40), allowNull: false },
    phone: { type: DataTypes.STRING(32), allowNull: false },
    province: { type: DataTypes.STRING(80), allowNull: false },
    city: { type: DataTypes.STRING(80), allowNull: false },
    district: { type: DataTypes.STRING(80), allowNull: false },
    detail: { type: DataTypes.STRING(240), allowNull: false },
    postal_code: { type: DataTypes.STRING(20), allowNull: true },
    label: { type: DataTypes.STRING(30), allowNull: true },
    is_default: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    created_at: created(),
    updated_at: updated(),
    deleted_at: { type: DataTypes.DATE(3), allowNull: true },
  }, options);
  await queryInterface.addIndex("user_addresses", ["user_id", "deleted_at", "id"], { name: "idx_user_addresses_user_active" });
  await queryInterface.addIndex("user_addresses", ["user_id", "is_default", "deleted_at"], { name: "idx_user_addresses_default" });

  await queryInterface.createTable("orders", {
    id: id(),
    order_no: { type: DataTypes.STRING(40), allowNull: false },
    user_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: { model: "users", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    },
    status: {
      type: DataTypes.ENUM("PENDING_CONFIRMATION", "CONFIRMED", "CANCELLED", "CLOSED"),
      allowNull: false,
      defaultValue: "PENDING_CONFIRMATION",
    },
    payment_status: {
      type: DataTypes.ENUM("NOT_ENABLED", "UNPAID", "PAID", "REFUNDING", "REFUNDED"),
      allowNull: false,
      defaultValue: "NOT_ENABLED",
    },
    fulfillment_status: {
      type: DataTypes.ENUM("NOT_APPLICABLE", "UNSHIPPED", "SHIPPED", "RECEIVED"),
      allowNull: false,
      defaultValue: "NOT_APPLICABLE",
    },
    payment_channel: { type: DataTypes.STRING(40), allowNull: true },
    payment_order_no: { type: DataTypes.STRING(80), allowNull: true },
    prepay_id: { type: DataTypes.STRING(128), allowNull: true },
    wechat_transaction_id: { type: DataTypes.STRING(80), allowNull: true },
    currency: { type: DataTypes.CHAR(3), allowNull: false, defaultValue: "CNY" },
    items_amount: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    discount_amount: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, defaultValue: 0 },
    shipping_amount: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, defaultValue: 0 },
    payable_amount: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    paid_amount: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, defaultValue: 0 },
    item_count: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    source: { type: DataTypes.ENUM("CART", "BUY_NOW"), allowNull: false },
    remark: { type: DataTypes.STRING(300), allowNull: true },
    receiver_name: { type: DataTypes.STRING(40), allowNull: false },
    receiver_phone: { type: DataTypes.STRING(32), allowNull: false },
    receiver_province: { type: DataTypes.STRING(80), allowNull: false },
    receiver_city: { type: DataTypes.STRING(80), allowNull: false },
    receiver_district: { type: DataTypes.STRING(80), allowNull: false },
    receiver_detail: { type: DataTypes.STRING(240), allowNull: false },
    idempotency_key: { type: DataTypes.STRING(80), allowNull: false },
    cancel_reason: { type: DataTypes.STRING(300), allowNull: true },
    expires_at: { type: DataTypes.DATE(3), allowNull: false },
    created_at: created(),
    updated_at: updated(),
    confirmed_at: { type: DataTypes.DATE(3), allowNull: true },
    cancelled_at: { type: DataTypes.DATE(3), allowNull: true },
    closed_at: { type: DataTypes.DATE(3), allowNull: true },
    paid_at: { type: DataTypes.DATE(3), allowNull: true },
    payment_expired_at: { type: DataTypes.DATE(3), allowNull: true },
    shipped_at: { type: DataTypes.DATE(3), allowNull: true },
    completed_at: { type: DataTypes.DATE(3), allowNull: true },
    refunded_at: { type: DataTypes.DATE(3), allowNull: true },
  }, options);
  await queryInterface.addIndex("orders", ["order_no"], { name: "uk_orders_order_no", unique: true });
  await queryInterface.addIndex("orders", ["user_id", "idempotency_key"], { name: "uk_orders_user_idempotency", unique: true });
  await queryInterface.addIndex("orders", ["user_id", "status", "created_at", "id"], { name: "idx_orders_user_status_created" });
  await queryInterface.addIndex("orders", ["status", "expires_at"], { name: "idx_orders_status_expires" });
  await queryInterface.addIndex("orders", ["payment_status", "created_at"], { name: "idx_orders_payment_created" });
  await queryInterface.sequelize.query(
    "ALTER TABLE `orders` ADD CONSTRAINT `chk_orders_amounts` CHECK (`items_amount` >= `discount_amount` AND `payable_amount` = `items_amount` - `discount_amount` + `shipping_amount` AND `paid_amount` <= `payable_amount`), ADD CONSTRAINT `chk_orders_item_count` CHECK (`item_count` > 0)",
  );

  await queryInterface.createTable("order_items", {
    id: id(),
    order_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: { model: "orders", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
    product_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true,
      references: { model: "products", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },
    variant_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: { model: "product_variants", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    },
    product_code_snapshot: { type: DataTypes.STRING(64), allowNull: false },
    product_name_snapshot: { type: DataTypes.STRING(160), allowNull: false },
    product_subtitle_snapshot: { type: DataTypes.STRING(200), allowNull: true },
    image_url_snapshot: { type: DataTypes.STRING(512), allowNull: true },
    spec_snapshot: { type: DataTypes.STRING(160), allowNull: true },
    unit_price_amount: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    quantity: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    subtotal_amount: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    created_at: created(),
  }, options);
  await queryInterface.addIndex("order_items", ["order_id", "id"], { name: "idx_order_items_order" });
  await queryInterface.addIndex("order_items", ["product_id", "created_at"], { name: "idx_order_items_product_created" });
  await queryInterface.addIndex("order_items", ["variant_id", "created_at"], { name: "idx_order_items_variant_created" });
  await queryInterface.sequelize.query(
    "ALTER TABLE `order_items` ADD CONSTRAINT `chk_order_items_amount` CHECK (`quantity` > 0 AND `subtotal_amount` = `unit_price_amount` * `quantity`)",
  );

  await queryInterface.createTable("inventory_movements", {
    id: id(),
    variant_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: { model: "product_variants", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    },
    change_quantity: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    reserved_change: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    before_quantity: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    after_quantity: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    before_reserved_quantity: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    after_reserved_quantity: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    reason_type: {
      type: DataTypes.ENUM("INITIAL", "PURCHASE", "ADJUSTMENT", "DAMAGE", "OFFLINE_SALE", "ORDER_RESERVE", "ORDER_CONFIRM", "ORDER_RELEASE", "RETURN"),
      allowNull: false,
    },
    reference_type: { type: DataTypes.STRING(64), allowNull: true },
    reference_id: { type: DataTypes.STRING(80), allowNull: true },
    note: { type: DataTypes.STRING(300), allowNull: true },
    operator_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true,
      references: { model: "admin_users", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },
    created_at: created(),
  }, options);
  await queryInterface.addIndex("inventory_movements", ["variant_id", "created_at", "id"], { name: "idx_inventory_movements_variant_created" });
  await queryInterface.addIndex("inventory_movements", ["reference_type", "reference_id"], { name: "idx_inventory_movements_reference" });
  await queryInterface.sequelize.query(
    "ALTER TABLE `inventory_movements` ADD CONSTRAINT `chk_inventory_movement_after` CHECK (`after_reserved_quantity` <= `after_quantity`)",
  );

  await queryInterface.createTable("payment_records", {
    id: id(),
    order_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: { model: "orders", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    },
    merchant_order_no: { type: DataTypes.STRING(80), allowNull: false },
    prepay_id: { type: DataTypes.STRING(128), allowNull: true },
    transaction_id: { type: DataTypes.STRING(80), allowNull: true },
    status: { type: DataTypes.ENUM("CREATED", "PENDING", "PAID", "FAILED", "CLOSED"), allowNull: false },
    request_amount: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    paid_amount: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, defaultValue: 0 },
    callback_payload_hash: { type: DataTypes.CHAR(64), allowNull: true },
    paid_at: { type: DataTypes.DATE(3), allowNull: true },
    created_at: created(),
    updated_at: updated(),
  }, options);
  await queryInterface.addIndex("payment_records", ["merchant_order_no"], { name: "uk_payment_records_merchant_no", unique: true });
  await queryInterface.addIndex("payment_records", ["transaction_id"], { name: "uk_payment_records_transaction_id", unique: true });
  await queryInterface.addIndex("payment_records", ["order_id", "created_at"], { name: "idx_payment_records_order_created" });

  await queryInterface.createTable("refunds", {
    id: id(),
    order_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: { model: "orders", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    },
    refund_no: { type: DataTypes.STRING(80), allowNull: false },
    wechat_refund_id: { type: DataTypes.STRING(80), allowNull: true },
    reason: { type: DataTypes.STRING(300), allowNull: false },
    request_amount: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    refunded_amount: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, defaultValue: 0 },
    status: { type: DataTypes.ENUM("CREATED", "PROCESSING", "SUCCEEDED", "FAILED", "CLOSED"), allowNull: false },
    requested_at: { type: DataTypes.DATE(3), allowNull: false },
    succeeded_at: { type: DataTypes.DATE(3), allowNull: true },
    created_at: created(),
    updated_at: updated(),
  }, options);
  await queryInterface.addIndex("refunds", ["refund_no"], { name: "uk_refunds_refund_no", unique: true });
  await queryInterface.addIndex("refunds", ["wechat_refund_id"], { name: "uk_refunds_wechat_refund_id", unique: true });
  await queryInterface.addIndex("refunds", ["order_id", "created_at"], { name: "idx_refunds_order_created" });

  await queryInterface.createTable("shipments", {
    id: id(),
    order_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: { model: "orders", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    },
    carrier_code: { type: DataTypes.STRING(40), allowNull: false },
    carrier_name: { type: DataTypes.STRING(80), allowNull: false },
    tracking_no: { type: DataTypes.STRING(100), allowNull: false },
    status: { type: DataTypes.ENUM("CREATED", "SHIPPED", "IN_TRANSIT", "DELIVERED", "CANCELLED"), allowNull: false },
    shipped_at: { type: DataTypes.DATE(3), allowNull: true },
    received_at: { type: DataTypes.DATE(3), allowNull: true },
    created_at: created(),
    updated_at: updated(),
  }, options);
  await queryInterface.addIndex("shipments", ["order_id", "created_at"], { name: "idx_shipments_order_created" });
  await queryInterface.addIndex("shipments", ["carrier_code", "tracking_no"], { name: "uk_shipments_carrier_tracking", unique: true });
}

module.exports = { up };
