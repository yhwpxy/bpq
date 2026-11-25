import {randomUUID} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import type {ProviderSecretLookup, ICapabilityHub} from '../../workflow-orchestrator/src/adapters/contracts.ts';
import type {WorkflowOrchestratorEngine} from '../../workflow-orchestrator/src/engines/orchestrator.ts';
import type {WorkflowPlannerEngine} from '../../workflow-orchestrator/src/engines/planner.ts';
import type {
  WorkflowHandler, WorkflowStepContext, WorkflowStepResult,
} from '../../workflow-orchestrator/src/engines/workflow-handler.ts';
import {OrchestratorError} from '../../workflow-orchestrator/src/shared/errors.ts';
import type {GraphNode, WorkflowVersionSnapshot} from '../../workflow-orchestrator/src/shared/types.ts';
import type {OrchestratorStore} from '../../workflow-orchestrator/src/store/database.ts';
import {HamaAgents, type DemoResponder} from './agents.ts';
import {decisionSchema, dimensions, startSchema, type Decision, type Dimension, type RunSummary, type RunView} from './contracts.ts';
import {campusResponder} from './demo.ts';
import {makeGraph, workflowPrefix} from './graph.ts';
import {acceptanceText, renderPrd} from './markdown.ts';
import {HamaPipeline, type Board, type Report, type Rework} from './pipeline.ts';
import {HamaRepository, reference} from './repository.ts';
import {identifier, SchemaError} from './schema.ts';

function reject(message: string): never {
  throw new OrchestratorError('CONFLICT', message, 409);
}

function parse<T>(schema: {parse(input: unknown): T}, value: unknown): T {
  try {
    return schema.parse(value);
  } catch (error) {
    if (error instanceof SchemaError) throw new OrchestratorError('VALIDATION_ERROR', error.message);
    throw error;
  }
}

export class HamaService implements WorkflowHandler {
  private readonly db: HamaRepository;
  private readonly agents: HamaAgents;

  constructor(
    private readonly store: OrchestratorStore,
    private readonly engine: WorkflowOrchestratorEngine,
    private readonly planner: WorkflowPlannerEngine,
    hub: ICapabilityHub,
    private readonly lookup: ProviderSecretLookup,
    private readonly documentRoot: string,
    demo: DemoResponder = campusResponder,
  ) {
    this.db = new HamaRepository(store.db);
    this.agents = new HamaAgents(hub, () => this.nativeCapability(), this.db, demo);
    engine.registerHandler(this);
  }

  matches(workflowId: string): boolean { return workflowId.startsWith(workflowPrefix); }

  private nativeCapability() {
    return this.store.listCapabilities().find(row =>
      row.id === 'native-api' && row.transport === 'native-api' && row.enabled);
  }

  handles(node: GraphNode): boolean {
    return !['start', 'join', 'done'].includes(node.kind);
  }

  async execute(context: WorkflowStepContext, signal: AbortSignal): Promise<WorkflowStepResult> {
    const pipeline = new HamaPipeline(context, this.db, this.agents, signal);
    const code = context.node.code;
    if (code.startsWith('eval-')) {
      const dimension = code.slice(5) as Dimension;
      if (Object.hasOwn(dimensions, dimension)) return pipeline.evaluate(dimension);
    }
    switch (code) {
      case 'intake': return pipeline.intake();
      case 'clarify': return pipeline.clarify();
      case 'discuss': return pipeline.discuss();
      case 'integrate': return pipeline.integrate();
      case 'evaluation': return pipeline.evaluation();
      case 'approval': return pipeline.approval();
      case 'prd': return pipeline.prd();
      case 'confirm': return pipeline.confirm();
      case 'publish': return pipeline.publish();
      default: throw new Error('未知 HAMA-Loop 节点');
    }
  }

