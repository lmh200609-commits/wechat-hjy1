const fs = require("fs");
const path = require("path");
const { DataTypes, QueryTypes, Sequelize } = require("sequelize");
const env = require("../config/env");
const database = require("./index");

const SEEDERS_DIR = path.join(__dirname, "..", "seeders");
const META_TABLE = "data_seeders";
const LOCK_NAME = "wenwan_data_seeders";

function discoverSeeders() {
  if (!fs.existsSync(SEEDERS_DIR)) return [];
  return fs.readdirSync(SEEDERS_DIR)
    .filter((name) => /^\d{14}[-_][a-z0-9-_]+\.js$/i.test(name))
    .sort()
    .map((name) => ({ name, seeder: require(path.join(SEEDERS_DIR, name)) }));
}

async function ensureMetaTable() {
  const queryInterface = database.sequelize.getQueryInterface();
  const tables = (await queryInterface.showAllTables()).map((table) => (
    typeof table === "string" ? table : table.tableName
  ));
  if (tables.includes(META_TABLE)) return;

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

async function acquireLock() {
  const [row] = await database.sequelize.query(
    "SELECT GET_LOCK(:lockName, 30) AS acquired",
    { replacements: { lockName: LOCK_NAME }, type: QueryTypes.SELECT },
  );
  if (Number(row.acquired) !== 1) throw new Error("Could not acquire database seeder lock");
}

async function releaseLock() {
  await database.sequelize.query("SELECT RELEASE_LOCK(:lockName)", {
    replacements: { lockName: LOCK_NAME },
    type: QueryTypes.SELECT,
  });
}

async function seed() {
  if (!env.allowDatabaseSeed) {
    throw new Error("Database seeding is disabled; set ALLOW_DATABASE_SEED=true explicitly");
  }

  await database.connect();
  await acquireLock();

  try {
    await ensureMetaTable();
    const queryInterface = database.sequelize.getQueryInterface();
    const rows = await database.sequelize.query(
      `SELECT name FROM \`${META_TABLE}\` ORDER BY name ASC`,
      { type: QueryTypes.SELECT },
    );
    const executed = new Set(rows.map((row) => row.name));
    const pending = discoverSeeders().filter(({ name }) => !executed.has(name));

    for (const { name, seeder } of pending) {
      if (!seeder || typeof seeder.up !== "function") {
        throw new Error(`Seeder ${name} must export an up function`);
      }
      await seeder.up({ queryInterface, Sequelize, DataTypes });
      await queryInterface.bulkInsert(META_TABLE, [{ name, executed_at: new Date() }]);
    }

    return pending.map(({ name }) => name);
  } finally {
    await releaseLock().catch(() => {});
  }
}

module.exports = {
  discoverSeeders,
  seed,
};
