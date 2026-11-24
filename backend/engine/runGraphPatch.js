import { createNode } from '../../shared/plan.js';
import { validatePlan } from './validator.js';
import { AppError } from '../services/errors.js';
import { nanoid } from 'nanoid';
export function spliceGhost(plan, states, request, capabilities) {
  const target = plan.nodes.find(n => n.id === request.targetId);
  if (!target || target.type === 'start' || target.props.control === 'restore' || states[target.id]?.status !== 'PENDING') throw new AppError(40901, 'Ghost target must be an unstarted forward node');
  if (typeof request.title !== 'string' || !request.title.trim() || request.title.length > 50 || typeof request.reason !== 'string' || !request.reason.trim()) throw new AppError(40001, 'Ghost title and reason are required');
  const capability = capabilities.find(c => c.id === (request.capabilityId || 'simulated'));
  if (!capability) throw new AppError(40002, 'Ghost capability not registered');
  const next = structuredClone(plan), node = createNode('task', target.x - 160, target.y);
  node.props = { ...node.props, name: request.title, duration: request.duration ?? 0, control: 'ghost', executorKind: capability.kind, capabilityId: capability.id,
    parentId: target.props.parentId, phaseId: target.props.phaseId, depth: target.props.depth,
    planningRationale: request.reason, requirementRefs: request.requirementRefs || [], acceptanceRefs: [],
    inputContract: target.props.inputContract, outputContract: target.props.inputContract, fileScope: request.fileScope || [],
    command: request.command || '', args: request.args || [], prompt: request.prompt || request.title };
  const incoming = next.edges.filter(e => e.target === target.id && e.kind !== 'loop');
  if (!incoming.length) throw new AppError(40901, 'Target has no spliceable forward dependencies');
  for (const e of incoming) e.target = node.id;
  const edge = { id: `ghost_edge_${nanoid(10)}`, source: node.id, target: target.id, kind: 'dep' };
  next.nodes.push(node); next.edges.push(edge);
  const issues = validatePlan(next, { capabilities });
  if (issues.some(i => !i.severity || i.severity === 'error')) throw new AppError(40002, 'Runtime graph patch rejected', issues);
  return { plan: next, node, edge, redirectedEdgeIds: incoming.map(e => e.id), diagnostics: issues };
}
