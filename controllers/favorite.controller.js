const { createFavoriteService } = require("../services/favorite.service");

const service = createFavoriteService();

async function getFavorites(req, res) {
  return res.success(await service.getFavorites(req.user.id, req.validated));
}

async function putFavorite(req, res) {
  return res.success(await service.putFavorite(req.user.id, req.validated.productId));
}

async function removeFavorite(req, res) {
  return res.success(await service.removeFavorite(req.user.id, req.validated.productId));
}

module.exports = { getFavorites, putFavorite, removeFavorite };
