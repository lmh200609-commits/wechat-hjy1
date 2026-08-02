const { createAdminAuthService } = require("../services/admin-auth.service");

const service = createAdminAuthService();

function meta(req) {
  return {
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
    requestId: req.requestId,
  };
}

async function login(req, res) {
  return res.success(await service.login(req.validated, meta(req)));
}

async function me(req, res) {
  return res.success({ admin: req.admin, session: req.adminSession });
}

async function refresh(req, res) {
  return res.success(await service.refresh({ admin: req.admin, session: req.adminSession }, req.adminToken, meta(req)));
}

async function logout(req, res) {
  return res.success(await service.logout({ admin: req.admin, session: req.adminSession }, req.adminToken, meta(req)));
}

async function logs(req, res) {
  return res.success(await service.getLogs(req.validated));
}

module.exports = { login, me, refresh, logout, logs };
