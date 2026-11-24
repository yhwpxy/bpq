import { nanoid } from 'nanoid';
import { evaluateExpression, parseExpression } from './expression.js';
import { buildGraph, topologicalLevels, validatePlan } from './validator.js';
import { NODE_STATUS_COLORS } from '../../shared/constants.js';

/** Separate edge outcomes preserve inactive branches and upstream failure across joins. */
export function createRun(inputPlan, options = {}) {
  const plan = structuredClone(inputPlan);
  const errors = validatePlan(plan, options.validationOptions);
  if (errors.length) throw Object.assign(new Error('编排方案校验失败'), { code: 40002, details: errors });
  const { nodes, incoming, outgoing } = buildGraph(plan);
  const levels = topologicalLevels(plan);
  const ordered = [...plan.nodes].sort((a, b) => levels.get(a.id) - levels.get(b.id));
  const expressions = new Map(plan.nodes.filter(n => n.type === 'condition').map(n => [n.id, parseExpression(n.props.expression)]));
  const random = options.random ?? Math.random;
  const now = () => new Date().toISOString();
  const context = { variables: Object.create(null), outputs: Object.create(null) };
  const edgeStates = new Map(plan.edges.map(e => [e.id, 'pending']));
  const snapshot = {
    id: options.id ?? `run_${nanoid(10)}`, planId: plan.id, planName: plan.name,
    status: 'RUNNING', startedAt: now(), finishedAt: null,
    nodeStates: Object.fromEntries(plan.nodes.map(n => [n.id, { status: 'PENDING', attempt: 0 }])),
    logs: [], error: null, ...(options.versionId ? { versionId: options.versionId, versionTag: options.versionTag } : {}),
  };
  const abortController = new AbortController();
  let active = 0; let started = false; let finished = false; let pumping = false; let writeChain = Promise.resolve(); let resolved = false;
  let resolveDone; const done = new Promise(resolve => { resolveDone = resolve; });
  const limit = plan.meta?.maxConcurrency ?? 3;
  const log = (node, event, message) => snapshot.logs.push({ seq: snapshot.logs.length + 1, time: now(), nodeId: node.id, nodeName: node.props.name ?? ({ start: '开始', end: '结束', condition: '条件分支', delay: '延时' }[node.type] ?? node.type), event, message });
  function notify() {
    if (!options.onUpdate) return;
    const copy = structuredClone(snapshot);
    writeChain = writeChain.then(() => options.onUpdate(copy)).catch(error => failEngine(error, false));
  }
  function state(node, status, event, message, extra = {}, persist = true) {
    if (!Object.hasOwn(NODE_STATUS_COLORS, status)) throw new Error(`未知节点状态：${status}`);
    Object.assign(snapshot.nodeStates[node.id], { status, message }, extra);
    if (status === 'RUNNING' && !snapshot.nodeStates[node.id].startedAt) snapshot.nodeStates[node.id].startedAt = now();
    if (!['PENDING', 'RUNNING'].includes(status)) snapshot.nodeStates[node.id].finishedAt = now();
    log(node, event, message);
    if (persist) notify();
  }
  function resolveAfterWrites() {
    // A persistence failure may change SUCCESS to FAILED before resolving.
    writeChain.then(() => { if (!resolved) { resolved = true; resolveDone(structuredClone(snapshot)); } });
  }
  function finish(status) {
    if (finished) return;
    finished = true; snapshot.status = status; snapshot.finishedAt = now(); notify(); resolveAfterWrites();
  }
  function failEngine(error, persist = true) {
    if (snapshot.status === 'CANCELED') return;
    abortController.abort(); finished = true;
    snapshot.status = 'FAILED'; snapshot.error = `引擎异常：${error.message}`; snapshot.finishedAt = now();
    const unsettled = plan.nodes.filter(n => ['PENDING', 'RUNNING'].includes(snapshot.nodeStates[n.id].status));
    let failed = false;
    for (const n of unsettled) {
      const status = !failed && snapshot.nodeStates[n.id].status === 'RUNNING' ? 'FAILED' : 'CANCELED';
      if (status === 'FAILED') failed = true;
      state(n, status, status === 'FAILED' ? 'fail' : 'cancel', snapshot.error, {}, false);
    }
    if (!unsettled.length) log(plan.nodes[0], 'fail', snapshot.error);
    if (persist) notify();
    resolveAfterWrites();
  }
  function settleEdges(node, outcome, branch) {
    for (const edge of outgoing.get(node.id)) edgeStates.set(edge.id, node.type === 'condition' && outcome === 'active' ? (edge.label === branch ? 'active' : 'inactive') : outcome);
  }
  function wait(ms) {
    if (abortController.signal.aborted) return Promise.resolve();
    return new Promise(resolve => {
      const cleanup = () => { clearTimeout(timer); abortController.signal.removeEventListener('abort', cleanup); resolve(); };
      const timer = setTimeout(cleanup, ms);
      abortController.signal.addEventListener('abort', cleanup, { once: true });
    });
  }
  async function execute(node) {
    try {
      state(node, 'RUNNING', 'start', '开始执行', { attempt: 1 });
      if (node.type === 'task') {
        for (let attempt = 1; attempt <= node.props.retry + 1; attempt++) {
          snapshot.nodeStates[node.id].attempt = attempt;
          await wait(node.props.duration);
          if (finished) return;
          if (random() < node.props.failRate) {
            if (attempt <= node.props.retry) {
              const message = `第 ${attempt} 次尝试失败，${500 * attempt}ms 后重试`;
              snapshot.nodeStates[node.id].message = message; log(node, 'retry', message); notify();
              await wait(500 * attempt); if (finished) return;
              snapshot.nodeStates[node.id].attempt = attempt + 1;
              log(node, 'start', `开始第 ${attempt + 1} 次尝试`); notify();
            } else {
              state(node, 'FAILED', 'fail', `重试耗尽，共尝试 ${attempt} 次`); settleEdges(node, 'failed'); return;
            }
          } else {
            if (node.props.output) {
              const output = { [node.props.output]: true };
              context.variables[node.props.output] = true; context.outputs[node.id] = output;
              snapshot.nodeStates[node.id].output = output;
            }
            state(node, 'SUCCESS', 'success', '执行成功'); settleEdges(node, 'active'); return;
          }
        }
      } else if (node.type === 'delay') {
        await wait(node.props.wait); if (finished) return;
        state(node, 'SUCCESS', 'success', `等待 ${node.props.wait}ms 完成`); settleEdges(node, 'active');
      } else if (node.type === 'condition') {
        const branch = String(evaluateExpression(expressions.get(node.id), context));
        state(node, 'SUCCESS', 'success', `条件结果 ${branch}，激活 ${branch} 分支`); settleEdges(node, 'active', branch);
      } else {
        state(node, 'SUCCESS', 'success', node.type === 'start' ? '运行开始' : '到达结束节点'); settleEdges(node, 'active');
      }
    } catch (error) { failEngine(error); }
    finally { active--; if (!finished) pump(); }
  }
  function pump() {
    if (finished || pumping) return;
    pumping = true;
    try {
      let changed;
      do {
        changed = false;
        for (const node of ordered) {
          if (snapshot.nodeStates[node.id].status !== 'PENDING') continue;
          const ins = incoming.get(node.id).map(e => edgeStates.get(e.id));
          if (ins.includes('pending')) continue;
          const upstreamFailed = ins.includes('failed') && !plan.meta?.continueOnError;
          const inactive = ins.length > 0 && ins.every(s => s === 'inactive');
          if (upstreamFailed || inactive) {
            state(node, 'SKIPPED', 'skip', upstreamFailed ? '上游失败，跳过执行' : '条件分支未激活，跳过执行');
            settleEdges(node, upstreamFailed ? 'failed' : 'inactive'); changed = true; continue;
          }
          if (active < limit) { active++; changed = true; void execute(node); }
        }
      } while (changed && !finished);
      if (!active && !finished) {
        if (Object.values(snapshot.nodeStates).every(s => !['PENDING', 'RUNNING'].includes(s.status))) finish(Object.values(snapshot.nodeStates).some(s => s.status === 'FAILED') ? 'FAILED' : 'SUCCESS');
        else failEngine(new Error('调度停滞：没有可执行节点'));
      }
    } finally { pumping = false; }
  }
  function start() { if (started || finished) return; started = true; notify(); queueMicrotask(pump); }
  function cancel() {
    if (finished) return snapshot.status;
    finished = true; abortController.abort(); snapshot.status = 'CANCELED'; snapshot.finishedAt = now();
    for (const node of plan.nodes) if (['PENDING', 'RUNNING'].includes(snapshot.nodeStates[node.id].status)) state(node, 'CANCELED', 'cancel', '用户停止运行');
    notify(); resolveAfterWrites(); return 'CANCELED';
  }
  if (options.autoStart !== false) start();
  return { snapshot, done, cancel, start, context };
}
