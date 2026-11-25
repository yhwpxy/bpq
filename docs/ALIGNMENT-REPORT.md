# BPQ 功能对齐报告

验收日期：2026-11-25（北京时间）。参考基线经用户确认固定为 `472cd7a5891a1a1bd22247a53197c78dc637d452`。`99d0ccb` 是其祖先，不作为本次基准。

## 结论与范围

三个子系统直接移植，137 个参考文件（包括全部业务源码、测试、样式、锁文件、原文档、示例与历史证据）逐字节一致。没有重新设计领域模型、路由、SSE、状态机、页面或 Git Worktree 行为。BPQ 身份保留在远程仓库、Git 历史、根 package.json 与中文 README；内部产品显示名称继续沿用参考工作台。

本次完成源码一致性、真实构建、参考测试、数据库及路由差分、Web 页面交互和 macOS Electron 启动检查。没有发现移植引入的业务行为差异。商业在线模型的输出质量、所有第三方 CLI/ACP/MCP 服务及 Windows/Linux 桌面运行未做实测；这些边界不以源码相同或协议夹具测试代替。

## 功能差距最终清单

下表 WO 指 `workflow-orchestrator/`。优先级表示迁移依赖顺序，最终状态“已对齐”表示参考实现已原样移植；各项测试覆盖见后文，不表示穷尽全部外部环境。

| 功能点 | 参考实现位置 | BPQ 原状 | 差距与实现路径 | 优先级 | 最终状态 |
| --- | --- | --- | --- | --- | --- |
| 三子系统工程与构建 | 三子系统目录、WO/scripts | 部分实现 | Vue/Express workspace 迁到参考组织；锁文件、构建脚本不改 | P0 | 已对齐 |
| Node/React/Electron 依赖 | WO/package*.json | 部分实现 | 保留参考精确锁定版本，根命令仅转发 | P0 | 已对齐 |
| SQLite 与 FTS5 | WO/src/store | 部分实现 | JSON 存储替换为参考 SQLite、WAL、事务与索引 | P0 | 已对齐 |
| HTTP/Bearer 鉴权 | WO/src/server/http-router.ts | 缺失 | 保留回环服务、宿主令牌和错误契约 | P0 | 已对齐 |
| SSE 实时事件 | WO/src/shared/api.ts、http-router.ts | 缺失 | 轮询替换为参考多路事件流 | P0 | 已对齐 |
| Idea 输入与澄清 | requirements-engineering/src/contracts.ts、pipeline.ts | 部分实现 | 单次分解扩为七阶段输入与关键问题澄清 | P1 | 已对齐 |
| 多角色讨论 | requirements-engineering/src/agents.ts、pipeline.ts | 缺失 | 五个默认角色、议题和交叉质疑原样移植 | P1 | 已对齐 |
| 四维独立评价 | requirements-engineering/src/pipeline.ts | 缺失 | 价值/可行性/完整性/成本风险评价与裁决 | P1 | 已对齐 |
| 人工批准与附条件批准 | requirements-engineering/src/service.ts | 缺失 | 工件、哈希、尝试绑定及二次条件等待 | P1 | 已对齐 |
| A/B/C 返工回路 | requirements-engineering/src/pipeline.ts | 缺失 | 选择性重开、局部/方案返工、限额升级 | P1 | 已对齐 |
| PRD 与需求追踪 | requirements-engineering/src/markdown.ts、contracts.ts | 缺失 | 原始需求/AC 编号、来源追踪、Markdown 导出 | P1 | 已对齐 |
| 不可变需求基线 | requirements-engineering/src/repository.ts | 缺失 | 项目版本、审批事务和重启恢复 | P1 | 已对齐 |
| 目标工程和设计输入 | software-design/src/service.ts、baseline.ts | 缺失 | 绑定真实基线、工程清单和 Git 提交 | P1 | 已对齐 |
| 设计生成与诊断 | software-design/src/generator.ts、design-validation.ts | 缺失 | 无工具模型调用、覆盖检查、失败反馈与再生成 | P1 | 已对齐 |
| 设计评审稿与 PM 预览 | software-design/src/design-render.ts | 缺失 | 同一结构化正文生成两种视图 | P1 | 已对齐 |
| 修订、送审与冻结 | software-design/src/reviews.ts | 缺失 | 原子状态转换、历史不可变、并发冲突 | P1 | 已对齐 |
| PM 输入投影 | software-design/src/pm-input.ts | 缺失 | 原需求/AC ID、归属、模块和补充检查保真 | P1 | 已对齐 |
| 原子幂等 PM 签收 | software-design/src/handoff.ts | 缺失 | 联合键去重、事务回滚、原回执恢复 | P1 | 已对齐 |
| 规格解析与任务规划 | WO/src/core/spec-parser.ts、src/engines/pm-agent.ts | 部分实现 | 原 TaskSpec 替换为参考 GoalSpec 和 PM 报告 | P1 | 已对齐 |
| 层级任务和 Twin-Graph | WO/src/core/twin-graph.ts | 部分实现 | 保留参考节点/边类型、层级与规划理由 | P1 | 已对齐 |
| 校验与影响分析 | WO/src/core/validator.ts | 部分实现 | 结构/契约/能力/DDD 术语检查与影响报告 | P1 | 已对齐 |
| 隔离试运行 | WO/src/core/trial-simulator.ts | 缺失 | 参考模拟轨迹与报告 | P1 | 已对齐 |
| 不可变工作流版本 | WO/src/engines/planner.ts | 缺失 | 锁版与运行版本绑定 | P1 | 已对齐 |
| 并行执行和资源槽 | WO/src/engines/orchestrator.ts、src/adapters/resource-broker.ts | 部分实现 | 从纯模拟调度迁到真实能力执行 | P1 | 已对齐 |
| 分支、Join、有界返工 | WO/src/engines/orchestrator.ts | 部分实现 | 保留 skipped 传播、汇合和回退语义 | P1 | 已对齐 |
| 暂停/恢复/重试/人工门禁 | WO/src/engines/orchestrator.ts | 部分实现 | 保留参考状态转换和领域保护 | P1 | 已对齐 |
| GhostNode 动态插点 | WO/src/engines/orchestrator.ts | 缺失 | 保留运行时修正节点行为 | P1 | 已对齐 |
| Worktree、检查点、rescue refs | WO/src/sandbox | 缺失 | 工作区边界、物理 Git 提交与非破坏恢复 | P1 | 已对齐 |
| API/CLI/ACP 适配 | WO/src/adapters | 部分实现 | 参考能力清单、协议和资源管理原样移植 | P1 | 已对齐；外部服务未全实测 |
| 五主视图与设计面板 | WO/renderer/src/views、components | 部分实现 | React 视图、表单、按钮、布局与跳转原样移植 | P1 | 已对齐 |
| 模型池与密钥 | WO/src/server/secret-vault.ts、CapabilitiesView.tsx | 部分实现 | 参考提供商配置和本地密钥存储 | P1 | 已对齐 |
| 日志、审计、证据检索 | WO/src/store、RunsAuditView.tsx | 部分实现 | SQLite 会话、尝试、FTS 和审计 | P1 | 已对齐 |
| Skills、MCP、DDD、工程规则 | WO/src/core、src/store、src/engines/dreaming.ts | 缺失 | 参考数据结构与管理接口原样移植 | P2 | 已对齐 |
| 演示、预设和双语 | requirements-engineering/src/demo.ts、WO/src/core/presets.ts、renderer/src/i18n.ts | 部分实现 | 全部内置数据及文案保留 | P2 | 已对齐 |
| 使用说明与 BPQ 启动入口 | 根 README.md、package.json、scripts | 部分实现 | 中文说明、根目录快捷命令、对照验收工具 | P2 | 必要适配，业务语义不变 |
| 旧 Plan JSON | 旧 shared/schema.js 等 | 已实现 | 按用户要求移除兼容入口，可从 Git 历史查看旧实现 | P2 | 明确不兼容 |

