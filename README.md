# BPQ · 需求工程、软件设计与工作流编排

BPQ 将软件想法依次转换为需求基线、软件设计和可执行工作流，提供本机 Web 工作台与 Electron 桌面入口。三个子系统直接移植自 `ycwang-April/SE-TeamPrjoect` 的提交 `472cd7a5891a1a1bd22247a53197c78dc637d452`；目录、业务源码、数据契约、页面和锁文件保持一致。BPQ 保留原 Git 历史，旧 Vue/Express 模拟编排器可在历史提交 `7a9e7cf` 查看；旧 Plan JSON 不提供导入兼容。

## 项目简介与功能

- **需求工程 `requirements-engineering/`**：Idea 输入、澄清、多角色讨论、四维独立评价、人工审批、PRD（产品需求文档）、不可变需求基线及 A/B/C 返工回路。
- **软件设计 `software-design/`**：绑定需求基线与目标 Git 提交，生成设计正文、校验需求和验收覆盖、评审修订、确认冻结，再幂等交接 PM Agent（任务规划智能体）。
- **编排器 `workflow-orchestrator/`**：规格解析、层级任务和 Twin-Graph（任务层级与执行图）、图编辑、校验、影响分析、隔离试运行、锁版、并行执行、人工门禁、暂停/恢复、重试、检查点与 Git Worktree（独立工作目录）恢复。
- **基础设施与审计**：模型池、能力适配、MCP 工具配置、Skills 知识条目、工程规则、成本统计、SSE（服务器推送事件）、SQLite 审计与全文检索、中英文切换。

工作台有「需求工程」「编排设计台」「实时编排控制台」「基础设施与模型池」「版本与日志审计」五个主视图。软件设计入口位于已发布需求基线下方。

## 环境要求

- macOS、Windows 或 Linux；本次验收环境为 macOS。Web 模式需要浏览器，桌面模式还需要图形桌面环境。
- **Node.js ≥24.4.0**、npm，以及命令行可用的 Git。本次使用 Node.js 24.22.2、npm 11.19.1。
- 无需安装 MySQL、PostgreSQL、SQLite 命令行或 ORM。数据库使用 Node 内置 `node:sqlite`，启动时自动建表并导入内置数据。
- 首次安装需要访问 npm；桌面运行还需要下载 Electron。真实模型调用需要自行配置服务商密钥和模型。

锁文件实际版本：React / React DOM 19.3.1、React Flow 12.12.1、TypeScript 5.9.3、Vite 8.3.8、Electron 44.11.3、esbuild 0.27.7、gts 7.0.0、tsx 4.23.15。使用 `npm ci` 保持依赖一致。

## 从零安装

先安装符合要求的 Node.js 与 Git，然后在终端执行：

```sh
git clone --branch feat/reference-alignment-472cd7a https://github.com/yhwpxy/bpq.git
cd bpq
node --version
npm --version
git --version
npm run setup
npm run check
npm start
```

`setup` 在 `workflow-orchestrator/` 安装锁定依赖；`check` 检查参考文件一致性、服务端/前端类型、生产构建、三组编排门禁及 14 项需求/设计测试。验收脚本使用本地模型协议夹具及临时数据库，不需要付费模型密钥。

也可以完全沿用参考项目命令：

```sh
cd workflow-orchestrator
npm ci
npm run typecheck
npm run build
npm run verify:gates
npm run start:web
```

基础演示不需要配置文件。如果要通过环境变量配置 DeepSeek，在仓库根目录复制模板：

```sh
# macOS / Linux
cp .env_example .env
```

```powershell
# Windows PowerShell
Copy-Item .env_example .env
```

编辑 `.env` 中的 `DEEPSEEK_API_KEY=`，填入自己的密钥；也可使用 `OPENAI_API_KEY`、`ANTHROPIC_API_KEY` 或 `OPENCODE_API_KEY`。生产启动和开发脚本会读取根目录 `.env`。更直观的方式是在「基础设施与模型池」页面保存密钥。不要提交真实密钥。

## 启动与访问

### Web 工作台

在仓库根目录执行：

```sh
npm start
```

默认监听 `127.0.0.1:4190`。**打开终端打印的完整地址**，它带有 `apiBaseUrl` 和本次启动的 `token`；只打开不带令牌的地址可能无法读取业务数据。重启后使用新地址。

前端构建文件由同一 Node 服务提供，不需要分别启动前后端。按 Ctrl+C 停止。

修改端口的示例：

```sh
# macOS / Linux
ORCH_PORT=4192 npm start
```

```powershell
# Windows PowerShell
$env:ORCH_PORT="4192"
npm start
```

### Electron 桌面与开发

```sh
# 已执行 setup 和 build 后
npm run start:desktop

# 开发模式：Vite 页面热更新 + Electron
npm run dev
```

开发页面端口为 `5178`，后端由桌面宿主启动并分配回环端口。后端源码修改后需重启开发命令。首次桌面启动可能下载 Electron 二进制。

## 数据库、演示数据和账号

Web 默认数据目录为 `workflow-orchestrator/.orchestrator/`，其中包含：

- `orchestrator.sqlite`：工作流、版本、运行、HAMA、设计评审及审计数据，采用 WAL 模式和 FTS5 全文索引。
- `secrets.json`：通过页面保存的模型密钥。
- `sample-workspace/`、`worktrees/`：演示工程和隔离运行目录。
- `document-runs/`、`design-inputs/`、`design-generations/`：需求运行和设计工件。

表结构和内置能力、模型配置、术语、Skills、MCP 示例及工作流在首次启动时自动初始化，**无需手工建表或导入 SQL**。需要自定义位置时设置绝对路径 `ORCH_DATA_DIR`；桌面默认使用 Electron 用户数据目录下的 `state/`。

