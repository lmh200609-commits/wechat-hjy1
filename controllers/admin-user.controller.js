const { createAdminUserService } = require('../services/admin-user.service');
const service = createAdminUserService();
const meta = (req) => ({ requestId: req.requestId, ipAddress: req.ip });
async function roles(req, res) { return res.success(await service.roles()); }
async function users(req, res) { return res.success(await service.users()); }
async function create(req, res) { return res.success(await service.create(req.validated, { admin: req.admin }, meta(req)), 'created', 201); }
async function update(req, res) { return res.success(await service.update(req.validated, { admin: req.admin }, meta(req))); }
module.exports = { roles, users, create, update };
