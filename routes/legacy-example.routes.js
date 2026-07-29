const express = require("express");
const legacyCounterController = require("../controllers/legacy-counter.controller");
const legacyWechatController = require("../controllers/legacy-wechat.controller");
const asyncHandler = require("../middleware/async-handler");

const router = express.Router();

// 微信云托管模板遗留接口，保留原路径以便回退。
router.get("/count", asyncHandler(legacyCounterController.getCount));
router.post("/count", asyncHandler(legacyCounterController.updateCount));
router.get("/wx_openid", legacyWechatController.getOpenId);

module.exports = router;
