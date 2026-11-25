# HAMA-Loop 需求工程

在 Workflow Orchestrator 的「需求工程」页提交 Idea。运行使用同一套 Twin-Graph、SQLite、人工等待、运行日志和暂停恢复机制。工件和人工决定绑定 Workflow、Run 和 Attempt，HAMA 节点在宿主数据目录 `document-runs/` 下运行。

## 启动与校园演示

在 Node.js 24 环境运行以下命令。已有依赖和构建产物时可直接启动对应工作台。

```sh
cd workflow-orchestrator
npm ci
npm run build
npm run start:web
```

桌面入口为 `npm start`，开发入口为 `npm run dev`。在「需求工程」页选「载入校园演示」，按提示确认是否复用校园账号、审批方案、最终确认需求。再次演示时使用新的项目 ID，或选择同一项目的最新演示基线作为父版本。演示使用确定性校园案例，基线保存在演示版本序列中。

真实运行选用「基础设施与模型池」中已配置密钥的 OpenAI 兼容或 Anthropic 模型提供商，并填写模型 ID。默认有产品、架构、开发、体验、质量五个讨论角色，可编辑、移除或添加角色。模型通过现有 CapabilityHub 走无工具的文本生成模式。每个响应使用本地 JSON Schema 和交接规则校验，每次调用含首轮在内最多三次尝试，每次请求超时 60 秒。技术故障后可以重试失败节点，或结束该运行。

## 七个阶段

| 阶段 | 运行逻辑和工件 |
| --- | --- |
| 1. Idea 输入 | 分解 Agent 形成 Idea Brief、基础需求、事实类型和澄清问题。依赖 Agent 生成依赖图。关键问题进入人工澄清。 |
| 2. 协同讨论 | Moderator 建议议程和负责人。各角色对相同议题独立提案，再阅读其他提案并提出交叉质疑。Moderator 整理本轮共识、取舍、分歧和阻塞。工件包含 Issue Board、Discussion Log、Proposal Drafts 和 Dependency Map。 |
| 3. 全局整合 | Consensus Agent 读取完整工件，生成带版本和哈希的方案。范围条目关联议题和原始来源。 |
| 4. 独立评价 | 价值、可行性、完整性、成本与风险四个节点并发评审同一方案版本。汇总规则按硬性否决、阻断、附条件、通过的顺序决策，记录涉及议题、证据、整改建议及有条件项的责任人和核验方式。 |
| 5. 方案审批 | 审批人查看方案及评价，批准、附条件批准、退回或否决。附条件审批会建立同方案版本的第二次等待，人工记录满足条件的证据或授权后继续。 |
| 6. 生成 PRD | Requirements Agent 读取获批方案与审批信息，生成与获批范围逐项关联的需求、Given/When/Then 验收标准和追踪关系。每份草案有独立版本，可导出 Markdown。 |
| 7. 需求确认 | 人工针对 PRD 版本确认范围和验收，或退回局部修订或方案级返工。发布事务冻结 PRD、稳定需求与验收编号、追踪、两道审批、版本和校验摘要。 |

A 回路重跑未收敛议题并追加记录，阻塞或超过该议题的轮次时进入人工裁决。B 回路按评价结果重开受影响议题，然后整合新版并重新独立评价。只影响全局覆盖度的缺陷可以直接回到整合。C 回路的局部问题保留方案批准，重新生成和确认 PRD。涉及方向和重大约束的改动重走讨论、整合、评价与方案审批。B、C 与方案审批退回复用同一返工额度，耗尽后进入人工升级。业务返工保留原工件、反馈、返工后的工件和复评结论。

需求 ID 由项目 ID 和方案范围 key 生成。验收 ID 由需求 ID 和验收 key 生成。跨版本延续同一条目时，应保留原 key。交接校验检查范围 key、依赖、验收结构和来源关系。人负责核对文字是否准确表达获批范围，并确认验收条件的业务有效性。

