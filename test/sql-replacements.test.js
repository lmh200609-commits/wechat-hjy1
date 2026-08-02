const test = require("node:test");
const assert = require("node:assert/strict");

const { normalizeSqlReplacements, toSqlDateTime } = require("../utils/sql-replacements");

test("SQL date replacements are serialized as UTC database timestamps", () => {
  const instant = new Date("2026-08-02T08:49:43.123Z");
  assert.equal(toSqlDateTime(instant), "2026-08-02 08:49:43.123");
  assert.deepEqual(normalizeSqlReplacements({ instant, ids: ["1", "2"] }), {
    instant: "2026-08-02 08:49:43.123",
    ids: ["1", "2"],
  });
});
