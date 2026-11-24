import path from 'node:path';
import { nanoid } from 'nanoid';
import { createRun } from '../engine/scheduler.js';
import { ResourceBroker } from '../engine/resourceBroker.js';
import { validatePlan } from '../engine/validator.js';
import { isWorkflow } from '../../shared/workflowSchema.js';
import { NODE_STATUS_COLORS } from '../../shared/constants.js';
import { matchesScope } from '../sandbox/pathPolicy.js';
import { AppError, assertSafeId } from './errors.js';
import { atomicWrite, readJson, withLock } from './storage.js';
const ACTIVE = ['RUNNING', 'VALIDATING', 'PAUSED', 'WAITING_HUMAN'];
const EVENTS = ['start', 'success', 'fail', 'retry', 'skip', 'cancel', 'ready', 'pause', 'resume', 'waiting_human', 'approve', 'reject', 'override', 'checkpoint', 'restore', 'ghost', 'chunk'];
function validateRun(run) {
  const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
  const date = x => typeof x === 'string' && Number.isFinite(Date.parse(x));
  if (!object(run) || typeof run.id !== 'string' || typeof run.planId !== 'string' || typeof run.planName !== 'string'
    || !['IDLE', ...ACTIVE, 'SUCCESS', 'FAILED', 'CANCELED'].includes(run.status)
    || !date(run.startedAt) || (run.finishedAt !== null && !date(run.finishedAt)) || !object(run.nodeStates) || !Array.isArray(run.logs)
    || (run.error !== null && typeof run.error !== 'string')) throw new AppError(50000, '运行快照结构损坏，无法读取');
  for (const state of Object.values(run.nodeStates)) if (!object(state) || !Object.hasOwn(NODE_STATUS_COLORS, state.status) || !Number.isInteger(state.attempt) || state.attempt < 0) throw new AppError(50000, '节点运行快照结构损坏');
  let last = 0;
  for (const log of run.logs) { if (!object(log) || !Number.isInteger(log.seq) || log.seq <= last || !date(log.time) || typeof log.nodeId !== 'string' || typeof log.nodeName !== 'string' || typeof log.message !== 'string' || !EVENTS.includes(log.event)) throw new AppError(50000, '运行日志结构损坏'); last = log.seq; }
  return run;
}
export function createRunService(storageDir, planService, options = {}) {
  const directory = path.resolve(storageDir, 'runs');
  const activeByPlan = new Map(), controllers = new Map(), finishedCache = new Map();
  const broker = options.broker || new ResourceBroker(4);
  const file = id => path.join(directory, `${assertSafeId(id, 40402)}.json`);
  const lock = id => `${directory}:plan:${id}`;
  async function executeTask(node, { context, snapshot, signal, attempt }) {
    const handle = snapshot.workspaceHandle;
    const result = await options.capabilityService.invoke(node.props.capabilityId, {
      cwd: handle.cwd, title: node.props.name, prompt: `${node.props.prompt || node.props.name}\nUpstream results: ${JSON.stringify(context.outputs).slice(0, 12000)}`,
      fileScope: node.props.fileScope, command: node.props.command, args: node.props.args, timeoutMs: node.props.timeoutMs || 60000,
      permissionTier: snapshot.graph.workflow.permissionTier, approved: snapshot.approved, signal,
      extraEnv: { VTO_ATTEMPT: String(attempt), VTO_RUN_ID: snapshot.id },
    });
    if (result.outcome !== 'completed') return result;
    if (!result.files?.length) result.files = (await options.workspaceService.diff(handle)).files.filter(f => matchesScope(f, node.props.fileScope));
    let parsed; try { parsed = JSON.parse(result.output); } catch {}
    const values = {};
    for (const c of node.props.outputContract) {
      if (parsed && typeof parsed === 'object' && Object.hasOwn(parsed, c.name)) values[c.name] = parsed[c.name];
      else if (c.type === 'object') values[c.name] = { summary: result.output, files: result.files };
      else if (c.type === 'string' || c.type === 'any') values[c.name] = result.output;
      else if (c.type === 'file' && result.files.length) values[c.name] = result.files[0];
      else if (c.type === 'array') values[c.name] = result.files;
      else if (typeof parsed === c.type) values[c.name] = parsed;
      else if (c.required) return { outcome: 'task_failure', output: `Missing typed output ${c.name}` };
    }
    return { ...result, values };
  }
  async function executeControl(node, env) {
    const { snapshot, signal, attempt } = env, handle = snapshot.workspaceHandle;
    switch (node.props.control) {
      case 'prepare': case 'join': return { outcome: 'completed', output: '契约/汇合控制完成' };
      case 'checkpoint': return { outcome: 'completed', output: '已保存独立 Git 检查点', checkpoint: { ...await options.workspaceService.checkpoint(handle, node.props.name), nodeId: node.id } };
      case 'gate': {
        const r = await options.capabilityService.invoke('local-tool', { cwd: handle.cwd, command: node.props.command, args: node.props.args, signal, timeoutMs: node.props.timeoutMs || 60000, permissionTier: snapshot.graph.workflow.permissionTier, approved: snapshot.approved, extraEnv: { VTO_ATTEMPT: String(attempt), VTO_RUN_ID: snapshot.id } });
        return { ...r, output: `${node.props.demonstrationGate ? '[演示门禁，仅验证编排链路] ' : ''}${r.output}` };
      }
      case 'restore': {
        const cp = snapshot.checkpoints.filter(c => c.nodeId === node.props.restoreTarget && c.kind === 'checkpoint').at(-1);
        if (!cp?.engine) return { outcome: 'task_failure', output: '恢复检查点不存在' };
        return { outcome: 'completed', restoration: await options.workspaceService.restore(handle, cp), checkpointTarget: cp };
      }
      case 'selfcheck': { const diff = await options.workspaceService.diff(handle); return { outcome: 'completed', output: `Diff: ${diff.files.length} files`, diff }; }
      default: return { outcome: 'task_failure', output: `Control ${node.props.control} is not enabled yet` };
    }
  }
  async function makeController(plan, id, version, workspaceHandle, initialSnapshot, inputs) {
    return createRun(plan, {
      ...options, id, autoStart: false, broker, initialSnapshot, workspaceHandle, inputs,
      versionId: version?.id || initialSnapshot?.versionId, versionTag: version?.tag || initialSnapshot?.versionTag,
      validationOptions: { ...options.validationOptions, capabilities: await options.capabilityService?.list() },
      executeTask, executeControl, restoreCheckpoint: (cp, snapshot) => options.workspaceService.restore(snapshot.workspaceHandle, cp), onUpdate: snapshot => atomicWrite(file(snapshot.id), snapshot),
    });
  }
  function track(controller) {
    const { id, planId } = controller.snapshot;
    activeByPlan.set(planId, id); controllers.set(id, controller); finishedCache.delete(id);
    controller.done.then(snapshot => {
      finishedCache.set(id, snapshot); if (finishedCache.size > 50) finishedCache.delete(finishedCache.keys().next().value);
      if (activeByPlan.get(planId) === id) activeByPlan.delete(planId);
      if (controllers.get(id) === controller) controllers.delete(id);
    });
  }
  async function execute(planId, request = {}) {
    assertSafeId(planId);
    return withLock(lock(planId), async () => {
      if (activeByPlan.has(planId)) throw new AppError(40901, '方案正在执行中');
      const version = options.versionService ? await options.versionService.forExecution(planId, request?.versionId) : null;
      const plan = version?.plan ?? await planService.get(planId);
      const capabilities = await options.capabilityService?.list();
      const errors = validatePlan(plan, { capabilities }).filter(i => !i.severity || i.severity === 'error');
      if (errors.length) throw new AppError(40002, '编排方案校验失败', errors);
      const id = `run_${nanoid(10)}`; let workspaceHandle;
      if (isWorkflow(plan)) {
        if (!request.authorized) throw new AppError(40101, '完整工作流执行需要本机会话授权');
        const workspaceId = request.workspaceId || plan.workflow.workspaceId || (await options.workspaceService.demo()).id;
        workspaceHandle = await options.workspaceService.provision(workspaceId, id);
      }
      const controller = await makeController(plan, id, version, workspaceHandle, null, request.inputs);
      await controller.drain(); await atomicWrite(file(id), controller.snapshot); track(controller); controller.start(); return { runId: id };
    });
  }
  async function get(runId, since) {
    assertSafeId(runId, 40402);
    if (since !== undefined && (!Number.isSafeInteger(since) || since < 0)) throw new AppError(40001, 'since 必须是非负整数');
    const controller = controllers.get(runId);
    if (controller && !ACTIVE.includes(controller.snapshot.status)) await controller.done;
    let run = controller?.snapshot ?? finishedCache.get(runId);
    if (!run) {
      run = validateRun(await readJson(file(runId), { missingCode: 40402 }));
      if (ACTIVE.includes(run.status)) {
        run.status = 'FAILED'; run.finishedAt = new Date().toISOString(); run.error = '服务重启，运行已中断；不会自动重放外部动作';
        for (const [nodeId, state] of Object.entries(run.nodeStates)) if (['PENDING', 'READY', 'RUNNING', 'WAITING_HUMAN'].includes(state.status)) {
          state.status = 'CANCELED'; state.finishedAt = run.finishedAt; state.message = run.error;
          run.logs.push({ seq: (run.logs.at(-1)?.seq ?? 0) + 1, time: run.finishedAt, nodeId, nodeName: nodeId, event: 'cancel', message: run.error });
        }
        await atomicWrite(file(runId), run);
      }
    }
    const result = structuredClone(run); if (since !== undefined) result.logs = result.logs.filter(log => log.seq > since); return result;
  }
  async function cancel(runId, authorized = true) {
    const previous = await get(runId); if (previous.advanced && !authorized) throw new AppError(40101, 'Local session required');
    const controller = controllers.get(runId); if (!controller) return { status: previous.status };
    controller.cancel(); await controller.done; return { status: 'CANCELED' };
  }
  async function control(runId, action, request = {}) {
    return withLock(`${file(runId)}:control`, async () => {
      let controller = controllers.get(runId);
      const snapshot = await get(runId);
      controller = controllers.get(runId);
      if (!request.authorized) throw new AppError(40101, 'Local session required');
      if (action === 'restore' && !snapshot.checkpoints?.some(c => c.id === request.checkpointId && c.kind === 'checkpoint' && c.engine)) throw new AppError(40001, '请选择当前运行的可恢复检查点');
      if (action === 'resolve' && !controller) {
        const resolved = snapshot.interventions?.find(i => i.id === request.interventionId);
        if (resolved?.status === 'resolved' && resolved.action === request.action && resolved.reason === request.reason) return snapshot;
      }
      if (['retry', 'restore'].includes(action) && !controller) {
        if (!snapshot.graph || !snapshot.runtime) throw new AppError(40901, '旧运行不含恢复数据，请启动新运行');
        if (activeByPlan.has(snapshot.planId)) throw new AppError(40901, '该方案已有活动运行');
        controller = await makeController(snapshot.graph, runId, null, snapshot.workspaceHandle, snapshot);
        if (action === 'retry') { controller.retry(request.nodeId); track(controller); }
        else { controller.pause(); track(controller); await controller.restoreCheckpoint(request.checkpointId); }
      } else {
        if (!controller) throw new AppError(40901, '运行已结束');
        if (action === 'pause') controller.pause();
        else if (action === 'resume') controller.resume();
        else if (action === 'retry') controller.retry(request.nodeId);
        else if (action === 'ghost') controller.insertGhost(request, await options.capabilityService.list());
        else if (action === 'restore') await controller.restoreCheckpoint(request.checkpointId);
        else if (action === 'resolve') controller.resolveHuman(request.interventionId, request.action, request.reason);
        else throw new AppError(40001, 'Unknown run control');
      }
      await controller.drain(); return get(runId);
    });
  }
  async function removePlan(planId) { return withLock(lock(planId), async () => { if (activeByPlan.has(planId)) throw new AppError(40901, '方案正在执行中，不能删除'); return planService.delete(planId); }); }
  async function close() { const list = [...controllers.values()]; list.forEach(c => c.cancel()); await Promise.all(list.map(c => c.done)); }
  return { execute, get, cancel, control, removePlan, close, resources: () => broker.snapshot(), isRunning: id => activeByPlan.has(id) };
}
