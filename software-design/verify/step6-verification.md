# 步骤 6：PRD 转换与 PM 签收验收

## 结果与证据边界

清单步骤 1–6 的实现及本地集成验收已完成：设计 / HAMA 共 14 个测试通过，服务端及页面类型检查、生产构建、编排器全部三个门禁通过。此前规划器门禁中 native-api 默认模型的旧断言已按现有配置改为 deepseek-flash；opencode-go 的独立模型断言保持原样，没有更改运行时模型配置。

本次使用真实 HAMA 发布服务、DesignService / DesignGenerator、评审 SQLite、HTTP 路由和现有 Planner / PM Agent。模型通过本地 OpenAI 兼容协议夹具返回确定性响应，审批通过明确标记的验收脚本模拟；live 基线由实际 HAMA 流程发布，没有注入基线表或伪造发布记录。该验收证明服务链路、版本与身份保真及指定样例契约，不代表在线模型质量评测或真实用户批准。

验收范围终止于 PM 签收。目标 CLI、记账服务和校园页面未在本步骤编码执行；大文件内存、事务并发与 360 CSS 像素交互均核对为设计中的具体约束和验收方法，业务实现后的实际性能及界面测试由下游负责。

## 场景覆盖

| 案例 | 来源及范围 | 需求 / AC | 设计及签收结果 |
| --- | --- | --- | --- |
| 非空行工具 v1 | HAMA 新发布 live 基线 | 2 / 4 | CLI 与流式计数模块、文件及标准输出契约；已确认并由真实 PM 签收，图校验零阻断 |
| 多币种账本 | HAMA 新发布 live 基线 | 3 / 5 | 分录与汇率引擎、十进制金额、快照、平衡校验及幂等事务；已确认并由真实 PM 签收，图校验零阻断 |
| 校园演示 | HAMA 发布 demo 基线 | 4 / 4 | 360 CSS 像素交互、重复报名与末席容量；草案生成和覆盖检查通过，正式送审 / 交接被拒绝 |
| 非空行工具 v2 | 从 v1 发布 live 基线 v2 | 2 / 4 | 更新文件不存在时的 stderr / 退出码 2 契约，形成独立设计及 PM 回执，旧版仍可重读 |

完整引用及抽查入口见[交接验收总表](./step6-evidence/summary.md)，机器可读汇总见 [summary.json](./step6-evidence/summary.json)。每份案例 JSON 均保存 baseline、input、generation、draft、confirmed（适用时）、receipt（适用时）及逐条 coverage，不依赖旧步骤中人工构造的确认快照。

## 转换质量核对

非空行工具的 PRD 描述用户结果及流式约束，设计进一步给出：

- `src/cli.ts` 与 `src/count.ts` 分工，入口依赖计数模块。
- `countFile(path: string): Promise<number>`，UTF-8 输入、非负整数结果、CLI 标准输出及换行契约。
- 逐行读取、trim 后非空才计数、结束或失败时关闭句柄，避免完整载入文件。
- 文件不存在时向 stderr 报错、非零退出、失败不输出部分统计；新基线 v2 将该退出码明确为 2。
- 正常 / 空文件 / 不存在文件 / 大文件约束四条原始 AC 对应的模块、验证方法和预期证据。
- 其他读取错误的具体非零退出码保留为有责任人的非阻断未决项。

测试检查这些具体契约，并逐条比较原始 AC ID 和 Given / When / Then；覆盖表同时保留来源议题和批准方案 ID。计数项目的模型输入及正文不得混入校园、报名、分录或汇率内容，账本输入不得混入校园或非空行案例。

账本样例核对借贷不平衡 / 缺失当日汇率时拒绝整笔事务、无部分分录，`USD 100.00 × 7.2000 = CNY 720.00` 的结果及快照，以及十进制定点金额和业务编号幂等契约。校园样例通过同一设计 API 生成专属界面 / 名额设计；demo 的正式评审返回 422，正式交接返回 409，不产生 PM 工作流。

