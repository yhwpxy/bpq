# Implementation & Push Checklist (`workflow-orchestrator`)

- [x] **Milestone 1 (Push 1): Repository Scaffold, Tooling Config & Design Alignment Docs**
  - [x] Root `.gitignore`, `.gitattributes`, and subsystem-scoped `README.md`
  - [x] `package.json`, `tsconfig.json`, `tsconfig.renderer.json`, `eslint.config.mjs`, `.prettierrc.json`
  - [x] `docs/SPEC.md`, `docs/DESIGN-ALIGNMENT.md`, `docs/CHECKLIST.md`
  - [x] Install dependencies (`npm install`) & push Milestone 1 to `origin main`

- [x] **Milestone 2 (Push 2): Shared Contracts, Pure Domain Core & SQLite Store**
  - [x] `src/shared/` (`errors.ts`, `types.ts`, `validation.ts`, `api.ts`)
  - [x] `src/core/` (`spec-parser.ts`, `validator.ts`, `twin-graph.ts`, `policy.ts`, `telemetry.ts`, `index.ts`)
  - [x] `src/store/` (`schema.ts`, `database.ts`, `index.ts`) with `node:sqlite` WAL + FTS5
  - [x] Verify `npm run lint` & `tsc -p tsconfig.json --noEmit`, push Milestone 2

- [x] **Milestone 3 (Push 3): Sandbox, Adapters, Orchestrator Engine & Daemon**
  - [x] `src/sandbox/` (`contracts.ts`, `process-runner.ts`, `git-worktree.ts`, `index.ts`)
  - [x] `src/adapters/` (`contracts.ts`, `resource-broker.ts`, `tool-runner.ts`, `cli-stream.ts`, `acp-client.ts`, `native-api.ts`, `index.ts`)
  - [x] `src/engines/` (`planner.ts`, `certifier.ts`, `orchestrator.ts`, `index.ts`)
  - [x] `src/server/` (`secret-vault.ts`, `http-router.ts`, `runtime.ts`) + `src/electron/` (`main.ts`, `preload.ts`) + `scripts/` (`build.mjs`, `dev.mjs`, `start.mjs`, `run-verify.mjs`)
  - [x] Verify `npm run lint`, host `tsc`, and `esbuild` main/preload build, push Milestone 3

- [x] **Milestone 4 (Push 4): Light DirectUI Workbench Renderer (`ZH` / `EN`)**
  - [x] `renderer/index.html`, `renderer/vite.config.ts`, `renderer/src/styles/theme.css`
  - [x] `renderer/src/i18n.ts`, `renderer/src/api/client.ts`, `renderer/src/components/Icons.tsx`
  - [x] `WorkflowsView` (Requirements Import -> GoalSpec -> WBS & Twin-Graph Design -> Validation -> Change Impact -> Trial Run -> Lock Version)
  - [x] `WorkstationView` (Live Flow Canvas + WBS + Node Inspector + Pause/Resume/Retry/Human Gate/GhostNode/Rollback)
  - [x] `CapabilitiesView` (Capability Pool, Models, Health/Circuit Status) + `RunsAuditView` (Versions, Runs & FTS5 Evidence Traceability)
  - [x] Verify `npm run lint`, `npm run typecheck`, `npm run build`, push Milestone 4

- [x] **Milestone 5 (Push 5): Lean Verification Gates, Smoke Check & Final README**
  - [x] `verify/planner-and-validator.verify.ts`
  - [x] `verify/orchestrator-and-sandbox.verify.ts`
  - [x] `verify/fullstack-smoke.verify.ts`
  - [x] Full `npm run lint`, `npm run typecheck`, `npm run build`, `npm run verify:gates`, loopback `start:web` smoke (`ORCH_SMOKE_EXIT=1`), push

- [x] **Release `v0.1.0`: Prebuilt Downloadable Demo Artifacts**
  - [x] `scripts/package-release.mjs` (`npm run package:release`) generating `WorkflowOrchestrator-v0.1.0-win32-x64-desktop.zip` (`WorkflowOrchestrator.exe`) & `WorkflowOrchestrator-v0.1.0-portable-web.zip` (`Start-Demo.bat` / `start-demo.sh`)
  - [x] Extracted archive smoke checks passed for both desktop EXE (`ORCH_SMOKE_EXIT=1`) and portable web bundle (`Smoke /api/health HTTP 200`), uploaded to GitHub Release `v0.1.0`

- [x] **Milestone 6 (`v0.2.0`): General Customizable SE Workflow & Advanced Subsystems**
  - [x] `src/core/` (`presets.ts`, `pm-planner.ts`, `ddd.ts`, `cognitive.ts`) + `src/engines/` (`pm-agent.ts`, `dreaming.ts`)
  - [x] `src/store/` (`domain_terms`, `skills`, `mcp_servers`, `constitution_rules`, `pm_reports`, token/USD cost columns)
  - [x] `src/sandbox/` (`setBlockedCommandPatterns`, `cleanupOrphanWorktrees`) + HTTP/SSE endpoints (`/api/workflows/:id/export`, `/review-anchor`, `/ddd-terms`, `/skills`, `/dream/consolidate`, `/mcp-servers`, `/constitution`, `/doctor`)
  - [x] Light DirectUI Workbench upgrades across `WorkflowsView`, `WorkstationView`, `CapabilitiesView`, `RunsAuditView`
  - [x] `verify/*.verify.ts` gates expanded & passed + `v0.2.0` desktop/web release archives built, smoke-tested, pushed to `origin main`, and published on GitHub Releases
