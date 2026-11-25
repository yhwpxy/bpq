# SQLite 表字段与约束

数据来自迁移版实际启动后的 sqlite_master 和 PRAGMA table_info / foreign_key_list。与参考版 65 个 schema 对象逐项一致；下列 41 个表包含 FTS5 虚表及 SQLite 自动创建的 FTS 内部表。无外部数据库或 ORM。

核心模型与 JSON 字段的结构以 src/shared/types.ts、src/shared/api.ts、requirements-engineering/src/contracts.ts、software-design/src/{contracts,design-schema,reviews,pm-input,handoff}.ts 为准。

## audit_ledger

| 字段 | 类型 | NOT NULL | 主键序号 | 默认值 |
| --- | --- | --- | --- | --- |
| `id` | TEXT | 0 | 1 | `None` |
| `workflow_id` | TEXT | 0 | 0 | `None` |
| `run_id` | TEXT | 0 | 0 | `None` |
| `category` | TEXT | 1 | 0 | `None` |
| `author` | TEXT | 1 | 0 | `None` |
| `title` | TEXT | 1 | 0 | `None` |
| `detail` | TEXT | 1 | 0 | `None` |
| `created_at` | TEXT | 1 | 0 | `None` |

```sql
CREATE TABLE audit_ledger (
  id TEXT PRIMARY KEY,
  workflow_id TEXT,
  run_id TEXT,
  category TEXT NOT NULL,
  author TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at TEXT NOT NULL
)
```

## audit_ledger_fts

| 字段 | 类型 | NOT NULL | 主键序号 | 默认值 |
| --- | --- | --- | --- | --- |
| `id` | ANY | 0 | 0 | `None` |
| `title` | ANY | 0 | 0 | `None` |
| `detail` | ANY | 0 | 0 | `None` |

```sql
CREATE VIRTUAL TABLE audit_ledger_fts USING fts5(
  id UNINDEXED,
  title,
  detail,
  content=audit_ledger,
  content_rowid=rowid,
  tokenize='unicode61 remove_diacritics 1'
)
```

## audit_ledger_fts_config

| 字段 | 类型 | NOT NULL | 主键序号 | 默认值 |
| --- | --- | --- | --- | --- |
| `k` | ANY | 1 | 1 | `None` |
| `v` | ANY | 0 | 0 | `None` |

```sql
CREATE TABLE 'audit_ledger_fts_config'(k PRIMARY KEY, v) WITHOUT ROWID
```

## audit_ledger_fts_data

| 字段 | 类型 | NOT NULL | 主键序号 | 默认值 |
| --- | --- | --- | --- | --- |
| `id` | INTEGER | 0 | 1 | `None` |
| `block` | BLOB | 0 | 0 | `None` |

```sql
CREATE TABLE 'audit_ledger_fts_data'(id INTEGER PRIMARY KEY, block BLOB)
```

## audit_ledger_fts_docsize

| 字段 | 类型 | NOT NULL | 主键序号 | 默认值 |
| --- | --- | --- | --- | --- |
| `id` | INTEGER | 0 | 1 | `None` |
| `sz` | BLOB | 0 | 0 | `None` |

```sql
CREATE TABLE 'audit_ledger_fts_docsize'(id INTEGER PRIMARY KEY, sz BLOB)
```

## audit_ledger_fts_idx

| 字段 | 类型 | NOT NULL | 主键序号 | 默认值 |
| --- | --- | --- | --- | --- |
| `segid` | ANY | 1 | 1 | `None` |
| `term` | ANY | 1 | 2 | `None` |
| `pgno` | ANY | 0 | 0 | `None` |

```sql
CREATE TABLE 'audit_ledger_fts_idx'(segid, term, pgno, PRIMARY KEY(segid, term)) WITHOUT ROWID
```

## capabilities

| 字段 | 类型 | NOT NULL | 主键序号 | 默认值 |
| --- | --- | --- | --- | --- |
| `id` | TEXT | 0 | 1 | `None` |
| `manifest_json` | TEXT | 1 | 0 | `None` |
| `enabled` | INTEGER | 1 | 0 | `1` |
| `probe_ok` | INTEGER | 0 | 0 | `None` |
| `probe_message` | TEXT | 1 | 0 | `'Ready'` |
| `probed_at` | TEXT | 0 | 0 | `None` |
| `updated_at` | TEXT | 1 | 0 | `None` |

```sql
CREATE TABLE capabilities (
  id TEXT PRIMARY KEY,
  manifest_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  probe_ok INTEGER,
  probe_message TEXT NOT NULL DEFAULT 'Ready',
  probed_at TEXT,
  updated_at TEXT NOT NULL
)
```

## checkpoints

| 字段 | 类型 | NOT NULL | 主键序号 | 默认值 |
| --- | --- | --- | --- | --- |
| `id` | TEXT | 0 | 1 | `None` |
| `run_id` | TEXT | 1 | 0 | `None` |
| `node_id` | TEXT | 1 | 0 | `None` |
| `label` | TEXT | 1 | 0 | `None` |
| `git_commit_sha` | TEXT | 1 | 0 | `None` |
| `git_tag` | TEXT | 1 | 0 | `None` |
| `rescue_ref` | TEXT | 0 | 0 | `None` |
| `completed_node_count` | INTEGER | 1 | 0 | `0` |
| `total_node_count` | INTEGER | 1 | 0 | `0` |
| `engine_snapshot_json` | TEXT | 1 | 0 | `'{}'` |
| `created_at` | TEXT | 1 | 0 | `None` |

