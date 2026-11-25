import type {
  GoalSpec,
  GraphNode,
  RehydrationCapsule,
  RehydrationTier,
  WorkflowRecord,
  WorkflowRunRecord,
} from '../shared/types.ts';

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function computeMutationEntropy(args: {
  changedSlicesCount: number;
  failedNodesCount: number;
  totalNodesCount: number;
}): number {
  const denom = Math.max(1, args.totalNodesCount);
  const score =
    (args.changedSlicesCount * 0.45 + args.failedNodesCount * 0.95) / denom;
  return Number(clamp01(score).toFixed(3));
}

export function computeHumanStabilityHours(spacedReviewCount: number): number {
  const safeCount = Math.max(0, Math.min(spacedReviewCount, 10));
  return Number((12 * Math.pow(1.65, safeCount)).toFixed(2));
}

export function computeRetentionScore(
  elapsedHours: number,
  stabilityHours: number,
  mutationEntropy: number,
): number {
  const effectiveElapsed =
    Math.max(0, elapsedHours) * (1 + clamp01(mutationEntropy) * 0.9);
  const raw = Math.exp(-effectiveElapsed / Math.max(1, stabilityHours));
  return Number(clamp01(raw).toFixed(3));
}

export function classifyRehydrationTier(
  retentionScore: number,
): RehydrationTier {
  if (retentionScore >= 0.72) {
    return 'warm';
  }
  if (retentionScore >= 0.42) {
    return 'delta_30s';
  }
  return 'deep_reanchor';
}

export function reinforceSkillStability(
  currentStabilityHours: number,
  timesUsed: number,
): number {
  const base = Math.max(8, currentStabilityHours);
  const next = base * 1.32 + Math.min(12, Math.max(0, timesUsed)) * 1.5;
  return Number(Math.min(720, next).toFixed(1));
}

export function buildRehydrationCapsule(args: {
  workflow: WorkflowRecord;
  goalSpec?: GoalSpec | null;
  nodes: readonly GraphNode[];
  latestRun: WorkflowRunRecord | null;
  nowIso?: string;
}): RehydrationCapsule {
  const nowMs = Date.parse(args.nowIso ?? new Date().toISOString());
  const anchorIso =
    args.workflow.lastHumanReviewedAt ?? args.workflow.updatedAt;
  const anchorMs = Date.parse(anchorIso);
  const elapsedHours = Number(
    Math.max(0, (nowMs - anchorMs) / 3_600_000).toFixed(2),
  );

  const execNodes = args.nodes.filter(n => n.kind !== 'phase_container');
  const completedCount = execNodes.filter(n => n.status === 'succeeded').length;
  const failedCount = execNodes.filter(n => n.status === 'failed').length;
  const waitingGate = execNodes.find(
    n => n.kind === 'human_gate' && n.status !== 'succeeded',
  );

  const mutationEntropy = computeMutationEntropy({
    changedSlicesCount: completedCount,
    failedNodesCount: failedCount,
    totalNodesCount: execNodes.length,
  });
  const stabilityHours = computeHumanStabilityHours(
    args.workflow.spacedReviewCount ?? 0,
  );
  const retentionScore = computeRetentionScore(
    elapsedHours,
    stabilityHours,
    mutationEntropy,
  );
  const tier = classifyRehydrationTier(retentionScore);

  const deltaBullets: string[] = [];
  if (args.latestRun) {
    deltaBullets.push(
      `Latest Run ${args.latestRun.id.slice(0, 8)} status: ${args.latestRun.status} (rework iterations: ${args.latestRun.reworkCount}/${args.workflow.maxReworkIterations}, spent: $${(args.latestRun.spentUsd ?? 0).toFixed(4)}).`,
    );
  }
  deltaBullets.push(
    `Graph progress: ${completedCount}/${execNodes.length} executable nodes completed, ${failedCount} failed.`,
  );
  const recentOutputs = execNodes
    .filter(n => n.outputSummary.trim().length > 0)
    .slice(-3);
  for (const node of recentOutputs) {
    deltaBullets.push(
      `${node.code} (${node.title}): ${node.outputSummary.slice(0, 120)}`,
    );
  }

  const lockedDecisions = args.goalSpec
    ? [
        ...args.goalSpec.constraints.slice(0, 3),
        ...args.goalSpec.assumptions.slice(0, 2).map(a => a.text),
      ]
    : [];

  const nextDecisionPrompt = waitingGate
    ? `Approve human gate ${waitingGate.code} ("${waitingGate.title}") to unlock downstream execution.`
    : tier === 'deep_reanchor'
      ? 'Retention dipped below 42% after autonomous mutations — review GoalSpec assumptions and click Mark Reviewed to re-anchor.'
      : null;

  return {
    workflowId: args.workflow.id,
    workflowTitle: args.workflow.title,
    workflowCode: args.workflow.code,
    retentionScore,
    stabilityHours,
    elapsedHours,
    mutationEntropy,
    tier,
    northStarGoal: args.goalSpec?.goal || args.workflow.description,
    lastHumanAnchor: anchorIso,
    autonomousDeltaBullets: deltaBullets,
    lockedDecisions,
    nextDecisionPrompt,
    generatedAt: args.nowIso ?? new Date().toISOString(),
  };
}
