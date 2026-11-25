# Changelog (`workflow-orchestrator`)

## v0.2.0 — General Customizable SE Workflow, PM Agent & Engineering Subsystems
- **General Design-Spec-to-Workflow Pipeline**: Added `PmAgentDecomposer` (`src/engines/pm-agent.ts`), SE Workflow Customization templates (`fullstack_se`, `microservice_hardened`, `rapid_ui_api`, `custom`), multi-module `## Modules` parsing, 3 switchable built-in product Design Spec test cases (`src/core/presets.ts`), `.md`/`.txt` spec upload, and one-click Plan Export (`Markdown WBS` / `Mermaid DAG` / `JSON`).
- **DDD Ubiquitous Language & Terminology Drift Guard**: Added `src/core/ddd.ts` + SQLite `domain_terms` table + validator Level-4 `ddd_drift` checks + prompt injection + interactive DDD glossary tab.
- **SkillsBank, Sleep-Time Dreaming & Ebbinghaus Re-hydration**: Added `src/core/cognitive.ts` + `src/engines/dreaming.ts` (`CognitiveConsolidator`) + `skills` table + Re-hydration capsule strip in `WorkstationView` and `RunsAuditView` with human Re-Anchor tracking.
- **MCP Server Pool, Constitution Guardrails & Env Doctor Worktree Cleanup**: Added `mcp_servers` & `constitution_rules` tables, live blocked-command enforcement in `SandboxProcessRunner` + `ExecutionCertifier`, orphan Git worktree pruning (`cleanupOrphanWorktrees`) in `POST /api/doctor`, and `sovereignSoul` inline editing.
- **Cost & Token Cache Telemetry**: Tracked `inputTokens`, `cachedTokens`, `outputTokens`, `spentUsd`, and `budgetUsdLimit` per attempt and run.
- **Release Packaging**: Built `WorkflowOrchestrator-v0.2.0-win32-x64-desktop.zip` and `WorkflowOrchestrator-v0.2.0-portable-web.zip` with extracted runtime smoke checks.

## v0.1.0 — Release Packaging & Verification
- Added `scripts/package-release.mjs` (`npm run package:release`) building standalone `WorkflowOrchestrator-v0.1.0-win32-x64-desktop.zip` (`WorkflowOrchestrator.exe`, zero-dependency Electron 44 + embedded Node 24 / `node:sqlite`) and `WorkflowOrchestrator-v0.1.0-portable-web.zip` (`Start-Demo.bat` / `start-demo.sh`).
- Updated built-in default sample workspace & gate commands to `echo Verification gate passed` so standalone demo executables require no external Node binary on `PATH`.
- Added lean verification suite (`verify/planner-and-validator.verify.ts`, `verify/orchestrator-and-sandbox.verify.ts`, `verify/fullstack-smoke.verify.ts`) covering PRD parsing, 3-level validation, fail-closed version locking, isolated Git worktree execution, Human Gate suspension/approval, runtime `GhostNode` splicing, conditional branch skipping, bounded `Restore` rework via Git rescue refs, FTS5 search, Bearer auth, and SSE.
- Fixed `computeNextFrontier` fail-edge OR triggering for recovery nodes with multiple upstream failure sources and enabled multi-iteration `restore` re-arming within rework budget.
- Added standalone pure-Node loopback web launcher (`scripts/serve-web.mjs` via `npm run start:web`).

## v0.1.0 — Milestone 4: Light DirectUI Workbench Renderer (`ZH` / `EN`)
- Implemented light-mode React 19 + `@xyflow/react` 12 workbench across `WorkflowsView`, `WorkstationView`, `CapabilitiesView`, and `RunsAuditView` with bilingual `ZH` / `EN` switching and live SSE updates.

## v0.1.0 — Milestone 3: Sandbox, Adapters, Orchestrator Engine & Daemon
- Implemented `GitWorktreeManager`, `SandboxProcessRunner`, `CapabilityHub`, `WorkflowPlannerEngine`, `ExecutionCertifier`, `WorkflowOrchestratorEngine`, loopback HTTP/SSE server (`127.0.0.1`), Electron 44 main/preload shell, and esbuild/Vite build pipeline.

## v0.1.0 — Milestone 2: Domain Core & SQLite Store
- Implemented `GoalSpec` Markdown parser, WBS + Twin-Graph planner, 3-level validator, Change Impact Analyzer, Trial Run simulator, and `node:sqlite` WAL + FTS5 persistence store with seeded sample workflow.

## v0.1.0 — Milestone 1: Subsystem Scaffold & Design Alignment
- Initialized subsystem package configuration, TypeScript/ESLint/Prettier tooling, and alignment documentation against the V2.0 workflow design spec.
