# VTO 可视化任务编排器

把设计规格转换为任务清单，在画布上编辑依赖，然后观察并行、条件路由、失败重试和执行日志。面向单用户课程演示，全部任务仍由模拟执行器执行。结构化规格使用离线规则分解；自然语言需求可选用联网模型服务，需要配置 API Key。

基于用户提供的《可视化任务编排器课程设计说明书》V1.0 实现。完整原文见 [设计说明书](docs/设计说明书原文.md)，消歧与实现细节见 [实现约定](docs/实现约定.md)。

> **已确认的规格修订：** 说明书 start 单出边规则与附录 A 的 start 双出边矛盾。用户确认严格单出边，运行示例增加一个耗时 0ms 的普通分流任务，因此是 **11 节点、12 条边**。分解器仍精确输出 6.5 的 9 条任务清单；原始 10 节点、11 边图保留作对照。

![编辑器执行预览](docs/界面预览.png)

## 两条命令启动

要求 Node.js ≥18 与 npm。首次安装依赖需要网络。安装后，规则分解、画布编辑、模拟执行和方案存取可离线运行；AI 分解需要访问已配置的模型服务。

```bash
npm ci
npm run dev
```

访问 **http://localhost:5173**。根脚本同时启动 Express **3000** 和 Vite **5173**，Vite 将 `/api` 代理到后端。按 Ctrl+C 停止两进程。

也可以严格按说明书在两个终端分别启动：

```bash
# 终端一，在仓库根目录执行
cd backend && npm install && npm run dev
```

```bash
# 终端二，在仓库根目录执行
cd frontend && npm install && npm run dev
```

首次演示：点击「载入示例」→「执行编排」。完整规格演示：点击「导入规格」→「填入登录示例」→「开始分解」→ 编辑清单 →「确认并生成画布」。

生产构建可由后端直接提供静态页面：

```bash
npm run build
npm start --workspace backend
# 访问 http://localhost:3000
```

## 自然语言 AI 分解

在部署或验收环境的仓库根目录复制配置模板：

```bash
cp .env.example .env
```

填写 `LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL` 后启动或重启后端。Key 只保存在服务端环境或根目录 `.env`，不要放入 `VITE_` 变量或提交到 Git。

| 变量 | 含义 |
| --- | --- |
| `LLM_API_KEY` | 模型服务的 API Key，必填 |
| `LLM_BASE_URL` | Chat Completions 兼容 API 的根地址，包含服务商要求的版本路径；程序追加 `/chat/completions` |
| `LLM_MODEL` | 服务商提供的确切模型名称，必填 |

配置文件按仓库根目录定位，不受从根目录还是 `backend/` 启动影响；已设置的进程环境变量优先。远程服务使用 HTTPS，本机回环地址可使用 HTTP。地址不应包含用户名、密码、查询参数或片段，也不要填完整的 `/chat/completions` 请求路径。

使用步骤：打开「导入规格」→ 选择「自然语言」→ 输入需求 →「AI 分解」→ 在原有确认表中编辑任务与依赖 →「确认并生成画布」→「执行编排」。例如：

> 帮我做一个登录功能，用户能输入账号密码，后端要校验，成功跳转首页，失败提示错误。

需求文本会发送给你配置的模型服务。返回结果经过 JSON、TaskSpec 依赖结构和现有图规则校验后，才进入确认表。两条入口共用同一确认表和执行流程；模型不会直接保存方案或执行任务。

未配置时，AI 按钮显示不可用及具体原因，原有规则分解照常使用。配置状态检查不调用模型，也不产生模型请求费用；`enabled: true` 仅表示本地配置完整，不能保证密钥、余额或模型服务当前可用。单次分解有超时和响应大小限制，不自动重试付费请求。

模型生成的“账号密码校验”“跳转首页”是编排中的模拟任务，不会真正开发登录系统或发起业务 HTTP 请求。条件输出遵循原执行器语义：任务成功时把 `output` 变量设为 `true`。AI 响应保留既有 `detectedFormat: "numbered"`，表示生成的编号结构；界面显示「AI 分解结果」，不会声称原自然语言属于编号格式。

