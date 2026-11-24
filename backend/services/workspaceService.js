import path from 'node:path';
import { mkdir, realpath, access, writeFile, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { settingsStore } from './settingsStore.js';
import { AppError, assertSafeId } from './errors.js';
import { withLock } from './storage.js';
import { runProcess } from '../sandbox/processRunner.js';
export function createWorkspaceService(root) {
  const managedRoot = path.resolve(root, 'worktrees');
  const store = settingsStore(root, 'workspaces', { workspaces: [], handles: [] });
  async function git(cwd, args) {
    const r = await runProcess('git', ['-c', 'user.name=VTO Runtime', '-c', 'user.email=vto@localhost', ...args], { cwd, timeoutMs: 30000 });
    if (r.exitCode !== 0) throw new AppError(40002, `Git operation failed: ${args[0]}`, [{ rule: 'R6', message: r.stderr.slice(0, 600) }]);
    return r.stdout.trim();
  }
  async function list() { return (await store.read()).workspaces; }
  async function get(id) { assertSafeId(id); const workspace = (await list()).find(w => w.id === id); if (!workspace) throw new AppError(40401, 'Workspace not found'); return workspace; }
  async function register(input) {
    if (!input || typeof input.rootPath !== 'string' || !path.isAbsolute(input.rootPath)) throw new AppError(40001, 'An absolute repository path is required');
    const baseRef = input.baseRef || 'HEAD';
    if (typeof baseRef !== 'string' || /^-|[\s\0]/.test(baseRef)) throw new AppError(40001, 'Invalid base reference');
    let repo;
    try { repo = await realpath(input.rootPath); await access(path.join(repo, '.git')); } catch { throw new AppError(40001, 'Repository directory with its own .git is required'); }
    if (await realpath(await git(repo, ['rev-parse', '--show-toplevel'])) !== repo) throw new AppError(40001, 'Path is not a repository root');
    const baseSha = await git(repo, ['rev-parse', '--verify', '--end-of-options', `${baseRef}^{commit}`]);
    return store.update(data => {
      const existing = data.workspaces.find(w => w.rootPath === repo);
      if (existing) return existing;
      const workspace = { id: `workspace_${randomUUID()}`, name: String(input.name || path.basename(repo)).slice(0, 100), rootPath: repo, baseRef, baseSha, createdAt: new Date().toISOString() };
      data.workspaces.push(workspace); return workspace;
    });
  }
  async function provision(workspaceId, runId, baseSha, suffix = '') {
    assertSafeId(runId); const workspace = await get(workspaceId);
    const handleId = `worktree_${randomUUID()}`, branch = `vto/${runId}${suffix ? `-${suffix}` : ''}-${randomUUID().slice(0, 8)}`;
    const cwd = path.join(managedRoot, handleId); await mkdir(managedRoot, { recursive: true });
    const sha = baseSha || await git(workspace.rootPath, ['rev-parse', '--verify', '--end-of-options', `${workspace.baseRef}^{commit}`]);
    if (!/^[a-f0-9]{40,64}$/.test(sha)) throw new AppError(40001, 'Invalid commit');
    await git(workspace.rootPath, ['worktree', 'add', '-b', branch, cwd, sha]);
    const handle = { id: handleId, workspaceId, runId, cwd, branch, baseSha: sha, createdAt: new Date().toISOString() };
    await store.update(data => { data.handles.push(handle); }); return handle;
  }
  async function resolveHandle(handle) {
    const registered = (await store.read()).handles.find(h => h.id === handle?.id);
    if (!registered || registered.runId !== handle.runId || registered.cwd !== handle.cwd) throw new AppError(40001, 'Unknown managed worktree');
    const base = await realpath(managedRoot), cwd = await realpath(registered.cwd), relative = path.relative(base, cwd);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new AppError(40001, 'Managed worktree path is invalid');
    return registered;
  }
  async function checkpoint(handle, label = 'checkpoint') {
    const h = await resolveHandle(handle);
    return withLock(`${h.cwd}:git`, async () => {
      await git(h.cwd, ['add', '-A']);
      await git(h.cwd, ['commit', '--allow-empty', '-m', `VTO ${h.runId}: ${String(label).replace(/[\r\n]/g, ' ').slice(0, 160)}`]);
      const sha = await git(h.cwd, ['rev-parse', 'HEAD']);
      const id = `checkpoint_${randomUUID()}`, ref = `refs/vto/checkpoints/${h.runId}/${id}`;
      await git(h.cwd, ['update-ref', ref, sha, '0'.repeat(sha.length)]);
      return { id, runId: h.runId, handleId: h.id, sha, ref, label, createdAt: new Date().toISOString() };
    });
  }
  async function restore(handle, checkpointRecord) {
    const h = await resolveHandle(handle);
    if (checkpointRecord.runId !== h.runId || !/^[a-f0-9]{40,64}$/.test(checkpointRecord.sha)) throw new AppError(40001, 'Checkpoint belongs to another run');
    const workspace = await get(h.workspaceId);
    const actual = await git(workspace.rootPath, ['rev-parse', '--verify', '--end-of-options', checkpointRecord.ref]);
    if (actual !== checkpointRecord.sha) throw new AppError(40002, 'Checkpoint reference mismatch');
    const rescue = await checkpoint(h, 'rescue-before-restore');
    const next = await provision(h.workspaceId, h.runId, checkpointRecord.sha, 'restore');
    next.originSha = h.originSha || h.baseSha;
    await store.update(data => { Object.assign(data.handles.find(x => x.id === next.id), { originSha: next.originSha }); });
    return { handle: next, rescue, preservedPath: h.cwd, restoredFrom: checkpointRecord.id };
  }
  async function diff(handle) {
    const h = await resolveHandle(handle);
    const baseline = h.originSha || h.baseSha;
    const [patch, names, untracked] = await Promise.all([
      git(h.cwd, ['diff', baseline, '--']), git(h.cwd, ['diff', '--name-only', baseline, '--']), git(h.cwd, ['ls-files', '--others', '--exclude-standard']),
    ]);
    return { baseSha: baseline, patch: patch.slice(0, 200000), files: [...new Set(`${names}\n${untracked}`.split('\n').filter(Boolean))] };
  }
  async function doctor() {
    const version = await runProcess('git', ['--version']);
    const workspaces = await list(), results = [];
    for (const w of workspaces) { try { results.push({ id: w.id, ready: true, pruned: await git(w.rootPath, ['worktree', 'prune', '--verbose']) }); } catch { results.push({ id: w.id, ready: false }); } }
    return { gitReady: version.exitCode === 0, gitVersion: version.stdout.trim(), workspaces: results };
  }
  async function demo() {
    const repo = path.resolve(root, 'demo-repository');
    return withLock(`${repo}:initialize`, async () => {
      try { await access(path.join(repo, '.git')); }
      catch {
        await mkdir(path.join(repo, 'tools'), { recursive: true });
        await writeFile(path.join(repo, 'README.md'), '# VTO offline execution fixture\nA small local repository for actual file-producing workflow demonstrations.\n');
        await writeFile(path.join(repo, 'tools/deliver.cjs'), "const fs=require('fs');const name=process.argv[2];if(!/^[A-Za-z0-9_-]+$/.test(name))process.exit(2);fs.mkdirSync('artifacts/'+name,{recursive:true});fs.writeFileSync('artifacts/'+name+'/report.json',JSON.stringify({name,verified:true}));console.log('Created artifacts/'+name+'/report.json');\n");
        await writeFile(path.join(repo, 'tools/verify.cjs'), "const fs=require('fs');if(process.argv.includes('--fail-once')&&Number(process.env.VTO_ATTEMPT||1)===1){console.error('Deliberate first-attempt failure');process.exit(1);}const dirs=fs.readdirSync('artifacts');if(!dirs.length)process.exit(2);for(const d of dirs){const report=JSON.parse(fs.readFileSync('artifacts/'+d+'/report.json'));if(!report.verified)process.exit(3);}console.log('Verified '+dirs.length+' artifacts');\n");
        await git(repo, ['init', '-b', 'demo-base']); await git(repo, ['add', '-A']); await git(repo, ['commit', '-m', 'Initialize local verification fixture']);
      }
      return register({ rootPath: repo, name: '离线产物演示 / Offline artifact demo', baseRef: 'demo-base' });
    });
  }
  return { list, get, register, provision, resolveHandle, checkpoint, restore, diff, doctor, demo };
}
