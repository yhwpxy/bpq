# 步骤 1 验证记录

本次实现保存的是设计输入草案（`stage=input_ready`），正文推导在步骤 2 实现。创建草案不调用 Planner，也不创建工作流。步骤 3 的评审状态机和 SQLite 修订表尚未实现，当前输入快照存放在宿主数据目录 `design-inputs/{designId}.json`，重启后可通过 API 读取。

## 接口与页面

- 需求工程页每份已发布基线下增加“生成软件设计”。显式选工程后读取并展示完整目标提交；原有“导入下游编排”继续可用。
- `GET /api/design-workspaces/{workspaceId}` 返回工程当前提交及源码清单。
- `POST /api/designs` 接收 `baselineId、workspaceId、sourceCommit`，返回 201 与输入草案。无提交必须显式传 `sourceCommit: null`。
- `GET /api/designs/{designId}` 重读保存的输入草案。
- 页面可查看并导出基线引用、目标版本、需求与 AC 及追踪清单。

## 数据与版本核对

服务端直接调用 HAMA 的基线读取服务，保留完整已发布对象。检查 schemaVersion、ID、项目、版本、整体 SHA-256、PRD 工件摘要、方案摘要、批准与确认引用，以及需求、AC、scope、trace 的对应关系。整体摘要采用上游 `hash()` 的原始 JSON 算法，避免另行排序改变摘要语义。PRD 工件摘要复核时还原上游发布前的 `under_review` 状态。

源码通过 Git 从当前已核对提交读取，工作区未提交内容不会混入清单。保存相对路径、已有入口、构建清单原文、npm 依赖和验证脚本、工作区验证命令（仅记录，不执行）。其他构建生态的依赖保留在原始清单中；拟新增路径独立放在 `proposedPaths`，待步骤 2 推导。无提交工程只记录概念输入；演示来源明确标注演练限制。

## 自动化证据

在仓库根目录运行：

```powershell
node --experimental-transform-types --test software-design/verify/design-input.test.ts
node --experimental-transform-types --test requirements-engineering/verify/hama.test.ts
```

在 `workflow-orchestrator` 目录运行：

```powershell
npm run typecheck
npm run verify:gates
```

本次结果：新增设计测试 2/2、HAMA 联调测试 2/2、服务端及页面类型检查、生产构建通过。全量门禁中 HTTP 全链路和编排 / 沙箱通过；规划器门禁在 `planner-and-validator.verify.ts:92` 失败，现有测试期望 `deepseek-v4.1-flash`，工作区另一组模型配置改动已将默认值改为 `deepseek-flash`，本次未修改该配置或断言。

运行环境注意：桌面宿主注入的 `GIT_CONFIG_COUNT/KEY/VALUE` 与现有沙箱敏感环境过滤逻辑冲突，会导致门禁临时仓库初始化失败。本次在测试进程设置 `$env:GIT_CONFIG_COUNT = '0'` 后执行门禁；没有修改用户 Git 配置。HTTP 联调需要允许测试连接本机回环地址。

`design-input.test.ts` 使用非校园“非空行统计”基线，核对两个原始 AC、需求追踪、Git 提交清单、未提交文件隔离、无提交工程、未知基线、未知工作区、提交冲突、文档工作区和重新装配后的快照读取。

`hama.test.ts` 使用真实 HAMA 发布流程和本地模型协议夹具，经 HTTP 验证 live 基线草案创建、四类交接输入、原始字段保真、AC → 需求 → 来源议题 / 批准方案，以及创建前后工作流数量不变；demo 发布流程另外验证附条件批准记录保留和演练限制。

已保存一份有效输入：[step1-evidence.json](./step1-evidence.json)。这是测试夹具生成的 live 契约数据，非真实用户审批；目标提交来自测试创建的临时 Git 工程，仅用于复核基线引用、目标提交和原始需求 / AC。可重新运行下列命令生成证据：

```powershell
$env:DESIGN_INPUT_EVIDENCE = Join-Path (Get-Location) 'software-design/verify/step1-evidence.json'
node --experimental-transform-types --test software-design/verify/design-input.test.ts
Remove-Item Env:DESIGN_INPUT_EVIDENCE
```
