const LegacyCounter = require("../models/legacy-counter.model");

async function initializeLegacyCounter() {
  await LegacyCounter.sync({ alter: true });
}

async function getCount() {
  return LegacyCounter.count();
}

async function updateCount(action) {
  if (action === "inc") {
    await LegacyCounter.create();
  } else if (action === "clear") {
    await LegacyCounter.destroy({ truncate: true });
  }

  return getCount();
}

module.exports = {
  initializeLegacyCounter,
  getCount,
  updateCount,
};
