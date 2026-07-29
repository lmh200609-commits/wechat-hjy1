function getOpenId(req, res) {
  const openId = req.headers["x-wx-source"]
    ? req.headers["x-wx-openid"] || null
    : null;

  return res.success(openId);
}

module.exports = {
  getOpenId,
};
