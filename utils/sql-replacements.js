function toSqlDateTime(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return value;
  return value.toISOString().slice(0, 23).replace("T", " ");
}

function normalizeSqlReplacements(replacements = {}) {
  return Object.fromEntries(Object.entries(replacements).map(([key, value]) => [
    key,
    value instanceof Date
      ? toSqlDateTime(value)
      : Array.isArray(value)
        ? value.map((item) => item instanceof Date ? toSqlDateTime(item) : item)
        : value,
  ]));
}

module.exports = { normalizeSqlReplacements, toSqlDateTime };