## 文件映射与契约清单

完整的 137 行「参考文件 → 当前文件」映射、目录职责和全部参考文档索引见 [REFERENCE-INVENTORY.md](REFERENCE-INVENTORY.md)。三个子系统的路径保持同名，例如：

| 参考项目文件 | BPQ 文件 |
| --- | --- |
| requirements-engineering/src/pipeline.ts | requirements-engineering/src/pipeline.ts |
| requirements-engineering/src/repository.ts | requirements-engineering/src/repository.ts |
| software-design/src/reviews.ts | software-design/src/reviews.ts |
| software-design/src/handoff.ts | software-design/src/handoff.ts |
| workflow-orchestrator/src/store/schema.ts | workflow-orchestrator/src/store/schema.ts |
| workflow-orchestrator/src/server/http-router.ts | workflow-orchestrator/src/server/http-router.ts |
| workflow-orchestrator/src/engines/orchestrator.ts | workflow-orchestrator/src/engines/orchestrator.ts |
| workflow-orchestrator/src/sandbox/git-worktree.ts | workflow-orchestrator/src/sandbox/git-worktree.ts |
| workflow-orchestrator/renderer/src/App.tsx | workflow-orchestrator/renderer/src/App.tsx |
| workflow-orchestrator/package-lock.json | workflow-orchestrator/package-lock.json |