```sql
CREATE TABLE checkpoints (
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
)
```

外键：`[{"id": 0, "seq": 0, "table": "workflow_runs", "from": "run_id", "to": "id", "on_update": "NO ACTION", "on_delete": "CASCADE", "match": "NONE"}]`

## constitution_rules

| 字段 | 类型 | NOT NULL | 主键序号 | 默认值 |
| --- | --- | --- | --- | --- |
| `id` | TEXT | 0 | 1 | `None` |
| `markdown` | TEXT | 1 | 0 | `None` |
| `blocked_commands_json` | TEXT | 1 | 0 | `'[]'` |
| `updated_at` | TEXT | 1 | 0 | `None` |

```sql
CREATE TABLE constitution_rules (
  id TEXT PRIMARY KEY,
  markdown TEXT NOT NULL,
  blocked_commands_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
)
```

## design_decisions

| 字段 | 类型 | NOT NULL | 主键序号 | 默认值 |
| --- | --- | --- | --- | --- |
| `decision_id` | TEXT | 0 | 1 | `None` |
| `design_id` | TEXT | 1 | 0 | `None` |
| `revision` | INTEGER | 1 | 0 | `None` |
| `expected_hash` | TEXT | 1 | 0 | `None` |
| `actor` | TEXT | 1 | 0 | `None` |
| `action` | TEXT | 1 | 0 | `None` |
| `findings_json` | TEXT | 1 | 0 | `None` |
| `scope` | TEXT | 1 | 0 | `None` |
| `decided_at` | TEXT | 1 | 0 | `None` |

```sql
CREATE TABLE design_decisions (
        decision_id TEXT PRIMARY KEY, design_id TEXT NOT NULL, revision INTEGER NOT NULL,
        expected_hash TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL,
        findings_json TEXT NOT NULL, scope TEXT NOT NULL, decided_at TEXT NOT NULL,
        FOREIGN KEY(design_id, revision) REFERENCES design_revisions(design_id, revision)
      )
```

外键：`[{"id": 0, "seq": 0, "table": "design_revisions", "from": "design_id", "to": "design_id", "on_update": "NO ACTION", "on_delete": "NO ACTION", "match": "NONE"}, {"id": 0, "seq": 1, "table": "design_revisions", "from": "revision", "to": "revision", "on_update": "NO ACTION", "on_delete": "NO ACTION", "match": "NONE"}]`

## design_handoffs

| 字段 | 类型 | NOT NULL | 主键序号 | 默认值 |
| --- | --- | --- | --- | --- |
| `design_id` | TEXT | 1 | 1 | `None` |
| `revision` | INTEGER | 1 | 2 | `None` |
| `workspace_id` | TEXT | 1 | 3 | `None` |
| `workflow_id` | TEXT | 1 | 0 | `None` |
| `created_at` | TEXT | 1 | 0 | `None` |
| `content_sha256` | TEXT | 0 | 0 | `None` |
| `pm_report_id` | TEXT | 0 | 0 | `None` |
| `status` | TEXT | 1 | 0 | `'pending_review'` |
| `diagnostics_json` | TEXT | 1 | 0 | `'[]'` |
| `receipt_json` | TEXT | 0 | 0 | `None` |

```sql
CREATE TABLE design_handoffs (
        design_id TEXT NOT NULL, revision INTEGER NOT NULL, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        workflow_id TEXT NOT NULL UNIQUE REFERENCES workflows(id), created_at TEXT NOT NULL, content_sha256 TEXT, pm_report_id TEXT, status TEXT NOT NULL DEFAULT 'pending_review', diagnostics_json TEXT NOT NULL DEFAULT '[]', receipt_json TEXT,
        PRIMARY KEY(design_id, revision, workspace_id),
        FOREIGN KEY(design_id, revision) REFERENCES design_revisions(design_id, revision)
      )
```

外键：`[{"id": 0, "seq": 0, "table": "design_revisions", "from": "design_id", "to": "design_id", "on_update": "NO ACTION", "on_delete": "NO ACTION", "match": "NONE"}, {"id": 0, "seq": 1, "table": "design_revisions", "from": "revision", "to": "revision", "on_update": "NO ACTION", "on_delete": "NO ACTION", "match": "NONE"}, {"id": 1, "seq": 0, "table": "workflows", "from": "workflow_id", "to": "id", "on_update": "NO ACTION", "on_delete": "NO ACTION", "match": "NONE"}, {"id": 2, "seq": 0, "table": "workspaces", "from": "workspace_id", "to": "id", "on_update": "NO ACTION", "on_delete": "NO ACTION", "match": "NONE"}]`

## design_revisions

