const AppError = require("../errors/app-error");
const ERROR_CODES = require("../constants/error-codes");

function requireCompleteUserProfile(req, res, next) {
  if (req.user && req.user.profileComplete) return next();
  return next(new AppError({
    code: ERROR_CODES.USER_PROFILE_REQUIRED,
    message: "Complete the WeChat profile before using transaction features",
    statusCode: 403,
    expose: true,
  }));
}

module.exports = requireCompleteUserProfile;
