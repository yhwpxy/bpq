/**
 * SQLite WAL Schema (SCHEMA_VERSION = 1) with FTS5 full-text indexes for
 * Requirements-to-Execution Workflow Orchestrator.
 */

import type {
  CapabilityAdapterManifest,
  ConstitutionRule,
  DomainTermEntry,
  McpServerEntry,
  ModelProviderConfig,
  SkillEntry,
} from '../shared/types.ts';

export const SCHEMA_VERSION = 1;

export const INITIAL_SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta_kv (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL,
  default_branch TEXT NOT NULL DEFAULT 'main',
  verify_command TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  current_version_number INTEGER NOT NULL DEFAULT 0,
  permission_tier TEXT NOT NULL DEFAULT 'supervised',
  verify_command TEXT NOT NULL,
  max_rework_iterations INTEGER NOT NULL DEFAULT 3,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS goal_specs (
  workflow_id TEXT PRIMARY KEY REFERENCES workflows(id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS validation_reports (
  workflow_id TEXT PRIMARY KEY REFERENCES workflows(id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL,
  checked_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trial_reports (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL,
  ran_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_trial_reports_wf
  ON trial_reports(workflow_id, ran_at DESC);

CREATE TABLE IF NOT EXISTS impact_reports (
  workflow_id TEXT PRIMARY KEY REFERENCES workflows(id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL,
  analyzed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workflow_versions (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  version_tag TEXT NOT NULL,
  label TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  frozen_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wf_versions_num
  ON workflow_versions(workflow_id, version_number);

CREATE TABLE IF NOT EXISTS workflow_runs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  version_id TEXT NOT NULL REFERENCES workflow_versions(id) ON DELETE RESTRICT,
  version_tag TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  permission_tier TEXT NOT NULL DEFAULT 'supervised',
  worktree_path TEXT NOT NULL DEFAULT '',
  git_branch TEXT NOT NULL DEFAULT '',
  base_commit_sha TEXT NOT NULL DEFAULT '',
  verify_command TEXT NOT NULL,
  max_rework_iterations INTEGER NOT NULL DEFAULT 3,
  rework_count INTEGER NOT NULL DEFAULT 0,
  total_nodes INTEGER NOT NULL DEFAULT 0,
  completed_nodes INTEGER NOT NULL DEFAULT 0,
  failed_nodes INTEGER NOT NULL DEFAULT 0,
  skipped_nodes INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_runs_wf ON workflow_runs(workflow_id, started_at DESC);

CREATE TABLE IF NOT EXISTS graph_nodes (
  id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL,
  code TEXT NOT NULL,
  parent_wbs_id TEXT,
  container_node_id TEXT,
  phase_id TEXT,
  phase_title TEXT NOT NULL DEFAULT '',
  depth INTEGER NOT NULL DEFAULT 1,
  kind TEXT NOT NULL,
  executor_kind TEXT NOT NULL DEFAULT 'agent',
  capability_id TEXT NOT NULL DEFAULT 'native-api',
  assigned_role TEXT NOT NULL DEFAULT 'worker',
  assigned_model TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  planning_rationale TEXT NOT NULL DEFAULT '',
  requirement_refs_json TEXT NOT NULL DEFAULT '[]',
  input_contract TEXT NOT NULL DEFAULT '',
  output_contract TEXT NOT NULL DEFAULT '',
  file_scope_json TEXT NOT NULL DEFAULT '[]',
  gate_command TEXT,
  branch_condition TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  collapsed INTEGER NOT NULL DEFAULT 0,
  position_x REAL NOT NULL DEFAULT 0,
  position_y REAL NOT NULL DEFAULT 0,
  width REAL NOT NULL DEFAULT 220,
  height REAL NOT NULL DEFAULT 76,
  output_summary TEXT NOT NULL DEFAULT '',
  restore_target_checkpoint_id TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_graph_nodes_scope ON graph_nodes(scope_id);

CREATE TABLE IF NOT EXISTS graph_edges (
  id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL,
  source_node_id TEXT NOT NULL,
  target_node_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  condition_expr TEXT
);

CREATE INDEX IF NOT EXISTS idx_graph_edges_scope ON graph_edges(scope_id);

CREATE TABLE IF NOT EXISTS node_attempts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  node_code TEXT NOT NULL,
  attempt_number INTEGER NOT NULL,
  executor_kind TEXT NOT NULL,
  capability_id TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  exit_code INTEGER,
  duration_sec REAL NOT NULL DEFAULT 0,
  input_snapshot_json TEXT NOT NULL DEFAULT '{}',
  output_summary TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  session_id TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_attempts_run ON node_attempts(run_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_attempts_cap ON node_attempts(capability_id, started_at DESC);

CREATE TABLE IF NOT EXISTS checkpoints (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  label TEXT NOT NULL,
  git_commit_sha TEXT NOT NULL,
  git_tag TEXT NOT NULL,
  rescue_ref TEXT,
  completed_node_count INTEGER NOT NULL DEFAULT 0,
  total_node_count INTEGER NOT NULL DEFAULT 0,
  engine_snapshot_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS interventions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  node_id TEXT,
  kind TEXT NOT NULL,
  question TEXT NOT NULL,
  context_snippet TEXT NOT NULL DEFAULT '',
  options_json TEXT NOT NULL DEFAULT '[]',
  recommended_index INTEGER NOT NULL DEFAULT 0,
  downstream_blocked_count INTEGER NOT NULL DEFAULT 1,
  estimated_read_seconds INTEGER NOT NULL DEFAULT 25,
  status TEXT NOT NULL DEFAULT 'open',
  resolution TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_interventions_run ON interventions(run_id, status);

CREATE TABLE IF NOT EXISTS capabilities (
  id TEXT PRIMARY KEY,
  manifest_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  probe_ok INTEGER,
  probe_message TEXT NOT NULL DEFAULT 'Ready',
  probed_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS model_providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  protocol TEXT NOT NULL,
  base_url TEXT NOT NULL,
  models_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  run_id TEXT,
  node_id TEXT,
  capability_id TEXT NOT NULL,
  model TEXT NOT NULL,
  role TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  status TEXT NOT NULL DEFAULT 'running'
);

CREATE TABLE IF NOT EXISTS session_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_name TEXT,
  is_error INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  cached_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_session_messages ON session_messages(session_id, seq);

CREATE VIRTUAL TABLE IF NOT EXISTS session_messages_fts USING fts5(
  id UNINDEXED,
  session_id UNINDEXED,
  content,
  content=session_messages,
  content_rowid=rowid,
  tokenize='unicode61 remove_diacritics 1'
);

CREATE TRIGGER IF NOT EXISTS session_messages_fts_ai AFTER INSERT ON session_messages BEGIN
  INSERT INTO session_messages_fts(rowid, id, session_id, content)
  VALUES (new.rowid, new.id, new.session_id, new.content);
END;

CREATE TRIGGER IF NOT EXISTS session_messages_fts_ad AFTER DELETE ON session_messages BEGIN
  INSERT INTO session_messages_fts(session_messages_fts, rowid, id, session_id, content)
  VALUES ('delete', old.rowid, old.id, old.session_id, old.content);
END;

CREATE TRIGGER IF NOT EXISTS session_messages_fts_au AFTER UPDATE ON session_messages BEGIN
  INSERT INTO session_messages_fts(session_messages_fts, rowid, id, session_id, content)
  VALUES ('delete', old.rowid, old.id, old.session_id, old.content);
  INSERT INTO session_messages_fts(rowid, id, session_id, content)
  VALUES (new.rowid, new.id, new.session_id, new.content);
END;

CREATE TABLE IF NOT EXISTS audit_ledger (
  id TEXT PRIMARY KEY,
  workflow_id TEXT,
  run_id TEXT,
  category TEXT NOT NULL,
  author TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS audit_ledger_fts USING fts5(
  id UNINDEXED,
  title,
  detail,
  content=audit_ledger,
  content_rowid=rowid,
  tokenize='unicode61 remove_diacritics 1'
);

CREATE TRIGGER IF NOT EXISTS audit_ledger_fts_ai AFTER INSERT ON audit_ledger BEGIN
  INSERT INTO audit_ledger_fts(rowid, id, title, detail)
  VALUES (new.rowid, new.id, new.title, new.detail);
END;

CREATE TRIGGER IF NOT EXISTS audit_ledger_fts_ad AFTER DELETE ON audit_ledger BEGIN
  INSERT INTO audit_ledger_fts(audit_ledger_fts, rowid, id, title, detail)
  VALUES ('delete', old.rowid, old.id, old.title, old.detail);
END;

CREATE TRIGGER IF NOT EXISTS audit_ledger_fts_au AFTER UPDATE ON audit_ledger BEGIN
  INSERT INTO audit_ledger_fts(audit_ledger_fts, rowid, id, title, detail)
  VALUES ('delete', old.rowid, old.id, old.title, old.detail);
  INSERT INTO audit_ledger_fts(rowid, id, title, detail)
  VALUES (new.rowid, new.id, new.title, new.detail);
END;

CREATE TABLE IF NOT EXISTS domain_terms (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  bounded_context TEXT NOT NULL,
  canonical_term TEXT NOT NULL,
  local_label TEXT NOT NULL DEFAULT '',
  definition TEXT NOT NULL DEFAULT '',
  forbidden_aliases_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'governance',
  content TEXT NOT NULL,
  times_used INTEGER NOT NULL DEFAULT 0,
  stability_hours REAL NOT NULL DEFAULT 24,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mcp_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  transport TEXT NOT NULL DEFAULT 'http',
  endpoint_or_command TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  tools_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ready',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS constitution_rules (
  id TEXT PRIMARY KEY,
  markdown TEXT NOT NULL,
  blocked_commands_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pm_reports (
  workflow_id TEXT PRIMARY KEY REFERENCES workflows(id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

export const BUILTIN_CAPABILITIES: readonly Omit<
  CapabilityAdapterManifest,
  'probeOk' | 'probeMessage' | 'probedAt'
>[] = [
  {
    id: 'native-api',
    label: 'Native Multi-Provider Agent Runner',
    executorKind: 'agent',
    specialty:
      'Direct Commercial API Tool-Loop & Deterministic Workspace Slice Agent',
    sovereignSoul:
      'Execute scoped software engineering tasks with strict I/O contracts, worktree confinement, and fail-closed QA evaluation.',
    transport: 'native-api',
    command: 'native-api',
    baseArgs: [],
    healthProbeArgs: [],
    mcpInjection: 'none',
    jsonlParser: 'none',
    permissionFlags: {turbo: [], supervised: [], strict: []},
    envAllowlist: [],
    defaultModel: 'deepseek-flash',
    supportedRoles: ['lead', 'worker', 'evaluator', 'specialist'],
    maxConcurrentSlots: 6,
    enabled: true,
    builtIn: true,
  },
  {
    id: 'tool:shell',
    label: 'Sandboxed Command & Gate Runner',
    executorKind: 'tool',
    specialty:
      'Deterministic Verification, Build, Test & Sanity Command Runner',
    sovereignSoul:
      'Execute workspace-confined deterministic shell checks without shell injection; fail closed on non-zero exit codes.',
    transport: 'local-tool',
    command: 'local-tool',
    baseArgs: [],
    healthProbeArgs: [],
    mcpInjection: 'none',
    jsonlParser: 'none',
    permissionFlags: {turbo: [], supervised: [], strict: []},
    envAllowlist: [],
    defaultModel: 'deterministic',
    supportedRoles: ['worker', 'evaluator'],
    maxConcurrentSlots: 4,
    enabled: true,
    builtIn: true,
  },
  {
    id: 'human:reviewer',
    label: 'Human Gate & Approval Reviewer',
    executorKind: 'human',
    specialty: 'Interactive Decision Checkpoints & Clarification Sign-Off',
    sovereignSoul:
      'Pause downstream graph edges cleanly until human reviewer approves, rejects, or overrides.',
    transport: 'human-gate',
    command: 'human-gate',
    baseArgs: [],
    healthProbeArgs: [],
    mcpInjection: 'none',
    jsonlParser: 'none',
    permissionFlags: {turbo: [], supervised: [], strict: []},
    envAllowlist: [],
    defaultModel: 'human',
    supportedRoles: ['lead', 'evaluator'],
    maxConcurrentSlots: 8,
    enabled: true,
    builtIn: true,
  },
  {
    id: 'control:plane',
    label: 'Twin-Graph Control Coordinator',
    executorKind: 'control',
    specialty: 'Start, Decision Routing, Join Barrier, Git Checkpoint & Rewind',
    sovereignSoul:
      'Orchestrate conditional branches, parallel synchronization joins, and atomic worktree checkpoints.',
    transport: 'control-plane',
    command: 'control-plane',
    baseArgs: [],
    healthProbeArgs: [],
    mcpInjection: 'none',
    jsonlParser: 'none',
    permissionFlags: {turbo: [], supervised: [], strict: []},
    envAllowlist: [],
    defaultModel: 'control',
    supportedRoles: ['lead', 'evaluator'],
    maxConcurrentSlots: 16,
    enabled: true,
    builtIn: true,
  },
  {
    id: 'codex',
    label: 'Codex CLI',
    executorKind: 'agent',
    specialty: 'Architecture Decomposition & Precision Implementation',
    sovereignSoul:
      'Methodical staff engineer: enforce type invariants and minimal diff blast radius.',
    transport: 'cli-stream',
    command: 'codex',
    baseArgs: ['exec', '--json'],
    healthProbeArgs: ['--version'],
    mcpInjection: 'codex-flag',
    jsonlParser: 'codex-rpc',
    permissionFlags: {
      turbo: ['--full-auto'],
      supervised: ['--full-auto'],
      strict: [],
    },
    envAllowlist: ['OPENAI_API_KEY', 'OPENAI_BASE_URL'],
    defaultModel: 'gpt-5',
    supportedRoles: ['lead', 'worker', 'evaluator', 'specialist'],
    maxConcurrentSlots: 3,
    enabled: false,
    builtIn: true,
  },
  {
    id: 'claude-code',
    label: 'Claude Code CLI',
    executorKind: 'agent',
    specialty: 'Architecture Review & Independent QA Audit',
    sovereignSoul:
      'Principal reviewer: challenge edge cases and audit deliverables strictly against GoalSpec.',
    transport: 'cli-stream',
    command: 'claude',
    baseArgs: ['-p', '--output-format', 'stream-json', '--verbose'],
    healthProbeArgs: ['--version'],
    mcpInjection: 'claude-mcp-json',
    jsonlParser: 'claude-stream',
    permissionFlags: {
      turbo: ['--dangerously-skip-permissions'],
      supervised: [],
      strict: [],
    },
    envAllowlist: ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL'],
    defaultModel: 'claude-sonnet-4-5',
    supportedRoles: ['lead', 'worker', 'evaluator'],
    maxConcurrentSlots: 3,
    enabled: false,
    builtIn: true,
  },
  {
    id: 'kimi-acp',
    label: 'Kimi Code (ACP)',
    executorKind: 'agent',
    specialty: 'Long-Context Multi-File Synthesis via JSON-RPC 2.0 ACP Stdio',
    sovereignSoul:
      'Cross-module ACP specialist integrating streamed tool progress and structured handoffs.',
    transport: 'acp-stdio',
    command: 'kimi',
    baseArgs: ['acp'],
    healthProbeArgs: ['--version'],
    mcpInjection: 'acp-session',
    jsonlParser: 'none',
    permissionFlags: {turbo: [], supervised: [], strict: []},
    envAllowlist: ['MOONSHOT_API_KEY', 'KIMI_API_KEY'],
    defaultModel: 'kimi-k2',
    supportedRoles: ['lead', 'worker', 'specialist'],
    maxConcurrentSlots: 3,
    enabled: false,
    builtIn: true,
  },
];

export const DEFAULT_MODEL_PROVIDERS: readonly Omit<
  ModelProviderConfig,
  'hasApiKey' | 'maskedKeyHint' | 'updatedAt'
>[] = [
  {
    id: 'opencode-go',
    name: 'OpenCode Go (直连订阅)',
    protocol: 'openai-compatible',
    baseUrl: 'https://opencode.ai/inference/go/openai/v1',
    models: [
      {
        id: 'deepseek-v4.1-flash',
        label: 'DeepSeek V4.1 Flash (默认主力引擎)',
        tier: 'fast',
        inputUsdPerMillion: 0.15,
        cachedInputUsdPerMillion: 0.003,
        outputUsdPerMillion: 0.6,
        contextWindowTokens: 1_000_000,
      },
      {
        id: 'deepseek-v4-pro',
        label: 'DeepSeek V4 Pro (强推理架构模型)',
        tier: 'strong',
        inputUsdPerMillion: 0.55,
        cachedInputUsdPerMillion: 0.14,
        outputUsdPerMillion: 2.19,
        contextWindowTokens: 1_000_000,
      },
    ],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek Official',
    protocol: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    models: [
      {
        id: 'deepseek-flash',
        label: 'DeepSeek Flash',
        tier: 'fast',
        inputUsdPerMillion: 0.30,
        cachedInputUsdPerMillion: 0.006,
        outputUsdPerMillion: 1.20,
        contextWindowTokens: 1_000_000,
      },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI / Compatible Gateway',
    protocol: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    models: [
      {
        id: 'gpt-5',
        label: 'GPT-5 (Strong Architect / Lead)',
        tier: 'strong',
        inputUsdPerMillion: 2.5,
        cachedInputUsdPerMillion: 0.625,
        outputUsdPerMillion: 10,
        contextWindowTokens: 256_000,
      },
      {
        id: 'gpt-5-mini',
        label: 'GPT-5 Mini (Fast Worker)',
        tier: 'fast',
        inputUsdPerMillion: 0.3,
        cachedInputUsdPerMillion: 0.075,
        outputUsdPerMillion: 1.2,
        contextWindowTokens: 256_000,
      },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic Messages',
    protocol: 'anthropic-messages',
    baseUrl: 'https://api.anthropic.com/v1',
    models: [
      {
        id: 'claude-sonnet-4-5',
        label: 'Claude Sonnet (Balanced Lead & QA)',
        tier: 'strong',
        inputUsdPerMillion: 3,
        cachedInputUsdPerMillion: 0.3,
        outputUsdPerMillion: 15,
        contextWindowTokens: 200_000,
      },
      {
        id: 'claude-opus-4-6',
        label: 'Claude Opus (Principal Architect)',
        tier: 'strong',
        inputUsdPerMillion: 5,
        cachedInputUsdPerMillion: 0.5,
        outputUsdPerMillion: 25,
        contextWindowTokens: 200_000,
      },
    ],
  },
];

export const SAMPLE_REQUIREMENTS_MARKDOWN = `# Order Reconciliation & Idempotent Ledger Pipeline

## Goal
Build and verify a modular order reconciliation pipeline with idempotent webhook processing, double-entry ledger verification, and deterministic verification reporting.

## Inputs
- Confirmed API contract & SQLite schema specification
- Incoming webhook event fixture payloads (JSON)

## Outputs
- Verified TypeScript reconciliation module (\`src/core/\`) and HTTP webhook adapter (\`src/api/\`)
- Passing deterministic verification gate log and audit summary

## Constraints
- Latency per webhook event must remain under 200ms in local validation.
- All file mutations must be confined to the isolated Git worktree.

## Requirements
- FR-01: Idempotency Guard — Deduplicate incoming webhook events by eventId so duplicate deliveries never create double ledger entries.
- FR-02: Reconciliation Diff Engine — Compute settled vs pending balance discrepancies cleanly and emit machine-readable adjustment records.
- FR-03: Webhook Endpoint Validation — Validate HMAC headers and fail closed on malformed payloads.

## Acceptance Criteria
- AC-01: Duplicate webhook submission returns idempotent replay status without extra ledger rows.
- AC-02: Reconciliation report balances debits and credits to zero variance.
- AC-03: Deterministic verification command exits with code 0.

## Assumptions
- Sqlite WAL mode is available via built-in Node runtime.
`;

export const DEFAULT_DOMAIN_TERMS: readonly Omit<
  DomainTermEntry,
  'workspaceId' | 'createdAt' | 'updatedAt'
>[] = [
  {
    id: 'ddd-twin-graph',
    boundedContext: 'Orchestration',
    canonicalTerm: 'TwinGraph',
    localLabel: '双生拓扑图',
    definition:
      'Dual-mode hierarchical WBS and executable DAG synchronizing specification edits with verification runs.',
    forbiddenAliases: ['ad-hoc flowchart', 'loose task list'],
  },
  {
    id: 'ddd-rework-loop',
    boundedContext: 'Verification',
    canonicalTerm: 'ReworkLoop',
    localLabel: '有界返工回滚环',
    definition:
      'Bounded failure-recovery edge creating non-destructive Git rescue refs and re-arming downstream gates.',
    forbiddenAliases: ['infinite retry', 'blind reset'],
  },
  {
    id: 'ddd-enrollment-ticket',
    boundedContext: 'AcademicScheduling',
    canonicalTerm: 'EnrollmentTicket',
    localLabel: '选课凭证',
    definition:
      'Atomic seat-lock token representing an idempotent course enrollment attempt with prerequisite verification.',
    forbiddenAliases: ['loose booking', 'untracked seat'],
  },
  {
    id: 'ddd-journal-entry',
    boundedContext: 'ClearingLedger',
    canonicalTerm: 'JournalEntry',
    localLabel: '复式记账分录',
    definition:
      'Immutable balanced debit-credit record stored strictly in integer minor currency units.',
    forbiddenAliases: ['float balance', 'unbalanced row'],
  },
];

export const DEFAULT_SKILLS: readonly Omit<
  SkillEntry,
  'createdAt' | 'updatedAt'
>[] = [
  {
    id: 'skill-pm-slice',
    slug: 'pm-modular-decomposition',
    title: 'PM Modular Task Slicing & Disjoint File Scopes',
    category: 'pm_plan',
    content:
      'Decompose Design Spec modules into parallel P2 slices with non-overlapping fileScope globs and explicit FR-xx traceability.',
    timesUsed: 3,
    stabilityHours: 48,
  },
  {
    id: 'skill-fail-closed',
    slug: 'fail-closed-gates',
    title: 'Fail-Closed Verification & Bounded Rework',
    category: 'qa',
    content:
      'Never self-certify pass when shell exit code != 0 or DDD drift warnings remain unresolved; always preserve rescue refs before rewinding.',
    timesUsed: 4,
    stabilityHours: 64,
  },
  {
    id: 'skill-worktree-guard',
    slug: 'worktree-isolation-safety',
    title: 'Git Worktree Path Confinement & Env Scrubbing',
    category: 'governance',
    content:
      'Restrict file mutations strictly inside assigned worktree path, reject path traversal, and strip sensitive env vars unless allowlisted.',
    timesUsed: 5,
    stabilityHours: 72,
  },
  {
    id: 'skill-ddd-ubiquitous',
    slug: 'ddd-ubiquitous-guard',
    title: 'DDD Ubiquitous Terminology Alignment',
    category: 'backend',
    content:
      'Audit specs, task contracts, and code symbols against the bounded-context glossary so multi-agent handoffs remain semantically consistent.',
    timesUsed: 2,
    stabilityHours: 36,
  },
];

export const DEFAULT_MCP_SERVERS: readonly Omit<McpServerEntry, 'updatedAt'>[] =
  [
    {
      id: 'mcp-orchestrator-station',
      name: 'orchestrator-station',
      transport: 'http',
      endpointOrCommand: 'http://127.0.0.1:4319/mcp',
      description:
        'Built-in SE Orchestrator control & evidence MCP bridge exposing workflow status, WBS graph queries, and FTS5 transcript lookup.',
      enabled: true,
      toolsCount: 6,
      status: 'ready',
    },
    {
      id: 'mcp-repo-inspector',
      name: 'repo-tree-inspector',
      transport: 'stdio',
      endpointOrCommand: 'npx @modelcontextprotocol/server-filesystem .',
      description:
        'Read-only repository symbol & directory inspection adapter for PM Agent task scoping.',
      enabled: false,
      toolsCount: 4,
      status: 'untested',
    },
  ];

export const DEFAULT_CONSTITUTION_RULE: Omit<ConstitutionRule, 'updatedAt'> = {
  id: 'default',
  markdown: `# Engineering Constitution & Execution Safety Contract

1. **Disjoint Worker Scopes**: Parallel worker tasks in Phase 2 must declare non-overlapping \`fileScope\` boundaries before concurrent execution.
2. **Fail-Closed Verification**: Deterministic Shell Gate (\`P3.GATE\`) and Independent QA (\`P3.QA\`) must verify actual outputs rather than agent claims.
3. **Non-Destructive Recovery**: Always create a \`refs/orchestrator-backup/...\` rescue snapshot before rewinding a failed attempt.
4. **DDD Semantic Integrity**: Canonical domain terms defined in the Ubiquitous Glossary take precedence over ad-hoc aliases across all specs and code.`,
  blockedCommands: [
    'git push --force',
    'git reset --hard origin',
    'rm -rf /',
    'curl | sh',
    'wget | sh',
    'drop database',
  ],
};
