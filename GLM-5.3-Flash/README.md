# NoldOJ - Windows 原生在线评测系统

完整可运行的 OJ 系统脚手架：Node.js 24 后端（`node:sqlite` 零外部数据库）、Windows 沙箱评测器（Job Object + 受限令牌）、零构建服务端渲染 vanilla JS 前端。

## 环境要求

- Node.js >= 24（使用内置 `node:sqlite`）
- Windows 10/11（沙箱使用 Job Object / CreateProcess 受限令牌 / 低完整性令牌）
- 工具链（可选，按需）：GCC (`D:\mingw64\bin\g++.exe`)、Python、JDK —— 语言编译/运行模板可在「管理面板」中自行修改
- AI 功能（可选，默认关闭提示需先配置）：本地 Ollama `http://127.0.0.1:11434`，模型如 `qwen3:1.7b`

## 快速启动

```
双击 start.bat
```

或手动：

```
cd backend
npm install
node src/index.js
```

访问 http://localhost:3000 。首次启动自动：

- 生成 `config/config.json`（含随机 `jwtSecret`）
- 创建 SQLite 数据库 `backend/data/NoldOJ.db`
- 注入超级管理员 **admin / admin123**（控制台会打印，请尽快修改）
- 注入 5 种语言（C++/C/Python3/Java/JavaScript）、12 个常用标签、系统用户组
- 创建 `tmp/`、`backend/data/sandbox/`、`testdata/`、`uploads/`、`logs/` 目录

## 目录结构

```
config/config.default.json   默认配置（config.json 覆盖其上，热生效项可在后台改）
backend/src/index.js         入口
backend/src/db/              schema / init / sqlite 封装 (WAL, busy_timeout 5000)
backend/src/judge/           sandbox-runner.ps1 沙箱、评测流程、比较、评分脚本解释器、IDE 队列
backend/src/routes/          全部 API (13 个模块)
backend/src/services/        rating、成就、可见性、查重
backend/src/ai/              Ollama 客户端、安全审查、AI 提示 / 测试数据生成
backend/test/                npm test（零依赖单测）
frontend/                    静态页面（30 页，共享 static/app.js）
tmp/                         评测临时文件（.gitignore 内，勿删目录）
```

## 沙箱评测

`sandbox-runner.ps1`（内嵌 C# Runner）：

1. **挂起态 CreateProcess** → 加入 **Job Object**（进程时间/墙钟时间/内存/进程数限制 + KILL_ON_JOB_CLOSE 连坐关闭）→ Resume，杜绝限制前的逃逸窗口
2. 受限令牌 `DISABLE_MAX_PRIVILEGE` + 低完整性 `S-1-16-4096`；非管理员启动时自动降级为直接运行（模式 `fallback`），Job 限制仍生效
3. 防超时：墙钟超杀，退出码 `0x99 (153)` 被判为 TLE；内存超限（Job memory 判定）判 MLE（先于 RE 判定）
4. 共享临时目录均位于 `./tmp/` 并被 `.gitignore` 覆盖

考试/训练/检查场景可关闭沙箱：`config.json` → `judge.useSandbox: false`（直接 CreateProcess + 超杀，无需管理员）。

## 功能一览

- **判题**：严格/宽松/浮点容差比较、SPJ（`check.exe / check.py / spj.*`）、子任务分组（依赖前置 `depends`、聚合策略 `sum/min/max`、分组评分脚本）、整题自定义评分脚本（语法：`A = 1; if (cond) { ... } else { ... }` 或 `if (cond) stmts fi`，函数 `min/max/abs`，最终输出变量 `score`）
- **比赛**：邀请码报名、榜单冻结（结束前 N 分钟定格）、ACM 罚时（错题 12 分钟）、赛后题解发布、虚拟比赛（服务器端计时 + 错误提交计入罚时）
- **训练**：题单（自动记录进度）、365 天做题日历、Rating 公式（新 AC `80 + 20×难度`，重复 `+5`，CE `-5`）、8 种成就
- **AI**（配置后才可用）：代码安全审查（恶意代码自动封号）、题目提示（需已失败 2 次且冷却 60 秒）、AI 生成测试数据、主观题评分
- **教学**：测验（选择题/判断/填空/主观，客观自动判分 + 主观 AI 评分）、文章/题解、题目讨论（两级回复、锁定/置顶/官方）、公告置顶
- **管理**：用户封禁/强制下线/重置密码/免密切换/配额调整、Excel 批量建用户带默认密码、私有题目按用户组可见、CORS、限流参数、注册开关 —— 均热生效
- **查重**：代码 tokenize + LCS 相似度（≥70% 疑似 / ≥85% 高危），题目级或整场比赛批量
- **其他**：悬停 diff、图床配额、SVG 验证码（无 `<text>` 标签、一次性）、登录/注册/提交/IDE 多级限流、多语言 IDE 运行

## 测试

```
cd backend
npm test        # 30 项单测：评分解释器、比较器、查重、验证码、JWT、密码、限流
```

## 配置

所有键位于 `config/config.default.json`，用 `config/config.json` 覆盖：

| 键 | 说明 |
| - | - |
| `core.jwtSecret` | 空 = 首次启动自动生成（改配置不覆盖） |
| `core.databasePath / sandboxWorkDir / testdataDir` | 相对路径，自动转绝对 |
| `judge.concurrency / ideRunTimeout / useSandbox` | 评测相关 |
| `ai.*` | baseUrl/model/apiKey + 四种功能开关，安全审查故障时放行 |
| `captcha.enabled` | 登录/注册验证码 |
| `file.maxFileMb / file.quotaGb` | 全局图床上限（用户可单独降级） |
| `rating.*` | 评分公式常数 |

## 管理入口

浏览器访问 `/admin.html`（须 teacher/admin/super）：用户、题目（编辑/测点/子任务）、语言、公告、比赛编排、用户组（含 Excel 导入）、系统配置 7 个标签页。

## 常见问题

- **深色模式**：右上角 ☀/🌙 切换，写 `localStorage['noldoj-theme']`
- **评测一直 RE**：若程序访问网络或需要高权限，受限令牌会拒之门外 —— 目前的 fallback 会自动尝试直接运行
- **管理员后台看不到某题**：私有题目需绑定可见性（题单组绑定 `group_visibility`）
- **删除用户/题目后新记录复用旧 ID**：主键无 AUTOINCREMENT，属预期行为
