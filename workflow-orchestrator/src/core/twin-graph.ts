/**
 * Pure Twin-Graph Engine:
 * Forward DAG compilation, cycle checks, conditional branching + Join barriers,
 * bounded rework rewind sets, runtime GhostNode splicing, and auto-layout.
 */

import {OrchestratorError} from '../shared/errors.ts';
import type {GraphEdge, GraphNode} from '../shared/types.ts';

function isForwardEdge(edge: GraphEdge): boolean {
  return edge.kind !== 'loop';
}

export function hasForwardCycle(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): boolean {
  const adj = new Map<string, string[]>();
  for (const n of nodes) {
    adj.set(n.id, []);
  }
  for (const e of edges) {
    if (!isForwardEdge(e)) {
      continue;
    }
    const list = adj.get(e.sourceNodeId);
    if (list) {
      list.push(e.targetNodeId);
    }
  }

  const color = new Map<string, 0 | 1 | 2>();
  for (const n of nodes) {
    color.set(n.id, 0);
  }

  const dfs = (id: string): boolean => {
    color.set(id, 1);
    for (const nxt of adj.get(id) ?? []) {
      const c = color.get(nxt) ?? 0;
      if (c === 1) {
        return true;
      }
      if (c === 0 && dfs(nxt)) {
        return true;
      }
    }
    color.set(id, 2);
    return false;
  };

  for (const n of nodes) {
    if ((color.get(n.id) ?? 0) === 0 && dfs(n.id)) {
      return true;
    }
  }
  return false;
}

export function doesDecisionEdgeMatch(
  sourceNode: GraphNode,
  edge: GraphEdge,
): boolean {
  const cond = edge.conditionExpr?.trim();
  if (!cond) {
    return true;
  }
  const summary = sourceNode.outputSummary.trim();
  if (!summary) {
    return cond === 'default' || cond === 'standard';
  }
  try {
    const parsed = JSON.parse(summary) as Record<string, unknown>;
    const selected = String(parsed['selectedBranch'] ?? '').trim();
    if (selected.length > 0) {
      return selected === cond;
    }
  } catch {
    // Fallback to plain substring match for non-JSON decision summaries.
  }
  return summary.toLowerCase().includes(cond.toLowerCase());
}

export interface FrontierResolution {
  readonly readyNodeIds: readonly string[];
  readonly skipNodeIds: readonly string[];
}

/**
 * Evaluates all `pending` executable nodes against incoming forward edges:
 * - Returns `readyNodeIds` when dependencies are satisfied (including Join after conditional skips)
 * - Returns `skipNodeIds` when every incoming path was bypassed/skipped.
 */
export function computeNextFrontier(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): FrontierResolution {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const incoming = new Map<string, GraphEdge[]>();
  const outgoing = new Map<string, GraphEdge[]>();

  for (const n of nodes) {
    incoming.set(n.id, []);
    outgoing.set(n.id, []);
  }
  for (const e of edges) {
    if (!isForwardEdge(e)) {
      continue;
    }
    incoming.get(e.targetNodeId)?.push(e);
    outgoing.get(e.sourceNodeId)?.push(e);
  }

  const readyNodeIds: string[] = [];
  const skipNodeIds: string[] = [];

  for (const node of nodes) {
    if (node.kind === 'phase_container' || node.status !== 'pending') {
      continue;
    }
    const deps = incoming.get(node.id) ?? [];
    if (deps.length === 0) {
      readyNodeIds.push(node.id);
      continue;
    }

    // Recovery (`fail`-edge-only) nodes trigger as soon as ANY upstream failure occurs,
    // rather than blocking until later stages also fail or settle.
    if (deps.every(e => e.kind === 'fail')) {
      const anyFailed = deps.some(
        e => byId.get(e.sourceNodeId)?.status === 'failed',
      );
      const allCleared = deps.every(e => {
        const src = byId.get(e.sourceNodeId);
        return (
          !src ||
          src.status === 'succeeded' ||
          src.status === 'waived' ||
          src.status === 'skipped'
        );
      });
      if (anyFailed) {
        readyNodeIds.push(node.id);
      } else if (allCleared) {
        skipNodeIds.push(node.id);
      }
      continue;
    }

    let hasUnresolved = false;
    let satisfiedCount = 0;
    let disabledCount = 0;

    for (const edge of deps) {
      const src = byId.get(edge.sourceNodeId);
      if (!src) {
        satisfiedCount += 1;
        continue;
      }

      if (src.status === 'skipped') {
        disabledCount += 1;
        continue;
      }

      const srcDoneSuccess =
        src.status === 'succeeded' || src.status === 'waived';

      if (edge.kind === 'fail') {
        if (srcDoneSuccess) {
          disabledCount += 1;
        } else if (src.status === 'failed') {
          satisfiedCount += 1;
        } else {
          hasUnresolved = true;
        }
        continue;
      }

      // `dep` or `pass` edge
      if (srcDoneSuccess) {
        if (src.kind === 'decision' && edge.conditionExpr) {
          if (doesDecisionEdgeMatch(src, edge)) {
            satisfiedCount += 1;
          } else {
            disabledCount += 1;
          }
        } else {
          satisfiedCount += 1;
        }
      } else if (src.status === 'failed') {
        const failOut = (outgoing.get(src.id) ?? []).some(
          o => o.kind === 'fail',
        );
        const failTargetPending = (outgoing.get(src.id) ?? []).some(o => {
          if (o.kind !== 'fail') {
            return false;
          }
          const t = byId.get(o.targetNodeId);
          return t !== undefined && t.status !== 'failed';
        });
        if (failOut && failTargetPending) {
          // Recovery handler is still active/pending; hold downstream pass branch.
          hasUnresolved = true;
        } else {
          hasUnresolved = true;
        }
      } else {
        hasUnresolved = true;
      }
    }

    if (hasUnresolved) {
      continue;
    }
    if (disabledCount === deps.length) {
      skipNodeIds.push(node.id);
    } else if (satisfiedCount > 0) {
      readyNodeIds.push(node.id);
    }
  }

  return {readyNodeIds, skipNodeIds};
}

