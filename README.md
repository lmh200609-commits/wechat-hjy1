# 永乐文玩后端

微信云托管上的 Express + JavaScript + MySQL API，为“永乐文玩”原生微信小程序提供服务。

当前已完成阶段 0 工程基础、阶段 1 核心数据库结构、阶段 2 公共浏览 API、阶段 3 普通用户可信身份、阶段 4 购物车与收货地址、阶段 5 收藏/结算/用户订单、阶段 6.1 管理员认证与 RBAC、阶段 6.2 分类、商品、SKU 与库存管理，以及阶段 6.3 管理首页统计和管理订单闭环。下一子阶段实现媒体、文章、合集、Banner 与首页配置 API。需求基线见 `docs/BACKEND-HANDOFF.md`。

## 运行要求

- Node.js 22 或更高版本
- MySQL 8
- CommonJS
- 微信云托管通过 `PORT` 指定监听端口

## 环境配置

复制 `.env.example` 中的变量到本地运行环境。Node.js 22 本地开发会通过内置能力读取项目根目录 `.env`；测试环境跳过本地文件，容器和云托管仍应通过运行环境注入变量。`.env` 已被 Git 忽略，禁止提交。

生产环境至少必须配置：

```text
NODE_ENV=production
MYSQL_ADDRESS=host:3306
MYSQL_DATABASE=wenwan_mall
MYSQL_USERNAME=username
MYSQL_PASSWORD=password
WECHAT_CLOUD_ENV_ID=prod-d9g4jzwa5832354ed
WECHAT_MINIPROGRAM_APP_ID=wx14a6f266208130dd
WECHAT_CLOUD_SERVICE_NAME=express-zaiy
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
npm run db:verify
npm run api:verify-public
npm run api:verify-user
npm run api:verify-commerce
npm run api:verify-orders
npm run api:verify-admin-auth
npm run api:verify-admin-catalog
npm run api:verify-admin-orders
npm run orders:expire
npm run admin:bootstrap
npm run admin:security:cleanup
npm run db:seed
```

数据库结构只能通过 `migrations/` 下的前向迁移调整。禁止在生产环境使用 `sequelize.sync({ alter: true })`。`npm run db:verify` 会核验当前核心表、关键字段、迁移状态、存储引擎、字符集和外键覆盖。

迁移默认不会随服务启动自动执行。部署流程应先执行 `npm run db:migrate`；若部署环境必须由容器启动时执行，可显式配置 `AUTO_MIGRATE=true`。迁移器使用 MySQL 命名锁，避免多实例同时执行。

种子数据必须显式执行。生产环境默认拒绝执行，只有明确设置 `ALLOW_DATABASE_SEED=true` 才可运行；前端模拟数据不会自动写入正式数据库。

## 公共浏览 API

以下接口不接受客户端提交的 `openid`、`userId` 或 `role`，并且只返回已启用、已发布或在售的数据：

```text
GET /api/v1/home
GET /api/v1/categories
GET /api/v1/products
GET /api/v1/products/:productId
GET /api/v1/collections/:collectionId
GET /api/v1/article-tags
GET /api/v1/articles
GET /api/v1/articles/:articleId
GET /api/v1/search/hot-keywords
```

`npm run api:verify-public` 会在数据库事务中写入临时契约数据，验证首页、分类、筛选分页、SKU 价格库存、合集和图文文章后完整回滚，不会把验证数据留在数据库中。正式商品和内容仍需由后续管理 API 或受控初始化流程创建。

## 普通用户身份 API

```text
GET /api/v1/me
GET /api/v1/me/summary
```

这两个接口只能经微信云托管网关调用。服务端校验云托管注入的 `x-wx-openid`、`x-wx-appid`、`x-wx-env` 和 `x-wx-source`，首次识别时在 OpenID 唯一约束下自动创建 `users` 记录。响应仅包含内部用户资料和统计，不返回 OpenID；请求体或查询参数中的 `openid`、`userId`、`role` 不参与身份判断。

生产环境不得把可直接伪造这些请求头的公网容器地址作为已认证 API 入口。小程序应通过 `wx.cloud.callContainer` 调用服务 `express-zaiy`。本阶段不使用 `wx.login + code2Session`，前端和仓库均不保存 AppSecret。

`npm run api:verify-user` 会创建随机临时用户，验证 8 路并发首次识别、身份拒绝规则、个人资料和统计接口，并在结束时精确删除该临时记录。

## 购物车与收货地址 API

```text
GET    /api/v1/me/cart
POST   /api/v1/me/cart/items
PATCH  /api/v1/me/cart/items/:itemId
DELETE /api/v1/me/cart/items/:itemId
PATCH  /api/v1/me/cart/selection

GET    /api/v1/me/addresses
POST   /api/v1/me/addresses
PATCH  /api/v1/me/addresses/:addressId
DELETE /api/v1/me/addresses/:addressId
PUT    /api/v1/me/addresses/:addressId/default
```

购物车按当前内部用户及 SKU 唯一合并；价格、可售库存、上下架和规格启停状态全部实时读取数据库，客户端价格不参与计算。数量限制为 1–99，同时不得超过 `on_hand_quantity - reserved_quantity`。

地址写入使用事务和用户行锁，每名用户最多 20 条有效地址。存在地址时始终保持且仅保持一个默认地址；删除默认地址后自动选择最早保存的有效地址。所有查询和写入均附带当前可信用户 ID，不允许跨用户访问。

