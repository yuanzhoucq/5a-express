const path = require("path");
const { Sequelize, DataTypes } = require("sequelize");

// 默认使用 SQLite（轻量、无需额外服务）
// 如果设置了 MYSQL_ADDRESS，则使用 MySQL（兼容微信云托管）
const { MYSQL_USERNAME, MYSQL_PASSWORD, MYSQL_ADDRESS = "" } = process.env;

let sequelize;

if (MYSQL_ADDRESS) {
  // MySQL 模式（兼容微信云托管）
  const [host, port] = MYSQL_ADDRESS.split(":");
  sequelize = new Sequelize("nodejs_demo", MYSQL_USERNAME, MYSQL_PASSWORD, {
    host,
    port,
    dialect: "mysql",
  });
  console.log("Using MySQL database");
} else {
  // SQLite 模式（默认）
  sequelize = new Sequelize({
    dialect: "sqlite",
    storage: path.join(__dirname, "data", "database.sqlite"),
    logging: false,
  });
  console.log("Using SQLite database");
}

// 定义数据模型
const Counter = sequelize.define("Counter", {
  count: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
  },
});

const Checker = sequelize.define("Checker", {
  openid: {
    type: DataTypes.STRING,
    allowNull: false,
    primaryKey: true
  },
  checkins: {
    type: DataTypes.STRING(5000),
    allowNull: true
  },
  starred: {
    type: DataTypes.STRING(5000),
    allowNull: true
  },
  analysis: {
    type: DataTypes.STRING(5000),
    allowNull: true,
  }
});

const CheckRate = sequelize.define("CheckRate", {
  sceneid: {
    type: DataTypes.STRING,
    allowNull: false,
    primaryKey: true
  },
  rate: {
    type: DataTypes.FLOAT,
    allowNull: false,
    defaultValue: 0,
  },
});

// 数据库初始化方法
async function init() {
  await Counter.sync({ alter: true });
  await Checker.sync({ alter: true });
  await CheckRate.sync({ alter: true });
}

// 导出初始化方法和模型
module.exports = {
  init,
  Counter,
  Checker,
  CheckRate
};
