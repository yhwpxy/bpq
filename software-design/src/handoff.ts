import type {WorkflowDetailSnapshot} from '../../workflow-orchestrator/src/shared/api.ts';
import type {WorkflowPlannerEngine} from '../../workflow-orchestrator/src/engines/planner.ts';
import type {OrchestratorStore} from '../../workflow-orchestrator/src/store/database.ts';
import {OrchestratorError} from '../../workflow-orchestrator/src/shared/errors.ts';
import {identifier, object, string, SchemaError} from '../../requirements-engineering/src/schema.ts';
import {canonical, type DesignRevision, type DesignReviewService} from './reviews.ts';
import type {DesignService} from './service.ts';
import {projectConfirmedDesign, type DesignPmInput} from './pm-input.ts';

const handoffSchema = object({workspaceId: identifier, expectedHash: string(64, 64, /^[a-f0-9]{64}$/)});
export interface HandoffDiagnostic {code: string; path: string; message: string}
export interface DesignHandoffReceipt {
  designRef: DesignPmInput['designRef']; workflowId: string; pmReportId: string | null;
  status: 'received' | 'pending_review'; createdAt: string; diagnostics: HandoffDiagnostic[];
  workflow: WorkflowDetailSnapshot | null;
}
export interface DesignHandoffResult {created: boolean; receipt: DesignHandoffReceipt}
const same = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

export function verifyPmReceipt(source: DesignPmInput, detail: WorkflowDetailSnapshot | null, workflowId: string): HandoffDiagnostic[] {
  const diagnostics: HandoffDiagnostic[] = [];
  const add = (code: string, path: string, message: string) => diagnostics.push({code, path, message});
  if (!detail) return [{code: 'missing_workflow', path: 'workflow', message: '工作流回执暂不可读，请按原交接键查询'}];
  if (detail.workflow.id !== workflowId || detail.workflow.workspaceId !== source.designRef.workspaceId || detail.goalSpec?.workflowId !== workflowId) add('workflow_mismatch', 'workflow', '回执未定位到选定工程中的同一工作流');
  if (!detail.goalSpec) add('input_mismatch', 'goalSpec', '返回的 GoalSpec 缺失');
  else {
    const {id: _id, workflowId: _wf, updatedAt: _updated, ...goalInput} = detail.goalSpec;
    if (!same(goalInput, source.goalSpec)) add('input_mismatch', 'goalSpec', '返回的 GoalSpec 未完整保留本次结构化输入');
  }
  const report = detail.pmReport;
  if (!report) {add('missing_pm_report', 'pmReport', 'PM 报告缺失，交接待核查；请查询原工作流，避免重新创建'); return diagnostics;}
  if (typeof report.id !== 'string' || !report.id.trim() || report.workflowId !== workflowId) add('pm_report_mismatch', 'pmReport', 'PM 报告编号缺失或不属于同一工作流');
  if (!same(report.detectedModules, source.goalSpec.modules)) add('module_mismatch', 'pmReport.detectedModules', 'PM 检测模块与本次确认设计不一致');
  if (!Array.isArray(detail.nodes) || !Array.isArray(detail.edges) || !detail.validation || detail.validation.workflowId !== workflowId) add('incomplete_graph', 'workflow', '图或校验回执缺失，或未绑定本次工作流');
  if (!Array.isArray(report.slices) || report.slices.some(s => !s || !Array.isArray(s.requirementRefs) || !Array.isArray(s.fileScope))) {
    add('invalid_slices', 'pmReport.slices', 'PM 拆分缺少需求或文件范围字段'); return diagnostics;
  }
  const required = new Set(source.goalSpec.requirements.map(r => r.code));
  const files = new Set(source.goalSpec.modules?.flatMap(m => [...m.artifacts]) ?? []);
  if (!report.slices.length) add('missing_slices', 'pmReport.slices', 'PM 报告未提供本次模块的拆分结果');
  report.slices.forEach((s, i) => {
    if (s.requirementRefs.some((id: string) => !required.has(id))) add('unknown_requirement', `pmReport.slices[${i}].requirementRefs`, '拆分包含输入外的需求引用');
    if (s.fileScope.some((path: string) => !files.has(path))) add('unexpected_file_scope', `pmReport.slices[${i}].fileScope`, '拆分文件范围超出了确认设计的目标文件');
  });
  for (const req of required) if (!report.slices.some(s => s.requirementRefs.includes(req))) add('uncovered_requirement', 'pmReport.slices', `需求 ${req} 未出现在 PM 拆分中`);
  source.goalSpec.modules?.forEach((m, i) => {
    if (m.artifacts.some(file => !report.slices.some(s => s.fileScope.includes(file) && m.relatedFrCodes.every(r => s.requirementRefs.includes(r))))) add('uncovered_module', `modules[${i}]`, `模块 ${m.name} 的需求与文件没有被同一 PM 切片覆盖`);
  });
  return diagnostics;
}

