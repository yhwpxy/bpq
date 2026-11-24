import { aggregateUsage } from './usageMeter.js';
import { nanoid } from 'nanoid';
import { evaluateExpression, parseExpression } from './expression.js';
import { buildGraph, topologicalLevels, validatePlan } from './validator.js';
import { NODE_STATUS_COLORS } from '../../shared/constants.js';
import { isWorkflow } from '../../shared/workflowSchema.js';
import { nextFrontier, settleEdges as resolveEdges } from './frontier.js';
import { spliceGhost } from './runGraphPatch.js';
import { downstream } from './graphSemantics.js';

/** Legacy simulation and typed workflows share one scheduler and edge-state machine. */
export function createRun(inputPlan, options = {}) {
  let plan = structuredClone(options.initialSnapshot?.graph || inputPlan);
  const errors = validatePlan(plan, options.validationOptions).filter(i => !i.severity || i.severity === 'error');
  if (errors.length) throw Object.assign(new Error('编排方案校验失败'), { code: 40002, details: errors });
  let graph = buildGraph(plan), levels = topologicalLevels(plan);
  let ordered = [...plan.nodes].sort((a, b) => levels.get(a.id) - levels.get(b.id));
  let expressions = new Map(plan.nodes.filter(n => n.type === 'condition').map(n => [n.id, parseExpression(n.props.expression)]));
  const random = options.random ?? Math.random, now = () => new Date().toISOString();
  const initial = options.initialSnapshot;
  const context = { variables: Object.assign(Object.create(null), options.inputs, initial?.runtime?.variables), outputs: Object.assign(Object.create(null), initial?.runtime?.outputs) };
  const edgeStates = new Map(plan.edges.map(e => [e.id, initial?.runtime?.edgeStates?.[e.id] || 'pending']));
  const snapshot = initial ? structuredClone(initial) : {
    id: options.id ?? `run_${nanoid(10)}`, planId: plan.id, planName: plan.name,
    status: 'RUNNING', startedAt: now(), finishedAt: null,
    nodeStates: Object.fromEntries(plan.nodes.map(n => [n.id, { status: 'PENDING', attempt: 0 }])),
    logs: [], error: null, advanced: isWorkflow(plan), attempts: [], interventions: [], checkpoints: [], reworkCount: 0,
    workspaceHandle: options.workspaceHandle || null, approved: false,
    mode: !isWorkflow(plan) || plan.nodes.some(n => n.props.capabilityId === 'simulated') ? 'simulation' : 'live',
    ...(options.versionId ? { versionId: options.versionId, versionTag: options.versionTag } : {}),
  };
  snapshot.sessions ||= [];
  snapshot.certifications ||= [];
  snapshot.attempts ||= []; snapshot.interventions ||= []; snapshot.checkpoints ||= [];
  let abortController = new AbortController();
  let active = 0, started = false, finished = false, pumping = false, paused = false, draining = false, generation = 0;
  let writeChain = Promise.resolve(), resolved = false, resolveDone;
  const done = new Promise(resolve => { resolveDone = resolve; });
  const idleWaiters = [];
  const inFlight = new Set(), limit = plan.meta?.maxConcurrency ?? 3;
  const unsettled = s => ['PENDING', 'READY', 'RUNNING', 'WAITING_HUMAN', 'REWOUND'].includes(s);
  function log(node, event, message, extra = {}) {
    snapshot.logs.push({ seq: (snapshot.logs.at(-1)?.seq || 0) + 1, time: now(), nodeId: node.id, nodeName: node.props.name ?? ({ start: '开始', end: '结束', condition: '条件分支', delay: '延时' }[node.type] ?? node.type), event, message, runId: snapshot.id, planId: snapshot.planId, versionId: snapshot.versionId || null, attempt: snapshot.nodeStates[node.id]?.attempt || 0, actor: ['approve', 'reject', 'override', 'pause', 'resume', 'ghost'].includes(event) ? 'local-user' : 'engine', ...extra });
  }
  function notify() {
    snapshot.graph = structuredClone(plan);
    snapshot.runtime = { variables: { ...context.variables }, outputs: structuredClone(context.outputs), edgeStates: Object.fromEntries(edgeStates) };
    snapshot.usage = aggregateUsage(snapshot.attempts, plan.workflow?.budgetUsd ?? null);
    snapshot.resources = options.broker?.snapshot() || { maxWorkers: limit, activeWorkers: active, queued: 0 };
    if (!options.onUpdate) return;
    const copy = structuredClone(snapshot);
    writeChain = writeChain.then(() => options.onUpdate(copy)).catch(error => failEngine(error, false));
  }
  function state(node, status, event, message, extra = {}, persist = true) {
    if (!Object.hasOwn(NODE_STATUS_COLORS, status)) throw new Error(`未知节点状态：${status}`);
    Object.assign(snapshot.nodeStates[node.id], { status, message }, extra);
    if (status === 'RUNNING' && !snapshot.nodeStates[node.id].startedAt) snapshot.nodeStates[node.id].startedAt = now();
    if (!unsettled(status)) snapshot.nodeStates[node.id].finishedAt = now();
    else delete snapshot.nodeStates[node.id].finishedAt;
    log(node, event, message);
    if (persist) notify();
  }
  function resolveAfterWrites() { writeChain.then(() => { if (!resolved && active === 0) { resolved = true; resolveDone(structuredClone(snapshot)); } }); }
  function finish(status) { if (finished) return; finished = true; snapshot.status = status; snapshot.finishedAt = now(); log(plan.nodes[0], 'run', `运行结束：${status}`, { status }); notify(); resolveAfterWrites(); }
  function failEngine(error, persist = true) {
    if (snapshot.status === 'CANCELED') return;
    generation++; abortController.abort(); finished = true;
    snapshot.status = 'FAILED'; snapshot.error = `引擎异常：${error.message}`; snapshot.finishedAt = now();
    for (const attempt of snapshot.attempts) if (attempt.status === 'RUNNING') endAttempt(attempt, 'FAILED', snapshot.error);
    const pending = plan.nodes.filter(n => unsettled(snapshot.nodeStates[n.id].status)); let failed = false;
    for (const n of pending) { const status = !failed && snapshot.nodeStates[n.id].status === 'RUNNING' ? 'FAILED' : 'CANCELED'; if (status === 'FAILED') failed = true; state(n, status, status === 'FAILED' ? 'fail' : 'cancel', snapshot.error, {}, false); }
    if (!pending.length) log(plan.nodes[0], 'fail', snapshot.error);
    if (persist) notify(); resolveAfterWrites();
  }
  const settleEdges = (node, outcome, branch) => resolveEdges(plan, edgeStates, node, outcome, branch);
  function wait(ms, signal = abortController.signal) {
    if (signal.aborted) return Promise.resolve();
    return new Promise(resolve => {
      const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', cleanup); resolve(); };
      const timer = setTimeout(cleanup, ms); signal.addEventListener('abort', cleanup, { once: true });
    });
  }
  function recordAttempt(node) {
    const number = (snapshot.nodeStates[node.id].attempt || 0) + 1;
    const attempt = { id: `attempt_${nanoid(10)}`, nodeId: node.id, number, capabilityKind: node.props.executorKind || 'tool', capabilityId: node.props.capabilityId || '', status: 'RUNNING', startedAt: now(), finishedAt: null, input: { preview: JSON.stringify(context.outputs).slice(0, 12000), contract: node.props.inputContract || [] }, output: null };
    if (['tool', 'agent'].includes(node.props.executorKind) || ['gate', 'qa'].includes(node.props.control)) {
      attempt.sessionId = `session_${nanoid(10)}`;
      snapshot.sessions.push({ id: attempt.sessionId, nodeId: node.id, attemptId: attempt.id, capabilityId: node.props.capabilityId || 'local-tool', status: 'RUNNING', startedAt: now(), messages: [], bytes: 0 });
    }
    snapshot.attempts.push(attempt); state(node, 'RUNNING', 'start', number === 1 ? '开始执行' : `开始第 ${number} 次尝试`, { attempt: number }); return attempt;
  }
  const endAttempt = (attempt, status, output) => {
    Object.assign(attempt, { status, output: output ?? null, finishedAt: now() });
    const session = snapshot.sessions.find(s => s.id === attempt.sessionId);
    if (session) { session.status = status; session.finishedAt = now(); }
  };
  async function execute(node) {
    const epoch = generation, signal = abortController.signal;
    const current = () => !finished && epoch === generation && !signal.aborted;
    let release, attempt;
    const onChunk = (role, content) => {
      if (!current() || !attempt?.sessionId) return;
      const session = snapshot.sessions.find(s => s.id === attempt.sessionId);
      if (session.messages.length >= 2000 || session.bytes >= 2097152) { session.truncated = true; return; }
      const text = String(content).slice(0, 24000); session.bytes += Buffer.byteLength(text);
      const message = { seq: session.messages.length + 1, role, content: text, time: now() }; session.messages.push(message);
      log(node, 'chunk', text.slice(0, 600), { sessionId: session.id, messageSeq: message.seq, role }); notify();
    };
    try {
      const isWorker = node.type === 'task' && (!node.props.control || ['gate', 'qa', 'ghost'].includes(node.props.control));
      if (options.broker && isWorker) { state(node, 'READY', 'ready', '等待可用资源槽'); release = await options.broker.acquire({ signal, priority: node.props.priority === 'human' }); if (!current()) return; }
      attempt = recordAttempt(node);
      if (node.type === 'task' && node.props.control === 'human') {
        const intervention = { id: `human_${nanoid(10)}`, nodeId: node.id, status: 'open', question: node.props.name, createdAt: now() };
        snapshot.interventions.push(intervention); state(node, 'WAITING_HUMAN', 'waiting_human', '等待人工决定'); snapshot.status = 'WAITING_HUMAN'; notify(); return;
      }
      if (node.type === 'task' && node.props.control && node.props.control !== 'ghost') {
        if (node.props.control === 'restore' && snapshot.reworkCount >= plan.workflow.maxReworkIterations + (snapshot.extraReworkAllowance || 0)) {
          snapshot.interventions.push({ id: `human_${nanoid(10)}`, kind: 'rework_limit', nodeId: node.id, status: 'open', question: '返工额度已用尽：授权额外一次或拒绝停止', createdAt: now() });
          state(node, 'WAITING_HUMAN', 'waiting_human', '返工额度已用尽'); snapshot.status = 'WAITING_HUMAN'; notify(); return;
        }
        const result = await options.executeControl?.(node, { context, snapshot, signal, attempt: attempt.number, onChunk });
        if (!current()) return;
        if (!result) throw new Error(`Control ${node.props.control} is not available`);
        if (result.checkpoint) {
          snapshot.checkpoints.push({ ...result.checkpoint, kind: 'checkpoint', engine: captureEngine() });
          log(node, 'checkpoint', result.checkpoint.ref, { checkpointId: result.checkpoint.id, sha: result.checkpoint.sha });
        }
        if (result.restoration) {
          endAttempt(attempt, 'SUCCESS', result.restoration.rescue.ref);
          applyRestoration(result.restoration, result.checkpointTarget, true);
          log(node, 'restore', `有界返工 ${snapshot.reworkCount}，保留 ${result.restoration.rescue.ref}`, { rescueRef: result.restoration.rescue.ref });
          notify(); return;
        }
        if (result.certification) snapshot.certifications.push({ nodeId: node.id, attempt: attempt.number, createdAt: now(), ...result.certification });
        if (result.outcome !== 'completed') { endAttempt(attempt, 'FAILED', result); state(node, 'FAILED', 'fail', result.output || '验证未通过'); settleEdges(node, 'failed'); return; }
        endAttempt(attempt, 'SUCCESS', result); state(node, 'SUCCESS', 'success', result.output || '控制步骤完成'); settleEdges(node, 'active'); return;
      }
      if (node.type === 'task') {
        for (let retry = 0; retry <= node.props.retry; retry++) {
          if (retry > 0) attempt = recordAttempt(node);
          let result;
          if (isWorkflow(plan) && node.props.capabilityId !== 'simulated') result = await options.executeTask(node, { context, snapshot, signal, attempt: attempt.number, onChunk });
          else { await wait(node.props.duration, signal); if (!current()) return; result = { outcome: random() < node.props.failRate ? 'task_failure' : 'completed', output: '执行成功', mode: 'simulation' }; }
          if (!current()) return;
          if (result.outcome !== 'completed') {
            endAttempt(attempt, 'FAILED', result);
            if (retry < node.props.retry) { const delay = 500 * (retry + 1); const message = `第 ${retry + 1} 次尝试失败，${delay}ms 后重试`; snapshot.nodeStates[node.id].message = message; log(node, 'retry', message); notify(); await wait(delay, signal); if (!current()) return; }
            else { state(node, 'FAILED', 'fail', `重试耗尽，共尝试 ${retry + 1} 次${result.output ? `：${result.output}` : ''}`); settleEdges(node, 'failed'); return; }
          } else {
            const output = result.values || (node.props.output ? { [node.props.output]: true } : undefined);
            if (output) { Object.assign(context.variables, output); context.outputs[node.id] = output; snapshot.nodeStates[node.id].output = output; }
            endAttempt(attempt, 'SUCCESS', result); state(node, 'SUCCESS', 'success', result.output || '执行成功'); settleEdges(node, 'active'); return;
          }
        }
      } else if (node.type === 'delay') {
        await wait(node.props.wait, signal); if (!current()) return; endAttempt(attempt, 'SUCCESS'); state(node, 'SUCCESS', 'success', `等待 ${node.props.wait}ms 完成`); settleEdges(node, 'active');
      } else if (node.type === 'condition') {
        const branch = String(evaluateExpression(expressions.get(node.id), context)); endAttempt(attempt, 'SUCCESS', branch); state(node, 'SUCCESS', 'success', `条件结果 ${branch}，激活 ${branch} 分支`); settleEdges(node, 'active', branch);
      } else { endAttempt(attempt, 'SUCCESS'); state(node, 'SUCCESS', 'success', node.type === 'start' ? '运行开始' : '到达结束节点'); settleEdges(node, 'active'); }
    } catch (error) {
      if (!current()) return;
      if (attempt) endAttempt(attempt, 'FAILED', error.message);
      if (isWorkflow(plan)) { state(node, 'FAILED', 'fail', error.message); settleEdges(node, 'failed'); }
      else failEngine(error);
    } finally {
      if (!current() && attempt?.status === 'RUNNING') endAttempt(attempt, 'CANCELED', 'Interrupted attempt');
      release?.(); active--; inFlight.delete(node.id); if (active === 0) { draining = false; idleWaiters.splice(0).forEach(resolve => resolve()); }
      if (!finished) { notify(); pump(); } else resolveAfterWrites();
    }
  }
  function pump() {
    if (finished || pumping || paused || (draining && active > 0)) return;
    if (snapshot.interventions.some(i => i.status === 'open')) { snapshot.status = 'WAITING_HUMAN'; notify(); return; }
    pumping = true;
    try {
      let changed;
      do {
        changed = false;
        const frontier = nextFrontier(plan, snapshot.nodeStates, edgeStates);
        for (const skip of frontier.skipped) { const node = graph.nodes.get(skip.id); state(node, 'SKIPPED', 'skip', skip.outcome === 'failed' ? '上游失败，跳过执行' : '条件分支未激活，跳过执行'); settleEdges(node, skip.outcome); changed = true; }
        if ([...inFlight].some(id => ['checkpoint', 'restore'].includes(graph.nodes.get(id)?.props.control))) break;
        for (const node of ordered) {
          if (!frontier.ready.includes(node.id) || inFlight.has(node.id) || snapshot.nodeStates[node.id].status !== 'PENDING') continue;
          if (active >= limit) continue;
          if (['checkpoint', 'restore'].includes(node.props.control) && active > 0) continue;
          active++; inFlight.add(node.id); changed = true; void execute(node);
          if (['checkpoint', 'restore', 'human'].includes(node.props.control)) break;
        }
      } while (changed && !finished && !paused && snapshot.status !== 'WAITING_HUMAN');
      if (!active && !finished && !paused && snapshot.status !== 'WAITING_HUMAN') {
        if (Object.values(snapshot.nodeStates).every(s => !unsettled(s.status))) finish(Object.values(snapshot.nodeStates).some(s => s.status === 'FAILED') ? 'FAILED' : 'SUCCESS');
        else failEngine(new Error('调度停滞：没有可执行节点'));
      }
    } finally { pumping = false; }
  }
  function start() { if (started || finished) return; started = true; snapshot.status = 'RUNNING'; notify(); queueMicrotask(pump); }
  function cancel() {
    if (finished) return snapshot.status;
    generation++; abortController.abort();
    for (const attempt of snapshot.attempts) if (attempt.status === 'RUNNING') endAttempt(attempt, 'CANCELED', 'Cancelled');
    for (const node of plan.nodes) if (unsettled(snapshot.nodeStates[node.id].status)) state(node, 'CANCELED', 'cancel', '用户停止运行');
    for (const i of snapshot.interventions) if (i.status === 'open') i.status = 'cancelled';
    finish('CANCELED'); return 'CANCELED';
  }
  function pause() {
    if (finished || paused) return snapshot.status;
    paused = true; draining = active > 0; generation++; abortController.abort(); snapshot.status = 'PAUSED';
    for (const attempt of snapshot.attempts) if (attempt.status === 'RUNNING') endAttempt(attempt, 'CANCELED', 'Paused');
    for (const n of plan.nodes) if (['READY', 'RUNNING'].includes(snapshot.nodeStates[n.id].status)) state(n, 'PENDING', 'pause', '暂停，保留此前结果');
    log(plan.nodes[0], 'pause', '运行暂停'); notify(); return snapshot.status;
  }
  function resume() {
    if (finished) throw Object.assign(new Error('已结束运行不能直接恢复，请选择失败节点重试'), { code: 40901 });
    if (!paused) return snapshot.status;
    paused = false; abortController = new AbortController(); snapshot.status = 'RUNNING'; log(plan.nodes[0], 'resume', '运行恢复'); notify(); queueMicrotask(pump); return snapshot.status;
  }
  function resolveHuman(id, action, reason) {
    if (!['approve', 'reject', 'override'].includes(action) || typeof reason !== 'string' || !reason.trim()) throw Object.assign(new Error('人工决定与理由必填'), { code: 40001 });
    const item = snapshot.interventions.find(i => i.id === id);
    if (!item) throw Object.assign(new Error('人工待办不存在'), { code: 40401 });
    if (item.status !== 'open') { if (item.action === action && item.reason === reason) return; throw Object.assign(new Error('人工待办已处理'), { code: 40901 }); }
    if (item.kind === 'rework_limit' && action === 'override') throw Object.assign(new Error('返工额度只能显式追加一次或拒绝'), { code: 40001 });
    item.status = 'resolved'; item.action = action; item.reason = reason; item.resolvedAt = now();
    if (item.kind === 'rework_limit' && action === 'approve') {
      snapshot.extraReworkAllowance = (snapshot.extraReworkAllowance || 0) + 1;
      const n = graph.nodes.get(item.nodeId), a = snapshot.attempts.filter(x => x.nodeId === n.id).at(-1);
      if (a) endAttempt(a, 'WAIVED', reason);
      state(n, 'PENDING', 'approve', `人工追加一次返工额度：${reason}`);
      if (!paused) snapshot.status = 'RUNNING'; notify(); queueMicrotask(pump); return;
    }
    const node = graph.nodes.get(item.nodeId), status = action === 'reject' ? 'FAILED' : action === 'override' ? 'WAIVED' : 'SUCCESS';
    const attempt = snapshot.attempts.filter(a => a.nodeId === node.id).at(-1); if (attempt) endAttempt(attempt, status, reason);
    state(node, status, action, reason); settleEdges(node, action === 'reject' ? 'failed' : 'active');
    if (action === 'reject') { generation++; abortController.abort(); for (const n of plan.nodes) if (unsettled(snapshot.nodeStates[n.id].status)) state(n, 'CANCELED', 'cancel', '人工拒绝，停止后续任务'); finish('FAILED'); }
    else { snapshot.approved = true; if (!paused) snapshot.status = 'RUNNING'; notify(); queueMicrotask(pump); }
  }
  function retry(nodeId) {
    if (active || snapshot.interventions.some(i => i.status === 'open')) throw Object.assign(new Error('请等待活动任务或人工待办结束'), { code: 40901 });
    const targets = nodeId ? [nodeId] : plan.nodes.filter(n => snapshot.nodeStates[n.id].status === 'FAILED').map(n => n.id);
    if (!targets.length || targets.some(id => snapshot.nodeStates[id]?.status !== 'FAILED')) throw Object.assign(new Error('只能重试失败节点'), { code: 40901 });
    const reset = downstream(plan, targets);
    for (const n of plan.nodes) if (reset.has(n.id)) { snapshot.nodeStates[n.id].status = 'PENDING'; delete snapshot.nodeStates[n.id].output; delete snapshot.nodeStates[n.id].finishedAt; delete context.outputs[n.id]; for (const e of plan.edges.filter(e => e.source === n.id)) edgeStates.set(e.id, 'pending'); }
    context.variables = Object.assign(Object.create(null), ...Object.values(context.outputs));
    finished = false; paused = false; started = true; generation++; abortController = new AbortController(); snapshot.status = 'RUNNING'; snapshot.finishedAt = null; snapshot.error = null;
    log(graph.nodes.get(targets[0]), 'retry', '人工重试失败节点，保留历史尝试'); notify(); queueMicrotask(pump);
  }

  function captureEngine() {
    return { nodeStates: structuredClone(snapshot.nodeStates), variables: { ...context.variables }, outputs: structuredClone(context.outputs), edgeStates: Object.fromEntries(edgeStates), approved: snapshot.approved };
  }
  function applyRestoration(result, checkpoint, automatic) {
    const saved = checkpoint.engine;
    if (!saved) throw Object.assign(new Error('检查点缺少引擎状态'), { code: 40901 });
    snapshot.checkpoints.push({ ...result.rescue, nodeId: checkpoint.nodeId, kind: 'rescue', engine: captureEngine(), preservedPath: result.preservedPath });
    snapshot.workspaceHandle = result.handle;
    for (const n of plan.nodes) {
      const previous = snapshot.nodeStates[n.id], restored = saved.nodeStates[n.id];
      snapshot.nodeStates[n.id] = { ...(restored || { status: 'PENDING' }), attempt: previous?.attempt || 0 };
      if (n.id === checkpoint.nodeId || ['RUNNING', 'READY', 'REWOUND', 'WAITING_HUMAN'].includes(snapshot.nodeStates[n.id].status)) snapshot.nodeStates[n.id].status = 'PENDING';
    }
    for (const e of plan.edges) edgeStates.set(e.id, saved.edgeStates[e.id] || 'pending');
    context.variables = Object.assign(Object.create(null), saved.variables); context.outputs = Object.assign(Object.create(null), structuredClone(saved.outputs));
    snapshot.approved = saved.approved; snapshot.error = null; snapshot.finishedAt = null;
    if (automatic) snapshot.reworkCount++; else snapshot.manualRestoreCount = (snapshot.manualRestoreCount || 0) + 1;
    for (const i of snapshot.interventions) if (i.status === 'open') { i.status = 'cancelled'; i.reason = 'Checkpoint restored'; }
  }
  async function restoreCheckpoint(id) {
    const checkpoint = snapshot.checkpoints.find(c => c.id === id && c.kind === 'checkpoint');
    if (!checkpoint?.engine) throw Object.assign(new Error('请选择当前运行的可恢复检查点'), { code: 40001 });
    pause(); await idle();
    const result = await options.restoreCheckpoint(checkpoint, snapshot);
    applyRestoration(result, checkpoint, false);
    generation++; abortController = new AbortController(); paused = false; finished = false; started = true; snapshot.status = 'RUNNING';
    log(graph.nodes.get(checkpoint.nodeId), 'restore', `人工恢复检查点，保留 ${result.rescue.ref}`, { checkpointId: id, rescueRef: result.rescue.ref }); notify(); queueMicrotask(pump);
  }
  function insertGhost(request, capabilities) {
    if (finished) throw Object.assign(new Error('已结束运行不能插入任务'), { code: 40901 });
    const patch = spliceGhost(plan, snapshot.nodeStates, request, capabilities);
    plan = patch.plan; graph = buildGraph(plan); levels = topologicalLevels(plan); ordered = [...plan.nodes].sort((a, b) => levels.get(a.id) - levels.get(b.id));
    expressions = new Map(plan.nodes.filter(n => n.type === 'condition').map(n => [n.id, parseExpression(n.props.expression)]));
    snapshot.nodeStates[patch.node.id] = { status: 'PENDING', attempt: 0 }; edgeStates.set(patch.edge.id, 'pending');
    snapshot.graphRevision = (snapshot.graphRevision || 0) + 1;
    if (patch.node.props.capabilityId === 'simulated' && snapshot.mode === 'live') snapshot.mode = 'mixed';
    log(patch.node, 'ghost', request.reason, { targetId: request.targetId, redirectedEdgeIds: patch.redirectedEdgeIds, addedEdgeId: patch.edge.id }); notify(); queueMicrotask(pump);
    return patch.node.id;
  }
  function idle() { return active === 0 ? Promise.resolve() : new Promise(resolve => idleWaiters.push(resolve)); }

  function drain() { return writeChain; }
  notify();
  if (options.autoStart !== false) start();
  return { snapshot, done, cancel, start, context, pause, resume, resolveHuman, retry, drain, idle, insertGhost, restoreCheckpoint };
}