| 字段 | 类型 | NOT NULL | 主键序号 | 默认值 |
| --- | --- | --- | --- | --- |
| `design_id` | TEXT | 1 | 1 | `None` |
| `revision` | INTEGER | 1 | 2 | `None` |
| `parent_revision` | INTEGER | 0 | 0 | `None` |
| `baseline_id` | TEXT | 1 | 0 | `None` |
| `project_id` | TEXT | 1 | 0 | `None` |
| `baseline_revision` | INTEGER | 1 | 0 | `None` |
| `baseline_sha256` | TEXT | 1 | 0 | `None` |
| `workspace_id` | TEXT | 1 | 0 | `None` |
| `source_commit` | TEXT | 0 | 0 | `None` |
| `schema_version` | INTEGER | 1 | 0 | `None` |
| `input_json` | TEXT | 1 | 0 | `None` |
| `body_json` | TEXT | 1 | 0 | `None` |
| `content_sha256` | TEXT | 1 | 0 | `None` |
| `state` | TEXT | 1 | 0 | `None` |
| `created_at` | TEXT | 1 | 0 | `None` |
| `metadata_json` | TEXT | 1 | 0 | `None` |
| `review_markdown` | TEXT | 1 | 0 | `None` |
| `pm_markdown` | TEXT | 1 | 0 | `None` |
| `diagnostics_json` | TEXT | 1 | 0 | `None` |

```sql
CREATE TABLE design_revisions (
        design_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision > 0), parent_revision INTEGER,
        baseline_id TEXT NOT NULL, project_id TEXT NOT NULL, baseline_revision INTEGER NOT NULL,
        baseline_sha256 TEXT NOT NULL, workspace_id TEXT NOT NULL REFERENCES workspaces(id), source_commit TEXT,
        schema_version INTEGER NOT NULL CHECK(schema_version=1), input_json TEXT NOT NULL, body_json TEXT NOT NULL,
        content_sha256 TEXT NOT NULL CHECK(length(content_sha256)=64),
        state TEXT NOT NULL CHECK(state IN ('draft','in_review','changes_requested','confirmed')),
        created_at TEXT NOT NULL, metadata_json TEXT NOT NULL, review_markdown TEXT NOT NULL, pm_markdown TEXT NOT NULL,
        diagnostics_json TEXT NOT NULL,
        PRIMARY KEY(design_id, revision),
        FOREIGN KEY(design_id, parent_revision) REFERENCES design_revisions(design_id, revision)
      )
```

外键：`[{"id": 0, "seq": 0, "table": "design_revisions", "from": "design_id", "to": "design_id", "on_update": "NO ACTION", "on_delete": "NO ACTION", "match": "NONE"}, {"id": 0, "seq": 1, "table": "design_revisions", "from": "parent_revision", "to": "revision", "on_update": "NO ACTION", "on_delete": "NO ACTION", "match": "NONE"}, {"id": 1, "seq": 0, "table": "workspaces", "from": "workspace_id", "to": "id", "on_update": "NO ACTION", "on_delete": "NO ACTION", "match": "NONE"}]`

## domain_terms

| 字段 | 类型 | NOT NULL | 主键序号 | 默认值 |
| --- | --- | --- | --- | --- |
| `id` | TEXT | 0 | 1 | `None` |
| `workspace_id` | TEXT | 1 | 0 | `None` |
| `bounded_context` | TEXT | 1 | 0 | `None` |
| `canonical_term` | TEXT | 1 | 0 | `None` |
| `local_label` | TEXT | 1 | 0 | `''` |
| `definition` | TEXT | 1 | 0 | `''` |
| `forbidden_aliases_json` | TEXT | 1 | 0 | `'[]'` |
| `created_at` | TEXT | 1 | 0 | `None` |
| `updated_at` | TEXT | 1 | 0 | `None` |

```sql
CREATE TABLE domain_terms (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  bounded_context TEXT NOT NULL,
  canonical_term TEXT NOT NULL,
  local_label TEXT NOT NULL DEFAULT '',
  definition TEXT NOT NULL DEFAULT '',
  forbidden_aliases_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)
```

## goal_specs

| 字段 | 类型 | NOT NULL | 主键序号 | 默认值 |
| --- | --- | --- | --- | --- |
| `workflow_id` | TEXT | 0 | 1 | `None` |
| `payload_json` | TEXT | 1 | 0 | `None` |
| `updated_at` | TEXT | 1 | 0 | `None` |

```sql
CREATE TABLE goal_specs (
  workflow_id TEXT PRIMARY KEY REFERENCES workflows(id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
)
```

外键：`[{"id": 0, "seq": 0, "table": "workflows", "from": "workflow_id", "to": "id", "on_update": "NO ACTION", "on_delete": "CASCADE", "match": "NONE"}]`

## graph_edges

| 字段 | 类型 | NOT NULL | 主键序号 | 默认值 |
| --- | --- | --- | --- | --- |
| `id` | TEXT | 0 | 1 | `None` |
| `scope_id` | TEXT | 1 | 0 | `None` |
| `source_node_id` | TEXT | 1 | 0 | `None` |
| `target_node_id` | TEXT | 1 | 0 | `None` |
| `kind` | TEXT | 1 | 0 | `None` |
| `label` | TEXT | 1 | 0 | `''` |
| `condition_expr` | TEXT | 0 | 0 | `None` |

