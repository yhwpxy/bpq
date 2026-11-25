/**
 * Deterministic Sandboxed Tool Capability Runner (`local-tool`).
 */

import {mkdirSync, writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import type {
  IGitWorktreeManager,
  ISandboxProcessRunner,
} from '../sandbox/contracts.ts';
import type {
  CapabilityInvocationRequest,
  CapabilityInvocationResult,
} from './contracts.ts';

export async function runLocalToolCapability(
  req: CapabilityInvocationRequest,
  runner: ISandboxProcessRunner,
  worktrees: IGitWorktreeManager,
): Promise<CapabilityInvocationResult> {
  const t0 = Date.now();
  const cmd = req.gateCommand?.trim();

  if (cmd) {
    req.onChunk?.('tool', `$ ${cmd}`, 'shell');
    const res = await runner.runCommandString(
      cmd,
      req.cwd,
      req.timeoutMs ?? 60_000,
    );
    const out = [res.stdout.trim(), res.stderr.trim()]
      .filter(Boolean)
      .join('\n');
    req.onChunk?.('tool', out || `Exited with code ${res.exitCode}`, 'shell');
    return {
      outcome:
        res.exitCode === 0 && !res.timedOut ? 'completed' : 'task_failure',
      exitCode: res.exitCode,
      finalText: out || `Command "${cmd}" exited with code ${res.exitCode}`,
      modifiedFiles: [],
      inputTokens: 0,
      cachedTokens: 0,
      outputTokens: 0,
      durationSec: Math.max(
        0.05,
        Number(((Date.now() - t0) / 1000).toFixed(2)),
      ),
      errorMessage:
        res.exitCode === 0
          ? ''
          : `Tool command exited with ${res.exitCode}: ${res.stderr.trim().slice(0, 300)}`,
    };
  }

  // Deterministic workspace sanity/verification check writing scoped evidence
  const statusRes = await runner.run({
    executable: 'git',
    args: ['status', '--short'],
    cwd: req.cwd,
    signal: req.signal,
  });
  const relEvidence = `.orchestrator-artifacts/${req.nodeCode.toLowerCase()}.json`;
  const absEvidence = worktrees.resolveInside(req.cwd, relEvidence);
  mkdirSync(dirname(absEvidence), {recursive: true});
  writeFileSync(
    absEvidence,
    JSON.stringify(
      {
        nodeCode: req.nodeCode,
        capabilityId: req.capability.id,
        gitStatusLines: statusRes.stdout
          .split(/\r?\n/)
          .filter(Boolean)
          .slice(0, 30),
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    'utf8',
  );
  const summary = `Deterministic check ${req.nodeCode} verified worktree state and wrote ${relEvidence}.`;
  req.onChunk?.('assistant', summary, 'local-tool');

  return {
    outcome: 'completed',
    exitCode: 0,
    finalText: summary,
    modifiedFiles: [relEvidence],
    inputTokens: 0,
    cachedTokens: 0,
    outputTokens: 0,
    durationSec: Math.max(0.05, Number(((Date.now() - t0) / 1000).toFixed(2))),
    errorMessage: '',
  };
}
