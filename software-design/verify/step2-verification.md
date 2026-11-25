# 步骤 2 验证记录

## 实现与操作

需求工程页先保存步骤 1 输入，再选择已配置的提供商、模型和可选反馈生成设计。服务只调用宿主 native-api 的无工具文本路径（`textOnly=true`、`readOnly=true`、空 fileScope），不创建工作流，也不写入目标工程。生成模块不导入校园或账本预设；测试明确加载自己的夹具。

输入包括服务端保存的完整基线、目标提交清单、依赖及入口、本次反馈、上次诊断和逐需求的触发 / 结果。未知源码细节要求列入假设或未决事项。校验可以检查结构及引用；技术方案与业务语义仍需步骤 3 的人工评审。

- `POST /api/designs/{designId}/generate`：提交 `expectedHash、providerId、model、feedback`。成功返回 201；失败返回 422 和具体 `diagnostics`、`generationId`，输入摘要冲突或并发生成返回 409。
- `GET /api/designs/{designId}/generations`：读取该输入的所有成功 / 失败记录。页面失败时读取最新记录并展示诊断，允许携带原输入和新反馈重试。
- 文件保存在宿主数据目录 `design-generations/{designId}/{generationId}.json`。记录包含输入、模型设置、反馈、结构化正文、正文摘要、评审稿、PM 预览和诊断；重启后可读。各次尝试分别保存，输入修订仍为步骤 1 的 revision=1；SQLite 修订、状态冻结和评审决定属于步骤 3。

## 结构与校验

`design-schema.ts` 定义严格运行时 Schema 和对应 TypeScript 类型：目标、输入输出、模块及文件动作、接口及失败 / 副作用、数据规则、约束、质量观测、决策、假设、原始追踪和未决项。服务器将上游全局 / 逐需求约束及业务规则原文合入正文，保持原基线完整不变。

先校验 Schema，再检查：需求 / AC 原始引用和完整覆盖、模块归属一致性、NFR 适用模块的观测条件、需求依赖、模块依赖环、跨模块契约、文件路径及 create/modify/reuse 与所选提交的一致性、重叠写入、决策和假设的来源引用。无证据假设作为 warning 定位；它会阻止进入后续正式评审。阻断未决项、概念工程和演练基线也使 `reviewEligible=false`。

同一正文通过 `design-render.ts` 渲染评审稿和 PM Markdown。评审稿保留原始 ID、接口和完整追踪 JSON。PM 预览使用短编号并带原始编号，保留 AC 的 Given/When/Then 与验证证据。调用现有 `parseRequirementsMarkdown` 复核目标、模块、需求、AC、文件和模块需求引用；正式结构化 PM 交接仍在步骤 4–5 实现。

## 测试与样例

```powershell
# 仓库根目录；HTTP 测试需要本机回环连接
node --experimental-transform-types --test software-design/verify/design-input.test.ts software-design/verify/design-generation.test.ts requirements-engineering/verify/hama.test.ts

# workflow-orchestrator 目录
npm run typecheck
npm run build
$env:GIT_CONFIG_COUNT = '0'
npm run verify:gates
```

本次设计输入 / 生成 / HAMA 联调共 6 个测试通过；类型检查和生产构建通过。编排器 HTTP 全链路与编排 / 沙箱门禁通过，规划器门禁仍被已有模型配置与旧断言不一致阻断：`planner-and-validator.verify.ts:92` 期望 `deepseek-v4.1-flash`，实际为 `deepseek-flash`。本次未修改模型配置或该断言。Git 配置环境隔离原因见步骤 1 记录。

生成测试使用真实宿主 native-api 适配器访问本地 HTTP 模型夹具，核对所选模型、密钥传递、没有 tools、输入来源、反馈及上次诊断；不是调用真实在线模型的质量评估。覆盖 schema 错误、缺失 AC、悬空需求、NFR 缺口、危险路径、文件重叠、依赖环、缺失跨模块依赖、无效证据、无证据假设，以及持久化后重新装配读取。确认生成前后无工作流产生。

两份完整输入 / 草案记录：

- [新建 CLI](./step2-evidence/cli.json)：文件输入、标准输出、空白行语义、文件不存在时的失败行为、入口与计数逻辑分工、两条原始 AC。
- [已有服务改造](./step2-evidence/service.json)：在临时 Git 工程中已有 `src/service.ts` 上标记 modify，新建计数模块，保留跨模块契约和目标提交。

样例源基线是步骤 1 非校园测试夹具，并非真实用户批准；既有服务源码和目标提交由测试临时创建。重新生成样例：

```powershell
$env:DESIGN_GENERATION_EVIDENCE = Join-Path (Get-Location) 'software-design/verify/step2-evidence'
node --experimental-transform-types --test software-design/verify/design-generation.test.ts
Remove-Item Env:DESIGN_GENERATION_EVIDENCE
```
