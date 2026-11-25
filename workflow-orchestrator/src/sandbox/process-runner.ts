/**
 * Hardened OS Process Runner (`shell: false`, Windows PATHEXT + `.cmd/.bat` safe
 * wrapping, sensitive env scrubbing, and process-tree teardown).
 */

import {spawn} from 'node:child_process';
import {accessSync, constants, statSync} from 'node:fs';
import {delimiter, extname, isAbsolute, join, resolve} from 'node:path';
import {findBlockedCommandViolation} from '../core/policy.ts';
import {OrchestratorError} from '../shared/errors.ts';
import type {
  ISandboxProcessRunner,
  ProcessRunOptions,
  ProcessRunResult,
} from './contracts.ts';

const SENSITIVE_ENV_PATTERN = /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH/i;
const DEFAULT_TIMEOUT_MS = 120_000;
const WIN_CMD_BUILTINS = new Set([
  'echo',
  'dir',
  'type',
  'ver',
  'set',
  'cd',
  'copy',
  'cls',
  'date',
  'time',
]);

function hasUnquotedWinShellSyntax(segment: string): boolean {
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < segment.length; i += 1) {
    const ch = segment[i]!;
    if (quote) {
      if (ch === '\\' && quote === '"' && i + 1 < segment.length) {
        i += 1;
        continue;
      }
      if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '>' || ch === '<' || ch === '|' || ch === '&' || ch === '^') {
      return true;
    }
  }
  return false;
}

function isExecutableFile(filePath: string): boolean {
  try {
    const st = statSync(filePath);
    if (!st.isFile()) {
      return false;
    }
    if (process.platform !== 'win32') {
      accessSync(filePath, constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

function getWindowsPathExts(): string[] {
  const raw = process.env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD';
  const exts = raw
    .split(';')
    .map(e => e.trim().toLowerCase())
    .filter(e => e.startsWith('.'));
  return exts.length > 0 ? exts : ['.com', '.exe', '.bat', '.cmd'];
}

export function buildScrubbedEnvironment(
  envAllowlist: readonly string[] = [],
  extraEnv: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const allowSet = new Set(envAllowlist.map(k => k.toUpperCase()));
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value !== 'string') {
      continue;
    }
    if (SENSITIVE_ENV_PATTERN.test(key) && !allowSet.has(key.toUpperCase())) {
      continue;
    }
    env[key] = value;
  }

  if (!env['GIT_TERMINAL_PROMPT']) {
    env['GIT_TERMINAL_PROMPT'] = '0';
  }

  for (const [key, value] of Object.entries(extraEnv)) {
    env[key] = value;
  }
  return env;
}

export function splitChainedCommands(commandLine: string): string[] {
  const segments: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < commandLine.length; i += 1) {
    const ch = commandLine[i]!;
    if (quote) {
      if (ch === '\\' && quote === '"' && i + 1 < commandLine.length) {
        current += ch + commandLine[i + 1]!;
        i += 1;
        continue;
      }
      if (ch === quote) {
        quote = null;
      }
      current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '&' && commandLine[i + 1] === '&') {
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        segments.push(trimmed);
      }
      current = '';
      i += 1;
      continue;
    }
    current += ch;
  }
  const tail = current.trim();
  if (tail.length > 0) {
    segments.push(tail);
  }
  return segments;
}

export function tokenizeCommandArgv(segment: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inToken = false;
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < segment.length; i += 1) {
    const ch = segment[i]!;
    if (quote) {
      if (ch === '\\' && quote === '"' && i + 1 < segment.length) {
        const next = segment[i + 1]!;
        if (next === '"' || next === '\\') {
          current += next;
          i += 1;
          continue;
        }
      }
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      inToken = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (inToken) {
        tokens.push(current);
        current = '';
        inToken = false;
      }
      continue;
    }
    inToken = true;
    current += ch;
  }
  if (quote !== null) {
    throw new OrchestratorError(
      'VALIDATION_ERROR',
      `Unterminated quote in command segment: ${segment}`,
    );
  }
  if (inToken) {
    tokens.push(current);
  }
  return tokens;
}

function killProcessTree(pid: number | undefined): void {
  if (!pid || pid <= 0) {
    return;
  }
  if (process.platform === 'win32') {
    try {
      const killer = spawn('taskkill', ['/T', '/F', '/PID', String(pid)], {
        shell: false,
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.unref();
    } catch {
      // Fallback below
    }
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already exited
    }
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already exited
    }
  }
}

