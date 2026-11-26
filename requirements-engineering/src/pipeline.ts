import type {WorkflowStepContext, WorkflowStepResult} from '../../workflow-orchestrator/src/engines/workflow-handler.ts';
import type {AgentRequest, HamaAgents} from './agents.ts';
import {
  agendaSchema, critiqueSchema, dependencySchema, dimensions, evaluationSchema, intakeSchema,
  localConsensusSchema, proposalDraftSchema, proposalSchema, prdSchema,
  type Artifact, type ArtifactRef, type Decision, type DependencyMap, type Dimension,
  type Evaluation, type GateKind, type HumanGate, type Intake, type Issue, type LocalConsensus, type Prd,
  type Proposal, type StartInput,
} from './contracts.ts';
import {hash, reference, type HamaRepository} from './repository.ts';
import {SchemaError} from './schema.ts';

export interface Board {
  issues: Issue[];
  appliedReworkId: string;
}
export interface Report {
  proposal: ArtifactRef<'proposal'>;
  verdict: Evaluation['verdict'];
  evaluations: Record<Dimension, ArtifactRef<'evaluation'>>;
  issueIds: string[];
  revisionTarget: 'discuss' | 'integrate';
}
export interface Rework {
  loop: 'A' | 'B' | 'C' | 'approval';
  round: number;
  reason: string;
  actor: string;
  from: ArtifactRef;
  target: 'discuss' | 'integrate' | 'prd';
  issueIds: string[];
}
type IntakeArtifact = {source: ReturnType<typeof sourceMaterial>; intake: Intake; dependencies: ArtifactRef<'dependency_map'>};
type EvaluationArtifact = {proposal: ArtifactRef<'proposal'>; dimension: Dimension; review: Evaluation};
type Discussion = {
  round: number; issueId: string; proposals: ArtifactRef<'proposal_drafts'>; critiques: unknown; conclusion: LocalConsensus;
};

export function requireValid(ok: unknown, reason: string): asserts ok {
  if (!ok) throw new SchemaError(reason);
}

function unique(values: string[]): boolean {
  return new Set(values).size === values.length;
}

function sourceMaterial(input: StartInput) {
  return [
    ...input.ideas.map((text, i) => ({id: `idea-${i + 1}`, kind: 'user_fact', text})),
    ...input.documents.map((doc, i) => ({id: `doc-${i + 1}`, kind: 'document_fact', text: `${doc.title}\n${doc.content}`})),
    ...(['background', 'problem', 'goals', 'constraints', 'preferences'] as const)
      .filter(key => input[key]).map(key => ({id: key, kind: 'user_fact', text: input[key]})),
  ];
}

function validateRelations(map: DependencyMap, baseIds: string[]): void {
  for (const row of map.relations) requireValid(row.from !== row.to && baseIds.includes(row.from) &&
    baseIds.includes(row.to), `依赖关系必须连接两条不同的基础需求；收到 ${row.from} → ${row.to}；允许的基础需求 ID：${baseIds.join(', ')}`);
}

function noteDependencyCycles(map: DependencyMap): DependencyMap {
  const edges = new Map<string, string[]>();
  for (const item of map.relations) {
    if (item.relation !== 'depends_on' && item.relation !== 'prerequisite') continue;
    edges.set(item.from, [...(edges.get(item.from) ?? []), item.to]);
  }
  const checked = new Set<string>();
  const findings = new Set(map.findings);
  const visit = (id: string, path: string[]): void => {
    const cycle = path.indexOf(id);
    if (cycle >= 0) {
      findings.add(`依赖环：${[...path.slice(cycle), id].join(' → ')}`);
      return;
    }
    if (checked.has(id)) return;
    for (const next of edges.get(id) ?? []) visit(next, [...path, id]);
    checked.add(id);
  };
  for (const id of edges.keys()) visit(id, []);
  return {...map, findings: [...findings]};
}

function stableId(prefix: string, ...keys: string[]): string {
  return `${prefix}-${hash(keys).slice(0, 20)}`;
}

export class HamaPipeline {
  constructor(
    readonly context: WorkflowStepContext,
    readonly db: HamaRepository,
    private readonly agents: HamaAgents,
    private readonly signal: AbortSignal,
  ) {}

