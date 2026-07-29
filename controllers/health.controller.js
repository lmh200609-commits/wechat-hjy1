function getHealth(req, res) {
  return res.success({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
}

module.exports = {
  getHealth,
};
