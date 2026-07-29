const { Sequelize } = require("sequelize");

const { MYSQL_USERNAME, MYSQL_PASSWORD, MYSQL_ADDRESS = "" } = process.env;
const [host, port] = MYSQL_ADDRESS.split(":");

// 保留微信云托管通过环境变量注入 MySQL 连接信息的方式。
const sequelize = new Sequelize("nodejs_demo", MYSQL_USERNAME, MYSQL_PASSWORD, {
  host,
  port,
  dialect: "mysql",
});

module.exports = sequelize;
