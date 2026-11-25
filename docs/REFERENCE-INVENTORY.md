# 参考基准、目录职责与逐文件映射

参考提交：`472cd7a5891a1a1bd22247a53197c78dc637d452`。下表的参考路径与当前路径一一对应，137 个文件经 SHA-256 比较完全一致。根 README、根 .gitignore 为必要适配；根 package.json、scripts/check.mjs、scripts/verify-*.mjs 及本 docs/ 为 BPQ 包装与验收材料。

## 子系统与目录职责

| 目录 | 职责 |
| --- | --- |
| `requirements-engineering/src/` | HAMA 七阶段、角色协议、输出校验、基线和持久化 |
| `requirements-engineering/verify/` | HAMA demo/live、人工门禁、返工与恢复集成测试 |
| `software-design/src/` | 基线读取、工程清单、设计生成、修订评审及 PM 交接 |
| `software-design/verify/` | 设计生成、评审、原子签收、跨版本隔离测试及上游历史证据 |
| `workflow-orchestrator/src/shared/` | 领域类型、HTTP/SSE DTO、校验与错误 |
| `workflow-orchestrator/src/core/` | 规格、规划、图编译、试运行、策略、成本及知识规则 |
| `workflow-orchestrator/src/store/` | SQLite 初始化、迁移、内置数据和事务存取 |
| `workflow-orchestrator/src/sandbox/` | 命令执行、路径边界、Git Worktree、检查点及恢复 |
| `workflow-orchestrator/src/adapters/` | API/CLI/ACP 能力适配、工具及资源槽 |
| `workflow-orchestrator/src/engines/` | PM、规划器、运行状态机、认证与知识整合 |
| `workflow-orchestrator/src/server/` | HTTP、SSE、密钥保险库和宿主装配 |
| `workflow-orchestrator/src/electron/` | Electron 主进程与隔离 preload 桥 |
| `workflow-orchestrator/renderer/src/views/` | 五个主视图 |
| `workflow-orchestrator/renderer/src/components/` | 图画布、图标、设计生成/评审/交接面板 |
| `workflow-orchestrator/renderer/src/api/` | 前端 HTTP 客户端和 SSE 接入 |
| `workflow-orchestrator/renderer/src/styles/` | 参考页面主题与布局 |
| `workflow-orchestrator/scripts/` | 开发、构建、启动、打包和验收命令 |
| `workflow-orchestrator/verify/` | 规划校验、运行沙箱及全栈验收 |
| `workflow-orchestrator/docs/` | 原始规格、对齐矩阵、清单和变更记录 |

## 页面与入口

| 页面 | 实现 | 入口与行为 |
| --- | --- | --- |
| 需求工程 | `RequirementsView.tsx` | Idea、运行、工件、审批和基线 |
| 编排设计台 | `WorkflowsView.tsx` | 规格/预设导入、任务图编辑、试运行、锁版与发布 |
| 实时编排控制台 | `WorkstationView.tsx` | 状态、日志、节点详情、人工干预与恢复 |
| 基础设施与模型池 | `CapabilitiesView.tsx` | 能力、密钥和模型供应配置 |
| 版本与日志审计 | `RunsAuditView.tsx` | 版本、证据搜索、规则、知识与审计 |
| 软件设计嵌入面板 | `DesignStart.tsx`、`DesignReviewPanel.tsx`、`DesignHandoffPanel.tsx` | 在已发布需求基线下使用 |

页面使用 App.tsx 中的 section 状态切换，未引入额外 SPA 路由路径。URL 中 apiBaseUrl/token 用于连接宿主。

## 完整文件映射

