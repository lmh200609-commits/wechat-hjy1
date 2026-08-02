# Database migrations

Migration filenames must use the format `YYYYMMDDHHmmss-description.js` and export an asynchronous `up` function:

```js
async function up({ queryInterface, Sequelize, DataTypes }) {
  // Apply one forward-only schema change.
}

module.exports = { up };
```

Production schema changes are forward-only. Every migration must be safe to execute once and must not use `sequelize.sync({ alter: true })`.