`npm run api:verify-commerce` 会创建隔离的临时商品、用户、购物车和地址夹具，验证并发 SKU 合并、实时库存、身份隔离、20 条地址上限和默认地址唯一性，最后物理清理并核验夹具归零。

## 收藏、结算与订单 API

```text
GET    /api/v1/me/favorites
PUT    /api/v1/me/favorites/:productId
DELETE /api/v1/me/favorites/:productId

POST   /api/v1/me/checkout/preview
POST   /api/v1/me/orders
GET    /api/v1/me/orders
GET    /api/v1/me/orders/by-no/:orderNo
GET    /api/v1/me/orders/:orderId
POST   /api/v1/me/orders/:orderId/cancel
```

收藏写操作幂等。结算预览只接受商品/SKU/数量或当前用户购物车项，价格和可售库存由服务端重算，原始结算令牌只返回一次且数据库只保存哈希。

创建订单必须携带 16–80 字符的 `Idempotency-Key` 请求头。同一用户同一幂等键的并发重试返回同一订单；订单事务按稳定 SKU 顺序锁定并预占库存，用户取消或超时关闭时释放。当前支付固定为 `NOT_ENABLED`，不会创建支付单或调用微信支付。

`npm run api:verify-orders` 使用隔离夹具验证收藏幂等、价格变化、同键重复提交、跨用户隔离、最后一件库存并发争抢、取消与超时释放，并在结束时清理夹具。生产环境需将 `npm run orders:expire` 配置为云托管定时任务，建议每 5 分钟执行一次。

## 管理员认证与 RBAC

```text
POST /api/admin/auth/login
POST /api/admin/auth/refresh
POST /api/admin/auth/logout
GET  /api/admin/me
GET  /api/admin/logs
```

管理接口同时要求可信云托管路由头和独立管理员凭证。密码使用带随机盐的 scrypt 哈希；会话使用 256 位随机不透明 Token，数据库只保存 Token 哈希。单账号连续失败 5 次锁定 30 分钟，数据库登录范围限制可跨容器实例生效。

系统迁移会建立 `SUPER_ADMIN/OPERATOR/CONTENT_EDITOR` 角色及细粒度权限，但不会写入任何默认账号密码。首次部署需临时配置：

```text
ADMIN_BOOTSTRAP_USERNAME=your-admin
ADMIN_BOOTSTRAP_NAME=管理员名称
ADMIN_BOOTSTRAP_PASSWORD=至少12位且包含大小写字母、数字和符号
npm run admin:bootstrap
```

成功后立即删除 `ADMIN_BOOTSTRAP_PASSWORD` 环境变量。初始化命令在已有管理员时会安全跳过，不提供公开注册接口。

`npm run api:verify-admin-auth` 使用临时管理员验证网关限制、密码失败锁定、Token 哈希、会话轮换/撤销、RBAC 和审计后清理夹具。建议每日运行 `npm run admin:security:cleanup` 清理七天前已过期或撤销的会话及过期登录限流记录。

## 管理员目录与库存 API

```text
GET/POST          /api/admin/categories
PATCH/DELETE      /api/admin/categories/:categoryId
PUT               /api/admin/categories/reorder
GET/POST          /api/admin/products
GET/PATCH/DELETE  /api/admin/products/:productId
POST              /api/admin/products/:productId/on-sale
POST              /api/admin/products/:productId/off-shelf
GET               /api/admin/variants/:variantId/inventory-movements
POST              /api/admin/variants/:variantId/inventory-adjustments
```

分类和材质使用稳定 ID，改名会立即反映到公共浏览接口而不会改写商品外键。商品写入事务性保存完整 SKU 和图库关系，并使用商品 `version` 防止并发覆盖；每个 SKU 独立定价。新 SKU 仅能在创建时设置初始库存，此后所有库存变化必须通过有原因、有操作日志且校验 SKU 版本的库存调整接口。

执行真实数据库目录契约验证：

```bash
npm run api:verify-admin-catalog
```

该命令验证分类改名同步、删除引用保护、SKU 独立定价、商品上下架、版本冲突、库存流水、RBAC 和审计，并自动清理隔离测试数据。

## 管理首页与订单 API

```text
GET  /api/admin/dashboard
GET  /api/admin/orders
GET  /api/admin/orders/:orderId
POST /api/admin/orders/:orderId/confirm
POST /api/admin/orders/:orderId/cancel
```

管理订单列表支持状态、订单号/收件人/手机号关键字、创建时间区间和分页查询，详情始终读取下单时的商品、规格、图片、价格和收货信息快照。确认订单在事务内把 SKU 预占转为正式扣减并累计商品销量；取消或超时关闭只释放预占，不扣减实物库存。重复确认和重复取消保持幂等，非法状态迁移返回稳定的 409 业务错误。

```bash
npm run api:verify-admin-orders
```

该命令使用隔离夹具验证管理首页、订单列表/详情、RBAC、确认/取消幂等、超时关闭、库存流水和审计，并在结束后清理测试数据。应用写入数据库的 JavaScript 时间会统一序列化为 UTC，订单是否过期由 MySQL 时钟判定，避免开发机、容器和数据库时区不同导致提前或延迟关闭。

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
