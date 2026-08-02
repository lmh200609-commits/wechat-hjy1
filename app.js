const express = require("express");
const cors = require("cors");

const env = require("./config/env");
const healthRoutes = require("./routes/health.routes");
const publicRoutes = require("./routes/public.routes");
const meRoutes = require("./routes/me.routes");
const adminRoutes = require("./routes/admin.routes");
const requestContext = require("./middleware/request-context");
const requestLogger = require("./middleware/request-logger");
const responseMiddleware = require("./middleware/response");
const notFoundMiddleware = require("./middleware/not-found");
const errorHandlerMiddleware = require("./middleware/error-handler");

const app = express();

app.disable("x-powered-by");
if (env.trustProxy) app.set("trust proxy", 1);

app.use(requestContext);
app.use(requestLogger);
app.use((req, res, next) => {
  res.set({
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "cache-control": "no-store",
  });
  next();
});

if (env.corsOrigins.length) {
  app.use(cors({
    origin(origin, callback) {
      if (!origin || env.corsOrigins.includes(origin)) return callback(null, true);
      return callback(null, false);
    },
    credentials: true,
  }));
}

app.use(express.urlencoded({ extended: false, limit: env.requestBodyLimit }));
const jsonParser = express.json({ limit: env.requestBodyLimit });
app.use((req, res, next) => {
  const isMediaJsonUpload = req.method === "POST"
    && req.path === "/api/admin/media/images"
    && req.is("application/json");
  if (isMediaJsonUpload) return next();
  return jsonParser(req, res, next);
});
app.use(responseMiddleware);

app.get("/", (req, res) => res.success({
  service: env.serviceName,
  version: env.serviceVersion,
  environment: env.nodeEnv,
}));

app.use("/health", healthRoutes);
app.use("/api/v1/me", meRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/v1", publicRoutes);

app.use(notFoundMiddleware);
app.use(errorHandlerMiddleware);

module.exports = app;