  get id(): string { return this.context.run.id; }
  get input(): StartInput { return this.db.input(this.id); }

  artifact<T, K extends string>(kind: K, subject = ''): Artifact<T, K> {
    const result = this.db.latest<T, K>(this.id, kind, subject);
    if (!result) throw new Error(`缺少上游工件 ${kind}`);
    return this.db.read<T, K>(this.id, reference(result));
  }

  stage<T, K extends string>(kind: K, data: T, subject = '') {
    return this.db.stage(this.context, kind, data, subject);
  }

  result(summary: string, artifacts: Artifact[] = [], next: Partial<WorkflowStepResult> = {}): WorkflowStepResult {
    return {...next, summary, commit: () => {
      this.db.write(...artifacts);
      next.commit?.();
    }};
  }

  wait(kind: GateKind, target: Artifact, question: string, options: HumanGate['options']): WorkflowStepResult {
    return {
      summary: question,
      wait: {
        question, options, contextSnippet: `${target.kind} · v${target.revision} · ${target.id}`,
        bind: id => this.db.bind(this.id, {
          id, kind, target: reference(target), question, options,
          attemptId: this.context.attemptId, createdAt: new Date().toISOString(),
        }),
      },
    };
  }

  call<T>(op: AgentRequest['operation'], role: string, data: unknown,
    output: {json: object; parse(value: unknown): T}, verify?: (value: T) => void, instruction?: string,
  ) {
    return this.agents.call(this.context, this.input, {operation: op, role, data, instruction}, output, this.signal, verify);
  }

  async intake(): Promise<WorkflowStepResult> {
    const source = sourceMaterial(this.input);
    const parent = this.input.parentBaselineId ? this.db.baseline(this.input.parentBaselineId) : null;
    const intake = await this.call('intake', 'Idea Decomposition', {source, parent}, intakeSchema, value => {
      requireValid(unique(value.requirements.map(r => r.id)) && unique(value.questions.map(q => q.id)), '基础需求和问题 ID 必须各自唯一');
      for (const evidence of value.evidence) {
        const entry = source.find(s => s.id === evidence.sourceId);
        requireValid(entry && (evidence.kind === entry.kind || ['agent_inference', 'assumption'].includes(evidence.kind)),
          '事实必须引用对应类型的原始来源');
      }
      requireValid(value.requirements.every(r => r.sources.every(id => source.some(s => s.id === id))), '基础需求必须引用原始来源');
    });
    const map = await this.call('dependencies', 'Dependency Analysis', {source, intake}, dependencySchema,
      value => validateRelations(value, intake.requirements.map(r => r.id)));
    const artifact = this.stage('dependency_map', noteDependencyCycles(map));
    return this.result('已生成 Idea Brief、基础需求、依赖图及澄清问题', [
      artifact, this.stage('intake', {source, intake, dependencies: reference(artifact)}),
    ]);
  }

  clarify(): WorkflowStepResult {
    const intake = this.artifact<IntakeArtifact, 'intake'>('intake');
    if (!intake.data.intake.questions.some(question => question.critical)) return this.result('关键事实已可用于讨论');
    return this.wait('clarification', intake, '请确认关键事实并回答澄清问题', ['clarify', 'reject']);
  }

