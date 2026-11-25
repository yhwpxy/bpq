# 软件设计实施与上下游交接清单

本清单从接收 HAMA 已确认的 PRD 开始，到已实现的 PM Agent 接收本次 Design Spec 并返回可核对的报告为止。按步骤 1–6 实施，每项完成后在变更或测试记录中附证据。各项完成状态及验收证据见对应步骤；本地集成验收使用显式模型协议夹具和脚本化审批。

## 交接总表

| 交接双方 | 生产方交付 | 接收方当场核对 | 异常回到哪里 |
| --- | --- | --- | --- |
| HAMA → 软件设计 | 已发布基线、原始需求与 AC、范围及审批记录 | 基线 ID、版本、摘要、目标工程；逐项核对需求与 AC 归属 | 来源缺失回需求工程；工作区选错回项目选择 |
| 设计生成 → 设计评审 | 版本化草案、模块与接口、需求追踪、文件范围、未决项 | 实现是否遵守当前基线，验收是否可观察，评审对象是否为当前修订 | 技术问题在设计内返工；需求范围变化回 HAMA |
| 已确认设计 → 现有 PM Agent | 同一修订的完整 Design Spec 和结构化 GoalSpec、工作区与基线引用 | 返回的 goalSpec 保留原始编号及正文，pmReport 能定位同一工作流并列出本次模块 | 映射丢失回交接适配，设计缺陷回设计修订，下游编排诊断交编排器处理 |

## 1. 先接通 HAMA 已发布基线

**起点与交接产物**　需求工程已发布基线。完成本步后，设计服务拿到指定版本的需求事实和明确选定的目标工作区，可以独立于演示数据起草。

- [x] 在需求工程页的已发布基线旁接入“生成软件设计”。显式选择目标工程工作区并显示目标提交，向 `POST /api/designs` 提交 `baselineId、workspaceId、sourceCommit`。保留已有“导入下游编排”供原有调用方使用。点新入口只创建设计草案，创建工作流留到步骤 5。
- [x] 服务端按 ID 调用基线读取服务。核对 `ApprovedRequirementsBaseline` 的 schemaVersion、id、projectId、revision、sha256，读取 approvedPrd、approval、confirmation 及存在时的 conditionalApproval。绑定服务端读取的版本，避免页面切换项目后将旧 PRD 与新项目混用。
- [x] 读取 `prd.sections`、`prd.requirements` 和 `prd.trace`。保留 scopeKey、功能／非功能类别、原优先级、需求依赖、逐条约束，以及每条 AC 的原始 ID 和 Given/When/Then。试取一条 AC，沿需求和 trace 回查到来源议题及批准方案。
- [x] 按 workspaceId 解析工作区，在选定提交清点已有入口、依赖、测试命令和相对路径。新工程将拟新增路径单列；尚无提交的项目先记录概念设计，绑定初始提交后进入正式评审。演示基线可走演练，正式交接要求 live 基线及工程工作区。
- [x] 联调已发布基线、未知基线、源码版本不符和文档工作区四种输入。保存一份有效的“基线引用＋目标提交＋需求/AC 清单”，并确认失败响应能指出需要修正的输入。

实施证据见[步骤 1 验证记录](./verify/step1-verification.md)和[有效输入样例](./verify/step1-evidence.json)。当前草案保存输入快照，正文生成在步骤 2 接入。

接入依据见 [HAMA 契约](../requirements-engineering/src/contracts.ts)、[基线读取与既有交接](../requirements-engineering/src/service.ts) 和 [需求工程页](../workflow-orchestrator/renderer/src/views/RequirementsView.tsx)。

## 2. 定义设计工件并实现草案生成

**依赖与产物**　使用步骤 1 的基线与工程清单，产出同一修订的结构化正文、评审稿和 PM 导入预览。

