# 后端交接与 API 契约

> 版本：1.2（前后端共享配置基线，2026-08-02）
> 事实基线：当前 `miniprogram` 原生微信小程序代码、`data/*`、`utils/shop-store.js`、`utils/admin-store.js`、`app.json` 与现有分析文档。  
> 本文只定义后端边界和建议契约，不代表模拟数据已成为正式数据库数据，也不包含后端实现代码。

## 0. 已确认架构与安全边界

- 唯一客户端是同一 AppID 下的原生微信小程序，普通用户端和管理员端都在该小程序内。
- 正式链路为：小程序 `wx.cloud.callContainer` → 微信云托管服务 `express-zaiy` → Express → MySQL。
- 普通用户不使用账号密码。Express 只信任微信云托管注入的 `x-wx-openid`，按 OpenID 查询或首次自动创建 `users` 记录。
- 前端不得保存 AppSecret，也不得提交 `openid`、`userId` 或 `role` 作为可信身份；这些值即使出现在请求中，后端也必须忽略。
- 管理员使用独立管理员账号登录。后端签发管理员会话或 Token，所有 `/api/admin/*` 接口必须在后端校验登录状态和权限。
- 当前仍是静态模拟阶段：`wx` 本地存储保存模拟用户数据和模拟管理员会话，不调用真实 API，不调用 `wx.requestPayment`。
- 第一批后端接入建议先上线只读浏览接口，再接入用户身份、购物车、地址和订单；不得在生产环境静默回退到模拟数据。

### 0.1 本版本冻结的前端事实

- 首页快捷分类不是“取分类列表前五项”，而是管理员独立配置的 **5 个不重复分类入口**，每项包含分类关联、1–2 字印记和展示顺序。
- 首页精选商品由管理员选择并排序，当前前端限制 1–8 件；新品仍应由后端按首次上架时间计算。
- Banner 只允许 `NONE`（不跳转）或 `PRODUCT`（关联已有商品），不接收任意小程序路径；目标商品失效时服务端应清空关联或按不跳转返回。
- 商品图库、Banner、合集封面、文章封面和文章正文图片已统一为“添加/更换/删除”交互；本地文件仅是模拟实现，正式环境必须先上传媒体再提交媒体 ID。
- 文玩志正文是可排序的结构化内容块，类型仅限 `HEADING/PARAGRAPH/IMAGE`，支持多张正文图片，不保存 HTML。
- 合集中的商品是有序多选关系，前台必须按管理员配置顺序展示，并过滤不可见商品。
- 当前模拟态已增加 `utils/public-data.js` 作为用户端读取边界；分类、搜索、文玩志、商品详情和合集详情在页面重新显示时会读取最新管理配置，不再保留过期数组快照。正式 API 接入应替换该边界，而不应让页面直连后端字段。
- 分类或材质改名会立即同步当前模拟商品、首页快捷入口和相关展示字段；正式后端必须使用稳定 `categoryId/materialId` 维持关联，改名只修改展示名，不级联替换业务外键。
- 模拟订单项现已保存 `productName/productSubtitle/productImage` 不可变展示快照；商品后续改名或删除不得改变历史订单。
- 本节内容是后端 DTO、数据库关系和管理 API 的冻结依据；后端不得回退为旧的 `to` 路径、单图文章或固定首页五分类。

## 1. 当前用户端 14 个页面与后端数据

以下路由来自当前 `app.json`，不是旧规划中的建议路径。

| # | 当前页面 | 页面参数 | 页面需要的后端数据 | 当前模拟数据及字段 | 建议 API |
|---|---|---|---|---|---|
| 1 | `pages/home/index` 首页 | 无 | 首页配置、可见 Banner、分类入口、精选商品、新品、合集、推荐文章、购物车数量 | `getPublicHomeData()`：`banners`、`categories`、`featuredProducts`、`newArrivals`、`collections`、`articles`、`homeConfig`；商品卡字段见第 2 节 | `GET /api/v1/home`；身份接入后另取 `GET /api/v1/me/summary` |
| 2 | `pages/search/index` 搜索 | `q`：初始关键词 | 热门词、商品搜索结果；历史词仅保存在本机 | `public-data.getSearchData()`；模拟态热词由当前材质/分类/标签去重派生；`wenwan-search-history: string[]`；商品字段本地包含匹配 | `GET /api/v1/search/hot-keywords`；`GET /api/v1/products?keyword=...`；不提供搜索历史云端接口 |
| 3 | `pages/category/index` 分类/商品列表 | 模拟态兼容 `category`、`material` 中文名；正式改为 `categoryId`、`materialId` | 商品分类、材质分类、筛选后的商品摘要、总数和分页状态 | `public-data.getCatalog()`；页面 `onShow` 刷新；已选分类失效时自动回退“全部”；本地 `PAGE_SIZE=8` | `GET /api/v1/categories`；`GET /api/v1/products` |
| 4 | `pages/journal/index` 文玩志列表 | `tag`，当前传中文名称 | 文章标签、已发布文章摘要、总数、分页 | `tags[]`；`articles[]` 的 `id/title/tag/image/summary/date/author/minutes`；本地 `PAGE_SIZE=4` | `GET /api/v1/article-tags`；`GET /api/v1/articles` |
| 5 | `pages/journal/detail/index` 文章详情 | `id` | 文章完整正文、封面、元信息、同标签相关文章 | `article` 全字段；`contentBlocks[{id,type,text?/url?/caption?}]`；`related[]`；旧 `body[]` 仅用于本地数据迁移兼容 | `GET /api/v1/articles/:articleId` |
| 6 | `pages/product/detail/index` 商品详情 | `id` | 商品详情、图片、规格/SKU、库存、参数、说明、标签、同类推荐；身份接入后收藏状态和购物车数 | `product`；`images/variants/specs/params/detail/tags/active/status`；选中 SKU 的 `priceValue/originPriceValue/stock/enabled`；`favorite/cartCount/similarProducts` | `GET /api/v1/products/:productId`；后续 `PUT/DELETE /api/v1/me/favorites/:productId` |
| 7 | `pages/collection/index` 产品合集 | `id` | 合集信息及按配置顺序返回的在售商品 | `collection: id/title/latin/desc/cover/productIds/visible`；由 `productIds` 本地关联商品 | `GET /api/v1/collections/:collectionId` |
| 8 | `pages/cart/index` 购物车 | 无 | 当前用户购物车项、商品快照、实时价格/规格/库存/可售状态、合计 | `cart[]: id/productId/variantId/spec/qty/checked`，运行时拼接 `product/variant/priceValue/stock/available/statusText` | `GET /api/v1/me/cart`；`POST/PATCH/DELETE /api/v1/me/cart/items...` |
| 9 | `pages/checkout/index` 确认订单 | 无；依赖本地 `pendingCheckout` | 结算预览、选中商品、服务器重算金额、可售与库存校验、地址列表/默认地址、备注限制 | `pendingCheckout: source/items[]`；项含 `cartItemId/productId/variantId/spec/qty/price`；`selectedAddressId`、`addresses[]`、`remark` | `POST /api/v1/me/checkout/preview`；`POST /api/v1/me/orders` |
| 10 | `pages/address/index` 收货地址 | `select=1` 表示选择模式 | 当前用户地址列表及新增、编辑、删除、设默认 | `addresses[]: id/name/phone/region/detail/isDefault`；`selectedAddressId` | `GET/POST /api/v1/me/addresses`；`PATCH/DELETE /api/v1/me/addresses/:id`；`PUT .../:id/default` |
| 11 | `pages/mine/index` 个人中心 | 无 | 内部用户资料、订单/收藏/地址数量、购物车数量、管理员入口仅作为导航 | 当前没有用户实体；直接统计 `orders/favorites/addresses/cart` | `GET /api/v1/me`；`GET /api/v1/me/summary` |
| 12 | `pages/orders/index` 我的订单 | 当前无 URL 参数；页面内筛选 | 当前用户订单分页列表、状态筛选、订单项快照、收货信息、取消能力 | `orders[]: id/no/createdAt/status/items/total/address/remark/confirmedAt`；状态 `pending/confirmed/cancelled` | `GET /api/v1/me/orders?status=...`；`POST /api/v1/me/orders/:id/cancel` |
| 13 | `pages/favorites/index` 我的收藏 | 无 | 当前用户收藏商品分页列表、商品实时可售状态 | `favorites: productId[]`，页面本地关联 `products` | `GET /api/v1/me/favorites`；`PUT/DELETE /api/v1/me/favorites/:productId` |
| 14 | `pages/order/success/index` 下单成功 | `no`：订单号 | 由后端重新读取的订单结果摘要，不能只相信页面 query | 仅按 `no` 从本地 `orders` 查找；字段 `orderNo/itemCount/totalText`，找不到时不再错误回退到其他订单 | `GET /api/v1/me/orders/by-no/:orderNo` |

### 页面状态字段说明

`isLoading/loadState/loadingMore/refresherTriggered/imageError/confirmClear/panelVisible/headerStyle` 等字段只是页面 UI 状态，不应进入数据库。后端只需稳定返回业务数据、分页信息和可操作状态，页面继续自行处理加载、空、错误及图片失败状态。

