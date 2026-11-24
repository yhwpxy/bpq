import { beforeEach, afterEach, it, expect } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../backend/server.js';
import { parseGoal } from '../backend/engine/goalParser.js';
import { compileWorkflow } from '../backend/engine/workflowCompiler.js';
import { spliceGhost } from '../backend/engine/runGraphPatch.js';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async fn => { for (let i = 0; i < 600; i++) { const v = await fn(); if (v) return v; await sleep(10); } throw new Error('run timed out'); };
let dir, app, s;
beforeEach(async () => { dir = await mkdtemp(path.join(os.tmpdir(), 'vto-recovery-')); app = createApp({ storageDir: dir }); s = app.locals.services; });
afterEach(async () => { await s.runService.close(); await rm(dir, { recursive: true, force: true }); });
async function published(options = {}) {
  const caps = await s.capabilityService.list();
  const p = compileWorkflow(parseGoal('# Artifact\nFR-01: Write report'), { capabilityId: 'local-tool', command: process.execPath, args: ['tools/verify.cjs', '--fail-once'], ...options }, caps);
  const worker = p.nodes.find(n => n.props.capabilityId === 'local-tool'); worker.props.command = process.execPath; worker.props.args = ['tools/deliver.cjs', 'fr-01'];
  await s.planService.save(p); await s.versionService.trial(p.id); const v = await s.versionService.confirm(p.id); return { p, v, worker, caps };
}
const terminal = id => until(async () => { const r = await s.runService.get(id); return ['SUCCESS', 'FAILED'].includes(r.status) && r; });
it('recovers a real failed gate once using a new worktree and keeps the immutable version', async () => {
  const { p, v } = await published(); const { runId } = await s.runService.execute(p.id, { authorized: true }); const final = await terminal(runId);
  expect(final.status).toBe('SUCCESS'); expect(final.reworkCount).toBe(1); expect(final.checkpoints.some(c => c.kind === 'rescue')).toBe(true);
  const rescue = final.checkpoints.find(c => c.kind === 'rescue'); expect(rescue.preservedPath).not.toBe(final.workspaceHandle.cwd);
  expect(await readFile(path.join(rescue.preservedPath, 'artifacts/fr-01/report.json'), 'utf8')).toContain('verified');
  expect((await s.versionService.get(p.id, v.id)).digest).toBe(v.digest);
  expect(final.logs.some(l => l.event === 'restore' && l.rescueRef)).toBe(true);
});
it('stops automatic retries at the limit and requires an explicit bounded extension', async () => {
  const { p } = await published({ args: ['-e', 'process.exit(Number(process.env.VTO_ATTEMPT)<4?1:0)'] });
  const { runId } = await s.runService.execute(p.id, { authorized: true });
  const waiting = await until(async () => { const r = await s.runService.get(runId); return r.status === 'WAITING_HUMAN' && r; });
  expect(waiting.reworkCount).toBe(2); expect(waiting.interventions.at(-1).kind).toBe('rework_limit');
  await s.capabilityService.probe('local-tool');
  await s.runService.control(runId, 'resolve', { authorized: true, interventionId: waiting.interventions.at(-1).id, action: 'approve', reason: 'Permit exactly one additional recovery' });
  const final = await terminal(runId); expect(final.status).toBe('SUCCESS'); expect(final.reworkCount).toBe(3); expect(final.extraReworkAllowance).toBe(1); expect(final.graph.workflow.maxReworkIterations).toBe(2);
});
it('inserts an executable Ghost into a waiting run without changing its published version', async () => {
  const { p, v } = await published({ permissionTier: 'strict', args: ['tools/verify.cjs'] });
  const { runId } = await s.runService.execute(p.id, { authorized: true });
  const waiting = await until(async () => { const r = await s.runService.get(runId); return r.status === 'WAITING_HUMAN' && r; });
  const patched = await s.runService.control(runId, 'ghost', { authorized: true, targetId: p.nodes.find(n => n.type === 'end').id, title: '额外产物', reason: 'Operator requested a second report', capabilityId: 'local-tool', command: process.execPath, args: ['tools/deliver.cjs', 'extra'], fileScope: ['artifacts/extra/**'] });
  const ghost = patched.graph.nodes.find(n => n.props.control === 'ghost'); expect(ghost).toBeTruthy(); expect(patched.graphRevision).toBe(1);
  expect((await s.versionService.get(p.id, v.id)).plan.nodes).toHaveLength(v.plan.nodes.length);
  await s.runService.control(runId, 'resolve', { authorized: true, interventionId: waiting.interventions[0].id, action: 'approve', reason: 'Reviewed' });
  const final = await terminal(runId); expect(final.status).toBe('SUCCESS'); expect(final.nodeStates[ghost.id].status).toBe('SUCCESS'); expect(await readFile(path.join(final.workspaceHandle.cwd, 'artifacts/extra/report.json'), 'utf8')).toContain('verified');
});
it('manual restore of a completed run preserves later untracked files and attempt history', async () => {
  const { p } = await published({ args: ['tools/verify.cjs'] }); const { runId } = await s.runService.execute(p.id, { authorized: true }); const first = await terminal(runId);
  await writeFile(path.join(first.workspaceHandle.cwd, 'late-note.txt'), 'keep this');
  await s.runService.control(runId, 'restore', { authorized: true, checkpointId: first.checkpoints[0].id });
  const final = await terminal(runId); expect(final.status).toBe('SUCCESS'); expect(final.manualRestoreCount).toBe(1); expect(final.attempts.length).toBeGreaterThan(first.attempts.length);
  expect(await readFile(path.join(first.workspaceHandle.cwd, 'late-note.txt'), 'utf8')).toBe('keep this'); expect(final.workspaceHandle.cwd).not.toBe(first.workspaceHandle.cwd);
});
it('rejects running/completed or absent splice targets without mutating the original graph', async () => {
  const { p, caps } = await published(); const original = structuredClone(p), target = p.nodes.find(n => n.type === 'end');
  for (const status of ['RUNNING', 'READY', 'SUCCESS']) expect(() => spliceGhost(p, { [target.id]: { status } }, { targetId: target.id, title: 'extra', reason: 'why' }, caps)).toThrow();
  expect(() => spliceGhost(p, {}, { targetId: 'missing', title: 'extra', reason: 'why' }, caps)).toThrow(); expect(p).toEqual(original);
});
it('revalidates Ghost contracts and capability assignment before applying changes', async () => {
  const { p, caps } = await published(), target = p.nodes.find(n => n.type === 'end'), states = { [target.id]: { status: 'PENDING' } };
  expect(() => spliceGhost(p, states, { targetId: target.id, title: 'extra', reason: 'why', capabilityId: 'missing' }, caps)).toThrow();
  expect(() => spliceGhost(p, states, { targetId: target.id, title: 'extra', reason: 'why', requirementRefs: ['FR-999'] }, caps)).toThrow();
});
it('rejects a foreign manual checkpoint without changing the finished run', async () => {
  const { p } = await published({ args: ['tools/verify.cjs'] }); const { runId } = await s.runService.execute(p.id, { authorized: true }); const before = await terminal(runId);
  await expect(s.runService.control(runId, 'restore', { authorized: true, checkpointId: 'foreign' })).rejects.toMatchObject({ code: 40001 });
  expect(await s.runService.get(runId)).toEqual(before);
});
