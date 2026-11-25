/**
 * Headless Host Runtime assembling Store, SecretVault, Sandbox, Capabilities,
 * Planner, Certifier, Orchestrator, and Loopback HTTP/SSE Server.
 */

import {mkdirSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {HamaService} from '../../../requirements-engineering/src/service.ts';
import {DesignService} from '../../../software-design/src/service.ts';
import {DesignGenerator} from '../../../software-design/src/generator.ts';
import {DesignReviewService} from '../../../software-design/src/reviews.ts';
import {DesignHandoffService} from '../../../software-design/src/handoff.ts';
import {CapabilityHub} from '../adapters/index.ts';
import {ExecutionCertifier} from '../engines/certifier.ts';
import {WorkflowOrchestratorEngine} from '../engines/orchestrator.ts';
import {WorkflowPlannerEngine} from '../engines/planner.ts';
import {GitWorktreeManager, SandboxProcessRunner} from '../sandbox/index.ts';
import {OrchestratorStore} from '../store/database.ts';
import {OrchestratorHttpServer} from './http-router.ts';
import {HostSecretVault} from './secret-vault.ts';

export interface OrchestratorRuntimeOptions {
  readonly dataDir?: string;
  readonly port?: number;
  readonly staticDir?: string | null;
  readonly seedSample?: boolean;
}

export interface OrchestratorRuntime {
  readonly dataDir: string;
  readonly store: OrchestratorStore;
  readonly vault: HostSecretVault;
  readonly runner: SandboxProcessRunner;
  readonly worktrees: GitWorktreeManager;
  readonly hub: CapabilityHub;
  readonly planner: WorkflowPlannerEngine;
  readonly certifier: ExecutionCertifier;
  readonly orchestrator: WorkflowOrchestratorEngine;
  readonly server: OrchestratorHttpServer;
  readonly baseUrl: string;
  readonly sessionToken: string;
  stop: () => Promise<void>;
}

export async function createOrchestratorRuntime(
  options: OrchestratorRuntimeOptions = {},
): Promise<OrchestratorRuntime> {
  const dataDir = resolve(
    options.dataDir ?? join(process.cwd(), '.orchestrator'),
  );
  mkdirSync(dataDir, {recursive: true});

  const store = new OrchestratorStore(join(dataDir, 'orchestrator.sqlite'));
  const vault = new HostSecretVault(join(dataDir, 'secrets.json'));
  const runner = new SandboxProcessRunner();
  runner.setBlockedCommandPatterns(store.getConstitutionRule().blockedCommands);
  const worktrees = new GitWorktreeManager(runner);
  const hub = new CapabilityHub(store, runner, worktrees, providerId =>
    vault.resolveProvider(store, providerId),
  );

  let serverRef: OrchestratorHttpServer | null = null;
  const planner = new WorkflowPlannerEngine(
    store,
    (type, workflowId, payload) => {
      serverRef?.broadcast(type, {workflowId}, payload);
    },
    providerId => vault.resolveProvider(store, providerId),
  );
  const certifier = new ExecutionCertifier(store, runner, worktrees, hub);
  const orchestrator = new WorkflowOrchestratorEngine({
    store,
    worktrees,
    hub,
    certifier,
    worktreesRoot: join(dataDir, 'worktrees'),
    broadcast: (type, ids, payload) => {
      serverRef?.broadcast(type, ids, payload);
    },
  });
  const requirements = new HamaService(store, orchestrator, planner, hub,
    providerId => vault.resolveProvider(store, providerId), join(dataDir, 'document-runs'));
  const designs = new DesignService(store, requirements, join(dataDir, 'design-inputs'));
  const designReviews = new DesignReviewService(store.db, designs);
  const designHandoffs = new DesignHandoffService(store, designReviews, designs, planner);
  const designGenerator = new DesignGenerator(designs, store, hub,
    providerId => vault.resolveProvider(store, providerId), join(dataDir, 'design-generations'));

  if (options.seedSample !== false) {
    store.seedSampleWorkflowIfEmpty(join(dataDir, 'sample-workspace'));
  }

  const server = new OrchestratorHttpServer({
    store,
    vault,
    runner,
    worktrees,
    hub,
    planner,
    orchestrator,
    requirements,
    designs,
    designGenerator,
    designReviews,
    designHandoffs,
    staticDir: options.staticDir ?? null,
  });
  serverRef = server;

  await server.start(options.port ?? 0);
  orchestrator.recoverRegisteredRuns();

  return {
    dataDir,
    store,
    vault,
    runner,
    worktrees,
    hub,
    planner,
    certifier,
    orchestrator,
    server,
    baseUrl: server.getBaseUrl(),
    sessionToken: server.getSessionToken(),
    stop: async () => {
      await server.stop();
      await orchestrator.shutdown();
      store.close();
    },
  };
}
