const path = require("path");
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const cron = require("node-cron");
const { init: initDB, Counter, Checker, CheckRate } = require("./db");

const logger = morgan("tiny");

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(cors());
app.use(logger);

// 首页
app.get("/", async (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// 更新计数
app.post("/api/count", async (req, res) => {
  const { action } = req.body;
  if (action === "inc") {
    await Counter.create();
  } else if (action === "clear") {
    await Counter.destroy({
      truncate: true,
    });
  }
  res.send({
    code: 0,
    data: await Counter.count(),
  });
});

// 获取计数
app.get("/api/count", async (req, res) => {
  const result = await Counter.count();
  res.send({
    code: 0,
    data: result,
  });
});

// 获取打卡率数据（总是返回缓存数据）
app.get("/api/checkrate", async (req, res) => {
  try {
    const { scenes } = require('./scenes.js');

    // 直接从数据库返回所有打卡率数据
    const allCheckRates = await CheckRate.findAll();
    const checkRates = [];

    for (const checkRate of allCheckRates) {
      const scene = scenes.find(s => s.id === checkRate.sceneid);
      if (scene) {
        checkRates.push({
          sceneid: checkRate.sceneid,
          name: scene.name,
          province: scene.province,
          city: scene.city,
          rate: checkRate.rate,
          updatedAt: checkRate.updatedAt
        });
      }
    }

    // 返回所有打卡率数据
    res.send({
      code: 0,
      data: checkRates,
      fromCache: true
    });

  } catch (error) {
    console.error('获取打卡率失败:', error);
    res.send({
      code: -1,
      message: '获取打卡率失败'
    });
  }
});

// 小程序调用，获取微信 Open ID
app.get("/api/wx_openid", async (req, res) => {
  if (req.headers["x-wx-source"]) {
    res.send(req.headers["x-wx-openid"]);
  }
});


// 根据 openid 获取打卡信息
app.get("/api/checkin", async (req, res) => {
  if (req.headers["x-wx-openid"]) {
    const openid = req.headers["x-wx-openid"];
    const result = await Checker.findByPk(openid);
    res.send({
      code: 0,
      data: result || '',
    });
  } else {
    res.send({
      code: -1,
      message: "请使用微信访问",
    });
  }
});

// 根据 openid 更新打卡信息
app.post("/api/checkin", async (req, res) => {
  if (req.headers["x-wx-openid"]) {
    const openid = req.headers["x-wx-openid"];
    // 更新打卡信息，如果存在则更新，不存在则创建
    await Checker.upsert({ openid, ...req.body });
    res.send({
      code: 0,
      message: "更新成功",
    });
  } else {
    res.send({
      code: -1,
      message: "请使用微信访问",
    });
  }
});

app.post("/api/analyze", async (req, res) => {
  if (req.headers["x-wx-openid"]) {
    const openid = req.headers["x-wx-openid"];
    // 检查 openid 是否存在
    const result = await Checker.findByPk(openid);
    if (!result) {
      res.send({
        code: -1,
        message: "请先打卡",
      });
      return;
    }
    
    const checkins = decodeURIComponent(req.body.checkins);
    const aiService = req.body.aiService || 'deepseek';
    const useCache = req.body.useCache === undefined ? true : req.body.useCache;

    console.log({checkins, aiService, useCache})

    if (useCache) {
      // 检查数据库中是否存在分析结果
      const result = await Checker.findByPk(openid);
      if (result?.analysis) {
        res.send({
          code: 0,
          message: "分析结果已存在",
        });
        return;
      } 
    } else {
      // 删除数据库中的分析结果
      await Checker.update({ analysis: null }, {
        where: { openid }
      });
    }
    
    // 异步发起分析请求
    analyzeCheckins(openid, checkins, aiService);
    
    res.send({
      code: 0,
      message: "分析请求已发起",
    });
  } else {
    res.send({
      code: -1,
      message: "请使用微信访问"
    });
  }
});

// 获取分析结果
app.get("/api/analyze_res", async (req, res) => {
  if (req.headers["x-wx-openid"]) {
    const openid = req.headers["x-wx-openid"];
    const result = await Checker.findByPk(openid);
    
    if (!result) {
      res.send({
        code: -1,
        message: "请先打卡",
      });
      return;
    }

    if (result?.analysis === "分析失败，请稍后重试。") {
      // 删除数据库中的分析结果
      await Checker.update({ analysis: null }, {
        where: { openid }
      });

      res.send({
        code: -1,
        message: "分析失败，请稍后重试。"
      });

      return;
    }

    res.send({
      code: 0,
      data: {
        checkins: result?.checkins || '',
        analysis: result?.analysis || '分析中...'
      }
    });
  } else {
    res.send({
      code: -1,
      message: "请使用微信访问"
    });
  }
});

// 异步分析函数
async function analyzeCheckins(openid, checkins, aiService = 'deepseek') {
  const axios = require('axios');
  let analysis = '暂无分析结果';
  
  try {
    // 构建提示词
    const prompt = `${process.env.AI_PROMPT} 我去过的景区是：\n${checkins || ''}`;
    console.log(aiService, prompt)

    let response;

    switch (aiService) {
      case 'claude':
        response = await axios.post(`${process.env.AI_API_BASE}/v1/messages`, {
          model: `${process.env.AI_MODEL}`,
          max_tokens: Number(`${process.env.AI_API_MAX_TOKEN}`),
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ]
        }, {
          headers: {
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01',
            'x-api-key': `${process.env.AI_API_KEY}`
          }
        });
        console.log(response)
        analysis = response.data.content[0].text;
        break;
      case 'tongyi':
        response = await axios.post(`https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`, {
          model: `qwen-plus`,
          max_tokens: Number(`${process.env.AI_API_MAX_TOKEN}`),
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ]
        }, {
          headers: {
            'Content-Type': 'application/json',
            'Authorization' : `Bearer ${process.env.TONGYI_API_KEY}`
          }
        });
        console.log(response)
        analysis = response.data.choices[0].message.content;
        break;
      case 'deepseek':
        response = await axios.post(`https://api.deepseek.com/chat/completions`, {
          model: `deepseek-chat`,
          temperature: 1.5,
          max_tokens: Number(`${process.env.AI_API_MAX_TOKEN}`),
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ]
        }, {
          headers: {
            'Content-Type': 'application/json',
            'Authorization' : `Bearer ${process.env.DEEPSEEK_API_KEY}`
          }
        });
        console.log(response)
        analysis = response.data.choices[0].message.content;
        break;
    }

    
  } catch (error) {
    console.error(`${aiService} API 调用失败:`, error);
    analysis = '分析失败，请稍后重试。';
  }

  // 将分析结果保存到数据库
  await Checker.update({ analysis }, {
    where: { openid }
  });
}

