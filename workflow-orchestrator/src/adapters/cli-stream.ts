/**
 * CLI JSONL Stream Runner (`codex`, `claude-code`, etc.).
 */

import type {ISandboxProcessRunner} from '../sandbox/contracts.ts';
import type {
  CapabilityInvocationRequest,
  CapabilityInvocationResult,
} from './contracts.ts';

const RATE_LIMIT_PATTERN =
  /\b429\b|rate[_ -]?limit|quota exceeded|too many requests|overloaded/i;
const ENV_FAULT_PATTERN =
  /executable not found|command not found|enoent|eacces|spawn .* failed/i;

export async function runCliStreamCapability(
  req: CapabilityInvocationRequest,
  runner: ISandboxProcessRunner,
): Promise<CapabilityInvocationResult> {
  const t0 = Date.now();
  const {capability, permissionTier} = req;
  const args = [
    ...capability.baseArgs,
    ...capability.permissionFlags[permissionTier],
    `${req.systemPrompt}\n\n${req.userPrompt}`.trim(),
  ];

  const lines: string[] = [];
  const res = await runner.run({
    executable: capability.command,
    args,
    cwd: req.cwd,
    envAllowlist: capability.envAllowlist,
    timeoutMs: req.timeoutMs ?? 120_000,
    signal: req.signal,
    onStdoutLine: line => {
      lines.push(line);
      req.onChunk?.('assistant', line, capability.id);
    },
    onStderrLine: line => {
      req.onChunk?.('tool', line, 'stderr');
    },
  });

  const combined = `${res.stdout}\n${res.stderr}`.trim();
  const durationSec = Math.max(
    0.1,
    Number(((Date.now() - t0) / 1000).toFixed(2)),
  );

  if (RATE_LIMIT_PATTERN.test(combined)) {
    return {
      outcome: 'rate_limited',
      exitCode: res.exitCode,
      finalText: combined.slice(0, 4000),
      modifiedFiles: [],
      inputTokens: 0,
      cachedTokens: 0,
      outputTokens: 0,
      durationSec,
      errorMessage: 'Upstream provider rate limit or quota reached.',
    };
  }

  if (res.exitCode === 127 || ENV_FAULT_PATTERN.test(combined)) {
    return {
      outcome: 'env_fault',
      exitCode: res.exitCode,
      finalText: combined.slice(0, 4000),
      modifiedFiles: [],
      inputTokens: 0,
      cachedTokens: 0,
      outputTokens: 0,
      durationSec,
      errorMessage:
        res.stderr.trim() ||
        `Capability CLI "${capability.command}" unavailable.`,
    };
  }

  return {
    outcome: res.exitCode === 0 && !res.timedOut ? 'completed' : 'task_failure',
    exitCode: res.exitCode,
    finalText:
      lines.slice(-10).join('\n').trim() ||
      combined.slice(0, 4000) ||
      `CLI ${capability.id} exited with code ${res.exitCode}`,
    modifiedFiles: [],
    inputTokens: 0,
    cachedTokens: 0,
    outputTokens: 0,
    durationSec,
    errorMessage:
      res.exitCode === 0
        ? ''
        : res.stderr.trim() || `CLI failed with exit code ${res.exitCode}`,
  };
}
