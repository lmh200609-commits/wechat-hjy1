const PERMISSIONS = Object.freeze([
  { code: "dashboard.read", module: "dashboard", action: "read", description: "查看管理首页" },
  { code: "products.read", module: "products", action: "read", description: "查看商品" },
  { code: "products.write", module: "products", action: "write", description: "编辑商品与规格" },
  { code: "inventory.read", module: "inventory", action: "read", description: "查看库存与流水" },
  { code: "inventory.adjust", module: "inventory", action: "adjust", description: "调整库存" },
  { code: "categories.read", module: "categories", action: "read", description: "查看分类与材质" },
  { code: "categories.write", module: "categories", action: "write", description: "编辑分类与材质" },
  { code: "orders.read", module: "orders", action: "read", description: "查看订单" },
  { code: "orders.confirm", module: "orders", action: "confirm", description: "确认订单" },
  { code: "orders.cancel", module: "orders", action: "cancel", description: "取消订单" },
  { code: "articles.read", module: "articles", action: "read", description: "查看文玩志" },
  { code: "articles.write", module: "articles", action: "write", description: "编辑与发布文玩志" },
  { code: "collections.read", module: "collections", action: "read", description: "查看合集" },
  { code: "collections.write", module: "collections", action: "write", description: "编辑合集" },
  { code: "homepage.read", module: "homepage", action: "read", description: "查看首页配置" },
  { code: "homepage.write", module: "homepage", action: "write", description: "编辑首页配置" },
  { code: "media.write", module: "media", action: "write", description: "上传与管理媒体" },
  { code: "logs.read", module: "logs", action: "read", description: "查看操作日志" },
  { code: "admins.read", module: "admins", action: "read", description: "查看管理员" },
  { code: "admins.write", module: "admins", action: "write", description: "编辑管理员与角色" },
]);

const ALL_PERMISSION_CODES = Object.freeze(PERMISSIONS.map((item) => item.code));

const ROLES = Object.freeze([
  {
    code: "SUPER_ADMIN",
    name: "超级管理员",
    description: "拥有全部管理权限",
    permissionCodes: ALL_PERMISSION_CODES,
  },
  {
    code: "OPERATOR",
    name: "运营人员",
    description: "负责商品、订单、内容和首页运营",
    permissionCodes: Object.freeze(ALL_PERMISSION_CODES.filter((code) => !code.startsWith("admins."))),
  },
  {
    code: "CONTENT_EDITOR",
    name: "内容编辑",
    description: "负责文玩志、合集和媒体内容",
    permissionCodes: Object.freeze([
      "dashboard.read",
      "articles.read",
      "articles.write",
      "collections.read",
      "collections.write",
      "media.write",
      "logs.read",
    ]),
  },
]);

module.exports = { PERMISSIONS, ROLES, ALL_PERMISSION_CODES };
