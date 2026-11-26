# 读书清单真实模型全流程验收

2026-11-26，DeepSeek 官方 API、deepseek-flash、默认五角色、原始读书清单输入完成需求基线发布。没有用 campusResponder 替代真实模型。全部人工关卡动作均通过运行时的已鉴权 HTTP API 提交，由 Codex 按用户授权的验收任务执行；不是另一个真实产品负责人完成的签核，也不是下游网页实现验收。

## 最终结果

- run：`run-be6da209`，状态 `succeeded`，16 个节点最终全部 succeeded。
- 时间：2026-11-26 21:31:51–21:48:59（UTC+8）。
- 基线：`baseline-run-be6da209`，v1，mode=live。
- SHA-256：`1c3d6d5d345b96720edab25f165101c9bfa90ff2bdabb7d68ae804d460f4b6ec`。
- PRD：6 条需求（4 功能、2 非功能）、33 条 Given/When/Then 验收标准，带来源、议题、方案、审批、需求、验收的追踪链。
- proposal v1 的 unresolved 为空；value/feasibility 为 conditional_pass，completeness/risk 为 pass；无 blocking/veto；聚合 report=conditional_pass。
- Loop A 工件 6 个（添加、持久化、界面范围各两轮），3 次议题人工裁决；Loop B/C/approval 返工均为 0。正常遍历不同议题的 discuss repeat 不算整合后返工。
- 115 次模型调用 API outcome 均 completed；本地校验 completed 108 次、invalid_output 7 次。这不是零重试验收。
- API 适配器记录输入 777260 tokens、输出 77210 tokens；不以宿主 run 费用汇总的零值作计量依据。

## 真实运行中发现并修复的新阻塞

同一 run 的第一次 integrate 在三次自动纠错后失败。原始响应在 scope[].issueIds 中填写 add-book、local-persistence 等基础需求 ID，而合法值是 issue-add-book、issue-local-persistence 等 issue_board ID。第 1、3 次输出因此被拒绝；第 2 次另有 JSON 语法错误。旧反馈只有“候选范围必须关联真实议题”，未给具体合法值，模型无法可靠纠错。

提交 `d7e4c7f`：

- integrate 上下文增加 allowedIssueIds，提示词区分议题 ID、baseId 和 scope key。
- 校验保持原严格程度；错误反馈列出无效 ID 和精确允许列表。
- 新增通过 HTTP 适配器的纠错后发布基线与持续错误明确失败两项回归。修改前失败、修改后通过，证据见 regression-before.log / regression-after.log。

初始阶段源码为 `eec62e4`；首次 integrate 失败后停止运行时，在 `d7e4c7f` 重启，用正式 `POST /api/runs/:id/retry-node` 重试 integrate，保留同一 run 的输入、全部讨论和人工裁决。重试后的整合、四维评审、附条件审批、解除条件、PRD、确认、publish、done 成功。

这是一次有记录的失败修复与续跑后完成的真实链路，不是整条运行自始至终都在同一个源码 SHA 上、也不是无中断新 run。evidence.json 的 sourceTimeline 精确记录两个源码阶段。完整最终修复版本的新 run 仍受模型随机性影响，本次不声称所有输入或每次运行都保证成功。

## 与原始回退故障的关系

已有修复 `62890d5` 的真实依据见 `../rework-live/evidence.json`：run-3732462f 第一轮 value 返回 revision_required，但四维合计没有 blocking/veto，仍触发 evaluation → Loop B round 1 → discuss。第二轮则有只读提示优先级的真实 blocking，不应放行。历史 run-2027d4f3 三轮都由 evaluation 发起 Loop B，兼有旧人工决定重新进入 unresolved、真实边界缺失和过早要求 PRD 详细验收的问题。

62890d5 已增加 verdict 与阻断证据一致性校验、无 issueIds 阻断回 integrate、人工裁决有效结论投影，并区分方案评审与后续 PRD 验收。原有 maxRevisions 限制保留，持续 blocking 到上限升级的回归通过。本次读书清单真实 run 在通过整合校验后没有再回 discuss；模型仍提出非阻断条件，由正式审批/条件/确认流程处理，没有把 verdict 强制改成 pass。

## 条件审批与不可变性验证

四维评审要求补充或确认的非阻断条件包括：单标签多开覆盖风险文案、满额隐藏旧书名校验错误、只读无应用内恢复的取舍等。已通过 conditional_approve 与 release_conditions 明确授权这些需求口径；PRD 生成后，逐项检查其文字与验收条目，再执行 confirm。核验见 conditions-verification.json。没有声称这些功能已部署或做过浏览器运行测试。

基线从已有 renderPrd 直接导出为 PRD.md。重新计算摘要并与数据库逐字段比较；尝试 UPDATE 和 DELETE 均被现有 immutable trigger 拒绝，随后再次确认内容不变；175 个工件的数据哈希均匹配。核验见 immutability-verification.json。

## 代码与检查

分支始终为 `feat/reference-alignment-472cd7a`，没有新建分支、新依赖或放宽 Schema。相关代码提交：`62890d5` 与 `d7e4c7f`；另有证据文档提交。未推送。

`node scripts/check.mjs` 退出码 0：verify-reference、typecheck、build、3 组 verify:gates 和全部 30 项测试通过。日志见 check.log。除必要修复、对应测试和精确哈希登记外未改生产代码。

## 用户本机复跑

应用上述同分支提交后，根目录 .env 配置 DEEPSEEK_API_KEY（不要提交）；从根目录执行：

```sh
npm run setup
node scripts/check.mjs
npm run start:web
```

在需求工程中选 live、DeepSeek 官方接口 `https://api.deepseek.com/v1`、deepseek-flash、默认五角色，用 `../rework-live/reading-input.json` 的原始内容创建新的项目 ID。模型提出人工问题时按你的实际需求裁决；四维评价通过后完成审批、必要的条件解除、PRD 确认并发布。需要重现本次取舍时参考 evidence.json 内的 decisions，它们通过正常接口写入，不能直接替换数据库。

本次验收服务已正常停止，数据保存在本任务 work/live-after-topup/orchestrator.sqlite；最终 PRD、基线 JSON、模型调用摘要、工件与节点尝试均已导出。密钥不在证据或提交中。
