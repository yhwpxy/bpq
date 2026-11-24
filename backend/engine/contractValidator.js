import { terminologyIssues } from './terminology.js';
import { policyViolation } from './executionPolicy.js';
import { downstream, scopesOverlap } from './graphSemantics.js';
export function validateWorkflowSemantics(plan, { capabilities, governance } = {}) {
  const issues = [], w = plan.workflow;
  const add = (rule, code, level, severity, message, nodeId = '', extra = {}) => issues.push({ rule, code, level, severity, message, nodeId, ...extra });
  const byId = new Map(plan.nodes.map(n => [n.id, n]));
  const groups = new Map();
  for (const g of w.groups) {
    if (groups.has(g.id) || byId.has(g.id)) add('R7', 'GROUP_ID', 1, 'error', 'WBS IDs must be unique', g.id);
    groups.set(g.id, g);
  }
  for (const g of w.groups) {
    if (g.kind === 'task' && groups.get(g.parentId)?.kind !== 'phase') add('R8', 'WBS_PARENT', 1, 'error', 'Task container requires a phase parent', g.id);
    if (g.kind === 'phase' && g.parentId != null) add('R8', 'WBS_PARENT', 1, 'error', 'Phase cannot have a parent', g.id);
  }
  const refs = new Set(w.goalSpec.requirements.map(r => r.id)), acs = new Set(w.goalSpec.acceptanceCriteria.map(r => r.id));
  const covered = new Set(), accepted = new Set();
  for (const n of plan.nodes) {
    const p = n.props;
    issues.push(...terminologyIssues(`${p.name} ${p.prompt || ''} ${p.planningRationale}`, governance?.terms || [], n.id));
    if (p.command) { const violation = policyViolation(p.command, p.args, governance?.policy, w.permissionTier, true); if (violation) add('R6', 'EXECUTION_POLICY', 3, 'error', violation, n.id); }
    if (!p.planningRationale.trim()) add('R6', 'RATIONALE', 2, 'warning', 'Explain this node’s purpose and executor choice', n.id);
    if (!groups.has(p.parentId)) add('R8', 'WBS_PARENT', 1, 'error', 'Node parent does not exist', n.id);
    const parent = groups.get(p.parentId);
    const phase = parent?.kind === 'phase' ? parent.id : parent?.parentId;
    if (p.phaseId !== phase || p.depth !== (parent?.kind === 'task' ? 2 : 1)) add('R8', 'WBS_DEPTH', 1, 'error', 'Node phase/depth differs from its hierarchy', n.id);
    for (const ref of p.requirementRefs) { if (!refs.has(ref)) add('R8', 'FR_REFERENCE', 2, 'error', `Unknown requirement ${ref}`, n.id, { requirementId: ref }); else covered.add(ref); }
    for (const ref of p.acceptanceRefs) { if (!acs.has(ref)) add('R8', 'AC_REFERENCE', 2, 'error', `Unknown acceptance criterion ${ref}`, n.id, { requirementId: ref }); else accepted.add(ref); }
    if (['agent', 'tool'].includes(p.executorKind)) {
      const c = capabilities?.find(c => c.id === p.capabilityId);
      if (c?.roles && p.assignedRole && !c.roles.includes(p.assignedRole)) add('R6', 'CAPABILITY_ROLE', 3, 'error', `Capability does not support role ${p.assignedRole}`, n.id);
      if (!c || !c.enabled || c.circuit === 'open' || c.kind !== p.executorKind) add('R6', 'CAPABILITY_UNAVAILABLE', 3, 'error', `Capability ${p.capabilityId || '(unset)'} is unavailable or incompatible`, n.id);
    }
    if (p.control === 'restore') {
      const loops = plan.edges.filter(e => e.source === n.id && e.kind === 'loop');
      if (loops.length !== 1) add('R2', 'RESTORE_LOOP', 1, 'error', 'Restore must have exactly one explicit loop edge', n.id);
    }
    const incoming = plan.edges.filter(e => e.target === n.id && e.kind !== 'loop' && e.kind !== 'fail');
    if (incoming.length && p.control !== 'restore') {
      const available = incoming.flatMap(e => byId.get(e.source)?.props.outputContract || []);
      for (const contract of p.inputContract) {
        const providers = available.filter(x => x.name === contract.name);
        if (contract.required && !providers.length) add('R6', 'CONTRACT_MISSING', 2, 'error', `No upstream output supplies ${contract.name}`, n.id);
        if (providers.some(x => contract.type !== 'any' && x.type !== contract.type)) add('R6', 'CONTRACT_TYPE', 2, 'error', `Incompatible upstream type for ${contract.name}`, n.id);
      }
    }
  }
  for (const ref of refs) if (!covered.has(ref)) add('R8', 'FR_UNCOVERED', 2, 'error', `${ref} has no mapped execution node`, '', { requirementId: ref });
  for (const ref of acs) if (!accepted.has(ref)) add('R8', 'AC_UNCOVERED', 2, 'error', `${ref} has no mapped verification node`, '', { requirementId: ref });
  for (const field of ['requirements', 'acceptanceCriteria', 'inputs', 'outputs', 'constraints', 'assumptions']) for (const x of w.goalSpec[field]) if (x.source === 'suggested') add('R6', 'SUGGESTED', 2, 'info', `Review suggested item ${x.id}`, '', { requirementId: x.id });
  for (const e of plan.edges.filter(e => e.kind === 'loop')) {
    const source = byId.get(e.source), target = byId.get(e.target);
    if (source?.props.control !== 'restore' || target?.props.control !== 'checkpoint' || !downstream(plan, [e.target]).has(e.source)) add('R2', 'ILLEGAL_LOOP', 1, 'error', 'Loop must connect a reachable restore back to its earlier checkpoint', e.source);
    if (source?.props.restoreTarget !== e.target) add('R8', 'CHECKPOINT_REFERENCE', 1, 'error', 'Loop and explicit restore target must agree', e.source);
  }
  if (w.permissionTier === 'strict') {
    const start = plan.nodes.find(n => n.type === 'start');
    const queue = start ? [start.id] : [], visited = new Set();
    while (queue.length) {
      const id = queue.shift(); if (visited.has(id)) continue; visited.add(id); const node = byId.get(id);
      if (!node || node.props.control === 'human') continue;
      if ((['tool','agent'].includes(node.props.executorKind) && node.props.capabilityId !== 'simulated') || node.props.control === 'gate') add('R6','HUMAN_ORDER',3,'error','Every strict mutation path must pass through a human gate',id);
      for (const edge of plan.edges.filter(e => e.source === id && e.kind !== 'loop' && e.kind !== 'fail')) queue.push(edge.target);
    }
  }
  if (w.permissionTier === 'strict' && !plan.nodes.some(n => n.props.control === 'human')) add('R6', 'HUMAN_REQUIRED', 3, 'error', 'Strict mode requires an explicit human gate');
  const workers = plan.nodes.filter(n => n.props.fileScope.length && ['tool', 'agent'].includes(n.props.executorKind));
  for (let i = 0; i < workers.length; i++) for (let j = i + 1; j < workers.length; j++) {
    const a = workers[i], b = workers[j];
    if (downstream(plan, [a.id]).has(b.id) || downstream(plan, [b.id]).has(a.id)) continue;
    if (a.props.fileScope.some(x => b.props.fileScope.some(y => scopesOverlap(x, y)))) add('R6', 'PARALLEL_WRITES', 3, 'warning', `Parallel write scopes overlap: ${a.props.name}, ${b.props.name}`, b.id, { relatedNodeIds: [a.id, b.id] });
  }
  issues.push(...terminologyIssues(`${w.goalSpec.goal} ${w.goalSpec.requirements.map(r => r.text).join(' ')}`, governance?.terms || []));
  return issues;
}
