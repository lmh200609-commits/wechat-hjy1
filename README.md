# 永乐文玩后端

微信云托管上的 Express + JavaScript + MySQL API，为“永乐文玩”原生微信小程序提供服务。

当前已完成阶段 0 工程基础，商城业务实体和接口将在后续迁移中实现。需求基线见 `docs/BACKEND-HANDOFF.md`。

## 运行要求

- Node.js 22 或更高版本
- MySQL 8
- CommonJS
- 微信云托管通过 `PORT` 指定监听端口

## 环境配置

复制 `.env.example` 中的变量到本地运行环境。项目不会自动读取 `.env` 文件，避免额外运行时依赖；可由 IDE、PowerShell、容器或云托管注入变量。

生产环境至少必须配置：

```text
NODE_ENV=production
MYSQL_ADDRESS=host:3306
MYSQL_DATABASE=wenwan_mall
MYSQL_USERNAME=username
MYSQL_PASSWORD=password
DATABASE_REQUIRED=true
DB_CONNECT_ON_START=true
```

生产环境缺少数据库配置时会直接启动失败。本地开发默认允许不配置数据库，此时 `/health/live` 可用，而 `/health/ready` 返回 503。

## 常用命令

```bash
npm start
npm run check
npm test
npm run db:status
npm run db:migrate
npm run db:seed
```

数据库结构只能通过 `migrations/` 下的前向迁移调整。禁止在生产环境使用 `sequelize.sync({ alter: true })`。

迁移默认不会随服务启动自动执行。部署流程应先执行 `npm run db:migrate`；若部署环境必须由容器启动时执行，可显式配置 `AUTO_MIGRATE=true`。迁移器使用 MySQL 命名锁，避免多实例同时执行。

种子数据必须显式执行。生产环境默认拒绝执行，只有明确设置 `ALLOW_DATABASE_SEED=true` 才可运行；前端模拟数据不会自动写入正式数据库。

## 健康检查

```text
GET /health       # 兼容入口，等同存活检查
GET /health/live  # 进程存活，不访问数据库
GET /health/ready # 服务就绪，检查数据库连接
```

云托管健康检查应使用 `/health/live`。发布流量前和监控系统应额外检查 `/health/ready`。

## 响应格式

成功：

```json
{
  "success": true,
  "code": "OK",
  "message": "success",
  "data": {},
  "requestId": "a-request-id",
  "timestamp": "2026-08-01T08:00:00.000Z"
}
```

失败：

```json
{
  "success": false,
  "code": "NOT_FOUND",
  "message": "Route not found: GET /missing",
  "data": null,
  "details": null,
  "requestId": "a-request-id",
  "timestamp": "2026-08-01T08:00:00.000Z"
}
```

日志按单行 JSON 输出到 stdout/stderr。密码、Token、OpenID 和手机号等字段会自动脱敏。不得在业务日志中直接输出请求体或微信可信身份请求头。

## 已移除的模板能力

微信云托管示例计数器、示例网页和直接返回 OpenID 的接口已删除。普通用户身份将在用户阶段通过云托管可信请求头识别，前端不得提交 OpenID、userId 或 role 作为可信身份。
