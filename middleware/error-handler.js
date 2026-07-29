function errorHandlerMiddleware(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  const statusCode = error.statusCode || 500;
  const message = statusCode >= 500 ? "Internal server error" : error.message;

  console.error(error);

  return res.status(statusCode).json({
    code: statusCode,
    message,
    data: null,
  });
}

module.exports = errorHandlerMiddleware;
