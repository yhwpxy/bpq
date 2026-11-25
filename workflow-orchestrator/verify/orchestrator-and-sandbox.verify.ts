import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CapabilityHub} from '../src/adapters/index.ts';
import {ExecutionCertifier} from '../src/engines/certifier.ts';
import {WorkflowOrchestratorEngine} from '../src/engines/orchestrator.ts';
import {WorkflowPlannerEngine} from '../src/engines/planner.ts';
import {
  GitWorktreeManager,
  SandboxProcessRunner,
} from '../src/sandbox/index.ts';
import {HostSecretVault} from '../src/server/secret-vault.ts';
import type {RunDetailSnapshot} from '../src/shared/api.ts';
import {OrchestratorStore} from '../src/store/database.ts';

async function waitForRunCondition(
  getDetail: () => RunDetailSnapshot,
  predicate: (d: RunDetailSnapshot) => boolean,
  timeoutMs = 15_000,
): Promise<RunDetailSnapshot> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const detail = getDetail();
    if (predicate(detail)) {
      return detail;
    }
    await new Promise(resolve => setTimeout(resolve, 60));
  }
  const last = getDetail();
  throw new Error(
    `Timed out waiting for run state (status=${last.run.status}, completed=${last.run.completedNodes}/${last.run.totalNodes}, failed=${last.run.failedNodes})`,
  );
}