```sql
CREATE TABLE graph_edges (
  id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL,
  source_node_id TEXT NOT NULL,
  target_node_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  condition_expr TEXT
)
```

## graph_nodes

| 字段 | 类型 | NOT NULL | 主键序号 | 默认值 |
| --- | --- | --- | --- | --- |
| `id` | TEXT | 0 | 1 | `None` |
| `scope_id` | TEXT | 1 | 0 | `None` |
| `code` | TEXT | 1 | 0 | `None` |
| `parent_wbs_id` | TEXT | 0 | 0 | `None` |
| `container_node_id` | TEXT | 0 | 0 | `None` |
| `phase_id` | TEXT | 0 | 0 | `None` |
| `phase_title` | TEXT | 1 | 0 | `''` |
| `depth` | INTEGER | 1 | 0 | `1` |
| `kind` | TEXT | 1 | 0 | `None` |
| `executor_kind` | TEXT | 1 | 0 | `'agent'` |
| `capability_id` | TEXT | 1 | 0 | `'native-api'` |
| `assigned_role` | TEXT | 1 | 0 | `'worker'` |
| `assigned_model` | TEXT | 0 | 0 | `None` |
| `title` | TEXT | 1 | 0 | `None` |
| `description` | TEXT | 1 | 0 | `''` |
| `planning_rationale` | TEXT | 1 | 0 | `''` |
| `requirement_refs_json` | TEXT | 1 | 0 | `'[]'` |
| `input_contract` | TEXT | 1 | 0 | `''` |
| `output_contract` | TEXT | 1 | 0 | `''` |
| `file_scope_json` | TEXT | 1 | 0 | `'[]'` |
| `gate_command` | TEXT | 0 | 0 | `None` |
| `branch_condition` | TEXT | 0 | 0 | `None` |
| `status` | TEXT | 1 | 0 | `'pending'` |
| `attempt_count` | INTEGER | 1 | 0 | `0` |
| `max_attempts` | INTEGER | 1 | 0 | `3` |
| `collapsed` | INTEGER | 1 | 0 | `0` |
| `position_x` | REAL | 1 | 0 | `0` |
| `position_y` | REAL | 1 | 0 | `0` |
| `width` | REAL | 1 | 0 | `220` |
| `height` | REAL | 1 | 0 | `76` |
| `output_summary` | TEXT | 1 | 0 | `''` |
| `restore_target_checkpoint_id` | TEXT | 0 | 0 | `None` |
| `updated_at` | TEXT | 1 | 0 | `None` |

```sql
CREATE TABLE graph_nodes (
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
)
```

## hama_artifacts

| 字段 | 类型 | NOT NULL | 主键序号 | 默认值 |
| --- | --- | --- | --- | --- |
| `id` | TEXT | 0 | 1 | `None` |
| `run_id` | TEXT | 1 | 0 | `None` |
| `attempt_id` | TEXT | 1 | 0 | `None` |
| `kind` | TEXT | 1 | 0 | `None` |
| `subject` | TEXT | 1 | 0 | `None` |
| `revision` | INTEGER | 1 | 0 | `None` |
| `payload` | TEXT | 1 | 0 | `None` |

```sql
CREATE TABLE hama_artifacts (
        id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES hama_runs(run_id),
        attempt_id TEXT NOT NULL REFERENCES node_attempts(id), kind TEXT NOT NULL, subject TEXT NOT NULL,
        revision INTEGER NOT NULL, payload TEXT NOT NULL,
        UNIQUE(run_id, kind, subject, revision)
      )
```

外键：`[{"id": 0, "seq": 0, "table": "node_attempts", "from": "attempt_id", "to": "id", "on_update": "NO ACTION", "on_delete": "NO ACTION", "match": "NONE"}, {"id": 1, "seq": 0, "table": "hama_runs", "from": "run_id", "to": "run_id", "on_update": "NO ACTION", "on_delete": "NO ACTION", "match": "NONE"}]`

## hama_baselines

| 字段 | 类型 | NOT NULL | 主键序号 | 默认值 |
| --- | --- | --- | --- | --- |
| `id` | TEXT | 0 | 1 | `None` |
| `project_id` | TEXT | 1 | 0 | `None` |
| `mode` | TEXT | 1 | 0 | `None` |
| `revision` | INTEGER | 1 | 0 | `None` |
| `run_id` | TEXT | 1 | 0 | `None` |
| `payload` | TEXT | 1 | 0 | `None` |

```sql
CREATE TABLE hama_baselines (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, mode TEXT NOT NULL,
        revision INTEGER NOT NULL, run_id TEXT NOT NULL UNIQUE REFERENCES hama_runs(run_id),
        payload TEXT NOT NULL, UNIQUE(project_id, mode, revision)
      )
```

外键：`[{"id": 0, "seq": 0, "table": "hama_runs", "from": "run_id", "to": "run_id", "on_update": "NO ACTION", "on_delete": "NO ACTION", "match": "NONE"}]`

## hama_gates

| 字段 | 类型 | NOT NULL | 主键序号 | 默认值 |
| --- | --- | --- | --- | --- |
| `id` | TEXT | 0 | 1 | `None` |
| `run_id` | TEXT | 1 | 0 | `None` |
| `payload` | TEXT | 1 | 0 | `None` |
| `decision` | TEXT | 0 | 0 | `None` |
| `submitted` | TEXT | 0 | 0 | `None` |

