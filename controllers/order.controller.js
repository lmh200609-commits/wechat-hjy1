const { createOrderService } = require("../services/order.service");

const service = createOrderService();

async function preview(req, res) {
  return res.success(await service.preview(req.user.id, req.validated));
}

async function createOrder(req, res) {
  const order = await service.createOrder(req.user.id, req.validated);
  return res.success(order, order.idempotentReplay ? "success" : "created", order.idempotentReplay ? 200 : 201);
}

async function getOrders(req, res) {
  return res.success(await service.getOrders(req.user.id, req.validated));
}

async function getOrder(req, res) {
  return res.success(await service.getOrder(req.user.id, req.validated.orderId));
}

async function getOrderByNo(req, res) {
  return res.success(await service.getOrderByNo(req.user.id, req.validated.orderNo));
}

async function cancelOrder(req, res) {
  return res.success(await service.cancelOrder(req.user.id, req.validated.orderId, req.validated.reason));
}

module.exports = { preview, createOrder, getOrders, getOrder, getOrderByNo, cancelOrder };
