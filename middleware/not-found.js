const AppError = require("../errors/app-error");
const ERROR_CODES = require("../constants/error-codes");

function notFoundMiddleware(req, res, next) {
  next(new AppError({
    code: ERROR_CODES.NOT_FOUND,
    message: `Route not found: ${req.method} ${req.originalUrl.split("?")[0]}`,
    statusCode: 404,
  }));
}

module.exports = notFoundMiddleware;
