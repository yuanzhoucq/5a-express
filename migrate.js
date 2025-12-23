const { Sequelize, DataTypes } = require("sequelize");
const path = require("path");

// ==========================================================
// 1. 配置源数据库 (MySQL) 和 目标数据库 (SQLite)
// ==========================================================

// 请在环境变量中设置 MySQL 的连接信息，或者直接在这里修改
const {
    SOURCE_MYSQL_USERNAME,
    SOURCE_MYSQL_PASSWORD,
    SOURCE_MYSQL_ADDRESS
} = process.env;

if (!SOURCE_MYSQL_ADDRESS) {
    console.error("❌ 错误: 请设置 SOURCE_MYSQL_ADDRESS (例如: 127.0.0.1:3306)");
    process.exit(1);
}

const [mysqlHost, mysqlPort] = SOURCE_MYSQL_ADDRESS.split(":");

// 源数据库实例 (MySQL)
const sourceDb = new Sequelize("nodejs_demo", SOURCE_MYSQL_USERNAME, SOURCE_MYSQL_PASSWORD, {
    host: mysqlHost,
    port: mysqlPort,
    dialect: "mysql",
    logging: false
});

// 目标数据库实例 (SQLite)
const targetDb = new Sequelize({
    dialect: "sqlite",
    storage: path.join(__dirname, "data", "database.sqlite"),
    logging: false
});

// ==========================================================
// 2. 定义模型 (必须与 db.js 保持一致)
// ==========================================================

const defineModels = (db) => {
    const Counter = db.define("Counter", {
        count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 }
    });

    const Checker = db.define("Checker", {
        openid: { type: DataTypes.STRING, allowNull: false, primaryKey: true },
        checkins: { type: DataTypes.STRING(5000), allowNull: true },
        starred: { type: DataTypes.STRING(5000), allowNull: true },
        analysis: { type: DataTypes.STRING(5000), allowNull: true }
    });

    const CheckRate = db.define("CheckRate", {
        sceneid: { type: DataTypes.STRING, allowNull: false, primaryKey: true },
        rate: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 }
    });

    return { Counter, Checker, CheckRate };
};

const sourceModels = defineModels(sourceDb);
const targetModels = defineModels(targetDb);

// ==========================================================
// 3. 执行迁移逻辑
// ==========================================================

async function migrate() {
    try {
        console.log("🚀 开始数据迁移...");

        // 初始化目标数据库
        await targetDb.sync({ force: true }); // 注意：这里会清空目标数据库
        console.log("✅ 目标数据库已初始化 (已清空旧数据)");

        // 1. 迁移 Counter
        console.log("📦 正在迁移 Counter 表...");
        const counters = await sourceModels.Counter.findAll();
        if (counters.length > 0) {
            await targetModels.Counter.bulkCreate(counters.map(c => c.toJSON()));
            console.log(`✅ 已迁移 ${counters.length} 条 Counter 记录`);
        }

        // 2. 迁移 Checker
        console.log("📦 正在迁移 Checker 表...");
        const checkers = await sourceModels.Checker.findAll();
        if (checkers.length > 0) {
            await targetModels.Checker.bulkCreate(checkers.map(c => c.toJSON()));
            console.log(`✅ 已迁移 ${checkers.length} 条 Checker 记录`);
        }

        // 3. 迁移 CheckRate
        console.log("📦 正在迁移 CheckRate 表...");
        const checkRates = await sourceModels.CheckRate.findAll();
        if (checkRates.length > 0) {
            await targetModels.CheckRate.bulkCreate(checkRates.map(cr => cr.toJSON()));
            console.log(`✅ 已迁移 ${checkRates.length} 条 CheckRate 记录`);
        }

        console.log("\n🎉 所有数据迁移完成！");
        console.log("📂 数据已保存至: data/database.sqlite");

    } catch (error) {
        console.error("❌ 迁移过程中出错:", error);
    } finally {
        await sourceDb.close();
        await targetDb.close();
    }
}

migrate();
