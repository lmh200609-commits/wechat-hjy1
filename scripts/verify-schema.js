const { QueryTypes } = require("sequelize");
const database = require("../database");
const migrator = require("../database/migrator");

const requiredTables = {
  users: ["id", "openid", "status", "created_at", "updated_at"],
  categories: ["id", "code", "dimension", "name", "sort_order", "enabled"],
  products: ["id", "code", "category_id", "material_id", "sale_status", "price_amount", "version"],
  product_variants: ["id", "product_id", "sku_code", "price_amount", "on_hand_quantity", "reserved_quantity", "version"],
  product_images: ["id", "product_id", "media_id", "kind", "sort_order"],
  banners: ["id", "image_media_id", "link_type", "target_product_id", "visible", "sort_order", "version"],
  collections: ["id", "code", "cover_media_id", "visible", "sort_order", "version"],
  collection_products: ["collection_id", "product_id", "sort_order"],
  articles: ["id", "code", "cover_media_id", "body_json", "status", "published_at", "version"],
  search_hot_keywords: ["id", "keyword", "enabled", "sort_order", "updated_by_admin_id"],
  favorites: ["user_id", "product_id", "created_at"],
  cart_items: ["id", "user_id", "product_id", "variant_id", "quantity"],
  user_addresses: ["id", "user_id", "recipient_name", "phone", "is_default", "deleted_at"],
  checkout_sessions: ["id", "user_id", "token_hash", "status", "expires_at", "consumed_order_id"],
  checkout_session_items: ["id", "checkout_session_id", "product_id", "variant_id", "quantity", "quoted_unit_price_amount"],
  orders: ["id", "order_no", "user_id", "status", "payment_status", "idempotency_key", "expires_at"],
  order_items: ["id", "order_id", "variant_id", "product_name_snapshot", "unit_price_amount", "quantity"],
  inventory_movements: ["id", "variant_id", "change_quantity", "reserved_change", "reason_type"],
  admin_roles: ["id", "code", "enabled"],
  admin_permissions: ["id", "code", "module", "action"],
  admin_role_permissions: ["role_id", "permission_id"],
  admin_users: ["id", "username", "password_hash", "role_id", "status"],
  admin_sessions: ["id", "admin_user_id", "token_hash", "expires_at", "revoked_at"],
  admin_login_guards: ["scope_hash", "attempt_count", "window_started_at", "blocked_until", "expires_at"],
  admin_operation_logs: ["id", "admin_user_id", "module", "action", "request_id"],
  media_assets: ["id", "object_key", "file_id", "cloud_path", "storage_provider", "mime_type", "byte_size", "sha256", "reference_count", "reference_status", "status"],
  home_settings: ["id", "featured_title", "version", "updated_by_admin_id"],
  home_quick_categories: ["category_id", "icon_text", "sort_order"],
  home_featured_products: ["product_id", "sort_order"],
  payment_records: ["id", "order_id", "merchant_order_no", "status", "request_amount"],
  refunds: ["id", "order_id", "refund_no", "status", "request_amount"],
  shipments: ["id", "order_id", "carrier_code", "tracking_no", "status"],
};

async function main() {
  try {
    await database.connect();
    const queryInterface = database.sequelize.getQueryInterface();
    const presentTables = new Set((await queryInterface.showAllTables()).map((table) => (
      typeof table === "string" ? table : table.tableName
    )));
    const failures = [];

    for (const [table, columns] of Object.entries(requiredTables)) {
      if (!presentTables.has(table)) {
        failures.push(`missing table ${table}`);
        continue;
      }
      const definition = await queryInterface.describeTable(table);
      for (const column of columns) {
        if (!definition[column]) failures.push(`missing column ${table}.${column}`);
      }
    }

    const migrationStatus = await migrator.status();
    const pending = migrationStatus.filter((row) => row.status !== "executed");
    if (pending.length) failures.push(`${pending.length} pending migration(s)`);

    const tableMetadata = await database.sequelize.query(
      "SELECT TABLE_NAME, ENGINE, TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (:tables)",
      { replacements: { tables: Object.keys(requiredTables) }, type: QueryTypes.SELECT },
    );
    for (const row of tableMetadata) {
      if (String(row.ENGINE).toUpperCase() !== "INNODB") failures.push(`invalid engine ${row.TABLE_NAME}`);
      if (!String(row.TABLE_COLLATION || "").toLowerCase().startsWith("utf8mb4_")) failures.push(`invalid collation ${row.TABLE_NAME}`);
    }

    const [foreignKeyCount] = await database.sequelize.query(
      "SELECT COUNT(*) AS count FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE()",
      { type: QueryTypes.SELECT },
    );
    if (Number(foreignKeyCount.count) < 20) failures.push("foreign key coverage is incomplete");

    const rbacRows = await database.sequelize.query(`
      SELECT
        (SELECT COUNT(*) FROM admin_roles WHERE code IN ('SUPER_ADMIN', 'OPERATOR', 'CONTENT_EDITOR') AND enabled = 1) AS role_count,
        (SELECT COUNT(*) FROM admin_permissions) AS permission_count,
        (SELECT COUNT(*) FROM admin_role_permissions arp
          INNER JOIN admin_roles ar ON ar.id = arp.role_id WHERE ar.code = 'SUPER_ADMIN') AS super_permission_count
    `, { type: QueryTypes.SELECT });
    if (Number(rbacRows[0].role_count) !== 3) failures.push("system administrator roles are incomplete");
    if (Number(rbacRows[0].permission_count) < 20) failures.push("administrator permissions are incomplete");
    if (Number(rbacRows[0].super_permission_count) !== Number(rbacRows[0].permission_count)) {
      failures.push("SUPER_ADMIN permission mapping is incomplete");
    }

    if (failures.length) throw new Error(failures.join("; "));
    console.log(`Database schema verification passed: ${Object.keys(requiredTables).length} business tables, ${migrationStatus.length} migrations.`);
  } catch (error) {
    const safeReason = error?.original?.code || error?.code || error?.name || "UnknownError";
    console.error(`Database schema verification failed (${safeReason}).`);
    process.exitCode = 1;
  } finally {
    await database.close().catch(() => {});
  }
}

main();