配置、错误排查及完整验收步骤见 [自然语言验收](docs/自然语言验收.md)。

## 功能

- Markdown `#`～`####`、中文编号及数字编号结构识别，UTF-8 200KB 限制，`.md` / `.txt` 上传。
- 清洗、结构树、关键词规则和依赖推断，支持同级并行、父子依赖、条件分支后缀绑定。
- 自然语言 AI 分解：独立模型服务入口，严格 TaskSpec 校验，未配置时明确禁用，保留规则路径。
- 两步确认表：勾选、改名、改类型、增删、编辑依赖和分支。移除任务时保留依赖接续。
- 五类节点、浅色点阵画布、可折叠左右侧栏、属性面板、日志图例与进度条。
- 拖拽创建、20px 吸附、端口连线、非法连接 Toast、框选、删除、复制粘贴、撤销重做、缩放平移与自动布局。
- 服务端 R1～R8 校验，错误清单按节点定位；未通过校验不会执行任何节点。
- 最大并发数、受限表达式、true/false 路由、AND-Join、失败注入、500ms×attempt 退避重试、停止与 continueOnError。
- 每 500ms 增量轮询，状态颜色与图例共用同一份常量，失败日志突出显示。
- JSON 原子存储、方案列表、导入导出、自动草稿恢复及按方案恢复最近运行记录。
- 附录对照数据、可执行示例、Vitest 测试、浏览器测试、验收报告和 7 分 30 秒课堂演示 PPT。

快捷键：`⌘/Ctrl S` 保存，`⌘/Ctrl Z` 撤销，`⌘/Ctrl Shift Z` / `Ctrl Y` 重做，`⌘/Ctrl C/V` 复制粘贴，`Delete` 删除，`Shift` 拖动框选，右键拖动画布，`⌘/Ctrl` 加滚轮缩放，`F` 适应画布。输入表单时快捷键不会误删节点。

## 架构

```mermaid
flowchart TB
  Text[结构化规格] --> Decomposer[规则解析与任务分解]
  NaturalText[自然语言需求] --> LLM[服务端 LLM 分解]
  LLM --> TaskValidation[TaskSpec 与图规则校验]
  TaskValidation --> TaskSpec
  Decomposer --> TaskSpec[TaskSpec 确认表]
  TaskSpec --> Plan[Plan JSON]
  Canvas[Vue 3 + Element Plus + AntV X6] <--> Adapter[CanvasAdapter]
  Adapter <--> Stores[Pinia planStore / runStore]
  Stores <--> Plan
  Stores <--> Axios[Axios / REST]
  Axios <--> API[Express 4 路由]
  API --> Decomposer
  API --> LLM
  API --> Validation[R1～R8 校验]
  Validation --> Engine[Kahn 分层 / 并发调度 / 安全表达式]
  Engine --> Run[Run 快照和结构化日志]
  Run --> API
  API --> Storage[JSON 原子写 / 文件互斥]
```

```text
backend/
  server.js                 Express 入口，端口 3000
  routes/                   原有 REST 接口及自然语言并行入口
  config/                   服务端模型环境配置
  services/                 planService、runService、原子存储与 LLM 分解
  engine/                   decomposer、validator、scheduler、expression
  storage/                  运行时生成，Git 忽略
frontend/
  src/stores/               Pinia 状态与草稿恢复
  src/adapter/              X6 画布与数据双向同步
  src/components/           确认表、属性与日志组件
  src/views/                五区编辑器
shared/                     共享契约、颜色、画布转换与布局
examples/                   规格、TaskSpec、原始附录图与修正运行图
tests/                      Vitest 单元与接口测试
  e2e/                      Playwright 浏览器验收
scripts/                    联合启动脚本
docs/                       契约、实现约定、测试报告、演示材料
```

