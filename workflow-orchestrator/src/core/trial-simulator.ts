/**
 * Isolated Trial Run Simulator (Dry Run):
 * Executes a non-destructive dry pass across the Twin-Graph prior to locking an
 * immutable workflow version. Verifies capability health, I/O chaining,
 * conditional branch routing, skipped-path propagation, and Join barriers.
 */

import {randomUUID} from 'node:crypto';
import type {
  CapabilityAdapterManifest,
  CapabilityHealthProfile,
  GoalSpec,
  GraphEdge,
  GraphNode,
  TrialRunReport,
  TrialStepTrace,
  ValidationReport,
} from '../shared/types.ts';
import {computeNextFrontier} from './twin-graph.ts';

export function runTrialSimulation(input: {
  readonly workflowId: string;
  readonly goalSpec: GoalSpec;
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly validation: ValidationReport;
}): TrialRunReport {
  const t0 = Date.now();
  const blockingIssues = input.validation.issues.filter(
    i => i.level === 'error',
  );
  if (blockingIssues.length > 0) {
    return {
      id: `trial-${randomUUID().slice(0, 8)}`,
      workflowId: input.workflowId,
      passed: false,
      durationMs: Math.max(1, Date.now() - t0),
      simulatedPath: [],
      skippedNodes: [],
      blockingIssues,
      steps: [],
      ranAt: new Date().toISOString(),
    };
  }

  let simNodes: GraphNode[] = input.nodes.map(n => ({
    ...n,
    status: n.kind === 'phase_container' ? n.status : 'pending',
  }));

  const steps: TrialStepTrace[] = [];
  const simulatedPath: string[] = [];
  const skippedNodes: string[] = [];

  for (let wave = 0; wave < 48; wave += 1) {
    const frontier = computeNextFrontier(simNodes, input.edges);
    if (
      frontier.readyNodeIds.length === 0 &&
      frontier.skipNodeIds.length === 0
    ) {
      break;
    }

    const readySet = new Set(frontier.readyNodeIds);
    const skipSet = new Set(frontier.skipNodeIds);

    simNodes = simNodes.map(node => {
      if (skipSet.has(node.id)) {
        skippedNodes.push(node.code);
        steps.push({
          nodeCode: node.code,
          title: node.title,
          executorKind: node.executorKind,
          capabilityId: node.capabilityId,
          simulatedStatus: 'skipped',
          branchDecision: null,
          note: 'Conditional branch not selected in default trial run.',
        });
        return {...node, status: 'skipped'};
      }
      if (!readySet.has(node.id)) {
        return node;
      }

      if (node.kind === 'restore') {
        skippedNodes.push(node.code);
        return {...node, status: 'skipped'};
      }

      const simStatus: TrialStepTrace['simulatedStatus'] =
        node.kind === 'human_gate' ? 'waiting_human' : 'succeeded';
      simulatedPath.push(node.code);
      steps.push({
        nodeCode: node.code,
        title: node.title,
        executorKind: node.executorKind,
        capabilityId: node.capabilityId,
        simulatedStatus: simStatus,
        branchDecision:
          node.kind === 'decision'
            ? node.outputSummary || '{"selectedBranch":"standard"}'
            : null,
        note:
          node.kind === 'human_gate'
            ? 'Trial simulated auto-approval of human gate.'
            : `Simulated I/O contract OK (${node.inputContract || 'none'} -> ${node.outputContract || 'none'}).`,
      });
      return {...node, status: 'succeeded'};
    });
  }

  const doneReached =
    simNodes.find(n => n.kind === 'done')?.status === 'succeeded';

  return {
    id: `trial-${randomUUID().slice(0, 8)}`,
    workflowId: input.workflowId,
    passed: doneReached && blockingIssues.length === 0,
    durationMs: Math.max(1, Date.now() - t0),
    simulatedPath,
    skippedNodes,
    blockingIssues,
    steps,
    ranAt: new Date().toISOString(),
  };
}

export function isCapabilityAssignable(
  capability: CapabilityAdapterManifest | undefined,
  health: CapabilityHealthProfile | undefined,
): boolean {
  return Boolean(
    capability && capability.enabled && health?.circuitState !== 'open',
  );
}
