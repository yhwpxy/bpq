import { createHash } from 'node:crypto';
import { downstream } from './graphSemantics.js';
export function semanticPlan(plan) {
  const p = structuredClone(plan);
  delete p.createdAt; delete p.updatedAt;
  for (const n of p.nodes || []) { delete n.x; delete n.y; }
  return p;
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => [k, canonical(value[k])]));
  return value;
}
export const graphDigest = plan => createHash('sha256').update(JSON.stringify(canonical(semanticPlan(plan)))).digest('hex');
export function changeImpact(before, after) {
  const a = new Map(before.nodes.map(n => [n.id, n])), b = new Map(after.nodes.map(n => [n.id, n]));
  const added = [...b.keys()].filter(id => !a.has(id)), removed = [...a.keys()].filter(id => !b.has(id));
  const changed = [...b.keys()].filter(id => a.has(id) && JSON.stringify(a.get(id).props) !== JSON.stringify(b.get(id).props));
  const edgesChanged = JSON.stringify(before.edges) !== JSON.stringify(after.edges);
  const goalChanged = JSON.stringify(before.workflow) !== JSON.stringify(after.workflow) || JSON.stringify(before.meta) !== JSON.stringify(after.meta);
  const seeds = new Set([...added, ...changed]);
  if (edgesChanged) for (const e of [...before.edges, ...after.edges]) { seeds.add(e.source); seeds.add(e.target); }
  if (removed.length) for (const e of before.edges) if (removed.includes(e.source)) seeds.add(e.target);
  if (goalChanged) after.nodes.forEach(n => seeds.add(n.id));
  const affected = [...downstream(after, seeds)].filter(id => b.has(id));
  const nodes = [...new Set([...affected, ...removed])].flatMap(id => [a.get(id), b.get(id)]).filter(Boolean);
  return { addedNodeIds: added, removedNodeIds: removed, changedNodeIds: changed, affectedNodeIds: affected,
    requirementIds: [...new Set(nodes.flatMap(n => [...(n.props.requirementRefs || []), ...(n.props.acceptanceRefs || [])]))],
    capabilityIds: [...new Set(nodes.map(n => n.props.capabilityId).filter(Boolean))],
    requiresRevalidation: graphDigest(before) !== graphDigest(after), requiresRetrial: graphDigest(before) !== graphDigest(after),
  };
}
