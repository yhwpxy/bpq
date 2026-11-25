/**
 * Capability Adapter Hub & Bounded Resource Concurrency Slot Broker contracts.
 */

import type {
  AgentRole,
  CapabilityAdapterManifest,
  CapabilityHealthProfile,
  PermissionTier,
  SlotLoadSnapshot,
} from '../shared/types.ts';

export interface ProviderSecretResolved {
  readonly providerId: string;
  readonly protocol: 'openai-compatible' | 'anthropic-messages';
  readonly baseUrl: string;
  readonly apiKey: string | null;
}

export type ProviderSecretLookup = (
  providerId: string,
) => ProviderSecretResolved | null;

export interface CapabilityInvocationRequest {
  readonly sessionId: string;
  readonly runId: string;
  readonly nodeId: string;
  readonly nodeCode: string;
  readonly role: AgentRole;
  readonly capability: CapabilityAdapterManifest;
  readonly model: string;
  readonly permissionTier: PermissionTier;
  readonly cwd: string;
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly gateCommand?: string | null;
  readonly fileScope: readonly string[];
  readonly readOnly: boolean;
  readonly textOnly?: boolean;
  readonly providerId?: string;
  readonly maxOutputTokens?: number;
  readonly timeoutMs?: number;
  readonly prioritySlot?: boolean;
  readonly signal?: AbortSignal;
  readonly onChunk?: (
    role: 'assistant' | 'tool',
    content: string,
    toolName?: string | null,
  ) => void;
}

export interface CapabilityInvocationResult {
  readonly outcome: 'completed' | 'rate_limited' | 'env_fault' | 'task_failure';
  readonly exitCode: number;
  readonly finalText: string;
  readonly modifiedFiles: readonly string[];
  readonly inputTokens: number;
  readonly cachedTokens: number;
  readonly outputTokens: number;
  readonly durationSec: number;
  readonly errorMessage: string;
}

export interface ICapabilityHub {
  probeCapability(
    manifest: CapabilityAdapterManifest,
  ): Promise<{readonly ok: boolean; readonly message: string}>;
  probeAllCapabilities(): Promise<readonly CapabilityHealthProfile[]>;
  invokeCapability(
    req: CapabilityInvocationRequest,
  ): Promise<CapabilityInvocationResult>;
  getSlotSnapshot(): SlotLoadSnapshot;
}
