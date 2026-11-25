# API、SSE 与状态契约

参考及当前入口均为 `workflow-orchestrator/src/server/http-router.ts`，业务代码逐字节一致。路由清单从该文件提取，共 60 个方法/路径组合；`docs/api-routes.json` 保存入口行号。动态参数中的 `:id` 按路径分别表示 designId、workflowId、runId、gateId、workspaceId、nodeId、capabilityId、providerId 或 sessionId；`:revision` 为正整数。

## 通用规则

- 生产 API 与页面共用回环服务；`/api/health` 不要求鉴权，其余业务 API 使用 `Authorization: Bearer <本次宿主令牌>`。SSE 支持 `?token=`。没有用户名密码登录或用户表。
- JSON 请求使用 `Content-Type: application/json`。领域错误返回 `{code,error,details?}`；未知 API 返回 404，鉴权失败返回 401。
- 参考路由对不存在对象或不完整输入可能返回 400、404、409、422 或 500，按各业务处理器保留。本次没有统一改写错误语义。
- 下表列出字段/DTO 与返回值；`?` 表示可选。嵌套字段、长度约束、枚举的完整权威定义位于表后的契约索引。

## HTTP 路由

| 方法与路径 | 请求体/查询参数 | 成功返回 |
| --- | --- | --- |
| GET `/api/health` | 无 | 200 `{ok,version}` |
| GET `/api/events` | Bearer 或 `token` 查询参数 | 200 SSE 流 |
| GET `/api/bootstrap` | 无 | 200 `BootstrapSnapshot` |
| POST `/api/workspaces` | name,rootPath,defaultBranch?,verifyCommand?,description? | 201 `{workspace}` |
| POST `/api/workflows/import-requirements` | `ImportRequirementsRequest`；或 baselineId,workspaceId | 201 `WorkflowDetailSnapshot` |
| GET `/api/workflows/:id` | workflowId | 200 `WorkflowDetailSnapshot` |
| GET `/api/workflows/:id/export` | workflowId | 200 `{workflowId,code,title,markdown,mermaid,json}` |
| POST `/api/workflows/:id/review-anchor` | 无 | 200 `{workflow,capsule}` |
| POST `/api/workflows/:id/spec` | `UpdateGoalSpecRequest` | 200 `WorkflowDetailSnapshot` |
| POST `/api/workflows/:id/draft-graph` | nodePatches?,addNodes?,removeNodeIds?,addEdges?,removeEdgeIds? | 200 `WorkflowDetailSnapshot` |
| POST `/api/workflows/:id/replan` | 无 | 200 `WorkflowDetailSnapshot` |
| POST `/api/workflows/:id/trial` | 无 | 200 `WorkflowDetailSnapshot`，含 latestTrial |
| POST `/api/workflows/:id/confirm-version` | label?,frozenBy? | 201 `{version,workflow}` |
| POST `/api/runs` | workflowId,versionId?,title?,permissionTier? | 201 `RunDetailSnapshot`，含 liveLogs |
| GET `/api/runs/:id` | runId | 200 `RunDetailSnapshot` |
| POST `/api/runs/:id/pause` | 无 | 200 `RunDetailSnapshot` |
| POST `/api/runs/:id/resume` | 无 | 200 `RunDetailSnapshot` |
| POST `/api/runs/:id/cancel` | 无 | 200 `RunDetailSnapshot` |
| POST `/api/runs/:id/retry-node` | nodeId | 200 `RunDetailSnapshot` |
| POST `/api/runs/:id/ghost-node` | title,description?,executorKind?,capabilityId?,gateCommand?,insertBeforeNodeId? | 200 `RunDetailSnapshot` |
| POST `/api/runs/:id/restore` | checkpointId | 200 `RunDetailSnapshot` |
| POST `/api/nodes/:id/collapse` | collapsed? | 200 `{node}` |
| POST `/api/interventions/:id/resolve` | resolution,action?（approve/reject/override） | 200 `RunDetailSnapshot` |
| POST `/api/capabilities` | manifest（`CapabilityAdapterManifest`，或直接提交 manifest 字段） | 201 `{capabilities,capabilityHealth}` |
| POST `/api/capabilities/:id/probe` | 无 | 200 `{probe,capabilities,capabilityHealth}` |
| POST `/api/capabilities/:id/toggle` | enabled? | 200 `{capabilities,capabilityHealth}` |
| POST `/api/providers/:id/secret` | apiKey?,baseUrl? | 200 `{modelProviders}`（密钥状态，非明文） |
| GET `/api/sessions/:id` | sessionId | 200 `{session,messages}` |
| GET `/api/evidence/search` | `q` | 200 `{hits}` |
| GET `/api/ddd-terms` | workspaceId? | 200 `{domainTerms}` |
| POST `/api/ddd-terms` | id?,workspaceId?,boundedContext,canonicalTerm,localLabel?,definition?,forbiddenAliases? | 200 `{term,domainTerms}` |
| POST `/api/ddd-terms/:id/delete` | 无 | 200 `{domainTerms}` |
| GET `/api/skills` | 无 | 200 `{skills}` |
| POST `/api/skills` | id?,slug,title,category?,content | 200 `{skill,skills}` |
| POST `/api/dream/consolidate` | 无 | 200 知识整合结果及 skills |
| GET `/api/mcp-servers` | 无 | 200 `{mcpServers}` |
| POST `/api/mcp-servers` | id?,name,transport?,endpointOrCommand,description?,enabled?,toolsCount? | 200 `{mcpServer,mcpServers}` |
| POST `/api/mcp-servers/:id/probe` | 无 | 200 `{mcpServer,mcpServers}` |
| POST `/api/constitution` | markdown,blockedCommands? | 200 `{constitution}` |
| POST `/api/doctor` | 无 | 200 `{gitReady,gitVersion,nodeVersion,capabilityHealth,prunedWorktrees,checkedAt}` |
| GET `/api/hama/runs` | 无 | 200 `RunSummary[]` |
| POST `/api/hama/runs` | `StartInput` | 201 `RunView` |
| GET `/api/hama/runs/:id` | runId | 200 `RunView` |
| POST `/api/hama/runs/:id/gates/:id` | `DecisionInput` | 200 `RunView` |
| GET `/api/hama/baselines` | projectId | 200 项目基线列表 |
| GET `/api/hama/baselines/:id` | baselineId | 200 `ApprovedRequirementsBaseline` |
| GET `/api/design-workspaces/:id` | workspaceId | 200 `WorkspaceInventory` |
| POST `/api/designs` | baselineId,workspaceId,sourceCommit（string/null） | 201 `DesignInputDraft` |
| GET `/api/designs` | baselineId? | 200 设计最新修订列表 |
| GET `/api/designs/:id` | designId | 200 `DesignInputDraft` |
| POST `/api/designs/:id/generate` | expectedHash,providerId,model,feedback | 201 `DesignGeneration` |
| GET `/api/designs/:id/generations` | designId | 200 `DesignGeneration[]` |
| GET `/api/designs/:id/revisions` | designId | 200 `DesignRevision[]` |
| POST `/api/designs/:id/revisions` | 首次：generationId,actor,reason,previousDesign?；后续：parentRevision,expectedHash,actor,reason,resolutions?,body 或 providerId/model/feedback，sourceCommit? | 201 `DesignRevision` |
| GET `/api/designs/:id/revisions/:revision` | designId,revision | 200 `DesignRevision` |
| POST `/api/designs/:id/revisions/:revision/review` | expectedHash,actor,action,scope,findings | 200 `DesignRevision` |
| GET `/api/designs/:id/revisions/:revision/pm-input` | expectedHash | 200 `DesignPmInput` |
| POST `/api/designs/:id/revisions/:revision/handoff` | workspaceId,expectedHash | 首次 201，重复 200 `DesignHandoffReceipt` |
| GET `/api/designs/:id/revisions/:revision/handoff` | workspaceId,expectedHash | 200 `DesignHandoffReceipt` |
| GET `/api/workflows/:id/design-handoff` | workflowId | 200 设计交接回执或 null |

