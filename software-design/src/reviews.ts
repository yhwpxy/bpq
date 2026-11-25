import {randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {hash} from '../../requirements-engineering/src/repository.ts';
import {array, choice, object, string, SchemaError, type Validated} from '../../requirements-engineering/src/schema.ts';
import {OrchestratorError} from '../../workflow-orchestrator/src/shared/errors.ts';
import type {DesignInputDraft} from './contracts.ts';
import {designBodySchema, type DesignBody, type DesignDiagnostic} from './design-schema.ts';
import {validateDesign} from './design-validation.ts';
import {renderDesign, validatePreview} from './design-render.ts';
import type {DesignGeneration} from './generator.ts';
import type {DesignService} from './service.ts';

export type DesignState = 'draft' | 'in_review' | 'changes_requested' | 'confirmed';
const findingSchema = object({target: string(512), severity: choice('info', 'warning', 'blocking'),
  evidence: string(6000), resolution: string(6000, 0)});
const reviewSchema = object({expectedHash: string(64, 64, /^[a-f0-9]{64}$/), actor: string(120),
  action: choice('submit', 'request_changes', 'confirm'), scope: choice('technical', 'requirements'),
  findings: array(findingSchema, 0, 100)});
export type ReviewRequest = Validated<typeof reviewSchema>;
export interface DesignDecision extends ReviewRequest {decisionId: string; designId: string; revision: number; decidedAt: string}
export interface RevisionMetadata {
  actor: string; reason: string; generationId: string | null;
  resolutions: Array<{decisionId: string; target: string; resolution: string}>;
  previousDesign: {designId: string; revision: number; contentSha256: string} | null;
  baselineDiff: ReturnType<typeof compareBaselines> | null;
}
export interface DesignRevision {
  designId: string; revision: number; parentRevision: number | null; state: DesignState; schemaVersion: 1;
  input: DesignInputDraft; body: DesignBody; contentSha256: string; createdAt: string;
  reviewMarkdown: string; pmMarkdown: string; diagnostics: DesignDiagnostic[];
  metadata: RevisionMetadata; decisions: DesignDecision[]; handoffs: Array<Record<string, unknown>>;
  diff: {changedFields: string[]; changes: Array<{field: string; before: unknown; after: unknown}>; addedFiles: string[]; removedFiles: string[]; targetChanged: boolean};
}

/** Sort object keys only; array order remains part of the reviewed content. */
export function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, canonical(v)]));
  return value;
}
export function revisionHash(input: DesignInputDraft, body: DesignBody): string {
  return hash(canonical({schemaVersion: 1, baselineRef: input.baselineRef,
    workspaceId: input.workspace.workspaceId, sourceCommit: input.workspace.sourceCommit, body}));
}
export function compareBaselines(before: DesignInputDraft, after: DesignInputDraft) {
  const compare = (a: Array<{id: string}>, b: Array<{id: string}>) => {
    const old = new Map(a.map(r => [r.id, hash(canonical(r))])), next = new Map(b.map(r => [r.id, hash(canonical(r))]));
    return {added: [...next.keys()].filter(id => !old.has(id)), removed: [...old.keys()].filter(id => !next.has(id)),
      changed: [...next.keys()].filter(id => old.has(id) && old.get(id) !== next.get(id)),
      unchanged: [...next.keys()].filter(id => old.get(id) === next.get(id))};
  };
  return {requirements: compare(before.baseline.prd.requirements, after.baseline.prd.requirements),
    acceptance: compare(before.baseline.prd.requirements.flatMap(r => r.acceptance), after.baseline.prd.requirements.flatMap(r => r.acceptance))};
}

