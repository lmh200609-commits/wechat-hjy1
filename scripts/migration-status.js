const migrator = require("../database/migrator");
const database = require("../database");

async function main() {
  try {
    const rows = await migrator.status();
    if (!rows.length) console.log("No application migrations found.");
    for (const row of rows) console.log(`${row.status.padEnd(8)} ${row.name}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await database.close().catch(() => {});
  }
}

main();