## 2. 当前模拟数据字段清单

### 2.1 商品目录 `data/catalog.js`

| 对象 | 当前字段 |
|---|---|
| 分类 | `categories: string[]`，首项是“全部”；经 `admin-store` 去空、去重、限长和排序，由 `public-data` 动态供用户端读取 |
| 材质 | `materials: string[]`，首项是“全部”；与商品分类是两个独立维度 |
| 商品 | `id`、`name`、`subtitle`、`price`、`priceValue`、`originPrice`、`originPriceValue`、`material`、`category`、`craft`、`image`、`images`、`sales`、`status`、`specs`、`variants[]`、`params[{label,value}]`、`detail[]`、`tags[]`、`stock`、`lowStockThreshold`、`active` |
| 商品规格/SKU | `id`、`specLabel`、`priceValue`、`originPriceValue`、`stock`、`lowStockThreshold`、`enabled`；无规格商品也有“默认规格” |

当前状态推导：`offShelf` 对应 `active=false`，所有启用 SKU 的可售库存合计为 0 时对应 `soldOut`，其余为 `onSale`。运行时库存以 `shopState.inventory[variantId]` 的 SKU 覆盖值优先。

### 2.2 Banner、首页配置、合集和文章

| 对象 | 当前字段 |
|---|---|
| Banner | `id`、`title`、`subtitle`、`image`、`targetProductId`、`visible`；`targetProductId` 可为空，不再接受任意前端路径 |
| 首页配置 | `featuredTitle`、`showFeatured`、`showCollections`、`showJournal`、`featuredIds[]`、`quickCategories[{category,label,mark}]` |
| 合集 | `id`、`title`、`latin`、`desc`、`cover`、`productIds[]`、`visible`；首页展示时派生 `image/count` |
| 文章 | `id`、`title`、`tag`、`image`、`cover`、`summary`、`date`、`author`、`minutes`、`contentBlocks[{id,type,text?/url?/caption?}]`、`published`、`hot`；旧 `body[]` 自动迁移 |

### 2.3 用户模拟状态 `utils/shop-store.js`

| 对象 | 当前字段 |
|---|---|
| 购物车项 | `id`、`productId`、`variantId`、`spec`、`qty`、`checked` |
| 收藏 | `productId[]` |
| 地址 | `id`、`name`、`phone`、`region`、`detail`、`isDefault` |
| 待结算 | `source: cart/buyNow`、`items[{cartItemId?,productId,variantId,spec,qty,price}]` |
| 订单 | `id`、`no`、`createdAt`、`status`、`items[]`、`total`、`remark?`、`address`、`confirmedAt?` |
| 订单项 | `productId`、`variantId`、`spec`、`qty`、`price`、`productName`、`productSubtitle`、`productImage`；后三项为下单时展示快照 |
| 运行时库存 | `inventory: { [variantId]: number }` |
| 其他 | `selectedAddressId`、`demoSeedVersion` |

### 2.4 管理端模拟状态 `utils/admin-store.js`

| 对象 | 当前字段 |
|---|---|
| 管理员 | `id`、`username`、`name`、`role`、`active`、`createdAt`、模拟态 `demoPassword` |
| 管理会话 | `id`、`username`、`name`、`role`、`roleName`、`createdAt`、`lastActive`、`mock` |
| 操作日志 | `id`、`module`、`action`、`target`、`operator`、`username`、`createdAt` |

模拟密码只用于当前演示，不得迁入正式数据库明文字段。正式密码只能保存强哈希及必要的算法参数。

## 3. 统一建模约定

- MySQL 主键建议使用 `BIGINT UNSIGNED`；JSON 中一律序列化为字符串，避免 JavaScript 大整数精度丢失。
- 金额一律使用整数分，字段以 `Amount` 结尾，例如 `priceAmount: 388000`。币种固定返回 `currency: "CNY"`；禁止浮点金额。
- 时间统一为 UTC 的 ISO 8601 字符串，例如 `2026-08-01T07:30:00.000Z`；数据库使用 `DATETIME(3)`。
- 数据库使用 `snake_case`，API JSON 使用 `camelCase`。
- 枚举值使用稳定英文大写值，中文只作为 `statusLabel` 等展示字段返回。
- 图片只保存正式可访问 URL/对象存储 key，不保存开发者工具临时路径。
- 删除商品、文章、订单等有审计价值的数据优先软删除；订单项必须保存下单时快照。
- 列表默认 `page=1&pageSize=20`，`pageSize` 最大 50；统一返回 `total` 和 `hasMore`。

## 4. 正式核心实体定义

“必填”指创建或持久化该记录时是否必须存在。系统生成字段也标为必填。

### 4.1 用户 `users`

| 字段 | MySQL / API 类型 | 必填 | 说明 |
|---|---|---:|---|
| `id` | BIGINT / string | 是 | 内部用户 ID，前端不可自报为可信身份 |
| `openid` | VARCHAR(64) / 不下发 | 是 | 从可信 `x-wx-openid` 获取，唯一索引 |
| `nickname` | VARCHAR(64) / string | 否 | 用户主动授权或填写后保存 |
| `avatar_url` | VARCHAR(512) / string | 否 | 头像 URL |
| `phone` | VARCHAR(32) / string | 否 | 与收货地址电话分离；如需绑定必须走微信能力或后端校验 |
| `status` | ENUM / string | 是 | `ACTIVE`、`DISABLED` |
| `last_seen_at` | DATETIME(3) / string | 否 | 最近识别时间 |
| `created_at`、`updated_at` | DATETIME(3) / string | 是 | 审计时间 |

首次请求应在 `openid` 唯一约束下执行查询或创建，处理并发首次访问；接口只返回内部 `id/nickname/avatarUrl/status` 等资料，不返回 OpenID。

### 4.2 分类 `categories`

| 字段 | MySQL / API 类型 | 必填 | 说明 |
|---|---|---:|---|
| `id` | BIGINT / string | 是 | 分类 ID |
| `code` | VARCHAR(64) / string | 是 | 稳定业务编码，唯一 |
| `dimension` | ENUM / string | 是 | `PRODUCT_CATEGORY` 或 `MATERIAL` |
| `name` | VARCHAR(40) / string | 是 | 显示名称；“全部”不是数据库记录 |
| `parent_id` | BIGINT / string | 否 | 预留层级分类，当前为空 |
| `icon_text` | VARCHAR(8) / string | 否 | 首页“手/茶/印/玉/把”等文字标记 |
| `sort_order` | INT / number | 是 | 越小越靠前 |
| `enabled` | TINYINT(1) / boolean | 是 | 是否可用于前台筛选 |
| `created_at`、`updated_at` | DATETIME(3) / string | 是 | 审计时间 |

`id/code` 在创建后不因改名而变化。管理端修改 `name` 后，分类页、搜索、首页入口和商品关联通过稳定 ID 立即获得新名称；不允许以中文名做外键或缓存键。

### 4.3 商品 `products`

| 字段 | MySQL / API 类型 | 必填 | 说明 |
|---|---|---:|---|
| `id` | BIGINT / string | 是 | 商品 ID |
| `code` | VARCHAR(64) / string | 是 | 稳定商品编码，替代模拟 `p-01` |
| `name` | VARCHAR(80) / string | 是 | 商品名称 |
| `subtitle` | VARCHAR(160) / string | 是 | 商品副标题 |
| `category_id` | BIGINT / string | 是 | 商品品类 |
| `material_id` | BIGINT / string | 否 | 材质分类 |
| `craft` | VARCHAR(100) / string | 否 | 工艺展示文本 |
| `price_amount` | BIGINT / number | 是 | 默认/起售价，单位分 |
| `original_price_amount` | BIGINT / number | 否 | 划线价，单位分且不得低于售价 |
| `currency` | CHAR(3) / string | 是 | 当前固定 `CNY` |
| `sale_status` | ENUM / string | 是 | `DRAFT`、`ON_SALE`、`OFF_SHELF`、`DELETED` |
| `sales_count` | BIGINT / number | 是 | 当前按已由管理员确认且未取消的商品件数统计；接入支付后切换为已支付且未全额退款件数 |
| `low_stock_threshold` | INT / number | 是 | 低库存阈值；多 SKU 时可移到 SKU |
| `primary_image_url` | API string | 是 | API 便捷字段，由 `product_images` 主图及媒体资产派生，不作为客户端可信写入字段 |
| `tags_json` | JSON / string[] | 否 | 当前标签；后续可拆标签表 |
| `attributes_json` | JSON / object[] | 否 | 当前 `params[{label,value}]` |
| `detail_sections_json` | JSON / object[] | 否 | 当前详情段落；应限制允许的结构和长度 |
| `published_at` | DATETIME(3) / string | 否 | 首次上架时间 |
| `created_at`、`updated_at`、`deleted_at` | DATETIME(3) / string | 是/是/否 | 审计及软删除 |