```sql
CREATE TABLE hama_gates (
        id TEXT PRIMARY KEY REFERENCES interventions(id), run_id TEXT NOT NULL REFERENCES hama_runs(run_id),
        payload TEXT NOT NULL, decision TEXT, submitted TEXT
      )
```

外键：`[{"id": 0, "seq": 0, "table": "hama_runs", "from": "run_id", "to": "run_id", "on_update": "NO ACTION", "on_delete": "NO ACTION", "match": "NONE"}, {"id": 1, "seq": 0, "table": "interventions", "from": "id", "to": "id", "on_update": "NO ACTION", "on_delete": "NO ACTION", "match": "NONE"}]`

## hama_runs

| 字段 | 类型 | NOT NULL | 主键序号 | 默认值 |
| --- | --- | --- | --- | --- |
| `run_id` | TEXT | 0 | 1 | `None` |
| `project_id` | TEXT | 1 | 0 | `None` |
| `mode` | TEXT | 1 | 0 | `None` |
| `payload` | TEXT | 1 | 0 | `None` |

```sql
CREATE TABLE hama_runs (
        run_id TEXT PRIMARY KEY REFERENCES workflow_runs(id),
        project_id TEXT NOT NULL, mode TEXT NOT NULL, payload TEXT NOT NULL
      )
```

外键：`[{"id": 0, "seq": 0, "table": "workflow_runs", "from": "run_id", "to": "id", "on_update": "NO ACTION", "on_delete": "NO ACTION", "match": "NONE"}]`

## impact_reports

| 字段 | 类型 | NOT NULL | 主键序号 | 默认值 |
| --- | --- | --- | --- | --- |
| `workflow_id` | TEXT | 0 | 1 | `None` |
| `payload_json` | TEXT | 1 | 0 | `None` |
| `analyzed_at` | TEXT | 1 | 0 | `None` |

```sql
CREATE TABLE impact_reports (
  workflow_id TEXT PRIMARY KEY REFERENCES workflows(id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL,
  analyzed_at TEXT NOT NULL
)
```

外键：`[{"id": 0, "seq": 0, "table": "workflows", "from": "workflow_id", "to": "id", "on_update": "NO ACTION", "on_delete": "CASCADE", "match": "NONE"}]`

## interventions

| 字段 | 类型 | NOT NULL | 主键序号 | 默认值 |
| --- | --- | --- | --- | --- |
| `id` | TEXT | 0 | 1 | `None` |
| `run_id` | TEXT | 1 | 0 | `None` |
| `node_id` | TEXT | 0 | 0 | `None` |
| `kind` | TEXT | 1 | 0 | `None` |
| `question` | TEXT | 1 | 0 | `None` |
| `context_snippet` | TEXT | 1 | 0 | `''` |
| `options_json` | TEXT | 1 | 0 | `'[]'` |
| `recommended_index` | INTEGER | 1 | 0 | `0` |
| `downstream_blocked_count` | INTEGER | 1 | 0 | `1` |
| `estimated_read_seconds` | INTEGER | 1 | 0 | `25` |
| `status` | TEXT | 1 | 0 | `'open'` |
| `resolution` | TEXT | 0 | 0 | `None` |
| `created_at` | TEXT | 1 | 0 | `None` |
| `resolved_at` | TEXT | 0 | 0 | `None` |

```sql
CREATE TABLE interventions (
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
)
```

外键：`[{"id": 0, "seq": 0, "table": "workflow_runs", "from": "run_id", "to": "id", "on_update": "NO ACTION", "on_delete": "CASCADE", "match": "NONE"}]`

## mcp_servers

| 字段 | 类型 | NOT NULL | 主键序号 | 默认值 |
| --- | --- | --- | --- | --- |
| `id` | TEXT | 0 | 1 | `None` |
| `name` | TEXT | 1 | 0 | `None` |
| `transport` | TEXT | 1 | 0 | `'http'` |
| `endpoint_or_command` | TEXT | 1 | 0 | `None` |
| `description` | TEXT | 1 | 0 | `''` |
| `enabled` | INTEGER | 1 | 0 | `1` |
| `tools_count` | INTEGER | 1 | 0 | `0` |
| `status` | TEXT | 1 | 0 | `'ready'` |
| `updated_at` | TEXT | 1 | 0 | `None` |

```sql
CREATE TABLE mcp_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  transport TEXT NOT NULL DEFAULT 'http',
  endpoint_or_command TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  tools_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ready',
  updated_at TEXT NOT NULL
)
```

## meta_kv

| 字段 | 类型 | NOT NULL | 主键序号 | 默认值 |
| --- | --- | --- | --- | --- |
| `key` | TEXT | 0 | 1 | `None` |
| `value_json` | TEXT | 1 | 0 | `None` |
| `updated_at` | TEXT | 1 | 0 | `None` |

```sql
CREATE TABLE meta_kv (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
)
```

## model_providers

