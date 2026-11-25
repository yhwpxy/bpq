# SE-TeamPrjoect

Software Engineering team project repository.

## 需求工程子系统

[HAMA-Loop](./requirements-engineering/README.md) 在现有工作台中提供原始 Idea、多智能体讨论、独立评价、人工审批、PRD 与基线确认，并向后续编排交接已批准的需求基线。

## 软件设计

[软件设计](./software-design/README.md) 负责将 HAMA 已确认的 PRD 转换为 Design Spec，并通过已有 Planner 接口提交给已实现的 PM Agent。文档规定了转换规则、设计评审、字段映射和 PM 接收回执，校园活动报名仅用于演示。

软件设计六步实现及本地集成验收已完成，覆盖非校园需求发布、设计确认、幂等签收和跨版本隔离；详见[验收记录](./software-design/verify/step6-verification.md)及[交接总表](./software-design/verify/step6-evidence/summary.md)。

## Implemented Subsystem: [`workflow-orchestrator/`](./workflow-orchestrator/README.md)

This folder implements the **Requirements-to-Execution Real-Time Workflow Orchestration Subsystem** — starting strictly from receiving a confirmed Requirements Document / PRD and carrying the pipeline end-to-end through:

1. **Specification Extraction & Validation**: Parses Markdown requirements into a structured `GoalSpec` (`FR-xx`, `AC-xx`, inputs, outputs, constraints, source-tagged `doc` / `suggested` assumptions) and enforces 3-level structural, requirement/contract, and capability/circuit checks (`Error` / `Warning` / `Info`).
2. **Task Decomposition & Twin-Graph Compilation**: Synthesizes hierarchical phases (`Phase -> Task -> Subtask`) paired with an executable **Twin-Graph** (forward execution edges, parallel branches, conditional routes, join barriers, bounded rework loops, and explicit restore checkpoints) complete with per-node **Planning Rationale**.
3. **Dual-Mode Design & Version Isolation**: Supports form + graph canvas edits, real-time **Change Impact Analysis**, isolated **Trial Run** simulation, and immutable **Version Snapshots** (`v1.0`, `v2.0`, ...) binding every live execution run.
4. **Real-Time Orchestrator & Workspace Isolation**: Executes independent ready nodes concurrently under a bounded resource-slot broker inside isolated Git Worktrees, handles conditional path skipping (`skipped`), bounded rework loops with non-destructive `refs/orchestrator-backup/...` rescue refs, human-gate suspension (`waiting_human`), pause/resume/retry controls, runtime `GhostNode` splicing, and `node:sqlite` WAL + FTS5 evidence/audit traceability over SSE.
5. **DirectUI Workbench**: Crisp Light-mode UI (`Electron 44` / standalone Web + `React 19` + `@xyflow/react` 12) with bilingual `ZH` / `EN` support.

### Scope Boundary
Upstream requirement-elicitation chatrooms, organizational knowledge hubs, and platform self-evolution daemons sit outside this subsystem; [`workflow-orchestrator/`](./workflow-orchestrator/README.md) assumes a confirmed requirements document as its entry contract.

See [`workflow-orchestrator/docs/DESIGN-ALIGNMENT.md`](./workflow-orchestrator/docs/DESIGN-ALIGNMENT.md) and [`workflow-orchestrator/docs/SPEC.md`](./workflow-orchestrator/docs/SPEC.md) for details.
