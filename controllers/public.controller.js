const { createPublicService } = require("../services/public.service");

const service = createPublicService();

async function getHome(req, res) {
  return res.success(await service.getHome());
}

async function getCategories(req, res) {
  return res.success(await service.getCategories(req.validated));
}

async function getProducts(req, res) {
  return res.success(await service.getProducts(req.validated));
}

async function getProductDetail(req, res) {
  return res.success(await service.getProductDetail(req.validated));
}

async function getCollection(req, res) {
  return res.success(await service.getCollection(req.validated));
}

async function getArticleTags(req, res) {
  return res.success(await service.getArticleTags());
}

async function getArticles(req, res) {
  return res.success(await service.getArticles(req.validated));
}

async function getArticleDetail(req, res) {
  return res.success(await service.getArticleDetail(req.validated));
}

async function getHotKeywords(req, res) {
  return res.success(await service.getHotKeywords());
}

module.exports = {
  getHome,
  getCategories,
  getProducts,
  getProductDetail,
  getCollection,
  getArticleTags,
  getArticles,
  getArticleDetail,
  getHotKeywords,
};
