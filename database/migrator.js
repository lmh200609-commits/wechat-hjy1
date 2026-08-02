const fs = require("fs");
const path = require("path");
const { DataTypes, QueryTypes, Sequelize } = require("sequelize");
const database = require("./index");

const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");
const META_TABLE = "schema_migrations";
const LOCK_NAME = "wenwan_schema_migrations";

function discoverMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d{14}[-_][a-z0-9-_]+\.js$/i.test(name))
    .sort()
    .map((name) => ({
      name,
      migration: require(path.join(MIGRATIONS_DIR, name)),
    }));
}

async function ensureMetaTable() {
  const queryInterface = database.sequelize.getQueryInterface();
  const tables = (await queryInterface.showAllTables()).map((table) => (
    typeof table === "string" ? table : table.tableName
  ));

  if (!tables.includes(META_TABLE)) {
    await queryInterface.createTable(META_TABLE, {
      name: {
        type: DataTypes.STRING(255),
        allowNull: false,
        primaryKey: true,
      },
      executed_at: {
        type: DataTypes.DATE(3),
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP(3)"),
      },
    }, {
      charset: "utf8mb4",
      collate: "utf8mb4_unicode_ci",
    });
  }
}

async function metaTableExists() {
  const queryInterface = database.sequelize.getQueryInterface();
  const tables = (await queryInterface.showAllTables()).map((table) => (
    typeof table === "string" ? table : table.tableName
  ));
  return tables.includes(META_TABLE);
}

async function getExecutedNames({ createIfMissing = false } = {}) {
  const exists = await metaTableExists();
  if (!exists && !createIfMissing) return new Set();
  if (!exists) await ensureMetaTable();

  const rows = await database.sequelize.query(
    `SELECT name FROM \`${META_TABLE}\` ORDER BY name ASC`,
    { type: QueryTypes.SELECT },
  );
  return new Set(rows.map((row) => row.name));
}

async function acquireLock(timeoutSeconds = 30) {
  const [row] = await database.sequelize.query(
    "SELECT GET_LOCK(:lockName, :timeoutSeconds) AS acquired",
    {
      replacements: { lockName: LOCK_NAME, timeoutSeconds },
      type: QueryTypes.SELECT,
    },
  );
  if (Number(row.acquired) !== 1) throw new Error("Could not acquire database migration lock");
}

async function releaseLock() {
  await database.sequelize.query("SELECT RELEASE_LOCK(:lockName)", {
    replacements: { lockName: LOCK_NAME },
    type: QueryTypes.SELECT,
  });
}

function validateMigration(name, migration) {
  if (!migration || typeof migration.up !== "function") {
    throw new Error(`Migration ${name} must export an up function`);
  }
}

async function migrate() {
  await database.connect();
  await acquireLock();

  try {
    const queryInterface = database.sequelize.getQueryInterface();
    const executed = await getExecutedNames({ createIfMissing: true });
    const pending = discoverMigrations().filter(({ name }) => !executed.has(name));

    for (const { name, migration } of pending) {
      validateMigration(name, migration);
      await migration.up({ queryInterface, Sequelize, DataTypes });
      await queryInterface.bulkInsert(META_TABLE, [{ name, executed_at: new Date() }]);
    }

    return pending.map(({ name }) => name);
  } finally {
    await releaseLock().catch(() => {});
  }
}

async function status() {
  await database.connect();
  const executed = await getExecutedNames();
  return discoverMigrations().map(({ name }) => ({
    name,
    status: executed.has(name) ? "executed" : "pending",
  }));
}

module.exports = {
  discoverMigrations,
  migrate,
  status,
};