  resolve(context: WorkflowStepContext, interventionId: string, raw: unknown): WorkflowStepResult | null {
    const input = parse(decisionSchema, raw);
    const runId = context.run.id;
    const {gate, submitted} = this.db.gate(runId, interventionId);
    const serialized = JSON.stringify(input);
    if (submitted === serialized) return null;
    if (submitted || gate.target.id !== input.targetId || gate.target.hash !== input.targetHash ||
        gate.attemptId !== context.attemptId) reject('审批请求已处理或版本已变更，请刷新后重试');
    if (!gate.options.includes(input.action)) reject('该审批关口不支持此动作');
    if (!input.feedback && !['approve', 'confirm'].includes(input.action)) reject('请填写原因、澄清答复或条件证据');
    const target = this.db.read(runId, gate.target);
    const decision: Decision = {...input, id: gate.id, gateKind: gate.kind,
      targetRevision: gate.target.revision, decidedAt: new Date().toISOString()};
    const pipeline = new HamaPipeline(context, this.db, this.agents, AbortSignal.abort());
    const save = (summary: string, next: Partial<WorkflowStepResult> = {}, extra = () => {}) =>
      pipeline.result(summary, [], {...next, commit: () => {
        this.db.decide(decision, serialized);
        extra();
      }});
    if (input.action === 'reject' || input.action === 'escalate') {
      return save(input.action === 'reject' ? '已正式否决并结束此轮' : '已移交人工处理并结束此轮', {stop: true});
    }
    if (input.action === 'conditional_approve') {
      return save('方案已附条件批准，等待核验', pipeline.wait('conditions', target,
        '请提供整改证据或明确的授权结论以解除附加条件', ['release_conditions', 'request_changes', 'reject']));
    }
    if (input.action === 'request_changes' || input.action === 'retry_review') {
      if (pipeline.revisionCount() >= pipeline.input.maxRevisions) {
        return save('已达返工上限', pipeline.wait('limit', target, '已达返工上限，请移交或否决', ['escalate', 'reject']));
      }
      const board = pipeline.artifact<Board, 'issue_board'>('issue_board');
      if (!input.issueIds.every(id => board.data.issues.some(issue => issue.id === id))) reject('返工意见引用了未知议题');
      const evaluation = gate.kind === 'evaluation' ? target.data as Report : null;
      const targetStep = gate.kind === 'confirmation' && input.scope === 'local' ? 'prd' :
        evaluation && input.issueIds.length === 0 ? evaluation.revisionTarget : 'discuss';
      const loop = gate.kind === 'confirmation' ? 'C' : input.action === 'retry_review' ? 'B' : 'approval';
      const reason = input.feedback;
      const defaultIssues = evaluation?.issueIds ?? [];
      const artifact = pipeline.rework(loop, targetStep, target, reason, [...new Set(input.issueIds.length ? input.issueIds : defaultIssues)], input.actor);
      return save('已记录返工意见', {repeatFrom: targetStep}, () => this.db.write(artifact));
    }
    if (input.action === 'resolve_issue') {
      const board = this.db.read<Board>(runId, gate.target);
      const issue = board.data.issues.find(row => row.pendingDecisionBy !== null);
      if (!issue?.discussion) reject('当前审批请求没有阻塞议题');
      const updated = pipeline.stage('issue_board', {...board.data, issues: board.data.issues.map(row => row.id === issue.id ?
        {...row, state: 'escalated', pendingDecisionBy: null, humanDecision: decision.id} : row)});
      const trigger = this.db.latest<Rework>(runId, 'rework', `A-${issue.id}`);
      return save('已记录人工裁决', {repeatFrom: 'discuss', countRework: false}, () => {
        this.db.write(updated);
        if (trigger) this.db.write(pipeline.stage('rework_result', {
          trigger: reference(trigger), after: reference(updated), outcome: 'human_resolution', decisionId: decision.id,
        }, trigger.id));
      });
    }
    return save({
      clarify: '已记录人的澄清答复', approve: '已批准当前方案版本',
      release_conditions: '版本绑定的附加条件已获人工确认', confirm: '当前 PRD 版本已获最终确认',
    }[input.action]);
  }

