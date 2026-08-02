const { createMediaService } = require("../services/media.service");
const service = createMediaService();
const context = (req) => ({ admin: req.admin, session: req.adminSession });
const meta = (req) => ({ requestId: req.requestId, ipAddress: req.ip, userAgent: req.get("user-agent") });

async function upload(req, res) { return res.success(await service.upload(req.file, context(req), meta(req)), "created", 201); }
async function list(req, res) { return res.success(await service.list(req.validated)); }
async function remove(req, res) { return res.success(await service.remove(req.validated.mediaId, context(req), meta(req))); }

module.exports = { upload, list, remove };
