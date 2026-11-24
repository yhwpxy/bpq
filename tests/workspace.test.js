import { beforeEach, afterEach, it, expect } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, mkdir, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createWorkspaceService } from '../backend/services/workspaceService.js';
import { runProcess } from '../backend/sandbox/processRunner.js';
let dir, service, workspace;
beforeEach(async () => { dir = await mkdtemp(path.join(os.tmpdir(), 'vto-workspace-')); service = createWorkspaceService(dir); workspace = await service.demo(); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });
it('registers an actual repository and provisions independent run branches', async () => {
  const a = await service.provision(workspace.id, 'run_a'), b = await service.provision(workspace.id, 'run_b');
  await writeFile(path.join(a.cwd, 'result.txt'), 'run a');
  await expect(readFile(path.join(b.cwd, 'result.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(readFile(path.join(workspace.rootPath, 'result.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(a.branch).not.toBe(b.branch); expect(a.cwd).not.toBe(b.cwd);
});
it('preserves source branch and working tree state across checkpoint commits', async () => {
  const before = await runProcess('git', ['rev-parse', 'HEAD'], { cwd: workspace.rootPath });
  const h = await service.provision(workspace.id, 'run_one'); await writeFile(path.join(h.cwd, 'out.txt'), 'artifact');
  const cp = await service.checkpoint(h, 'verified'); expect(cp.sha).toMatch(/^[a-f0-9]{40,64}$/);
  expect((await runProcess('git', ['rev-parse', 'HEAD'], { cwd: workspace.rootPath })).stdout).toBe(before.stdout);
  expect((await runProcess('git', ['status', '--porcelain'], { cwd: workspace.rootPath })).stdout).toBe('');
});
it('restores in a new worktree and preserves tracked, untracked and ignored pre-restore data', async () => {
  const h = await service.provision(workspace.id, 'run_restore'); await writeFile(path.join(h.cwd, 'tracked.txt'), 'good');
  await writeFile(path.join(h.cwd, '.gitignore'), 'ignored.txt\n'); const cp = await service.checkpoint(h, 'good');
  await writeFile(path.join(h.cwd, 'tracked.txt'), 'later'); await writeFile(path.join(h.cwd, 'new.txt'), 'untracked'); await writeFile(path.join(h.cwd, 'ignored.txt'), 'ignored');
  const restored = await service.restore(h, cp);
  expect(restored.handle.cwd).not.toBe(h.cwd); expect(await readFile(path.join(restored.handle.cwd, 'tracked.txt'), 'utf8')).toBe('good');
  expect(await readFile(path.join(h.cwd, 'tracked.txt'), 'utf8')).toBe('later'); expect(await readFile(path.join(h.cwd, 'new.txt'), 'utf8')).toBe('untracked'); expect(await readFile(path.join(h.cwd, 'ignored.txt'), 'utf8')).toBe('ignored');
  expect((await runProcess('git', ['show', `${restored.rescue.ref}:new.txt`], { cwd: h.cwd })).stdout).toBe('untracked');
});
it('rejects foreign checkpoints and unknown worktrees', async () => {
  const a = await service.provision(workspace.id, 'run_a'), b = await service.provision(workspace.id, 'run_b');
  const cp = await service.checkpoint(a); await expect(service.restore(b, cp)).rejects.toMatchObject({ code: 40001 });
  await expect(service.checkpoint({ ...a, cwd: workspace.rootPath })).rejects.toMatchObject({ code: 40001 });
});
it('includes untracked artifacts in diff without staging them', async () => {
  const h = await service.provision(workspace.id, 'run_diff'); await writeFile(path.join(h.cwd, 'new.txt'), 'new');
  const diff = await service.diff(h); expect(diff.files).toContain('new.txt');
  expect((await runProcess('git', ['status', '--porcelain'], { cwd: h.cwd })).stdout).toContain('?? new.txt');
});
it('produces and verifies real demo artifacts', async () => {
  const h = await service.provision(workspace.id, 'run_demo');
  const generated = await runProcess(process.execPath, ['tools/deliver.cjs', 'invoice'], { cwd: h.cwd }); expect(generated.exitCode).toBe(0);
  const first = await runProcess(process.execPath, ['tools/verify.cjs', '--fail-once'], { cwd: h.cwd, extraEnv: { VTO_ATTEMPT: '1' } }); expect(first.exitCode).toBe(1);
  const second = await runProcess(process.execPath, ['tools/verify.cjs', '--fail-once'], { cwd: h.cwd, extraEnv: { VTO_ATTEMPT: '2' } }); expect(second.exitCode).toBe(0);
});
it('rejects non-repositories, relative paths and option-like refs', async () => {
  await expect(service.register({ rootPath: '.' })).rejects.toMatchObject({ code: 40001 });
  await expect(service.register({ rootPath: dir })).rejects.toMatchObject({ code: 40001 });
  await expect(service.register({ rootPath: workspace.rootPath, baseRef: '--help' })).rejects.toMatchObject({ code: 40001 });
});
it('does not create duplicate demo workspaces or delete valid worktrees during doctor', async () => {
  expect((await service.demo()).id).toBe(workspace.id); const h = await service.provision(workspace.id, 'run_doctor');
  await writeFile(path.join(h.cwd, 'keep.txt'), 'keep'); const report = await service.doctor(); expect(report.gitReady).toBe(true); expect(await readFile(path.join(h.cwd, 'keep.txt'), 'utf8')).toBe('keep');
});
it('keeps the original run baseline for diff after recovery', async () => {
  const h = await service.provision(workspace.id, 'run_baseline'); await writeFile(path.join(h.cwd, 'delivered.txt'), 'delivery');
  const cp = await service.checkpoint(h); const restored = await service.restore(h, cp); const diff = await service.diff(restored.handle);
  expect(diff.baseSha).toBe(h.baseSha); expect(diff.files).toContain('delivered.txt');
});
