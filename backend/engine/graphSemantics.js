import { isForward } from '../../shared/workflowSchema.js';
export function successors(plan, id, { includeFailure = true } = {}) {
  return plan.edges.filter(e => isForward(plan, e) && e.source === id && (includeFailure || e.kind !== 'fail')).map(e => e.target);
}
export function downstream(plan, seeds, options) {
  const found = new Set(), queue = [...seeds];
  while (queue.length) { const id = queue.shift(); if (found.has(id)) continue; found.add(id); queue.push(...successors(plan, id, options)); }
  return found;
}
export function scopesOverlap(a, b) {
  const prefix = s => s.replaceAll('\\', '/').split('*')[0];
  const x = prefix(a), y = prefix(b);
  return x.startsWith(y) || y.startsWith(x);
}
export function rewindIds(plan, checkpointId) {
  return downstream(plan, [checkpointId], { includeFailure: false });
}
