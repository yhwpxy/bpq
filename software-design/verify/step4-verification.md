# 步骤 4 验证记录

## 实现与使用

确认设计后，在修订面板点击「查看结构化 PM 输入」，核对原始需求 / AC、模块、接口与依赖摘要、设计补充检查，然后导出 JSON。此操作仅投影指定确认快照，不调用模型、Markdown 解析器或 Planner，不创建工作流和交接记录。

纯函数 `projectConfirmedDesign(snapshot, expectedHash)` 位于 `src/pm-input.ts`。返回的 `goalSpec` 类型是 `Omit<GoalSpec, 'id' | 'workflowId' | 'updatedAt'>`，与现有 `WorkflowPlannerEngine.importStructuredRequirements` 第二参数一致。完整结果另含 designRef、独立 designChecks 及 moduleDependencies，供核对和步骤 5 交接关联使用。

接口：`GET /api/designs/{id}/revisions/{rev}/pm-input?expectedHash={contentSha256}`，沿用宿主 Bearer Token。正常返回 200；缺少或错误格式的摘要返回 400；未确认或摘要不匹配返回 409；快照来源 / 正文 / 确认决定 / 渲染稿不一致返回 422；修订不存在返回 404。读取历史确认修订不依赖当前最新修订状态，后续草案不会改变旧确认版输入。

## 映射保真

| 字段 | 规则 |
| --- | --- |
| designRef | 精确引用 designId、revision、contentSha256、workspaceId、sourceCommit |
| requirementsBaseline | 逐字段复制原基线 id、projectId、revision、sha256，并核对其与完整基线对象一致 |
| requirements | id、code 均使用原始需求 ID，保留 title / description；must → must，should / could → should；原优先级留在确认快照和确认稿 |
| acceptanceCriteria | 仅包含 HAMA 原始 AC；id、code 均为原始 AC ID，requirementId 指向所属原始需求，label 沿用 HAMA Given / When / Then 文本投影，verified=false |
| rawMarkdown | 完整、原样复制该修订 reviewMarkdown；不使用仅供预览的 pmMarkdown 重建身份映射 |
| title、goal、inputs、outputs、constraints、domainRules | 来自同一确认正文；constraints 与 dataRules 在保存修订时已合入上游约束及业务规则 |
| assumptions | 保留设计假设、设计非阻断未决项及 HAMA 未决项的文本和来源说明，使用不同 ID 前缀避免碰撞；已审正文中的假设标 doc，待确认事项标 suggested |
| modules | 保留名称、layer、具体目标文件和原始 requirementIds（含 NFR）；summary 包含模块 ID、职责、输入输出、依赖、接口双方、输入 / 结果 / 失败 / 副作用、文件动作、质量观测及补充检查 |

requirement.verifyHint 保留原始 AC 及本次设计的逐 AC 验证方法和预期证据；补充检查使用明确的独立来源标记。函数返回新的数组和对象，不修改确认快照。测试直接以 Planner 结构化参数类型检查输出，未调用 Planner 创建工作流。

## 设计补充检查

正文增加可选 `designChecks` 字段，旧正文没有此字段时保持原有表示、摘要和渲染稿不变。若在旧确认设计上增加或移除检查，必须追加修订并重新确认。新旧字段差异会显示检查的变更前后内容。

每条检查使用 `DC-…` 编号，并记录：

- `source: {kind, id}`：引用本修订真实 decision、interface 或 quality（quality 的 id 使用原始质量需求 ID）。
- `rationale、requirementIds、moduleIds、method、expectedEvidence`：检查原因、关联需求、适用模块、验证方法及预期证据。

运行时 Schema 和引用校验拒绝伪装为 AC 的编号、重复编号、未知来源、悬空需求 / 模块以及与来源不一致的需求和模块。生成提示词明确要求区分设计推导检查与原始验收。

检查写入确认评审稿，并在投影结果的独立 designChecks 中标记 `origin=design`、设计修订 / 摘要及 `verified=false`；模块摘要和相关需求的 verifyHint 同样标记其来源。它们不加入原始 acceptanceCriteria 集合，不改变任何 HAMA AC 的编号或语义。

## 模块依赖与边界

样例中入口模块 entry 依赖计数模块 counter，接口 count-file 记录提供方 / 消费方、输入、结果、读取失败语义及只读副作用。确认稿和映射后的双方模块摘要均保留该契约；依赖另外保存在 moduleDependencies 中。

下游 DesignSpecModule 没有依赖边字段，本次未为其扩展或伪造任务依赖。步骤 5 将同一结构化 goalSpec 交给现有 Planner；工作流任务及边仍由下游生成，交接关联表及 PM 回执在该步骤落地。

## 验证与样例

```powershell
# 仓库根目录；HTTP 测试需要允许本机回环连接
node --experimental-transform-types --test software-design/verify/design-input.test.ts software-design/verify/design-generation.test.ts software-design/verify/design-review.test.ts software-design/verify/pm-input.test.ts requirements-engineering/verify/hama.test.ts

# workflow-orchestrator 目录
npm run typecheck
npm run build
$env:GIT_CONFIG_COUNT = '0'
npm run verify:gates
```

本次 11 个设计 / HAMA 测试通过，类型检查和生产构建通过。编排器 HTTP 全链路和编排 / 沙箱门禁通过；规划器门禁仍在 `planner-and-validator.verify.ts:92` 因既有模型默认值 `deepseek-flash` 与旧断言 `deepseek-v4.1-flash` 不一致而失败，本次未修改该配置或断言。Git 环境隔离原因见步骤 1 记录。

`pm-input.test.ts` 逐项比较基线引用、原需求 / AC 集合和所属关系、三种原优先级及投影、标题 / 正文 / 文件范围、模块引用、接口及依赖。样例含一条需求两个 AC、模块关联多条需求、一个 could NFR 跨两个模块，以及三种来源的独立设计检查。另覆盖旧确认稿兼容、补充检查增删的修订差异、无效来源、错误摘要、缺少确认决定、篡改稿件、历史确认版重读、返回数组与源快照隔离。HTTP 读取前后工作流、修订、决定及交接表数量保持不变。

完整证据见 [step4-evidence.json](./step4-evidence.json)，包含 confirmedSnapshot 及对应 projection。基线与审批身份使用明确测试夹具，不代表真实用户审批；目标提交来自测试临时 Git 工程。重新生成：

```powershell
$env:DESIGN_PM_INPUT_EVIDENCE = Join-Path (Get-Location) 'software-design/verify/step4-evidence.json'
node --experimental-transform-types --test software-design/verify/pm-input.test.ts
Remove-Item Env:DESIGN_PM_INPUT_EVIDENCE
```