export class DesignHandoffService {
  constructor(private readonly store: OrchestratorStore, private readonly reviews: DesignReviewService,
    private readonly designs: DesignService, private readonly planner: Pick<WorkflowPlannerEngine, 'importStructuredRequirements' | 'getWorkflowDetail'>) {
    const columns = new Set(store.db.prepare("PRAGMA table_info('design_handoffs')").all().map(r => r['name']));
    for (const [name, definition] of Object.entries({content_sha256: 'TEXT', pm_report_id: 'TEXT',
      status: "TEXT NOT NULL DEFAULT 'pending_review'", diagnostics_json: "TEXT NOT NULL DEFAULT '[]'", receipt_json: 'TEXT'})) {
      if (!columns.has(name)) store.db.exec(`ALTER TABLE design_handoffs ADD COLUMN ${name} ${definition}`);
    }
    store.db.exec(`CREATE TRIGGER IF NOT EXISTS design_handoff_identity_frozen BEFORE UPDATE ON design_handoffs
      WHEN OLD.design_id IS NOT NEW.design_id OR OLD.revision IS NOT NEW.revision OR OLD.workspace_id IS NOT NEW.workspace_id
        OR OLD.workflow_id IS NOT NEW.workflow_id OR OLD.created_at IS NOT NEW.created_at
        OR (OLD.content_sha256 IS NOT NULL AND OLD.content_sha256 IS NOT NEW.content_sha256)
        OR OLD.status='received'
      BEGIN SELECT RAISE(ABORT, 'Design handoff identity and accepted receipt are immutable'); END;`);
    store.db.exec(`CREATE TRIGGER IF NOT EXISTS design_handoff_no_delete BEFORE DELETE ON design_handoffs
      BEGIN SELECT RAISE(ABORT, 'Design handoff identity is immutable'); END;`);
  }