本项目**没有预设用户名/密码，也没有注册登录页**。业务 API 使用宿主生成的 Bearer Token；审批人是本地操作员填写的审计名称，不是登录账号。`turbo`、`supervised`、`strict` 是执行权限等级。

内置内容包括：账本工作流、编排器/课程选课/账本三份设计规格预设，以及「校园服务平台活动报名」HAMA 演示。校园账号是演示中的需求设定，并非可登录账号。

### 演示一：编排执行（无需密钥）

1. 打开「编排设计台」，选择默认 `WF-001` 账本工作流。
2. 点击「隔离试运行」，查看校验及试运行报告。
3. 点击「锁定不可变版本」，再点击「发布并实时执行」。
4. 在实时控制台查看图、节点输出、日志和检查点；在审计页查看版本与证据。

未配置模型时，编排器使用参考项目的确定性本地合成逻辑。它能验证编排、文件产物和检查点流程，不代表已经实现了规格描述的完整业务软件。

### 演示二：校园需求基线（无需密钥）

1. 「需求工程」→「载入校园演示」，首次可使用 `campus-demo` 项目 ID。
2. 点击「启动 HAMA-Loop」。
3. 澄清阶段填写审批人，选择「提交澄清」，答复“复用已有校园账号”。
4. 方案评价完成后选择「批准方案」，生成 PRD 后选择「确认需求并发布基线」。
5. 查看已确认基线、需求追踪、历史决定，并导出 Markdown。再次演示请更换项目 ID，或选择已有最新基线作为父版本。

### 软件设计与正式交接

1. 先完成演示一，或通过 API 注册一个实际存在的 Git 工程。参考项目首次启动仅登记示例工程，首次执行后才创建其 Git 目录。
2. 在已发布需求基线下选择「目标工程工作区」，核对提交，点击「生成软件设计」保存输入草案。
3. 配置可用模型，填写设计模型和反馈，生成正文；检查诊断、需求/AC（验收标准）覆盖、评审稿及 PM 预览。
4. 保存为评审修订，填写操作人，提交评审；无阻断后确认冻结，再查看结构化 PM 输入并「交接 PM 并打开工作流」。
5. 在编排设计台继续校验、试运行、锁版和执行。

校园 `demo` 基线只能演练，**不能完成正式设计确认或 PM 交接**。完整正式流程要求 HAMA `live` 基线及已配置模型。自动验收使用本地模型协议夹具验证这条链路；未将其当作真实在线模型质量验证。

## 验收与维护

```sh
npm run check
npm run verify:reference

# 可选：从仓库根目录准备隔离参考副本并执行差分
git clone https://github.com/ycwang-April/SE-TeamPrjoect.git work/reference
git -C work/reference checkout 472cd7a5891a1a1bd22247a53197c78dc637d452
npm --prefix work/reference/workflow-orchestrator ci
npm --prefix work/reference/workflow-orchestrator run build
npm run verify:parity -- work/reference
```

差分脚本要求参考目录 HEAD 为 `472cd7a5891a1a1bd22247a53197c78dc637d452` 且已跟踪文件干净。它比较 SQLite 定义、60 个路由的空请求/不存在 ID 响应、鉴权和 SSE 连接；成功业务流程由参考集成测试覆盖。输出位于忽略提交的 `work/`。

需要人工复验软件设计页面时，先完成构建，再运行 `node --experimental-transform-types scripts/ui-fixture.mjs`。它在独立 `work/ui-fixture/` 中通过真实 HAMA 服务发布测试基线，并启动本地模型协议夹具（默认端口 4193）；打开打印的地址，选择测试工程和 OpenAI 提供商，模型填写 `acceptance-fixture`。这是确定性 UI 测试环境，不连接商业模型，测试审批由脚本明确标记。按 Ctrl+C 停止。

详见 [功能对齐报告](docs/ALIGNMENT-REPORT.md)、[目录与文件映射](docs/REFERENCE-INVENTORY.md)、[API 契约](docs/API-CONTRACTS.md)、[表字段](docs/SCHEMA.md)。三个子系统中的原始验证记录是参考项目历史证据；本次验收记录单独保存在 `docs/acceptance/`。

## 常见问题

1. **提示 `node:sqlite`、类型转换或 `mkdtempDisposableSync` 不可用**：检查 `node --version`，换用 Node.js ≥24.4，再执行 `npm run setup` 和 `npm run check`。
2. **依赖安装失败或 Electron 下载失败**：检查网络、代理及 npm 源；重试 `npm run setup`。Web 模式可先用 `npm start`，不依赖桌面窗口。不要删除锁文件随意升级依赖。
3. **端口占用**：停止自己的旧服务，或用 `ORCH_PORT` 更换 Web 端口；开发模式需释放 `5178`。
4. **页面 401、连接断开或加载失败**：重新打开本次启动输出的完整带令牌地址；旧令牌在重启后失效。检查 Node 服务是否仍在运行。
5. **数据库无法打开或被锁**：确认数据目录可写，且同一目录只运行一个宿主进程。停止服务后备份整个数据目录，再排查磁盘权限；无需配置远程数据库连接。
6. **生成软件设计提示工程目录不存在**：先完成一次默认工作流执行以初始化示例 Git 工程，或注册实际存在的工程，再刷新目标提交。
7. **设计生成按钮不可用或 demo 不能交接**：先保存设计输入、配置密钥和模型；正式评审与交接须使用 `live` 基线。demo 限制与参考项目一致。
8. **构建出现包体积警告**：参考构建会提示主 JS 超过 500 kB；这是警告，不影响本次构建通过。`ExperimentalWarning` 也不等于测试失败。

备份时先停止服务，再复制整个数据目录；数据库、工作树、设计工件和密钥应一并保留。运行数据和密钥不提交到 Git。