商品的 `stockStatus`、`availableStock`、`minPriceAmount` 等可作为 API 派生字段，不应由前端上传决定。

### 4.4 商品图片 `product_images`

| 字段 | MySQL / API 类型 | 必填 | 说明 |
|---|---|---:|---|
| `id` | BIGINT / string | 是 | 图片 ID |
| `product_id` | BIGINT / string | 是 | 所属商品 |
| `media_id` | BIGINT / string | 是 | 关联 `media_assets.id` |
| `url` | API string | 是 | API 从媒体资产派生的正式 URL，不由客户端直接写库 |
| `kind` | ENUM / string | 是 | `PRIMARY`、`GALLERY`、`DETAIL` |
| `alt_text` | VARCHAR(160) / string | 否 | 无障碍/失败时说明 |
| `sort_order` | INT / number | 是 | 展示顺序 |
| `created_at` | DATETIME(3) / string | 是 | 创建时间 |

### 4.5 Banner `banners`

| 字段 | MySQL / API 类型 | 必填 | 说明 |
|---|---|---:|---|
| `id` | BIGINT / string | 是 | Banner ID |
| `title`、`subtitle` | VARCHAR(80/120) / string | 是/否 | 标题与副标题 |
| `image_media_id` | BIGINT / string | 是 | 关联 `media_assets.id` |
| `image_url` | API string | 是 | API 派生图片 URL |
| `link_type` | ENUM / string | 是 | 第一版只允许 `NONE`、`PRODUCT` |
| `target_product_id` | BIGINT / string | 否 | 管理员从已有商品选择；`NONE` 时为空，商品删除时自动清空 |
| `visible` | TINYINT(1) / boolean | 是 | 是否显示 |
| `sort_order` | INT / number | 是 | 轮播顺序 |
| `starts_at`、`ends_at` | DATETIME(3) / string | 否 | 定时投放预留 |
| `created_at`、`updated_at` | DATETIME(3) / string | 是 | 审计时间 |

### 4.6 产品合集 `collections` 与 `collection_products`

| 字段 | MySQL / API 类型 | 必填 | 说明 |
|---|---|---:|---|
| `collections.id` | BIGINT / string | 是 | 合集 ID |
| `code` | VARCHAR(64) / string | 是 | 稳定编码 |
| `title` | VARCHAR(80) / string | 是 | 中文标题 |
| `latin_title` | VARCHAR(120) / string | 否 | 当前 `latin` |
| `description` | VARCHAR(500) / string | 是 | 当前 `desc` |
| `cover_media_id` | BIGINT / string | 是 | 关联 `media_assets.id` |
| `cover_image_url` | API string | 是 | API 派生，映射当前 `cover` |
| `visible` | TINYINT(1) / boolean | 是 | 是否显示 |
| `sort_order` | INT / number | 是 | 合集顺序 |
| `created_at`、`updated_at` | DATETIME(3) / string | 是 | 审计时间 |
| `collection_products.collection_id` | BIGINT / string | 是 | 合集 ID |
| `collection_products.product_id` | BIGINT / string | 是 | 商品 ID，联合唯一 |
| `collection_products.sort_order` | INT / number | 是 | 合集中商品顺序 |

### 4.7 文玩志文章 `articles`

| 字段 | MySQL / API 类型 | 必填 | 说明 |
|---|---|---:|---|
| `id` | BIGINT / string | 是 | 文章 ID |
| `code` | VARCHAR(64) / string | 是 | 稳定编码 |
| `title` | VARCHAR(160) / string | 是 | 标题 |
| `tag` | VARCHAR(40) / string | 是 | 第一版单标签，取值由后端内容配置维护，不建立文章与标签多对多关系 |
| `summary` | VARCHAR(500) / string | 是 | 摘要 |
| `author_name` | VARCHAR(80) / string | 是 | 作者显示名 |
| `cover_media_id` | BIGINT / string | 是 | 文章封面媒体，关联 `media_assets.id` |
| `cover_image_url` | API string | 是 | API 派生封面 URL |
| `body_json` | JSON / object[] | 是 | 有序结构化正文块：`id/type(HEADING/PARAGRAPH/IMAGE)/text?/mediaId?/caption?`；图片块响应时补充 `imageUrl`，禁止任意 HTML |
| `reading_minutes` | SMALLINT / number | 是 | 预计阅读分钟 |
| `status` | ENUM / string | 是 | `DRAFT`、`PUBLISHED`、`ARCHIVED` |
| `is_hot` | TINYINT(1) / boolean | 是 | 首页推荐标记 |
| `published_at` | DATETIME(3) / string | 否 | 正式发布时间 |
| `created_at`、`updated_at` | DATETIME(3) / string | 是 | 审计时间 |

### 4.8 收藏 `favorites`

| 字段 | MySQL / API 类型 | 必填 | 说明 |
|---|---|---:|---|
| `user_id` | BIGINT / string | 是 | 由可信用户上下文取得 |
| `product_id` | BIGINT / string | 是 | 商品 ID |
| `created_at` | DATETIME(3) / string | 是 | 收藏时间 |

`(user_id, product_id)` 建唯一索引；PUT/DELETE 设计为幂等操作。

### 4.9 购物车 `cart_items`

| 字段 | MySQL / API 类型 | 必填 | 说明 |
|---|---|---:|---|
| `id` | BIGINT / string | 是 | 购物车项 ID |
| `user_id` | BIGINT / string | 是 | 当前用户 |
| `product_id` | BIGINT / string | 是 | 商品 ID |
| `variant_id` | BIGINT / string | 是 | 所有商品必须对应 SKU；无规格商品使用默认 SKU |
| `quantity` | INT / number | 是 | 当前前端限制 1–99；还需受库存约束 |
| `checked` | TINYINT(1) / boolean | 是 | 是否选中结算，可保留服务端同步 |
| `created_at`、`updated_at` | DATETIME(3) / string | 是 | 审计时间 |

同一用户、商品、规格应唯一；接口返回商品和规格快照、实时价格、库存及 `availabilityReason`，但数据库购物车项不保存可信价格。

### 4.10 收货地址 `user_addresses`

| 字段 | MySQL / API 类型 | 必填 | 说明 |
|---|---|---:|---|
| `id` | BIGINT / string | 是 | 地址 ID |
| `user_id` | BIGINT / string | 是 | 当前用户 |
| `recipient_name` | VARCHAR(40) / string | 是 | 当前校验 2–20 字 |
| `phone` | VARCHAR(32) / string | 是 | 当前校验中国大陆 11 位手机号 |
| `province`、`city`、`district` | VARCHAR(80) / string | 是 | 应拆分当前 `region` |
| `detail` | VARCHAR(240) / string | 是 | 当前校验 5–100 字 |
| `postal_code` | VARCHAR(20) / string | 否 | 预留 |
| `label` | VARCHAR(30) / string | 否 | 家/公司等预留 |
| `is_default` | TINYINT(1) / boolean | 是 | 每用户最多一个默认地址 |
| `created_at`、`updated_at`、`deleted_at` | DATETIME(3) / string | 是/是/否 | 审计及软删除 |

设置默认地址必须在事务中取消该用户其他默认地址；所有查询和修改都必须附带当前内部 `user_id` 条件。

### 4.11 订单 `orders`

| 字段 | MySQL / API 类型 | 必填 | 说明 |
|---|---|---:|---|
| `id` | BIGINT / string | 是 | 订单 ID |
| `order_no` | VARCHAR(40) / string | 是 | 全局唯一、不可预测订单号 |
| `user_id` | BIGINT / string | 是 | 当前用户 |
| `status` | ENUM / string | 是 | 当前阶段使用 `PENDING_CONFIRMATION`、`CONFIRMED`、`CANCELLED`、`CLOSED` |
| `payment_status` | ENUM / string | 是 | 当前固定 `NOT_ENABLED`；后续见第 8 节 |
| `currency` | CHAR(3) / string | 是 | `CNY` |
| `items_amount` | BIGINT / number | 是 | 商品金额，分 |
| `discount_amount` | BIGINT / number | 是 | 当前为 0，分 |
| `shipping_amount` | BIGINT / number | 是 | 当前为 0，分 |
| `payable_amount` | BIGINT / number | 是 | 应付总额，分 |
| `item_count` | INT / number | 是 | 商品件数派生/快照 |
| `source` | ENUM / string | 是 | `CART` 或 `BUY_NOW` |
| `remark` | VARCHAR(300) / string | 否 | 当前最多 100 字 |
| `receiver_name/phone/province/city/district/detail` | VARCHAR / string | 是 | 下单时地址快照，不随地址簿变化 |
| `idempotency_key` | VARCHAR(80) / string | 是 | 用户维度唯一，防重复提交 |
| `cancel_reason` | VARCHAR(300) / string | 否 | 取消原因 |
| `expires_at` | DATETIME(3) / string | 是 | 当前阶段创建后 24 小时，超时关闭并释放预占库存 |
| `created_at`、`confirmed_at`、`cancelled_at`、`closed_at` | DATETIME(3) / string | 是/否/否/否 | 状态时间 |
| `updated_at` | DATETIME(3) / string | 是 | 更新时间 |

