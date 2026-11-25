/**
 * Fail-closed boundary validation utilities for API payloads and structured outputs.
 */

import {OrchestratorError} from './errors.ts';
import type {
  AdapterTransport,
  AgentRole,
  CapabilityAdapterManifest,
  EpistemicHandoff,
  ExecutorKind,
  PermissionTier,
} from './types.ts';

export const PERMISSION_TIERS: readonly PermissionTier[] = [
  'turbo',
  'supervised',
  'strict',
];

const EXECUTOR_KINDS: readonly ExecutorKind[] = [
  'agent',
  'tool',
  'human',
  'control',
];

const ADAPTER_TRANSPORTS: readonly AdapterTransport[] = [
  'acp-stdio',
  'cli-stream',
  'native-api',
  'local-tool',
  'human-gate',
  'control-plane',
];

const AGENT_ROLES: readonly AgentRole[] = [
  'lead',
  'worker',
  'evaluator',
  'specialist',
];

export function asRecord(
  input: unknown,
  context = 'payload',
): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new OrchestratorError(
      'VALIDATION_ERROR',
      `Expected ${context} to be a JSON object`,
    );
  }
  return input as Record<string, unknown>;
}

export function reqString(
  obj: Record<string, unknown>,
  key: string,
  maxLen = 65_536,
): string {
  const val = obj[key];
  if (typeof val !== 'string' || val.trim().length === 0) {
    throw new OrchestratorError(
      'VALIDATION_ERROR',
      `Field "${key}" must be a non-empty string`,
    );
  }
  if (val.length > maxLen) {
    throw new OrchestratorError(
      'VALIDATION_ERROR',
      `Field "${key}" exceeds maximum length ${maxLen}`,
    );
  }
  return val.trim();
}

export function optString(
  obj: Record<string, unknown>,
  key: string,
  fallback = '',
  maxLen = 200_000,
): string {
  const val = obj[key];
  if (val === undefined || val === null) {
    return fallback;
  }
  if (typeof val !== 'string') {
    throw new OrchestratorError(
      'VALIDATION_ERROR',
      `Field "${key}" must be a string`,
    );
  }
  if (val.length > maxLen) {
    throw new OrchestratorError(
      'VALIDATION_ERROR',
      `Field "${key}" exceeds maximum length ${maxLen}`,
    );
  }
  return val.trim();
}

export function optNumber(
  obj: Record<string, unknown>,
  key: string,
  fallback: number,
  min = 0,
  max = 1_000_000,
): number {
  const val = obj[key];
  if (val === undefined || val === null) {
    return fallback;
  }
  if (typeof val !== 'number' || !Number.isFinite(val)) {
    throw new OrchestratorError(
      'VALIDATION_ERROR',
      `Field "${key}" must be a finite number`,
    );
  }
  if (val < min || val > max) {
    throw new OrchestratorError(
      'VALIDATION_ERROR',
      `Field "${key}" must be between ${min} and ${max}`,
    );
  }
  return val;
}

export function optBoolean(
  obj: Record<string, unknown>,
  key: string,
  fallback: boolean,
): boolean {
  const val = obj[key];
  if (val === undefined || val === null) {
    return fallback;
  }
  if (typeof val !== 'boolean') {
    throw new OrchestratorError(
      'VALIDATION_ERROR',
      `Field "${key}" must be a boolean`,
    );
  }
  return val;
}

