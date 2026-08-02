const AppError = require("../errors/app-error");
const ERROR_CODES = require("../constants/error-codes");

function validate(validator) {
  if (typeof validator !== "function") throw new TypeError("validator must be a function");

  return function validationMiddleware(req, res, next) {
    const result = validator({ body: req.body, query: req.query, params: req.params });
    if (!result || result.valid !== false) {
      if (result && result.value) req.validated = result.value;
      return next();
    }

    return next(new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: "Request validation failed",
      statusCode: 400,
      details: Array.isArray(result.errors) ? result.errors : [],
    }));
  };
}

module.exports = validate;