| 参考文件 | 当前文件 | 职责 |
| --- | --- | --- |
| `.env_example` | [.env_example](../.env_example) | 工程配置/入口 |
| `.gitattributes` | [.gitattributes](../.gitattributes) | 工程配置/入口 |
| `requirements-engineering/README.md` | [requirements-engineering/README.md](../requirements-engineering/README.md) | 说明/规格/历史验收文档 |
| `requirements-engineering/package.json` | [requirements-engineering/package.json](../requirements-engineering/package.json) | 依赖范围与命令 |
| `requirements-engineering/src/agents.ts` | [requirements-engineering/src/agents.ts](../requirements-engineering/src/agents.ts) | 真实模型协议 |
| `requirements-engineering/src/contracts.ts` | [requirements-engineering/src/contracts.ts](../requirements-engineering/src/contracts.ts) | 请求/响应与领域契约 |
| `requirements-engineering/src/demo.ts` | [requirements-engineering/src/demo.ts](../requirements-engineering/src/demo.ts) | 确定性校园演示 |
| `requirements-engineering/src/graph.ts` | [requirements-engineering/src/graph.ts](../requirements-engineering/src/graph.ts) | HAMA 执行图 |
| `requirements-engineering/src/markdown.ts` | [requirements-engineering/src/markdown.ts](../requirements-engineering/src/markdown.ts) | PRD Markdown 导出 |
| `requirements-engineering/src/pipeline.ts` | [requirements-engineering/src/pipeline.ts](../requirements-engineering/src/pipeline.ts) | 七阶段和 A/B/C 返工回路 |
| `requirements-engineering/src/repository.ts` | [requirements-engineering/src/repository.ts](../requirements-engineering/src/repository.ts) | 工件、门禁与基线持久化 |
| `requirements-engineering/src/schema.ts` | [requirements-engineering/src/schema.ts](../requirements-engineering/src/schema.ts) | 数据库或运行时校验结构 |
| `requirements-engineering/src/service.ts` | [requirements-engineering/src/service.ts](../requirements-engineering/src/service.ts) | 领域服务入口 |
| `requirements-engineering/verify/hama.test.ts` | [requirements-engineering/verify/hama.test.ts](../requirements-engineering/verify/hama.test.ts) | 自动化验收 |
| `software-design/README.md` | [software-design/README.md](../software-design/README.md) | 说明/规格/历史验收文档 |
| `software-design/campus-design-review.md` | [software-design/campus-design-review.md](../software-design/campus-design-review.md) | 说明/规格/历史验收文档 |
| `software-design/campus-design-spec.md` | [software-design/campus-design-spec.md](../software-design/campus-design-spec.md) | 说明/规格/历史验收文档 |
| `software-design/checkoutlist.md` | [software-design/checkoutlist.md](../software-design/checkoutlist.md) | 说明/规格/历史验收文档 |
| `software-design/design-spec-template.md` | [software-design/design-spec-template.md](../software-design/design-spec-template.md) | 说明/规格/历史验收文档 |
| `software-design/implementation-plan.md` | [software-design/implementation-plan.md](../software-design/implementation-plan.md) | 说明/规格/历史验收文档 |
| `software-design/package.json` | [software-design/package.json](../software-design/package.json) | 依赖范围与命令 |
| `software-design/src/baseline.ts` | [software-design/src/baseline.ts](../software-design/src/baseline.ts) | 已批准基线完整性验证 |
| `software-design/src/contracts.ts` | [software-design/src/contracts.ts](../software-design/src/contracts.ts) | 请求/响应与领域契约 |
| `software-design/src/design-render.ts` | [software-design/src/design-render.ts](../software-design/src/design-render.ts) | 评审稿与 PM 预览渲染 |
| `software-design/src/design-schema.ts` | [software-design/src/design-schema.ts](../software-design/src/design-schema.ts) | 设计正文校验契约 |
| `software-design/src/design-validation.ts` | [software-design/src/design-validation.ts](../software-design/src/design-validation.ts) | 需求/AC/路径/依赖覆盖检查 |
| `software-design/src/generator.ts` | [software-design/src/generator.ts](../software-design/src/generator.ts) | 设计生成及模型调用 |
| `software-design/src/handoff.ts` | [software-design/src/handoff.ts](../software-design/src/handoff.ts) | 幂等事务交接与 PM 回执 |
| `software-design/src/pm-input.ts` | [software-design/src/pm-input.ts](../software-design/src/pm-input.ts) | 保留原编号的结构化 PM 投影 |
| `software-design/src/reviews.ts` | [software-design/src/reviews.ts](../software-design/src/reviews.ts) | 不可变修订与评审状态机 |
| `software-design/src/service.ts` | [software-design/src/service.ts](../software-design/src/service.ts) | 领域服务入口 |
| `software-design/subsystem-design.md` | [software-design/subsystem-design.md](../software-design/subsystem-design.md) | 说明/规格/历史验收文档 |
| `software-design/verify/acceptance-fixtures.ts` | [software-design/verify/acceptance-fixtures.ts](../software-design/verify/acceptance-fixtures.ts) | 自动化验收 |
| `software-design/verify/acceptance.test.ts` | [software-design/verify/acceptance.test.ts](../software-design/verify/acceptance.test.ts) | 自动化验收 |
| `software-design/verify/design-generation.test.ts` | [software-design/verify/design-generation.test.ts](../software-design/verify/design-generation.test.ts) | 自动化验收 |
| `software-design/verify/design-input.test.ts` | [software-design/verify/design-input.test.ts](../software-design/verify/design-input.test.ts) | 自动化验收 |
| `software-design/verify/design-review.test.ts` | [software-design/verify/design-review.test.ts](../software-design/verify/design-review.test.ts) | 自动化验收 |
| `software-design/verify/handoff.test.ts` | [software-design/verify/handoff.test.ts](../software-design/verify/handoff.test.ts) | 自动化验收 |
| `software-design/verify/pm-input.test.ts` | [software-design/verify/pm-input.test.ts](../software-design/verify/pm-input.test.ts) | 自动化验收 |
| `software-design/verify/step1-evidence.json` | [software-design/verify/step1-evidence.json](../software-design/verify/step1-evidence.json) | 上游历史验收证据（原样保留，并非本次执行记录） |
| `software-design/verify/step1-verification.md` | [software-design/verify/step1-verification.md](../software-design/verify/step1-verification.md) | 说明/规格/历史验收文档 |
| `software-design/verify/step2-evidence/cli.json` | [software-design/verify/step2-evidence/cli.json](../software-design/verify/step2-evidence/cli.json) | 上游历史验收证据（原样保留，并非本次执行记录） |
| `software-design/verify/step2-evidence/service.json` | [software-design/verify/step2-evidence/service.json](../software-design/verify/step2-evidence/service.json) | 上游历史验收证据（原样保留，并非本次执行记录） |
| `software-design/verify/step2-verification.md` | [software-design/verify/step2-verification.md](../software-design/verify/step2-verification.md) | 说明/规格/历史验收文档 |
| `software-design/verify/step3-evidence.json` | [software-design/verify/step3-evidence.json](../software-design/verify/step3-evidence.json) | 上游历史验收证据（原样保留，并非本次执行记录） |
| `software-design/verify/step3-verification.md` | [software-design/verify/step3-verification.md](../software-design/verify/step3-verification.md) | 说明/规格/历史验收文档 |
| `software-design/verify/step4-evidence.json` | [software-design/verify/step4-evidence.json](../software-design/verify/step4-evidence.json) | 上游历史验收证据（原样保留，并非本次执行记录） |
| `software-design/verify/step4-verification.md` | [software-design/verify/step4-verification.md](../software-design/verify/step4-verification.md) | 说明/规格/历史验收文档 |
| `software-design/verify/step5-evidence.json` | [software-design/verify/step5-evidence.json](../software-design/verify/step5-evidence.json) | 上游历史验收证据（原样保留，并非本次执行记录） |
| `software-design/verify/step5-verification.md` | [software-design/verify/step5-verification.md](../software-design/verify/step5-verification.md) | 说明/规格/历史验收文档 |
| `software-design/verify/step6-evidence/campus-demo.json` | [software-design/verify/step6-evidence/campus-demo.json](../software-design/verify/step6-evidence/campus-demo.json) | 上游历史验收证据（原样保留，并非本次执行记录） |
| `software-design/verify/step6-evidence/counter-v1.json` | [software-design/verify/step6-evidence/counter-v1.json](../software-design/verify/step6-evidence/counter-v1.json) | 上游历史验收证据（原样保留，并非本次执行记录） |
| `software-design/verify/step6-evidence/counter-v2.json` | [software-design/verify/step6-evidence/counter-v2.json](../software-design/verify/step6-evidence/counter-v2.json) | 上游历史验收证据（原样保留，并非本次执行记录） |
| `software-design/verify/step6-evidence/ledger.json` | [software-design/verify/step6-evidence/ledger.json](../software-design/verify/step6-evidence/ledger.json) | 上游历史验收证据（原样保留，并非本次执行记录） |
| `software-design/verify/step6-evidence/summary.json` | [software-design/verify/step6-evidence/summary.json](../software-design/verify/step6-evidence/summary.json) | 上游历史验收证据（原样保留，并非本次执行记录） |
| `software-design/verify/step6-evidence/summary.md` | [software-design/verify/step6-evidence/summary.md](../software-design/verify/step6-evidence/summary.md) | 说明/规格/历史验收文档 |
| `software-design/verify/step6-verification.md` | [software-design/verify/step6-verification.md](../software-design/verify/step6-verification.md) | 说明/规格/历史验收文档 |
| `workflow-orchestrator/.prettierrc.json` | [workflow-orchestrator/.prettierrc.json](../workflow-orchestrator/.prettierrc.json) | 工程配置/入口 |
| `workflow-orchestrator/README.md` | [workflow-orchestrator/README.md](../workflow-orchestrator/README.md) | 说明/规格/历史验收文档 |
| `workflow-orchestrator/docs/CHANGELOG.md` | [workflow-orchestrator/docs/CHANGELOG.md](../workflow-orchestrator/docs/CHANGELOG.md) | 说明/规格/历史验收文档 |
| `workflow-orchestrator/docs/CHECKLIST.md` | [workflow-orchestrator/docs/CHECKLIST.md](../workflow-orchestrator/docs/CHECKLIST.md) | 说明/规格/历史验收文档 |
| `workflow-orchestrator/docs/DESIGN-ALIGNMENT.md` | [workflow-orchestrator/docs/DESIGN-ALIGNMENT.md](../workflow-orchestrator/docs/DESIGN-ALIGNMENT.md) | 说明/规格/历史验收文档 |
| `workflow-orchestrator/docs/SPEC.md` | [workflow-orchestrator/docs/SPEC.md](../workflow-orchestrator/docs/SPEC.md) | 说明/规格/历史验收文档 |
| `workflow-orchestrator/eslint.config.mjs` | [workflow-orchestrator/eslint.config.mjs](../workflow-orchestrator/eslint.config.mjs) | 工程配置/入口 |
| `workflow-orchestrator/package-lock.json` | [workflow-orchestrator/package-lock.json](../workflow-orchestrator/package-lock.json) | 精确依赖解析版本 |
| `workflow-orchestrator/package.json` | [workflow-orchestrator/package.json](../workflow-orchestrator/package.json) | 依赖范围与命令 |
| `workflow-orchestrator/renderer/index.html` | [workflow-orchestrator/renderer/index.html](../workflow-orchestrator/renderer/index.html) | 工程配置/入口 |
| `workflow-orchestrator/renderer/src/App.tsx` | [workflow-orchestrator/renderer/src/App.tsx](../workflow-orchestrator/renderer/src/App.tsx) | 五视图导航、检索、语言和全局状态 |
| `workflow-orchestrator/renderer/src/api/client.ts` | [workflow-orchestrator/renderer/src/api/client.ts](../workflow-orchestrator/renderer/src/api/client.ts) | 前端 HTTP 客户端和 SSE 接入 |
| `workflow-orchestrator/renderer/src/components/DesignHandoffPanel.tsx` | [workflow-orchestrator/renderer/src/components/DesignHandoffPanel.tsx](../workflow-orchestrator/renderer/src/components/DesignHandoffPanel.tsx) | 图画布、图标、设计生成/评审/交接面板 |
| `workflow-orchestrator/renderer/src/components/DesignReviewPanel.tsx` | [workflow-orchestrator/renderer/src/components/DesignReviewPanel.tsx](../workflow-orchestrator/renderer/src/components/DesignReviewPanel.tsx) | 图画布、图标、设计生成/评审/交接面板 |
| `workflow-orchestrator/renderer/src/components/DesignStart.tsx` | [workflow-orchestrator/renderer/src/components/DesignStart.tsx](../workflow-orchestrator/renderer/src/components/DesignStart.tsx) | 图画布、图标、设计生成/评审/交接面板 |
| `workflow-orchestrator/renderer/src/components/Icons.tsx` | [workflow-orchestrator/renderer/src/components/Icons.tsx](../workflow-orchestrator/renderer/src/components/Icons.tsx) | 图画布、图标、设计生成/评审/交接面板 |
| `workflow-orchestrator/renderer/src/components/TwinGraphCanvas.tsx` | [workflow-orchestrator/renderer/src/components/TwinGraphCanvas.tsx](../workflow-orchestrator/renderer/src/components/TwinGraphCanvas.tsx) | 图画布、图标、设计生成/评审/交接面板 |
| `workflow-orchestrator/renderer/src/i18n.ts` | [workflow-orchestrator/renderer/src/i18n.ts](../workflow-orchestrator/renderer/src/i18n.ts) | 中英文文案 |
| `workflow-orchestrator/renderer/src/main.tsx` | [workflow-orchestrator/renderer/src/main.tsx](../workflow-orchestrator/renderer/src/main.tsx) | React 挂载入口 |
| `workflow-orchestrator/renderer/src/styles/theme.css` | [workflow-orchestrator/renderer/src/styles/theme.css](../workflow-orchestrator/renderer/src/styles/theme.css) | 参考页面主题与布局 |
| `workflow-orchestrator/renderer/src/views/CapabilitiesView.tsx` | [workflow-orchestrator/renderer/src/views/CapabilitiesView.tsx](../workflow-orchestrator/renderer/src/views/CapabilitiesView.tsx) | 五个主视图 |
| `workflow-orchestrator/renderer/src/views/RequirementsView.tsx` | [workflow-orchestrator/renderer/src/views/RequirementsView.tsx](../workflow-orchestrator/renderer/src/views/RequirementsView.tsx) | 五个主视图 |
| `workflow-orchestrator/renderer/src/views/RunsAuditView.tsx` | [workflow-orchestrator/renderer/src/views/RunsAuditView.tsx](../workflow-orchestrator/renderer/src/views/RunsAuditView.tsx) | 五个主视图 |
| `workflow-orchestrator/renderer/src/views/WorkflowsView.tsx` | [workflow-orchestrator/renderer/src/views/WorkflowsView.tsx](../workflow-orchestrator/renderer/src/views/WorkflowsView.tsx) | 五个主视图 |
| `workflow-orchestrator/renderer/src/views/WorkstationView.tsx` | [workflow-orchestrator/renderer/src/views/WorkstationView.tsx](../workflow-orchestrator/renderer/src/views/WorkstationView.tsx) | 五个主视图 |
| `workflow-orchestrator/renderer/src/views/requirements.css` | [workflow-orchestrator/renderer/src/views/requirements.css](../workflow-orchestrator/renderer/src/views/requirements.css) | 五个主视图 |
| `workflow-orchestrator/renderer/vite.config.ts` | [workflow-orchestrator/renderer/vite.config.ts](../workflow-orchestrator/renderer/vite.config.ts) | 工程配置/入口 |
| `workflow-orchestrator/scripts/build.mjs` | [workflow-orchestrator/scripts/build.mjs](../workflow-orchestrator/scripts/build.mjs) | 开发、构建、启动、打包和验收命令 |
| `workflow-orchestrator/scripts/dev.mjs` | [workflow-orchestrator/scripts/dev.mjs](../workflow-orchestrator/scripts/dev.mjs) | 开发、构建、启动、打包和验收命令 |
| `workflow-orchestrator/scripts/package-release.mjs` | [workflow-orchestrator/scripts/package-release.mjs](../workflow-orchestrator/scripts/package-release.mjs) | 开发、构建、启动、打包和验收命令 |
| `workflow-orchestrator/scripts/run-verify.mjs` | [workflow-orchestrator/scripts/run-verify.mjs](../workflow-orchestrator/scripts/run-verify.mjs) | 开发、构建、启动、打包和验收命令 |
| `workflow-orchestrator/scripts/serve-web.mjs` | [workflow-orchestrator/scripts/serve-web.mjs](../workflow-orchestrator/scripts/serve-web.mjs) | 开发、构建、启动、打包和验收命令 |
| `workflow-orchestrator/scripts/start.mjs` | [workflow-orchestrator/scripts/start.mjs](../workflow-orchestrator/scripts/start.mjs) | 开发、构建、启动、打包和验收命令 |
| `workflow-orchestrator/src/adapters/acp-client.ts` | [workflow-orchestrator/src/adapters/acp-client.ts](../workflow-orchestrator/src/adapters/acp-client.ts) | API/CLI/ACP 能力适配、工具及资源槽 |
| `workflow-orchestrator/src/adapters/cli-stream.ts` | [workflow-orchestrator/src/adapters/cli-stream.ts](../workflow-orchestrator/src/adapters/cli-stream.ts) | API/CLI/ACP 能力适配、工具及资源槽 |
| `workflow-orchestrator/src/adapters/contracts.ts` | [workflow-orchestrator/src/adapters/contracts.ts](../workflow-orchestrator/src/adapters/contracts.ts) | 请求/响应与领域契约 |
| `workflow-orchestrator/src/adapters/index.ts` | [workflow-orchestrator/src/adapters/index.ts](../workflow-orchestrator/src/adapters/index.ts) | API/CLI/ACP 能力适配、工具及资源槽 |
| `workflow-orchestrator/src/adapters/native-api.ts` | [workflow-orchestrator/src/adapters/native-api.ts](../workflow-orchestrator/src/adapters/native-api.ts) | API/CLI/ACP 能力适配、工具及资源槽 |
| `workflow-orchestrator/src/adapters/resource-broker.ts` | [workflow-orchestrator/src/adapters/resource-broker.ts](../workflow-orchestrator/src/adapters/resource-broker.ts) | API/CLI/ACP 能力适配、工具及资源槽 |
| `workflow-orchestrator/src/adapters/tool-runner.ts` | [workflow-orchestrator/src/adapters/tool-runner.ts](../workflow-orchestrator/src/adapters/tool-runner.ts) | API/CLI/ACP 能力适配、工具及资源槽 |
| `workflow-orchestrator/src/core/cognitive.ts` | [workflow-orchestrator/src/core/cognitive.ts](../workflow-orchestrator/src/core/cognitive.ts) | 规格、规划、图编译、试运行、策略、成本及知识规则 |
| `workflow-orchestrator/src/core/ddd.ts` | [workflow-orchestrator/src/core/ddd.ts](../workflow-orchestrator/src/core/ddd.ts) | 规格、规划、图编译、试运行、策略、成本及知识规则 |
| `workflow-orchestrator/src/core/index.ts` | [workflow-orchestrator/src/core/index.ts](../workflow-orchestrator/src/core/index.ts) | 规格、规划、图编译、试运行、策略、成本及知识规则 |
| `workflow-orchestrator/src/core/pm-planner.ts` | [workflow-orchestrator/src/core/pm-planner.ts](../workflow-orchestrator/src/core/pm-planner.ts) | 规格、规划、图编译、试运行、策略、成本及知识规则 |
| `workflow-orchestrator/src/core/policy.ts` | [workflow-orchestrator/src/core/policy.ts](../workflow-orchestrator/src/core/policy.ts) | 规格、规划、图编译、试运行、策略、成本及知识规则 |
| `workflow-orchestrator/src/core/presets.ts` | [workflow-orchestrator/src/core/presets.ts](../workflow-orchestrator/src/core/presets.ts) | 规格、规划、图编译、试运行、策略、成本及知识规则 |
| `workflow-orchestrator/src/core/spec-parser.ts` | [workflow-orchestrator/src/core/spec-parser.ts](../workflow-orchestrator/src/core/spec-parser.ts) | 规格、规划、图编译、试运行、策略、成本及知识规则 |
| `workflow-orchestrator/src/core/telemetry.ts` | [workflow-orchestrator/src/core/telemetry.ts](../workflow-orchestrator/src/core/telemetry.ts) | 规格、规划、图编译、试运行、策略、成本及知识规则 |
| `workflow-orchestrator/src/core/trial-simulator.ts` | [workflow-orchestrator/src/core/trial-simulator.ts](../workflow-orchestrator/src/core/trial-simulator.ts) | 规格、规划、图编译、试运行、策略、成本及知识规则 |
| `workflow-orchestrator/src/core/twin-graph.ts` | [workflow-orchestrator/src/core/twin-graph.ts](../workflow-orchestrator/src/core/twin-graph.ts) | 规格、规划、图编译、试运行、策略、成本及知识规则 |
| `workflow-orchestrator/src/core/validator.ts` | [workflow-orchestrator/src/core/validator.ts](../workflow-orchestrator/src/core/validator.ts) | 规格、规划、图编译、试运行、策略、成本及知识规则 |
| `workflow-orchestrator/src/electron/main.ts` | [workflow-orchestrator/src/electron/main.ts](../workflow-orchestrator/src/electron/main.ts) | Electron 主进程与隔离 preload 桥 |
| `workflow-orchestrator/src/electron/preload.ts` | [workflow-orchestrator/src/electron/preload.ts](../workflow-orchestrator/src/electron/preload.ts) | Electron 主进程与隔离 preload 桥 |
| `workflow-orchestrator/src/engines/certifier.ts` | [workflow-orchestrator/src/engines/certifier.ts](../workflow-orchestrator/src/engines/certifier.ts) | PM、规划器、运行状态机、认证与知识整合 |
| `workflow-orchestrator/src/engines/dreaming.ts` | [workflow-orchestrator/src/engines/dreaming.ts](../workflow-orchestrator/src/engines/dreaming.ts) | PM、规划器、运行状态机、认证与知识整合 |
| `workflow-orchestrator/src/engines/index.ts` | [workflow-orchestrator/src/engines/index.ts](../workflow-orchestrator/src/engines/index.ts) | PM、规划器、运行状态机、认证与知识整合 |
| `workflow-orchestrator/src/engines/orchestrator.ts` | [workflow-orchestrator/src/engines/orchestrator.ts](../workflow-orchestrator/src/engines/orchestrator.ts) | PM、规划器、运行状态机、认证与知识整合 |
| `workflow-orchestrator/src/engines/planner.ts` | [workflow-orchestrator/src/engines/planner.ts](../workflow-orchestrator/src/engines/planner.ts) | PM、规划器、运行状态机、认证与知识整合 |
| `workflow-orchestrator/src/engines/pm-agent.ts` | [workflow-orchestrator/src/engines/pm-agent.ts](../workflow-orchestrator/src/engines/pm-agent.ts) | PM、规划器、运行状态机、认证与知识整合 |
| `workflow-orchestrator/src/engines/workflow-handler.ts` | [workflow-orchestrator/src/engines/workflow-handler.ts](../workflow-orchestrator/src/engines/workflow-handler.ts) | PM、规划器、运行状态机、认证与知识整合 |
| `workflow-orchestrator/src/sandbox/contracts.ts` | [workflow-orchestrator/src/sandbox/contracts.ts](../workflow-orchestrator/src/sandbox/contracts.ts) | 请求/响应与领域契约 |
| `workflow-orchestrator/src/sandbox/git-worktree.ts` | [workflow-orchestrator/src/sandbox/git-worktree.ts](../workflow-orchestrator/src/sandbox/git-worktree.ts) | 命令执行、路径边界、Git Worktree、检查点及恢复 |
| `workflow-orchestrator/src/sandbox/index.ts` | [workflow-orchestrator/src/sandbox/index.ts](../workflow-orchestrator/src/sandbox/index.ts) | 命令执行、路径边界、Git Worktree、检查点及恢复 |
| `workflow-orchestrator/src/sandbox/process-runner.ts` | [workflow-orchestrator/src/sandbox/process-runner.ts](../workflow-orchestrator/src/sandbox/process-runner.ts) | 命令执行、路径边界、Git Worktree、检查点及恢复 |
| `workflow-orchestrator/src/server/http-router.ts` | [workflow-orchestrator/src/server/http-router.ts](../workflow-orchestrator/src/server/http-router.ts) | 60 个路由、鉴权、静态文件和 SSE |
| `workflow-orchestrator/src/server/index.ts` | [workflow-orchestrator/src/server/index.ts](../workflow-orchestrator/src/server/index.ts) | HTTP、SSE、密钥保险库和宿主装配 |
| `workflow-orchestrator/src/server/runtime.ts` | [workflow-orchestrator/src/server/runtime.ts](../workflow-orchestrator/src/server/runtime.ts) | 装配三个子系统与恢复服务 |
| `workflow-orchestrator/src/server/secret-vault.ts` | [workflow-orchestrator/src/server/secret-vault.ts](../workflow-orchestrator/src/server/secret-vault.ts) | HTTP、SSE、密钥保险库和宿主装配 |
| `workflow-orchestrator/src/shared/api.ts` | [workflow-orchestrator/src/shared/api.ts](../workflow-orchestrator/src/shared/api.ts) | 领域类型、HTTP/SSE DTO、校验与错误 |
| `workflow-orchestrator/src/shared/errors.ts` | [workflow-orchestrator/src/shared/errors.ts](../workflow-orchestrator/src/shared/errors.ts) | 领域类型、HTTP/SSE DTO、校验与错误 |
| `workflow-orchestrator/src/shared/types.ts` | [workflow-orchestrator/src/shared/types.ts](../workflow-orchestrator/src/shared/types.ts) | 规范领域类型与状态枚举 |
| `workflow-orchestrator/src/shared/validation.ts` | [workflow-orchestrator/src/shared/validation.ts](../workflow-orchestrator/src/shared/validation.ts) | 领域类型、HTTP/SSE DTO、校验与错误 |
| `workflow-orchestrator/src/store/database.ts` | [workflow-orchestrator/src/store/database.ts](../workflow-orchestrator/src/store/database.ts) | SQLite 迁移、种子数据和存取 |
| `workflow-orchestrator/src/store/index.ts` | [workflow-orchestrator/src/store/index.ts](../workflow-orchestrator/src/store/index.ts) | SQLite 初始化、迁移、内置数据和事务存取 |
| `workflow-orchestrator/src/store/schema.ts` | [workflow-orchestrator/src/store/schema.ts](../workflow-orchestrator/src/store/schema.ts) | 数据库或运行时校验结构 |
| `workflow-orchestrator/tsconfig.json` | [workflow-orchestrator/tsconfig.json](../workflow-orchestrator/tsconfig.json) | 工程配置/入口 |
| `workflow-orchestrator/tsconfig.renderer.json` | [workflow-orchestrator/tsconfig.renderer.json](../workflow-orchestrator/tsconfig.renderer.json) | 工程配置/入口 |
| `workflow-orchestrator/verify/fullstack-smoke.verify.ts` | [workflow-orchestrator/verify/fullstack-smoke.verify.ts](../workflow-orchestrator/verify/fullstack-smoke.verify.ts) | 自动化验收 |
| `workflow-orchestrator/verify/orchestrator-and-sandbox.verify.ts` | [workflow-orchestrator/verify/orchestrator-and-sandbox.verify.ts](../workflow-orchestrator/verify/orchestrator-and-sandbox.verify.ts) | 自动化验收 |
| `workflow-orchestrator/verify/planner-and-validator.verify.ts` | [workflow-orchestrator/verify/planner-and-validator.verify.ts](../workflow-orchestrator/verify/planner-and-validator.verify.ts) | 自动化验收 |