export function reqEnum<T extends string>(
  obj: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T {
  const val = obj[key];
  if (typeof val !== 'string' || !allowed.includes(val as T)) {
    throw new OrchestratorError(
      'VALIDATION_ERROR',
      `Field "${key}" must be one of: ${allowed.join(', ')}`,
    );
  }
  return val as T;
}

export function optStringArray(
  obj: Record<string, unknown>,
  key: string,
  maxItems = 256,
): string[] {
  const val = obj[key];
  if (val === undefined || val === null) {
    return [];
  }
  if (!Array.isArray(val) || val.length > maxItems) {
    throw new OrchestratorError(
      'VALIDATION_ERROR',
      `Field "${key}" must be an array of at most ${maxItems} strings`,
    );
  }
  return val.map((item, idx) => {
    if (typeof item !== 'string') {
      throw new OrchestratorError(
        'VALIDATION_ERROR',
        `Field "${key}[${idx}]" must be a string`,
      );
    }
    return item.trim();
  });
}

export function validateCapabilityManifest(
  raw: unknown,
): Omit<CapabilityAdapterManifest, 'probeOk' | 'probeMessage' | 'probedAt'> {
  const rec = asRecord(raw, 'capability manifest');
  const id = reqString(rec, 'id', 80);
  if (!/^[a-z0-9][a-z0-9:_-]{1,63}$/.test(id)) {
    throw new OrchestratorError(
      'VALIDATION_ERROR',
      'Capability id must match ^[a-z0-9][a-z0-9:_-]{1,63}$',
    );
  }
  const executorKind = reqEnum(
    {executorKind: rec['executorKind'] ?? 'agent'},
    'executorKind',
    EXECUTOR_KINDS,
  );
  const transport = reqEnum(rec, 'transport', ADAPTER_TRANSPORTS);
  const command =
    transport === 'native-api' ||
    transport === 'local-tool' ||
    transport === 'human-gate' ||
    transport === 'control-plane'
      ? optString(rec, 'command', transport, 512)
      : reqString(rec, 'command', 512);
  const permRaw =
    rec['permissionFlags'] !== undefined
      ? asRecord(rec['permissionFlags'], 'permissionFlags')
      : {};
  const rolesRaw = optStringArray(rec, 'supportedRoles', 10);
  const supportedRoles: AgentRole[] =
    rolesRaw.length > 0
      ? rolesRaw.map(role => {
          if (!AGENT_ROLES.includes(role as AgentRole)) {
            throw new OrchestratorError(
              'VALIDATION_ERROR',
              `Unsupported agent role: ${role}`,
            );
          }
          return role as AgentRole;
        })
      : ['worker'];

  return {
    id,
    label: reqString(rec, 'label', 120),
    executorKind,
    specialty: optString(rec, 'specialty', 'General Workflow Capability', 240),
    sovereignSoul: optString(
      rec,
      'sovereignSoul',
      'Execute scoped workflow steps strictly according to I/O contracts.',
      8192,
    ),
    transport,
    command,
    baseArgs: optStringArray(rec, 'baseArgs', 32),
    healthProbeArgs: optStringArray(rec, 'healthProbeArgs', 8),
    mcpInjection: reqEnum(
      {mcpInjection: rec['mcpInjection'] ?? 'none'},
      'mcpInjection',
      ['acp-session', 'claude-mcp-json', 'codex-flag', 'env-url', 'none'],
    ),
    jsonlParser: reqEnum(
      {jsonlParser: rec['jsonlParser'] ?? 'generic-jsonl'},
      'jsonlParser',
      [
        'claude-stream',
        'codex-rpc',
        'opencode-json',
        'pi-json',
        'generic-jsonl',
        'none',
      ],
    ),
    permissionFlags: {
      turbo: optStringArray(permRaw, 'turbo', 16),
      supervised: optStringArray(permRaw, 'supervised', 16),
      strict: optStringArray(permRaw, 'strict', 16),
    },
    envAllowlist: optStringArray(rec, 'envAllowlist', 32),
    defaultModel: optString(rec, 'defaultModel', 'default', 160),
    supportedRoles,
    maxConcurrentSlots: Math.trunc(
      optNumber(rec, 'maxConcurrentSlots', 3, 1, 32),
    ),
    enabled: optBoolean(rec, 'enabled', true),
    builtIn: Boolean(rec['builtIn']),
  };
}

export interface ValidatedAuditVerdict {
  readonly passed: boolean;
  readonly score: number;
  readonly findings: readonly string[];
}

export function parseFailClosedAuditJson(text: string): ValidatedAuditVerdict {
  try {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
    const candidate = fenced?.[1]?.trim() ?? text.trim();
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start < 0 || end <= start) {
      return {
        passed: false,
        score: 0,
        findings: ['Evaluator output contained no JSON verdict object.'],
      };
    }
    const parsed = asRecord(JSON.parse(candidate.slice(start, end + 1)));
    if (typeof parsed['passed'] !== 'boolean') {
      return {
        passed: false,
        score: 0,
        findings: ['Evaluator JSON missing boolean "passed" field.'],
      };
    }
    const rawScore =
      typeof parsed['score'] === 'number' && Number.isFinite(parsed['score'])
        ? Math.max(0, Math.min(1, parsed['score']))
        : parsed['passed']
          ? 0.9
          : 0.3;
    const findings = optStringArray(parsed, 'findings', 64);
    return {
      passed: parsed['passed'],
      score: rawScore,
      findings,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      passed: false,
      score: 0,
      findings: [`Fail-closed audit JSON error: ${msg}`],
    };
  }
}

export interface ValidatedSliceDeliverable {
  readonly summary: string;
  readonly modifiedFiles: readonly string[];
  readonly epistemicHandoff: EpistemicHandoff;
}

export function validateSliceDeliverable(
  raw: unknown,
): ValidatedSliceDeliverable {
  const rec = asRecord(raw, 'slice deliverable');
  const handoffRec =
    rec['epistemicHandoff'] !== undefined
      ? asRecord(rec['epistemicHandoff'], 'epistemicHandoff')
      : {};
  return {
    summary: reqString(rec, 'summary', 16_384),
    modifiedFiles: optStringArray(rec, 'modifiedFiles', 256),
    epistemicHandoff: {
      specConfirmedFacts: optStringArray(handoffRec, 'specConfirmedFacts', 64),
      agentHypotheses: optStringArray(handoffRec, 'agentHypotheses', 64),
      openConflicts: optStringArray(handoffRec, 'openConflicts', 32),
      uncertifiedCriteria: optStringArray(
        handoffRec,
        'uncertifiedCriteria',
        64,
      ),
    },
  };
}