// 更新打卡率数据的函数
async function updateCheckRates() {
  try {
    const { scenes } = require('./scenes.js');
    const { Op } = require('sequelize');

    console.log('开始更新打卡率数据...');

    // 获取所有有打卡记录的用户
    const checkers = await Checker.findAll({
      where: {
        checkins: {
          [Op.ne]: null,
          [Op.ne]: ''
        }
      }
    });

    // 统计每个景区的打卡次数
    const sceneCounts = {};
    const totalUsers = checkers.length;

    // 初始化所有景区的计数为0
    scenes.forEach(scene => {
      sceneCounts[scene.id] = 0;
    });

    // 统计每个景区的打卡次数
    checkers.forEach(checker => {
      if (checker.checkins) {
        // 假设checkins是以逗号分隔的景区ID列表，如 "js001,js002,js003"
        const checkedScenes = checker.checkins.split(',');
        checkedScenes.forEach(sceneId => {
          if (sceneId.trim() && sceneCounts.hasOwnProperty(sceneId.trim())) {
            sceneCounts[sceneId.trim()]++;
          }
        });
      }
    });

    // 计算每个景区的打卡率并更新到数据库
    for (const scene of scenes) {
      const count = sceneCounts[scene.id];
      const rate = totalUsers > 0 ? (count / totalUsers) * 100 : 0;

      // 创建或更新CheckRate记录
      await CheckRate.upsert({
        sceneid: scene.id,
        rate: parseFloat(rate.toFixed(2))
      });
    }

    console.log('打卡率数据更新完成，总用户数:', totalUsers);
  } catch (error) {
    console.error('自动更新打卡率失败:', error);
  }
}

const port = process.env.PORT || 80;

async function bootstrap() {
  await initDB();

  // 设置每天凌晨3点自动更新打卡率数据
  cron.schedule('0 3 * * *', () => {
    console.log('执行每日打卡率数据更新...');
    updateCheckRates();
  }, {
    timezone: 'Asia/Shanghai'
  });

  // 启动时也更新一次数据，确保有初始数据
  updateCheckRates();

  app.listen(port, () => {
    console.log("启动成功", port);
    console.log("打卡率数据将在每天凌晨3点自动更新");
  });
}

bootstrap();
