const { createAdminContentService } = require("../services/admin-content.service");
const service = createAdminContentService();
const context = (req) => ({ admin: req.admin, session: req.adminSession });
const meta = (req) => ({ requestId: req.requestId, ipAddress: req.ip, userAgent: req.get("user-agent") });

const listArticles = async (req, res) => res.success(await service.listArticles(req.validated));
const getArticle = async (req, res) => res.success(await service.getArticle(req.validated.articleId));
const createArticle = async (req, res) => res.success(await service.createArticle(req.validated, context(req), meta(req)), "created", 201);
const updateArticle = async (req, res) => res.success(await service.updateArticle(req.validated, context(req), meta(req)));
const deleteArticle = async (req, res) => res.success(await service.deleteArticle(req.validated.articleId, context(req), meta(req)));
const listCollections = async (req, res) => res.success(await service.listCollections(req.validated));
const getCollection = async (req, res) => res.success(await service.getCollection(req.validated.collectionId));
const createCollection = async (req, res) => res.success(await service.createCollection(req.validated, context(req), meta(req)), "created", 201);
const updateCollection = async (req, res) => res.success(await service.updateCollection(req.validated, context(req), meta(req)));
const deleteCollection = async (req, res) => res.success(await service.deleteCollection(req.validated.collectionId, context(req), meta(req)));
const listBanners = async (req, res) => res.success(await service.listBanners(req.validated));
const getBanner = async (req, res) => res.success(await service.getBanner(req.validated.bannerId));
const createBanner = async (req, res) => res.success(await service.createBanner(req.validated, context(req), meta(req)), "created", 201);
const updateBanner = async (req, res) => res.success(await service.updateBanner(req.validated, context(req), meta(req)));
const deleteBanner = async (req, res) => res.success(await service.deleteBanner(req.validated.bannerId, context(req), meta(req)));
const reorderBanners = async (req, res) => res.success(await service.reorderBanners(req.validated.bannerIds, context(req), meta(req)));
const getHome = async (req, res) => res.success(await service.getHome());
const updateHome = async (req, res) => res.success(await service.updateHome(req.validated, context(req), meta(req)));
const setQuickCategories = async (req, res) => res.success(await service.setQuickCategories(req.validated, context(req), meta(req)));
const setFeaturedProducts = async (req, res) => res.success(await service.setFeaturedProducts(req.validated, context(req), meta(req)));

module.exports = { listArticles, getArticle, createArticle, updateArticle, deleteArticle, listCollections, getCollection, createCollection, updateCollection, deleteCollection, listBanners, getBanner, createBanner, updateBanner, deleteBanner, reorderBanners, getHome, updateHome, setQuickCategories, setFeaturedProducts };
