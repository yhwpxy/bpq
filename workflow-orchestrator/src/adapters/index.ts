/**
 * Unified Capability Hub routing `local-tool`, `native-api`, `cli-stream`, and
 * `acp-stdio` capabilities under bounded ResourceSlotBroker concurrency.
 */

import type {
  IGitWorktreeManager,
  ISandboxProcessRunner,
} from '../sandbox/contracts.ts';
import {assertNever} from '../shared/errors.ts';
import type {
  CapabilityAdapterManifest,
  CapabilityHealthProfile,
  SlotLoadSnapshot,
} from '../shared/types.ts';
import type {OrchestratorStore} from '../store/database.ts';
import {runAcpCapability} from './acp-client.ts';
import {runCliStreamCapability} from './cli-stream.ts';
import type {
  CapabilityInvocationRequest,
  CapabilityInvocationResult,
  ICapabilityHub,
  ProviderSecretLookup,
} from './contracts.ts';
import {runNativeApiCapability} from './native-api.ts';
import {ResourceSlotBroker} from './resource-broker.ts';
import {runLocalToolCapability} from './tool-runner.ts';

export * from './acp-client.ts';
export * from './cli-stream.ts';
export * from './contracts.ts';
export * from './native-api.ts';
export * from './resource-broker.ts';
export * from './tool-runner.ts';

export class CapabilityHub implements ICapabilityHub {
  private readonly store: OrchestratorStore;
  private readonly runner: ISandboxProcessRunner;
  private readonly worktrees: IGitWorktreeManager;
  private readonly lookupProvider: ProviderSecretLookup;
  private readonly broker: ResourceSlotBroker;

  constructor(
    store: OrchestratorStore,
    runner: ISandboxProcessRunner,
    worktrees: IGitWorktreeManager,
    lookupProvider: ProviderSecretLookup,
    maxWorkerSlots = 4,
  ) {
    this.store = store;
    this.runner = runner;
    this.worktrees = worktrees;
    this.lookupProvider = lookupProvider;
    this.broker = new ResourceSlotBroker(maxWorkerSlots);
  }

  async probeCapability(
    manifest: CapabilityAdapterManifest,
  ): Promise<{readonly ok: boolean; readonly message: string}> {
    if (
      manifest.transport === 'native-api' ||
      manifest.transport === 'local-tool' ||
      manifest.transport === 'human-gate' ||
      manifest.transport === 'control-plane'
    ) {
      const msg = `Built-in ${manifest.transport} capability ready`;
      this.store.setCapabilityProbe(manifest.id, true, msg);
      return {ok: true, message: msg};
    }

    const resolved = this.runner.resolveExecutable(manifest.command);
    if (!resolved) {
      const msg = `Executable "${manifest.command}" not found on PATH`;
      this.store.setCapabilityProbe(manifest.id, false, msg, false);
      return {ok: false, message: msg};
    }

    const args =
      manifest.healthProbeArgs.length > 0
        ? manifest.healthProbeArgs
        : ['--version'];
    const res = await this.runner.run({
      executable: manifest.command,
      args,
      cwd: process.cwd(),
      envAllowlist: manifest.envAllowlist,
      timeoutMs: 8_000,
    });
    const ok = res.exitCode === 0 && !res.timedOut;
    const rawLine = (res.stdout || res.stderr).trim().split(/\r?\n/)[0] ?? '';
    const msg = ok
      ? `${resolved}${rawLine ? ` (${rawLine.slice(0, 72)})` : ''}`
      : `Probe failed (${res.exitCode}): ${rawLine.slice(0, 120)}`;
    this.store.setCapabilityProbe(manifest.id, ok, msg, ok);
    return {ok, message: msg};
  }

  async probeAllCapabilities(): Promise<readonly CapabilityHealthProfile[]> {
    const caps = this.store.listCapabilities();
    for (const c of caps) {
      await this.probeCapability(c);
    }
    return this.store.listCapabilityHealth();
  }

  async invokeCapability(
    req: CapabilityInvocationRequest,
  ): Promise<CapabilityInvocationResult> {
    const release = req.prioritySlot
      ? await this.broker.acquireHumanPrioritySlot()
      : await this.broker.acquireWorkerSlot();
    try {
      req.signal?.throwIfAborted();
      const transport = req.capability.transport;
      switch (transport) {
        case 'local-tool':
          return await runLocalToolCapability(req, this.runner, this.worktrees);
        case 'native-api':
          return await runNativeApiCapability(
            req,
            this.worktrees,
            this.lookupProvider,
          );
        case 'cli-stream':
          return await runCliStreamCapability(req, this.runner);
        case 'acp-stdio':
          return await runAcpCapability(req, this.runner);
        case 'human-gate':
        case 'control-plane':
          return {
            outcome: 'completed',
            exitCode: 0,
            finalText: 'Control/human node handled natively by orchestrator.',
            modifiedFiles: [],
            inputTokens: 0,
            cachedTokens: 0,
            outputTokens: 0,
            durationSec: 0.01,
            errorMessage: '',
          };
        default:
          return assertNever(transport);
      }
    } finally {
      release();
    }
  }

  getSlotSnapshot(): SlotLoadSnapshot {
    return this.broker.getSnapshot();
  }
}