- [x] 在 software-design 中定义设计输入与输出类型及运行时 schema。正文包含目标、输入输出、模块、接口、适用的数据与质量约束、决策、假设、追踪和未决事项。对每个模块记录名称、层、职责、目标文件和原始需求引用；对跨模块接口记录提供方、消费方、输入、结果与失败语义。
- [x] 在宿主 runtime 装配设计服务。参考 HAMA 的无工具文本调用，向 Design Agent 传入本项目的基线、源码清单、选定的模型和本修订的反馈。检查生成请求的数据来源，确保校园演示、账本预设等示例仅由演练或测试显式加载。
- [x] 从每条获批需求的触发条件和可观察结果推导变化点，再按实际职责划分模块。已有工程指出复用或修改的入口，新工程标明拟建工件。仅有命令行或函数接口的项目也应能生成完整草案。
- [x] 对模型返回先校验 schema，再校验引用。逐项检查 FR/NFR 实现归属、AC 验证方法、跨模块依赖、相对路径和重叠写入责任。将悬空 ID、缺少证据的假设和未覆盖的 AC 定位到具体条目；对生成失败记录诊断，允许用原基线与反馈重试。
- [x] 从同一结构化正文渲染评审稿和 Markdown 预览。使用现有解析器检查预览的目标、模块、需求、AC 与文件范围；对照评审稿检查结构化原始编号。以新建命令行工具和已有服务改造各跑一次，保存输入与草案供评审联调。

实施证据见[步骤 2 验证记录](./verify/step2-verification.md)，包含新建 CLI 和已有服务改造两份完整输入与草案。

编写结构见[通用模板](./design-spec-template.md)，调用与解析参考 [HAMA Agent](../requirements-engineering/src/agents.ts)、[宿主装配](../workflow-orchestrator/src/server/runtime.ts) 和 [Markdown 解析器](../workflow-orchestrator/src/core/spec-parser.ts)。

## 3. 实现可恢复的评审与确认

**依赖与产物**　使用步骤 2 的草案。在此阶段完成设计确认，产物是可按 designId、revision 和 contentSha256 精确读取的快照。

- [x] 在宿主 SQLite 中加入 design_revisions、design_decisions、design_handoffs。按设计说明建立修订主键、决定引用和交接唯一键。以相同正文重复计算摘要，核对结果一致；改变来源、目标版本或正文后摘要应变化。
- [x] 接入草案创建、修订读取、提交评审和新增修订端点。工作台显示基线与目标提交、需求到模块/AC 的追踪、未决事项和前后版差异。重启服务后重新打开指定修订，核对草案和决定记录。
- [x] 实现 draft → in_review → confirmed，以及 in_review → changes_requested → 新修订 draft。确认请求携带 expectedHash、actor 和结论，在同一事务内检查状态、写决定并冻结正文。测试两位评审人针对同一旧摘要提交冲突决定，后一次应看到冲突及当前版本。
- [x] 演练两类退回。技术方案问题在同一基线下追加设计修订；若反馈改变用户目标或通过标准，返回 HAMA，发布新基线，再对比稳定需求及 AC 并启动对应设计。两条路径都应能回读历史正文、意见和处理结果。

实施证据见[步骤 3 验证记录](./verify/step3-verification.md)及[两类退回与确认快照样例](./verify/step3-evidence.json)。

端点、数据字段与响应条件见[子系统设计说明](./subsystem-design.md)。

## 4. 把确认设计投影为 PM 输入

**依赖与产物**　按步骤 3 的快照构造结构化 GoalSpec。先验证纯映射，再在步骤 5 创建工作流。在此处使用 [Planner 的结构化入口](../workflow-orchestrator/src/engines/planner.ts)和[下游契约](../workflow-orchestrator/src/shared/types.ts)。

| 来源 | GoalSpec 或关联记录 | 必须验证的对应关系 |
| --- | --- | --- |
| 上游基线 | requirementsBaseline | id、projectId、revision、sha256 与步骤 1 完全一致 |
| PRD 需求及验收 | requirements、acceptanceCriteria | 需求 id 和 code 均取原 r.id；AC id 和 code 均取原 a.id，requirementId 指向所属需求。保留验收语义，初始 verified=false |
| 已确认设计正文 | rawMarkdown、title、goal、inputs、outputs、constraints、domainRules、assumptions、modules | rawMarkdown 保存完整确认稿；模块 summary 概括主要契约与依赖，artifacts 明确目标路径，relatedFrCodes 指向原需求 code（含 NFR） |
| 设计修订与交接 | design_handoffs | 从返回的 workflowId 可定位同一工作区中的 designId、revision 及摘要，再查到 pmReport.id |