export class DesignReviewService {
  constructor(private readonly db: DatabaseSync, private readonly designs: DesignService) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS design_revisions (
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
      );
      CREATE TABLE IF NOT EXISTS design_decisions (
        decision_id TEXT PRIMARY KEY, design_id TEXT NOT NULL, revision INTEGER NOT NULL,
        expected_hash TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL,
        findings_json TEXT NOT NULL, scope TEXT NOT NULL, decided_at TEXT NOT NULL,
        FOREIGN KEY(design_id, revision) REFERENCES design_revisions(design_id, revision)
      );
      CREATE TABLE IF NOT EXISTS design_handoffs (
        design_id TEXT NOT NULL, revision INTEGER NOT NULL, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        workflow_id TEXT NOT NULL UNIQUE REFERENCES workflows(id), created_at TEXT NOT NULL,
        PRIMARY KEY(design_id, revision, workspace_id),
        FOREIGN KEY(design_id, revision) REFERENCES design_revisions(design_id, revision)
      );
      CREATE TRIGGER IF NOT EXISTS design_revision_no_delete BEFORE DELETE ON design_revisions
        BEGIN SELECT RAISE(ABORT, 'Design revision is immutable'); END;
      CREATE TRIGGER IF NOT EXISTS design_revision_freeze BEFORE UPDATE ON design_revisions
        WHEN OLD.design_id IS NOT NEW.design_id OR OLD.revision IS NOT NEW.revision OR OLD.parent_revision IS NOT NEW.parent_revision
          OR OLD.baseline_id IS NOT NEW.baseline_id OR OLD.project_id IS NOT NEW.project_id OR OLD.baseline_revision IS NOT NEW.baseline_revision
          OR OLD.baseline_sha256 IS NOT NEW.baseline_sha256 OR OLD.workspace_id IS NOT NEW.workspace_id OR OLD.source_commit IS NOT NEW.source_commit
          OR OLD.schema_version IS NOT NEW.schema_version OR OLD.input_json IS NOT NEW.input_json OR OLD.body_json IS NOT NEW.body_json
          OR OLD.content_sha256 IS NOT NEW.content_sha256 OR OLD.created_at IS NOT NEW.created_at OR OLD.metadata_json IS NOT NEW.metadata_json
          OR OLD.review_markdown IS NOT NEW.review_markdown OR OLD.pm_markdown IS NOT NEW.pm_markdown OR OLD.diagnostics_json IS NOT NEW.diagnostics_json
          OR NOT ((OLD.state='draft' AND NEW.state='in_review') OR (OLD.state='in_review' AND NEW.state IN ('confirmed','changes_requested')))
        BEGIN SELECT RAISE(ABORT, 'Design revision is immutable or state transition invalid'); END;
      CREATE TRIGGER IF NOT EXISTS design_decision_no_update BEFORE UPDATE ON design_decisions
        BEGIN SELECT RAISE(ABORT, 'Design decision is immutable'); END;
      CREATE TRIGGER IF NOT EXISTS design_decision_no_delete BEFORE DELETE ON design_decisions
        BEGIN SELECT RAISE(ABORT, 'Design decision is immutable'); END;
      CREATE TRIGGER IF NOT EXISTS design_handoff_confirmed BEFORE INSERT ON design_handoffs
        WHEN NOT EXISTS (SELECT 1 FROM design_revisions WHERE design_id=NEW.design_id AND revision=NEW.revision
          AND workspace_id=NEW.workspace_id AND state='confirmed')
        BEGIN SELECT RAISE(ABORT, 'Handoff requires confirmed design and matching workspace'); END;
    `);
  }

  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {const value = fn(); this.db.exec('COMMIT'); return value;}
    catch (e) {this.db.exec('ROLLBACK'); throw e;}
  }
  heads(baselineId?: string): DesignRevision[] {
    return this.db.prepare(`SELECT r.design_id, r.revision FROM design_revisions r
      WHERE r.revision=(SELECT MAX(revision) FROM design_revisions WHERE design_id=r.design_id)
        AND (? IS NULL OR r.baseline_id=?) ORDER BY r.created_at DESC`).all(baselineId ?? null, baselineId ?? null)
      .map(r => this.read(String(r['design_id']), Number(r['revision'])));
  }
  list(id: string): DesignRevision[] {
    return this.db.prepare('SELECT revision FROM design_revisions WHERE design_id=? ORDER BY revision').all(id)
      .map(r => this.read(id, Number(r['revision'])));
  }
  read(id: string, revision: number): DesignRevision {
    const r = this.db.prepare('SELECT * FROM design_revisions WHERE design_id=? AND revision=?').get(id, revision);
    if (!r) throw new OrchestratorError('NOT_FOUND', '设计修订不存在', 404);
    const parse = <T>(key: string): T => JSON.parse(String(r[key])) as T;
    const parent = r['parent_revision'] === null ? null : this.db.prepare('SELECT body_json, source_commit FROM design_revisions WHERE design_id=? AND revision=?').get(id, Number(r['parent_revision']));
    const body = parse<DesignBody>('body_json');
    const old = parent ? JSON.parse(String(parent['body_json'])) as DesignBody : null;
    const changedFields = old ? [...new Set([...Object.keys(old), ...Object.keys(body)])].filter(k =>
      JSON.stringify(canonical(body[k as keyof DesignBody])) !== JSON.stringify(canonical(old[k as keyof DesignBody]))) : Object.keys(body);
    const files = (b: DesignBody | null) => b?.modules.flatMap(m => m.files.map(f => f.path)) ?? [];
    return {designId: id, revision, parentRevision: r['parent_revision'] === null ? null : Number(r['parent_revision']),
      state: r['state'] as DesignState, schemaVersion: 1, input: parse('input_json'), body,
      contentSha256: String(r['content_sha256']), createdAt: String(r['created_at']), metadata: parse('metadata_json'),
      reviewMarkdown: String(r['review_markdown']), pmMarkdown: String(r['pm_markdown']), diagnostics: parse('diagnostics_json'),
      decisions: this.db.prepare('SELECT * FROM design_decisions WHERE design_id=? AND revision=? ORDER BY rowid').all(id, revision).map(d => ({
        decisionId: String(d['decision_id']), designId: id, revision, expectedHash: String(d['expected_hash']), actor: String(d['actor']),
        action: d['action'] as ReviewRequest['action'], scope: d['scope'] as ReviewRequest['scope'],
        findings: JSON.parse(String(d['findings_json'])), decidedAt: String(d['decided_at']),
      })),
      handoffs: this.db.prepare('SELECT * FROM design_handoffs WHERE design_id=? AND revision=?').all(id, revision),
      diff: {changedFields, changes: changedFields.map(field => ({field, before: old?.[field as keyof DesignBody] ?? null, after: body[field as keyof DesignBody] ?? null})),
        addedFiles: files(body).filter(f => !files(old).includes(f)), removedFiles: files(old).filter(f => !files(body).includes(f)),
        targetChanged: !!parent && parent['source_commit'] !== r['source_commit']},
    };
  }
  private head(id: string): DesignRevision {
    const row = this.db.prepare('SELECT MAX(revision) AS revision FROM design_revisions WHERE design_id=?').get(id);
    if (!row?.['revision']) throw new OrchestratorError('NOT_FOUND', '设计系列不存在', 404);
    return this.read(id, Number(row['revision']));
  }
  private conflict(id: string, revision: number, expectedHash: string): DesignRevision {
    const current = this.head(id);
    if (current.revision !== revision || current.contentSha256 !== expectedHash) this.failConflict(current);
    return current;
  }
  private failConflict(current: DesignRevision): never {
    throw new OrchestratorError('CONFLICT', '修订、摘要或状态已变化，请读取当前版本后重试', 409,
      {current: {designId: current.designId, revision: current.revision, contentSha256: current.contentSha256, state: current.state}});
  }
  private prepare(input: DesignInputDraft, value: unknown) {
    let body: DesignBody;
    try {body = designBodySchema.parse(value);} catch (e) {throw new OrchestratorError('VALIDATION_ERROR', (e as Error).message, 422);}
    body.constraints = [...new Set([...input.baseline.prd.sections.constraints, ...input.baseline.prd.requirements.flatMap(r => r.constraints), ...body.constraints])];
    body.dataRules = [...new Set([...input.baseline.prd.sections.businessRules, ...body.dataRules])];
    const diagnostics = validateDesign(body, input), rendered = renderDesign(body, input);
    diagnostics.push(...validatePreview(body, input, rendered.pmMarkdown));
    if (diagnostics.some(d => d.severity === 'error')) throw new OrchestratorError('SPEC_INVALID', '修订存在覆盖或结构缺口', 422, {diagnostics});
    return {body, diagnostics, ...rendered};
  }
  private insert(input: DesignInputDraft, value: unknown, revision: number, parent: number | null, metadata: RevisionMetadata): DesignRevision {
    const prepared = this.prepare(input, value), b = input.baselineRef;
    this.db.prepare(`INSERT INTO design_revisions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      input.designId, revision, parent, b.id, b.projectId, b.revision, b.sha256, input.workspace.workspaceId, input.workspace.sourceCommit,
      1, JSON.stringify(input), JSON.stringify(prepared.body), revisionHash(input, prepared.body), 'draft', new Date().toISOString(),
      JSON.stringify(metadata), prepared.reviewMarkdown, prepared.pmMarkdown, JSON.stringify(prepared.diagnostics));
    return this.read(input.designId, revision);
  }
  /** Explicitly adopt one successful generation; later attempts cannot replace reviewed content. */
  createFromGeneration(g: DesignGeneration, value: unknown): DesignRevision {
    const v = value as {actor?: string; reason?: string; previousDesign?: {designId: string; revision: number; contentSha256: string}};
    if (!v || typeof v.actor !== 'string' || !v.actor.trim() || v.actor.length > 120 || typeof v.reason !== 'string' || !v.reason.trim() || v.reason.length > 6000) throw new OrchestratorError('VALIDATION_ERROR', '请填写 actor 和 reason');
    if (g.status !== 'ready' || !g.body) throw new OrchestratorError('SPEC_INVALID', '只能采用已通过生成校验的草案', 422);
    const input = this.designs.read(g.designId);
    if (input.contentSha256 !== g.input.contentSha256 || hash({baselineRef: input.baselineRef, baseline: input.baseline, workspace: input.workspace}) !== input.contentSha256) throw new OrchestratorError('CONFLICT', '生成记录与设计输入不一致', 409);
    return this.transaction(() => {
      if (this.db.prepare('SELECT 1 FROM design_revisions WHERE design_id=?').get(g.designId)) this.failConflict(this.head(g.designId));
      let previous: DesignRevision | null = null;
      if (v.previousDesign) {
        const p = v.previousDesign;
        if (typeof p !== 'object' || Array.isArray(p) || typeof p.designId !== 'string' || !/^[\w-]{1,80}$/.test(p.designId) ||
          !Number.isSafeInteger(p.revision) || p.revision < 1 || typeof p.contentSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(p.contentSha256)) {
          throw new OrchestratorError('VALIDATION_ERROR', 'previousDesign 必须指定有效的 designId、revision 和 contentSha256');
        }
        previous = this.conflict(p.designId, p.revision, p.contentSha256);
        if (previous.input.baselineRef.projectId !== input.baselineRef.projectId || previous.input.workspace.workspaceId !== input.workspace.workspaceId ||
          previous.input.baselineRef.id === input.baselineRef.id || input.baselineRef.revision <= previous.input.baselineRef.revision ||
          !['confirmed', 'changes_requested'].includes(previous.state)) throw new OrchestratorError('CONFLICT', '新系列应使用同一项目与工作区的新基线，来源设计需已确认或已退回', 409);
      }
      return this.insert(input, g.body, 1, null, {actor: v.actor!.trim(), reason: v.reason!.trim(), generationId: g.generationId,
        resolutions: [], previousDesign: previous ? {designId: previous.designId, revision: previous.revision, contentSha256: previous.contentSha256} : null,
        baselineDiff: previous ? compareBaselines(previous.input, input) : null});
    });
  }
  review(id: string, revision: number, value: unknown): DesignRevision {
    let request: ReviewRequest;
    try {request = reviewSchema.parse({scope: 'technical', findings: [], ...(value as object)});} catch (e) {
      throw new OrchestratorError('VALIDATION_ERROR', e instanceof SchemaError ? e.message : '评审参数无效');
    }
    return this.transaction(() => {
      const current = this.conflict(id, revision, request.expectedHash);
      if (request.action === 'submit' ? current.state !== 'draft' : current.state !== 'in_review') this.failConflict(current);
      if (request.action !== 'request_changes') {
        const {input, body} = current;
        if (!input.workspace.sourceCommit || input.baseline.mode !== 'live') throw new OrchestratorError('SPEC_INVALID', '正式评审需要 live 基线及已绑定提交的工程；请新增修订绑定初始提交', 422);
        const checked = this.prepare(input, body);
        if (request.action === 'confirm' && (checked.diagnostics.length || body.unresolved.some(u => u.blocking) ||
          [...current.decisions.flatMap(d => d.findings), ...request.findings].some(f => f.severity === 'blocking' && !f.resolution))) {
          throw new OrchestratorError('SPEC_INVALID', '仍有阻断意见、未决事项或无证据假设，请退回修改', 422);
        }
        if (request.scope === 'requirements') throw new OrchestratorError('SPEC_INVALID', '需求范围变化必须退回 HAMA，不能直接确认', 422);
      }
      if (request.action === 'request_changes' && !request.findings.length) throw new OrchestratorError('VALIDATION_ERROR', '退回时请记录具体意见', 422);
      const state = {submit: 'in_review', request_changes: 'changes_requested', confirm: 'confirmed'}[request.action];
      const result = this.db.prepare('UPDATE design_revisions SET state=? WHERE design_id=? AND revision=? AND state=? AND content_sha256=?')
        .run(state, id, revision, current.state, request.expectedHash);
      if (result.changes !== 1) this.failConflict(this.head(id));
      this.db.prepare('INSERT INTO design_decisions VALUES (?,?,?,?,?,?,?,?,?)').run(randomUUID(), id, revision,
        request.expectedHash, request.actor, request.action, JSON.stringify(request.findings), request.scope, new Date().toISOString());
      return this.read(id, revision);
    });
  }
  revise(id: string, value: unknown, generationId?: string): DesignRevision {
    const v = value as {parentRevision?: number; expectedHash?: string; body?: unknown; actor?: string; reason?: string; sourceCommit?: string | null;
      resolutions?: RevisionMetadata['resolutions']; baselineId?: string};
    if (!v || !Number.isSafeInteger(v.parentRevision) || v.parentRevision! < 1 || !/^[a-f0-9]{64}$/.test(v.expectedHash ?? '') ||
      typeof v.actor !== 'string' || !v.actor.trim() || v.actor.length > 120 || typeof v.reason !== 'string' || !v.reason.trim() || v.reason.length > 6000) throw new OrchestratorError('VALIDATION_ERROR', '请提供父修订、摘要、actor、reason 和正文');
    return this.transaction(() => {
      const parent = this.conflict(id, v.parentRevision!, v.expectedHash!);
      if (!['changes_requested', 'confirmed'].includes(parent.state) && !(parent.state === 'draft' && parent.input.workspace.sourceCommit === null)) this.failConflict(parent);
      if (v.baselineId && v.baselineId !== parent.input.baselineRef.id || parent.decisions.some(d => d.action === 'request_changes' && d.scope === 'requirements')) {
        throw new OrchestratorError('CONFLICT', '需求目标或通过标准已改变，请在 HAMA 发布新基线并启动新的设计系列', 409,
          {route: 'hama', projectId: parent.input.baselineRef.projectId, parentBaselineId: parent.input.baselineRef.id});
      }
      const input = structuredClone(parent.input);
      if (v.sourceCommit !== undefined) {
        if (typeof v.sourceCommit !== 'string' || !/^[a-f0-9]{40,64}$/.test(v.sourceCommit)) throw new OrchestratorError('VALIDATION_ERROR', 'sourceCommit 必须是完整提交');
        input.workspace = this.designs.inspectWorkspace(input.workspace.workspaceId, v.sourceCommit);
        input.reviewEligible = input.baseline.mode === 'live'; input.blockers = input.reviewEligible ? [] : ['演示基线仅供演练'];
        input.contentSha256 = hash({baselineRef: input.baselineRef, baseline: input.baseline, workspace: input.workspace});
      }
      const resolutions = v.resolutions ?? [];
      if (!Array.isArray(resolutions) || resolutions.some(r => !r || typeof r.decisionId !== 'string' || typeof r.target !== 'string' || typeof r.resolution !== 'string' || !r.resolution.trim())) throw new OrchestratorError('VALIDATION_ERROR', '处理结果必须指定 decisionId、target 和非空 resolution');
      if (resolutions.some(r => !parent.decisions.some(d => d.decisionId === r.decisionId && d.findings.some(f => f.target === r.target)))) throw new OrchestratorError('VALIDATION_ERROR', '处理结果未指向父修订的真实意见');
      if (parent.decisions.some(d => d.findings.some(f => f.severity === 'blocking' && !f.resolution && !resolutions.some(r => r.decisionId === d.decisionId && r.target === f.target)))) throw new OrchestratorError('SPEC_INVALID', '请逐项记录父修订阻断意见的处理结果', 422);
      return this.insert(input, v.body, parent.revision + 1, parent.revision, {actor: v.actor!.trim(), reason: v.reason!.trim(),
        generationId: generationId ?? null, resolutions, previousDesign: null, baselineDiff: null});
    });
  }
  generationContext(id: string, revision: number, expectedHash: string, sourceCommit?: unknown) {
    const parent = this.conflict(id, revision, expectedHash);
    if (!['changes_requested', 'confirmed'].includes(parent.state) && !(parent.state === 'draft' && parent.input.workspace.sourceCommit === null)) this.failConflict(parent);
    if (parent.decisions.some(d => d.action === 'request_changes' && d.scope === 'requirements')) {
      throw new OrchestratorError('CONFLICT', '需求变化必须返回 HAMA 发布新基线', 409, {route: 'hama', parentBaselineId: parent.input.baselineRef.id});
    }
    const input = structuredClone(parent.input);
    if (sourceCommit !== undefined) {
      if (typeof sourceCommit !== 'string' || !/^[a-f0-9]{40,64}$/.test(sourceCommit)) throw new OrchestratorError('VALIDATION_ERROR', 'sourceCommit 必须是完整提交');
      input.workspace = this.designs.inspectWorkspace(input.workspace.workspaceId, sourceCommit);
      input.reviewEligible = input.baseline.mode === 'live'; input.blockers = input.reviewEligible ? [] : ['演示基线仅供演练'];
      input.contentSha256 = hash({baselineRef: input.baselineRef, baseline: input.baseline, workspace: input.workspace});
    }
    return {input, body: parent.body, decisions: parent.decisions};
  }
}
