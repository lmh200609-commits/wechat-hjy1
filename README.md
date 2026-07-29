# 文玩商城微信小程序后端

这是一个部署在微信云托管上的 Express + JavaScript 项目。目前完成第一阶段基础结构整理，尚未包含商品、分类、订单等具体商城业务，也不包含线上支付。

## 技术与部署约束

- JavaScript + Express
- Node.js 22 或更高版本，使用 CommonJS
- 微信云托管 + Docker
- 监听微信云托管下发的 `PORT` 环境变量，本地默认使用 `80`
- 使用 Sequelize 连接 MySQL
- MySQL 连接信息继续由环境变量提供

## 项目结构

```text
.
├── app.js                         # Express 应用组装
├── index.js                       # 服务启动入口
├── config/
│   └── database.js                # MySQL/Sequelize 配置
├── controllers/
│   ├── health.controller.js
│   ├── legacy-counter.controller.js
│   └── legacy-wechat.controller.js
├── middleware/
│   ├── async-handler.js
│   ├── error-handler.js
│   ├── not-found.js
│   └── response.js
├── models/
│   └── legacy-counter.model.js
├── routes/
│   ├── health.routes.js
│   └── legacy-example.routes.js
├── services/
│   └── legacy-counter.service.js
├── db.js                          # 旧 db.js 导出的兼容入口
├── index.html                     # 原计数器模板页面，暂时保留
├── Dockerfile
└── container.config.json
```

文件名中带有 `legacy` 的模块属于微信云托管计数器示例。它们与后续商城业务分开存放，但暂时保留原接口路径，方便兼容和回退。

## 环境变量

数据库连接沿用微信云托管模板的配置方式：

```text
MYSQL_ADDRESS=数据库地址:端口
MYSQL_USERNAME=数据库用户名
MYSQL_PASSWORD=数据库密码
```

数据库名称仍为 `nodejs_demo`。

可通过 `PORT` 指定监听端口：

```text
PORT=3000
```

服务会先开始监听端口，再异步初始化旧计数器数据库。因此，即使本地没有配置 MySQL，`GET /health` 仍可使用；旧计数器接口会在数据库不可用时返回统一错误。

## 本地运行

安装依赖：

```bash
npm install
```

PowerShell：

```powershell
$env:PORT = "3000"
npm start
```

macOS/Linux：

```bash
PORT=3000 npm start
```

## 接口与响应格式

### 健康检查

```http
GET /health
```

成功响应示例：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "status": "ok",
    "timestamp": "2026-01-01T00:00:00.000Z"
  }
}
```

该接口不查询 MySQL。

### 计数器模板兼容接口

```text
GET  /api/count
POST /api/count
GET  /api/wx_openid
```

计数器接口仅为旧模板兼容代码，不代表商城业务设计。

### 统一错误响应

```json
{
  "code": 404,
  "message": "Route not found: GET /missing",
  "data": null
}
```

服务端内部错误不会向客户端暴露堆栈信息。

## 验证

启动后执行：

```bash
curl http://localhost:3000/health
curl http://localhost:3000/missing
```

配置可用的 MySQL 环境变量后，可继续验证旧计数器接口：

```bash
curl http://localhost:3000/api/count
curl -X POST -H "content-type: application/json" -d '{"action":"inc"}' http://localhost:3000/api/count
```

Docker 构建与运行：

```bash
docker build -t wechat-hjy1 .
docker run --rm -p 3000:80 \
  -e PORT=80 \
  -e MYSQL_ADDRESS=host:3306 \
  -e MYSQL_USERNAME=username \
  -e MYSQL_PASSWORD=password \
  wechat-hjy1
```