- [x] 在映射测试中逐个比较 ID 与集合，覆盖一条需求有多个 AC、一个模块关联多个需求及一条 NFR 跨模块的情形。沿用现有投影将 must 保留为 must、should/could 映为 should，设计快照保留原优先级。
- [x] 为设计补充检查记录其来源与关联需求，确保与 HAMA 原始 AC 可区分。Markdown 短编号仅供人工预览和手工导入；新正式路径直接传结构化对象，以保留原始 ID 和 AC.requirementId。
- [x] 准备一对有依赖的模块，核对跨模块契约及依赖出现在确认稿和模块摘要中。PM 的模块类型没有依赖边字段，设计依赖保留在输入中；工作流任务和依赖边由下游编排器生成。

实施证据见[步骤 4 验证记录](./verify/step4-verification.md)及[确认快照与 PM 输入样例](./verify/step4-evidence.json)。本步只投影并展示输入，创建工作流和交接回执在步骤 5 实现。

## 5. 原子交接并打开正确的工作流

- [x] 接入 `POST /api/designs/{id}/revisions/{rev}/handoff`。校验 expectedHash、确认状态、基线模式与目标工作区。对首次交接复核目标提交；若源码已变，展示受影响范围并转回设计复核。成功交接后的网络重试应能找回原工作流。
- [x] 以 (designId, revision, workspaceId) 去重，使 Planner 的工作流、GoalSpec、PM 报告、图、校验结果与交接关联同时提交；在提交成功后广播更新。注入一次落库失败，确认可重试且没有遗留半套工件；并发提交两次只形成一个 workflowId。
- [x] 首次成功响应返回 201，重复成功请求返回 200 及同一 workflowId。前端用该 ID 打开工作流详情，展示 PM 报告、图和校验状态。若图有阻断问题，保留 draft 和具体诊断，交接记录可用于定位原设计。
- [x] 确认返回的 pmReport 非空且 pmReport.workflowId 等于 workflow.id；比对 detectedModules 和提交的模块，核对 slices 中的需求引用及文件覆盖。记录 pmReport.id。缺失报告或输入错配时标记交接待核查，按原键查询，避免再次创建工作流。

实施证据见[步骤 5 验证记录](./verify/step5-verification.md)及[确认设计、PM 回执与源码冲突样例](./verify/step5-evidence.json)。

改动涉及 [HTTP 路由](../workflow-orchestrator/src/server/http-router.ts)、[Planner 保存与广播](../workflow-orchestrator/src/engines/planner.ts)、[PM 分解](../workflow-orchestrator/src/core/pm-planner.ts) 和[工作台客户端](../workflow-orchestrator/renderer/src/api/client.ts)。

## 6. 验收 PRD 转换与 PM 签收

- [x] **转换质量。** 选一项非校园需求，例如统计文件非空行数。对照原始 PRD，检查 Design Spec 新增了文件与标准输出契约、空白行判定方式、文件不存在时的退出行为、目标模块和可观察的验收方法。未确定的语义列为待确认项，原始 AC 可逐条回查。
- [x] **跨项目。** 校园演示用来检查交互与容量约束，账本测试基线用来检查分录及汇率契约。用同一设计服务处理不同输入，保存各自的草案和覆盖表。正式交接联调用已发布的 live 基线。
- [x] **真实交接。** 从一份已确认的非校园 PRD 生成、评审并冻结 Design Spec，调用现有 Planner 结构化入口。比较返回的 goalSpec.rawMarkdown 与本次确认稿，在 PM 报告中反查一个模块的原始需求和文件范围。并发或超时重试应取回同一个 workflowId 和报告。
- [x] **修订隔离。** 修改一项已批准需求，发布新 PRD 版本并形成新设计修订或系列。并排读取两次确认稿及对应交接结果，核对变更项有来源、旧确认稿仍可复现。
- [x] **回归。** 在仓库根目录运行 `node --experimental-transform-types --test requirements-engineering/verify/hama.test.ts`，在 workflow-orchestrator 目录运行 `npm run typecheck` 和 `npm run verify:gates`。另覆盖新增的转换、版本冲突、字段保真及幂等交接用例。

