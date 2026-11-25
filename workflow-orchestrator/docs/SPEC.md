# Workflow Orchestrator — Technical Specification

## 1. Subsystem Boundary
`workflow-orchestrator` starts at the moment a confirmed Requirements Document (Markdown PRD / Spec) enters the system and carries it through autonomous planning, validation, dry-run verification, immutable version locking, and real-time multi-node orchestration until certified completion.

## 2. Four-Layer Architecture

### 2.1 Specification & Modeling Layer (`src/core/spec-parser.ts`, `src/core/validator.ts`)
- **GoalSpec Extraction**: Parses incoming Markdown requirements into:
  - `goal`: Top-level objective statement
  - `inputs` & `outputs`: Explicit data/file contracts
  - `constraints`: Security, latency, style, or verification constraints
  - `requirements[]`: Indexed functional requirements (`FR-01`, `FR-02`, ...)
  - `acceptanceCriteria[]`: Indexed acceptance criteria (`AC-01`, `AC-02`, ...)
  - `assumptions[]`: Traceable assumptions annotated with source (`doc` | `suggested` | `user_confirmed`)
- **3-Level Validation (`validateWorkflowSpec`)**:
  - *Level 1 (Structural & Cycle Integrity)*: Acyclicity of forward DAG (`hasForwardCycle`), reachability from `Start`, reachability of `Done`, bounded rework loop targets.
  - *Level 2 (Requirement & Contract Mapping)*: Every active `FR-xx` / `AC-xx` mapped to at least one graph node; upstream `outputContract` compatibility with downstream `inputContract`.
  - *Level 3 (Capability & Conflict Policy)*: Matched executor capability exists and is not `circuit_open` (hard `Error`); parallel branches do not share conflicting mutable `fileScope` globs; human gates conform to active `PermissionTier` (`turbo` | `supervised` | `strict`).

### 2.2 Task Decomposition & Twin-Graph Compilation (`src/core/twin-graph.ts`)
- **Hierarchical Decomposition**: `Project -> Phase -> Task -> Subtask` compiled into an executable Twin-Graph while keeping hierarchy metadata (`phaseId`, `phaseTitle`, `parentCode`, `depth`) on every node.
- **Executor Kinds**: `agent` (LLM/coding agent via ACP/CLI/API), `tool` (deterministic workspace command/linter/test runner), `human` (explicit approval gate), `control` (`Start`, `Decision`, `Checkpoint`, `Restore`, `Join`, `Done`).
- **Planning Rationale**: Every planned node records a clear rationale explaining decomposition choices, granularity, and capability selection.
- **Dual-Mode Design & Change Impact**: Editing a draft node, edge, or requirement triggers `analyzeChangeImpact`, reporting impacted `FR-xx` references, affected downstream subgraph, modified capabilities, and whether re-trial is required.

### 2.3 Orchestration & Recovery Layer (`src/engines/`, `src/sandbox/`, `src/adapters/`)
- **Trial Run (`runTrialSimulation`)**: Non-destructive dry run on a draft workflow before confirmation: checks input/output contract chaining, capability health, simulated conditional branching, and policy compliance.
- **Immutable Version Snapshots (`workflow_versions`)**: Confirming a draft freezes `GoalSpec`, `WorkflowNodes`, `WorkflowEdges`, `ValidationReport`, and `TrialReport` into `v1`, `v2`, ...; every `Run` binds strictly to a fixed `versionId`.
- **Real-Time Parallel & Conditional Execution (`orchestrator.ts`)**:
  - Node states: `pending`, `ready`, `running`, `succeeded`, `failed`, `skipped`, `waiting_human`, `rewound`.
  - Dispatches **all** `ready` independent nodes concurrently up to `ResourceSlotBroker` limits.
  - Evaluates `Decision` / edge `branchCondition` expressions: unselected paths cleanly transition to `skipped`, unblocking downstream `Join` barriers without deadlock.
  - Supports `Pause`, `Resume`, `Retry` (node-level or failed-frontier), `Human Gate` approval/rejection, runtime `GhostNode` injection, and Git Worktree `rescue` refs + forensic checkpoint rollbacks on bounded rework.

### 2.4 Data, Audit & DirectUI Layer (`src/store/`, `src/server/`, `renderer/`)
- **`node:sqlite` WAL + FTS5 Store**: Durable transactional state across `workflows`, `workflow_versions`, `goal_specs`, `validation_reports`, `trial_reports`, `runs`, `graph_nodes`, `graph_edges`, `node_attempts`, `checkpoints`, `interventions`, `capabilities`, `models`, `sessions`, `session_messages`, and `audit_ledger`.
- **Loopback HTTP + SSE Daemon**: Single-port loopback daemon bound to `127.0.0.1` with bearer-token security and live event streaming (`run.status`, `node.status`, `attempt.log`, `intervention.created`, `checkpoint.saved`).
- **Light DirectUI Workbench**: React 19 + `@xyflow/react` 12 inside Electron 44 (`#f8fafc` / `#ffffff`, hairline dividers, `Anthropic Serif` + `Noto Serif SC`, bilingual `ZH` / `EN` UI) cleanly separating **Design Studio** (`WorkflowsView`), **Live Orchestrator** (`WorkstationView`), **Capability & Model Pool** (`CapabilitiesView`), and **Runs & Evidence Audit** (`RunsAuditView`).
