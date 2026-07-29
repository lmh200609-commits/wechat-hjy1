const legacyCounterService = require("../services/legacy-counter.service");

async function getCount(req, res) {
  const count = await legacyCounterService.getCount();
  return res.success(count);
}

async function updateCount(req, res) {
  const count = await legacyCounterService.updateCount(req.body.action);
  return res.success(count);
}

module.exports = {
  getCount,
  updateCount,
};