实施证据见[步骤 6 验收记录](./verify/step6-verification.md)、[机器可读汇总](./verify/step6-evidence/summary.json)及以下交接总表。全部 14 项测试、类型检查、生产构建和三个编排器门禁通过。

| 项目 / PRD 基线版本与摘要 | 工作区 / 目标提交 | Design Spec 修订与摘要 | workflow.id / pmReport.id | 抽查的原始需求与 AC / PM 模块 / 结果 |
| --- | --- | --- | --- | --- |
| counter-v1 · acceptance-counter<br>baseline-run-8d4b1432 / v1<br>1ac6e5d59f2d18b4cbb997c8b440158e2e5ebf7c6ed8cc5f5cb14e268fc12757 | ws-88011696<br>4ee2cce7f1b53fc0004d1dd322c3533ea4bd1fae | design-d18a7274-6419-44ce-ae20-691ad28d35bc / v1<br>4505125e3d9b281e8c5259e1521de33fd2475007948ac107dbb41faf4d868074 | wf-ed9c79c7<br>pm-6e9a047b | FR-75b955fe0e1a99fbbb8f<br>AC-87b89be3d72b4d847e19<br>entry / src/cli.ts / P2.T1<br>received；[完整证据](./verify/step6-evidence/counter-v1.json) |
| ledger · acceptance-ledger<br>baseline-run-5c1edfe7 / v1<br>7bfa76e7872ad64cc4cb3e95ab7d5bf427a3d47a8e875d53001407fdee62ad71 | ws-6fd6d856<br>cad45dde810aefd49627451c5854b12ca1d6a016 | design-a5f1d7f0-7572-4d38-b5c5-6c5ad43d4530 / v1<br>6dee9a207cee968687b8d2cb5081956197b3e1575f9e74631e1e3785957503d0 | wf-f7631008<br>pm-91641362 | FR-4da5a603dfd62de7ae18<br>AC-d69b70f80aa98064a5df<br>entry / src/journal-api.ts / P2.T1<br>received；[完整证据](./verify/step6-evidence/ledger.json) |
| campus-demo · acceptance-campus<br>baseline-run-8becd703 / v1<br>1d9ed1bbf4b5cab718f21ca9dc86b164609967a6ec6f3c6e5f4fe6bd88fa0173 | ws-080d15a7<br>62852e9f6f71de8a3e948a7466c9be694bedf35c | design-c0d7ddde-3751-4354-8f10-c8fa0ce396a7 / v1<br>5f85ad1e5d0a8e3a67191d14a53836a1277d18e6da782032aabde3b1974d60d6 | 演练，不创建工作流<br>无 PM 回执 | FR-e9c0c1e97f4001b50b8d<br>AC-751562f2dc980d63c9e2<br>entry / src/registration-view.tsx / 演练草案<br>demo_draft_only；[完整证据](./verify/step6-evidence/campus-demo.json) |
| counter-v2 · acceptance-counter<br>baseline-run-bacc14cc / v2<br>3a738516324ef9961e9bf34dee9950d1ffd9ca07887748a2d53c0dd2f7d3ac00 | ws-88011696<br>4ee2cce7f1b53fc0004d1dd322c3533ea4bd1fae | design-c11544b2-6c6e-405c-ac5b-28b3ff75731f / v1<br>412e31a09f1fe5a52489c3eae10b169fc2162e258c7ad5e31ff98a868455eeb0 | wf-9e5d5b2a<br>pm-87c81588 | FR-75b955fe0e1a99fbbb8f<br>AC-87b89be3d72b4d847e19<br>entry / src/cli.ts / P2.T1<br>received；[完整证据](./verify/step6-evidence/counter-v2.json) |
