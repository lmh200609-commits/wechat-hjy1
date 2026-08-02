const { idColumn, createdAt, updatedAt, tableOptions } = require("./migration-helpers");

async function up({ queryInterface, Sequelize, DataTypes }) {
  const created = () => createdAt(DataTypes, Sequelize);
  const updated = () => updatedAt(DataTypes, Sequelize);
  const id = () => idColumn(DataTypes);
  const options = tableOptions();
  const categoryReference = {
    type: DataTypes.BIGINT.UNSIGNED,
    allowNull: false,
    references: { model: "categories", key: "id" },
    onUpdate: "CASCADE",
    onDelete: "RESTRICT",
  };

  await queryInterface.createTable("products", {
    id: id(),
    code: { type: DataTypes.STRING(64), allowNull: false },
    name: { type: DataTypes.STRING(80), allowNull: false },
    subtitle: { type: DataTypes.STRING(160), allowNull: false },
    category_id: categoryReference,
    material_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true,
      references: { model: "categories", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    },
    craft: { type: DataTypes.STRING(100), allowNull: true },
    price_amount: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, defaultValue: 0 },
    original_price_amount: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    currency: { type: DataTypes.CHAR(3), allowNull: false, defaultValue: "CNY" },
    sale_status: {
      type: DataTypes.ENUM("DRAFT", "ON_SALE", "OFF_SHELF", "DELETED"),
      allowNull: false,
      defaultValue: "DRAFT",
    },
    sales_count: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, defaultValue: 0 },
    low_stock_threshold: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    tags_json: { type: DataTypes.JSON, allowNull: true },
    attributes_json: { type: DataTypes.JSON, allowNull: true },
    detail_sections_json: { type: DataTypes.JSON, allowNull: true },
    published_at: { type: DataTypes.DATE(3), allowNull: true },
    created_at: created(),
    updated_at: updated(),
    deleted_at: { type: DataTypes.DATE(3), allowNull: true },
  }, options);
  await queryInterface.addIndex("products", ["code"], { name: "uk_products_code", unique: true });
  await queryInterface.addIndex("products", ["sale_status", "published_at", "id"], { name: "idx_products_status_published" });
  await queryInterface.addIndex("products", ["category_id", "sale_status", "id"], { name: "idx_products_category_status" });
  await queryInterface.addIndex("products", ["material_id", "sale_status", "id"], { name: "idx_products_material_status" });

  await queryInterface.createTable("product_variants", {
    id: id(),
    product_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: { model: "products", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    },
    sku_code: { type: DataTypes.STRING(80), allowNull: false },
    spec_label: { type: DataTypes.STRING(100), allowNull: false },
    price_amount: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    original_price_amount: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    on_hand_quantity: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    reserved_quantity: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    low_stock_threshold: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    sort_order: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    version: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 },
    created_at: created(),
    updated_at: updated(),
  }, options);
  await queryInterface.addIndex("product_variants", ["sku_code"], { name: "uk_product_variants_sku_code", unique: true });
  await queryInterface.addIndex("product_variants", ["product_id", "sort_order", "id"], { name: "idx_product_variants_product_sort" });
  await queryInterface.sequelize.query(
    "ALTER TABLE `product_variants` ADD CONSTRAINT `chk_product_variants_price` CHECK (`price_amount` > 0 AND (`original_price_amount` IS NULL OR `original_price_amount` >= `price_amount`)), ADD CONSTRAINT `chk_product_variants_stock` CHECK (`reserved_quantity` <= `on_hand_quantity`)",
  );

  await queryInterface.createTable("product_images", {
    id: id(),
    product_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: { model: "products", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
    media_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: { model: "media_assets", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    },
    kind: { type: DataTypes.ENUM("PRIMARY", "GALLERY", "DETAIL"), allowNull: false },
    alt_text: { type: DataTypes.STRING(160), allowNull: true },
    sort_order: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    created_at: created(),
  }, options);
  await queryInterface.addIndex("product_images", ["product_id", "sort_order", "id"], { name: "idx_product_images_product_sort" });
  await queryInterface.addIndex("product_images", ["product_id", "media_id"], { name: "uk_product_images_product_media", unique: true });

  await queryInterface.createTable("banners", {
    id: id(),
    title: { type: DataTypes.STRING(80), allowNull: false },
    subtitle: { type: DataTypes.STRING(120), allowNull: true },
    image_media_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: { model: "media_assets", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    },
    link_type: { type: DataTypes.ENUM("NONE", "PRODUCT"), allowNull: false, defaultValue: "NONE" },
    target_product_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true,
      references: { model: "products", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },
    visible: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    sort_order: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    starts_at: { type: DataTypes.DATE(3), allowNull: true },
    ends_at: { type: DataTypes.DATE(3), allowNull: true },
    created_at: created(),
    updated_at: updated(),
  }, options);
  await queryInterface.addIndex("banners", ["visible", "sort_order", "id"], { name: "idx_banners_visible_sort" });
  await queryInterface.sequelize.query(
    "ALTER TABLE `banners` ADD CONSTRAINT `chk_banners_target` CHECK ((`link_type` = 'NONE' AND `target_product_id` IS NULL) OR (`link_type` = 'PRODUCT' AND `target_product_id` IS NOT NULL)), ADD CONSTRAINT `chk_banners_schedule` CHECK (`starts_at` IS NULL OR `ends_at` IS NULL OR `starts_at` < `ends_at`)",
  );

  await queryInterface.createTable("collections", {
    id: id(),
    code: { type: DataTypes.STRING(64), allowNull: false },
    title: { type: DataTypes.STRING(80), allowNull: false },
    latin_title: { type: DataTypes.STRING(120), allowNull: true },
    description: { type: DataTypes.STRING(500), allowNull: false },
    cover_media_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: { model: "media_assets", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    },
    visible: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    sort_order: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    created_at: created(),
    updated_at: updated(),
    deleted_at: { type: DataTypes.DATE(3), allowNull: true },
  }, options);
  await queryInterface.addIndex("collections", ["code"], { name: "uk_collections_code", unique: true });
  await queryInterface.addIndex("collections", ["visible", "sort_order", "id"], { name: "idx_collections_visible_sort" });

  await queryInterface.createTable("collection_products", {
    collection_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      primaryKey: true,
      references: { model: "collections", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
    product_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      primaryKey: true,
      references: { model: "products", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    },
    sort_order: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    created_at: created(),
  }, options);
  await queryInterface.addIndex("collection_products", ["collection_id", "sort_order", "product_id"], { name: "idx_collection_products_sort" });

  await queryInterface.createTable("articles", {
    id: id(),
    code: { type: DataTypes.STRING(64), allowNull: false },
    title: { type: DataTypes.STRING(160), allowNull: false },
    tag: { type: DataTypes.STRING(40), allowNull: false },
    summary: { type: DataTypes.STRING(500), allowNull: false },
    author_name: { type: DataTypes.STRING(80), allowNull: false },
    cover_media_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: { model: "media_assets", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    },
    body_json: { type: DataTypes.JSON, allowNull: false },
    reading_minutes: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: false, defaultValue: 1 },
    status: { type: DataTypes.ENUM("DRAFT", "PUBLISHED", "ARCHIVED"), allowNull: false, defaultValue: "DRAFT" },
    is_hot: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    published_at: { type: DataTypes.DATE(3), allowNull: true },
    created_at: created(),
    updated_at: updated(),
    deleted_at: { type: DataTypes.DATE(3), allowNull: true },
  }, options);
  await queryInterface.addIndex("articles", ["code"], { name: "uk_articles_code", unique: true });
  await queryInterface.addIndex("articles", ["status", "published_at", "id"], { name: "idx_articles_status_published" });
  await queryInterface.addIndex("articles", ["tag", "status", "id"], { name: "idx_articles_tag_status" });

  await queryInterface.createTable("search_hot_keywords", {
    id: id(),
    keyword: { type: DataTypes.STRING(80), allowNull: false },
    enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    sort_order: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    created_by_admin_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: { model: "admin_users", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    },
    updated_by_admin_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: { model: "admin_users", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    },
    created_at: created(),
    updated_at: updated(),
  }, options);
  await queryInterface.addIndex("search_hot_keywords", ["keyword"], { name: "uk_search_hot_keywords_keyword", unique: true });
  await queryInterface.addIndex("search_hot_keywords", ["enabled", "sort_order", "id"], { name: "idx_search_hot_keywords_enabled_sort" });

  await queryInterface.createTable("home_settings", {
    id: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false, primaryKey: true },
    featured_title: { type: DataTypes.STRING(40), allowNull: false },
    show_featured: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    show_collections: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    show_journal: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    version: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 },
    updated_by_admin_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: { model: "admin_users", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    },
    updated_at: updated(),
  }, options);

  await queryInterface.createTable("home_quick_categories", {
    category_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      primaryKey: true,
      references: { model: "categories", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    },
    icon_text: { type: DataTypes.STRING(8), allowNull: false },
    sort_order: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false },
    created_at: created(),
    updated_at: updated(),
  }, options);
  await queryInterface.addIndex("home_quick_categories", ["sort_order"], { name: "uk_home_quick_categories_sort", unique: true });

  await queryInterface.createTable("home_featured_products", {
    product_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      primaryKey: true,
      references: { model: "products", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    },
    sort_order: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false },
    created_at: created(),
    updated_at: updated(),
  }, options);
  await queryInterface.addIndex("home_featured_products", ["sort_order"], { name: "uk_home_featured_products_sort", unique: true });
}

module.exports = { up };
