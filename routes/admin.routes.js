const express = require("express");
const controller = require("../controllers/admin-auth.controller");
const asyncHandler = require("../middleware/async-handler");
const validate = require("../middleware/validate");
const validators = require("../validators/admin.validators");
const catalogController = require("../controllers/admin-catalog.controller");
const catalogValidators = require("../validators/admin-catalog.validators");
const orderController = require("../controllers/admin-order.controller");
const orderValidators = require("../validators/admin-order.validators");
const contentController = require("../controllers/admin-content.controller");
const contentValidators = require("../validators/admin-content.validators");
const mediaController = require("../controllers/media.controller");
const mediaValidators = require("../validators/media.validators");
const { uploadImage } = require("../middleware/media-upload");
const { createWechatGatewayMiddleware } = require("../middleware/wechat-user");
const { createAdminAuthMiddleware, requireAdminPermission } = require("../middleware/admin-auth");
const adminUserController = require("../controllers/admin-user.controller");
const adminUserValidators = require("../validators/admin-user.validators");
const { createAdminIdempotencyMiddleware } = require("../middleware/admin-idempotency");

const idempotent = (scope) => asyncHandler(createAdminIdempotencyMiddleware(scope));

const router = express.Router();

router.use(createWechatGatewayMiddleware());
router.post("/auth/login", validate(validators.login), asyncHandler(controller.login));

router.use(asyncHandler(createAdminAuthMiddleware()));
router.get("/me", controller.me);
router.post("/auth/refresh", validate(validators.emptyBody), asyncHandler(controller.refresh));
router.post("/auth/logout", validate(validators.emptyBody), asyncHandler(controller.logout));
router.get("/logs", requireAdminPermission("logs.read"), validate(validators.logs), asyncHandler(controller.logs));
router.get("/dashboard", requireAdminPermission("dashboard.read"), asyncHandler(orderController.dashboard));

router.get("/admin-roles", requireAdminPermission("admins.read"), asyncHandler(adminUserController.roles));
router.get("/admin-users", requireAdminPermission("admins.read"), asyncHandler(adminUserController.users));
router.post("/admin-users", requireAdminPermission("admins.write"), validate(adminUserValidators.create), idempotent("admin-user:create"), asyncHandler(adminUserController.create));
router.patch("/admin-users/:adminUserId", requireAdminPermission("admins.write"), validate(adminUserValidators.update), asyncHandler(adminUserController.update));

router.get("/categories", requireAdminPermission("categories.read"), validate(catalogValidators.categoryList), asyncHandler(catalogController.categories));
router.post("/categories", requireAdminPermission("categories.write"), validate(catalogValidators.categoryCreate), idempotent("category:create"), asyncHandler(catalogController.createCategory));
router.put("/categories/reorder", requireAdminPermission("categories.write"), validate(catalogValidators.categoryReorder), asyncHandler(catalogController.reorderCategories));
router.patch("/categories/:categoryId", requireAdminPermission("categories.write"), validate(catalogValidators.categoryUpdate), asyncHandler(catalogController.updateCategory));
router.delete("/categories/:categoryId", requireAdminPermission("categories.write"), validate(catalogValidators.categoryId), asyncHandler(catalogController.deleteCategory));

router.get("/products", requireAdminPermission("products.read"), validate(catalogValidators.productList), asyncHandler(catalogController.products));
router.post("/products", requireAdminPermission("products.write"), validate(catalogValidators.productCreate), idempotent("product:create"), asyncHandler(catalogController.createProduct));
router.get("/products/:productId", requireAdminPermission("products.read"), validate(catalogValidators.productId), asyncHandler(catalogController.product));
router.patch("/products/:productId", requireAdminPermission("products.write"), validate(catalogValidators.productUpdate), asyncHandler(catalogController.updateProduct));
router.delete("/products/:productId", requireAdminPermission("products.write"), validate(catalogValidators.productId), asyncHandler(catalogController.deleteProduct));
router.post("/products/:productId/on-sale", requireAdminPermission("products.write"), validate(catalogValidators.productId), asyncHandler(catalogController.publishProduct));
router.post("/products/:productId/off-shelf", requireAdminPermission("products.write"), validate(catalogValidators.productId), asyncHandler(catalogController.unpublishProduct));

