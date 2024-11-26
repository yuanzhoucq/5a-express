const path = require("path");
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const { init: initDB, Counter, Checker } = require("./db");

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

// 连接 Claude.ai 进行分析
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
    
    // 调用 Claude API 进行分析
    const axios = require('axios');

    const checkins = req.body.checkins;
    
    let analysis = '暂无分析结果';
    
    try {
      // 构建提示词
      const prompt = `${process.env.AI_PROMPT} 我去过的景区是：\n${checkins || ''}`;
      console.log(prompt)
      
      const response = await axios.post(`${process.env.AI_API_BASE}/v1/messages`, {
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
      
    } catch (error) {
      console.error('Claude API 调用失败:', error);
      analysis = '分析失败,请稍后重试';
    }
    
    res.send({
      code: 0,
      data: {
        checkins: result?.checkins || '',
        analysis: analysis
      }
    });
  } else {
    res.send({
      code: -1, 
      message: "请使用微信访问"
    });
  }
});



const port = process.env.PORT || 80;

async function bootstrap() {
  await initDB();
  app.listen(port, () => {
    console.log("启动成功", port);
  });
}

bootstrap();
