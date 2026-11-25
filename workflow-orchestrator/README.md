# Workflow Orchestrator (`workflow-orchestrator`)

Design-Spec-to-Execution Customizable SE Workflow Orchestration Subsystem (`v0.2.0`).

This subsystem takes **any product's Design Spec (`Markdown`)**, invokes a **Hybrid PM Agent Decomposer** (`PmAgentDecomposer`), compiles a **general, customizable SE Workflow & Twin-Graph** (where concrete software projects act as switchable built-in test cases), runs **4-level validation (structural + contract + capability + DDD terminology drift)**, simulates isolated Dry-Run trials, locks immutable versions, and orchestrates multi-node execution inside isolated Git worktrees with **SkillsBank + Sleep-Time Dreaming**, **Ebbinghaus Human × Agent Re-hydration**, **MCP Server Pool**, **Engineering Constitution sandboxing**, and **USD/Token cost telemetry**.

## Quick Start

Requirements: **Node.js >= 24.0.0** (uses native `node:sqlite`) and **Git** on `PATH`.

```bash
cd workflow-orchestrator
npm install
npm run typecheck
npm run build
npm run verify:gates
```

### Prebuilt Downloadable Demo (Zero-Build Launch)

Download from **GitHub Releases (`v0.2.0`)** or generate locally with `npm run package:release`:

1. **`WorkflowOrchestrator-v0.2.0-win32-x64-desktop.zip`** — Standalone Windows x64 Electron Desktop App (no Node.js or `npm install` needed): unzip and double-click `WorkflowOrchestrator.exe`.
2. **`WorkflowOrchestrator-v0.2.0-portable-web.zip`** — Lightweight cross-platform bundle (requires Node.js >= 24): double-click `Start-Demo.bat` (Windows) or run `./start-demo.sh` (macOS/Linux) to launch and open the browser workbench automatically.

### Launch Modes from Source

- **Web Workbench (pure Node 24 + loopback HTTP/SSE)**:
  ```bash
  npm run start:web
  ```
  Prints a tokenized `http://127.0.0.1:4190/?apiBaseUrl=...&token=...` URL ready to open in any browser.
- **Electron 44 Desktop Workbench**:
  ```bash
  npm start
  ```
  Requires the Chromium Electron runtime binary (installed during `npm install` when online).
- **Development Mode (Vite HMR + live backend watch)**:
  ```bash
  npm run dev
  ```

## Architecture Overview

| Layer | Directory / Entry | Responsibility |
| --- | --- | --- |
| **Shared Contracts** | `src/shared/` (`types.ts`, `api.ts`, `validation.ts`, `errors.ts`) | Domain models, HTTP/SSE DTOs, strict JSON validators, fail-closed errors |
| **Domain Core** | `src/core/` (`spec-parser.ts`, `pm-planner.ts`, `presets.ts`, `ddd.ts`, `cognitive.ts`, `twin-graph.ts`, `validator.ts`, `trial-simulator.ts`, `telemetry.ts`, `policy.ts`) | Design Spec (`## Modules`) parsing, customizable SE workflow templates & 3 built-in product test cases, Plan export (`Markdown WBS` / `Mermaid` / `JSON`), DDD terminology drift detection, Ebbinghaus cognitive retention decay math, 4-level validation, Change Impact, isolated Trial Run |
| **Persistence** | `src/store/` (`schema.ts`, `database.ts`) | `node:sqlite` WAL database (`domain_terms`, `skills`, `mcp_servers`, `constitution_rules`, `pm_reports`), transaction savepoints, FTS5 full-text evidence index |
| **Sandbox** | `src/sandbox/` (`process-runner.ts`, `git-worktree.ts`) | Symlink-safe `resolveInside` workspace confinement, live Engineering Constitution blocked-command enforcement, isolated Git worktrees + orphan pruning (`cleanupOrphanWorktrees`), Git checkpoints, non-destructive rescue refs |
| **Capabilities** | `src/adapters/` (`resource-broker.ts`, `tool-runner.ts`, `cli-stream.ts`, `acp-client.ts`, `native-api.ts`) | Concurrency slot broker, ACP client, CLI JSONL stream parser, native OpenAI-compatible / Anthropic API runner (with deterministic offline synthesis when unconfigured) |
| **Engines** | `src/engines/` (`pm-agent.ts`, `dreaming.ts`, `planner.ts`, `certifier.ts`, `orchestrator.ts`) | Hybrid LLM + structural PM Agent decomposer, Sleep-Time Dreaming & Ebbinghaus Re-hydration consolidator, draft lifecycle + version freezing, shell gate & QA certification, concurrent frontier orchestration with USD/token cost tracking |
| **Host & Desktop** | `src/server/` (`http-router.ts`, `secret-vault.ts`, `runtime.ts`), `src/electron/` | `127.0.0.1` loopback HTTP REST + multiplexed SSE with Bearer auth, Electron 44 sandboxed window shell |
| **Workbench UI** | `renderer/src/` (`WorkflowsView.tsx`, `WorkstationView.tsx`, `CapabilitiesView.tsx`, `RunsAuditView.tsx`, `TwinGraphCanvas.tsx`) | Crisp Light DirectUI (`#f8fafc` / `#ffffff`) workbench (`ZH`/`EN`): Design Spec test case switcher & `.md` upload, SE workflow customization, WBS/Mermaid export, Re-hydration capsules, SkillsBank/Dreaming, MCP Pool, DDD Glossary, Constitution Guardrails |
| **Verification** | `verify/` (`planner-and-validator.verify.ts`, `orchestrator-and-sandbox.verify.ts`, `fullstack-smoke.verify.ts`) | End-to-end automated verification gates |

## Design Documentation

- [`docs/SPEC.md`](./docs/SPEC.md) — Formal four-layer technical specification
- [`docs/DESIGN-ALIGNMENT.md`](./docs/DESIGN-ALIGNMENT.md) — Mapping between V2.0 workflow orchestration requirements and modern implementation choices
- [`docs/CHECKLIST.md`](./docs/CHECKLIST.md) — Incremental implementation & verification checklist
- [`docs/CHANGELOG.md`](./docs/CHANGELOG.md) — Milestone delivery log