export class SandboxProcessRunner implements ISandboxProcessRunner {
  private globalBlockedPatterns: readonly string[] = [];

  setBlockedCommandPatterns(patterns: readonly string[]): void {
    this.globalBlockedPatterns = [...patterns];
  }

  resolveExecutable(command: string): string | null {
    const trimmed = command.trim();
    if (!trimmed || /[\0\r\n]/.test(trimmed)) {
      return null;
    }
    const isWin = process.platform === 'win32';
    const winExts = isWin ? getWindowsPathExts() : [];
    const hasPathSep =
      isAbsolute(trimmed) ||
      trimmed.includes('/') ||
      trimmed.includes('\\') ||
      trimmed.startsWith('.');

    const probeCandidate = (basePath: string): string | null => {
      if (isWin) {
        const ext = extname(basePath).toLowerCase();
        if (ext && winExts.includes(ext) && isExecutableFile(basePath)) {
          return basePath;
        }
        for (const pathext of winExts) {
          const withExt = `${basePath}${pathext}`;
          if (isExecutableFile(withExt)) {
            return withExt;
          }
        }
      }
      return isExecutableFile(basePath) ? basePath : null;
    };

    if (hasPathSep) {
      return probeCandidate(resolve(trimmed));
    }
    const pathEnv =
      process.env['PATH'] ?? process.env['Path'] ?? process.env['path'] ?? '';
    const dirs = pathEnv
      .split(delimiter)
      .map(d => d.trim())
      .filter(Boolean);

    for (const dir of dirs) {
      const hit = probeCandidate(join(dir, trimmed));
      if (hit) {
        return hit;
      }
    }
    return null;
  }

  async run(options: ProcessRunOptions): Promise<ProcessRunResult> {
    const fullLine = [options.executable, ...options.args].join(' ');
    const violation = findBlockedCommandViolation(fullLine, [
      ...this.globalBlockedPatterns,
      ...(options.blockedCommandPatterns ?? []),
    ]);
    if (violation) {
      throw new OrchestratorError(
        'POLICY_DENIED',
        `POLICY_BLOCKED: ${violation}`,
        403,
      );
    }

    for (const token of [options.executable, ...options.args]) {
      if (token.includes('\0')) {
        throw new OrchestratorError(
          'POLICY_DENIED',
          'POLICY_BLOCKED: Null byte detected in process argv',
          403,
        );
      }
    }

    const startedAt = Date.now();
    const resolved = this.resolveExecutable(options.executable);
    if (!resolved) {
      return {
        exitCode: 127,
        stdout: '',
        stderr: `Executable not found: ${options.executable}`,
        timedOut: false,
        durationMs: Math.max(1, Date.now() - startedAt),
      };
    }

    let spawnFile = resolved;
    let spawnArgs: string[] = [...options.args];

    if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(resolved)) {
      for (const part of [resolved, ...options.args]) {
        if (/[\r\n\0]/.test(part)) {
          throw new OrchestratorError(
            'POLICY_DENIED',
            'POLICY_BLOCKED: Control characters rejected in batch invocation',
            403,
          );
        }
      }
      spawnFile = process.env['ComSpec'] || 'cmd.exe';
      spawnArgs = ['/d', '/s', '/c', resolved, ...options.args];
    }