async function run(): Promise<void> {
  const tempRoot = mkdtempSync(join(tmpdir(), 'orch-verify-exec-'));
  const store = new OrchestratorStore(join(tempRoot, 'exec.sqlite'));

  try {
    const vault = new HostSecretVault(join(tempRoot, 'secrets.json'));
    const runner = new SandboxProcessRunner();
    const worktrees = new GitWorktreeManager(runner);
    const hub = new CapabilityHub(store, runner, worktrees, id =>
      vault.resolveProvider(store, id),
    );
    const certifier = new ExecutionCertifier(store, runner, worktrees, hub);
    const planner = new WorkflowPlannerEngine(store, () => {});
    const orchestrator = new WorkflowOrchestratorEngine({
      store,
      worktrees,
      hub,
      certifier,
      worktreesRoot: join(tempRoot, 'worktrees'),
      broadcast: () => {},
    });

    const repoDir = join(tempRoot, 'workspace-repo');
    await worktrees.ensureGitRepoInitialized(repoDir, 'main');

    // 1. Sandbox path confinement guarantee
    assert.throws(
      () => worktrees.resolveInside(repoDir, '../../etc/passwd'),
      /SANDBOX_ESCAPE/,
    );

    const ws = store.createWorkspace({
      name: 'Exec Sandbox Repo',
      rootPath: repoDir,
      defaultBranch: 'main',
      verifyCommand: 'node -e "process.exit(0)"',
    });

    // 2. Strict workflow: Human Gate + Runtime GhostNode + Parallel & Skip + Checkpoint + FTS5
    const strictWf = planner.importRequirements({
      workspaceId: ws.id,
      title: 'Strict Orchestration Flow',
      markdown:
        '# Strict Flow\n## Functional Requirements\n- FR-01: Generate module\n- FR-02: Verify compliance',
      permissionTier: 'strict',
      verifyCommand: 'node -e "process.exit(0)"',
      maxReworkIterations: 2,
    });
    const strictVer = planner.confirmVersion(strictWf.workflow.id);

    const run1 = await orchestrator.startRun({
      workflowId: strictWf.workflow.id,
      versionId: strictVer.id,
      title: 'Strict + Ghost Run',
      permissionTier: 'strict',
    });

    const pausedAtGate = await waitForRunCondition(
      () => orchestrator.getRunDetail(run1.run.id),
      d => d.run.status === 'waiting_human',
    );
    const openInt = pausedAtGate.interventions.find(i => i.status === 'open');
    assert.ok(openInt, 'Strict workflow must pause at open Human Gate');

    // Test Pause -> Resume on active run state and runtime GhostNode splicing
    const doneNode = pausedAtGate.nodes.find(n => n.kind === 'done');
    assert.ok(doneNode);
    const withGhost = orchestrator.proposeGhostNode(run1.run.id, {
      title: 'Runtime Extra Sanity Note',
      description: 'Emit an extra runtime verification artifact.',
      executorKind: 'agent',
      capabilityId: 'native-api',
      insertBeforeNodeId: doneNode.id,
    });
    assert.ok(
      withGhost.nodes.some(n => n.kind === 'ghost'),
      'Run graph must include spliced GhostNode',
    );
    assert.equal(
      store.getVersion(strictVer.id).nodes.some(n => n.kind === 'ghost'),
      false,
      'Locked version snapshot must remain immutable when GhostNode is spliced',
    );

    orchestrator.resolveIntervention(openInt.id, {
      resolution: 'Approved by verification gate',
      action: 'approve',
    });

    const finished1 = await waitForRunCondition(
      () => orchestrator.getRunDetail(run1.run.id),
      d => d.run.status === 'succeeded' || d.run.status === 'failed',
    );
    assert.equal(finished1.run.status, 'succeeded');
    assert.ok(
      finished1.nodes.some(n => n.status === 'skipped'),
      'Unselected conditional branch must transition cleanly to skipped',
    );
    assert.equal(
      finished1.nodes.find(n => n.kind === 'ghost')?.status,
      'succeeded',
    );
    assert.ok(
      finished1.checkpoints.length >= 2,
      'Expected base + certified verification Git checkpoints',
    );

    const ftsHits = store.searchEvidence('GHOST.1');
    assert.ok(
      ftsHits.length > 0,
      'FTS5 searchEvidence must index session/audit records for runtime nodes',
    );

    // 3. Supervised workflow: Gate failure -> Automatic Restore Rework + Rescue Ref -> Pass
    const markerFile = join(tempRoot, 'gate-attempt-marker.txt');
    const flakyGateScript = join(tempRoot, 'flaky-gate.cjs');
    writeFileSync(
      flakyGateScript,
      [
        'const fs = require("node:fs");',
        `const p = ${JSON.stringify(markerFile)};`,
        'if (!fs.existsSync(p)) { fs.writeFileSync(p, "1"); console.error("First attempt fail"); process.exit(1); }',
        'console.log("Second attempt pass"); process.exit(0);',
      ].join('\n'),
      'utf8',
    );

    const reworkWf = planner.importRequirements({
      workspaceId: ws.id,
      title: 'Bounded Rework Flow',
      markdown:
        '# Rework Flow\n## Functional Requirements\n- FR-01: Recover cleanly from transient gate failure',
      permissionTier: 'supervised',
      verifyCommand: `node "${flakyGateScript}"`,
      maxReworkIterations: 2,
    });
    const reworkVer = planner.confirmVersion(reworkWf.workflow.id);

    const run2 = await orchestrator.startRun({
      workflowId: reworkWf.workflow.id,
      versionId: reworkVer.id,
      title: 'Rework Recovery Run',
    });

    const finished2 = await waitForRunCondition(
      () => orchestrator.getRunDetail(run2.run.id),
      d => d.run.status === 'succeeded' || d.run.status === 'failed',
    );
    assert.equal(finished2.run.status, 'succeeded');
    assert.equal(finished2.run.reworkCount, 1);
    assert.ok(existsSync(markerFile));
    assert.ok(
      finished2.recentAudit.some(a =>
        a.title.includes(
          'Bounded rework #1 rewound via refs/orchestrator-backup',
        ),
      ),
      'Expected audit trail of non-destructive Git rescue ref rewind',
    );
    assert.ok(
      finished2.rehydrationCapsule?.workflowId === reworkWf.workflow.id,
    );

    // 4. Windows shell builtin gate + Constitution blocked-command enforcement + orphan worktree cleanup
    const echoGate = await runner.runCommandString(
      'echo Verification gate passed',
      repoDir,
    );
    assert.equal(echoGate.exitCode, 0);
    assert.ok(echoGate.stdout.includes('Verification gate passed'));
    runner.setBlockedCommandPatterns(['danger_custom_block']);
    await assert.rejects(
      () => runner.runCommandString('echo danger_custom_block', repoDir),
      /POLICY_BLOCKED/,
    );
    await worktrees.cleanupOrphanWorktrees(repoDir);

    console.log(
      '[PASS] orchestrator-and-sandbox: Worktree + HumanGate + GhostNode + Rework + Constitution + Cleanup',
    );
  } finally {
    store.close();
    rmSync(tempRoot, {recursive: true, force: true});
  }
}

void run().catch(err => {
  console.error(err);
  process.exit(1);
});