router.get("/variants/:variantId/inventory-movements", requireAdminPermission("inventory.read"), validate(catalogValidators.inventoryMovements), asyncHandler(catalogController.inventoryMovements));
router.post("/variants/:variantId/inventory-adjustments", requireAdminPermission("inventory.adjust"), validate(catalogValidators.inventoryAdjustment), idempotent("inventory:adjust"), asyncHandler(catalogController.adjustInventory));

router.get("/media", requireAdminPermission("media.write"), validate(mediaValidators.list), asyncHandler(mediaController.list));
router.post("/media/images", requireAdminPermission("media.write"), uploadImage, idempotent("media:upload"), asyncHandler(mediaController.upload));
router.delete("/media/:mediaId", requireAdminPermission("media.write"), validate(mediaValidators.id), asyncHandler(mediaController.remove));

router.get("/articles", requireAdminPermission("articles.read"), validate(contentValidators.articleList), asyncHandler(contentController.listArticles));
router.post("/articles", requireAdminPermission("articles.write"), validate(contentValidators.articleCreate), idempotent("article:create"), asyncHandler(contentController.createArticle));
router.get("/articles/:articleId", requireAdminPermission("articles.read"), validate(contentValidators.articleId), asyncHandler(contentController.getArticle));
router.patch("/articles/:articleId", requireAdminPermission("articles.write"), validate(contentValidators.articleUpdate), asyncHandler(contentController.updateArticle));
router.delete("/articles/:articleId", requireAdminPermission("articles.write"), validate(contentValidators.articleId), asyncHandler(contentController.deleteArticle));

router.get("/collections", requireAdminPermission("collections.read"), validate(contentValidators.collectionList), asyncHandler(contentController.listCollections));
router.post("/collections", requireAdminPermission("collections.write"), validate(contentValidators.collectionCreate), idempotent("collection:create"), asyncHandler(contentController.createCollection));
router.get("/collections/:collectionId", requireAdminPermission("collections.read"), validate(contentValidators.collectionId), asyncHandler(contentController.getCollection));
router.patch("/collections/:collectionId", requireAdminPermission("collections.write"), validate(contentValidators.collectionUpdate), asyncHandler(contentController.updateCollection));
router.delete("/collections/:collectionId", requireAdminPermission("collections.write"), validate(contentValidators.collectionId), asyncHandler(contentController.deleteCollection));

router.get("/banners", requireAdminPermission("homepage.read"), validate(contentValidators.bannerList), asyncHandler(contentController.listBanners));
router.post("/banners", requireAdminPermission("homepage.write"), validate(contentValidators.bannerCreate), idempotent("banner:create"), asyncHandler(contentController.createBanner));
router.put("/banners/reorder", requireAdminPermission("homepage.write"), validate(contentValidators.bannerReorder), asyncHandler(contentController.reorderBanners));
router.get("/banners/:bannerId", requireAdminPermission("homepage.read"), validate(contentValidators.bannerId), asyncHandler(contentController.getBanner));
router.patch("/banners/:bannerId", requireAdminPermission("homepage.write"), validate(contentValidators.bannerUpdate), asyncHandler(contentController.updateBanner));
router.delete("/banners/:bannerId", requireAdminPermission("homepage.write"), validate(contentValidators.bannerId), asyncHandler(contentController.deleteBanner));

router.get("/homepage", requireAdminPermission("homepage.read"), asyncHandler(contentController.getHome));
router.patch("/homepage", requireAdminPermission("homepage.write"), validate(contentValidators.homeSettings), asyncHandler(contentController.updateHome));
router.put("/homepage/quick-categories", requireAdminPermission("homepage.write"), validate(contentValidators.quickCategories), asyncHandler(contentController.setQuickCategories));
router.put("/homepage/featured-products", requireAdminPermission("homepage.write"), validate(contentValidators.featuredProducts), asyncHandler(contentController.setFeaturedProducts));

router.get("/orders", requireAdminPermission("orders.read"), validate(orderValidators.list), asyncHandler(orderController.orders));
router.get("/orders/:orderId", requireAdminPermission("orders.read"), validate(orderValidators.orderParam), asyncHandler(orderController.order));
router.post("/orders/:orderId/confirm", requireAdminPermission("orders.confirm"), validate(orderValidators.confirm), asyncHandler(orderController.confirm));
router.post("/orders/:orderId/cancel", requireAdminPermission("orders.cancel"), validate(orderValidators.cancel), asyncHandler(orderController.cancel));

module.exports = router;
