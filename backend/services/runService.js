import path from 'node:path';
import { nanoid } from 'nanoid';
import { createRun } from '../engine/scheduler.js';
import { NODE_STATUS_COLORS } from '../../shared/constants.js';
import { AppError, assertSafeId } from './errors.js';
import { atomicWrite, readJson, withLock } from './storage.js';

function validateRun(run) {
  const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
  const date = x => typeof x === 'string' && Number.isFinite(Date.parse(x));
  if (!object(run) || typeof run.id !== 'string' || typeof run.planId !== 'string' || typeof run.planName !== 'string'
    || !['IDLE', 'VALIDATING', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELED'].includes(run.status)
    || !date(run.startedAt) || (run.finishedAt !== null && !date(run.finishedAt)) || !object(run.nodeStates) || !Array.isArray(run.logs)
    || (run.error !== null && typeof run.error !== 'string')) throw new AppError(50000, '运行快照结构损坏，无法读取');
  for (const state of Object.values(run.nodeStates)) if (!object(state) || !Object.hasOwn(NODE_STATUS_COLORS, state.status) || !Number.isInteger(state.attempt) || state.attempt < 0) throw new AppError(50000, '节点运行快照结构损坏');
  let last = 0;
  for (const log of run.logs) {
    if (!object(log) || !Number.isInteger(log.seq) || log.seq <= last || !date(log.time) || typeof log.nodeId !== 'string' || typeof log.nodeName !== 'string' || typeof log.message !== 'string' || !['start', 'success', 'fail', 'retry', 'skip', 'cancel'].includes(log.event)) throw new AppError(50000, '运行日志结构损坏');
    last = log.seq;
  }
  return run;
}

export function createRunService(storageDir, planService, options = {}) {
  const directory = path.resolve(storageDir, 'runs');
  const activeByPlan = new Map(); const controllers = new Map(); const finishedCache = new Map();
  const file = id => path.join(directory, `${assertSafeId(id, 40402)}.json`);
  const lock = id => `${directory}:plan:${id}`;
  async function execute(planId) {
    assertSafeId(planId);
    return withLock(lock(planId), async () => {
      if (activeByPlan.has(planId)) throw new AppError(40901, '方案正在执行中');
      const plan = await planService.get(planId);
      const controller = createRun(plan, {
        ...options, id: `run_${nanoid(10)}`, autoStart: false,
        onUpdate: snapshot => atomicWrite(file(snapshot.id), snapshot),
      });
      const id = controller.snapshot.id;
      // The response is not issued until the initial snapshot is safely on disk.
      await atomicWrite(file(id), controller.snapshot);
      activeByPlan.set(planId, id); controllers.set(id, controller);
      controller.done.then(snapshot => {
        finishedCache.set(id, snapshot);
        // Only retain recent completions; older runs remain available on disk.
        if (finishedCache.size > 50) finishedCache.delete(finishedCache.keys().next().value);
        if (activeByPlan.get(planId) === id) activeByPlan.delete(planId);
        controllers.delete(id);
      });
      controller.start(); return { runId: id };
    });
  }
  async function get(runId, since) {
    assertSafeId(runId, 40402);
    if (since !== undefined && (!Number.isSafeInteger(since) || since < 0)) throw new AppError(40001, 'since 必须是非负整数');
    const controller = controllers.get(runId);
    if (controller && !['RUNNING', 'VALIDATING'].includes(controller.snapshot.status)) await controller.done;
    let run = controller?.snapshot ?? finishedCache.get(runId);
    if (!run) {
      run = validateRun(await readJson(file(runId), { missingCode: 40402 }));
      if (run.status === 'RUNNING' || run.status === 'VALIDATING') {
        // A process restart cannot resume timers. Persist a truthful terminal result.
        run.status = 'FAILED'; run.finishedAt = new Date().toISOString(); run.error = '服务重启，运行已中断';
        for (const [nodeId, state] of Object.entries(run.nodeStates)) if (['PENDING', 'RUNNING'].includes(state.status)) {
          state.status = 'CANCELED'; state.finishedAt = run.finishedAt; state.message = run.error;
          run.logs.push({ seq: (run.logs.at(-1)?.seq ?? 0) + 1, time: run.finishedAt, nodeId, nodeName: nodeId, event: 'cancel', message: run.error });
        }
        await atomicWrite(file(runId), run);
      }
    }
    const result = structuredClone(run);
    if (since !== undefined) result.logs = result.logs.filter(log => log.seq > since);
    return result;
  }
  async function cancel(runId) {
    assertSafeId(runId, 40402);
    const controller = controllers.get(runId);
    if (!controller) { await get(runId); return { status: 'CANCELED' }; }
    controller.cancel(); await controller.done; return { status: 'CANCELED' };
  }
  async function removePlan(planId) {
    return withLock(lock(planId), async () => {
      if (activeByPlan.has(planId)) throw new AppError(40901, '方案正在执行中，不能删除');
      return planService.delete(planId);
    });
  }
  async function close() { const list = [...controllers.values()]; list.forEach(controller => controller.cancel()); await Promise.all(list.map(controller => controller.done)); }
  return { execute, get, cancel, removePlan, close, isRunning: id => activeByPlan.has(id) };
}