### 4.12 订单明细 `order_items`

| 字段 | MySQL / API 类型 | 必填 | 说明 |
|---|---|---:|---|
| `id` | BIGINT / string | 是 | 明细 ID |
| `order_id` | BIGINT / string | 是 | 订单 ID |
| `product_id` | BIGINT / string | 否 | 原商品可被软删除，保留关联 |
| `variant_id` | BIGINT / string | 是 | 下单 SKU ID；无规格商品也有默认 SKU |
| `product_code_snapshot` | VARCHAR(64) / string | 是 | 商品编码快照 |
| `product_name_snapshot` | VARCHAR(160) / string | 是 | 名称快照 |
| `product_subtitle_snapshot` | VARCHAR(200) / string | 否 | 副标题快照，供历史订单展示 |
| `image_url_snapshot` | VARCHAR(512) / string | 否 | 主图快照 |
| `spec_snapshot` | VARCHAR(160) / string | 否 | 当前 `spec` |
| `unit_price_amount` | BIGINT / number | 是 | 下单单价，分 |
| `quantity` | INT / number | 是 | 数量 |
| `subtotal_amount` | BIGINT / number | 是 | 单价乘数量，分 |

### 4.13 商品规格/SKU `product_variants`

| 字段 | MySQL / API 类型 | 必填 | 说明 |
|---|---|---:|---|
| `id` | BIGINT / string | 是 | SKU ID，购物车、结算和订单必须使用 |
| `product_id` | BIGINT / string | 是 | 所属商品 |
| `sku_code` | VARCHAR(80) / string | 是 | 唯一 SKU 编码 |
| `spec_label` | VARCHAR(100) / string | 是 | 规格显示名；无规格商品为“默认规格” |
| `price_amount` | BIGINT / number | 是 | 独立售价，单位分且大于 0 |
| `original_price_amount` | BIGINT / number | 否 | 独立划线价，单位分且不得低于售价 |
| `on_hand_quantity` | INT / number | 是 | 账面现存量，非负整数 |
| `reserved_quantity` | INT / number | 是 | 已被待确认订单预占的数量，非负且不得超过现存量 |
| `low_stock_threshold` | INT / number | 是 | 独立低库存预警值 |
| `enabled` | TINYINT(1) / boolean | 是 | 停用后不可新购，但历史订单仍保留快照 |
| `sort_order` | INT / number | 是 | 规格显示顺序 |
| `version` | INT / number | 是 | 乐观锁版本，配合事务防并发覆盖 |
| `created_at`、`updated_at` | DATETIME(3) / string | 是 | 审计时间 |

可售量统一计算为 `on_hand_quantity - reserved_quantity`。商品列表的起售价取所有启用 SKU 的最低售价；商品售罄状态由所有启用 SKU 的可售量共同派生。

### 4.14 必需的支撑实体

当前小程序模拟层已增加 SKU 级价格、库存和 `variantId`，但仍由本地存储运行。正式后端要解决并发预占、超卖、库存审计和多端一致性，第一版数据库必须同时包含：

| 实体 | 核心字段 | 用途 |
|---|---|---|
| `inventory_movements` | `id/variant_id/change_quantity/reserved_change/before_quantity/after_quantity/reason_type/reference_type/reference_id/operator_id/created_at` | 所有入库、预占、扣减、释放、恢复、盘点可审计 |
| `admin_users` | `id/username/password_hash/name/role_id/status/openid_binding?/last_login_at/...` | 独立管理员账号，绝不保存明文密码 |
| `admin_sessions` | `id/admin_user_id/token_hash/expires_at/revoked_at/...` | 管理会话/Token 撤销和过期 |
| `admin_roles/permissions` | 角色、权限、映射表 | 后端 RBAC，不能依靠前端隐藏按钮 |
| `admin_operation_logs` | 操作者、模块、动作、目标、请求 ID、前后摘要、时间 | 管理操作审计；生产环境不应提供普通“清空日志”能力 |

### 4.15 通用媒体与首页配置实体

#### 媒体资产 `media_assets`

| 字段 | MySQL / API 类型 | 必填 | 说明 |
|---|---|---:|---|
| `id` | BIGINT / string | 是 | 媒体 ID，业务写接口只提交此 ID |
| `object_key` | VARCHAR(512) / 不直接下发 | 是 | 对象存储唯一 key |
| `url` | VARCHAR(1024) / string | 是 | CDN/对象存储正式访问地址 |
| `mime_type` | VARCHAR(80) / string | 是 | 第一版只允许 `image/jpeg`、`image/png`、`image/webp` |
| `byte_size` | BIGINT / number | 是 | 文件大小，服务端实测 |
| `width`、`height` | INT / number | 是 | 解码后的像素尺寸 |
| `sha256` | CHAR(64) / 不下发 | 是 | 内容摘要，用于去重和审计 |
| `status` | ENUM / string | 是 | `ACTIVE`、`QUARANTINED`、`DELETED` |
| `created_by_admin_id` | BIGINT / string | 是 | 上传管理员 |
| `created_at`、`deleted_at` | DATETIME(3) / string | 是/否 | 审计时间 |

媒体删除必须先检查商品图片、Banner、合集封面、文章封面和文章正文块引用；被引用时返回 `MEDIA_IN_USE`。业务记录删除后建议异步回收无引用媒体，不在同一请求中直接物理删除对象。

#### 首页设置 `home_settings`

当前只有一套首页，可使用固定主键 `id=1`：

| 字段 | MySQL / API 类型 | 必填 | 说明 |
|---|---|---:|---|
| `id` | TINYINT UNSIGNED / string | 是 | 固定为 `1` 的首页设置主键 |
| `featured_title` | VARCHAR(40) / string | 是 | 当前前端限制 2–12 字 |
| `show_featured` | TINYINT(1) / boolean | 是 | 显示精选商品 |
| `show_collections` | TINYINT(1) / boolean | 是 | 显示合集 |
| `show_journal` | TINYINT(1) / boolean | 是 | 显示文玩志 |
| `version` | INT / number | 是 | 乐观锁/缓存失效版本 |
| `updated_by_admin_id` | BIGINT / string | 是 | 最近修改人 |
| `updated_at` | DATETIME(3) / string | 是 | 更新时间 |

#### 首页关系表

| 实体 | 核心字段 | 约束 |
|---|---|---|
| `home_quick_categories` | `category_id/icon_text/sort_order` | 固定恰好 5 条；分类不得重复；`icon_text` 1–2 字；只能引用启用的商品分类维度 |
| `home_featured_products` | `product_id/sort_order` | 1–8 条；商品不得重复；后台可关联未上架商品作为草稿配置，但公共首页只返回在售商品 |

两组关系应整体事务替换并递增 `home_settings.version`，避免管理员排序保存到一半导致首页出现重复或缺项。

## 5. 页面与 API 接口映射

### 5.1 公共浏览接口

| 方法 | 路径 | 使用页面 | 说明 |
|---|---|---|---|
| GET | `/api/v1/home` | 首页 | 一次返回首屏聚合数据，控制每个模块条数 |
| GET | `/api/v1/categories` | 首页、分类页、商品表单 | `dimension` 可筛品类或材质 |
| GET | `/api/v1/products` | 分类、搜索、收藏的商品补充 | 商品列表、搜索、筛选、排序、分页 |
| GET | `/api/v1/products/:productId` | 商品详情 | 完整详情、规格库存、相似商品 |
| GET | `/api/v1/collections/:collectionId` | 合集页 | 合集及有序商品列表 |
| GET | `/api/v1/article-tags` | 文玩志列表 | 可用标签及排序 |
| GET | `/api/v1/articles` | 首页、文玩志列表 | 仅返回已发布文章 |
| GET | `/api/v1/articles/:articleId` | 文章详情 | 正文及相关阅读 |
| GET | `/api/v1/search/hot-keywords` | 搜索页 | 可先由配置返回固定列表 |

### 5.2 普通用户接口

