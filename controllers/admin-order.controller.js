const { createAdminOrderService } = require("../services/admin-order.service");

const service = createAdminOrderService();

function context(req) {
  return { admin: req.admin, session: req.adminSession };
}

function meta(req) {
  return { requestId: req.requestId, ipAddress: req.ip, userAgent: req.get("user-agent") };
}

async function dashboard(req, res) {
  return res.success(await service.getDashboard());
}

async function orders(req, res) {
  return res.success(await service.getOrders(req.validated));
}

async function order(req, res) {
  return res.success(await service.getOrder(req.validated.orderId));
}

async function confirm(req, res) {
  return res.success(await service.confirmOrder(req.validated.orderId, context(req), meta(req)));
}

async function cancel(req, res) {
  return res.success(await service.cancelOrder(req.validated.orderId, req.validated.reason, context(req), meta(req)));
}

module.exports = { dashboard, orders, order, confirm, cancel };
