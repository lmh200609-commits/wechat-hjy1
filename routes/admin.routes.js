const express = require("express");
const controller = require("../controllers/admin-auth.controller");
const asyncHandler = require("../middleware/async-handler");
const validate = require("../middleware/validate");
const validators = require("../validators/admin.validators");
const catalogController = require("../controllers/admin-catalog.controller");
const catalogValidators = require("../validators/admin-catalog.validators");
const orderController = require("../controllers/admin-order.controller");
const orderValidators = require("../validators/admin-order.validators");
const { createWechatGatewayMiddleware } = require("../middleware/wechat-user");
const { createAdminAuthMiddleware, requireAdminPermission } = require("../middleware/admin-auth");

const router = express.Router();

router.use(createWechatGatewayMiddleware());
router.post("/auth/login", validate(validators.login), asyncHandler(controller.login));

router.use(asyncHandler(createAdminAuthMiddleware()));
router.get("/me", controller.me);
router.post("/auth/refresh", validate(validators.emptyBody), asyncHandler(controller.refresh));
router.post("/auth/logout", validate(validators.emptyBody), asyncHandler(controller.logout));
router.get("/logs", requireAdminPermission("logs.read"), validate(validators.logs), asyncHandler(controller.logs));
router.get("/dashboard", requireAdminPermission("dashboard.read"), asyncHandler(orderController.dashboard));

router.get("/categories", requireAdminPermission("categories.read"), validate(catalogValidators.categoryList), asyncHandler(catalogController.categories));
router.post("/categories", requireAdminPermission("categories.write"), validate(catalogValidators.categoryCreate), asyncHandler(catalogController.createCategory));
router.put("/categories/reorder", requireAdminPermission("categories.write"), validate(catalogValidators.categoryReorder), asyncHandler(catalogController.reorderCategories));
router.patch("/categories/:categoryId", requireAdminPermission("categories.write"), validate(catalogValidators.categoryUpdate), asyncHandler(catalogController.updateCategory));
router.delete("/categories/:categoryId", requireAdminPermission("categories.write"), validate(catalogValidators.categoryId), asyncHandler(catalogController.deleteCategory));

router.get("/products", requireAdminPermission("products.read"), validate(catalogValidators.productList), asyncHandler(catalogController.products));
router.post("/products", requireAdminPermission("products.write"), validate(catalogValidators.productCreate), asyncHandler(catalogController.createProduct));
router.get("/products/:productId", requireAdminPermission("products.read"), validate(catalogValidators.productId), asyncHandler(catalogController.product));
router.patch("/products/:productId", requireAdminPermission("products.write"), validate(catalogValidators.productUpdate), asyncHandler(catalogController.updateProduct));
router.delete("/products/:productId", requireAdminPermission("products.write"), validate(catalogValidators.productId), asyncHandler(catalogController.deleteProduct));
router.post("/products/:productId/on-sale", requireAdminPermission("products.write"), validate(catalogValidators.productId), asyncHandler(catalogController.publishProduct));
router.post("/products/:productId/off-shelf", requireAdminPermission("products.write"), validate(catalogValidators.productId), asyncHandler(catalogController.unpublishProduct));

router.get("/variants/:variantId/inventory-movements", requireAdminPermission("inventory.read"), validate(catalogValidators.inventoryMovements), asyncHandler(catalogController.inventoryMovements));
router.post("/variants/:variantId/inventory-adjustments", requireAdminPermission("inventory.adjust"), validate(catalogValidators.inventoryAdjustment), asyncHandler(catalogController.adjustInventory));

router.get("/orders", requireAdminPermission("orders.read"), validate(orderValidators.list), asyncHandler(orderController.orders));
router.get("/orders/:orderId", requireAdminPermission("orders.read"), validate(orderValidators.orderParam), asyncHandler(orderController.order));
router.post("/orders/:orderId/confirm", requireAdminPermission("orders.confirm"), validate(orderValidators.confirm), asyncHandler(orderController.confirm));
router.post("/orders/:orderId/cancel", requireAdminPermission("orders.cancel"), validate(orderValidators.cancel), asyncHandler(orderController.cancel));

module.exports = router;
