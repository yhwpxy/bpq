# 步骤 5 验证记录

## 页面与接口

在确认修订的评审面板点击「交接 PM 并打开工作流」。目标工作区和提交取自该确认修订，服务核对摘要及来源后调用仓库现有 Planner 的结构化入口。收到已核对回执后，页面用返回的 workflowId 打开工作流详情；详情页显示设计修订 / 摘要、原始 PM 报告编号及报告，现有图和校验页继续展示本次编排结果。

| 接口 | 行为 |
| --- | --- |
| POST /api/designs/{id}/revisions/{rev}/handoff | 请求 `{workspaceId, expectedHash}`。首次创建返回 201，重复请求返回 200 与同一工作流及原始回执 |
| GET /api/designs/{id}/revisions/{rev}/handoff?workspaceId=…&expectedHash=… | 按原唯一键查询交接；未交接返回 404。待核查记录会重新核对原工作流，不重新导入 |
| GET /api/workflows/{workflowId}/design-handoff | 从工作流反查设计修订、摘要、目标提交与原始 pmReportId |

未确认或摘要 / 工作区不匹配返回 409；文档工作区及无效正式输入返回 422，参数无效返回 400。校验复用步骤 4 的确认快照投影，必须是 live 基线、同一修订的确认决定和完整工程提交。来源引用、原始需求 / AC 及完整确认稿保持不变。

## 首次交接的源码复核

首次交接前后分别核对目标工作区当前 HEAD 与确认提交。若发生变化，返回 409 和 `route=design_review`、expectedCommit、currentCommit、changedPaths、affectedModules、requiresNewRevision。文件范围包含 Git 提交差异；模块范围按目标文件、构建 / 依赖清单及声明的模块依赖分析。无法读取旧提交时标记 complete=false 并保守列出全部模块；其他未定位改动仍需人工复核。

失败不会改变原确认稿或创建工作流。用户应新增设计修订、绑定当前提交并重新评审。已成功交接的重试先读取原交接记录，目标源码后续变化不妨碍找回原工作流。本流程按 Git 提交复核，不将未提交文件混入确认版本；Git 与 SQLite 并非同一事务，交接前和 Planner 保存后各进行一次提交核对。

## 原子性与幂等

`src/handoff.ts` 的 DesignHandoffService 在宿主同一 SQLite 连接中开启 `BEGIN IMMEDIATE`，先按 `(design_id, revision, workspace_id)` 查重。首次交接将现有 Planner 的保存点置于该事务内，使工作流、GoalSpec、PM 报告、节点 / 边、校验报告、审计及交接关联一起提交或一起回滚。

Planner 的 `importStructuredRequirements` 新增可选 deferBroadcast 回调，允许外层事务收集通知，COMMIT 成功后才尝试发布。原 HAMA 和手工导入调用保留默认行为。落库失败不会产生指向未提交工作流的通知。通知失败不能撤销已提交结果，客户端可按原键查询。

在原 design_handoffs 主键及外键之上增加兼容迁移列：content_sha256、pm_report_id、status、diagnostics_json、receipt_json。交接身份、工作流关联及已签收回执由触发器保护，不允许删除关联或改写已签收回执。

收到的首次回执以完整 WorkflowDetailSnapshot 保存，绑定设计修订及 PM 报告编号。后续工作流编辑不会改写原始签收记录；详情页的实时工作流状态与原始交接报告可分别核对。服务重启后依然可按原键找回结果。

## PM 签收与待核查

`verifyPmReceipt` 检查：

- workflow.id、workspaceId、goalSpec.workflowId 属于本次交接。
- 去除 Planner 分配的 id / workflowId / updatedAt 后，GoalSpec 与本次结构化输入逐字段一致。
- PM 报告非空、编号存在、pmReport.workflowId 等于工作流 ID；detectedModules 与提交模块一致。
- slices 的原始需求引用有效且覆盖全部 FR / NFR，文件范围在确认设计内，模块文件及其关联需求由切片共同覆盖。
- 图及校验回执绑定同一工作流。

通过核对后 status=received；缺少报告、输入错配或覆盖异常时 status=pending_review，仍保存原 workflowId 和具体诊断。重复提交或查询均读取原键，查询待核查记录时重新检查原工作流，报告恢复后可转为 received。页面遇到提交响应丢失或服务器错误时，先查询原键；待核查时提供查询和打开原工作流入口，不再次创建工作流。

图的阻断校验与 PM 输入签收分别记录。图存在错误时保留 draft、完整 PM 报告及校验诊断，交接不会将其标成可执行版本或启动执行。

## 验证与证据

```powershell
# 仓库根目录；需要本机回环连接
node --experimental-transform-types --test software-design/verify/design-input.test.ts software-design/verify/design-generation.test.ts software-design/verify/design-review.test.ts software-design/verify/pm-input.test.ts software-design/verify/handoff.test.ts requirements-engineering/verify/hama.test.ts

# workflow-orchestrator 目录
npm run typecheck
npm run build
$env:GIT_CONFIG_COUNT = '0'
npm run verify:gates
```

本次设计 / HAMA 共 13 个测试通过，类型检查与生产构建通过。编排器 HTTP 全链路及编排 / 沙箱门禁通过；规划器门禁仍在 `planner-and-validator.verify.ts:92` 因既有默认模型 `deepseek-flash` 与旧断言 `deepseek-v4.1-flash` 不一致而失败，本次未修改该配置或断言。Git 环境隔离原因见步骤 1 记录。

`handoff.test.ts` 使用真实 Planner、SQLite 及 HTTP，覆盖以下场景：

- 注入交接关联落库失败，比较工作流、规格、PM 报告、图、校验、审计及关联表，确认全部回滚且无通知；解除故障后可重试。
- 并发提交两次只生成一个 workflowId，响应为 201 / 200；广播回调通过独立只读 SQLite 连接确认关联和报告已经可见。
- COMMIT 后中断客户端响应，再按原键查询及重试，找到原工作流。
- 新交接遇到源码提交变化返回影响范围；已交接记录在源码变化和完整宿主重启后仍可重读。
- 验证缺少 PM 报告及错误 GoalSpec 会保留待核查记录；查询恢复到相同 workflowId，导入次数不增加。
- 验证模块、报告归属及切片覆盖异常可被定位；图有阻断时仍保留 draft 及诊断。
- 下游编辑 GoalSpec 后，原始 PM 签收回执保持不变。

完整样例见 [step5-evidence.json](./step5-evidence.json)，包含确认快照、真实 Planner 回执及一次源码冲突响应。基线和审批身份来自明确的非校园测试夹具，目标工程来自临时 Git 仓库；这验证了真实 Planner 的持久化交接，不代表在线模型生成质量或真实用户批准。第 6 部分的完整跨项目验收另行执行。

重新生成证据：

```powershell
$env:DESIGN_HANDOFF_EVIDENCE = Join-Path (Get-Location) 'software-design/verify/step5-evidence.json'
node --experimental-transform-types --test software-design/verify/handoff.test.ts
Remove-Item Env:DESIGN_HANDOFF_EVIDENCE
```
