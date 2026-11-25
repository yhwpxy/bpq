/**
 * Agent Client Protocol (ACP) JSON-RPC 2.0 Stdio Session Runner.
 */

import type {ISandboxProcessRunner} from '../sandbox/contracts.ts';
import type {PermissionTier} from '../shared/types.ts';
import type {
  CapabilityInvocationRequest,
  CapabilityInvocationResult,
} from './contracts.ts';

export function evaluateAcpPermission(
  tier: PermissionTier,
  readOnly: boolean,
  toolName: string,
  commandText = '',
): {readonly allowed: boolean; readonly reason: string} {
  const lower = toolName.toLowerCase();
  const isMutation =
    lower.includes('write') ||
    lower.includes('edit') ||
    lower.includes('bash') ||
    lower.includes('exec');
  if (readOnly && isMutation) {
    return {
      allowed: false,
      reason: 'Read-only evaluator blocks mutation tool.',
    };
  }
  if (tier === 'strict' && isMutation) {
    return {allowed: false, reason: 'Strict tier requires human sign-off.'};
  }
  if (
    tier === 'supervised' &&
    /rm\s+-rf|git\s+push|git\s+reset\s+--hard/i.test(commandText)
  ) {
    return {
      allowed: false,
      reason: 'Supervised tier blocked destructive command.',
    };
  }
  return {allowed: true, reason: `Allowed under ${tier} tier.`};
}

export async function runAcpCapability(
  req: CapabilityInvocationRequest,
  runner: ISandboxProcessRunner,
): Promise<CapabilityInvocationResult> {
  const t0 = Date.now();
  const frames = [
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        clientInfo: {name: 'WorkflowOrchestrator', version: '0.1.0'},
        capabilities: {fs: {readTextFile: true, writeTextFile: !req.readOnly}},
      },
    },
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'session/new',
      params: {cwd: req.cwd, mcpServers: []},
    },
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'session/prompt',
      params: {
        sessionId: req.sessionId,
        prompt: `${req.systemPrompt}\n\n${req.userPrompt}`.trim(),
      },
    },
  ];
  const stdinText = `${frames.map(f => JSON.stringify(f)).join('\n')}\n`;

  const chunks: string[] = [];
  const res = await runner.run({
    executable: req.capability.command,
    args: req.capability.baseArgs,
    cwd: req.cwd,
    stdinText,
    envAllowlist: req.capability.envAllowlist,
    timeoutMs: req.timeoutMs ?? 120_000,
    signal: req.signal,
    onStdoutLine: line => {
      chunks.push(line);
      req.onChunk?.('assistant', line, req.capability.id);
    },
  });

  const durationSec = Math.max(
    0.1,
    Number(((Date.now() - t0) / 1000).toFixed(2)),
  );
  if (res.exitCode === 127) {
    return {
      outcome: 'env_fault',
      exitCode: res.exitCode,
      finalText: res.stderr,
      modifiedFiles: [],
      inputTokens: 0,
      cachedTokens: 0,
      outputTokens: 0,
      durationSec,
      errorMessage: `ACP binary "${req.capability.command}" not found.`,
    };
  }

  return {
    outcome: res.exitCode === 0 && !res.timedOut ? 'completed' : 'task_failure',
    exitCode: res.exitCode,
    finalText:
      chunks.join('\n').trim() || res.stdout.trim() || res.stderr.trim(),
    modifiedFiles: [],
    inputTokens: 0,
    cachedTokens: 0,
    outputTokens: 0,
    durationSec,
    errorMessage:
      res.exitCode === 0 ? '' : res.stderr.trim() || `ACP exit ${res.exitCode}`,
  };
}
