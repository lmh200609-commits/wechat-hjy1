function responseMiddleware(req, res, next) {
  res.success = function success(data = null, message = "success", statusCode = 200) {
    return res.status(statusCode).json({
      code: 0,
      message,
      data,
    });
  };

  next();
}

module.exports = responseMiddleware;
