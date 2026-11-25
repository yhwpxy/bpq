import type {GraphEdge, GraphNode, WorkflowNodeKind} from '../../workflow-orchestrator/src/shared/types.ts';
import {dimensions} from './contracts.ts';

export const workflowPrefix = 'wf-hama-';
const spec = [
  ['start', '提交 Idea', 'start', 0, 1],
  ['intake', '需求分解与依赖分析', 'task', 1, 1],
  ['clarify', '关键事实澄清', 'human_gate', 2, 1],
  ['discuss', '协同讨论 · G1', 'task', 3, 1],
  ['integrate', '全局整合', 'task', 4, 1],
  ...Object.entries(dimensions).map(([id, dim], i) => [`eval-${id}`, dim.name, 'task', 5, i] as const),
  ['join', '汇总独立报告', 'join', 6, 1],
  ['evaluation', '评价判定 · G2', 'decision', 7, 1],
  ['approval', '人工方案审批', 'human_gate', 8, 1],
  ['prd', '生成 PRD 草案', 'task', 9, 1],
  ['confirm', '最终需求确认 · G3', 'human_gate', 10, 1],
  ['publish', '发布不可变基线', 'task', 11, 1],
  ['done', '完成', 'done', 12, 1],
] as const;
const evaluators = Object.keys(dimensions).map(d => `eval-${d}`);

export function makeGraph(workflowId: string, updatedAt: string, model: string): {nodes: GraphNode[]; edges: GraphEdge[]} {
  const nodes: GraphNode[] = spec.map(([code, title, kind, x, y]) => ({
    id: code, code, title, kind: kind as WorkflowNodeKind, scopeId: workflowId,
    parentWbsId: null, containerNodeId: null, phaseId: null, phaseTitle: '', depth: 0,
    executorKind: kind === 'task' ? 'agent' : kind === 'human_gate' ? 'human' : 'control',
    capabilityId: kind === 'task' ? 'native-api' : kind === 'human_gate' ? 'human-gate' : 'control-plane',
    assignedRole: code.startsWith('eval-') ? 'evaluator' : 'specialist',
    assignedModel: kind === 'task' ? model || null : null, description: title,
    planningRationale: '', requirementRefs: [], inputContract: '读取完整版本化 HAMA-Loop 工件',
    outputContract: '经过校验的 HAMA-Loop 工件和流程状态', fileScope: [], gateCommand: null,
    branchCondition: null, status: 'pending', attemptCount: 0, maxAttempts: 1,
    collapsed: false, positionX: x * 245, positionY: y * 110, width: 220, height: 90,
    outputSummary: '', restoreTargetCheckpointId: null, updatedAt,
  }));
  const links: [string, string, string?][] = [
    ['start', 'intake'], ['intake', 'clarify'], ['clarify', 'discuss'], ['discuss', 'integrate'],
    ...evaluators.map((id): [string, string] => ['integrate', id]),
    ...evaluators.map((id): [string, string] => [id, 'join']),
    ['join', 'evaluation'], ['evaluation', 'approval', 'review'], ['approval', 'prd'],
    ['prd', 'confirm'], ['confirm', 'publish'], ['publish', 'done'],
  ];
  const edges: GraphEdge[] = links.map(([from, to, condition]) => ({
    id: `${from}:${to}`, scopeId: workflowId, sourceNodeId: from, targetNodeId: to,
    kind: 'dep', label: condition ? '进入人工审批' : '', conditionExpr: condition ?? null,
  }));
  return {nodes, edges};
}
