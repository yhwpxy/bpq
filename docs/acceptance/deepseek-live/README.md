# DeepSeek 真实模型验证（2026-11-25）

## 结果与边界

最终代码的一次独立运行从中文 Idea 发布到需求基线，全程为 `mode: live`，使用 DeepSeek 官方 API、`deepseek-flash`、默认五个讨论角色。没有服务重启、失败节点重试、演示响应替代或直接修改数据库状态。人工节点通过与界面相同的已鉴权 HTTP 接口提交，含澄清、附条件批准、明确授权解除条件及最终确认。未使用 GUI 或截图。

- Run：`run-0aae0dcf`，状态 `succeeded`，16 个节点全部 `succeeded`，失败执行尝试为 0。
- 时间：2026-11-25 17:58:36–18:06:24（UTC+8）。
- 输入：个人物品计数器，显示件数、加一、减一、清零确认，0–9999 边界，刷新归零。
- 基线：`baseline-run-0aae0dcf`，v1，mode `live`。
- SHA-256：`c681fec8f48e11356a2a33d2d52d32a4754552abd6a9656148634014c6b56a61`，已重新计算验证。
- 5 个议题全部为模型 `resolved`：显示议题 2 轮，其余各 1 轮。没有人工代替模型裁决议题。
- 79 次 API 请求的适配器 outcome 均为 `completed`。
- 本地校验：75 次 `completed`，4 次 `invalid_output`，4 次均在下一次自动重试成功；最高 retry=1（0 表示首次）。**不是零重试，不是每条模型输出都首次符合 Schema；没有三次尝试耗尽或节点失败。**
- 操作次数（包含自动重试）：intake 2、dependencies 1、agenda 1、propose 30、critique 30、refine 7、integrate 2、evaluate 5、prd 1。
- API usage 合计：输入 486285 tokens，输出 52050 tokens。宿主运行摘要的 token/费用仍为 0，故不以该摘要作计量依据，也未在本任务中扩展费用记账。

`evidence.json` 保存逐请求时间、角色、操作、议题、API outcome、本地校验 outcome、重试序号、错误反馈和原始正文哈希，以及人工决定、节点状态及基线摘要。`PRD.md` 由现有渲染器直接导出，未手工重写。实现后的计数器应用验收仍是下游工作，这次完成的是 HAMA 需求流程。

## 真实复现到的根因

1. `propose` 把需求、问题、工件、人工决定 ID 当成 sources。原提示只说“说明来源”，而本地验证只认可原始输入资料 ID。真实读书清单诊断运行 `run-e4e42cdc` 的 product 连续三次失败；最终输出含 `int-...`。补充允许列表与具体无效值后，模型可按原契约纠正。
2. `agenda` 另造跨角色冲突议题与浏览器兼容议题，没有逐一对应原始基础需求。原指令“安排适当的焦点”可能被解释为新增议题。明确每条基础需求恰好一项，并把跨角色焦点写到已有议题内。
3. `critique` 偶尔引用自己的角色，`dependencies/refine` 偶尔引用问题 ID 作为依赖端点。保留规则，反馈合法角色或需求 ID，禁止自我质疑。已新增对应模拟 API 回归。
4. 实测返回过多个相邻 JSON 对象及数组结尾多余引号。原适配器未请求 JSON 输出模式；现在 HAMA 的 DeepSeek 调用显式请求 `json_object`。本地 JSON/Schema 校验和最多三次重试保留；官方 JSON 模式也不能替代本地校验。
5. `agents.ts` 吞掉具体校验错误，只显示 `invalid_output`。现在失败消息携带最后一次校验原因。
6. 全局整合曾把已人工裁决事项重新列为未决，导致重复业务返工。明确共识和整合以同一事项的最新人工决定为准，并要求简洁中文、只讨论当前议题、避免不必要实现细节。