## 完整嵌套契约索引

- `workflow-orchestrator/src/shared/api.ts`：BootstrapSnapshot、WorkflowDetailSnapshot、RunDetailSnapshot、导入、修改图、锁版、运行、能力与令牌 DTO。
- `workflow-orchestrator/src/shared/types.ts`：GoalSpec、需求/AC、GraphNode/Edge、Workspace、Workflow/Version/Run、Attempt、Checkpoint、Intervention、Capability、Provider、Session、Audit、术语、Skills、MCP、规则、成本和认知状态。
- `requirements-engineering/src/contracts.ts`：StartInput 的 projectId/title/ideas/background/problem/goals/constraints/preferences/documents/mode/providerId/model/roles/maxDiscussionRounds/maxRevisions/parentBaselineId；DecisionInput 的 targetId/targetHash/actor/action/feedback/scope/issueIds；所有中间工件、PRD、追踪和基线。
- `requirements-engineering/src/schema.ts`：字段长度、数组上下限、枚举与 ID 校验。
- `software-design/src/contracts.ts`：设计输入与工程清单。
- `software-design/src/design-schema.ts`：GenerationRequest、DesignBody、模块、接口、数据规则、质量约束、追踪与设计补充检查。
- `software-design/src/reviews.ts`：评审请求、DesignRevision、修订采纳/返工校验与历史决定。
- `software-design/src/pm-input.ts` 与 `handoff.ts`：结构化 PM 输入、原需求/AC 编号、设计引用和签收回执。

以上文件在两个仓库中路径和内容均相同，字段清单可直接对照，未引入新的转换协议。

## SSE

初次连接帧为 `event: connected`，data 为 `{connected:true}`。业务帧的公共结构为 `{seq,type,workflowId?,runId?,nodeId?,payload,timestamp}`。事件枚举以 `src/shared/api.ts` 为准：

```text
snapshot.invalidated
workflow.updated
run.status
node.status
attempt.updated
checkpoint.created
intervention.created
intervention.resolved
session.chunk
audit.appended
heartbeat
```

注意：部分上游设计文档使用了较早的 attempt.log/checkpoint.saved 名称；迁移保留实际实现中的 attempt.updated/checkpoint.created。

## 角色与状态机

HAMA 默认讨论角色：产品与业务、架构与技术、开发、体验设计、测试与质量；四维评价为价值、可行性、完整性、成本与风险。审批操作绑定工件 ID、摘要和执行尝试。操作者持宿主令牌并填写审计名称，未引入多用户 RBAC。

```text
Workflow: draft → validated → trial_passed → locked
Run: queued / running / paused / waiting_human / succeeded / failed / cancelled
Node: pending / ready / running / succeeded / failed / skipped / waiting_human / rewound / waived
Design: draft → in_review → confirmed
                    ↓
              changes_requested → 新修订 draft
PermissionTier: turbo / supervised / strict
ExecutorKind: agent / tool / human / control
```

Git 工作树隔离、受限并发、条件路径跳过、Join、人工门禁、GhostNode、有界返工和 rescue refs 均直接沿用参考引擎。HAMA 使用 document-runs 文档目录，不伪装成代码工作树。设计交接按 (designId, revision, workspaceId) 幂等，并保留需求/AC 的原始 ID。
