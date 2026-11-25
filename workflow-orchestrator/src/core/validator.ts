/**
 * 3-Level Consistency & Structural Validator + Change Impact Analyzer.
 *
 * Level 1 (Structure): Forward DAG acyclicity, Start -> Done reachability,
 *   bounded rework configuration, orphan node check.
 * Level 2 (Spec & Contract): Requirement (FR-xx) coverage across nodes,
 *   Planning Rationale presence, I/O contract continuity, suggested assumptions.
 * Level 3 (Capability, Conflict & Policy): Assigned capability availability and
 *   circuit breaker status (`open` -> blocking Error), parallel mutable `fileScope`
 *   overlap warnings, strict-tier Human Gate enforcement.
 */

import {randomUUID} from 'node:crypto';
import type {
  CapabilityAdapterManifest,
  CapabilityHealthProfile,
  ChangeImpactReport,
  DomainTermEntry,
  GoalSpec,
  GraphEdge,
  GraphNode,
  PermissionTier,
  ValidationIssue,
  ValidationReport,
} from '../shared/types.ts';
import {detectTerminologyDrift} from './ddd.ts';
import {computeDownstreamBlastRadius, hasForwardCycle} from './twin-graph.ts';

function issue(
  level: ValidationIssue['level'],
  category: ValidationIssue['category'],
  message: string,
  suggestion: string,
  nodeCode: string | null = null,
  requirementCode: string | null = null,
): ValidationIssue {
  return {
    id: `val-${randomUUID().slice(0, 8)}`,
    level,
    category,
    nodeCode,
    requirementCode,
    message,
    suggestion,
  };
}

function globsOverlap(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/\*+/g, '').replace(/\/+$/, '').trim();
  const pa = norm(a);
  const pb = norm(b);
  if (!pa || !pb) {
    return false;
  }
  return pa.startsWith(pb) || pb.startsWith(pa);
}