  private prepare(id: string, revision: number, value: unknown) {
    let request;
    try {request = handoffSchema.parse(value);} catch (e) {throw new OrchestratorError('VALIDATION_ERROR', e instanceof SchemaError ? e.message : '交接参数无效');}
    const snapshot = this.reviews.read(id, revision), source = projectConfirmedDesign(snapshot, request.expectedHash);
    if (request.workspaceId !== source.designRef.workspaceId) throw new OrchestratorError('CONFLICT', 'workspaceId 与确认设计的目标工程不一致', 409, {field: 'workspaceId', expected: source.designRef.workspaceId});
    if (this.store.getWorkspace(request.workspaceId).description === 'hama-document-workspace') throw new OrchestratorError('SPEC_INVALID', '文档工作区不能接收正式设计交接', 422);
    return {snapshot, source};
  }
  private assertSource(snapshot: DesignRevision) {
    const diff = this.designs.compareSource(snapshot.input.workspace.workspaceId, snapshot.input.workspace.sourceCommit!);
    if (diff.currentCommit !== diff.expectedCommit) {
      const globalChange = diff.changedPaths.some(path => /(^|\/)(package\.json|pyproject\.toml|requirements\.txt|Cargo\.toml|go\.mod|pom\.xml|Makefile)$/.test(path));
      const affected = new Set(snapshot.body.modules.filter(m => !diff.complete || globalChange || m.files.some(f => diff.changedPaths.includes(f.path))).map(m => m.id));
      // A provider change also requires its declared consumers to be reviewed.
      for (let size = -1; size !== affected.size;) {
        size = affected.size;
        snapshot.body.modules.forEach(m => {if (m.dependsOn.some(id => affected.has(id))) affected.add(m.id);});
      }
      throw new OrchestratorError('CONFLICT', '源码提交已变化，请按受影响范围新增设计修订并重新评审', 409, {
        route: 'design_review', designId: snapshot.designId, revision: snapshot.revision, requiresNewRevision: true, ...diff,
        affectedModules: snapshot.body.modules.filter(m => affected.has(m.id)).map(m => ({id: m.id, files: m.files.map(f => f.path)})),
        scopeAnalysis: '目标文件、构建清单及已声明的模块依赖；其他改动仍需人工复核',
      });
    }
  }
  private existing(source: DesignPmInput): DesignHandoffReceipt | null {
    const d = source.designRef;
    const row = this.store.db.prepare('SELECT * FROM design_handoffs WHERE design_id=? AND revision=? AND workspace_id=?').get(d.designId, d.revision, d.workspaceId);
    if (!row) return null;
    if (row['content_sha256'] && row['content_sha256'] !== d.contentSha256) throw new OrchestratorError('CONFLICT', '交接键对应的确认摘要不一致', 409);
    let workflow: WorkflowDetailSnapshot | null = row['receipt_json'] ? JSON.parse(String(row['receipt_json'])) : null;
    if (row['status'] !== 'received') {
      try {workflow = this.planner.getWorkflowDetail(String(row['workflow_id']));} catch {workflow = null;}
    }
    const diagnostics = verifyPmReceipt(source, workflow, String(row['workflow_id']));
    const receipt: DesignHandoffReceipt = {designRef: d, workflowId: String(row['workflow_id']),
      pmReportId: workflow?.pmReport?.id ?? null, status: diagnostics.length ? 'pending_review' : 'received',
      createdAt: String(row['created_at']), diagnostics, workflow};
    if (row['status'] !== 'received') this.store.db.prepare(`UPDATE design_handoffs SET content_sha256=?, pm_report_id=?, status=?, diagnostics_json=?, receipt_json=?
      WHERE design_id=? AND revision=? AND workspace_id=?`).run(d.contentSha256, receipt.pmReportId, receipt.status,
      JSON.stringify(diagnostics), workflow ? JSON.stringify(workflow) : null, d.designId, d.revision, d.workspaceId);
    return receipt;
  }
  handoff(id: string, revision: number, value: unknown): DesignHandoffResult {
    const notifications: Array<() => void> = [];
    this.store.db.exec('BEGIN IMMEDIATE');
    let result: DesignHandoffResult;
    try {
      const {snapshot, source} = this.prepare(id, revision, value);
      const existing = this.existing(source);
      if (existing) result = {created: false, receipt: existing};
      else {
        this.assertSource(snapshot);
        const detail = this.planner.importStructuredRequirements(source.designRef.workspaceId, source.goalSpec,
          {deferBroadcast: publish => notifications.push(publish)});
        this.assertSource(snapshot);
        const diagnostics = verifyPmReceipt(source, detail, detail.workflow.id);
        const receipt: DesignHandoffReceipt = {designRef: source.designRef, workflowId: detail.workflow.id,
          pmReportId: detail.pmReport?.id ?? null, status: diagnostics.length ? 'pending_review' : 'received',
          createdAt: new Date().toISOString(), diagnostics, workflow: detail};
        this.store.db.prepare(`INSERT INTO design_handoffs
          (design_id, revision, workspace_id, workflow_id, created_at, content_sha256, pm_report_id, status, diagnostics_json, receipt_json)
          VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id, revision, source.designRef.workspaceId, detail.workflow.id, receipt.createdAt,
          source.designRef.contentSha256, receipt.pmReportId, receipt.status, JSON.stringify(diagnostics), JSON.stringify(detail));
        result = {created: true, receipt};
      }
      this.store.db.exec('COMMIT');
    } catch (e) {this.store.db.exec('ROLLBACK'); throw e;}
    // The ledger, report and graph are visible to observers before any notification is delivered.
    for (const publish of notifications) {try {publish();} catch { /* A client disconnect cannot undo a committed handoff. */ }}
    return result;
  }
  lookup(id: string, revision: number, value: unknown): DesignHandoffReceipt {
    this.store.db.exec('BEGIN IMMEDIATE');
    try {
      const {source} = this.prepare(id, revision, value);
      const receipt = this.existing(source);
      if (!receipt) throw new OrchestratorError('NOT_FOUND', '此修订尚无交接记录，可按原键提交', 404);
      this.store.db.exec('COMMIT'); return receipt;
    } catch (e) {this.store.db.exec('ROLLBACK'); throw e;}
  }
  forWorkflow(workflowId: string): DesignHandoffReceipt {
    const row = this.store.db.prepare('SELECT design_id, revision, workspace_id, content_sha256 FROM design_handoffs WHERE workflow_id=?').get(workflowId);
    if (!row) throw new OrchestratorError('NOT_FOUND', '工作流没有设计交接关联', 404);
    const snapshot = this.reviews.read(String(row['design_id']), Number(row['revision']));
    return this.lookup(snapshot.designId, snapshot.revision, {workspaceId: String(row['workspace_id']), expectedHash: snapshot.contentSha256});
  }
}
