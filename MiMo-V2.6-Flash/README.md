# NoldOJ

Windows 原生在线评测系统（Online Judge）。基于 Node.js ≥ 24 + 内置 `node:sqlite`，无外部数据库依赖。

## 功能总览（v2.1.0 脚手架）

| 模块 | 状态 | 说明 |
|------|------|------|
| 评测引擎 | ✅ 可用 | C/C++/Python/Java/JS，多比较模式，分组 Subtask，自定义评分脚本 |
| 沙箱 | ✅ 回退层 | 独立临时目录（`./tmp/`）+ 超时 + 进程树终止 + 内存轮询；Job Object 原生绑定扩展点见 `backend/services/sandbox/jobobject.js` |
| AI 代码安全审查 | ✅ 可选 | Ollama 兼容接口，异步审查，恶意代码自动封禁 + 踢下线 |
| AI 提示 / 数据生成 | ✅ 可选 | 失败 2 次后思路提示（60s 冷却）；教师一键生成测试数据 |
| SVG 验证码 | ✅ 可用 | 自绘路径轮廓（答案不进 DOM），干扰线 + 湍流，一次性、5 分钟过期 |
| 认证 | ✅ 可用 | 双 Token（Access + HttpOnly Refresh），强制下线即时失效，封禁全拦截 |
| 题目 / 标签 / 难度 | ✅ 可用 | Markdown、多标签、6 级难度、编号回收 |
| 提交 / 重评 / 对比 | ✅ 可用 | 提交锁、限流、逐测试点详情、Diff 对比 API |
| 在线 IDE | ✅ 可用 | 三阶段状态、WebSocket 实时推送、内存检测 |
| 比赛 | ✅ 可用 | CRUD、邀请、排行榜、封榜/解封、虚拟参赛 |
| 文章 / 公告 | ✅ 可用 | Markdown，题解关联，置顶公告 |
| 讨论区 | ✅ 可用 | 两级回复，官方题解/置顶/锁定 |
| 考试系统 | ✅ 可用 | 选择/判断/填空/简答，客观自动评分，主观 AI/手动评分 |
| 题单训练 | ✅ 可用 | 进度追踪、公开/私有 |
| 文件托管 | ✅ 可用 | 10MB 单文件，用户配额（默认 2GB） |
| 用户组与可见性 | ✅ 可用 | 系统组/自定义组，题目/比赛/考试/题单可见性绑定 |
| 排行榜 / Rating | ✅ 可用 | 称号体系，AC 加分，CE 扣分 |
| 成就系统 | ✅ 可用 | 一血、连击、百题等，隐私开关 |
| 代码查重 | ✅ 可用 | Token 序列相似度，异步任务，85%/70% 双阈值 |
| 模糊搜索 | ✅ 可用 | 题目/比赛/文章，忽略空格 |
| WebSocket | ✅ 可用 | 判题状态、Rating、踢下线，心跳保活 |
| 语言管理 | ✅ 可用 | 超管动态增删改，占位符命令 |
| 管理面板 | ✅ 部分 | 用户/语言/用户组/设置；Excel 导入等留待扩展 |
| 运行设置持久化 | ✅ 可用 | 管理面板修改注册/验证码/AI/配额等并写回 config.json |
| 用户组表格导入 | ✅ 可用 | 自定义组批量导入，未注册自动建号（默认密码） |
| 试题批量导入 | ✅ 可用 | JSON/Excel 行数据导入考试题目 |
| 比赛题解发布 | ✅ 可用 | 结束后一键发布关联题解，独立题解列表 API |
| KaTeX 公式 | ✅ 可用 | 题面/文章/讨论 `$...$` / `$$...$$` 渲染 |
| 讨论发帖/回复 | ✅ 可用 | 两级回复、置顶/官方/删除，Markdown+公式 |
| 多文件提交 | ✅ 可用 | 附加文件写入沙箱目录参与编译 |
| 代码对比 UI | ✅ 可用 | LCS 行差分，左右并排，红/绿/黄高亮 |
| 考试答题 UI | ✅ 可用 | 倒计时、选择/判断/填空/简答、自动评分 |
| 文件托管 UI | ✅ 可用 | 上传/配额/直链复制/删除 |
| OpenAPI 3.0 | ✅ 可用 | `GET /api/openapi.json` |