export function validateWorkflowSpec(input: {
  readonly workflowId: string;
  readonly goalSpec: GoalSpec;
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly capabilities: readonly CapabilityAdapterManifest[];
  readonly healthProfiles: readonly CapabilityHealthProfile[];
  readonly permissionTier: PermissionTier;
  readonly maxReworkIterations: number;
  readonly domainTerms?: readonly DomainTermEntry[];
  readonly dddStrictCheck?: boolean;
}): ValidationReport {
  const issues: ValidationIssue[] = [];
  const execNodes = input.nodes.filter(n => n.kind !== 'phase_container');
  const capById = new Map(input.capabilities.map(c => [c.id, c]));
  const healthById = new Map(
    input.healthProfiles.map(h => [h.capabilityId, h]),
  );

  // Level 1: Structural invariants
  if (execNodes.length === 0) {
    issues.push(
      issue(
        'error',
        'structure',
        'Workflow graph has no executable nodes.',
        'Generate Twin-Graph from GoalSpec or add task nodes.',
      ),
    );
  }

  if (hasForwardCycle(input.nodes, input.edges)) {
    issues.push(
      issue(
        'error',
        'structure',
        'Forward Twin-Graph contains a dependency cycle outside explicit loop edges.',
        'Remove cyclic dep/pass/fail edges or convert feedback edge to `loop`.',
      ),
    );
  }

  const startNode = execNodes.find(n => n.kind === 'start');
  const doneNode = execNodes.find(n => n.kind === 'done');
  if (!startNode) {
    issues.push(
      issue(
        'error',
        'structure',
        'Missing START entry node in Twin-Graph.',
        'Add a START anchor node to establish deterministic execution root.',
      ),
    );
  }
  if (!doneNode) {
    issues.push(
      issue(
        'error',
        'structure',
        'Missing DONE sink node in Twin-Graph.',
        'Add a DONE certification sink node reachable from verification gates.',
      ),
    );
  }

  if (startNode && doneNode) {
    const forwardAdj = new Map<string, string[]>();
    for (const n of execNodes) {
      forwardAdj.set(n.id, []);
    }
    for (const e of input.edges) {
      if (e.kind !== 'loop') {
        forwardAdj.get(e.sourceNodeId)?.push(e.targetNodeId);
      }
    }
    const reachable = new Set<string>([startNode.id]);
    const queue = [startNode.id];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      for (const nxt of forwardAdj.get(curr) ?? []) {
        if (!reachable.has(nxt)) {
          reachable.add(nxt);
          queue.push(nxt);
        }
      }
    }
    if (!reachable.has(doneNode.id)) {
      issues.push(
        issue(
          'error',
          'structure',
          'DONE node is unreachable from START via forward edges.',
          'Connect intermediate phases through Join & Gates to DONE.',
          doneNode.code,
        ),
      );
    }
    for (const n of execNodes) {
      if (!reachable.has(n.id) && n.kind !== 'ghost') {
        issues.push(
          issue(
            'warning',
            'structure',
            `Node ${n.code} ("${n.title}") is unreachable from START.`,
            'Connect an incoming dependency edge or remove the orphan node.',
            n.code,
          ),
        );
      }
    }
  }

  if (input.maxReworkIterations < 1 || input.maxReworkIterations > 20) {
    issues.push(
      issue(
        'error',
        'structure',
        `Bounded rework limit (${input.maxReworkIterations}) must be between 1 and 20.`,
        'Set maxReworkIterations within safe bounds to avoid unbounded loops.',
      ),
    );
  }

  // Level 2: Spec coverage, rationale & contracts
  if (!input.goalSpec.goal.trim()) {
    issues.push(
      issue(
        'error',
        'spec_coverage',
        'GoalSpec lacks a concrete goal statement.',
        'Specify the workflow goal before compiling or running.',
      ),
    );
  }

  const coveredReqs = new Set<string>();
  for (const node of execNodes) {
    for (const ref of node.requirementRefs) {
      coveredReqs.add(ref.toUpperCase());
    }
    if (
      (node.kind === 'task' || node.kind === 'qa_audit') &&
      !node.planningRationale.trim()
    ) {
      issues.push(
        issue(
          'warning',
          'spec_coverage',
          `Node ${node.code} has empty Planning Rationale.`,
          'Document why this task is decomposed here and what constraint it satisfies.',
          node.code,
        ),
      );
    }
    if (
      node.kind === 'task' &&
      (!node.inputContract.trim() || !node.outputContract.trim())
    ) {
      issues.push(
        issue(
          'warning',
          'contract',
          `Task ${node.code} is missing explicit input/output contract.`,
          'Define inputContract and outputContract for reliable data handoff.',
          node.code,
        ),
      );
    }
  }

  for (const req of input.goalSpec.requirements) {
    if (!coveredReqs.has(req.code.toUpperCase())) {
      issues.push(
        issue(
          req.priority === 'must' ? 'error' : 'warning',
          'spec_coverage',
          `Requirement ${req.code} ("${req.title}") is not mapped to any Twin-Graph node.`,
          `Attach ${req.code} to an existing Task's requirementRefs or add a dedicated task.`,
          null,
          req.code,
        ),
      );
    }
  }

  for (const asm of input.goalSpec.assumptions) {
    if (asm.source === 'suggested') {
      issues.push(
        issue(
          'info',
          'spec_coverage',
          `Unconfirmed suggested assumption: "${asm.text}"`,
          'Review and confirm or replace auto-suggested assumptions in GoalSpec.',
        ),
      );
    }
  }

  // Level 3: Capabilities, Parallel Write Conflict & Policy
  for (const node of execNodes) {
    if (node.executorKind === 'control' || node.executorKind === 'human') {
      continue;
    }
    const cap = capById.get(node.capabilityId);
    if (!cap) {
      issues.push(
        issue(
          'error',
          'capability',
          `Node ${node.code} binds unknown capability "${node.capabilityId}".`,
          'Assign a registered enabled capability in the Node Inspector.',
          node.code,
        ),
      );
      continue;
    }
    if (!cap.enabled) {
      issues.push(
        issue(
          'error',
          'capability',
          `Node ${node.code} binds disabled capability "${cap.label}".`,
          'Enable the capability or switch node assignment to a healthy capability.',
          node.code,
        ),
      );
      continue;
    }
    const health = healthById.get(cap.id);
    if (health?.circuitState === 'open') {
      issues.push(
        issue(
          'error',
          'capability',
          `Capability "${cap.label}" assigned to ${node.code} has an OPEN circuit breaker (${health.lastError || 'recent consecutive failures'}).`,
          'Switch to an alternative capability or reset/re-probe the circuit in Capabilities Pool.',
          node.code,
        ),
      );
    }
  }

  if (input.permissionTier === 'strict') {
    const hasHumanGate = execNodes.some(n => n.kind === 'human_gate');
    if (!hasHumanGate) {
      issues.push(
        issue(
          'warning',
          'policy',
          'Permission tier is STRICT but graph contains no human_gate node.',
          'Add a human approval gate before mutating or releasing artifacts.',
        ),
      );
    }
  }

  // Parallel siblings conflict check (nodes sharing same incoming predecessor)
  const parentsMap = new Map<string, string[]>();
  for (const e of input.edges) {
    if (e.kind !== 'loop') {
      const arr = parentsMap.get(e.targetNodeId) ?? [];
      arr.push(e.sourceNodeId);
      parentsMap.set(e.targetNodeId, arr);
    }
  }

  const taskNodes = execNodes.filter(
    n => n.kind === 'task' && n.fileScope.length > 0,
  );
  for (let i = 0; i < taskNodes.length; i += 1) {
    for (let j = i + 1; j < taskNodes.length; j += 1) {
      const a = taskNodes[i]!;
      const b = taskNodes[j]!;
      const aParents = parentsMap.get(a.id) ?? [];
      const bParents = parentsMap.get(b.id) ?? [];
      const sharesParent = aParents.some(p => bParents.includes(p));
      if (!sharesParent) {
        continue;
      }
      const conflict = a.fileScope.find(sa =>
        b.fileScope.some(sb => globsOverlap(sa, sb)),
      );
      if (conflict) {
        issues.push(
          issue(
            'warning',
            'conflict',
            `Parallel sibling tasks ${a.code} and ${b.code} have overlapping fileScope ("${conflict}").`,
            'Disjoint fileScopes eliminate race conditions during concurrent execution.',
            b.code,
          ),
        );
      }
    }
  }

  // Level 4: DDD Ubiquitous Language terminology drift check
  if (
    input.dddStrictCheck !== false &&
    input.domainTerms &&
    input.domainTerms.length > 0
  ) {
    const goalAndReqText = [
      input.goalSpec.goal,
      ...input.goalSpec.requirements.map(r => `${r.title} ${r.description}`),
    ].join('\n');
    for (const drift of detectTerminologyDrift(
      goalAndReqText,
      input.domainTerms,
    )) {
      issues.push(
        issue(
          'warning',
          'ddd_drift',
          `DDD terminology drift in GoalSpec (${drift.boundedContext}): found discouraged alias "${drift.matchedAlias}" instead of "${drift.canonicalTerm}".`,
          `Replace "${drift.matchedAlias}" with canonical DDD term "${drift.canonicalTerm}".`,
        ),
      );
    }
    for (const node of execNodes) {
      const nodeText = `${node.title} ${node.description} ${node.outputContract}`;
      for (const drift of detectTerminologyDrift(nodeText, input.domainTerms)) {
        issues.push(
          issue(
            'warning',
            'ddd_drift',
            `Node ${node.code} uses discouraged alias "${drift.matchedAlias}" instead of canonical DDD term "${drift.canonicalTerm}".`,
            `Rename to "${drift.canonicalTerm}" to prevent semantic drift across agents.`,
            node.code,
          ),
        );
      }
    }
  }

  const errorCount = issues.filter(i => i.level === 'error').length;
  const warningCount = issues.filter(i => i.level === 'warning').length;
  const infoCount = issues.filter(i => i.level === 'info').length;

  return {
    workflowId: input.workflowId,
    valid: errorCount === 0,
    errorCount,
    warningCount,
    infoCount,
    issues,
    checkedAt: new Date().toISOString(),
  };
}

