import { it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createEmptyPlan, createNode } from '../shared/plan.js';
import { createRun } from '../backend/engine/scheduler.js';
import { ResourceBroker } from '../backend/engine/resourceBroker.js';
import { parseGoal } from '../backend/engine/goalParser.js';
import { compileWorkflow } from '../backend/engine/workflowCompiler.js';
import { createApp } from '../backend/server.js';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async fn => { for (let i = 0; i < 300; i++) { const value = await fn(); if (value) return value; await sleep(10); } throw new Error('condition timed out'); };
function legacy(duration = 80) {
  const p = createEmptyPlan(); const s = createNode('start'), t = createNode('task'), e = createNode('end'); t.props.duration = duration;
  p.nodes = [s, t, e]; p.edges = [{ id: 'a', source: s.id, target: t.id }, { id: 'b', source: t.id, target: e.id }]; return p;
}
let dir, app;
beforeEach(async () => { dir = await mkdtemp(path.join(os.tmpdir(), 'run-control-')); app = createApp({ storageDir: dir, sessionToken: 'session' }); });
afterEach(async () => { await app.locals.services.runService.close(); await rm(dir, { recursive: true, force: true }); });

it('pauses running work, prevents late success and resumes with a new attempt', async () => {
  const p = legacy(), run = createRun(p); await until(() => run.snapshot.nodeStates[p.nodes[1].id].status === 'RUNNING');
  run.pause(); await sleep(100); expect(run.snapshot.status).toBe('PAUSED'); expect(run.snapshot.nodeStates[p.nodes[1].id].status).toBe('PENDING');
  run.resume(); const result = await run.done; expect(result.status).toBe('SUCCESS'); expect(result.nodeStates[p.nodes[1].id].attempt).toBe(2);
  expect(result.attempts.filter(a => a.nodeId === p.nodes[1].id).map(a => a.status)).toEqual(['CANCELED', 'SUCCESS']);
});
it('cancels a paused run and releases shared resources', async () => {
  const broker = new ResourceBroker(1), p = legacy(1000), run = createRun(p, { broker });
  await until(() => broker.active === 1); run.pause(); run.cancel(); expect((await run.done).status).toBe('CANCELED'); expect(broker.active).toBe(0);
});
it('bounds shared resource slots, removes cancelled waiters and releases idempotently', async () => {
  const broker = new ResourceBroker(1), release = await broker.acquire();
  const controller = new AbortController(); const queued = broker.acquire({ signal: controller.signal }); const rejected = expect(queued).rejects.toThrow('aborted');
  controller.abort(); await rejected; expect(broker.snapshot().queued).toBe(0); release(); release(); expect(broker.active).toBe(0);
});
it('keeps one bounded human priority slot independent of workers', async () => {
  const broker = new ResourceBroker(1), worker = await broker.acquire(), human = await broker.acquire({ priority: true });
  expect(broker.snapshot()).toMatchObject({ activeWorkers: 1, activeHumanPriority: 1 }); human(); worker(); expect(broker.active).toBe(0);
});
it('runs a published version in a real worktree with actual verified artifacts', async () => {
  const s = app.locals.services, capabilities = await s.capabilityService.list();
  const p = compileWorkflow(parseGoal('# Local delivery\nFR-01: Write one\nFR-02: Write two'), { capabilityId: 'local-tool', command: process.execPath, args: ['tools/verify.cjs'] }, capabilities);
  for (const n of p.nodes.filter(n => n.props.capabilityId === 'local-tool')) { n.props.command = process.execPath; n.props.args = ['tools/deliver.cjs', n.props.requirementRefs[0].toLowerCase()]; }
  await s.planService.save(p); await s.versionService.trial(p.id); const version = await s.versionService.confirm(p.id);
  await expect(s.runService.execute(p.id)).rejects.toMatchObject({ code: 40101 });
  const { runId } = await s.runService.execute(p.id, { authorized: true });
  const final = await until(async () => { const r = await s.runService.get(runId); return ['SUCCESS', 'FAILED'].includes(r.status) && r; });
  expect(final.error).toBeNull(); expect(final.status).toBe('SUCCESS'); expect(final.versionId).toBe(version.id); expect(final.checkpoints.length).toBe(3);
  expect(JSON.parse(await readFile(path.join(final.workspaceHandle.cwd, 'artifacts/fr-01/report.json'), 'utf8')).verified).toBe(true);
  expect(final.nodeStates[p.nodes.find(n => n.type === 'condition').id].status).toBe('SUCCESS');
});
it.each(['approve', 'override', 'reject'])('resolves a human gate with %s and records the decision', async action => {
  const s = app.locals.services, caps = await s.capabilityService.list();
  const p = compileWorkflow(parseGoal('Gate workflow'), { permissionTier: 'strict' }, caps);
  await s.planService.save(p); await s.versionService.trial(p.id); await s.versionService.confirm(p.id);
  const { runId } = await s.runService.execute(p.id, { authorized: true });
  const waiting = await until(async () => { const r = await s.runService.get(runId); return r.status === 'WAITING_HUMAN' && r; });
  const interventionId = waiting.interventions[0].id;
  await s.runService.control(runId, 'resolve', { authorized: true, interventionId, action, reason: 'Reviewed by test operator' });
  const final = await until(async () => { const r = await s.runService.get(runId); return ['SUCCESS', 'FAILED'].includes(r.status) && r; });
  expect(final.status).toBe(action === 'reject' ? 'FAILED' : 'SUCCESS'); expect(final.interventions[0].action).toBe(action);
  expect(final.logs.some(l => l.event === action)).toBe(true);
});
it('manual retry preserves history and restarts only a failed downstream region', async () => {
  let fail = true;
  await app.locals.services.runService.close(); app = createApp({ storageDir: dir, runOptions: { random: () => fail ? 0 : 1 } });
  const s = app.locals.services, p = legacy(0); p.nodes[1].props.failRate = 1; await s.planService.save(p);
  const { runId } = await s.runService.execute(p.id);
  const failed = await until(async () => { const r = await s.runService.get(runId); return r.status === 'FAILED' && r; });
  const previousLogs = failed.logs.length; fail = false;
  await s.runService.control(runId, 'retry', { authorized: true, nodeId: p.nodes[1].id });
  const final = await until(async () => { const r = await s.runService.get(runId); return r.status === 'SUCCESS' && r; });
  expect(final.logs.length).toBeGreaterThan(previousLogs); expect(final.nodeStates[p.nodes[0].id].attempt).toBe(1); expect(final.nodeStates[p.nodes[1].id].attempt).toBe(2);
});
it('keeps paused runs readable without waiting for completion', async () => {
  const s = app.locals.services, p = legacy(1000); await s.planService.save(p); const { runId } = await s.runService.execute(p.id);
  await until(async () => (await s.runService.get(runId)).nodeStates[p.nodes[1].id].status === 'RUNNING');
  await s.runService.control(runId, 'pause', { authorized: true }); expect((await s.runService.get(runId)).status).toBe('PAUSED');
  expect(s.runService.isRunning(p.id)).toBe(true); await expect(s.runService.removePlan(p.id)).rejects.toMatchObject({ code: 40901 });
});
it('cancels a queued run without consuming a slot or overwriting cancellation', async () => {
  const broker = new ResourceBroker(1), a = createRun(legacy(100), { broker }), b = createRun(legacy(100), { broker });
  await until(() => broker.queue.length === 1); b.cancel(); expect((await b.done).status).toBe('CANCELED'); expect(broker.queue.length).toBe(0);
  expect((await a.done).status).toBe('SUCCESS'); expect(broker.active).toBe(0);
});
it('records human rejection once even if the resolution is retried after completion', async () => {
  const s = app.locals.services, caps = await s.capabilityService.list(), p = compileWorkflow(parseGoal('Approval'), { permissionTier: 'strict' }, caps);
  await s.planService.save(p); await s.versionService.trial(p.id); await s.versionService.confirm(p.id); const { runId } = await s.runService.execute(p.id, { authorized: true });
  const waiting = await until(async () => { const r = await s.runService.get(runId); return r.status === 'WAITING_HUMAN' && r; });
  const request = { authorized: true, interventionId: waiting.interventions[0].id, action: 'reject', reason: 'No' };
  await s.runService.control(runId, 'resolve', request); const again = await s.runService.control(runId, 'resolve', request);
  expect(again.logs.filter(l => l.event === 'reject')).toHaveLength(1);
});