    const env = buildScrubbedEnvironment(
      options.envAllowlist,
      options.extraEnv,
    );
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    return new Promise<ProcessRunResult>(resolvePromise => {
      let stdout = '';
      let stderr = '';
      let stdoutRemainder = '';
      let stderrRemainder = '';
      let timedOut = false;
      let settled = false;

      const child = spawn(spawnFile, spawnArgs, {
        cwd: options.cwd,
        env,
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const timer = setTimeout(() => {
        timedOut = true;
        killProcessTree(child.pid);
      }, timeoutMs);

      const onAbort = (): void => {
        timedOut = true;
        killProcessTree(child.pid);
      };

      if (options.signal) {
        if (options.signal.aborted) {
          onAbort();
        } else {
          options.signal.addEventListener('abort', onAbort, {once: true});
        }
      }

      const finish = (exitCode: number, extraStderr = ''): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (options.signal) {
          options.signal.removeEventListener('abort', onAbort);
        }
        if (stdoutRemainder && options.onStdoutLine) {
          options.onStdoutLine(stdoutRemainder);
          stdoutRemainder = '';
        }
        if (stderrRemainder && options.onStderrLine) {
          options.onStderrLine(stderrRemainder);
          stderrRemainder = '';
        }
        if (extraStderr) {
          stderr = stderr ? `${stderr}\n${extraStderr}` : extraStderr;
        }
        resolvePromise({
          exitCode,
          stdout,
          stderr,
          timedOut,
          durationMs: Math.max(1, Date.now() - startedAt),
        });
      };

      child.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        stdout += text;
        if (options.onStdoutLine) {
          stdoutRemainder += text;
          const lines = stdoutRemainder.split(/\r?\n/);
          stdoutRemainder = lines.pop() ?? '';
          for (const line of lines) {
            options.onStdoutLine(line);
          }
        }
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        stderr += text;
        if (options.onStderrLine) {
          stderrRemainder += text;
          const lines = stderrRemainder.split(/\r?\n/);
          stderrRemainder = lines.pop() ?? '';
          for (const line of lines) {
            options.onStderrLine(line);
          }
        }
      });

      child.on('error', (err: Error) => {
        finish(127, err.message);
      });

      child.on('close', (code: number | null) => {
        finish(timedOut ? 124 : (code ?? 1));
      });

      if (child.stdin) {
        if (options.stdinText !== undefined) {
          child.stdin.write(options.stdinText, 'utf8');
        }
        child.stdin.end();
      }
    });
  }

  async runCommandString(
    commandLine: string,
    cwd: string,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    blockedPatterns: readonly string[] = [],
  ): Promise<ProcessRunResult> {
    const rawViolation = findBlockedCommandViolation(commandLine, [
      ...this.globalBlockedPatterns,
      ...blockedPatterns,
    ]);
    if (rawViolation) {
      throw new OrchestratorError(
        'POLICY_DENIED',
        `POLICY_BLOCKED: ${rawViolation}`,
        403,
      );
    }

    const segments = splitChainedCommands(commandLine);
    if (segments.length === 0) {
      throw new OrchestratorError(
        'VALIDATION_ERROR',
        'Gate command string cannot be empty',
      );
    }

    const combinedStdout: string[] = [];
    const combinedStderr: string[] = [];
    let totalDurationMs = 0;

    for (const seg of segments) {
      const argv = tokenizeCommandArgv(seg);
      if (argv.length === 0) {
        continue;
      }
      const firstToken = argv[0]!.toLowerCase();
      const useWinCmdShell =
        process.platform === 'win32' &&
        (WIN_CMD_BUILTINS.has(firstToken) ||
          (!this.resolveExecutable(argv[0]!) &&
            hasUnquotedWinShellSyntax(seg)));

      if (useWinCmdShell && /[\r\n\0]/.test(seg)) {
        throw new OrchestratorError(
          'POLICY_DENIED',
          'POLICY_BLOCKED: Control characters rejected in Windows shell command',
          403,
        );
      }

      const res = await this.run(
        useWinCmdShell
          ? {
              executable: process.env['ComSpec'] || 'cmd.exe',
              args: ['/d', '/s', '/c', seg],
              cwd,
              timeoutMs,
              blockedCommandPatterns: blockedPatterns,
            }
          : {
              executable: argv[0]!,
              args: argv.slice(1),
              cwd,
              timeoutMs,
              blockedCommandPatterns: blockedPatterns,
            },
      );
      if (res.stdout) {
        combinedStdout.push(res.stdout);
      }
      if (res.stderr) {
        combinedStderr.push(res.stderr);
      }
      totalDurationMs += res.durationMs;
      if (res.exitCode !== 0 || res.timedOut) {
        return {
          exitCode: res.exitCode,
          stdout: combinedStdout.join('\n'),
          stderr: combinedStderr.join('\n'),
          timedOut: res.timedOut,
          durationMs: totalDurationMs,
        };
      }
    }

    return {
      exitCode: 0,
      stdout: combinedStdout.join('\n'),
      stderr: combinedStderr.join('\n'),
      timedOut: false,
      durationMs: Math.max(1, totalDurationMs),
    };
  }
}
