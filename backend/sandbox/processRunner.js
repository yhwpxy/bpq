import { spawn } from 'node:child_process';
export function cleanEnvironment(allow = []) {
  const env = {};
  for (const key of ['PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'ComSpec', 'PATHEXT', 'TMPDIR', 'TEMP', 'TMP', 'LANG', ...allow]) {
    if (typeof process.env[key] === 'string') env[key] = process.env[key];
  }
  env.GIT_TERMINAL_PROMPT = '0'; return env;
}
export function stopProcess(child) {
  if (!child.pid) return;
  try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGTERM'); } catch {}
  const force = setTimeout(() => { try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGKILL'); } catch {} }, 300);
  force.unref(); child.once('close', () => clearTimeout(force));
}
export function spawnManaged(command, args, options) {
  if (typeof command !== 'string' || !command.trim() || !Array.isArray(args) || args.some(x => typeof x !== 'string' || x.includes('\0'))) throw new Error('Invalid executable or arguments');
  return spawn(command, args, { cwd: options.cwd, env: { ...cleanEnvironment(options.envAllowlist), ...options.extraEnv }, shell: false, detached: process.platform !== 'win32', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
}
export function runProcess(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) { reject(new Error('Execution aborted')); return; }
    let child;
    try { child = spawnManaged(command, args, options); } catch (e) { reject(e); return; }
    let stdout = '', stderr = '', reason = '', bytes = 0, settled = false;
    const timer = setTimeout(() => { reason = 'timeout'; stopProcess(child); }, options.timeoutMs ?? 60000);
    const abort = () => { reason = 'aborted'; stopProcess(child); };
    options.signal?.addEventListener('abort', abort, { once: true });
    const collect = (stream, chunk) => {
      bytes += chunk.length;
      if (bytes > (options.maxBytes ?? 1048576)) { reason = 'output_limit'; stopProcess(child); return; }
      if (stream === 'stdout') stdout += chunk.toString(); else stderr += chunk.toString();
      options.onChunk?.(stream, chunk.toString());
    };
    child.stdout.on('data', c => collect('stdout', c)); child.stderr.on('data', c => collect('stderr', c));
    const finish = (exitCode, error = '') => {
      if (settled) return; settled = true; clearTimeout(timer); options.signal?.removeEventListener('abort', abort);
      resolve({ exitCode, stdout, stderr: stderr || error, reason, outcome: reason === 'aborted' ? 'aborted' : reason ? 'task_failure' : exitCode === 0 ? 'completed' : exitCode === 127 ? 'env_fault' : 'task_failure' });
    };
    child.on('error', e => finish(127, e.code || 'spawn failed')); child.on('close', code => finish(reason ? 124 : code ?? 1));
    child.stdin.on('error', () => {}); child.stdin.end(options.stdin || '');
  });
}
