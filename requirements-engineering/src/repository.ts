import {createHash, randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import type {WorkflowStepContext} from '../../workflow-orchestrator/src/engines/workflow-handler.ts';
import {OrchestratorError} from '../../workflow-orchestrator/src/shared/errors.ts';
import type {
  ApprovedRequirementsBaseline, Artifact, ArtifactRef, Decision, HumanGate, StartInput,
} from './contracts.ts';

function now(): string {
  return new Date().toISOString();
}

export function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function reference<K extends string>(artifact: Artifact<unknown, K>): ArtifactRef<K> {
  const {id, kind, revision, hash} = artifact;
  return {id, kind, revision, hash};
}

function decode<T>(row: Record<string, unknown> | undefined): T | null {
  return row ? JSON.parse(String(row['payload'])) as T : null;
}

export class HamaRepository {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS hama_runs (
        run_id TEXT PRIMARY KEY REFERENCES workflow_runs(id),
        project_id TEXT NOT NULL, mode TEXT NOT NULL, payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS hama_artifacts (
        id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES hama_runs(run_id),
        attempt_id TEXT NOT NULL REFERENCES node_attempts(id), kind TEXT NOT NULL, subject TEXT NOT NULL,
        revision INTEGER NOT NULL, payload TEXT NOT NULL,
        UNIQUE(run_id, kind, subject, revision)
      );
      CREATE TABLE IF NOT EXISTS hama_gates (
        id TEXT PRIMARY KEY REFERENCES interventions(id), run_id TEXT NOT NULL REFERENCES hama_runs(run_id),
        payload TEXT NOT NULL, decision TEXT, submitted TEXT
      );
      CREATE TABLE IF NOT EXISTS hama_baselines (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, mode TEXT NOT NULL,
        revision INTEGER NOT NULL, run_id TEXT NOT NULL UNIQUE REFERENCES hama_runs(run_id),
        payload TEXT NOT NULL, UNIQUE(project_id, mode, revision)
      );
      CREATE TRIGGER IF NOT EXISTS hama_baseline_no_update BEFORE UPDATE ON hama_baselines
        BEGIN SELECT RAISE(ABORT, 'Approved baseline is immutable'); END;
      CREATE TRIGGER IF NOT EXISTS hama_baseline_no_delete BEFORE DELETE ON hama_baselines
        BEGIN SELECT RAISE(ABORT, 'Approved baseline is immutable'); END;
    `);
  }

  initialize(runId: string, input: StartInput): void {
    this.assertAvailable(input);
    this.db.prepare('INSERT INTO hama_runs VALUES (?, ?, ?, ?)').run(
      runId, input.projectId, input.mode, JSON.stringify(input),
    );
  }

  input(runId: string): StartInput {
    const input = decode<StartInput>(this.db.prepare('SELECT payload FROM hama_runs WHERE run_id=?').get(runId));
    if (!input) throw new OrchestratorError('NOT_FOUND', '需求工程运行不存在', 404);
    return input;
  }

  runIds(): string[] {
    return this.db.prepare('SELECT run_id FROM hama_runs ORDER BY rowid DESC').all()
      .map(row => String(row['run_id']));
  }

  stage<T, K extends string>(context: WorkflowStepContext, kind: K, data: T, subject = ''): Artifact<T, K> {
    const row = this.db.prepare(`SELECT MAX(revision) AS revision FROM hama_artifacts
      WHERE run_id=? AND kind=? AND subject=?`).get(context.run.id, kind, subject);
    return {
      id: `${kind}-${randomUUID()}`, kind, subject, revision: Number(row?.['revision'] ?? 0) + 1,
      hash: hash(data), runId: context.run.id, workflowId: context.run.workflowId,
      attemptId: context.attemptId, createdAt: now(), data,
    };
  }

  write(...artifacts: Artifact[]): void {
    const insert = this.db.prepare('INSERT INTO hama_artifacts VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const a of artifacts) insert.run(a.id, a.runId, a.attemptId, a.kind, a.subject, a.revision, JSON.stringify(a));
  }

  list(runId: string): Artifact[] {
    return this.db.prepare('SELECT payload FROM hama_artifacts WHERE run_id=? ORDER BY rowid')
      .all(runId).map(row => decode<Artifact>(row)!);
  }

  latest<T, K extends string = string>(runId: string, kind: K, subject = ''): Artifact<T, K> | null {
    return decode<Artifact<T, K>>(this.db.prepare(`SELECT payload FROM hama_artifacts
      WHERE run_id=? AND kind=? AND subject=? ORDER BY revision DESC LIMIT 1`).get(runId, kind, subject));
  }

  read<T, K extends string = string>(runId: string, ref: ArtifactRef<K>): Artifact<T, K> {
    const a = decode<Artifact<T, K>>(this.db.prepare('SELECT payload FROM hama_artifacts WHERE id=? AND run_id=?')
      .get(ref.id, runId));
    if (!a || a.kind !== ref.kind || a.revision !== ref.revision || a.hash !== ref.hash) {
      throw new Error('工件引用失效');
    }
    return a;
  }

  bind(runId: string, gate: HumanGate): void {
    this.db.prepare('INSERT INTO hama_gates (id, run_id, payload) VALUES (?, ?, ?)')
      .run(gate.id, runId, JSON.stringify(gate));
  }

  gate(runId: string, id: string): {gate: HumanGate; submitted: string | null} {
    const row = this.db.prepare('SELECT payload, submitted FROM hama_gates WHERE id=? AND run_id=?').get(id, runId);
    if (!row) throw new OrchestratorError('NOT_FOUND', '审批请求不存在', 404);
    return {gate: decode<HumanGate>(row)!, submitted: row['submitted'] as string | null};
  }

  decide(decision: Decision, request: string): void {
    const result = this.db.prepare('UPDATE hama_gates SET decision=?, submitted=? WHERE id=? AND submitted IS NULL')
      .run(JSON.stringify(decision), request, decision.id);
    if (result.changes !== 1) throw new OrchestratorError('CONFLICT', '审批已处理', 409);
  }

  decisions(runId: string): Decision[] {
    return this.db.prepare('SELECT decision AS payload FROM hama_gates WHERE run_id=? AND decision IS NOT NULL ORDER BY rowid')
      .all(runId).map(row => decode<Decision>(row)!);
  }

  baselineForRun(runId: string): ApprovedRequirementsBaseline | null {
    return decode(this.db.prepare('SELECT payload FROM hama_baselines WHERE run_id=?').get(runId));
  }

  baseline(id: string): ApprovedRequirementsBaseline {
    const value = decode<ApprovedRequirementsBaseline>(this.db.prepare('SELECT payload FROM hama_baselines WHERE id=?').get(id));
    if (!value) throw new OrchestratorError('NOT_FOUND', '需求基线不存在', 404);
    return value;
  }

  baselines(projectId: string): ApprovedRequirementsBaseline[] {
    return this.db.prepare('SELECT payload FROM hama_baselines WHERE project_id=? ORDER BY mode, revision DESC')
      .all(projectId).map(row => decode<ApprovedRequirementsBaseline>(row)!);
  }

  assertParent(input: StartInput): ApprovedRequirementsBaseline | null {
    const head = this.baselines(input.projectId).find(b => b.mode === input.mode) ?? null;
    if ((head?.id ?? '') !== input.parentBaselineId) {
      throw new OrchestratorError('CONFLICT', '请选择该项目当前最新基线作为变更来源', 409);
    }
    return head;
  }

  assertAvailable(input: StartInput): void {
    this.assertParent(input);
    const existing = this.db.prepare(`SELECT 1 FROM hama_runs h JOIN workflow_runs w ON h.run_id=w.id
      WHERE h.project_id=? AND h.mode=? AND w.status IN ('queued', 'running', 'paused', 'waiting_human', 'failed') LIMIT 1`)
      .get(input.projectId, input.mode);
    if (existing) throw new OrchestratorError('CONFLICT', '此项目已有活动运行，请从运行列表继续', 409);
  }

  publish(runId: string, baseline: ApprovedRequirementsBaseline): void {
    this.db.prepare('INSERT INTO hama_baselines VALUES (?, ?, ?, ?, ?, ?)')
      .run(baseline.id, baseline.projectId, baseline.mode, baseline.revision, runId, JSON.stringify(baseline));
  }

  logCall(context: WorkflowStepContext, role: string, model: string, retry: number, outcome: string): void {
    // One independent subject per call keeps concurrent evaluator records distinct.
    const subject = randomUUID();
    this.write(this.stage(context, 'model_call', {role, model, retry, outcome}, subject));
  }
}
