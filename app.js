const path = require("path");
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");

const healthRoutes = require("./routes/health.routes");
const legacyExampleRoutes = require("./routes/legacy-example.routes");
const responseMiddleware = require("./middleware/response");
const notFoundMiddleware = require("./middleware/not-found");
const errorHandlerMiddleware = require("./middleware/error-handler");

const app = express();

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(cors());
app.use(morgan("tiny"));
app.use(responseMiddleware);

app.get("/", (req, res) => {
  // 暂时保留微信云托管计数器模板首页，便于回退。
  res.sendFile(path.join(__dirname, "index.html"));
});

app.use("/health", healthRoutes);
app.use("/api", legacyExampleRoutes);

app.use(notFoundMiddleware);
app.use(errorHandlerMiddleware);

module.exports = app;
