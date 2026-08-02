const { createUserService } = require("../services/user.service");

const service = createUserService();

async function getMe(req, res) {
  return res.success(req.user);
}

async function getSummary(req, res) {
  return res.success(await service.getSummary(req.user.id));
}

module.exports = { getMe, getSummary };
