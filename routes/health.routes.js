const express = require("express");
const healthController = require("../controllers/health.controller");
const asyncHandler = require("../middleware/async-handler");

const router = express.Router();

router.get("/", healthController.getLiveness);
router.get("/live", healthController.getLiveness);
router.get("/ready", asyncHandler(healthController.getReadiness));

module.exports = router;
