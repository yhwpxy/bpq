import { isForward } from '../../shared/workflowSchema.js';
/** Edge outcomes are shared by the real scheduler and the isolated trial. */
export function settleEdges(plan, states, node, outcome, branch) {
  for (const e of plan.edges.filter(e => e.source === node.id && isForward(plan, e))) {
    let state = outcome;
    if (e.kind === 'fail') state = outcome === 'failed' ? 'active' : outcome === 'inactive' ? 'inactive' : 'inactive';
    else if (node.type === 'condition' && outcome === 'active') state = e.label === branch ? 'active' : 'inactive';
    states.set(e.id, state);
  }
}
export function nextFrontier(plan, nodeStates, edgeStates) {
  const ready = [], skipped = [];
  for (const node of plan.nodes) {
    if (!['PENDING', 'READY'].includes(nodeStates[node.id].status)) continue;
    const edges = plan.edges.filter(e => e.target === node.id && isForward(plan, e));
    const states = edges.map(e => edgeStates.get(e.id) || 'pending');
    if (edges.length && edges.every(e => e.kind === 'fail')) {
      if (states.includes('active')) ready.push(node.id);
      else if (states.every(s => s === 'inactive')) skipped.push({ id: node.id, outcome: 'inactive' });
      continue;
    }
    if (states.includes('pending')) continue;
    if (states.includes('failed') && !plan.meta?.continueOnError) skipped.push({ id: node.id, outcome: 'failed' });
    else if (states.length && states.every(s => s === 'inactive')) skipped.push({ id: node.id, outcome: 'inactive' });
    else ready.push(node.id);
  }
  return { ready, skipped };
}
