// 保留模板原有导出，方便旧代码回退或过渡。
const Counter = require("./models/legacy-counter.model");
const { initializeLegacyCounter } = require("./services/legacy-counter.service");

module.exports = {
  init: initializeLegacyCounter,
  Counter,
};