[API-CONTRACTS.md](API-CONTRACTS.md) 列出全部 60 个方法/路径组合、请求/返回契约、SSE 事件和状态机；[SCHEMA.md](SCHEMA.md) 列出实际数据库的全部字段、主键、默认值、外键和建表 SQL，含 FTS 内部表。

`reference-manifest.json` 保存从参考提交生成的 SHA-256 清单。`npm run verify:reference` 验证全部文件并拒绝三个子系统中额外出现的源码文件，防止只对齐名称而语义另写一套。

## 本次验收结果

| 检查 | 结果与实际覆盖 |
| --- | --- |
| 参考依赖安装 | npm ci 成功；保留原锁文件 |
| 参考和 BPQ 类型/构建 | 服务端及 React 类型检查、生产构建通过；前端 JS/CSS 产物同名同尺寸 |
| 编排门禁（两边） | fullstack-smoke、orchestrator-and-sandbox、planner-and-validator 全部通过 |
| HAMA/软件设计（两边） | 14/14 测试通过，无失败、取消或跳过 |
| 源码及原资源一致性 | 137/137 文件 SHA-256 一致 |
| SQLite 差分 | 65 个表/索引/触发器等 schema 对象完全一致；41 个表含 FTS 内部表 |
| HTTP 差分 | 60 个路由对空 body/不存在 ID 的状态、响应结构、错误码及错误信息一致 |
| HTTP 鉴权 | 两边各 59 条受保护路由的未授权请求均返回 401 |
| SSE | 两边 connected 帧一致；运行 UI 显示实时连接 |
| 五个主视图 | 两边逐页打开、保存截图，对照导航、表单和空状态 |
| Web 编排操作 | 两边均试运行→锁版→发布成功；15 节点成功、2 个条件跳过 |
| HAMA 页面 | BPQ 校园演示完成澄清、评价、批准、PRD 确认与基线发布 |
| 软件设计页面 | 本地协议夹具环境完成输入、正文、修订、送审、确认、结构化 PM 输入及交接跳转；显示 PM 已签收，2 需求/4 AC 保留 |
| 语言切换 | 中英文导航正常切换 |
| Electron/macOS | ORCH_SMOKE_EXIT=1 启动并在 did-finish-load 后退出，退出码 0 |
| Git 历史 | 新分支基于 BPQ 原 main，无重建仓库、无 force push |

证据位于 [acceptance/](acceptance/)：`check.txt`、`reference-domain-tests.txt`、`parity-results.json`、`schema-inventory.json`、`desktop-check.txt` 和页面截图。根 `scripts/ui-fixture.mjs` 可复现软件设计 UI 验收环境，它只调用参考测试夹具和真实领域服务，不替换生产实现。

60 个路由探测并非对每条接口的所有合法/非法组合穷举；业务成功、冲突、回滚、并发、重启、版本隔离等由上游测试分别覆盖。在线模型质量、真实第三方 CLI/ACP/MCP 集成没有通过此方法验证，不能宣称已验证这些外部行为。

## 保留的参考行为与必要差异

1. 业务文件零修改；BPQ 仅增加根目录命令、中文使用说明、验收与映射材料。默认 Web 端口继续为 4190；对照测试使用独立端口和临时数据目录，不改变默认配置。
2. 示例工程首次启动仅登记数据库记录，首次运行才创建 Git 目录。此前生成设计会提示目标目录不存在；README 已明确先执行一次示例工作流。
3. demo 需求基线不可用于正式设计确认或 PM 签收；真实链路需要 live 模式。测试使用本地协议夹具，审批标注为模拟，未使用真实密钥。
4. 无密钥时编排器生成确定性示例产物；该成功状态不能代表目标业务产品已完整开发。HAMA live 与设计生成仍要求可用模型配置。
5. 源码中的 SSE 事件使用 attempt.updated/checkpoint.created，与部分上游文档旧称不同；保留源码行为，并在 API 清单说明。
6. 不存在对象或非法输入的部分接口沿用参考的 500 等响应；差分报告保留实际结果，不在移植时另行统一错误语义。
7. 构建保留参考的主 JS 包体积警告。依赖版本不做自动升级；npm 安装审计提示属于上游依赖状态，本次未用自动修复改变锁文件。
8. Electron 自动下载在本机未完成；使用同版本官方 GitHub 发布包，并核对安装包自带 checksums.json 的 SHA-256 后完成本地安装。未修改业务文件、未提交二进制或机器路径。
9. 旧目录、旧测试、旧截图/PPT 和旧配置从新分支移除，历史仍在原提交中。旧 Plan JSON 不迁移，未保留第二套运行时。

## 完整使用说明

根目录 [README.md](../README.md) 是完整中文使用说明，包含环境、安装、初始化、Web/桌面/开发启动、演示、模型配置、账号规则、备份和 8 条排错步骤。用户交付的单文件报告会在末尾全文附上该 README。