| 字段 | 类型 | NOT NULL | 主键序号 | 默认值 |
| --- | --- | --- | --- | --- |
| `id` | TEXT | 0 | 1 | `None` |
| `name` | TEXT | 1 | 0 | `None` |
| `protocol` | TEXT | 1 | 0 | `None` |
| `base_url` | TEXT | 1 | 0 | `None` |
| `models_json` | TEXT | 1 | 0 | `None` |
| `updated_at` | TEXT | 1 | 0 | `None` |

```sql
CREATE TABLE model_providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  protocol TEXT NOT NULL,
  base_url TEXT NOT NULL,
  models_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
)
```

## node_attempts

| 字段 | 类型 | NOT NULL | 主键序号 | 默认值 |
| --- | --- | --- | --- | --- |
| `id` | TEXT | 0 | 1 | `None` |
| `run_id` | TEXT | 1 | 0 | `None` |
| `node_id` | TEXT | 1 | 0 | `None` |
| `node_code` | TEXT | 1 | 0 | `None` |
| `attempt_number` | INTEGER | 1 | 0 | `None` |
| `executor_kind` | TEXT | 1 | 0 | `None` |
| `capability_id` | TEXT | 1 | 0 | `None` |
| `model` | TEXT | 1 | 0 | `''` |
| `status` | TEXT | 1 | 0 | `None` |
| `exit_code` | INTEGER | 0 | 0 | `None` |
| `duration_sec` | REAL | 1 | 0 | `0` |
| `input_snapshot_json` | TEXT | 1 | 0 | `'{}'` |
| `output_summary` | TEXT | 1 | 0 | `''` |
| `error_message` | TEXT | 1 | 0 | `''` |
| `session_id` | TEXT | 0 | 0 | `None` |
| `started_at` | TEXT | 1 | 0 | `None` |
| `finished_at` | TEXT | 0 | 0 | `None` |
| `input_tokens` | INTEGER | 1 | 0 | `0` |
| `cached_tokens` | INTEGER | 1 | 0 | `0` |
| `output_tokens` | INTEGER | 1 | 0 | `0` |
| `cost_usd` | REAL | 1 | 0 | `0` |

```sql
CREATE TABLE node_attempts (
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
, input_tokens INTEGER NOT NULL DEFAULT 0, cached_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, cost_usd REAL NOT NULL DEFAULT 0)
```

外键：`[{"id": 0, "seq": 0, "table": "workflow_runs", "from": "run_id", "to": "id", "on_update": "NO ACTION", "on_delete": "CASCADE", "match": "NONE"}]`

## pm_reports

| 字段 | 类型 | NOT NULL | 主键序号 | 默认值 |
| --- | --- | --- | --- | --- |
| `workflow_id` | TEXT | 0 | 1 | `None` |
| `payload_json` | TEXT | 1 | 0 | `None` |
| `created_at` | TEXT | 1 | 0 | `None` |

```sql
CREATE TABLE pm_reports (
  workflow_id TEXT PRIMARY KEY REFERENCES workflows(id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
)
```

外键：`[{"id": 0, "seq": 0, "table": "workflows", "from": "workflow_id", "to": "id", "on_update": "NO ACTION", "on_delete": "CASCADE", "match": "NONE"}]`

## session_messages

| 字段 | 类型 | NOT NULL | 主键序号 | 默认值 |
| --- | --- | --- | --- | --- |
| `id` | TEXT | 0 | 1 | `None` |
| `session_id` | TEXT | 1 | 0 | `None` |
| `seq` | INTEGER | 1 | 0 | `None` |
| `role` | TEXT | 1 | 0 | `None` |
| `content` | TEXT | 1 | 0 | `None` |
| `tool_name` | TEXT | 0 | 0 | `None` |
| `is_error` | INTEGER | 1 | 0 | `0` |
| `input_tokens` | INTEGER | 1 | 0 | `0` |
| `cached_tokens` | INTEGER | 1 | 0 | `0` |
| `output_tokens` | INTEGER | 1 | 0 | `0` |
| `created_at` | TEXT | 1 | 0 | `None` |

```sql
CREATE TABLE session_messages (
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
)
```

外键：`[{"id": 0, "seq": 0, "table": "sessions", "from": "session_id", "to": "id", "on_update": "NO ACTION", "on_delete": "CASCADE", "match": "NONE"}]`

## session_messages_fts

| 字段 | 类型 | NOT NULL | 主键序号 | 默认值 |
| --- | --- | --- | --- | --- |
| `id` | ANY | 0 | 0 | `None` |
| `session_id` | ANY | 0 | 0 | `None` |
| `content` | ANY | 0 | 0 | `None` |

```sql
CREATE VIRTUAL TABLE session_messages_fts USING fts5(
  id UNINDEXED,
  session_id UNINDEXED,
  content,
  content=session_messages,
  content_rowid=rowid,
  tokenize='unicode61 remove_diacritics 1'
)
```

## session_messages_fts_config

| 字段 | 类型 | NOT NULL | 主键序号 | 默认值 |
| --- | --- | --- | --- | --- |
| `k` | ANY | 1 | 1 | `None` |
| `v` | ANY | 0 | 0 | `None` |

```sql
CREATE TABLE 'session_messages_fts_config'(k PRIMARY KEY, v) WITHOUT ROWID
```

## session_messages_fts_data