  async discuss(): Promise<WorkflowStepResult> {
    const intake = this.artifact<IntakeArtifact, 'intake'>('intake');
    const history = this.db.latest<Board>(this.id, 'issue_board')?.data;
    const rework = this.db.latest<Rework>(this.id, 'rework');
    const targetedRework = rework?.data.target === 'discuss' && rework.data.loop !== 'A' &&
      rework.id !== history?.appliedReworkId ? rework : null;
    const dependency = this.artifact<DependencyMap, 'dependency_map'>('dependency_map');
    const clarifications = this.db.decisions(this.id).filter(d => ['clarify', 'resolve_issue'].includes(d.action));
    const roles = this.input.roles;
    const baseIds = intake.data.intake.requirements.map(row => row.id);
    const agenda = history ? null : await this.call('agenda', 'Moderator', {intake, dependency, roles, clarifications},
      agendaSchema, value => {
        requireValid(value.issues.length === baseIds.length && unique(value.issues.map(i => i.baseId)) &&
          value.issues.every(i => baseIds.includes(i.baseId) && roles.some(role => role.id === i.owner)),
          `每条基础需求应有唯一议题及已启用的责任角色；issues 必须恰好 ${baseIds.length} 项；baseId 必须逐一覆盖：${baseIds.join(', ')}；owner 只允许：${roles.map(role => role.id).join(', ')}`);
      });
    const board: Board = history ? {
      appliedReworkId: targetedRework?.id ?? history.appliedReworkId,
      issues: history.issues.map(issue => {
        const selected = targetedRework &&
          (targetedRework.data.issueIds.length === 0 || targetedRework.data.issueIds.includes(issue.id));
        return selected ? {...issue, state: 'open', cycleRound: 0, pendingDecisionBy: null} : issue;
      }),
    } : {
      appliedReworkId: '',
      issues: agenda!.issues.map(issue => ({...issue, id: `issue-${issue.baseId}`, state: 'open',
        round: 0, cycleRound: 0, pendingDecisionBy: null})),
    };
    const issue = board.issues.find(row => row.state === 'open' || row.state === 'discussing');
    if (!issue) return this.result('全部议题已有候选结论或人工裁决');
    const round = issue.round + 1;
    const cycleRound = issue.cycleRound + 1;
    const previous = this.db.latest<Discussion>(this.id, 'discussion', issue.id);
    const feedback = this.db.latest<Rework>(this.id, 'rework')?.data;
    const allowedSourceIds = intake.data.source.map(source => source.id);
    const shared = {issue, round, evidence: intake.data, dependency, previous, feedback, clarifications, allowedSourceIds,
      base: intake.data.intake.requirements.find(row => row.id === issue.baseId)};
    const proposals = await Promise.allSettled(roles.map(async role => ({
      roleId: role.id, ...await this.call('propose', role.id, shared, proposalDraftSchema,
        value => requireValid(value.sources.every(id => allowedSourceIds.includes(id)),
          `提案须引用已存在的来源；无效 ID：${value.sources.filter(id => !allowedSourceIds.includes(id)).join(', ')}；sources 只允许：${allowedSourceIds.join(', ')}`), role.instructions),
    })));
    const drafts = unwrap(proposals);
    const critiques = unwrap(await Promise.allSettled(roles.map(async role => {
      const peers = drafts.filter(draft => draft.roleId !== role.id);
      return {roleId: role.id, ...await this.call('critique', role.id, {...shared, own: drafts.find(d => d.roleId === role.id), peers},
        critiqueSchema, value => requireValid(value.objections.every(row => peers.some(peer => peer.roleId === row.roleId)),
          `质疑目标必须是其他角色的本轮提案；当前作者为 ${role.id}，objections[].roleId 只允许：${peers.map(peer => peer.roleId).join(', ')}`), role.instructions)};
    })));
    const conclusion = await this.call('refine', 'Moderator', {...shared, drafts, critiques}, localConsensusSchema, value => {
      requireValid(value.state !== 'resolved' || (value.candidate && value.blockers.length === 0), '达成共识必须具备方案且无阻塞');
      requireValid(value.state !== 'blocked' || value.blockers.length > 0, '阻塞议题必须明确阻塞项');
      validateRelations({relations: value.relations, findings: []}, baseIds);
    });

    const draft = this.stage('proposal_drafts', {issueId: issue.id, round, drafts, updated: conclusion.candidate}, issue.id);
    const discussion = this.stage('discussion', {round, issueId: issue.id, proposals: reference(draft), critiques, conclusion}, issue.id);
    const nextIssue: Issue = {...issue, round, cycleRound, state: conclusion.state, blockers: conclusion.blockers,
      discussion: reference(discussion), pendingDecisionBy: null};
    const artifacts: Artifact[] = [draft, discussion];
    const priorRound = this.db.latest<Rework>(this.id, 'rework', `A-${issue.id}`);
    if (priorRound && previous?.id === priorRound.data.from.id) {
      artifacts.push(this.stage('rework_result', {trigger: reference(priorRound), after: reference(discussion),
        outcome: conclusion.state}, priorRound.id));
    }
    const relationKey = (r: DependencyMap['relations'][number]) => `${r.from}:${r.to}:${r.relation}`;
    const relations = [...new Map([...dependency.data.relations, ...conclusion.relations].map(r => [relationKey(r), r])).values()];
    if (conclusion.relations.length) {
      artifacts.push(this.stage('dependency_map', noteDependencyCycles({...dependency.data, relations})));
    }

    const needsHuman = conclusion.state === 'blocked' || (conclusion.state !== 'resolved' && cycleRound >= this.input.maxDiscussionRounds);
    if (needsHuman) {
      nextIssue.state = 'blocked';
      nextIssue.pendingDecisionBy = '人类项目负责人';
    }
    const nextBoard = this.stage('issue_board', {...board, issues: board.issues.map(row => row.id === issue.id ? nextIssue : row)});
    artifacts.push(nextBoard);
    if (needsHuman) {
      artifacts.push(this.stage('rework', {loop: 'A', round, reason: conclusion.rationale, actor: 'Moderator',
        from: reference(discussion), target: 'discuss', issueIds: [issue.id]} satisfies Rework, `A-${issue.id}`));
      return this.result('议题需要人工裁决', artifacts,
        this.wait('discussion', nextBoard, `请裁决议题「${issue.title}」并记录原因`, ['resolve_issue', 'reject']));
    }
    if (conclusion.state !== 'resolved') {
      artifacts.push(this.stage('rework', {loop: 'A', round, reason: conclusion.rationale, actor: 'Moderator',
        from: reference(discussion), target: 'discuss', issueIds: [issue.id]} satisfies Rework, `A-${issue.id}`));
      return this.result('继续讨论当前议题', artifacts, {repeatFrom: 'discuss'});
    }
    const remaining = nextBoard.data.issues.some(row => row.state === 'open' || row.state === 'discussing');
    return this.result(remaining ? '开始讨论下一议题' : '议题已具备整合条件', artifacts,
      remaining ? {repeatFrom: 'discuss', countRework: false} : {});
  }