不是本次已证实根因的项目：能力探测返回 ready；凭据请求成功；适配器原本就不把 reasoning_content 拼进 finalText，也没有发送 frequency_penalty/presence_penalty。未发现需要扩大 60 秒或 8000 token 的证据，因此保持原设置。旧 `deepseek-chat` 的最小请求实测被映射为 `deepseek-flash`；当前模型依据官方 `/models` 选择。

较早的读书清单诊断运行曾因模型内容与历史决定冲突产生多轮业务返工；它不作为全流程成功证据，最终在人工等待点正式结束并保留记录。成功证据只取上述最终代码下新建的计数器运行。

## 改动与契约

- `requirements-engineering/src/agents.ts`：明确 ID 引用范围、最新人工决定优先、简洁中文，DeepSeek 请求 JSON 输出，保留失败详情。
- `requirements-engineering/src/pipeline.ts`：添加输入上下文 allowedSourceIds；校验错误附无效值与允许值，不改变判定条件。
- `workflow-orchestrator/src/adapters/contracts.ts` / `native-api.ts`：内部可选 responseFormat；只有显式请求时传递 response_format，不改变其他调用默认行为。
- `requirements-engineering/verify/hama.test.ts`：新增 agenda、critique、schema、source、JSON、纠错恢复六个子测试；检查 DeepSeek 无工具、JSON 模式、关闭思考、无惩罚参数，确认 reasoning_content 不影响正文解析，以及其他提供商不被强制 JSON 模式。
- `requirements-engineering/README.md`：DeepSeek 配置与排障说明。
- `docs/reference-manifest.json` / `scripts/verify-reference.mjs`：保留原始参照文件哈希；另登记 6 个授权修改文件的精确新哈希及原因。未把目标修复冒充上游原文，未关闭其他文件校验。

参照仓库 main=472cd7a5891a1a1bd22247a53197c78dc637d452，tracked 文件未改动。HAMA 的 `contracts.ts`、`schema.ts`、`demo.ts`、`markdown.ts` 及需求前端页面与参照逐字相同。公开 HTTP API 和 SQLite Schema 不变。输出保留原项目的 Idea Brief、角色提案/交叉质疑、共识、候选范围、四维评价、Given/When/Then 验收和追踪结构。

## 验证

- `npm run check`：通过。包含参照文件检查、typecheck、build、宿主三组 verify，以及 HAMA/软件设计合计 21 项测试。完整日志见 `checks.txt`。
- 演示模式完整发布、重启恢复、人工审批与版本不可变测试：通过。
- `npm run verify:parity -- ../SE-TeamPrjoect`：65 个 SQLite 结构对象、60 个路由探测、每个应用 59 个鉴权检查以及 SSE connected 帧匹配；见 `parity-results.json`。空参数路由一致性不等同于全部业务行为相同，业务路径另由测试与真实运行覆盖。
- 构建仅出现已有的大于 500KB 前端 chunk 提醒，没有编译错误。

## 复验与配置

详见 `requirements-engineering/README.md` 的“配置 DeepSeek 真实模型”。Base URL `https://api.deepseek.com/v1`，provider `deepseek`，model `deepseek-flash`。根目录 `.env` 仅本地写 `DEEPSEEK_API_KEY=自己的密钥`，不要提交。

从根目录执行 `npm run setup`、`npm run build`、`npm run start:web`。在“基础设施与模型池 → 能力与模型接入 → 模型供应与密钥保险库”配置 DeepSeek，或使用已加载的 `.env`。在“需求工程”选择真实模型、DeepSeek、deepseek-flash，输入中文 Idea，正常完成各人工关口。可直接复用 evidence.json 中的 input 创建新项目 ID；模型输出具有随机性，重试次数与讨论轮次不保证与本次相同。

官方依据（本次实际读取）：
- https://api-docs.deepseek.com/quick_start/pricing
- https://api-docs.deepseek.com/guides/thinking_mode
- https://api-docs.deepseek.com/guides/json_mode
