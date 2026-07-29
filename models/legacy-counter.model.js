const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

// 微信云托管模板遗留模型，商城业务模型不要放入此文件。
const LegacyCounter = sequelize.define("Counter", {
  count: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
  },
});

module.exports = LegacyCounter;
