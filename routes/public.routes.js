const express = require("express");
const controller = require("../controllers/public.controller");
const validators = require("../validators/public.validators");
const validate = require("../middleware/validate");
const asyncHandler = require("../middleware/async-handler");

const router = express.Router();

router.get("/home", asyncHandler(controller.getHome));
router.get("/categories", validate(validators.categories), asyncHandler(controller.getCategories));
router.get("/products", validate(validators.products), asyncHandler(controller.getProducts));
router.get("/products/:productId", validate(validators.productDetail), asyncHandler(controller.getProductDetail));
router.get("/collections/:collectionId", validate(validators.collectionDetail), asyncHandler(controller.getCollection));
router.get("/article-tags", asyncHandler(controller.getArticleTags));
router.get("/articles", validate(validators.articles), asyncHandler(controller.getArticles));
router.get("/articles/:articleId", validate(validators.articleDetail), asyncHandler(controller.getArticleDetail));
router.get("/search/hot-keywords", asyncHandler(controller.getHotKeywords));

module.exports = router;