  async integrate(): Promise<WorkflowStepResult> {
    const board = this.artifact<Board, 'issue_board'>('issue_board');
    const humanFeedback = this.db.decisions(this.id);
    const discussions = board.data.issues.map(issue => {
      if (!issue.discussion || !['resolved', 'escalated'].includes(issue.state)) throw new Error('存在未处理的议题');
      const discussion = this.db.read<Discussion>(this.id, issue.discussion);
      const humanDecision = issue.state === 'escalated' ?
        humanFeedback.findLast(decision => decision.id === issue.humanDecision && decision.action === 'resolve_issue') : undefined;
      // Historical model blockers remain immutable evidence, not the current human-resolved conclusion.
      return humanDecision ? {
        issue: {...issue, blockers: []}, discussion: reference(discussion), humanDecision,
        previousCandidate: discussion.data.conclusion.candidate,
        conclusion: {...discussion.data.conclusion, state: 'resolved', candidate: humanDecision.feedback,
          rationale: '以绑定此议题的人工裁决为准；原候选仅用于理解裁决所引用的内容。', blockers: []},
      } : {issue, discussion, drafts: this.db.read(this.id, discussion.data.proposals)};
    });
    const prior = this.db.latest<Proposal>(this.id, 'proposal');
    const parent = this.input.parentBaselineId ? this.db.baseline(this.input.parentBaselineId) : null;
    const data = await this.call('integrate', 'Consensus Agent', {
      board, discussions, intake: this.artifact('intake'), dependency: this.artifact('dependency_map'),
      prior, parent, humanFeedback, feedback: this.db.latest(this.id, 'rework'),
    }, proposalSchema, value => {
      requireValid(unique(value.scope.map(item => item.key)), '候选范围 key 必须唯一');
      const ids = board.data.issues.map(issue => issue.id);
      requireValid(value.scope.every(item => item.issueIds.every(id => ids.includes(id))), '候选范围必须关联真实议题');
      requireValid(this.input.constraints.length === 0 || value.constraints.length > 0, '候选方案必须记录明确的约束');
    });
    return this.result('已冻结候选方案版本', [this.stage('proposal', data)]);
  }

