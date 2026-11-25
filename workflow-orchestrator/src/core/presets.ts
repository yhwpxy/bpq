import type {
  BuiltinDesignSpecPreset,
  WorkflowCustomization,
} from '../shared/types.ts';

export const DEFAULT_WORKFLOW_CUSTOMIZATION: WorkflowCustomization = {
  templatePreset: 'fullstack_se',
  includeHumanGate: true,
  includeSecurityPass: true,
  includeQaAudit: true,
  maxParallelWorkers: 3,
  dddStrictCheck: true,
  pmAgentMode: 'hybrid_llm',
  budgetUsdLimit: 2.5,
};

export const BUILTIN_DESIGN_SPEC_PRESETS: readonly BuiltinDesignSpecPreset[] = [
  {
    id: 'preset-se-orchestrator',
    nameZh: '案例一：通用多智能体 SE 工作流编排台',
    nameEn: 'Case 1: Multi-Agent SE Workflow Workbench',
    categoryZh: '研发效能 · 系统测试案例',
    categoryEn: 'SE Tooling · Reference Case',
    recommendedTemplate: 'fullstack_se',
    markdown: `# Design Spec: Multi-Agent SE Workflow Workbench

## Goal
Build a general, customizable SE workflow orchestration engine that ingests any product Design Spec, runs a PM Agent for modular development task decomposition, compiles a verified Twin-Graph DAG, and visualizes live execution with deterministic recovery checkpoints.

## Modules
- **SpecParser & PM Decomposer** (\`src/core/**\`): Parse Design Spec sections, extract architecture modules, and generate parallel WBS task slices with traceability refs.
- **Orchestrator & Certifier** (\`src/engines/**\`): Schedule ready frontier nodes, run deterministic shell gates, self-check invariants, and execute bounded fail-rewind checkpoints.
- **SQLite Persistence & Governance** (\`src/store/**\`): Persist workflows, DDD ubiquitous glossary, Ebbinghaus cognitive re-hydration capsules, and engineering constitution guardrails.
- **Interactive DirectUI Topology Workbench** (\`renderer/src/**\`): Render phase containers, live execution DAG, token/cost telemetry, and one-click WBS/Mermaid plan exports.

## Requirements
- **FR-01**: Ingest Markdown Design Specs and extract Goal, Modules, Functional Requirements, Constraints, and Acceptance Criteria automatically.
- **FR-02**: PM Agent decomposes development tasks dynamically per architecture module and maps each slice to non-overlapping file scopes.
- **FR-03**: Support customizable SE workflow templates (Fullstack SE, Hardened Microservice, Rapid UI+API, Custom toggles for Human Gate / Security Audit / QA).
- **FR-04**: Enforce deterministic verification shell gates and automated self-check + DDD terminology drift validation prior to completion.
- **FR-05**: Export synthesized WBS decomposition plans in Markdown and Mermaid flowchart formats.

## Constraints
- Maintain fail-closed verification gates and bounded rework iterations (1..20).
- Prevent cross-worker file scope collisions across parallel Phase 2 task slices.
- Block destructive commands registered in the Engineering Constitution.

## Acceptance Criteria
- **AC-01**: \`echo Typecheck and unit verification gate passed\`
- **AC-02**: Every functional requirement maps to at least one Twin-Graph task node and appears in exported WBS Markdown.
- **AC-03**: DDD terminology checker flags forbidden aliases when strict DDD check is enabled.

## Domain Rules
- Human sign-off gate must succeed before parallel workspace mutations begin when Human Gate is enabled.
- Every QA failure edge triggers bounded rescue rewind before re-arming downstream execution.
`,
  },
  {
    id: 'preset-course-enrollment',
    nameZh: '案例二：智慧校园高并发选课与排课系统',
    nameEn: 'Case 2: Smart Campus Course Enrollment System',
    categoryZh: '教务系统 · 高并发案例',
    categoryEn: 'Campus SaaS · High-Concurrency Case',
    recommendedTemplate: 'microservice_hardened',
    markdown: `# Design Spec: Smart Campus Course Enrollment & Scheduling Platform

## Goal
Deliver a race-free course registration and intelligent timetable solver supporting 20,000 concurrent student logins, prerequisite verification, waitlist promotion, and dean override auditing.

## Modules
- **Enrollment Seat Lock Service** (\`src/enrollment/**\`): Atomic optimistic-lock seat reservation, waitlist FIFO promotion, and drop-add idempotency tokens.
- **Timetable Conflict Engine** (\`src/scheduler/**\`): Credit cap checks, time-slot collision matrices, and prerequisite DAG verification.
- **Campus SSO & Dean Audit API** (\`src/auth/**\`): Role-based JWT claims for student/advisor/registrar and immutable override ledger.
- **Student Registration Portal** (\`renderer/src/portal/**\`): Live course shopping cart, weekly grid preview, and instant waitlist status updates.

## Requirements
- **FR-01**: Implement idempotent seat reservation transactions preventing oversubscription under concurrent burst traffic.
- **FR-02**: Validate student prerequisites, corequisites, and weekly time-slot collisions before confirming enrollment.
- **FR-03**: Auto-promote eligible waitlisted students whenever a confirmed seat is dropped and emit notification events.
- **FR-04**: Provide registrar manual capacity override endpoints protected by strict RBAC and immutable audit logs.
- **FR-05**: Render real-time timetable conflict warnings in the student enrollment portal.

## Constraints
- Seat reservation API p99 latency under 120ms for burst batches.
- Zero negative remaining capacity invariants under SQLite/Postgres transactions.
- Strict compliance with FERPA student record access roles.

## Acceptance Criteria
- **AC-01**: \`echo Enrollment concurrency and timetable verification passed\`
- **AC-02**: Simulated 500 concurrent requests for 50 seats yield exact 50 confirmed + 450 waitlisted with zero oversell.
- **AC-03**: Security review confirms registrar-only routes reject student tokens with HTTP 403.

## Domain Rules
- Use canonical domain term \`EnrollmentTicket\` rather than ambiguous \`Booking\` or \`Reservation\`.
- Waitlist promotion requires prerequisite satisfaction at promotion time.
`,
  },
  {
    id: 'preset-ledger-settlement',
    nameZh: '案例三：多币种实时清算账本微服务',
    nameEn: 'Case 3: Multi-Currency Settlement Ledger Service',
    categoryZh: '金融账务 · 对账闭环案例',
    categoryEn: 'FinTech · Double-Entry Ledger Case',
    recommendedTemplate: 'rapid_ui_api',
    markdown: `# Design Spec: Multi-Currency Clearing & Settlement Ledger

## Goal
Create a double-entry clearing ledger service supporting USD/EUR/CNY/HKD accounts, immutable FX rate snapshots, idempotent payout settlement, and automated daily T+1 reconciliation reports.

## Modules
- **Double-Entry Posting Kernel** (\`src/ledger/**\`): Enforce debit-credit zero-sum invariants across multi-currency journal postings using integer minor units.
- **FX Snapshot & Conversion Engine** (\`src/fx/**\`): Freeze bid/ask exchange rate quotes per clearing batch with expiry validation.
- **Settlement Webhook & Reconciliation API** (\`src/reconcile/**\`): Signed HMAC webhook ingestion and automated discrepancy flagging.

## Requirements
- **FR-01**: Record every transfer as balanced debit and credit journal entries stored in integer cents/minor units (no floating-point currency math).
- **FR-02**: Bind each cross-currency posting to an immutable FX quote ID with expiration check.
- **FR-03**: Verify clearing-house webhook signatures and deduplicate replayed settlement callbacks by idempotency key.
- **FR-04**: Generate downloadable daily reconciliation summary highlighting unmatched external ledger items.

## Constraints
- Never use IEEE-754 float types for monetary balances.
- All ledger entries are append-only; corrections must post reversing journal entries.

## Acceptance Criteria
- **AC-01**: \`echo Ledger double-entry zero-sum and FX test passed\`
- **AC-02**: Trial balance sum across all accounts equals zero after 1,000 randomized postings.
- **AC-03**: Expired FX quotes are rejected fail-closed with deterministic error codes.

## Domain Rules
- Always use canonical \`JournalEntry\` and \`PostingLeg\`, avoiding \`TransactionRow\` or \`MoneyFloat\`.
`,
  },
];
