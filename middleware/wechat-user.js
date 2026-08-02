const env = require("../config/env");
const AppError = require("../errors/app-error");
const ERROR_CODES = require("../constants/error-codes");
const { createUserService } = require("../services/user.service");

const OPENID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

function readHeader(req, name) {
  const value = req.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function verifyGateway(req, config, errorCode = ERROR_CODES.USER_IDENTITY_UNTRUSTED) {
  if (!config.cloudEnvId || !config.miniProgramAppId) {
    throw new AppError({
      code: ERROR_CODES.SERVICE_UNAVAILABLE,
      message: "WeChat gateway verification is not configured",
      statusCode: 503,
      expose: true,
    });
  }
  const cloudEnvId = readHeader(req, "x-wx-env");
  const miniProgramAppId = readHeader(req, "x-wx-appid");
  const source = readHeader(req, "x-wx-source");
  if (cloudEnvId !== config.cloudEnvId || miniProgramAppId !== config.miniProgramAppId || !source) {
    throw new AppError({
      code: errorCode,
      message: "WeChat gateway context could not be verified",
      statusCode: 401,
    });
  }
  return Object.freeze({ cloudEnvId, miniProgramAppId, source });
}

function createWechatGatewayMiddleware({ config = env.wechat } = {}) {
  return function requireWechatGateway(req, res, next) {
    req.wechatContext = verifyGateway(req, config, ERROR_CODES.WECHAT_GATEWAY_UNTRUSTED);
    return next();
  };
}

function createWechatUserMiddleware({
  config = env.wechat,
  userService = createUserService(),
} = {}) {
  return async function requireWechatUser(req, res, next) {
    const openid = readHeader(req, "x-wx-openid");
    if (!openid) {
      throw new AppError({
        code: ERROR_CODES.USER_IDENTITY_MISSING,
        message: "WeChat user identity is required",
        statusCode: 401,
      });
    }

    const gateway = verifyGateway(req, config);
    if (!OPENID_PATTERN.test(openid)) {
      throw new AppError({
        code: ERROR_CODES.USER_IDENTITY_UNTRUSTED,
        message: "WeChat user identity could not be verified",
        statusCode: 401,
      });
    }

    req.user = await userService.identify(openid);
    req.wechatContext = gateway;
    return next();
  };
}

module.exports = {
  createWechatUserMiddleware,
  createWechatGatewayMiddleware,
  verifyGateway,
  OPENID_PATTERN,
};
