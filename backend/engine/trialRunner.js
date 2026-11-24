import { validatePlan } from './validator.js';
import { nextFrontier, settleEdges } from './frontier.js';
import { rewindIds } from './graphSemantics.js';
import { evaluateExpression } from './expression.js';
import { graphDigest } from './changeImpact.js';
export function runTrial(plan, { capabilities, governance, failures = {} } = {}) {
  const diagnostics = validatePlan(plan, { capabilities, governance });
  const steps = [], states = Object.fromEntries(plan.nodes.map(n => [n.id, { status: 'PENDING', attempt: 0 }]));
  const report = { digest: graphDigest(plan), passed: false, dryRun: true, diagnostics, steps, nodeStates: states, reworkCount: 0, createdAt: new Date().toISOString() };
  if (diagnostics.some(i => !i.severity || i.severity === 'error')) return report;
  const edges = new Map(plan.edges.map(e => [e.id, 'pending']));
  const context = { variables: Object.create(null), outputs: Object.create(null) };
  const byId = new Map(plan.nodes.map(n => [n.id, n]));
  const trace = (node, status, note) => { states[node.id].status = status; steps.push({ nodeId: node.id, status, note, attempt: states[node.id].attempt, simulated: true }); };
  for (let wave = 0; wave < plan.nodes.length * ((plan.workflow?.maxReworkIterations || 1) + 3); wave++) {
    const f = nextFrontier(plan, states, edges);
    if (!f.ready.length && !f.skipped.length) break;
    for (const skip of f.skipped) { trace(byId.get(skip.id), 'SKIPPED', 'Inactive route'); settleEdges(plan, edges, byId.get(skip.id), skip.outcome); }
    for (const id of f.ready) {
      const n = byId.get(id), state = states[id]; state.attempt++;
      if (n.props.control === 'restore') {
        if (report.reworkCount >= plan.workflow.maxReworkIterations) { trace(n, 'WAITING_HUMAN', 'Rework budget exhausted'); return report; }
        report.reworkCount++;
        for (const reset of rewindIds(plan, n.props.restoreTarget)) { states[reset].status = 'PENDING'; for (const e of plan.edges.filter(e => e.source === reset)) edges.set(e.id, 'pending'); }
        trace(n, 'REWOUND', 'Simulated checkpoint restore; no files changed'); state.status = 'PENDING'; continue;
      }
      if (state.attempt <= (failures[id] || 0)) { trace(n, 'FAILED', 'Requested trial failure scenario'); settleEdges(plan, edges, n, 'failed'); continue; }
      if (n.props.control === 'human') trace(n, 'WAITING_HUMAN', 'Approval simulated in trial only');
      let branch;
      if (n.type === 'condition') {
        try { branch = String(evaluateExpression(n.props.expression, context)); }
        catch (e) { trace(n, 'FAILED', e.message); settleEdges(plan, edges, n, 'failed'); continue; }
      }
      if (n.props.output) { context.variables[n.props.output] = true; context.outputs[id] = { [n.props.output]: true }; }
      trace(n, 'SUCCESS', 'Simulated transition; executor not invoked'); settleEdges(plan, edges, n, 'active', branch);
    }
  }
  report.passed = plan.nodes.some(n => n.type === 'end' && states[n.id].status === 'SUCCESS') && !Object.values(states).some(s => s.status === 'FAILED');
  return report;
}
