const ERROR_CODES = require("../constants/error-codes");

function responseMiddleware(req, res, next) {
  res.success = function success(
    data = null,
    message = "success",
    statusCode = 200,
    code = ERROR_CODES.OK,
  ) {
    return res.status(statusCode).json({
      success: true,
      code,
      message,
      data,
      requestId: req.requestId,
      timestamp: new Date().toISOString(),
    });
  };

  res.failure = function failure(code, message, statusCode, details = null) {
    return res.status(statusCode).json({
      success: false,
      code,
      message,
      data: null,
      details,
      requestId: req.requestId,
      timestamp: new Date().toISOString(),
    });
  };

  next();
}

module.exports = responseMiddleware;
