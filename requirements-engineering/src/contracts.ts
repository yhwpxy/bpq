import type {RunDetailSnapshot} from '../../workflow-orchestrator/src/shared/api.ts';
import {array, boolean, choice, identifier, integer, object, string, type Validated} from './schema.ts';

const line = string(600);
const lines = array(line);
const sources = array(identifier, 1);
const evidence = object({
  sourceId: identifier,
  kind: choice('user_fact', 'document_fact', 'agent_inference', 'assumption'),
  claim: line,
});

export const rolesDefault = [
  {id: 'product', name: '产品与业务', instructions: '核对用户价值、业务规则、范围和优先级。'},
  {id: 'architecture', name: '架构与技术', instructions: '核对架构边界、集成和非功能约束。'},
  {id: 'development', name: '开发', instructions: '评估复杂度、实现依赖和可维护性。'},
  {id: 'design', name: '体验设计', instructions: '核对工作流、移动体验和异常反馈。'},
  {id: 'quality', name: '测试与质量', instructions: '检查边界、异常及验收可验证性。'},
];

export const dimensions = {
  value: {name: '用户价值', instructions: '审查场景覆盖、收益证据、用户成本和真实问题。'},
  feasibility: {name: '技术可行性', instructions: '审查技术依赖、架构、性能、安全和关键实现前提。'},
  completeness: {name: '产品完整性', instructions: '审查覆盖度、业务规则、异常路径和范围的一致性。'},
  risk: {name: '成本与风险', instructions: '审查周期、资源、第三方、运维、合规与交付风险。'},
} as const;
export type Dimension = keyof typeof dimensions;

export const intakeSchema = object({
  brief: string(),
  evidence: array(evidence, 1),
  requirements: array(object({
    id: identifier, problem: line, affectedUsers: line, goal: line, sources,
  }), 1, 12),
  questions: array(object({
    id: identifier, question: line, critical: boolean, reason: line,
  }), 0, 12),
});
export const dependencyItem = object({
  from: identifier, to: identifier,
  relation: choice('depends_on', 'conflict', 'duplicate', 'prerequisite'), rationale: line,
});
export const dependencySchema = object({relations: array(dependencyItem, 0, 36), findings: lines});
export const agendaSchema = object({
  issues: array(object({baseId: identifier, title: line, owner: identifier, blockers: lines}), 1, 12),
});
export const proposalDraftSchema = object({
  proposal: string(), rationale: string(), assumptions: lines, sources,
});
export const critiqueSchema = object({
  objections: array(object({roleId: identifier, issue: line, reason: line, suggestion: line})),
});
export const localConsensusSchema = object({
  state: choice('resolved', 'discussing', 'blocked'),
  candidate: string(3000, 0),
  rationale: string(),
  rejected: array(object({opinion: line, reason: line})),
  blockers: lines,
  relations: array(dependencyItem),
});
export const proposalSchema = object({
  goals: array(line, 1), summary: string(), approach: array(line, 1),
  scope: array(object({
    key: identifier, kind: choice('functional', 'nonfunctional'), title: line, decision: string(),
    issueIds: sources,
  }), 1, 36),
  outOfScope: lines, constraints: lines, tradeoffs: lines, risks: lines, unresolved: lines,
  businessRules: lines, externalDependencies: lines,
});
export const evaluationSchema = object({
  verdict: choice('pass', 'conditional_pass', 'revision_required', 'escalation'),
  summary: string(),
  findings: array(object({
    severity: choice('informational', 'condition', 'blocking', 'veto', 'uncertain'),
    category: choice('value', 'technical', 'coverage', 'budget', 'security', 'compliance', 'other'),
    problem: line, reason: line, evidence: sources,
    issueIds: array(identifier), recommendation: line, owner: string(120, 0), verification: string(600, 0),
  })),
});
export const prdSchema = object({
  background: string(), scenarios: array(line, 1),
  requirements: array(object({
    scopeKey: identifier, description: string(), value: line, priority: choice('must', 'should', 'could'),
    dependencies: array(identifier), constraints: lines,
    acceptance: array(object({key: identifier, given: line, when: line, then: line}), 1, 12),
  }), 1, 36),
});