  async start(raw: unknown): Promise<RunView> {
    const input = parse(startSchema, raw);
    if (new Set(input.roles.map(role => role.id)).size !== input.roles.length) {
      throw new OrchestratorError('VALIDATION_ERROR', '角色 ID 必须唯一');
    }
    if (input.mode === 'live' && (!input.model || !input.providerId || !this.lookup(input.providerId)?.apiKey)) {
      throw new OrchestratorError('VALIDATION_ERROR', '请在模型池配置提供商密钥并指定模型');
    }
    if (input.mode === 'live' && !this.nativeCapability()) {
      throw new OrchestratorError('CAPABILITY_UNAVAILABLE', '请在模型池启用 Native API 适配器', 409);
    }
    this.db.assertAvailable(input);
    const id = `${workflowPrefix}${randomUUID().slice(0, 12)}`;
    const createdAt = new Date().toISOString();
    mkdirSync(this.documentRoot, {recursive: true});
    const workspace = this.store.listWorkspaces().find(ws => ws.description === 'hama-document-workspace') ??
      this.store.createWorkspace({
        name: 'HAMA-Loop', rootPath: this.documentRoot, verifyCommand: '', description: 'hama-document-workspace',
      });
    const graph = makeGraph(id, createdAt, input.model);
    const version: WorkflowVersionSnapshot = {
      id: `version-${id}`, workflowId: id, versionTag: 'v1', versionNumber: 1,
      label: 'HAMA-Loop', createdAt, frozenBy: 'HAMA-Loop', ...graph, trial: null,
      validation: {workflowId: id, valid: true, errorCount: 0, warningCount: 0, infoCount: 0, issues: [], checkedAt: createdAt},
      goalSpec: {id: `goal-${id}`, workflowId: id, title: input.title, goal: '形成经过确认的需求基线',
        rawMarkdown: '', inputs: [], outputs: [], constraints: [], domainRules: [], requirements: [],
        acceptanceCriteria: [], assumptions: [], updatedAt: createdAt},
    };
    this.store.savepoint(() => {
      this.store.createWorkflowRecord({id, workspaceId: workspace.id, title: input.title,
        description: 'HAMA-Loop', permissionTier: 'strict', verifyCommand: '', maxReworkIterations: input.maxRevisions});
      this.store.saveGoalSpec(version.goalSpec);
      // Draft graph IDs are global in SQLite. Snapshot IDs remain short and are remapped per run.
      const nodeId = (code: string) => `${id}-${code}`;
      this.store.replaceGraph(id, graph.nodes.map(node => ({...node, id: nodeId(node.id)})),
        graph.edges.map(edge => ({...edge, id: nodeId(edge.id), sourceNodeId: nodeId(edge.sourceNodeId),
          targetNodeId: nodeId(edge.targetNodeId)})));
      this.store.createVersionSnapshot(version);
      this.store.updateWorkflowMeta(id, {status: 'locked', currentVersionNumber: 1});
    });
    const detail = await this.engine.startRun({workflowId: id}, run => this.db.initialize(run.id, input));
    return this.view(detail.run.id);
  }

  list(): RunSummary[] {
    return this.db.runIds().map(id => {
      const {projectId, title, mode} = this.db.input(id);
      return {id, projectId, title, mode, status: this.store.getRun(id).status};
    });
  }

  view(runId: string): RunView {
    const input = this.db.input(runId);
    const detail = this.engine.getRunDetail(runId);
    const open = this.store.listInterventions(runId).find(item => item.status === 'open');
    const gate = open && ['waiting_human', 'paused'].includes(detail.run.status) ? this.db.gate(runId, open.id).gate : null;
    return {detail, input, gate, artifacts: this.db.list(runId),
      decisions: this.db.decisions(runId), baseline: this.db.baselineForRun(runId)};
  }

  decide(runId: string, gateId: string, body: unknown): RunView {
    this.db.input(runId);
    this.engine.resolveRegisteredIntervention(runId, gateId, body);
    return this.view(runId);
  }

  baselines(projectId: string) { return this.db.baselines(parse(identifier, projectId)); }

  baseline(id: string) { return this.db.baseline(parse(identifier, id)); }

  handoff(baselineId: string, workspaceId: string) {
    const baseline = this.baseline(baselineId);
    if (baseline.mode !== 'live') reject('演示基线只用于演练');
    if (this.store.getWorkspace(parse(identifier, workspaceId)).description === 'hama-document-workspace') {
      reject('请选择后续工程的工作区');
    }
    const {prd} = baseline;
    return this.planner.importStructuredRequirements(parse(identifier, workspaceId), {
      title: prd.title, goal: prd.sections.goals.join('；'), rawMarkdown: renderPrd(prd, baseline),
      requirementsBaseline: {id: baseline.id, projectId: baseline.projectId, revision: baseline.revision, sha256: baseline.sha256},
      inputs: [], outputs: [], constraints: prd.sections.constraints, domainRules: prd.sections.businessRules,
      assumptions: prd.sections.unresolved.map((text, i) => ({id: `assumption-${i + 1}`, text, source: 'suggested', rationale: '基线未决事项'})),
      requirements: prd.requirements.map(r => ({
        id: r.id, code: r.id, title: r.title, description: r.description, priority: r.priority === 'must' ? 'must' : 'should',
        verifyHint: r.acceptance.map(acceptanceText).join('；'),
      })),
      acceptanceCriteria: prd.requirements.flatMap(r => r.acceptance.map(a => ({
        id: a.id, code: a.id, label: acceptanceText(a), requirementId: r.id, verified: false,
      }))),
    });
  }
}
