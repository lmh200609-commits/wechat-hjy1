const app = require("./app");
const { initializeLegacyCounter } = require("./services/legacy-counter.service");

// 微信云托管会通过 PORT 环境变量下发监听端口。
const port = process.env.PORT || 80;

app.listen(port, () => {
  console.log(`Server is listening on port ${port}`);

  // 计数器属于模板遗留示例。数据库初始化失败不应阻塞健康检查。
  initializeLegacyCounter().catch((error) => {
    console.error("Legacy counter database initialization failed:", error.message);
  });
});
