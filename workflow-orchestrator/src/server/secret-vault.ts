/**
 * Host-isolated Secret Vault persisting provider keys outside SQLite logs.
 */

import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, join} from 'node:path';
import type {ProviderSecretResolved} from '../adapters/contracts.ts';
import type {OrchestratorStore} from '../store/database.ts';

interface VaultDiskPayload {
  readonly keys: Record<string, string>;
}

const CLEARED_SENTINEL = '__CLEARED__';

const ENV_FALLBACK: Readonly<Record<string, string>> = {
  'opencode-go': 'OPENCODE_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
};

export class HostSecretVault {
  private readonly filePath: string;
  private keys: Record<string, string> = {};

  constructor(filePath: string) {
    this.filePath = filePath;
    this.load();
  }

  private load(): void {
    if (!existsSync(this.filePath)) {
      return;
    }
    try {
      const parsed = JSON.parse(
        readFileSync(this.filePath, 'utf8'),
      ) as Partial<VaultDiskPayload>;
      if (parsed.keys && typeof parsed.keys === 'object') {
        this.keys = {...parsed.keys};
      }
    } catch {
      this.keys = {};
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), {recursive: true});
    const payload: VaultDiskPayload = {keys: this.keys};
    writeFileSync(this.filePath, JSON.stringify(payload, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    });
  }

  setApiKey(providerId: string, rawKey: string): void {
    const trimmed = rawKey.trim();
    if (!trimmed) {
      if (providerId === 'opencode-go') {
        this.keys[providerId] = CLEARED_SENTINEL;
      } else {
        delete this.keys[providerId];
      }
    } else {
      this.keys[providerId] = trimmed;
    }
    this.persist();
  }

  getKeyStatus(providerId: string): {
    readonly hasApiKey: boolean;
    readonly maskedKeyHint: string;
  } {
    const raw = this.getRawApiKey(providerId);
    if (!raw) {
      return {hasApiKey: false, maskedKeyHint: 'Not configured'};
    }
    return {
      hasApiKey: true,
      maskedKeyHint: `${raw.slice(0, Math.min(4, raw.length))}••••${raw.slice(-4)}`,
    };
  }

  getRawApiKey(providerId: string): string | null {
    const explicit = this.keys[providerId];
    if (explicit === CLEARED_SENTINEL) {
      return null;
    }
    if (explicit?.trim()) {
      return explicit.trim();
    }
    const envVar = ENV_FALLBACK[providerId];
    if (envVar && process.env[envVar]?.trim()) {
      return process.env[envVar]!.trim();
    }
    if (
      providerId === 'opencode-go' &&
      process.env['ORCH_OFFLINE_VERIFY'] !== '1'
    ) {
      try {
        const authPath = join(
          homedir(),
          '.local',
          'share',
          'opencode',
          'auth.json',
        );
        if (existsSync(authPath)) {
          const parsed = JSON.parse(readFileSync(authPath, 'utf8')) as Record<
            string,
            unknown
          >;
          const entry = parsed['opencode-go'] as
            {readonly key?: unknown} | undefined;
          if (typeof entry?.key === 'string' && entry.key.trim().length > 0) {
            return entry.key.trim();
          }
        }
      } catch {
        // Ignore malformed or unreadable OpenCode auth file
      }
    }
    return null;
  }

  resolveProvider(
    store: OrchestratorStore,
    providerId: string,
  ): ProviderSecretResolved | null {
    const providers = store.listModelProviders(id => this.getKeyStatus(id));
    const found = providers.find(p => p.id === providerId);
    if (!found) {
      return null;
    }
    return {
      providerId: found.id,
      protocol: found.protocol,
      baseUrl: found.baseUrl,
      apiKey: this.getRawApiKey(found.id),
    };
  }
}