所有 `/api/v1/me/*` 都由后端从可信 `x-wx-openid` 得到内部用户，不接受客户端指定资源归属用户。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/me` | 查询或首次创建后返回内部用户资料 |
| GET | `/api/v1/me/summary` | 订单、收藏、地址、购物车数量 |
| GET/POST/PATCH/DELETE | `/api/v1/me/cart...` | 购物车查增改删、勾选、全选 |
| GET/PUT/DELETE | `/api/v1/me/favorites...` | 收藏列表及幂等收藏/取消 |
| GET/POST/PATCH/DELETE | `/api/v1/me/addresses...` | 地址 CRUD 与设默认 |
| POST | `/api/v1/me/checkout/preview` | 后端校验商品/SKU、价格、库存并生成短时结算令牌 |
| POST | `/api/v1/me/orders` | 使用结算令牌和幂等键创建订单 |
| GET | `/api/v1/me/orders` | 状态筛选的订单列表 |
| GET | `/api/v1/me/orders/:orderId` | 订单详情 |
| GET | `/api/v1/me/orders/by-no/:orderNo` | 下单成功页查询自己的订单 |
| POST | `/api/v1/me/orders/:orderId/cancel` | 按规则取消并处理库存 |

### 5.3 管理员接口

以下接口全部要求管理员会话、权限码、请求 ID 和操作日志；客户端提交的 `role/adminId/operatorName` 均不可信。

| 方法 | 路径 | 权限/用途 |
|---|---|---|
| POST | `/api/admin/auth/login` | 账号密码登录；限流、失败锁定、签发会话 |
| POST | `/api/admin/auth/refresh` | 轮换短期访问凭证；若使用服务端 Cookie 会话可省略 |
| POST | `/api/admin/auth/logout` | 撤销当前管理会话 |
| GET | `/api/admin/me` | 当前管理员、角色和权限码 |
| GET | `/api/admin/dashboard` | 管理首页统计 |
| POST | `/api/admin/media/images` | 上传单张图片并返回 `mediaId/url/width/height/byteSize` |
| DELETE | `/api/admin/media/:mediaId` | 删除未被引用的媒体；被引用返回 `MEDIA_IN_USE` |
| GET/POST | `/api/admin/products` | 商品管理列表/新建商品 |
| GET/PATCH/DELETE | `/api/admin/products/:productId` | 商品详情、事务性编辑、软删除 |
| POST | `/api/admin/products/:productId/on-sale` | 上架并校验主图、启用 SKU、售价和库存结构 |
| POST | `/api/admin/products/:productId/off-shelf` | 下架；购物车/结算实时变为不可用 |
| POST | `/api/admin/variants/:variantId/inventory-adjustments` | 规格级库存调整并记录流水，不直接覆盖库存 |
| GET/POST | `/api/admin/categories` | 分类/材质列表与新增，使用 `dimension` |
| PATCH/DELETE | `/api/admin/categories/:categoryId` | 改名、启停、删除前引用检查；改名不变更 ID/code |
| PUT | `/api/admin/categories/reorder` | 同一维度整体排序 |
| GET/POST | `/api/admin/articles` | 文章管理列表/新建草稿 |
| GET/PATCH/DELETE | `/api/admin/articles/:articleId` | 编辑、读取、软删除文章 |
| POST | `/api/admin/articles/:articleId/publish` | 发布并执行完整内容校验 |
| POST | `/api/admin/articles/:articleId/unpublish` | 撤回为草稿/归档 |
| GET/POST | `/api/admin/collections` | 合集列表/新建 |
| GET/PATCH/DELETE | `/api/admin/collections/:collectionId` | 编辑有序商品关系、显隐、软删除 |
| GET/PATCH | `/api/admin/homepage` | 首页模块开关和精选标题 |
| PUT | `/api/admin/homepage/quick-categories` | 原子替换 5 个快捷分类及顺序 |
| PUT | `/api/admin/homepage/featured-products` | 原子替换 1–8 个精选商品及顺序 |
| GET/POST | `/api/admin/banners` | Banner 列表/新建 |
| PATCH/DELETE | `/api/admin/banners/:bannerId` | 编辑、显隐和删除 |
| PUT | `/api/admin/banners/reorder` | 原子保存 Banner 顺序 |
| GET | `/api/admin/orders`、`/api/admin/orders/:orderId` | 管理订单列表与详情 |
| POST | `/api/admin/orders/:orderId/confirm`、`cancel` | 合法状态迁移和库存处理 |
| GET | `/api/admin/operation-logs` | 只读分页审计日志 |
| GET/POST/PATCH | `/api/admin/admin-users...` | 超管管理账号、角色、启停、密码重置和会话撤销 |

商品编辑建议在一次事务中保存商品基础字段、完整 SKU 集合和有序图片关系，并携带 `version` 做乐观锁。合集、快捷分类、精选商品、Banner 排序同样使用“提交完整有序 ID 数组”的整体替换语义，不提供逐项无版本排序写入。

## 6. 查询参数规范

| 参数 | 类型/限制 | 使用接口 | 规则 |
|---|---|---|---|
| `page` | integer，默认 1，最小 1 | 所有列表 | 超出范围返回空 `items`，不报错 |
| `pageSize` | integer，默认 20，1–50 | 所有列表 | 服务端强制上限 |
| `categoryId` | string | 商品列表 | 使用 ID，不再传中文名称 |
| `materialId` | string | 商品列表 | 使用材质分类 ID |
| `keyword` | string，去空格后 1–40 字 | 商品/订单/管理列表 | 商品搜索覆盖名称、副标题、材质、品类、工艺、标签；需防通配符滥用 |
| `sort` | enum | 商品列表 | `DEFAULT`、`NEWEST`、`PRICE_ASC`、`PRICE_DESC`、`SALES_DESC` |
| `inStock` | boolean | 商品列表 | 前台可筛有货；公开接口永远不返回草稿/已删除商品 |
| `minPriceAmount/maxPriceAmount` | 非负整数分 | 商品列表 | 可选价格筛选，`min <= max` |
| `tag` 或 `tagId` | string | 文章列表 | 第一版可用稳定 tag code，避免中文名称作为标识 |
| `status` | enum | 用户订单/管理列表 | 用户订单只允许自己的可见状态；管理端按权限查询 |
| `from/to` | ISO 日期 | 订单、日志管理列表 | 使用闭区间并明确时区 |

公开商品列表只返回 `ON_SALE` 商品。`OFF_SHELF` 不应因为客户端传入 `status` 而泄露；管理端使用独立接口查询全状态。

## 7. 当前模拟订单流程与正式替代

### 7.1 当前代码的实际流程

1. 商品详情“立即购买”或购物车“去结算”调用 `startCheckout()`，把 `source` 和 `items` 写入本地 `pendingCheckout`。
2. 待结算项包含客户端已有的 `price`，确认订单页直接用它计算合计。
3. 页面从本地地址簿选择 `selectedAddressId`，允许填写最多 100 字备注。
4. `submitOrder()` 再检查商品存在、`active` 和模拟库存；随后生成 `WW + 日期 + 序号` 的订单号。
5. 新订单状态为 `pending`，提交时立即扣减 `inventory[variantId]`；购物车来源会删除已结算项。
6. 下单成功页按订单号从本地查找；没有真实支付，也不调用 `wx.requestPayment`。
7. 普通用户可取消 `pending` 订单并恢复库存；管理员可确认为 `confirmed`，也可取消并恢复库存。

### 7.2 正式后端必须修正的边界

- 客户端只提交 `productId/variantId/quantity`，不得提交可信单价、合计、库存或状态。
- `checkout/preview` 由后端重算价格、可售状态和库存，返回短时 `checkoutToken`、金额明细及变更提示。
- 创建订单必须带 `Idempotency-Key`，后端在事务中预占 SKU 库存并写入订单与明细快照。
- 当前无支付阶段的预占有效期固定为 24 小时；管理员确认后将预占转为正式扣减，用户取消或超时关闭时释放预占。
- 当前无支付资质时，订单应明确为“待人工确认/支付未启用”，不能返回“支付成功”。
- 订单号由后端生成且全局唯一；下单成功页必须校验订单属于当前用户。

## 8. 微信支付、退款和发货预留（当前不启用）

当前阶段不得调用 `wx.requestPayment`，以下字段只预留，不应伪造成功值：

| 范围 | 建议字段 | 当前值/规则 |
|---|---|---|
| 订单支付 | `paymentStatus`、`paymentChannel`、`paymentOrderNo`、`prepayId`、`wechatTransactionId`、`paidAmount`、`paidAt` | `paymentStatus=NOT_ENABLED`，其余为空 |
| 支付记录 `payment_records` | `id/orderId/merchantOrderNo/prepayId/transactionId/status/requestAmount/paidAmount/callbackPayloadHash/paidAt/createdAt` | 后续启用；回调幂等 |
| 退款 `refunds` | `id/orderId/refundNo/wechatRefundId/reason/requestAmount/refundedAmount/status/requestedAt/succeededAt` | 后续启用；累计退款不得超过实付 |
| 发货 `shipments` | `id/orderId/carrierCode/carrierName/trackingNo/status/shippedAt/receivedAt` | 后续启用 |
| 订单状态时间 | `paymentExpiredAt/shippedAt/completedAt/refundedAt/closedAt` | 当前为空 |

后续支付必须以微信支付服务端回调为资金结果依据；前端 `requestPayment:ok` 只能触发查询，不能直接把订单改为已支付。退款和发货也必须由后端权限、状态机和幂等规则控制。

## 9. 管理端未来增删改查能力

当前管理端 13 个物理页面覆盖 15 个概念页面（商品新增/编辑共用表单，文章新增/编辑共用表单）。正式 API 保持 `/api/admin/*` 前缀并统一鉴权。

| 模块 | 当前已有能力 | 正式后端接口能力 |
|---|---|---|
| 管理员登录 | 模拟账号密码、失败 5 次锁 30 分钟、本地 2 小时会话 | 登录/登出/刷新/撤销会话、限流、密码哈希校验、失败锁定、可选 OpenID 绑定 |
| 管理首页 | 商品/库存/订单/文章/合集等统计、恢复演示数据 | 聚合统计；生产环境不提供“恢复全部演示数据” |
| 商品 | 搜索、品类/状态/库存筛选、新增、编辑、上下架、删除 | 分页 CRUD、软删除、上下架校验、媒体上传、SKU 管理 |
| 库存 | 设置库存及原因 | 规格级调整、库存流水、并发控制、禁止直接无审计覆盖 |
| 分类/材质 | 新增、改名、排序、删除前占用检查 | 两个维度 CRUD、排序、启停、引用约束/迁移 |
| 订单 | 搜索、状态/日期筛选、详情、确认、取消 | 分页查询、详情、合法状态迁移、取消、后续发货/退款；不可随意改金额快照 |
| 文章 | 搜索/标签筛选、新增、编辑、发布/草稿、删除、热门 | CRUD、发布/撤回、推荐、正文与封面管理 |
| 合集 | CRUD、显隐、选择商品 | CRUD、显隐、有序商品关系 |
| 首页 | Banner CRUD/显隐/排序、相册图片、五个快捷分类、精选商品、模块开关和标题 | Banner 和模块配置 CRUD、顺序、投放时间；Banner 只允许可选商品目标 |
| 操作日志 | 查询/筛选/本地清空 | 只读分页/筛选/导出；原则上不可由普通管理员物理清空 |
| 管理员 | CRUD、角色、启停、至少一名超管 | 账号 CRUD、重置密码、RBAC、启停、会话撤销、审计、至少一名有效超管 |

建议的权限码至少包括：`products.read/write/publish/delete`、`inventory.adjust`、`categories.manage`、`orders.read/confirm/cancel/refund/ship`、`articles.manage/publish`、`collections.manage`、`homepage.manage`、`logs.read`、`admins.manage`。

正式图片上传统一使用管理员接口，例如 `POST /api/admin/media/images`。Express 应校验管理员权限、真实 MIME、文件大小和像素上限，将文件写入受控对象存储/CDN，并只向 MySQL 保存媒体 ID 与 URL；不得把相册临时路径或图片二进制直接写入业务表。删除媒体前需检查商品、Banner、合集和文章正文引用，避免产生失效图片。

### 9.1 前后端必须一致的写入校验

前端限制只改善交互，后端必须独立重复校验：

| 对象 | 当前前端规则 | 正式后端规则 |
|---|---|---|
| 商品 | 名称 2–24 字；副标题 2–36 字；至少 1 张、最多 6 张图片 | 同步限制；主图必须属于图片列表；图片媒体必须有效且属于当前管理域 |
| SKU | 每商品 1–20 个；名称 1–30 字且不重复；售价大于 0；库存/预警为非负整数；至少启用 1 个 | 同步限制；划线价不得低于售价；已有订单引用的 SKU 只能停用，不能物理删除 |
| Banner | 标题 2–20 字；副标题 2–24 字；图片必填；商品目标可空 | `linkType=NONE` 时目标必须为空；`PRODUCT` 时目标必填且商品存在；禁止路径字段 |
| 首页快捷分类 | 固定 5 项、不重复、印记 1–2 字 | 原子校验并保存；只能引用启用的 `PRODUCT_CATEGORY` |
| 首页精选 | 1–8 件、不重复、有序 | 原子校验并保存；公共首页过滤非在售商品 |
| 合集 | 标题 2–20 字；描述 5–60 字；封面必填；至少 1 件商品 | 商品 ID 不重复且存在；关系顺序必须保留；删除商品时清理关系 |
| 文章草稿 | 标题 2–40 字；摘要最多 160 字；正文最多 60 个块 | 草稿允许内容不完整，但结构、类型、长度和媒体引用必须合法 |
| 文章发布 | 标题至少 4 字；摘要 10–160 字；封面必填；正文文本合计至少 20 字；图片块不可为空 | 在事务内重新校验后才改为 `PUBLISHED`；正文只允许三种白名单块 |
| 地址 | 姓名 2–20 字、手机号和详细地址校验 | 每用户最多 20 条，默认地址唯一；所有权由可信用户上下文确定 |
| 购物车/订单 | 数量 1–99 | 仍需受购买上限和实时可售库存约束；金额全部由服务端计算 |

### 9.2 关键管理写入 DTO

商品新建/编辑主体建议为：

```json
{
  "version": 3,
  "name": "紫檀·金星满天",
  "subtitle": "印度小叶紫檀 高密老料手串",
  "categoryId": "10",
  "materialId": "21",
  "craft": "手工打磨",
  "tags": ["高密", "金星", "老料"],
  "imageMediaIds": ["501", "502"],
  "primaryMediaId": "501",
  "variants": [
    {
      "id": "20001",
      "skuCode": "P-ZITAN-001-20",
      "specLabel": "2.0cm · 15颗",
      "priceAmount": 388000,
      "originalPriceAmount": 457800,
      "lowStockThreshold": 5,
      "enabled": true,
      "sortOrder": 1
    }
  ],
  "attributes": [{ "label": "材质", "value": "印度小叶紫檀" }],
  "detailSections": [{ "type": "PARAGRAPH", "text": "器物说明" }]
}
```

编辑商品不通过此 DTO 直接覆盖库存数量；初建 SKU 可提交初始库存，后续库存变化统一走库存调整接口。`version` 不匹配返回 `RESOURCE_VERSION_CONFLICT`。

文章正文请求示例：

```json
{
  "title": "金星、牛毛与火焰纹",
  "tag": "材质鉴别",
  "summary": "用于列表展示的文章摘要",
  "coverMediaId": "601",
  "authorName": "闻远",
  "readingMinutes": 6,
  "isHot": true,
  "contentBlocks": [
    { "id": "block-1", "type": "HEADING", "text": "细看其里" },
    { "id": "block-2", "type": "PARAGRAPH", "text": "正文内容……" },
    { "id": "block-3", "type": "IMAGE", "mediaId": "602", "caption": "纹理细节" }
  ]
}
```

首页关系写入统一提交稳定 ID 和顺序：

```json
{
  "quickCategories": [
    { "categoryId": "10", "iconText": "手" },
    { "categoryId": "11", "iconText": "茶" },
    { "categoryId": "12", "iconText": "印" },
    { "categoryId": "13", "iconText": "玉" },
    { "categoryId": "14", "iconText": "把" }
  ],
  "featuredProductIds": ["10001", "10003", "10007"]
}
```

媒体上传使用 `multipart/form-data`，字段名固定为 `file`，单次一张，建议第一版限制 10 MB、长宽各不超过 10,000 px，并在服务端解码验证而非只相信扩展名。成功 `data`：

```json
{
  "mediaId": "501",
  "url": "https://cdn.example.com/wenwan/2026/08/xxx.webp",
  "mimeType": "image/webp",
  "byteSize": 182340,
  "width": 1600,
  "height": 1200
}
```

Banner 写入只接受：

```json
{
  "title": "文房清供 · 案上山河",
  "subtitle": "宋人格物，一器一世界",
  "imageMediaId": "501",
  "linkType": "PRODUCT",
  "targetProductId": "10001",
  "visible": true
}
```

不得兼容或透传 `to/path/url/role/userId/openid` 等旧字段或可信身份字段。

## 10. 当前字段与路径冲突

| 当前不一致 | 风险 | 统一建议 |
|---|---|---|
| `price` 为带逗号字符串，`priceValue` 为元数值；订单项又叫 `price` | 浮点/格式化混入业务计算 | API/DB 统一整数分 `priceAmount/unitPriceAmount`；展示格式由前端处理 |
| `originPrice` 与 `originPriceValue` | 同上 | `originalPriceAmount` |
| `image`、`images`、`cover`、首页派生 `image` | 含义不稳定 | 写接口统一提交 `mediaId/mediaIds`；读接口返回 `primaryImageUrl/images[]/coverImageUrl` |
| 分类和材质直接存中文字符串，首页分类 `id` 有时也是中文名 | 改名会破坏筛选和关联 | 使用 `categoryId/materialId`，另返回 `name/code` |
| `active`、`status`、`visible`、`published` 同时表达可见性 | 容易产生矛盾状态 | 按实体定义唯一状态字段；`stockStatus` 由库存派生 |
| `qty` 与页面语义 `quantity` | 命名不统一 | API 统一 `quantity` |
| `sales` 当前是演示数字 | 不可直接导入正式销量 | API 统一 `salesCount`；按第 15 节已确认口径从有效订单明细聚合 |
| 商品仍保留 `specs: string[]` 兼容展示，同时新增 `variants[]` | 若后端继续采信规格文字仍会串规格 | 业务操作只使用 `variantId`，订单另存 `specSnapshot`；`specs` 只作兼容展示 |
| 商品汇总 `stock` 与 `shopState.inventory[variantId]` 并存 | 本地模拟层存在汇总值与运行时覆盖值 | 正式仅以 SKU 现存量、预占量和库存流水为准，商品总库存只作为派生字段 |
| 地址 `region` 是拼接字符串 | 难以运费、地区校验和发货 | 拆为 `province/city/district`，API 可额外返回 `regionText` |
| 日期既有毫秒时间戳，又有 `YYYY-MM-DD` 字符串 | 排序和时区不一致 | API 统一 UTC ISO 8601 |
| 旧 Banner 有 `to` 路径和 `collectionId` | 跳转逻辑难校验且可能指向不存在页面 | 已统一为可空 `targetProductId`；正式 API 使用 `linkType=NONE/PRODUCT + targetProductId`，禁止任意路径 |
| 合集用 `productIds[]` | 无顺序审计和关系约束 | `collection_products` 关联表 |
| 文章同时有 `image` 和 `cover` | 重复字段 | `coverImageUrl` |
| `desc`、`detail`、`summary` 语义接近 | DTO 难理解 | 合集 `description`、文章 `summary`、商品 `detailSections` |
| 订单 `confirmed` | 无法判断是人工确认、支付确认还是收货确认 | 当前改为 `CONFIRMED` 并明确“人工确认”；支付/发货状态单独建模 |
| 订单内 `address` 对象和地址簿对象同形 | 地址修改可能误影响历史 | 订单使用不可变收货快照字段 |
| 模拟 ID 是 `p-01/a-01/col-1` | 不适合作为数据库主键策略 | 数据库 ID 以 string 下发，同时保留唯一 `code` |
| 旧文档建议路径与实际路径有差异 | 后端/埋点映射错误 | 以本文件第 1 节实际 14 个用户端路由为准 |

实际路径差异包括：合集现为 `pages/collection/index`，订单现为 `pages/orders/index`，收藏现为 `pages/favorites/index`；管理端商品和文章的新增/编辑分别共用 `product-form`、`article-form`。

## 11. 统一 API 响应格式

### 成功

```json
{
  "success": true,
  "code": "OK",
  "message": "",
  "data": {},
  "requestId": "req_01J...",
  "timestamp": "2026-08-01T07:30:00.000Z"
}
```

分页接口的 `data` 固定为：

```json
{
  "items": [],
  "page": 1,
  "pageSize": 20,
  "total": 24,
  "hasMore": true
}
```

### 失败

```json
{
  "success": false,
  "code": "PRODUCT_STOCK_INSUFFICIENT",
  "message": "所选规格库存不足",
  "details": {
    "productId": "10001",
    "variantId": "20001",
    "availableQuantity": 2
  },
  "requestId": "req_01J...",
  "timestamp": "2026-08-01T07:30:00.000Z"
}
```

- HTTP 状态码表达协议层结果，业务 `code` 供前端稳定分支；不要所有错误都返回 HTTP 200。
- `message` 可直接展示但不能包含内部堆栈、SQL、OpenID、Token 或敏感配置。
- `requestId` 应贯穿云托管、Express 日志和管理操作日志。
- 创建订单等写操作使用请求头 `Idempotency-Key`；重复请求返回同一业务结果。

## 12. 错误码需求

| HTTP | 错误码 | 使用场景 |
|---:|---|---|
| 400 | `INVALID_ARGUMENT` | 参数类型、长度、枚举或组合错误 |
| 400 | `PAGE_SIZE_OUT_OF_RANGE` | 分页大小非法 |
| 401 | `USER_IDENTITY_MISSING` | 云托管可信用户头缺失；个性化接口使用 |
| 401 | `ADMIN_AUTH_FAILED` | 管理员账号或密码错误 |
| 401 | `ADMIN_SESSION_EXPIRED` | 管理会话失效 |
| 403 | `USER_DISABLED` | 普通用户被停用 |
| 403 | `ADMIN_ACCOUNT_DISABLED` | 管理员被停用 |
| 403 | `ADMIN_PERMISSION_DENIED` | 管理员无模块/动作权限 |
| 404 | `PRODUCT_NOT_FOUND` | 商品不存在或前台不可见 |
| 404 | `ARTICLE_NOT_FOUND`、`COLLECTION_NOT_FOUND` | 内容不存在或不可见 |
| 404 | `CART_ITEM_NOT_FOUND`、`ADDRESS_NOT_FOUND`、`ORDER_NOT_FOUND` | 当前用户的资源不存在；不得泄露他人资源 |
| 409 | `PRODUCT_OFF_SHELF`、`PRODUCT_SOLD_OUT` | 商品不可购买 |
| 409 | `VARIANT_DISABLED` | 所选 SKU 已停用或不可购买 |
| 409 | `PRODUCT_STOCK_INSUFFICIENT` | SKU 库存不足 |
| 409 | `PRODUCT_PRICE_CHANGED` | 预览后价格发生变化 |
| 409 | `CHECKOUT_TOKEN_EXPIRED` | 结算预览令牌过期 |
| 409 | `ORDER_STATUS_CONFLICT` | 当前状态不能取消/确认/发货 |
| 409 | `DUPLICATE_RESOURCE` | 唯一字段重复，如管理员账号 |
| 409 | `RESOURCE_VERSION_CONFLICT` | 管理员编辑期间记录已被他人更新 |
| 409 | `MEDIA_IN_USE` | 图片仍被商品、Banner、合集或文章引用 |
| 422 | `ADDRESS_INVALID` | 地址字段校验失败 |
| 422 | `ADDRESS_LIMIT_REACHED` | 当前用户已保存 20 个地址 |
| 422 | `ORDER_ITEMS_INVALID` | 订单项为空或不合法 |
| 422 | `CONTENT_BLOCK_INVALID` | 文章正文块类型、顺序、文本或媒体引用不合法 |
| 422 | `HOMEPAGE_CONFIG_INVALID` | 快捷分类数量/重复、精选商品或排序配置不合法 |
| 415 | `MEDIA_TYPE_UNSUPPORTED` | 上传文件真实类型不在图片白名单 |
| 413 | `MEDIA_TOO_LARGE` | 图片字节数或解码后像素超过上限 |
| 429 | `RATE_LIMITED` | 登录、搜索、写操作限流 |
| 501/409 | `PAYMENT_NOT_ENABLED` | 当前阶段尝试发起真实支付 |
| 500 | `INTERNAL_ERROR` | 未预期服务错误 |
| 503 | `SERVICE_UNAVAILABLE` | MySQL/依赖临时不可用 |

## 13. 第一批商品浏览接口详细契约

第一批接口均为只读，不要求页面提交用户身份字段；云托管若附带身份头，后端也不应在公共响应中泄露身份。成功响应统一包在第 11 节格式内。

### 13.1 商品摘要 DTO

```json
{
  "id": "10001",
  "code": "P-ZITAN-001",
  "name": "紫檀·金星满天",
  "subtitle": "印度小叶紫檀 高密老料手串",
  "priceAmount": 388000,
  "originalPriceAmount": 457800,
  "hasPriceRange": true,
  "currency": "CNY",
  "primaryImageUrl": "https://.../p-zitan.jpg",
  "category": { "id": "10", "code": "bracelet", "name": "手串" },
  "material": { "id": "21", "code": "xiaoye-zitan", "name": "小叶紫檀" },
  "craft": "手工打磨",
  "tags": ["高密", "金星", "老料"],
  "salesCount": 268,
  "saleStatus": "ON_SALE",
  "stockStatus": "IN_STOCK"
}
```

摘要中的 `priceAmount` 是所有启用 SKU 的最低售价；有效售价不止一个时 `hasPriceRange=true`，前端按现有样式展示“起”。`stockStatus` 只返回 `IN_STOCK/LOW_STOCK/SOLD_OUT`，普通列表接口不暴露精确库存；商品详情因现有界面展示“现货 N 件”，必须返回当前 SKU 的 `availableQuantity`。

### 13.2 `GET /api/v1/home`

请求：无必填参数。

`data`：

| 字段 | 类型 | 说明 |
|---|---|---|
| `config` | object | `featuredTitle/showFeatured/showCollections/showJournal/version` |
| `banners` | array | `id/title/subtitle/imageUrl/linkType/targetProductId`，按顺序返回当前可见项 |
| `categories` | array | 管理端配置的 5 个 `id/code/name/iconText` 首页入口及顺序；不直接取分类表前五项 |
| `featuredProducts` | ProductSummary[] | 精选商品 |
| `newArrivals` | ProductSummary[] | 新品，按正式上架时间倒序，不再按数组末尾推导 |
| `collections` | array | `id/code/title/latinTitle/description/coverImageUrl/productCount` |
| `articles` | array | `id/code/title/tag/readingMinutes/coverImageUrl`，仅已发布 |

建议响应首屏每模块 3–6 条，并提供合理缓存/ETag；任何配置引用的下架商品都应在服务端过滤。

### 13.3 `GET /api/v1/categories`

参数：`dimension=PRODUCT_CATEGORY|MATERIAL|ALL`，默认 `ALL`。

返回 `items[{id,code,dimension,name,iconText,parentId,sortOrder}]`。不返回“全部”；“全部”是前端清空筛选的 UI 选项。列表必须按 `sortOrder,id` 稳定排序；分类改名后保持原 `id/code`，客户端下次刷新即显示新名。

### 13.4 `GET /api/v1/products`

参数：

| 参数 | 必填 | 说明 |
|---|---:|---|
| `page/pageSize` | 否 | 默认 1/20，最大 50 |
| `categoryId` | 否 | 商品分类 ID |
| `materialId` | 否 | 材质分类 ID |
| `keyword` | 否 | 最长 40 字，搜索名称、副标题、分类、材质、工艺和标签 |
| `sort` | 否 | `DEFAULT/NEWEST/PRICE_ASC/PRICE_DESC/SALES_DESC` |
| `inStock` | 否 | `true` 时排除售罄 |
| `minPriceAmount/maxPriceAmount` | 否 | 整数分 |

返回第 11 节分页结构，`items` 为 ProductSummary。公开接口只返回 `ON_SALE`；分类或材质不存在返回 `INVALID_ARGUMENT` 或空列表的策略需全局固定，建议无效 ID 返回 400。

### 13.5 `GET /api/v1/products/:productId`

`data`：

| 字段 | 类型 | 说明 |
|---|---|---|
| ProductSummary 全字段 | object | 基础展示字段 |
| `images` | array | `id/url/kind/altText/sortOrder` |
| `variants` | array | `id/skuCode/specLabel/priceAmount/originalPriceAmount/stockStatus/availableQuantity/enabled` |
| `attributes` | array | `label/value/sortOrder` |
| `detailSections` | array | 结构化文本/图片段落，白名单渲染 |
| `relatedProducts` | ProductSummary[] | 当前同分类最多 4 条，后续可调整策略 |
| `purchaseLimits` | object | `minQuantity/maxQuantity`，当前相当于 1/99 但还受库存限制 |

已下架商品对普通请求建议返回 404；若从历史订单进入需要展示快照，应查询订单明细快照，不应开放下架商品详情。

### 13.6 `GET /api/v1/collections/:collectionId`

返回：

```json
{
  "id": "30001",
  "code": "scholars-desk",
  "title": "案上山河",
  "latinTitle": "SCHOLAR'S DESK",
  "description": "笔搁、印石、清供小件，为书案添一分宋人格调。",
  "coverImageUrl": "https://.../banner-desk.jpg",
  "products": [],
  "productCount": 5
}
```

`products` 按 `collection_products.sort_order` 返回 ProductSummary，只包含前台可见商品；`productCount` 应与实际返回/可分页口径明确一致。第一版合集商品较少可不分页，超过 50 件后改为分页或单独商品接口。

### 13.7 浏览接口验收条件

- 首页、分类、搜索、商品详情和合集页可完全脱离 `data/catalog.js` 读取后端 DTO。
- 中文名称改动不影响 URL 参数和关联，页面传稳定 ID/code。
- 金额均为整数分，前端格式化后与当前视觉一致。
- 下架、售罄、低库存状态一致；公开接口不会返回草稿或软删除数据。
- 图片 URL 失效时返回业务数据仍成功，由前端显示已有失败占位。
- 分页无重复/遗漏，排序稳定；建议默认排序增加 `id DESC` 作为次级排序键。
- 首批只读接口失败时显示现有错误状态，不静默回退模拟数据。

## 14. 接入顺序建议

1. 建立统一 DTO、请求封装和环境配置，接入第 13 节公共只读接口。
2. 接入可信 OpenID 用户识别及 `/me`，迁移收藏和个人中心统计。
3. 接入购物车和地址 CRUD。
4. 接入结算预览、幂等下单、库存事务和当前“人工确认”订单流。
5. 接入管理员账号、RBAC、商品/SKU/库存、内容和订单管理 API。
6. 资质完成后再启用微信支付、退款和发货；以服务端回调和状态机为准。

## 15. 已确认的业务规则

1. 商品品类与材质为两个独立的单选维度；第一版每件商品只有一个主材质，其他辅材写入商品参数。
2. 每个规格拥有独立 SKU、售价、划线价、库存、低库存阈值和启停状态；无规格商品也创建一个“默认规格”SKU。
3. 商品列表展示启用 SKU 的最低售价；多个有效价格时显示“起”。购物车和订单必须使用 `variantId`，规格文字只作为展示与快照。
4. 创建订单时事务性预占 SKU 库存，24 小时未确认自动关闭并释放；管理员确认后转为正式扣减，取消同样释放预占。
5. 业务订单状态使用 `PENDING_CONFIRMATION/CONFIRMED/CANCELLED/CLOSED`；`CONFIRMED` 仅代表人工确认，不代表支付成功或已收货。
6. 支付状态和履约状态独立建模。当前支付状态固定为 `NOT_ENABLED`；未来增加 `UNPAID/PAID/REFUNDING/REFUNDED` 及 `UNSHIPPED/SHIPPED/RECEIVED`。
7. 当前销量按“已由管理员确认且未取消”的商品件数统计；接入支付后改为已支付且未全额退款的件数。
8. 第一版运费、优惠、满减、发票和税费不启用，相应金额均为 0，但保留金额字段。
9. 每位用户最多保存 20 个地址；存在地址时只能有一个默认地址。地区拆分省、市、区，第一版按中国大陆手机号校验。
10. 搜索历史继续只保存在本机，不建立后端搜索历史实体；热门搜索词由管理端配置。
11. 浏览足迹功能已从小程序页面、模拟状态和后端实体/API 规划中完全移除。
12. 商品、文章和合集采用软删除；被订单引用的商品禁止物理删除，订单明细永久保留下单快照。
13. 文章正文采用受限结构化 JSON，并通过原生小程序白名单组件渲染，不直接存储和渲染任意 HTML。
14. 首页精选、新品、合集和文章均支持后台启停、排序及展示数量；新品以正式上架时间倒序计算。
15. 管理员保留超级管理员、运营人员、内容编辑三类角色，并由后端细粒度 RBAC 决定具体动作权限。
16. 无支付阶段统一使用“提交订单成功/待确认”文案，不使用“支付成功”；生产接口失败时不得静默回退模拟数据。
17. 首页快捷分类固定为 5 个不重复的启用商品分类，每项拥有独立印记和顺序；首页精选为 1–8 个不重复商品并保留顺序。
18. Banner 第一版只允许不跳转或跳转已有商品；不支持管理员输入任意页面路径，目标商品失效后按不跳转处理。
19. 合集商品、商品图片、文章内容块均保留管理员设置的顺序；服务端写入使用事务性整体替换，读接口按 `sortOrder` 稳定返回。
20. 正式业务写接口只引用已上传的 `mediaId`，不接收 `wxfile://`、临时文件路径或任意远程 URL；正文可包含多张图片。
21. 分类、材质、文章、合集和商品详情都以服务端当前可见状态为准；客户端重新进入/下拉刷新后不得继续使用失效筛选条件或旧配置快照。
22. 有待确认订单引用的商品不得物理删除；历史订单始终使用下单时的名称、副标题、主图、规格和价格快照展示。

## 16. 后端开工条件与上线验收门槛

### 16.1 开工前需要具备

- 将现有微信云托管 Express 源码加入当前工作区或提供明确的独立后端工作区；当前工作区只有原型和小程序，本文不会假定不存在的后端目录结构。
- 明确 Node.js 运行版本、Express 启动命令、云托管监听端口和 `express-zaiy` 所在环境；配置通过环境变量注入，不把凭据写入仓库。
- MySQL 建议使用 8.0、`utf8mb4`、UTC 存储时间，并建立可重复执行的 migration/rollback 流程；开发、测试、生产数据库严格分离。
- 选定对象存储/CDN。若暂未确定供应商，先定义 `MediaStorage` 接口，将上传、删除、生成 URL 与业务层解耦。
- 管理员第一版建议使用高熵随机不透明 Token：数据库仅保存 Token 哈希、过期和撤销时间；客户端通过 `Authorization: Bearer` 携带，不使用可长期有效且难撤销的自包含 JWT。
- 创建 `.env.example` 只列变量名，例如数据库、云环境、媒体存储和会话密钥；任何真实密钥、AppSecret、OpenID、数据库密码不得写入代码或文档。

### 16.2 每批接口的最低验收

- API 具备参数校验、统一响应、错误码、`requestId`、结构化日志和敏感字段脱敏。
- 数据库 migration、核心 service 单元测试、接口集成测试可以在空库重复运行。
- 普通用户接口只从可信 `x-wx-openid` 建立用户上下文；管理接口只从有效管理员会话建立权限上下文。
- 商品/SKU/库存、首页关系、合集关系和文章内容写入具备事务；库存和订单并发测试证明不会超卖或重复下单。
- 上传文件按真实内容解码校验，业务表只保存媒体关系；删除被引用媒体会失败而不会制造破图。
- 公共接口不返回草稿、软删除或下架数据；管理接口按权限返回并写操作日志。
- 小程序切换真实 API 后，生产构建不再静默读取模拟商城数据；网络失败进入已有加载/空/错误状态。
- 当前阶段任何接口都不会触发真实支付，也不会返回“支付成功”；支付资质完成后再单独评审支付、退款和发货状态机。