## 环境要求

- Windows 10+
- Node.js ≥ 24（内置 SQLite）
- MinGW64（C/C++）、Python 3、JDK（可选，按需启用语言）
- Ollama（可选，AI 能力）

## 快速开始

```powershell
# 方式一：一键脚本
.\start.ps1        # 或双击 start.bat

# 方式二：手动
npm install
npm start
```

打开 http://127.0.0.1:3000 ，默认管理员：`admin / admin123`（登录后立即修改）。

## 目录结构

```
backend/
  server.js          入口（HTTP + WS + 启动收敛）
  config.js          配置加载（config.json + 环境变量 + JWT 密钥自动生成）
  db/schema.sql      全量建表（幂等）
  db/database.js     node:sqlite 封装 + ID 回收池
  middleware/        auth（双 Token/角色）、rateLimit（固定窗口，落库）
  routes/            16 个 API 模块
  services/
    judge/           队列、runner、IDE、比较器、评分脚本、语言
    sandbox/         runner（回退层）+ jobobject（原生扩展点）
    ai/              client、review、hint、testdata、注入防护
    captcha.js       SVG 自绘验证码
    rating.js achievements.js plagiarism.js problemset.js
  ws/hub.js          WebSocket 广播
frontend/
  index.html         SPA 外壳（主题预加载防闪烁）
  css/main.css       明暗主题全局适配
  js/api.js          双 Token 刷新的 API 客户端 + Markdown
  js/app.js          Hash 路由 + 全部页面
config/config.json   运行配置
tmp/                 评测临时目录（自动清理，已 gitignore）
backend/data/        数据库、上传、测试数据（gitignore）
```

## 配置

编辑 `config/config.json`（或用环境变量覆盖 `PORT` / `HOST` / `JWT_SECRET` / `DB_PATH` / `AI_REVIEW`）：

- `security.captchaEnabled` — 验证码开关
- `security.registrationEnabled` — 自助注册开关
- `ai.*` — AI 审查/提示/数据生成开关与 Ollama 地址、模型、API Key
- `judge.*` — 队列并发、默认时限/内存
- `files.*` — 上传限制与默认配额

## 自定义评分脚本

```
# 变量: full, n, passed, s0..sN；输出变量: score
x = s0 + s1
if (x >= 2) score = 100 else score = x * 50 fi
score = max(score, min(full, passed * 10))
```

支持 `+ - * / % & | ^ << >> && || ! < > <= >= == !=`、`min/max/abs`、括号、`if/else/fi`。

## 沙箱说明（安全警告）

三层隔离设计：低完整性级别 + Job Object + 受限令牌/AppContainer。本脚手架内置可运行的回退层（临时目录隔离、超时、`taskkill /T /F` 进程树终止、工作集内存轮询超限杀进程）。完整 Job Object 原生绑定请在 `backend/services/sandbox/` 放置 `noldoj-sandbox.node` 并实现 `jobobject.js` 中的接口。

**请勿在存有敏感数据的个人主机上将本系统暴露到公网。建议虚拟机/专用测试机部署。**

## API 概览

- `POST /api/auth/{login,register,refresh,logout,password}` · `GET /api/auth/me`
- `GET /api/captcha`
- `GET|POST|PUT|DELETE /api/problems*` · 测试点/分组管理
- `GET|POST /api/submissions*` · 重评/删除/对比
- `POST /api/ide/run` · `GET /api/ide/run/:id`
- `/api/contests*`（含 `/board`、邀请、封榜解封）
- `/api/articles*` `/api/announcements*` `/api/discussions*`
- `/api/problem-sets*` `/api/exams*` `/api/files*`
- `/api/admin/*`（用户/用户组/语言/设置/统计）
- `/api/search` `/api/plagiarism/*` `/api/virtual/*` `/api/ai/*`
- `GET /api/health` · `WS /ws?token=...`

## 测试

```powershell
npm test    # node --test backend/tests/
```

## License

MIT