| 字段 | 类型 | NOT NULL | 主键序号 | 默认值 |
| --- | --- | --- | --- | --- |
| `id` | INTEGER | 0 | 1 | `None` |
| `block` | BLOB | 0 | 0 | `None` |

```sql
CREATE TABLE 'session_messages_fts_data'(id INTEGER PRIMARY KEY, block BLOB)
```

## session_messages_fts_docsize

| 字段 | 类型 | NOT NULL | 主键序号 | 默认值 |
| --- | --- | --- | --- | --- |
| `id` | INTEGER | 0 | 1 | `None` |
| `sz` | BLOB | 0 | 0 | `None` |

```sql
CREATE TABLE 'session_messages_fts_docsize'(id INTEGER PRIMARY KEY, sz BLOB)
```

## session_messages_fts_idx

| 字段 | 类型 | NOT NULL | 主键序号 | 默认值 |
| --- | --- | --- | --- | --- |
| `segid` | ANY | 1 | 1 | `None` |
| `term` | ANY | 1 | 2 | `None` |
| `pgno` | ANY | 0 | 0 | `None` |

```sql
CREATE TABLE 'session_messages_fts_idx'(segid, term, pgno, PRIMARY KEY(segid, term)) WITHOUT ROWID
```

## sessions

| 字段 | 类型 | NOT NULL | 主键序号 | 默认值 |
| --- | --- | --- | --- | --- |
| `id` | TEXT | 0 | 1 | `None` |
| `run_id` | TEXT | 0 | 0 | `None` |
| `node_id` | TEXT | 0 | 0 | `None` |
| `capability_id` | TEXT | 1 | 0 | `None` |
| `model` | TEXT | 1 | 0 | `None` |
| `role` | TEXT | 1 | 0 | `None` |
| `started_at` | TEXT | 1 | 0 | `None` |
| `ended_at` | TEXT | 0 | 0 | `None` |
| `status` | TEXT | 1 | 0 | `'running'` |

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  run_id TEXT,
  node_id TEXT,
  capability_id TEXT NOT NULL,
  model TEXT NOT NULL,
  role TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  status TEXT NOT NULL DEFAULT 'running'
)
```

## skills

| 字段 | 类型 | NOT NULL | 主键序号 | 默认值 |
| --- | --- | --- | --- | --- |
| `id` | TEXT | 0 | 1 | `None` |
| `slug` | TEXT | 1 | 0 | `None` |
| `title` | TEXT | 1 | 0 | `None` |
| `category` | TEXT | 1 | 0 | `'governance'` |
| `content` | TEXT | 1 | 0 | `None` |
| `times_used` | INTEGER | 1 | 0 | `0` |
| `stability_hours` | REAL | 1 | 0 | `24` |
| `created_at` | TEXT | 1 | 0 | `None` |
| `updated_at` | TEXT | 1 | 0 | `None` |

```sql
CREATE TABLE skills (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'governance',
  content TEXT NOT NULL,
  times_used INTEGER NOT NULL DEFAULT 0,
  stability_hours REAL NOT NULL DEFAULT 24,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)
