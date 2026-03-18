# 山屋惊魂 (Betrayal at House on the Hill) — 多人联机版

基于 WebSocket 的《山屋惊魂》桌游网页版。前端部署在 Vercel，WebSocket 服务端部署在 AWS API Gateway WebSocket + Lambda + DynamoDB。

---

## 架构

```
玩家浏览器
    │  wss://
    ▼
AWS API Gateway WebSocket
    │  invoke
    ▼
AWS Lambda (3个函数)
    │  read/write
    ▼
AWS DynamoDB (2张表)
```

前端静态文件由 Vercel 托管，WebSocket 连接直接打到 AWS API Gateway。

---

## 部署步骤

### 第一步：部署 AWS 后端（Lambda + API Gateway + DynamoDB）

#### 前置条件
- 安装 [AWS CLI](https://aws.amazon.com/cli/) 并配置好权限（`aws configure`）
- 安装 [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html)
- 一个 S3 存储桶（SAM 部署包用）

#### 安装 Lambda 依赖
```bash
cd lambda
npm install
cd ..
```

#### 构建并部署
```bash
# 构建 SAM 项目
sam build

# 引导式首次部署（会生成 samconfig.toml，以后可直接 sam deploy）
sam deploy --guided
```

部署时会提示输入参数：
- **Stack Name**：例如 `swjh-stack`
- **AWS Region**：例如 `ap-northeast-1`（东京）
- **Confirm changes before deploy**：`y`
- **Allow SAM CLI IAM role creation**：`y`
- **Save arguments to samconfig.toml**：`y`

部署完成后，终端会输出：

```
Outputs
-------
WebSocketURL    wss://xxxxxxxxxx.execute-api.ap-northeast-1.amazonaws.com/prod
```

**复制这个 `wss://...` 地址**，下一步要用到。

---

### 第二步：更新前端 WebSocket 地址

打开 `frontend/config.js`，将 `YOUR_API_ID` 和 `YOUR_REGION` 替换为实际值：

```js
// frontend/config.js
window.WS_ENDPOINT = 'wss://xxxxxxxxxx.execute-api.ap-northeast-1.amazonaws.com/prod';
```

提交更改：
```bash
git add frontend/config.js
git commit -m "config: update WebSocket endpoint"
git push origin main
```

---

### 第三步：部署前端到 Vercel

1. 登录 [Vercel](https://vercel.com/)，点击 **Add New Project**
2. 导入本 GitHub 仓库
3. 在 **Root Directory** 选择 `frontend`（非项目根目录）
4. Framework Preset 选 **Other**（纯静态文件）
5. 点击 **Deploy**

Vercel 会自动在每次 `git push` 后重新部署。

---

## 本地开发（传统 Node.js 模式）

如果只想本地跑，直接用 `server.js`（不需要 AWS）：

```bash
npm install
node server.js
```

然后浏览器访问 `http://localhost:3000`。

---

## 游戏规则（v3，基于官方规则书）

| 规则 | 说明 |
|------|------|
| 移动步数 | 等于当前**速度属性值**，无需掷骰 |
| 进入新房间 | 翻出房间牌；若房间有卡牌符号，必须停止移动并摸牌 |
| 摸牌后 | 结算效果后**本回合自动结束** |
| 凶兆检定 | 固定掷 **6 枚骰子**，总点数 < 凶兆总数则幽灵降临 |
| 攻击 | 每回合最多攻击**一次**，须与目标在同一房间，**不结束回合** |
| 幽灵降临前 | 属性最低为 1，不会死亡 |
| 幽灵降临后 | 属性可降为 0，降为 0 时死亡 |

---

## 目录结构

```
swjh/
├── template.yaml        # AWS SAM 模板（API Gateway + Lambda + DynamoDB）
├── lambda/              # AWS Lambda 函数
│   ├── connect.js       # $connect 路由
│   ├── disconnect.js    # $disconnect 路由
│   ├── message.js       # $default 路由（所有游戏消息）
│   ├── gameLogic.js     # 纯游戏逻辑（无 AWS 依赖）
│   ├── db.js            # DynamoDB 操作封装
│   ├── broadcast.js     # API Gateway 广播封装
│   └── package.json
├── frontend/            # Vercel 静态前端
│   ├── index.html
│   ├── client.js        # WebSocket 客户端 + 渲染逻辑
│   ├── style.css
│   ├── config.js        # ← 填入 WebSocket URL
│   └── vercel.json
├── server.js            # 本地开发用（传统 WebSocket 服务器）
└── public/              # 本地开发前端资源
```
