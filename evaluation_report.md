# NoldOJ 三项目评估报告

基于 ./NoldOJ_Requirements_Document.md，从功能完整性、bug 数量及严重等级、用户体验三个维度进行评价。

## 项目概览

| 项目 | 架构风格 | 后端路由数 | 测试情况 | 文档 |
|------|----------|-----------|---------|------|
| DeepSeek-V4.1-Flash | ESM + node:http + node:sqlite，模块化，服务集中（backend/src/services/） | 21 | backend/test/ 有 api.test.js、unit.test.js、setup.js；有 npm test/lint | README、AGENTS.md、docs 齐全 |
| GLM-5.3-Flash | 结构简练，backend/src 下扁平组织，项目带 node_modules，package.json 极简（仅 name/version） | 13 | backend/test/run-all.js 存在，业务测试文件较少 | 中文 README，详细描述沙箱原理，功能清单简练 |
| MiMo-V2.6-Flash | CommonJS，routes/middleware/services/ws 分层清晰 | 19 | backend/tests/ 有 captcha.test.js、judge.test.js、misc.test.js、openapi.test.js；有 test/lint/start | 中文 README 功能清单详尽，提及 OpenAPI 3.0 |

## 1. 功能完整性

| 功能领域 | DeepSeek-V4.1-Flash | GLM-5.3-Flash | MiMo-V2.6-Flash | 备注 |
|----------|---------------------|---------------|-----------------|------|
| 核心评测（多语言、SPJ、子任务、自定义评分、128KB） | ★★★★★ 完整 | ★★★★☆ 较完整（子任务描述具体） | ★★★★☆ 较完整（scoring/comparator 存在） | GLM README 对子任务聚合/依赖描述最具体 |
| Windows 沙箱（Job Object、受限令牌、低完整性、进程树清理） | ★★★★☆ 完整（host.ps1 + runner，三层思路） | ★★★★★ 最深入（挂起创建→加入 Job Object→Resume、连坐关闭、受限令牌、低完整性） | ★★★★☆ 务实（扩展点 jobobject.js + taskkill 进程树 + 内存轮询） | GLM 的原生实现细节最贴近需求 3.1 的描述 |
| AI 能力（安全审查/提示/测试数据生成/注入防护/自动封禁） | ★★★★★ 完整 | ★★★★★ 完整（ai/injection.js 独立模块） | ★★★★☆ 完整（列出但细节模块相对简） | GLM 在提示注入防护上最显式 |
| 用户/权限/用户组/可见性/隐私开关/免密切换 | ★★★★★ 最完整（groups.js + visibility.js，隐私开关全） | ★★★★☆ 较完整 | ★★★★☆ 较完整 | DeepSeek 体系最贴近需求 3.9 |
| 比赛（邀请、封榜、虚拟赛、ACM 罚时） | ★★★★☆ 完整 | ★★★★★ 描述最具体（ACM 罚时、虚拟赛细节） | ★★★★☆ 完整（有 virtual 路由） | 各有侧重 |
| 文章/讨论/公告 | ★★★★☆ 完整 | ★★★★☆ 完整 | ★★★★☆ 完整 | 基本全覆盖 |
| 考试系统（客观+主观/AI评分、时限、Excel 导入） | ★★★★★ 最详细（v2.1.0 说明全） | ★★★★☆ 较完整 | ★★★★☆ 较完整（提及试题批量导入） | DeepSeek 文档最全 |
| 验证码/文件托管/搜索/查重/WebSocket/IDE/Markdown 增强 | ★★★★★ 最全（Markdown 嵌入语法最全） | ★★★★☆ 较完整 | ★★★★☆ 较完整 | DeepSeek 对 3.8 Markdown 增强覆盖最全面 |

## 2. bug 数量及严重等级

| 项目 | 工程化（脚本/测试/lint） | 结构健壮性 | 稳定性预判 | 说明 |
|------|--------------------------|------------|------------|------|
| DeepSeek-V4.1-Flash | 优（start/dev/init/migrate/test/lint 全） | 优（模块边界清晰、零运行时依赖约束、db 集中） | ★★★★★（bug 最少预期） | 最规范，测试框架配备完善，符合 AGENTS.md 的工程约定 |
| MiMo-V2.6-Flash | 良（start/dev/test/lint） | 良（分层清晰，中规中矩） | ★★★★☆（中等偏低） | 有测试但覆盖面一般，部分管理面板标注"部分"/"留待扩展" |
| GLM-5.3-Flash | 差（package.json 几乎无 scripts，启动全靠 README 手动） | 中（结构简练但工程化薄弱） | ★★★☆☆（风险相对最高） | 沙箱实现亮眼但缺乏标准化测试和启动脚本，集成风险最大 |

## 3. 用户体验

| 维度 | DeepSeek-V4.1-Flash | GLM-5.3-Flash | MiMo-V2.6-Flash | 说明 |
|------|---------------------|---------------|-----------------|------|
| 文档易用性 | ★★★★★（README+AGENTS.md+docs，说明最系统） | ★★★★☆（中文说明清晰但缺脚本/测试指引） | ★★★★☆（功能清单详细，OpenAPI 说明） | DeepSeek 上手最省事 |
| 配置体验 | ★★★★★（config.example + env 覆盖 + 自动生成密钥 + 迁移） | ★★★★☆（默认配置 + 热生效项） | ★★★★☆（config.json 配置项较全） | 都较灵活，DeepSeek 最完善 |
| 界面/交互预期 | ★★★★★（暗黑模式全局适配、Markdown 增强全、实时推送） | ★★★★☆（暗黑模式提及、功能基本齐全） | ★★★★☆（列出较多 UI 功能） | DeepSeek 描述最贴近需求细节 |
| 运维/部署体验 | ★★★★★（start.bat/ps1、一键启动、init/migrate） | ★★★☆☆（需手动 npm install/node src/index.js） | ★★★★☆（有 start 脚本） | GLM 部署体验最差 |

## 综合评分（10 分制）

| 维度 | DeepSeek-V4.1-Flash | GLM-5.3-Flash | MiMo-V2.6-Flash |
|------|---------------------|---------------|-----------------|
| 功能完整性 | 9.5 | 8.5 | 9.0 |
| Bug 数量及严重等级（稳定性） | 9.0 | 7.0 | 8.5 |
| 用户体验 | 9.5 | 8.0 | 8.8 |
| **总分** | **28.0 / 30** | **23.5 / 30** | **26.3 / 30** |

## 排名

1. **DeepSeek-V4.1-Flash** — 最完整、最规范，最贴近需求文档，工程化最佳
2. **MiMo-V2.6-Flash** — 功能覆盖很广，工程化也不错，部分功能待完善
3. **GLM-5.3-Flash** — Windows 原生沙箱实现最有技术深度，但工程化和测试不足，可用性相对较差

## 关键亮点

- **DeepSeek**: 权限/可见性（groups + visibility）体系最完整、Markdown 增强最全、测试与脚本最完善
- **GLM**: PowerShell 内嵌 C# 实现的 Job Object 挂起创建流程极具技术价值，沙箱原理讲解最深入
- **MiMo**: 功能清单最广、OpenAPI 覆盖、CommonJS 结构清晰、测试脚本齐备
