const { createCartService } = require("../services/cart.service");

const service = createCartService();

async function getCart(req, res) {
  return res.success(await service.getCart(req.user.id));
}

async function addItem(req, res) {
  return res.success(await service.addItem(req.user.id, req.validated), "created", 201);
}

async function updateItem(req, res) {
  const { itemId, ...patch } = req.validated;
  return res.success(await service.updateItem(req.user.id, itemId, patch));
}

async function removeItem(req, res) {
  return res.success(await service.removeItem(req.user.id, req.validated.itemId));
}

async function setSelection(req, res) {
  return res.success(await service.setSelection(req.user.id, req.validated));
}

module.exports = { getCart, addItem, updateItem, removeItem, setSelection };