## 真实服务链路

新增 `acceptance.test.ts` 从 `/api/hama/runs` 启动需求运行，经讨论、独立评价、方案批准和 PRD 确认，等待实际发布成功，再从 `/api/hama/baselines/{id}` 回读同一基线。所有后续步骤均调用宿主正式 HTTP API：

1. 按 baselineId、workspaceId、sourceCommit 创建设计输入。
2. 经宿主 native-api 无工具文本调用生成设计。
3. 采用生成结果、提交评审并确认冻结正文。
4. 并发向同一交接键提交两次，核对 201 / 200、相同 workflowId / pmReportId 和 received 状态。
5. 比较 goalSpec.rawMarkdown 与确认稿全文、原需求与 AC 集合及所属关系；在实际 PM slices 中抽查模块文件与需求覆盖，核对零阻断校验。
6. 从 workflowId 反查设计关联，重启整个宿主后重新读取基线、确认设计和原交接回执；再次提交只找回原工作流。

响应丢失后的恢复、交接落库故障回滚、待核查报告恢复和旧摘要冲突继续由原 `handoff.test.ts`、`design-review.test.ts` 回归覆盖。该验收没有运行下游编码任务。

## 修订隔离

非空行工具的第二轮需求使用相同 projectId 和第一份已发布基线作为 parentBaselineId，经新的 HAMA 运行再次批准 / 确认后发布基线 v2。scopeKey 和 AC key 保持稳定，因此所有原始需求及 AC ID 均保持不变；只有 count 需求正文和 missing AC 的通过标准变化。

新设计通过 previousDesign 引用旧确认修订，持久化的 baselineDiff 精确定位一条需求和一条 AC 的改变，其余条目保留为 unchanged。目标工作区及源码提交不变，设计摘要、baselineId、workflowId 与 pmReportId 分离。两次确认稿、批准记录和回执在服务重启后逐字段复核，旧版没有被新版覆盖。

## 回归与复现

仓库根目录执行：

```powershell
# 本地 HTTP 测试需要允许回环连接；Git 覆盖仅影响本次测试进程
$env:GIT_CONFIG_COUNT = '0'
node --experimental-transform-types --test requirements-engineering/verify/hama.test.ts
node --experimental-transform-types --test software-design/verify/*.test.ts requirements-engineering/verify/hama.test.ts
```

`workflow-orchestrator` 目录执行：

```powershell
npm run typecheck
npm run build
$env:GIT_CONFIG_COUNT = '0'
npm run verify:gates
```

| 检查 | 结果 |
| --- | --- |
| 软件设计及 HAMA 测试 | 14 / 14 通过 |
| TypeScript 服务端及页面类型检查 | 通过 |
| 生产构建 | 通过 |
| fullstack-smoke | 通过 |
| orchestrator-and-sandbox | 通过 |
| planner-and-validator | 通过；旧默认模型断言已校正 |

前五步的验证记录保留各自执行时的历史结果；其中提及的模型断言失败在本步解决。Git 环境隔离说明见步骤 1，未修改用户 Git 配置。

四组证据由同一次成功验收生成，可重新执行：

```powershell
# 在仓库根目录
$env:GIT_CONFIG_COUNT = '0'
$env:DESIGN_ACCEPTANCE_EVIDENCE = Join-Path (Get-Location) 'software-design/verify/step6-evidence'
node --experimental-transform-types --test software-design/verify/acceptance.test.ts
Remove-Item Env:DESIGN_ACCEPTANCE_EVIDENCE
```

基线、设计和工作流标识每次运行重新分配；原始需求 / AC 编号按稳定项目及 scopeKey / AC key 计算。证据中的目标 Git 提交来自临时工程，源代码清单和设计输入均已保存。重新生成证据后，应同步更新清单末尾的引用表；summary.md 由测试自动更新。