版本范围遵守说明书：Vue 3、Element Plus 2、X6 2、Pinia 2、Axios 1、Express 4、Vitest 1。Vite 5 与 TypeScript 5 由锁文件固定。执行引擎不依赖任何前端模块。

## 测试与验收

```bash
npm test             # 原有核心流程及 LLM 配置、响应校验、自然语言接口
npm run build        # TypeScript 检查和生产构建
```

浏览器自动测试无需手动启动开发服务。本机默认使用已安装的 Chrome；CI 环境使用 Playwright Chromium。执行：

```bash
npm run test:e2e
```

该命令自动完成生产构建，再启动隔离测试服务：页面和 API 仅监听 `127.0.0.1:4173`，模型协议替身使用随机回环端口，运行数据写入系统临时目录。测试显式注入假模型配置，不读取 `.env` 或真实 API Key。Playwright 使用独立浏览器上下文，结束后发送 SIGTERM 关闭服务并删除临时数据，不需要也不会常驻 3000/5173 开发服务。

本轮已通过 **225 项 Vitest 测试（原有 130 + 新增 95）**、**17 项浏览器测试（原有 9 + 新增 8）**，TypeScript 检查与 Vite 生产构建成功。浏览器覆盖了不拦截新接口的完整 HTTP 模型替身链路；真实模型供应商联调仍待配置，不能由替身测试推断通过。

原课程版验收证据见 [测试报告](docs/测试报告.md)，自然语言扩展的验收范围与运行记录见 [自然语言验收](docs/自然语言验收.md)，逐项人工步骤与时间安排见 [演示流程](docs/演示流程.md)，课堂讲义见 [演示 PPT](docs/演示讲义.pptx)。

## API 与数据

| 方法 | 路径 | 返回 |
| --- | --- | --- |
| POST | `/api/decompose` | `{ok:true, taskSpec}`，规则分解 |
| POST | `/api/decompose-nl` | `{ok:true, taskSpec}`，自然语言 AI 分解 |
| GET | `/api/decompose-nl/status` | `{enabled:true}` 或 `{enabled:false,code,message}`，仅查本地配置 |
| POST | `/api/plans` | `{id, updatedAt}` |
| GET | `/api/plans` | 方案索引数组 |
| GET / DELETE | `/api/plans/:id` | 完整方案 / `{ok:true}` |
| POST | `/api/plans/:id/execute` | `{runId}` |
| GET | `/api/runs/:runId?since=seq` | 完整节点状态与增量日志 |
| POST | `/api/runs/:runId/cancel` | `{status:"CANCELED"}` |

成功均返回 HTTP 200。业务错误为 `{code,message,details?}`，原接口使用 40001、40002、40003、40401、40402、40901、50000。自然语言入口额外使用 50301（未配置）、50201（上游请求失败）、50401（超时）；模型返回非法 JSON 或不合法 TaskSpec 使用 40001，并说明出错字段。保存允许结构合法但尚未连完的草稿；执行前完成全量语义校验。导入及加载也执行 Schema 校验。

`backend/storage/plans/index.json` 保存索引，`plans/<id>.json` 保存方案，`runs/<id>.json` 保存快照。写入流程为同目录临时文件、flush、rename，并按文件串行化。索引可从方案文件重建。不要直接修改正在执行的运行快照。

服务重启不会恢复计时器；之前未完成的运行会标记 FAILED 并写明中断原因。浏览器刷新可恢复仍在同一后端执行的运行。

## 运行边界

100 节点、200 边以内；只支持五种既定节点；无真实脚本执行、业务 HTTP 任务或多人协作。可选的 AI 分解会访问配置的外部模型服务，执行器仍只模拟任务。条件表达式通过 tokenizer 与递归下降解析器求值，支持比较、逻辑、括号、变量与字面量，不允许函数调用和赋值。

若端口已占用，请先停止旧的本项目服务。若存储文件损坏，界面会显示错误；恢复备份后重新加载，不会默默覆盖坏数据。长流程可收起侧栏、日志或放大画布查看节点文字。