  async evaluate(dimension: Dimension): Promise<WorkflowStepResult> {
    const proposal = this.artifact<Proposal, 'proposal'>('proposal');
    const intake = this.artifact<IntakeArtifact, 'intake'>('intake');
    const issueIds = this.artifact<Board, 'issue_board'>('issue_board').data.issues.map(issue => issue.id);
    const facts = this.db.decisions(this.id).filter(d => ['clarify', 'resolve_issue'].includes(d.action));
    const evidence = new Set([proposal.id, ...intake.data.source.map(source => source.id), ...issueIds, ...facts.map(d => d.id)]);
    const review = await this.call('evaluate', dimensions[dimension].name,
      {proposal, source: intake.data.source, issueIds, facts}, evaluationSchema, value => {
        for (const finding of value.findings) {
          requireValid(finding.evidence.every(id => evidence.has(id)) && finding.issueIds.every(id => issueIds.includes(id)),
            '评价发现必须引用真实源证据或议题');
          requireValid(finding.severity !== 'condition' || (finding.owner && finding.verification), '附条件项须有责任人及核验方法');
        }
        requireValid(value.verdict !== 'revision_required' || value.findings.some(f => f.severity === 'blocking' || f.severity === 'veto'),
          'revision_required 必须有 blocking 或 veto 发现；仅有 condition/informational 时不能要求业务返工，请按证据纠正 verdict 或 severity');
        requireValid(value.verdict === 'pass' || value.findings.length > 0, '非通过评价必须提供发现和证据');
        requireValid(value.verdict !== 'conditional_pass' || value.findings.some(f => f.severity === 'condition'),
          '有条件通过必须列出可核验的整改事项');
      }, dimensions[dimension].instructions);
    return this.result('已提交独立评价', [this.stage('evaluation', {proposal: reference(proposal), dimension, review}, dimension)]);
  }

  evaluation(): WorkflowStepResult {
    const proposal = this.artifact<Proposal, 'proposal'>('proposal');
    const items = (Object.keys(dimensions) as Dimension[]).map(dimension => {
      const item = this.artifact<EvaluationArtifact, 'evaluation'>('evaluation', dimension);
      if (item.data.proposal.id !== proposal.id) throw new Error('独立报告与候选方案版本不匹配');
      return [dimension, item] as const;
    });
    const reviews = items.map(([, item]) => item.data.review);
    const findings = reviews.flatMap(review => review.findings);
    const obstacles = findings.filter(finding => ['blocking', 'veto'].includes(finding.severity));
    const revisionTarget = obstacles.length > 0 &&
      obstacles.every(finding => finding.issueIds.length === 0) ?
      'integrate' : 'discuss';
    const verdict: Report['verdict'] =
      findings.some(f => f.severity === 'veto') || reviews.some(r => r.verdict === 'escalation') ? 'escalation' :
      findings.some(f => f.severity === 'blocking') || reviews.some(r => r.verdict === 'revision_required') ? 'revision_required' :
      findings.some(f => f.severity === 'condition' || f.severity === 'uncertain') ||
        reviews.some(r => r.verdict === 'conditional_pass') ? 'conditional_pass' : 'pass';
    const report = this.stage('report', {
      proposal: reference(proposal), verdict, revisionTarget,
      evaluations: Object.fromEntries(items.map(([key, item]) => [key, reference(item)])) as Report['evaluations'],
      issueIds: [...new Set(findings.filter(f => ['blocking', 'veto', 'uncertain'].includes(f.severity)).flatMap(f => f.issueIds))],
    } satisfies Report);
    const artifacts: Artifact[] = [report, ...this.reworkResults(report, 'evaluation', verdict)];
    if (verdict === 'pass' || verdict === 'conditional_pass') {
      return this.result(verdict, artifacts, {selectedBranch: 'review'});
    }
    if (verdict === 'escalation' || this.revisionCount() >= this.input.maxRevisions) {
      const canRetry = this.revisionCount() < this.input.maxRevisions;
      return this.result(verdict, artifacts, this.wait(canRetry ? 'evaluation' : 'limit', report,
        canRetry ? '独立评价存在重大风险，请决定是否退回整改' : '已达方案返工上限，请处理升级',
        canRetry ? ['retry_review', 'reject'] : ['escalate', 'reject']));
    }
    const rework = this.rework('B', revisionTarget, report, findings.filter(f => f.severity === 'blocking')
      .map(f => f.recommendation).join('；') || '独立评价要求返工', report.data.issueIds, '独立评价');
    return this.result(verdict, [...artifacts, rework], {repeatFrom: revisionTarget});
  }

