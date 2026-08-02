const { createAdminCatalogService } = require("../services/admin-catalog.service");

const service = createAdminCatalogService();

function context(req) {
  return { admin: req.admin, session: req.adminSession };
}

function meta(req) {
  return { requestId: req.requestId, ipAddress: req.ip, userAgent: req.get("user-agent") };
}

async function categories(req, res) {
  return res.success(await service.getCategories(req.validated));
}

async function createCategory(req, res) {
  return res.success(await service.createCategory(req.validated, context(req), meta(req)), "created", 201);
}

async function updateCategory(req, res) {
  return res.success(await service.updateCategory(req.validated, context(req), meta(req)));
}

async function deleteCategory(req, res) {
  return res.success(await service.deleteCategory(req.validated, context(req), meta(req)));
}

async function reorderCategories(req, res) {
  return res.success(await service.reorderCategories(req.validated, context(req), meta(req)));
}

async function products(req, res) {
  return res.success(await service.getProducts(req.validated));
}

async function product(req, res) {
  return res.success(await service.getProduct(req.validated.productId));
}

async function createProduct(req, res) {
  return res.success(await service.createProduct(req.validated, context(req), meta(req)), "created", 201);
}

async function updateProduct(req, res) {
  return res.success(await service.updateProduct(req.validated, context(req), meta(req)));
}

async function publishProduct(req, res) {
  return res.success(await service.changeProductStatus(req.validated.productId, "ON_SALE", context(req), meta(req)));
}

async function unpublishProduct(req, res) {
  return res.success(await service.changeProductStatus(req.validated.productId, "OFF_SHELF", context(req), meta(req)));
}

async function deleteProduct(req, res) {
  return res.success(await service.deleteProduct(req.validated.productId, context(req), meta(req)));
}

async function adjustInventory(req, res) {
  return res.success(await service.adjustInventory(req.validated, context(req), meta(req)));
}

async function inventoryMovements(req, res) {
  return res.success(await service.getInventoryMovements(req.validated));
}

module.exports = {
  categories,
  createCategory,
  updateCategory,
  deleteCategory,
  reorderCategories,
  products,
  product,
  createProduct,
  updateProduct,
  publishProduct,
  unpublishProduct,
  deleteProduct,
  adjustInventory,
  inventoryMovements,
};
