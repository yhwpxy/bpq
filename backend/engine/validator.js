import { validatePlanSchema } from '../../shared/schema.js';
import { parseExpression } from './expression.js';
import { START_MAX_OUTGOING } from '../../shared/constants.js';

export function buildGraph(plan) {
  const nodes = new Map(plan.nodes.map(n => [n.id, n]));
  const incoming = new Map(plan.nodes.map(n => [n.id, []]));
  const outgoing = new Map(plan.nodes.map(n => [n.id, []]));
  for (const edge of plan.edges) {
    if (nodes.has(edge.source) && nodes.has(edge.target)) {
      outgoing.get(edge.source).push(edge); incoming.get(edge.target).push(edge);
    }
  }
  return { nodes, incoming, outgoing };
}

export function topologicalLevels(plan) {
  const { incoming, outgoing } = buildGraph(plan);
  const degree = new Map([...incoming].map(([id, edges]) => [id, edges.length]));
  const levels = new Map(plan.nodes.map(n => [n.id, 0]));
  const queue = plan.nodes.filter(n => degree.get(n.id) === 0).map(n => n.id);
  let visited = 0;
  while (queue.length) {
    const id = queue.shift(); visited++;
    for (const e of outgoing.get(id)) {
      levels.set(e.target, Math.max(levels.get(e.target), levels.get(id) + 1));
      degree.set(e.target, degree.get(e.target) - 1);
      if (degree.get(e.target) === 0) queue.push(e.target);
    }
  }
  if (visited !== plan.nodes.length) throw new Error('方案包含环，无法拓扑分层');
  return levels;
}

export function validatePlan(plan, { allowStartFanOut = START_MAX_OUTGOING > 1 } = {}) {
  const errors = validatePlanSchema(plan);
  if (errors.length) return errors.map(error => ({ ...error, rule: 'R6' }));
  const add = (nodeId, rule, message) => errors.push({ nodeId, rule, message });
  const { nodes, incoming, outgoing } = buildGraph(plan);
  for (const [kind, list] of [['节点', plan.nodes], ['边', plan.edges]]) {
    const seen = new Set();
    for (const item of list) { if (seen.has(item.id)) add(kind === '节点' ? item.id : item.source, 'R7', `${kind} ID 重复：${item.id}`); seen.add(item.id); }
  }
  const starts = plan.nodes.filter(n => n.type === 'start');
  const ends = plan.nodes.filter(n => n.type === 'end');
  if (starts.length !== 1) add(starts[0]?.id ?? '', 'R1', '方案必须恰有一个开始节点');
  if (ends.length !== 1) add(ends[0]?.id ?? '', 'R1', '方案必须恰有一个结束节点');
  for (const n of plan.nodes) {
    const ins = incoming.get(n.id); const outs = outgoing.get(n.id);
    if (n.type === 'start') {
      if (ins.length) add(n.id, 'R1', '开始节点不能有入边');
      if (allowStartFanOut ? outs.length < 1 : outs.length !== 1) add(n.id, 'R1', allowStartFanOut ? '开始节点至少有一条出边' : '开始节点必须恰有一条出边');
    } else if (!ins.length) add(n.id, 'R3', '非开始节点至少需要一条入边');
    if (n.type === 'end' && outs.length) add(n.id, 'R1', '结束节点不能有出边');
    if (n.type === 'delay' && !outs.length) add(n.id, 'R3', '延时节点至少需要一条出边');
    if (n.type === 'condition') {
      try { parseExpression(n.props.expression); } catch (error) { add(n.id, 'R6', `条件表达式：${error.message}`); }
    }
  }
  const pairs = new Set();
  for (const e of plan.edges) {
    if (!nodes.has(e.source) || !nodes.has(e.target)) { add(nodes.has(e.source) ? e.source : e.target, 'R8', `边 ${e.id} 引用了不存在的节点`); continue; }
    if (e.source === e.target) add(e.source, 'R5', '不允许节点连接自身');
    const pair = JSON.stringify([e.source, e.target]);
    if (pairs.has(pair)) add(e.source, 'R5', '不允许重复连接同一对节点');
    pairs.add(pair);
    if (nodes.get(e.source).type === 'end' || nodes.get(e.target).type === 'start') add(e.source, 'R5', '目标入端口或来源出端口不存在');
    if (nodes.get(e.source).type === 'condition' && !['true', 'false'].includes(e.label)) add(e.source, 'R5', '条件节点必须通过 true 或 false 端口连接');
  }
  const colors = new Map(); const stack = []; const reported = new Set();
  function dfs(id) {
    colors.set(id, 1); stack.push(id);
    for (const e of outgoing.get(id)) {
      if (colors.get(e.target) === 1) {
        const cycle = stack.slice(stack.indexOf(e.target));
        for (const nodeId of cycle) if (!reported.has(nodeId)) { reported.add(nodeId); add(nodeId, 'R2', `存在环：${[...cycle, e.target].join(' → ')}`); }
      } else if (!colors.get(e.target)) dfs(e.target);
    }
    stack.pop(); colors.set(id, 2);
  }
  for (const id of nodes.keys()) if (!colors.get(id)) dfs(id);
  function reachable(root, backwards = false) {
    const visited = new Set(); const queue = [root];
    while (queue.length) {
      const id = queue.shift(); if (visited.has(id)) continue; visited.add(id);
      for (const e of (backwards ? incoming : outgoing).get(id) ?? []) queue.push(backwards ? e.source : e.target);
    }
    return visited;
  }
  if (starts.length === 1 && ends.length === 1) {
    const fromStart = reachable(starts[0].id); const toEnd = reachable(ends[0].id, true);
    for (const n of plan.nodes) {
      if (!fromStart.has(n.id)) add(n.id, 'R3', '从开始节点无法到达此节点');
      if (!toEnd.has(n.id)) add(n.id, 'R3', '此节点无法到达结束节点');
    }
  }
  for (const n of plan.nodes.filter(n => n.type === 'condition')) {
    const edges = outgoing.get(n.id);
    if (edges.length !== 2 || edges.filter(e => e.label === 'true').length !== 1 || edges.filter(e => e.label === 'false').length !== 1) {
      add(n.id, 'R4', '条件节点必须恰有 true、false 各一条出边'); continue;
    }
    const a = reachable(edges[0].target); const b = reachable(edges[1].target);
    if (![...a].some(id => b.has(id) && incoming.get(id).length > 1)) add(n.id, 'R4', '条件的两个分支必须汇聚到同一汇聚节点');
  }
  return errors;
}
