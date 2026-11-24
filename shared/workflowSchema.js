import { record, validateGoalSpec } from './goalSpecSchema.js';
export const CONTROLS = ['prepare', 'join', 'human', 'checkpoint', 'restore', 'gate', 'selfcheck', 'qa', 'ghost'];
export const isWorkflow = plan => plan?.workflow?.format === 'twin-1';
export const isForward = (plan, edge) => !isWorkflow(plan) || edge.kind !== 'loop';
export function workflowSchema(plan) {
  if (plan.workflow === undefined) return [];
  const w = plan.workflow, issues = [];
  const add = (message, nodeId = '') => issues.push({ rule: 'R6', code: 'WORKFLOW_SCHEMA', nodeId, severity: 'error', level: 1, message });
  if (!record(w) || w.format !== 'twin-1') { add('Unknown workflow format'); return issues; }
  issues.push(...validateGoalSpec(w.goalSpec));
  if (w.budgetUsd !== undefined && w.budgetUsd !== null && (!Number.isFinite(w.budgetUsd) || w.budgetUsd < 0)) add('Budget must be nonnegative');
  if (!['strict', 'supervised', 'turbo'].includes(w.permissionTier)) add('Unknown permission tier');
  if (!Number.isInteger(w.maxReworkIterations) || w.maxReworkIterations < 1 || w.maxReworkIterations > 20) add('Rework limit must be 1–20');
  if (!Array.isArray(w.groups) || w.groups.length > 200 || w.groups.some(g => !record(g) || typeof g.id !== 'string' || !['phase', 'task'].includes(g.kind) || typeof g.title !== 'string')) add('Invalid WBS containers');
  for (const n of plan.nodes || []) {
    if (!record(n?.props)) continue;
    const p = n.props;
    if (p.control !== undefined && (!CONTROLS.includes(p.control) || n.type !== 'task')) add('Invalid control role', n.id);
    if (p.executorKind !== undefined && !['agent', 'tool', 'human', 'control'].includes(p.executorKind)) add('Unknown executor kind', n.id);
    for (const field of ['requirementRefs', 'acceptanceRefs', 'fileScope']) if (!Array.isArray(p[field]) || p[field].some(x => typeof x !== 'string')) add(`Invalid ${field}`, n.id);
    for (const field of ['inputContract', 'outputContract']) if (!Array.isArray(p[field]) || p[field].some(x => !record(x) || typeof x.name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(x.name) || ['__proto__', 'constructor', 'prototype'].includes(x.name) || !['string', 'number', 'boolean', 'object', 'array', 'file', 'any'].includes(x.type) || typeof x.required !== 'boolean')) add(`Invalid ${field}`, n.id);
    if (typeof p.planningRationale !== 'string') add('Planning rationale must be text', n.id);
    if (p.args !== undefined && (!Array.isArray(p.args) || p.args.some(x => typeof x !== 'string'))) add('Command args must be strings', n.id);
  }
  for (const e of plan.edges || []) if (e.kind !== undefined && !['dep', 'pass', 'fail', 'loop'].includes(e.kind)) add('Unknown edge kind', e.source);
  return issues;
}
