/**
 * Execution policy invariants, blocked-command guards, terminal state checks,
 * and structured Epistemic Handoff rendering.
 */

import type {
  EpistemicHandoff,
  GraphNodeStatus,
  PermissionTier,
} from '../shared/types.ts';

export const DEFAULT_BLOCKED_COMMAND_PATTERNS: readonly string[] = [
  'git push --force',
  'git reset --hard origin',
  'rm -rf /',
  'curl | sh',
  'wget | sh',
];

export function findBlockedCommandViolation(
  commandLine: string,
  extraBlockedPatterns: readonly string[] = [],
): string | null {
  const normalized = commandLine.replace(/\s+/g, ' ').trim().toLowerCase();
  const patterns = [
    ...DEFAULT_BLOCKED_COMMAND_PATTERNS,
    ...extraBlockedPatterns,
  ];
  for (const pattern of patterns) {
    const target = pattern.trim().toLowerCase();
    if (target.length > 0 && normalized.includes(target)) {
      return pattern;
    }
  }
  return null;
}

export function canAutoAdvanceGate(
  exitCode: number,
  attemptCount: number,
  maxAttempts: number,
): boolean {
  return exitCode === 0 && attemptCount <= maxAttempts;
}

export function requiresHumanApprovalBeforeMutation(
  tier: PermissionTier,
): boolean {
  return tier === 'strict';
}

export function isTerminalSuccessOrSkipped(status: GraphNodeStatus): boolean {
  return status === 'succeeded' || status === 'skipped' || status === 'waived';
}

export function renderEpistemicHandoff(
  title: string,
  handoff: EpistemicHandoff,
): string {
  const section = (heading: string, items: readonly string[]): string =>
    `### ${heading}\n${items.length > 0 ? items.map(i => `- ${i}`).join('\n') : '- (none)'}`;

  return [
    `## Handoff: ${title}`,
    section('1. Confirmed Facts', handoff.specConfirmedFacts),
    section('2. Hypotheses', handoff.agentHypotheses),
    section('3. Open Conflicts', handoff.openConflicts),
    section('4. Pending Criteria', handoff.uncertifiedCriteria),
  ].join('\n\n');
}