## 全部参考文档目录

- `README.md`：SE-TeamPrjoect
- `requirements-engineering/README.md`：HAMA-Loop 需求工程
- `software-design/README.md`：软件设计 · 从需求基线到 PM Agent
- `software-design/campus-design-review.md`：校园活动报名 · 设计评审稿
- `software-design/campus-design-spec.md`：教学案例 · 校园服务平台移动端活动报名
- `software-design/checkoutlist.md`：软件设计实施与上下游交接清单
- `software-design/design-spec-template.md`：通用 Design Spec 编写模板
- `software-design/implementation-plan.md`：通用软件设计阶段 · 实现与验收方案
- `software-design/subsystem-design.md`：软件设计子系统设计说明
- `software-design/verify/step1-verification.md`：步骤 1 验证记录
- `software-design/verify/step2-verification.md`：步骤 2 验证记录
- `software-design/verify/step3-verification.md`：步骤 3 验证记录
- `software-design/verify/step4-verification.md`：步骤 4 验证记录
- `software-design/verify/step5-verification.md`：步骤 5 验证记录
- `software-design/verify/step6-evidence/summary.md`：第 6 部分交接验收总表
- `software-design/verify/step6-verification.md`：步骤 6：PRD 转换与 PM 签收验收
- `workflow-orchestrator/README.md`：Workflow Orchestrator (`workflow-orchestrator`)
- `workflow-orchestrator/docs/CHANGELOG.md`：Changelog (`workflow-orchestrator`)
- `workflow-orchestrator/docs/CHECKLIST.md`：Implementation & Push Checklist (`workflow-orchestrator`)
- `workflow-orchestrator/docs/DESIGN-ALIGNMENT.md`：Design Alignment Matrix (Team V2.0 General Design <-> Twin-Graph Implementation)
- `workflow-orchestrator/docs/SPEC.md`：Workflow Orchestrator — Technical Specification
