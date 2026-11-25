/**
 * Capability Operational Telemetry & Circuit Breaker State Machine.
 */

import type {
  AgentRole,
  CapabilityAdapterManifest,
  CapabilityHealthProfile,
  ExecutorKind,
  NodeAttemptRecord,
} from '../shared/types.ts';

const CIRCUIT_OPEN_CONSECUTIVE_FAILURES = 3;

export function computeCapabilityHealthProfile(
  capability: CapabilityAdapterManifest,
  attempts: readonly NodeAttemptRecord[],
): CapabilityHealthProfile {
  const scoped = attempts.filter(a => a.capabilityId === capability.id);
  const totalRuns = scoped.length;
  let consecutiveFailures = 0;
  let successCount = 0;
  let totalDuration = 0;
  let lastError = '';

  const sortedDesc = [...scoped].sort((a, b) =>
    b.startedAt.localeCompare(a.startedAt),
  );

  for (const rec of sortedDesc) {
    if (rec.status === 'succeeded') {
      break;
    }
    if (rec.status === 'failed') {
      consecutiveFailures += 1;
      if (!lastError && rec.errorMessage) {
        lastError = rec.errorMessage;
      }
    }
  }

  for (const rec of scoped) {
    totalDuration += rec.durationSec;
    if (rec.status === 'succeeded') {
      successCount += 1;
    }
  }

  const probeBlocked = capability.probeOk === false && !capability.enabled;
  const openByFailures =
    consecutiveFailures >= CIRCUIT_OPEN_CONSECUTIVE_FAILURES;

  let circuitState: CapabilityHealthProfile['circuitState'] = 'closed';
  if (!capability.enabled || probeBlocked || openByFailures) {
    circuitState = 'open';
  } else if (consecutiveFailures >= 2 || capability.probeOk === false) {
    circuitState = 'half_open';
  }

  if (!lastError && capability.probeOk === false) {
    lastError = capability.probeMessage;
  }

  return {
    capabilityId: capability.id,
    totalRuns,
    recentFailureCount: consecutiveFailures,
    avgDurationSec:
      totalRuns > 0 ? Number((totalDuration / totalRuns).toFixed(2)) : 0,
    successRate:
      totalRuns > 0 ? Number((successCount / totalRuns).toFixed(3)) : 1,
    circuitState,
    lastCheckedAt: capability.probedAt,
    lastError,
  };
}

export function selectHealthyCapability(
  capabilities: readonly CapabilityAdapterManifest[],
  profiles: readonly CapabilityHealthProfile[],
  executorKind: ExecutorKind,
  role: AgentRole,
): CapabilityAdapterManifest | null {
  const byId = new Map(profiles.map(p => [p.capabilityId, p]));
  const matching = capabilities.filter(
    cap =>
      cap.enabled &&
      cap.executorKind === executorKind &&
      (executorKind !== 'agent' || cap.supportedRoles.includes(role)),
  );

  const closed = matching.find(cap => {
    const prof = byId.get(cap.id);
    return !prof || prof.circuitState === 'closed';
  });
  if (closed) {
    return closed;
  }

  return (
    matching.find(cap => byId.get(cap.id)?.circuitState !== 'open') ?? null
  );
}