  approval(): WorkflowStepResult {
    const proposal = this.artifact<Proposal, 'proposal'>('proposal');
    const report = this.artifact<Report, 'report'>('report');
    if (report.data.proposal.id !== proposal.id || !['pass', 'conditional_pass'].includes(report.data.verdict)) {
      throw new Error('当前候选版本尚未通过独立评价');
    }
    return this.wait('approval', proposal, '请评审并决定是否批准当前建设方案',
      report.data.verdict === 'conditional_pass' ? ['conditional_approve', 'request_changes', 'reject'] :
        ['approve', 'conditional_approve', 'request_changes', 'reject']);
  }

  private approved(proposal: Artifact<Proposal, 'proposal'>): Decision {
    const decision = this.db.decisions(this.id).findLast(d => d.targetId === proposal.id && d.targetHash === proposal.hash &&
      ['approve', 'release_conditions'].includes(d.action));
    if (!decision) throw new Error('当前候选方案未经人类批准或附加条件仍未解除');
    return decision;
  }

  async prd(): Promise<WorkflowStepResult> {
    const proposal = this.artifact<Proposal, 'proposal'>('proposal');
    const approval = this.approved(proposal);
    const prior = this.db.latest<Prd>(this.id, 'prd');
    const parent = this.input.parentBaselineId ? this.db.baseline(this.input.parentBaselineId) : null;
    const scope = new Map(proposal.data.scope.map(row => [row.key, row]));
    const draft = await this.call('prd', 'Requirements Agent', {
      proposal, approval, conditions: this.db.decisions(this.id).filter(row => row.targetId === proposal.id &&
        row.action === 'conditional_approve'), prior, parent, feedback: this.db.latest(this.id, 'rework'),
    }, prdSchema, value => {
      const keys = value.requirements.map(r => r.scopeKey);
      requireValid(keys.length === scope.size && unique(keys) && keys.every(key => scope.has(key)), '需求必须与获批范围逐项对应');
      for (const r of value.requirements) {
        requireValid(r.dependencies.every(key => scope.has(key) && key !== r.scopeKey), '依赖必须指向另一条获批条目');
        requireValid(unique(r.acceptance.map(a => a.key)), '同一需求的验收 key 必须唯一');
        requireValid(r.acceptance.every(a => a.given !== a.then && a.when !== a.then), '验收结果必须说明独立可观察的结果');
      }
    });
    const ids = new Map([...scope.values()].map(row => [row.key,
      stableId(row.kind === 'functional' ? 'FR' : 'NFR', this.input.projectId, row.key)]));
    const issues = this.artifact<Board, 'issue_board'>('issue_board').data.issues;
    const base = this.artifact<IntakeArtifact, 'intake'>('intake').data.intake.requirements;
    const requirements = draft.requirements.map(row => {
      const approved = scope.get(row.scopeKey)!;
      const id = ids.get(row.scopeKey)!;
      return {
        id, scopeKey: row.scopeKey, kind: approved.kind, title: approved.title, description: row.description,
        value: row.value, priority: row.priority, dependencies: row.dependencies.map(key => ids.get(key)!),
        constraints: row.constraints, state: 'under_review' as const,
        acceptance: row.acceptance.map(a => ({id: stableId('AC', id, a.key), given: a.given, when: a.when, then: a.then})),
      };
    });
    const prd: Prd = {
      title: this.input.title, revision: (prior?.revision ?? 0) + 1,
      proposal: reference(proposal), approvalId: approval.id, sections: proposal.data,
      background: draft.background, scenarios: draft.scenarios, requirements,
      changes: [
        ...(prior ? [`修订自 PRD v${prior.revision}`] : parent ? [`变更自需求基线 v${parent.revision}`] : ['初版草案']),
        ...this.db.decisions(this.id).filter(d => d.action === 'request_changes').map(d => d.feedback),
      ],
      trace: requirements.map(r => {
        const issueIds = scope.get(r.scopeKey)!.issueIds;
        const linked = issues.filter(i => issueIds.includes(i.id)).map(i => i.baseId);
        return {
          issueIds, ideaAndDocumentIds: [...new Set(base.filter(row => linked.includes(row.id)).flatMap(row => row.sources))],
          proposal: reference(proposal), scopeKey: r.scopeKey, approvalId: approval.id, requirementId: r.id,
          acceptanceIds: r.acceptance.map(a => a.id),
        };
      }),
    };
    const artifact = this.stage('prd', prd);
    return this.result('PRD 草案等待最终需求确认', [artifact, ...this.reworkResults(artifact, 'prd', 'under_review')]);
  }