## 持久化与交接

同一 SQLite 库追加 `hama_runs`、`hama_artifacts`、`hama_gates` 和 `hama_baselines`。同一项目和模式有独立版本序列。修改已确认项目时选择最新基线，重新经历评审与确认。人工决定与节点转换使用同一事务，重复提交同一请求返回现状，当前决定与工件 ID、SHA-256 和执行尝试绑定。服务重启会保留等待中的决定请求，并重新调度中断的工作节点。部署按原宿主的单进程、回环接口模型运行。审批人由已持有宿主令牌的本地操作员填写，供审计追溯。

以下端点使用宿主 Bearer Token，具体输入结构见 [contracts.ts](./src/contracts.ts)。

| 接口 | 作用 |
| --- | --- |
| `POST /api/hama/runs` | 提交 Idea、模式、角色、模型及可选父基线 |
| `GET /api/hama/runs` | 列出运行 |
| `GET /api/hama/runs/{runId}` | 查询运行、工件、人工请求和已发布基线 |
| `POST /api/hama/runs/{runId}/gates/{gateId}` | 提交与目标版本绑定的人工决定 |
| `GET /api/hama/baselines?projectId={projectId}` | 列出项目基线版本 |
| `GET /api/hama/baselines/{baselineId}` | 读取 `ApprovedRequirementsBaseline` v1 |
| `POST /api/workflows/import-requirements` | 使用 `{baselineId, workspaceId}` 导入已确认的真实运行基线，建立后续编排草案 |

下游可以直接消费有版本的 `ApprovedRequirementsBaseline`，也可从工作台点击「导入下游编排」。后者保留基线 ID、项目 ID、版本、SHA-256、需求／验收编号和验收关联，进入既有规格校验、试运行与锁版流程。

## 文件与验证

`src/contracts.ts` 和 `src/schema.ts` 定义领域结构与输出校验，`src/agents.ts` 和 `src/demo.ts` 定义真实调用及校园演示，`src/pipeline.ts` 实现七阶段，`src/service.ts` 与 `src/graph.ts` 处理编排注册和人工决定，`src/repository.ts` 持久化，`src/markdown.ts` 生成导出。

使用 Node.js 24.4 或以上，从仓库根目录运行两组端到端测试，覆盖演示、HTTP 模型适配、输出校验失败与人工重试、A/B/C 回路、否决和升级、审批防绕过、执行或人工等待期间重启及基线交接。

```sh
node --experimental-transform-types --test requirements-engineering/verify/hama.test.ts
```

### 编排器集成改动

| 文件 | 改动 |
| --- | --- |
| `src/engines/workflow-handler.ts`、`src/engines/orchestrator.ts` | 注册领域节点、数据库事务内应用运行结果、按图返回下游节点、人工决策适配、文档工作目录、恢复及关闭。 |
| `src/adapters/contracts.ts`、`src/adapters/index.ts`、`src/adapters/native-api.ts` | 支持指定提供商、无工具文本调用、输出额度和取消。 |
| `src/engines/planner.ts`、`src/shared/types.ts` | 接收保留版本和原始 ID 的结构化基线交接。 |
| `src/server/runtime.ts`、`src/server/http-router.ts` | 装配领域模块、鉴权、路由以及旧通用操作对注册工作流的保护。 |
| `src/store/database.ts` | 启动时保留已保存的模型提供商地址，确保恢复后仍连接原配置的模型服务。 |
| `renderer/src/App.tsx`、`renderer/src/api/client.ts`、`renderer/src/views/RequirementsView.tsx`、`renderer/src/views/requirements.css`、`renderer/src/styles/theme.css` | 需求工程入口、API、运行交互、工件审阅和 TwinGraphCanvas。 |
| `tsconfig.json`、`renderer/vite.config.ts` | 编译与开发服务识别同仓库的领域源码目录。 |