export function analyzeChangeImpact(input: {
  readonly workflowId: string;
  readonly prevNodes: readonly GraphNode[];
  readonly prevEdges: readonly GraphEdge[];
  readonly nextNodes: readonly GraphNode[];
  readonly nextEdges: readonly GraphEdge[];
}): ChangeImpactReport {
  const prevMap = new Map(input.prevNodes.map(n => [n.id, n]));
  const nextMap = new Map(input.nextNodes.map(n => [n.id, n]));

  const addedIds: string[] = [];
  const modifiedIds: string[] = [];
  const removedCodes: string[] = [];
  const impactedReqs = new Set<string>();

  for (const [id, next] of nextMap) {
    if (next.kind === 'phase_container') {
      continue;
    }
    const prev = prevMap.get(id);
    if (!prev) {
      addedIds.push(id);
      next.requirementRefs.forEach(r => impactedReqs.add(r));
      continue;
    }
    const changed =
      prev.title !== next.title ||
      prev.description !== next.description ||
      prev.capabilityId !== next.capabilityId ||
      prev.gateCommand !== next.gateCommand ||
      prev.inputContract !== next.inputContract ||
      prev.outputContract !== next.outputContract ||
      JSON.stringify(prev.requirementRefs) !==
        JSON.stringify(next.requirementRefs) ||
      JSON.stringify(prev.fileScope) !== JSON.stringify(next.fileScope);

    if (changed) {
      modifiedIds.push(id);
      prev.requirementRefs.forEach(r => impactedReqs.add(r));
      next.requirementRefs.forEach(r => impactedReqs.add(r));
    }
  }

  for (const [id, prev] of prevMap) {
    if (prev.kind !== 'phase_container' && !nextMap.has(id)) {
      removedCodes.push(prev.code);
      prev.requirementRefs.forEach(r => impactedReqs.add(r));
    }
  }

  // Also include edge changes on source nodes
  const prevEdgeSig = new Set(
    input.prevEdges.map(e => `${e.sourceNodeId}->${e.targetNodeId}:${e.kind}`),
  );
  const nextEdgeSig = new Set(
    input.nextEdges.map(e => `${e.sourceNodeId}->${e.targetNodeId}:${e.kind}`),
  );
  for (const e of input.nextEdges) {
    if (!prevEdgeSig.has(`${e.sourceNodeId}->${e.targetNodeId}:${e.kind}`)) {
      modifiedIds.push(e.targetNodeId);
    }
  }
  for (const e of input.prevEdges) {
    if (
      !nextEdgeSig.has(`${e.sourceNodeId}->${e.targetNodeId}:${e.kind}`) &&
      nextMap.has(e.targetNodeId)
    ) {
      modifiedIds.push(e.targetNodeId);
    }
  }

  const seedIds = Array.from(new Set([...addedIds, ...modifiedIds]));
  const downstreamCodes = computeDownstreamBlastRadius(
    input.nextNodes,
    input.nextEdges,
    seedIds,
  );
  const modifiedNodeCodes = modifiedIds
    .map(id => nextMap.get(id)?.code ?? '')
    .filter(Boolean);
  const addedNodeCodes = addedIds
    .map(id => nextMap.get(id)?.code ?? '')
    .filter(Boolean);

  const hasChanges =
    modifiedNodeCodes.length > 0 ||
    addedNodeCodes.length > 0 ||
    removedCodes.length > 0;

  return {
    workflowId: input.workflowId,
    modifiedNodeCodes: Array.from(new Set(modifiedNodeCodes)),
    addedNodeCodes,
    removedNodeCodes: removedCodes,
    affectedDownstreamCodes: downstreamCodes,
    impactedRequirementCodes: Array.from(impactedReqs),
    requiresRevalidation: hasChanges,
    requiresRetrial: hasChanges,
    summary: hasChanges
      ? `Modified ${modifiedNodeCodes.length}, added ${addedNodeCodes.length}, removed ${removedCodes.length}; ${downstreamCodes.length} downstream node(s) impacted (${Array.from(impactedReqs).join(', ') || 'no FR change'}).`
      : 'No structural or semantic modifications detected.',
    analyzedAt: new Date().toISOString(),
  };
}