export function computeRewindSet(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  restoreTargetNodeId: string,
): Set<string> {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const adj = new Map<string, string[]>();
  for (const n of nodes) {
    adj.set(n.id, []);
  }
  for (const e of edges) {
    if (isForwardEdge(e) && e.kind !== 'fail') {
      adj.get(e.sourceNodeId)?.push(e.targetNodeId);
    }
  }

  const resetIds = new Set<string>();
  const queue: string[] = [restoreTargetNodeId];
  while (queue.length > 0) {
    const curr = queue.shift()!;
    if (resetIds.has(curr)) {
      continue;
    }
    const node = byId.get(curr);
    if (!node) {
      continue;
    }
    if (node.kind !== 'done' && node.kind !== 'phase_container') {
      resetIds.add(curr);
    }
    for (const nxt of adj.get(curr) ?? []) {
      const nextNode = byId.get(nxt);
      if (nextNode && nextNode.kind !== 'restore' && nextNode.kind !== 'done') {
        queue.push(nxt);
      }
    }
  }
  return resetIds;
}

export function computeDownstreamBlastRadius(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  seedNodeIds: readonly string[],
): string[] {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const adj = new Map<string, string[]>();
  for (const n of nodes) {
    adj.set(n.id, []);
  }
  for (const e of edges) {
    if (isForwardEdge(e)) {
      adj.get(e.sourceNodeId)?.push(e.targetNodeId);
    }
  }

  const visited = new Set<string>();
  const queue = [...seedNodeIds];
  while (queue.length > 0) {
    const curr = queue.shift()!;
    if (visited.has(curr)) {
      continue;
    }
    visited.add(curr);
    for (const nxt of adj.get(curr) ?? []) {
      queue.push(nxt);
    }
  }

  return Array.from(visited)
    .filter(id => !seedNodeIds.includes(id))
    .map(id => byId.get(id)?.code ?? '')
    .filter(Boolean);
}

export function spliceGhostNode(input: {
  readonly scopeId: string;
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly ghostNode: GraphNode;
  readonly insertBeforeNodeId?: string | null;
}): {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
} {
  const {nodes, edges, ghostNode, insertBeforeNodeId, scopeId} = input;
  const target = insertBeforeNodeId
    ? nodes.find(n => n.id === insertBeforeNodeId)
    : nodes.find(n => n.kind === 'gate_shell' || n.kind === 'done');

  if (!target) {
    const nextNodes = [...nodes, ghostNode];
    return {nodes: nextNodes, edges};
  }

  const incomingDep = edges.filter(
    e => e.targetNodeId === target.id && e.kind !== 'loop',
  );
  const nextEdges: GraphEdge[] = [];
  for (const e of edges) {
    if (incomingDep.some(d => d.id === e.id)) {
      nextEdges.push({
        ...e,
        targetNodeId: ghostNode.id,
      });
    } else {
      nextEdges.push(e);
    }
  }

  nextEdges.push({
    id: `edge-${ghostNode.id}-to-${target.id}`,
    scopeId,
    sourceNodeId: ghostNode.id,
    targetNodeId: target.id,
    kind: 'dep',
    label: 'amendment',
    conditionExpr: null,
  });

  const positionedGhost: GraphNode = {
    ...ghostNode,
    containerNodeId: target.containerNodeId,
    phaseId: target.phaseId,
    phaseTitle: target.phaseTitle,
    positionX: Math.max(40, target.positionX - 20),
    positionY: Math.max(40, target.positionY - 96),
  };

  const nextNodes = [...nodes, positionedGhost];
  if (hasForwardCycle(nextNodes, nextEdges)) {
    throw new OrchestratorError(
      'DAG_CYCLE',
      'Injecting GhostNode would create a forward cycle in the Twin-Graph.',
    );
  }

  return {nodes: nextNodes, edges: nextEdges};
}
