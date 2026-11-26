# HAMA 整合后回退：修复与验收状态

日期：2026-11-26。代码修复已提交、完整检查通过；真实模型全流程验收尚未完成，不能宣布问题已彻底解决。

## 已确认的真实证据

1. 历史数据库中，`run-e4e42cdc` 在提案输出校验失败，尚无 proposal/report。实际发生多轮整合回退的是 `run-2027d4f3`：三轮 report 均为 `revision_required`，由 evaluation 生成 Loop B 的 round 1、2、3，target 均为 discuss。第一轮整合把提示优先级、浏览器版本记录、字数提示等已裁决内容重新列为 unresolved。后两轮还存在新增边界和详细验收要求，不能把全部 findings 都称为误报。
2. 历史回退发生在 2026-11-25 17:47–18:06（UTC+8），早于 `3a4228c` 当日 18:13:30 的提交。数据库不记录执行源码 SHA；旧目录最终 HEAD 不能证明每轮使用的源码版本。因此明确保留“失败可能发生在旧代码上”的边界。
3. 本次以同一读书清单原始输入、DeepSeek 官方 API、deepseek-flash、默认五角色重跑。诊断 run `run-3732462f` 使用 `3a4228c` 加无议题阻断路由修正，尚未加载本次人工结论投影及 verdict 一致性修复，确实再次出现整合后回退。
4. 该新运行第一轮：value 评审返回 `revision_required`，但 findings 只有 condition/informational，无 blocking/veto；其他维度为 conditional_pass。evaluation 仍产生 `revision_required`，默认 target=discuss，生成 Loop B round=1，reason 退化为“独立评价要求返工”，issueIds 取到 `issue-persist-local`。这证明矛盾的 LLM verdict 可以绕过缺陷严重度，触发无明确阻断依据的业务返工。
5. 新运行第二轮又产生 Loop B round=2，原因是只读状态与提示区优先级的具体矛盾；这轮有真实 blocking coverage，不能删除或强制 pass。

逐轮 severity/category/issueIds、评审原文、proposal、人工决定及 rework 工件链见 `evidence.json`。历史逐轮可读报告见 `真实回退逐轮证据.md`。

## 修改及依据

代码提交：`62890d5`，分支 `feat/reference-alignment-472cd7a`。未推送远端。

- `pipeline.ts`：要求 revision_required 至少提供 blocking/veto 证据；矛盾输出进入原有最多三次纠错重试，不改成 pass、不删评审。持续不合规会明确失败，不静默业务循环。
- `pipeline.ts`：无关联议题的阻断回 integrate，不再仅允许 coverage 类；有关联议题仍回 discuss。
- `service.ts`、`contracts.ts`、`pipeline.ts`：人工裁决后清空当前议题 blockers；整合输入显式提供绑定的人工决定和有效结论，原始讨论工件保持不变，旧候选只用于解释裁决引用的内容。解决“状态已裁决但仍把旧阻塞当作当前上下文”的问题。
- `agents.ts`：明确最新人工决定优先；方案评审不能仅因尚无后续 PRD 的详细 Given/When/Then、测试数据或操作步骤而阻断。缺失需求边界、真实矛盾和重大风险仍正常评审。
- 不改变 maxRevisions 预算机制，不增加依赖，不放宽 JSON schema；更新参照文件清单的精确哈希及修改原因。

## 验证

`node scripts/check.mjs` 全绿，28 项测试通过，覆盖参照检查、类型、构建、宿主 gates 及全部测试。日志：`checks.txt`。

新增确定性回归通过 HTTP 模型适配器注入响应，属于测试夹具，不是 DeepSeek live 成功证据：

- 四维评审持续带议题 blocking：精确耗尽预算后进入 escalate/reject。
- coverage 无 issueIds：回 integrate。
- technical 无 issueIds：回 integrate；修改前此测试失败，修改后通过。
- 人工裁决后经历两次整合：旧阻塞不重开议题，原历史工件仍保留；另一个真实整合缺漏仍正常产生一次 integrate 返工，再发布基线。
- revision_required 与 condition findings 矛盾：触发校验纠错，纠正后进入附条件审批，不产生业务返工。
- maxRevisions=0：直接进入人工上限关卡，不放行。

## 最终 live 尝试与阻塞

完整修复代码的独立 run：`run-188e4239`，同一读书清单输入、live 模式、DeepSeek 官方 API、deepseek-flash、默认五角色。

intake 连续三次调用失败。2026-11-26 12:35:58（UTC+8）对官方接口作最小独立核验，返回 HTTP 402 `Insufficient Balance`。证据：`deepseek-availability.json`（完整工件也包含在 `evidence.json` 的 finalAttempt 中）。诊断中途另有 rate_limited 返回；最终确认的阻塞是余额不足。

**没有成功基线 ID，没有 PRD 导出。没有使用 demo 成功冒充真实验收。** 本次所有临时运行服务已停止，数据库保留，可继续取证。

## 在自己的机器复跑

将本次提交应用到同一分支；本次修复提交为 `62890d5`。根目录 `.env` 配置有余额的 `DEEPSEEK_API_KEY`，不要提交密钥。

```sh
npm run setup
node scripts/check.mjs
npm run start:web
```

在需求工程中选择真实模型、DeepSeek、deepseek-flash、默认五角色，以 `reading-input.json` 的原始 Idea、背景、目标、约束与偏好创建新运行，正常处理澄清和讨论人工关卡，检查四维评价，再审批、生成 PRD、确认和发布基线。不要换成简单计数器输入。人工请求须通过界面或已鉴权 HTTP API，禁止修改数据库状态。

仍需：给当前 DeepSeek 账户充值，或提供有余额的密钥配置文件路径；如用户实际卡住的是另一份输入，还需其原始文本及失败实例 commit。余额恢复后必须再完成一次修复版本的完整 live 验收，才能满足本次完成定义。