  confirm(): WorkflowStepResult {
    return this.wait('confirmation', this.artifact('prd'), '请确认 PRD 的需求范围、优先级及验收标准',
      ['confirm', 'request_changes', 'reject', 'escalate']);
  }

  publish(): WorkflowStepResult {
    const prd = this.artifact<Prd, 'prd'>('prd');
    const approval = this.approved(this.db.read<Proposal, 'proposal'>(this.id, prd.data.proposal));
    const confirmation = this.db.decisions(this.id).find(d => d.targetId === prd.id &&
      d.targetHash === prd.hash && d.action === 'confirm');
    if (!confirmation || approval.id !== prd.data.approvalId) throw new Error('缺少绑定当前版本的确认或审批');
    const existing = this.db.baselineForRun(this.id);
    if (existing) return this.result(`需求基线 v${existing.revision} 已发布`);
    const parent = this.db.assertParent(this.input);
    const conditionalApproval = this.db.decisions(this.id).find(d =>
      d.action === 'conditional_approve' && d.targetId === approval.targetId);
    const value = {
      schemaVersion: 1 as const, id: `baseline-${this.id}`, projectId: this.input.projectId,
      revision: (parent?.revision ?? 0) + 1, parentId: parent?.id ?? null, mode: this.input.mode,
      approvedPrd: reference(prd), approval, confirmation, ...(conditionalApproval && {conditionalApproval}),
      prd: {...prd.data, requirements: prd.data.requirements.map(req => ({...req, state: 'baselined' as const}))},
    };
    const baseline = {...value, sha256: hash(value)};
    return this.result(`需求基线 v${baseline.revision} 已发布`, [], {commit: () => this.db.publish(this.id, baseline)});
  }

  revisionCount(): number {
    return this.db.list(this.id).filter(a => a.kind === 'rework' && (a.data as Rework).loop !== 'A').length;
  }

  rework(loop: Rework['loop'], target: Rework['target'], from: Artifact, reason: string, issueIds: string[], actor: string) {
    return this.stage('rework', {loop, target, from: reference(from), round: this.revisionCount() + 1, reason, issueIds, actor} satisfies Rework);
  }

  private reworkResults(after: Artifact, phase: 'evaluation' | 'prd', outcome: string): Artifact[] {
    const artifacts = this.db.list(this.id);
    const trigger = this.db.latest<Rework>(this.id, 'rework');
    if (!trigger) return [];
    const subject = `${trigger.id}-${phase}`;
    const {loop, target} = trigger.data;
    if (artifacts.some(a => a.kind === 'rework_result' && a.subject === subject) ||
        (phase === 'evaluation' ? target === 'prd' : target !== 'prd' && loop !== 'C')) return [];
    return [this.stage('rework_result', {
      trigger: reference(trigger), after: reference(after), phase, outcome,
    }, subject)];
  }
}

function unwrap<T>(results: PromiseSettledResult<T>[]): T[] {
  const failure = results.find(result => result.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
  return results.map(result => (result as PromiseFulfilledResult<T>).value);
}
