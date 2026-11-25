# 步骤 3 验证记录

## 使用与边界

在需求工程页生成正文后，填写操作人和修订原因，点击「将本次生成保存为评审修订」。这一步将选定生成结果存入宿主 SQLite；后续模型尝试不会覆盖已审正文。页面的设计列表和历史修订选择器可在服务重启后重新打开原修订，查看基线 / 目标提交、需求到模块及 AC 的追踪、诊断、未决项、前后版正文差异和完整决定记录。

评审流程为 `draft → in_review → confirmed`，或 `in_review → changes_requested → 新修订 draft`。确认版及所有历史正文只读。技术反馈需记录逐项意见及处理结果，再手工编辑新正文，或选择模型按当前修订反馈生成下一修订。再生成会使用当前修订的输入快照、正文和决定记录，并在完成后重新核对父修订，避免异步调用期间覆盖他人修改。

无提交的新工程可保存概念草案，但不能正式送审。填写并核对初始提交后，以新修订绑定工程清单，再送审。演示基线不能正式送审。确认时仍有阻断发现、阻断未决事项或无证据假设会返回 422。

本步只记录确认设计。PM 映射和正式交接属于步骤 4–5，页面没有创建工作流的评审动作。

## 存储、摘要与事务

`software-design/src/reviews.ts` 在宿主已有 SQLite 数据库中建立：

| 表 | 关键约束 |
| --- | --- |
| design_revisions | `(design_id, revision)` 主键；父修订外键；工作区外键；基线引用、输入快照、正文、诊断、渲染稿及创建元数据持久化 |
| design_decisions | decision_id 主键；外键引用具体修订；绑定 expected_hash；保存操作人、动作、发现、反馈范围与时间 |
| design_handoffs | `(design_id, revision, workspace_id)` 唯一；外键引用修订、工作区、工作流；只允许引用已确认且目标工作区一致的修订。写入交接功能待步骤 5 实现 |

摘要对对象键递归排序，数组保留顺序，覆盖 schemaVersion、完整基线引用、workspaceId、sourceCommit 和结构化正文。状态、操作人、决定记录、创建时间不进入内容摘要。相同正文及来源得到相同摘要；正文、来源引用或目标提交变化时摘要变化。评审修订的规范化摘要与步骤 2 生成记录的摘要分开使用，页面和 API 均返回所审修订自己的 contentSha256。

评审和新增修订采用 `BEGIN IMMEDIATE` 事务，先核对最新修订、摘要及状态，再写入决定与条件状态更新。冲突返回 409，details.current 含当前 designId、revision、contentSha256、state。数据库触发器禁止修改 / 删除历史正文，禁止修改 / 删除决定，限制状态仅沿合法方向转换。注入决定落库失败时，状态变更一并回滚。

## 接口

沿用宿主 Bearer Token 和回环服务。

| 操作 | 请求及响应 |
| --- | --- |
| GET /api/designs?baselineId=… | 列出基线下设计的最新修订；不传过滤条件可查询全部设计，用于选择跨基线来源 |
| GET /api/designs/{id}/revisions | 列出全部历史修订 |
| GET /api/designs/{id}/revisions/{rev} | 读取完整快照、决定、差异及可用交接关联；不存在返回 404 |
| POST /api/designs/{id}/revisions | 首次提交 generationId、actor、reason 采用成功生成结果，返回 201；可带 previousDesign 指向旧基线设计的 id、revision、contentSha256 |
| POST /api/designs/{id}/revisions | 后续提交 parentRevision、expectedHash、actor、reason、body、resolutions；可带 sourceCommit 重新清点目标版本。或者省略 body，传 providerId、model、feedback，基于父修订再生成正文并追加修订 |
| POST /api/designs/{id}/revisions/{rev}/review | expectedHash、actor、action、findings、scope；action 为 submit / request_changes / confirm，scope 默认为 technical，可选 requirements |

发现结构为 `{target, severity, evidence, resolution}`，severity 为 info / warning / blocking。退回至少有一条发现。下一修订的 resolutions 使用 `{decisionId, target, resolution}` 引用父修订真实意见，未解决的阻断发现必须逐项填写处理结果。确认事务不允许通过删除客户端意见来抹去数据库中已有的阻断发现。

## 两类退回

- **技术退回。** 保存 changes_requested 决定，正文不改；填写处理结果后在相同 baselineId 下追加修订。新修订记录父修订及原因，界面展示变更字段、变更前后正文和新增 / 移除文件。旧意见及新处理结果可分别回读。
- **需求变化。** 退回时选择 requirements，界面提供「返回 HAMA 填写需求变更」，预填原项目、原基线及待确认的评审反馈，仍由用户启动正常 HAMA 讨论与批准流程。服务拒绝在原系列追加修订来绕过新基线。新基线发布后启动新设计，选择同项目、同目标工程的旧设计作为来源；服务器校验版本及摘要，并保存原始需求 / AC 的 added、removed、changed、unchanged 集合。旧确认稿和退回意见保持可重现。

## 自动化证据

在仓库根目录运行：

```powershell
node --experimental-transform-types --test software-design/verify/design-input.test.ts software-design/verify/design-generation.test.ts software-design/verify/design-review.test.ts requirements-engineering/verify/hama.test.ts
```

在 `workflow-orchestrator` 目录运行：

```powershell
npm run typecheck
npm run build
$env:GIT_CONFIG_COUNT = '0'
npm run verify:gates
```

本次 8 个设计 / HAMA 测试通过，类型检查与生产构建通过。编排器 HTTP 全链路及编排 / 沙箱门禁通过；规划器门禁仍在 `planner-and-validator.verify.ts:92` 因既有模型默认值 `deepseek-flash` 与旧断言 `deepseek-v4.1-flash` 不一致而失败，本次未修改该配置或断言。Git 环境隔离原因见步骤 1 记录。

`design-review.test.ts` 覆盖摘要稳定与敏感字段变化、SQLite 重开恢复、完整宿主重启、评审状态机、阻断确认、意见处理、并发确认 / 退回冲突、旧摘要冲突、正文 / 决定不可变、事务故障回滚、概念设计绑定初始提交、技术退回、新基线系列与稳定需求 / AC 对比，以及按当前修订再生成时的输入版本检查。评审动作不产生工作流。

完整样例见 [step3-evidence.json](./step3-evidence.json)：含退回的初稿、已确认的技术修订、返回 HAMA 的需求反馈和新基线下的确认设计。基线及模型数据使用显式测试夹具，非真实用户审批或在线模型质量评估。重新生成：

```powershell
$env:DESIGN_REVIEW_EVIDENCE = Join-Path (Get-Location) 'software-design/verify/step3-evidence.json'
node --experimental-transform-types --test software-design/verify/design-review.test.ts
Remove-Item Env:DESIGN_REVIEW_EVIDENCE
```