```

## trial_reports

| 字段 | 类型 | NOT NULL | 主键序号 | 默认值 |
| --- | --- | --- | --- | --- |
| `id` | TEXT | 0 | 1 | `None` |
| `workflow_id` | TEXT | 1 | 0 | `None` |
| `payload_json` | TEXT | 1 | 0 | `None` |
| `ran_at` | TEXT | 1 | 0 | `None` |

```sql
CREATE TABLE trial_reports (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL,
  ran_at TEXT NOT NULL
)
```

外键：`[{"id": 0, "seq": 0, "table": "workflows", "from": "workflow_id", "to": "id", "on_update": "NO ACTION", "on_delete": "CASCADE", "match": "NONE"}]`

## validation_reports

| 字段 | 类型 | NOT NULL | 主键序号 | 默认值 |
| --- | --- | --- | --- | --- |
| `workflow_id` | TEXT | 0 | 1 | `None` |
| `payload_json` | TEXT | 1 | 0 | `None` |
| `checked_at` | TEXT | 1 | 0 | `None` |

```sql
CREATE TABLE validation_reports (
  workflow_id TEXT PRIMARY KEY REFERENCES workflows(id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL,
  checked_at TEXT NOT NULL
)
```

外键：`[{"id": 0, "seq": 0, "table": "workflows", "from": "workflow_id", "to": "id", "on_update": "NO ACTION", "on_delete": "CASCADE", "match": "NONE"}]`

## workflow_runs

| 字段 | 类型 | NOT NULL | 主键序号 | 默认值 |
| --- | --- | --- | --- | --- |
| `id` | TEXT | 0 | 1 | `None` |
| `workflow_id` | TEXT | 1 | 0 | `None` |
| `version_id` | TEXT | 1 | 0 | `None` |
| `version_tag` | TEXT | 1 | 0 | `None` |
| `title` | TEXT | 1 | 0 | `None` |
| `status` | TEXT | 1 | 0 | `'queued'` |
| `permission_tier` | TEXT | 1 | 0 | `'supervised'` |
| `worktree_path` | TEXT | 1 | 0 | `''` |
| `git_branch` | TEXT | 1 | 0 | `''` |
| `base_commit_sha` | TEXT | 1 | 0 | `''` |
| `verify_command` | TEXT | 1 | 0 | `None` |
| `max_rework_iterations` | INTEGER | 1 | 0 | `3` |
| `rework_count` | INTEGER | 1 | 0 | `0` |
| `total_nodes` | INTEGER | 1 | 0 | `0` |
| `completed_nodes` | INTEGER | 1 | 0 | `0` |
| `failed_nodes` | INTEGER | 1 | 0 | `0` |
| `skipped_nodes` | INTEGER | 1 | 0 | `0` |
| `started_at` | TEXT | 1 | 0 | `None` |
| `finished_at` | TEXT | 0 | 0 | `None` |
| `updated_at` | TEXT | 1 | 0 | `None` |
| `budget_usd_limit` | REAL | 1 | 0 | `2.5` |
| `spent_usd` | REAL | 1 | 0 | `0` |
| `total_input_tokens` | INTEGER | 1 | 0 | `0` |
| `total_cached_tokens` | INTEGER | 1 | 0 | `0` |
| `total_output_tokens` | INTEGER | 1 | 0 | `0` |

```sql
CREATE TABLE workflow_runs (
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
, budget_usd_limit REAL NOT NULL DEFAULT 2.5, spent_usd REAL NOT NULL DEFAULT 0, total_input_tokens INTEGER NOT NULL DEFAULT 0, total_cached_tokens INTEGER NOT NULL DEFAULT 0, total_output_tokens INTEGER NOT NULL DEFAULT 0)
```

外键：`[{"id": 0, "seq": 0, "table": "workflow_versions", "from": "version_id", "to": "id", "on_update": "NO ACTION", "on_delete": "RESTRICT", "match": "NONE"}, {"id": 1, "seq": 0, "table": "workflows", "from": "workflow_id", "to": "id", "on_update": "NO ACTION", "on_delete": "CASCADE", "match": "NONE"}]`

## workflow_versions

| 字段 | 类型 | NOT NULL | 主键序号 | 默认值 |
| --- | --- | --- | --- | --- |
| `id` | TEXT | 0 | 1 | `None` |
| `workflow_id` | TEXT | 1 | 0 | `None` |
| `version_number` | INTEGER | 1 | 0 | `None` |
| `version_tag` | TEXT | 1 | 0 | `None` |
| `label` | TEXT | 1 | 0 | `None` |
| `payload_json` | TEXT | 1 | 0 | `None` |
| `frozen_by` | TEXT | 1 | 0 | `None` |
| `created_at` | TEXT | 1 | 0 | `None` |

```sql
CREATE TABLE workflow_versions (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  version_tag TEXT NOT NULL,
  label TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  frozen_by TEXT NOT NULL,
  created_at TEXT NOT NULL
)
```

外键：`[{"id": 0, "seq": 0, "table": "workflows", "from": "workflow_id", "to": "id", "on_update": "NO ACTION", "on_delete": "CASCADE", "match": "NONE"}]`

## workflows

| 字段 | 类型 | NOT NULL | 主键序号 | 默认值 |
| --- | --- | --- | --- | --- |
| `id` | TEXT | 0 | 1 | `None` |
| `workspace_id` | TEXT | 1 | 0 | `None` |
| `code` | TEXT | 1 | 0 | `None` |
| `title` | TEXT | 1 | 0 | `None` |
| `description` | TEXT | 1 | 0 | `''` |
| `status` | TEXT | 1 | 0 | `'draft'` |
| `current_version_number` | INTEGER | 1 | 0 | `0` |
| `permission_tier` | TEXT | 1 | 0 | `'supervised'` |
| `verify_command` | TEXT | 1 | 0 | `None` |
| `max_rework_iterations` | INTEGER | 1 | 0 | `3` |
| `created_at` | TEXT | 1 | 0 | `None` |
| `updated_at` | TEXT | 1 | 0 | `None` |
| `customization_json` | TEXT | 0 | 0 | `None` |
| `last_human_reviewed_at` | TEXT | 0 | 0 | `None` |
| `spaced_review_count` | INTEGER | 1 | 0 | `0` |

```sql
CREATE TABLE workflows (
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
, customization_json TEXT, last_human_reviewed_at TEXT, spaced_review_count INTEGER NOT NULL DEFAULT 0)
```

外键：`[{"id": 0, "seq": 0, "table": "workspaces", "from": "workspace_id", "to": "id", "on_update": "NO ACTION", "on_delete": "CASCADE", "match": "NONE"}]`

## workspaces

| 字段 | 类型 | NOT NULL | 主键序号 | 默认值 |
| --- | --- | --- | --- | --- |
| `id` | TEXT | 0 | 1 | `None` |
| `name` | TEXT | 1 | 0 | `None` |
| `root_path` | TEXT | 1 | 0 | `None` |
| `default_branch` | TEXT | 1 | 0 | `'main'` |
| `verify_command` | TEXT | 1 | 0 | `None` |
| `description` | TEXT | 1 | 0 | `''` |
| `created_at` | TEXT | 1 | 0 | `None` |

```sql
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL,
  default_branch TEXT NOT NULL DEFAULT 'main',
  verify_command TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
)
```