const roleSchema = object({id: identifier, name: string(80), instructions: string(750)});
export const startSchema = object({
  projectId: identifier, title: string(160), ideas: array(string(3000), 1, 8),
  background: string(3000, 0), problem: string(3000, 0), goals: string(3000, 0),
  constraints: string(3000, 0), preferences: string(3000, 0),
  documents: array(object({title: string(160), content: string(10000)}), 0, 6),
  mode: choice('live', 'demo'), providerId: string(80, 0), model: string(120, 0),
  roles: array(roleSchema, 2, 10), maxDiscussionRounds: integer(1, 5), maxRevisions: integer(0, 5),
  parentBaselineId: string(80, 0),
});
export type StartInput = Validated<typeof startSchema>;
export type Intake = Validated<typeof intakeSchema>;
export type DependencyMap = Validated<typeof dependencySchema>;
export type Proposal = Validated<typeof proposalSchema>;
export type Evaluation = Validated<typeof evaluationSchema>;
export type Draft = Validated<typeof prdSchema>;
export type LocalConsensus = Validated<typeof localConsensusSchema>;
type AgendaIssue = Validated<typeof agendaSchema>['issues'][number];
export interface Issue extends AgendaIssue {
  id: string;
  state: 'open' | 'discussing' | 'resolved' | 'blocked' | 'escalated';
  round: number;
  cycleRound: number;
  pendingDecisionBy: string | null;
  discussion?: ArtifactRef<'discussion'>;
}

export interface ArtifactRef<K extends string = string> {
  id: string;
  kind: K;
  revision: number;
  hash: string;
}
export interface Artifact<T = unknown, K extends string = string> extends ArtifactRef<K> {
  runId: string;
  workflowId: string;
  attemptId: string;
  subject: string;
  createdAt: string;
  data: T;
}

export const decisionSchema = object({
  targetId: identifier, targetHash: string(64, 64, /^[a-f0-9]{64}$/),
  actor: string(120), action: choice('clarify', 'resolve_issue', 'approve', 'conditional_approve',
    'release_conditions', 'request_changes', 'confirm', 'reject', 'escalate', 'retry_review'),
  feedback: string(6000, 0), scope: choice('local', 'proposal'),
  issueIds: array(identifier),
});
export type DecisionInput = Validated<typeof decisionSchema>;
export type GateKind = 'clarification' | 'discussion' | 'evaluation' | 'approval' | 'conditions' | 'confirmation' | 'limit';
export interface HumanGate {
  id: string;
  kind: GateKind;
  attemptId: string;
  target: ArtifactRef;
  options: DecisionInput['action'][];
  question: string;
  createdAt: string;
}
export interface Decision extends DecisionInput {
  id: string;
  gateKind: GateKind;
  targetRevision: number;
  decidedAt: string;
}
export interface Requirement {
  id: string;
  scopeKey: string;
  kind: 'functional' | 'nonfunctional';
  title: string;
  description: string;
  value: string;
  priority: 'must' | 'should' | 'could';
  dependencies: string[];
  constraints: string[];
  acceptance: Array<{id: string; given: string; when: string; then: string}>;
  state: 'under_review' | 'baselined';
}
export interface Trace {
  ideaAndDocumentIds: string[];
  issueIds: string[];
  proposal: ArtifactRef<'proposal'>;
  scopeKey: string;
  approvalId: string;
  requirementId: string;
  acceptanceIds: string[];
}
export interface Prd {
  title: string;
  revision: number;
  proposal: ArtifactRef<'proposal'>;
  approvalId: string;
  sections: Proposal;
  background: string;
  scenarios: string[];
  requirements: Requirement[];
  trace: Trace[];
  changes: string[];
}
export interface ApprovedRequirementsBaseline {
  schemaVersion: 1;
  id: string;
  projectId: string;
  revision: number;
  parentId: string | null;
  mode: StartInput['mode'];
  approvedPrd: ArtifactRef<'prd'>;
  prd: Prd;
  approval: Decision;
  conditionalApproval?: Decision;
  confirmation: Decision;
  sha256: string;
}
export interface RunSummary {
  id: string;
  projectId: string;
  title: string;
  mode: StartInput['mode'];
  status: RunDetailSnapshot['run']['status'];
}
export interface RunView {
  detail: RunDetailSnapshot;
  input: StartInput;
  artifacts: Artifact[];
  gate: HumanGate | null;
  decisions: Decision[];
  baseline: ApprovedRequirementsBaseline | null;
}

export const campusDemo = {
  title: '校园服务平台活动报名',
  ideas: ['为校园服务平台增加活动报名功能，要求移动端易用、支持人数限制，且开发周期有限。'],
  background: '校园服务平台已有活动信息。', problem: '学生需要在手机上完成活动报名。',
  goals: '允许学生快速报名，并避免超出活动容量。',
  constraints: '复用现有登录。首版迭代周期有限。', preferences: '移动端操作简单。',
};
