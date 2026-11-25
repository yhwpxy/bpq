/**
 * Real-Time Parallel & Conditional Workflow Orchestrator Engine.
 *
 * Responsibilities:
 * - Launches immutable Version Snapshots inside isolated Git Worktrees
 * - Computes ready frontiers concurrently (parallel tasks + conditional branch skipping + Join barriers)
 * - Dispatches `agent` / `tool` / `human` / `control` nodes
 * - Supports Pause / Resume / Retry / Human Gate resolution / Runtime GhostNode splicing
 * - Executes bounded Rework loops via non-destructive Git Rescue Refs
 */

import {randomUUID} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {buildRehydrationCapsule} from '../core/cognitive.ts';
import {renderUbiquitousLanguageSection} from '../core/ddd.ts';
import {
  computeNextFrontier,
  computeRewindSet,
  spliceGhostNode,
} from '../core/twin-graph.ts';
import type {ICapabilityHub} from '../adapters/contracts.ts';
import type {IGitWorktreeManager} from '../sandbox/contracts.ts';
import type {
  ProposeGhostNodeRequest,
  ResolveInterventionRequest,
  RunDetailSnapshot,
  StartRunRequest,
} from '../shared/api.ts';
import {OrchestratorError} from '../shared/errors.ts';
import type {
  CheckpointRecord,
  GoalSpec,
  GraphNode,
  WorkflowRunRecord,
} from '../shared/types.ts';
import type {OrchestratorStore} from '../store/database.ts';
import type {ExecutionCertifier} from './certifier.ts';
import type {WorkflowHandler, WorkflowStepContext, WorkflowStepResult} from './workflow-handler.ts';

export class WorkflowOrchestratorEngine {
  private readonly store: OrchestratorStore;
  private readonly worktrees: IGitWorktreeManager;
  private readonly hub: ICapabilityHub;
  private readonly certifier: ExecutionCertifier;
  private readonly worktreesRoot: string;
  private readonly broadcast: (
    type:
      | 'run.status'
      | 'node.status'
      | 'attempt.updated'
      | 'checkpoint.created'
      | 'intervention.created'
      | 'intervention.resolved'
      | 'session.chunk'
      | 'audit.appended',
    ids: {
      readonly workflowId?: string;
      readonly runId: string;
      readonly nodeId?: string;
    },
    payload: Record<string, unknown>,
  ) => void;

  private readonly activeAbortByRun = new Map<string, AbortController>();
  private readonly activeTaskCountByRun = new Map<string, number>();
  private readonly handlers: WorkflowHandler[] = [];
  private stopping = false;
  private readonly tasks = new Set<Promise<void>>();

  constructor(input: {
    readonly store: OrchestratorStore;
    readonly worktrees: IGitWorktreeManager;
    readonly hub: ICapabilityHub;
    readonly certifier: ExecutionCertifier;
    readonly worktreesRoot: string;
    readonly broadcast: (
      type:
        | 'run.status'
        | 'node.status'
        | 'attempt.updated'
        | 'checkpoint.created'
        | 'intervention.created'
        | 'intervention.resolved'
        | 'session.chunk'
        | 'audit.appended',
      ids: {
        readonly workflowId?: string;
        readonly runId: string;
        readonly nodeId?: string;
      },
      payload: Record<string, unknown>,
    ) => void;
  }) {
    this.store = input.store;
    this.worktrees = input.worktrees;
    this.hub = input.hub;
    this.certifier = input.certifier;
    this.worktreesRoot = input.worktreesRoot;
    this.broadcast = input.broadcast;
  }

  registerHandler(handler: WorkflowHandler): void {
    this.handlers.push(handler);
  }

  hasHandler(workflowId: string): boolean {
    return this.handler(workflowId) !== undefined;
  }

  private handler(workflowId: string): WorkflowHandler | undefined {
    return this.handlers.find(handler => handler.matches(workflowId));
  }

  private requireNativeRun(workflowId: string): void {
    if (this.hasHandler(workflowId)) {
      throw new OrchestratorError('POLICY_DENIED', 'Use the registered workflow controls.', 403);
    }
  }

  async startRun(
    req: StartRunRequest,
    initialize?: (run: WorkflowRunRecord) => void,
  ): Promise<RunDetailSnapshot> {
    const wf = this.store.getWorkflow(req.workflowId);
    const registered = this.hasHandler(wf.id);
    if (registered && !initialize) this.requireNativeRun(wf.id);
    const versions = this.store.listVersions(wf.id);
    const version = req.versionId
      ? this.store.getVersion(req.versionId)
      : versions[0];

    if (!version || version.workflowId !== wf.id) {
      throw new OrchestratorError(
        'SPEC_INVALID',
        'No locked version snapshot exists yet. Run Validation & Lock Version before executing.',
        400,
      );
    }

    const workspace = this.store.getWorkspace(wf.workspaceId);
    const runId = `run-${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();

    const documentPath = join(this.worktreesRoot, '..', 'document-runs', runId);
    if (registered) mkdirSync(documentPath, {recursive: true});
    const wt = registered
      ? {worktreePath: documentPath, branchName: '', baseCommitSha: ''}
      : await this.worktrees.provisionWorktree({
          repoPath: workspace.rootPath,
          worktreesRoot: this.worktreesRoot,
          repoId: workspace.id,
          runCode: runId,
          baseRef: workspace.defaultBranch,
        });

    const execNodes = version.nodes.filter(n => n.kind !== 'phase_container');
    const runRecord: WorkflowRunRecord = {
      id: runId,
      workflowId: wf.id,
      versionId: version.id,
      versionTag: version.versionTag,
      title: req.title?.trim() || `${wf.code} · ${version.versionTag}`,
      status: 'running',
      permissionTier: req.permissionTier ?? wf.permissionTier,
      worktreePath: wt.worktreePath,
      gitBranch: wt.branchName,
      baseCommitSha: wt.baseCommitSha,
      verifyCommand: wf.verifyCommand,
      maxReworkIterations: wf.maxReworkIterations,
      reworkCount: 0,
      totalNodes: execNodes.length,
      completedNodes: 0,
      failedNodes: 0,
      skippedNodes: 0,
      budgetUsdLimit: wf.customization?.budgetUsdLimit ?? 2.5,
      spentUsd: 0,
      inputTokens: 0,
      cachedTokens: 0,
      outputTokens: 0,
      startedAt: now,
      finishedAt: null,
      updatedAt: now,
    };

    const clonedNodes = version.nodes.map(n => ({
      ...n,
      scopeId: runId,
      status: 'pending' as const,
      attemptCount: 0,
      outputSummary: n.kind === 'decision' ? n.outputSummary : '',
      updatedAt: now,
    }));
    const clonedEdges = version.edges.map(e => ({
      ...e,
      id: `re-${randomUUID().slice(0, 8)}-${e.id.slice(0, 6)}`,
      scopeId: runId,
    }));
    const idRemap = new Map(version.nodes.map(n => [n.id, `${runId}-${n.id}`]));
    const remappedNodes = clonedNodes.map(n => ({
      ...n,
      id: idRemap.get(n.id) ?? n.id,
      parentWbsId: n.parentWbsId
        ? (idRemap.get(n.parentWbsId) ?? n.parentWbsId)
        : null,
      containerNodeId: n.containerNodeId
        ? (idRemap.get(n.containerNodeId) ?? n.containerNodeId)
        : null,
      phaseId: n.phaseId ? (idRemap.get(n.phaseId) ?? n.phaseId) : null,
      restoreTargetCheckpointId: n.restoreTargetCheckpointId
        ? (idRemap.get(n.restoreTargetCheckpointId) ??
          n.restoreTargetCheckpointId)
        : null,
    }));
    const remappedEdges = clonedEdges.map(e => ({
      ...e,
      sourceNodeId: idRemap.get(e.sourceNodeId) ?? e.sourceNodeId,
      targetNodeId: idRemap.get(e.targetNodeId) ?? e.targetNodeId,
    }));

    this.store.savepoint(() => {
      this.store.createRun(runRecord);
      this.store.replaceGraph(runId, remappedNodes, remappedEdges);
      initialize?.(runRecord);
      if (!registered) this.store.createCheckpoint({
        id: `cp-${randomUUID().slice(0, 8)}`,
        runId,
        nodeId: remappedNodes.find(n => n.kind === 'start')?.id ?? runId,
        label: `Initial Base (${version.versionTag})`,
        gitCommitSha: wt.baseCommitSha,
        gitTag: `orchestrator/${runId}/base`,
        rescueRef: null,
        completedNodeCount: 0,
        totalNodeCount: execNodes.length,
        engineSnapshotJson: JSON.stringify({versionTag: version.versionTag}),
        createdAt: now,
      });
      this.store.appendAudit({
        workflowId: wf.id,
        runId,
        category: 'execution',
        author: 'OrchestratorEngine',
        title: `Started run ${runId} (${version.versionTag})`,
        detail: `Worktree=${wt.worktreePath} branch=${wt.branchName}`,
      });
    });

    this.broadcast(
      'run.status',
      {workflowId: wf.id, runId},
      {status: 'running', versionTag: version.versionTag},
    );

    queueMicrotask(() => {
      this.schedulePump(runId);
    });

    return this.getRunDetail(runId);
  }

  pauseRun(runId: string): RunDetailSnapshot {
    const run = this.store.getRun(runId);
    if (run.status !== 'running' && run.status !== 'waiting_human') {
      return this.getRunDetail(runId);
    }

    this.activeAbortByRun.get(runId)?.abort();
    this.activeAbortByRun.delete(runId);

    // Revert any actively interrupted running nodes cleanly to `pending` so Resume continues seamlessly
    const nodes = this.store.listGraphNodes(runId);
    for (const n of nodes) {
      if (n.status === 'running') {
        this.store.updateNodeState(n.id, {status: 'pending'});
      }
    }

    this.store.updateRun(runId, {status: 'paused'});
    this.store.appendAudit({
      workflowId: run.workflowId,
      runId,
      category: 'execution',
      author: 'Operator',
      title: 'Paused workflow run',
      detail: 'Interrupted active tasks safely returned to pending queue.',
    });
    this.broadcast(
      'run.status',
      {workflowId: run.workflowId, runId},
      {status: 'paused'},
    );
    return this.getRunDetail(runId);
  }

  resumeRun(runId: string): RunDetailSnapshot {
    const run = this.store.getRun(runId);
    if (run.status !== 'paused' && run.status !== 'waiting_human') {
      return this.getRunDetail(runId);
    }
    this.store.updateRun(runId, {status: 'running'});
    this.store.appendAudit({
      workflowId: run.workflowId,
      runId,
      category: 'execution',
      author: 'Operator',
      title: 'Resumed workflow run',
      detail: 'Re-evaluating Twin-Graph frontier.',
    });
    this.broadcast(
      'run.status',
      {workflowId: run.workflowId, runId},
      {status: 'running'},
    );
    this.schedulePump(runId);
    return this.getRunDetail(runId);
  }

  cancelRun(runId: string): RunDetailSnapshot {
    const run = this.store.getRun(runId);
    if (this.hasHandler(run.workflowId)) {
      if (['succeeded', 'cancelled'].includes(run.status)) return this.getRunDetail(runId);
      if (this.store.listInterventions(runId).some(i => i.status === 'open')) {
        throw new OrchestratorError('CONFLICT', 'Resolve the open version-bound decision to end this run.', 409);
      }
    }
    this.activeAbortByRun.get(runId)?.abort();
    this.activeAbortByRun.delete(runId);
    this.store.updateRun(runId, {
      status: 'cancelled',
      finishedAt: new Date().toISOString(),
    });
    this.broadcast(
      'run.status',
      {workflowId: run.workflowId, runId},
      {status: 'cancelled'},
    );
    return this.getRunDetail(runId);
  }

  retryNode(runId: string, nodeId: string): RunDetailSnapshot {
    const run = this.store.getRun(runId);
    const node = this.store.listGraphNodes(runId).find(n => n.id === nodeId);
    if (!node) {
      throw new OrchestratorError('NOT_FOUND', `Node ${nodeId} not found`, 404);
    }
    if (this.hasHandler(run.workflowId) &&
        (run.status !== 'failed' || node.status !== 'failed')) {
      throw new OrchestratorError('CONFLICT', 'Only a failed execution step may be retried.', 409);
    }
    this.store.updateNodeState(node.id, {status: 'pending'});
    this.store.updateRun(runId, {status: 'running', finishedAt: null});
    this.store.appendAudit({
      workflowId: run.workflowId,
      runId,
      category: 'execution',
      author: 'Operator',
      title: `Manual Retry queued for ${node.code}`,
      detail: `Reset ${node.code} to pending and resumed frontier.`,
    });
    this.broadcast(
      'node.status',
      {workflowId: run.workflowId, runId, nodeId},
      {status: 'pending'},
    );
    this.schedulePump(runId);
    return this.getRunDetail(runId);
  }

  resolveIntervention(
    interventionId: string,
    req: ResolveInterventionRequest,
  ): RunDetailSnapshot {
    // A closed registered intervention must also be ineligible for the legacy resolver.
    const owner = this.store.db.prepare('SELECT run_id FROM interventions WHERE id = ?')
      .get(interventionId);
    if (owner) this.requireNativeRun(this.store.getRun(String(owner['run_id'])).workflowId);
    const action = req.action ?? 'approve';
    const item = this.store.resolveIntervention(
      interventionId,
      req.resolution,
      action === 'reject',
    );
    const run = this.store.getRun(item.runId);

    if (item.nodeId) {
      if (action === 'approve' || action === 'override') {
        this.store.updateNodeState(item.nodeId, {
          status: action === 'override' ? 'waived' : 'succeeded',
          outputSummary: `Human decision (${action}): ${req.resolution}`,
        });
      } else {
        this.store.updateNodeState(item.nodeId, {
          status: 'failed',
          outputSummary: `Human rejected: ${req.resolution}`,
        });
      }
    }

    const openRemaining = this.store
      .listInterventions(run.id)
      .filter(i => i.status === 'open');
    if (action === 'reject') {
      this.store.updateRun(run.id, {
        status: 'failed',
        finishedAt: new Date().toISOString(),
      });
    } else if (openRemaining.length === 0 && run.status !== 'paused') {
      this.store.updateRun(run.id, {status: 'running'});
      this.schedulePump(run.id);
    }

    this.broadcast(
      'intervention.resolved',
      {
        workflowId: run.workflowId,
        runId: run.id,
        nodeId: item.nodeId ?? undefined,
      },
      {interventionId, action, resolution: req.resolution},
    );
    return this.getRunDetail(run.id);
  }

  proposeGhostNode(
    runId: string,
    req: ProposeGhostNodeRequest,
  ): RunDetailSnapshot {
    const run = this.store.getRun(runId);
    this.requireNativeRun(run.workflowId);
    const nodes = this.store.listGraphNodes(runId);
    const edges = this.store.listGraphEdges(runId);
    const now = new Date().toISOString();
    const ghostId = `ghost-${randomUUID().slice(0, 8)}`;

    const ghostNode: GraphNode = {
      id: ghostId,
      scopeId: runId,
      code: `GHOST.${nodes.filter(n => n.kind === 'ghost').length + 1}`,
      parentWbsId: null,
      containerNodeId: null,
      phaseId: null,
      phaseTitle: 'Runtime Amendment',
      depth: 1,
      kind: 'ghost',
      executorKind: req.executorKind ?? 'agent',
      capabilityId: req.capabilityId ?? 'native-api',
      assignedRole: 'specialist',
      assignedModel: null,
      title: req.title,
      description: req.description,
      planningRationale:
        'Dynamic runtime amendment spliced without altering locked version snapshot.',
      requirementRefs: [],
      inputContract: 'Current Worktree State',
      outputContract: 'Amended Artifact & Diff',
      fileScope: [],
      gateCommand: req.gateCommand ?? null,
      branchCondition: null,
      status: 'pending',
      attemptCount: 0,
      maxAttempts: 2,
      collapsed: false,
      positionX: 520,
      positionY: 20,
      width: 220,
      height: 74,
      outputSummary: '',
      restoreTargetCheckpointId: null,
      updatedAt: now,
    };

    const spliced = spliceGhostNode({
      scopeId: runId,
      nodes,
      edges,
      ghostNode,
      insertBeforeNodeId: req.insertBeforeNodeId,
    });

    this.store.savepoint(() => {
      this.store.replaceGraph(runId, spliced.nodes, spliced.edges);
      this.store.recountRunProgress(runId);
      this.store.appendAudit({
        workflowId: run.workflowId,
        runId,
        category: 'execution',
        author: 'Operator',
        title: `Spliced runtime GhostNode ${ghostNode.code}`,
        detail: `${req.title} (locked version snapshot untouched).`,
      });
    });

    if (run.status === 'running') {
      this.schedulePump(runId);
    }
    return this.getRunDetail(runId);
  }

  async manualRestoreCheckpoint(
    runId: string,
    checkpointId: string,
  ): Promise<RunDetailSnapshot> {
    const run = this.store.getRun(runId);
    this.requireNativeRun(run.workflowId);
    const cp = this.store
      .listCheckpoints(runId)
      .find(c => c.id === checkpointId);
    if (!cp) {
      throw new OrchestratorError(
        'NOT_FOUND',
        `Checkpoint ${checkpointId} not found`,
        404,
      );
    }

    this.activeAbortByRun.get(runId)?.abort();
    const rewound = await this.worktrees.rewindToCheckpoint({
      worktreePath: run.worktreePath,
      runCode: run.id,
      targetCommitSha: cp.gitCommitSha,
    });

    const nodes = this.store.listGraphNodes(runId);
    const edges = this.store.listGraphEdges(runId);
    const rewindIds = computeRewindSet(nodes, edges, cp.nodeId);

    this.store.savepoint(() => {
      for (const n of nodes) {
        if (rewindIds.has(n.id)) {
          this.store.updateNodeState(n.id, {
            status: 'pending',
            outputSummary: `Rewound via rescue ref ${rewound.rescueRef}`,
          });
        }
      }
      this.store.createCheckpoint({
        id: `cp-${randomUUID().slice(0, 8)}`,
        runId,
        nodeId: cp.nodeId,
        label: `Rewound -> ${cp.label}`,
        gitCommitSha: rewound.restoredCommitSha,
        gitTag: `orchestrator/${runId}/rewind-${Date.now()}`,
        rescueRef: rewound.rescueRef,
        completedNodeCount: run.completedNodes,
        totalNodeCount: run.totalNodes,
        engineSnapshotJson: JSON.stringify({rewoundFrom: checkpointId}),
        createdAt: new Date().toISOString(),
      });
      this.store.updateRun(runId, {status: 'running', finishedAt: null});
      this.store.recountRunProgress(runId);
      this.store.appendAudit({
        workflowId: run.workflowId,
        runId,
        category: 'checkpoint',
        author: 'RecoveryController',
        title: `Restored worktree to ${cp.label}`,
        detail: `Rescue ref preserved: ${rewound.rescueRef}`,
      });
    });

    this.schedulePump(runId);
    return this.getRunDetail(runId);
  }

  getRunDetail(runId: string): RunDetailSnapshot {
    const run = this.store.getRun(runId);
    const version = this.store.getVersion(run.versionId);
    const nodes = this.store.listGraphNodes(runId);
    const workflow = this.store.getWorkflow(run.workflowId);
    return {
      run,
      version,
      nodes,
      edges: this.store.listGraphEdges(runId),
      attempts: this.store.listAttempts(runId),
      checkpoints: this.store.listCheckpoints(runId),
      interventions: this.store.listInterventions(runId),
      sessions: this.store.listSessionsForRun(runId),
      recentAudit: this.store.listRecentAudit(50, runId),
      rehydrationCapsule: buildRehydrationCapsule({
        workflow,
        goalSpec: version.goalSpec,
        nodes,
        latestRun: run,
      }),
    };
  }

  schedulePump(runId: string): void {
    if (this.stopping) return;
    const run = this.store.getRun(runId);
    if (run.status !== 'running') {
      return;
    }

    const openInterventions = this.store
      .listInterventions(runId)
      .filter(i => i.status === 'open');
    if (openInterventions.length > 0) {
      this.store.updateRun(runId, {status: 'waiting_human'});
      this.broadcast(
        'run.status',
        {workflowId: run.workflowId, runId},
        {status: 'waiting_human'},
      );
      return;
    }

    const nodesNow = this.store.listGraphNodes(runId);
    const edges = this.store.listGraphEdges(runId);
    const toLaunch: GraphNode[] = [];

    for (let wave = 0; wave < 24; wave += 1) {
      const latestNodes = this.store.listGraphNodes(runId);
      const frontier = computeNextFrontier(latestNodes, edges);
      if (frontier.skipNodeIds.length > 0) {
        for (const skipId of frontier.skipNodeIds) {
          const updated = this.store.updateNodeState(skipId, {
            status: 'skipped',
            outputSummary: 'Bypassed via conditional branch selection.',
          });
          this.store.recordAttempt({
            id: `att-${randomUUID().slice(0, 8)}`,
            runId,
            nodeId: updated.id,
            nodeCode: updated.code,
            attemptNumber: updated.attemptCount,
            executorKind: updated.executorKind,
            capabilityId: updated.capabilityId,
            model: updated.assignedModel ?? '',
            status: 'skipped',
            exitCode: 0,
            durationSec: 0,
            inputSnapshotJson: '{}',
            outputSummary: updated.outputSummary,
            errorMessage: '',
            sessionId: null,
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
          });
          this.broadcast(
            'node.status',
            {workflowId: run.workflowId, runId, nodeId: updated.id},
            {status: 'skipped', code: updated.code},
          );
        }
        continue;
      }

      for (const readyId of frontier.readyNodeIds) {
        const node = latestNodes.find(n => n.id === readyId);
        if (!node || node.status !== 'pending') {
          continue;
        }
        const claimed = this.store.updateNodeState(node.id, {
          status: 'running',
          attemptCount: node.attemptCount + 1,
        });
        this.broadcast(
          'node.status',
          {workflowId: run.workflowId, runId, nodeId: claimed.id},
          {status: 'running', code: claimed.code},
        );
        toLaunch.push(claimed);
      }
      break;
    }

    if (toLaunch.length === 0) {
      const runningCount = nodesNow.filter(n => n.status === 'running').length;
      const inFlight = this.activeTaskCountByRun.get(runId) ?? 0;
      const doneNode = this.store
        .listGraphNodes(runId)
        .find(n => n.kind === 'done');
      if (runningCount === 0 && inFlight === 0) {
        const updatedRun = this.store.recountRunProgress(runId);
        if (doneNode?.status === 'succeeded') {
          this.store.updateRun(runId, {
            status: 'succeeded',
            finishedAt: new Date().toISOString(),
          });
          this.broadcast(
            'run.status',
            {workflowId: run.workflowId, runId},
            {status: 'succeeded'},
          );
        } else if (updatedRun.failedNodes > 0) {
          this.store.updateRun(runId, {
            status: 'failed',
            finishedAt: new Date().toISOString(),
          });
          this.broadcast(
            'run.status',
            {workflowId: run.workflowId, runId},
            {status: 'failed'},
          );
        }
      }
      return;
    }

    let controller = this.activeAbortByRun.get(runId);
    if (!controller || controller.signal.aborted) {
      controller = new AbortController();
      this.activeAbortByRun.set(runId, controller);
    }

    for (const node of toLaunch) {
      this.activeTaskCountByRun.set(
        runId,
        (this.activeTaskCountByRun.get(runId) ?? 0) + 1,
      );
      const task = this.executeNode(runId, node, controller.signal).finally(() => {
        this.tasks.delete(task);
        const nextCount = Math.max(
          0,
          (this.activeTaskCountByRun.get(runId) ?? 1) - 1,
        );
        this.activeTaskCountByRun.set(runId, nextCount);
        const latestRun = this.store.getRun(runId);
        if (latestRun.status === 'running') {
          this.schedulePump(runId);
        }
      });
      this.tasks.add(task);
    }
  }

  private async executeNode(
    runId: string,
    node: GraphNode,
    signal: AbortSignal,
  ): Promise<void> {
    const run = this.store.getRun(runId);
    const version = this.store.getVersion(run.versionId);
    const goalSpec: GoalSpec = version.goalSpec;
    const attemptId = `att-${randomUUID().slice(0, 8)}`;
    const startedAt = new Date().toISOString();

    this.store.recordAttempt({
      id: attemptId,
      runId,
      nodeId: node.id,
      nodeCode: node.code,
      attemptNumber: node.attemptCount,
      executorKind: node.executorKind,
      capabilityId: node.capabilityId,
      model: node.assignedModel ?? '',
      status: 'running',
      exitCode: null,
      durationSec: 0,
      inputSnapshotJson: JSON.stringify({
        inputContract: node.inputContract,
        requirementRefs: node.requirementRefs,
      }),
      outputSummary: '',
      errorMessage: '',
      sessionId: null,
      startedAt,
      finishedAt: null,
    });

    try {
      if (signal.aborted || this.store.getRun(runId).status !== 'running') {
        this.store.updateNodeState(node.id, {status: 'pending'});
        return;
      }

      const handler = this.handler(run.workflowId);
      if (handler?.handles(node)) {
        const context = {run, node, attemptId};
        const result = await handler.execute(context, signal);
        if (this.isCurrentRegisteredAttempt(context, signal)) {
          this.store.savepoint(() => this.finishRegisteredStep(context, result, startedAt));
        } else {
          this.markInterrupted(attemptId);
        }
        return;
      }

      if (
        node.kind === 'start' ||
        node.kind === 'join' ||
        node.kind === 'done'
      ) {
        const summary =
          node.kind === 'done'
            ? 'All upstream gates & checkpoints certified; run complete.'
            : `${node.code} control synchronization complete.`;
        this.finishNodeSuccess(
          runId,
          run.workflowId,
          node,
          attemptId,
          startedAt,
          summary,
          null,
        );
        return;
      }

      if (node.kind === 'decision') {
        const summary =
          node.outputSummary.trim() ||
          JSON.stringify({
            selectedBranch: node.branchCondition || 'standard',
          });
        this.finishNodeSuccess(
          runId,
          run.workflowId,
          node,
          attemptId,
          startedAt,
          summary,
          null,
        );
        return;
      }

      if (node.kind === 'human_gate') {
        const intItem = this.store.createIntervention({
          runId,
          nodeId: node.id,
          kind: 'human_gate',
          question: `Human Gate (${node.code}): ${node.title}`,
          contextSnippet: `${node.description}\nInput Contract: ${node.inputContract}`,
          options: ['Approve & Continue', 'Waive Gate', 'Reject & Stop'],
          recommendedIndex: 0,
          downstreamBlockedCount: 1,
        });
        this.store.updateNodeState(node.id, {status: 'waiting_human'});
        this.store.updateRun(runId, {status: 'waiting_human'});
        this.broadcast(
          'intervention.created',
          {workflowId: run.workflowId, runId, nodeId: node.id},
          {interventionId: intItem.id, question: intItem.question},
        );
        return;
      }

      if (node.kind === 'checkpoint') {
        const commitRes = await this.worktrees.createCheckpoint({
          worktreePath: run.worktreePath,
          runCode: run.id,
          nodeCode: node.code,
          message: `chore(${run.id}): checkpoint ${node.code} verified`,
        });
        const progressed = this.store.recountRunProgress(runId);
        const cp: CheckpointRecord = {
          id: `cp-${randomUUID().slice(0, 8)}`,
          runId,
          nodeId: node.id,
          label: `${node.code} Verified Snapshot`,
          gitCommitSha: commitRes.commitSha,
          gitTag: commitRes.gitTag,
          rescueRef: null,
          completedNodeCount: progressed.completedNodes,
          totalNodeCount: progressed.totalNodes,
          engineSnapshotJson: JSON.stringify({
            changedFiles: commitRes.changedFiles,
          }),
          createdAt: new Date().toISOString(),
        };
        this.store.createCheckpoint(cp);
        this.broadcast(
          'checkpoint.created',
          {workflowId: run.workflowId, runId, nodeId: node.id},
          {checkpointId: cp.id, gitTag: cp.gitTag},
        );
        this.finishNodeSuccess(
          runId,
          run.workflowId,
          node,
          attemptId,
          startedAt,
          `Created Git checkpoint ${commitRes.gitTag} (${commitRes.commitSha.slice(0, 8)})`,
          null,
        );
        return;
      }

      if (node.kind === 'restore') {
        if (run.reworkCount >= run.maxReworkIterations) {
          this.finishNodeFailure(
            runId,
            run.workflowId,
            node,
            attemptId,
            startedAt,
            1,
            `Bounded rework budget exhausted (${run.reworkCount}/${run.maxReworkIterations}).`,
            null,
          );
          this.store.createIntervention({
            runId,
            nodeId: node.id,
            kind: 'escalation',
            question: `Rework limit reached (${run.maxReworkIterations}) at ${node.code}`,
            contextSnippet:
              'Choose whether to retry a gate manually or abort run.',
            options: ['Manual Retry Gate', 'Cancel Run'],
          });
          this.store.updateRun(runId, {status: 'waiting_human'});
          return;
        }

        const cps = this.store.listCheckpoints(runId);
        const latestCp = cps[0];
        const targetSha = latestCp?.gitCommitSha ?? run.baseCommitSha;
        const rewound = await this.worktrees.rewindToCheckpoint({
          worktreePath: run.worktreePath,
          runCode: run.id,
          targetCommitSha: targetSha,
        });

        const edges = this.store.listGraphEdges(runId);
        const loopEdge = edges.find(
          e => e.sourceNodeId === node.id && e.kind === 'loop',
        );
        const targetNodeId =
          node.restoreTargetCheckpointId ?? loopEdge?.targetNodeId ?? node.id;
        const resetSet = computeRewindSet(
          this.store.listGraphNodes(runId),
          edges,
          targetNodeId,
        );

        this.store.savepoint(() => {
          for (const id of resetSet) {
            this.store.updateNodeState(id, {status: 'pending'});
          }
          this.store.updateRun(runId, {reworkCount: run.reworkCount + 1});
          this.store.appendAudit({
            workflowId: run.workflowId,
            runId,
            category: 'checkpoint',
            author: 'RecoveryController',
            title: `Bounded rework #${run.reworkCount + 1} rewound via ${rewound.rescueRef}`,
            detail: `Reset ${resetSet.size} node(s) from ${node.code}`,
          });
        });

        const summary = `Rewound ${resetSet.size} nodes cleanly via rescue ref ${rewound.rescueRef}`;
        this.finishNodeSuccess(
          runId,
          run.workflowId,
          node,
          attemptId,
          startedAt,
          summary,
          null,
        );
        // Re-arm restore node so subsequent rework iterations within budget still trigger,
        // and clean gate/QA passes skip it automatically.
        this.store.updateNodeState(node.id, {
          status: 'pending',
          outputSummary: summary,
        });
        this.store.recountRunProgress(runId);
        return;
      }

      if (node.kind === 'gate_shell') {
        const res = await this.certifier.runShellGate(run, node);
        if (res.passed) {
          this.finishNodeSuccess(
            runId,
            run.workflowId,
            node,
            attemptId,
            startedAt,
            res.summary,
            res.sessionId,
          );
        } else {
          this.finishNodeFailure(
            runId,
            run.workflowId,
            node,
            attemptId,
            startedAt,
            res.exitCode,
            res.errorMessage,
            res.sessionId,
          );
        }
        return;
      }

      if (node.kind === 'selfcheck') {
        const res = await this.certifier.runSelfCheck(run, goalSpec);
        this.finishNodeSuccess(
          runId,
          run.workflowId,
          node,
          attemptId,
          startedAt,
          res.summary,
          res.sessionId,
        );
        return;
      }

      if (node.kind === 'qa_audit') {
        const res = await this.certifier.runQaAudit(
          run,
          node,
          goalSpec,
          signal,
          chunk => {
            this.broadcast(
              'session.chunk',
              {workflowId: run.workflowId, runId, nodeId: node.id},
              {chunk},
            );
          },
        );
        if (res.passed) {
          this.finishNodeSuccess(
            runId,
            run.workflowId,
            node,
            attemptId,
            startedAt,
            res.summary,
            res.sessionId,
            {
              inputTokens: res.inputTokens,
              cachedTokens: res.cachedTokens,
              outputTokens: res.outputTokens,
            },
          );
        } else {
          this.finishNodeFailure(
            runId,
            run.workflowId,
            node,
            attemptId,
            startedAt,
            res.exitCode,
            res.errorMessage,
            res.sessionId,
            {
              inputTokens: res.inputTokens,
              cachedTokens: res.cachedTokens,
              outputTokens: res.outputTokens,
            },
          );
        }
        return;
      }

      // `task` or `ghost`
      const cap =
        this.store.listCapabilities().find(c => c.id === node.capabilityId) ??
        this.store.listCapabilities().find(c => c.id === 'native-api')!;
      const model = node.assignedModel || cap.defaultModel;
      const session = this.store.createSession({
        runId,
        nodeId: node.id,
        capabilityId: cap.id,
        model,
        role: node.assignedRole,
      });

      const dddGlossary = renderUbiquitousLanguageSection(
        this.store.listDomainTerms().slice(0, 5),
      );
      const constitution = this.store.getConstitutionRule();
      const topSkills = this.store
        .listSkills()
        .slice(0, 2)
        .map(s => `- ${s.title}: ${s.content}`)
        .join('\n');
      const systemPrompt = [
        cap.sovereignSoul,
        constitution.markdown
          ? `Engineering Constitution:\n${constitution.markdown}`
          : '',
        dddGlossary,
        topSkills ? `Active SkillsBank Patterns:\n${topSkills}` : '',
      ]
        .filter(Boolean)
        .join('\n\n');

      const upstreamLines = this.buildUpstreamSummaryLines(runId, node.id);
      const userPrompt = [
        `Workflow Goal: ${goalSpec.goal}`,
        `Node: ${node.code} — ${node.title}`,
        `Description: ${node.description}`,
        `Requirements: ${node.requirementRefs.join(', ') || 'General'}`,
        `Input Contract: ${node.inputContract}`,
        `Output Contract: ${node.outputContract}`,
        ...(upstreamLines.length > 0
          ? ['Upstream Completed Outputs:', ...upstreamLines]
          : []),
      ].join('\n');

      this.store.appendSessionMessage({
        sessionId: session.id,
        role: 'user',
        content: userPrompt,
      });

      const result = await this.hub.invokeCapability({
        sessionId: session.id,
        runId,
        nodeId: node.id,
        nodeCode: node.code,
        role: node.assignedRole,
        capability: cap,
        model,
        permissionTier: run.permissionTier,
        cwd: run.worktreePath,
        systemPrompt,
        userPrompt,
        gateCommand: node.gateCommand,
        fileScope: node.fileScope,
        readOnly: false,
        signal,
        onChunk: (role, content, toolName) => {
          this.store.appendSessionMessage({
            sessionId: session.id,
            role,
            content,
            toolName,
          });
          this.broadcast(
            'session.chunk',
            {workflowId: run.workflowId, runId, nodeId: node.id},
            {sessionId: session.id, role, content},
          );
        },
      });

      if (signal.aborted || this.store.getRun(runId).status === 'paused') {
        this.store.finishSession(session.id, 'failed');
        this.store.updateNodeState(node.id, {status: 'pending'});
        return;
      }

      if (result.outcome === 'completed') {
        this.store.finishSession(session.id, 'completed');
        this.finishNodeSuccess(
          runId,
          run.workflowId,
          node,
          attemptId,
          startedAt,
          result.finalText.slice(0, 1200),
          session.id,
          {
            inputTokens: result.inputTokens,
            cachedTokens: result.cachedTokens,
            outputTokens: result.outputTokens,
          },
        );
      } else {
        this.store.finishSession(session.id, 'failed');
        this.finishNodeFailure(
          runId,
          run.workflowId,
          node,
          attemptId,
          startedAt,
          result.exitCode,
          result.errorMessage || result.outcome,
          session.id,
          {
            inputTokens: result.inputTokens,
            cachedTokens: result.cachedTokens,
            outputTokens: result.outputTokens,
          },
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (this.hasHandler(run.workflowId) &&
          !this.isCurrentRegisteredAttempt({run, node, attemptId}, signal)) {
        this.markInterrupted(attemptId);
        return;
      }
      if (signal.aborted || this.store.getRun(runId).status === 'paused') {
        this.store.updateNodeState(node.id, {status: 'pending'});
        return;
      }
      this.finishNodeFailure(
        runId,
        run.workflowId,
        node,
        attemptId,
        startedAt,
        1,
        msg,
        null,
      );
    }
  }

  private isCurrentRegisteredAttempt(context: WorkflowStepContext, signal: AbortSignal): boolean {
    const {run, node} = context;
    const status = this.store.getRun(run.id).status;
    const current = this.store.listGraphNodes(run.id).find(item => item.id === node.id);
    return !signal.aborted && (status === 'running' || status === 'waiting_human') &&
      current?.status === 'running' && current.attemptCount === node.attemptCount;
  }

  private markInterrupted(attemptId: string): void {
    this.store.db.prepare(`UPDATE node_attempts SET status = 'failed', exit_code = 1,
      error_message = 'Execution interrupted', finished_at = ? WHERE id = ? AND status = 'running'`)
      .run(new Date().toISOString(), attemptId);
  }

  recoverRegisteredRuns(): void {
    for (const run of this.store.listRuns().filter(run => this.hasHandler(run.workflowId))) {
      if (!['running', 'paused', 'waiting_human'].includes(run.status)) continue;
      this.store.savepoint(() => {
        for (const node of this.store.listGraphNodes(run.id)) {
          if (node.status === 'running') this.store.updateNodeState(node.id, {status: 'pending'});
        }
        const waiting = new Set(this.store.listGraphNodes(run.id)
          .filter(node => node.status === 'waiting_human').map(node => node.id));
        for (const attempt of this.store.listAttempts(run.id)) {
          if (attempt.status === 'running' && !waiting.has(attempt.nodeId)) this.markInterrupted(attempt.id);
        }
      });
      if (run.status === 'running') queueMicrotask(() => this.schedulePump(run.id));
    }
  }

  async shutdown(): Promise<void> {
    this.stopping = true;
    for (const controller of this.activeAbortByRun.values()) controller.abort();
    await Promise.allSettled(this.tasks);
  }

  resolveRegisteredIntervention(runId: string, interventionId: string, input: unknown): RunDetailSnapshot {
    this.store.savepoint(() => {
      const run = this.store.getRun(runId);
      const handler = this.handler(run.workflowId);
      const item = this.store.listInterventions(runId).find(entry => entry.id === interventionId);
      const node = this.store.listGraphNodes(runId).find(entry => entry.id === item?.nodeId);
      const attempt = this.store.listAttempts(runId)
        .find(entry => entry.nodeId === node?.id && entry.attemptNumber === node?.attemptCount);
      if (!handler || !item || !node || !attempt) {
        throw new OrchestratorError('NOT_FOUND', 'Registered intervention not found.', 404);
      }
      const context = {run, node, attemptId: attempt.id};
      const result = handler.resolve(context, interventionId, input);
      if (!result) return;
      if (item.status !== 'open' || node.status !== 'waiting_human' ||
          !['waiting_human', 'paused'].includes(run.status)) {
        throw new OrchestratorError('CONFLICT', 'The intervention is no longer active.', 409);
      }
      this.store.resolveIntervention(item.id, result.summary, result.stop);
      if (run.status !== 'paused') this.store.updateRun(run.id, {status: 'running'});
      this.finishRegisteredStep(context, result, attempt.startedAt);
      this.broadcast('intervention.resolved', {workflowId: run.workflowId, runId, nodeId: node.id},
        {interventionId});
    });
    this.schedulePump(runId);
    return this.getRunDetail(runId);
  }

  private finishRegisteredStep(context: WorkflowStepContext, result: WorkflowStepResult, startedAt: string): void {
    const {run, node, attemptId} = context;
    const ids = {workflowId: run.workflowId, runId: run.id, nodeId: node.id};
    result.commit?.();
    if (result.wait) {
      const item = this.store.createIntervention({
        runId: run.id, nodeId: node.id, kind: 'human_gate',
        question: result.wait.question, contextSnippet: result.wait.contextSnippet,
        options: result.wait.options,
      });
      result.wait.bind(item.id);
      this.store.updateNodeState(node.id, {status: 'waiting_human', outputSummary: result.summary});
      if (this.store.getRun(run.id).status !== 'paused') this.store.updateRun(run.id, {status: 'waiting_human'});
      this.broadcast('intervention.created', ids, {interventionId: item.id, question: item.question});
      return;
    }
    const summary = result.selectedBranch === undefined ? result.summary :
      JSON.stringify({selectedBranch: result.selectedBranch, summary: result.summary});
    this.finishNodeSuccess(run.id, run.workflowId, node, attemptId, startedAt, summary, null);
    if (result.stop) {
      this.store.updateRun(run.id, {status: 'cancelled', finishedAt: new Date().toISOString()});
      this.broadcast('run.status', ids, {status: 'cancelled'});
    }
    if (result.repeatFrom) {
      const nodes = this.store.listGraphNodes(run.id);
      const target = nodes.find(item => item.code === result.repeatFrom);
      if (!target) throw new Error('Registered workflow repeat target missing');
      const reset = new Set([target.id]);
      const edges = this.store.listGraphEdges(run.id).filter(edge => edge.kind !== 'loop');
      for (const id of reset) {
        for (const edge of edges) if (edge.sourceNodeId === id) reset.add(edge.targetNodeId);
      }
      for (const id of reset) this.store.updateNodeState(id, {status: 'pending', outputSummary: ''});
      const current = this.store.getRun(run.id);
      if (result.countRework !== false) this.store.updateRun(run.id, {reworkCount: current.reworkCount + 1});
      this.store.recountRunProgress(run.id);
      this.broadcast('run.status', ids, {status: current.status, repeatFrom: result.repeatFrom});
    }
  }

  private buildUpstreamSummaryLines(runId: string, nodeId: string): string[] {
    const allNodes = this.store.listGraphNodes(runId);
    const allEdges = this.store.listGraphEdges(runId);
    const byId = new Map(allNodes.map(n => [n.id, n]));

    const incomingSources = new Map<string, string[]>();
    for (const e of allEdges) {
      if (e.kind === 'loop') {
        continue;
      }
      const list = incomingSources.get(e.targetNodeId) ?? [];
      list.push(e.sourceNodeId);
      incomingSources.set(e.targetNodeId, list);
    }

    const directParentIds = new Set(incomingSources.get(nodeId) ?? []);
    const visited = new Set<string>([nodeId]);
    const queue = [...directParentIds];
    const collected: GraphNode[] = [];

    while (queue.length > 0) {
      const srcId = queue.shift()!;
      if (visited.has(srcId)) {
        continue;
      }
      visited.add(srcId);
      const src = byId.get(srcId);
      if (!src) {
        continue;
      }
      const isDone = src.status === 'succeeded' || src.status === 'waived';
      const hasSummary = src.outputSummary.trim().length > 0;
      if (
        isDone &&
        hasSummary &&
        (directParentIds.has(src.id) ||
          src.kind === 'task' ||
          src.kind === 'ghost')
      ) {
        collected.push(src);
      }
      for (const parentId of incomingSources.get(srcId) ?? []) {
        if (!visited.has(parentId)) {
          queue.push(parentId);
        }
      }
    }

    return collected.slice(0, 6).map(src => {
      const snippet = src.outputSummary
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 240);
      return `- ${src.code} (${src.title}): ${snippet}`;
    });
  }

  private computeAttemptCost(
    modelId: string,
    usage?: {
      readonly inputTokens?: number;
      readonly cachedTokens?: number;
      readonly outputTokens?: number;
    },
  ): {
    readonly inputTokens: number;
    readonly cachedTokens: number;
    readonly outputTokens: number;
    readonly costUsd: number;
  } {
    const inputTokens = usage?.inputTokens ?? 0;
    const cachedTokens = usage?.cachedTokens ?? 0;
    const outputTokens = usage?.outputTokens ?? 0;
    if (inputTokens === 0 && cachedTokens === 0 && outputTokens === 0) {
      return {inputTokens: 0, cachedTokens: 0, outputTokens: 0, costUsd: 0};
    }

    const providers = this.store.listModelProviders(() => ({
      hasApiKey: false,
      maskedKeyHint: '',
    }));
    let inRate = 0.55;
    let cacheRate = 0.14;
    let outRate = 2.19;
    for (const p of providers) {
      const m = p.models.find(item => item.id === modelId);
      if (m) {
        inRate = m.inputUsdPerMillion;
        cacheRate = m.cachedInputUsdPerMillion;
        outRate = m.outputUsdPerMillion;
        break;
      }
    }
    const costUsd = Number(
      (
        (inputTokens * inRate +
          cachedTokens * cacheRate +
          outputTokens * outRate) /
        1_000_000
      ).toFixed(6),
    );
    return {inputTokens, cachedTokens, outputTokens, costUsd};
  }

  private addRunUsage(
    runId: string,
    metrics: {
      readonly inputTokens: number;
      readonly cachedTokens: number;
      readonly outputTokens: number;
      readonly costUsd: number;
    },
  ): void {
    if (
      metrics.inputTokens === 0 &&
      metrics.cachedTokens === 0 &&
      metrics.outputTokens === 0 &&
      metrics.costUsd === 0
    ) {
      return;
    }
    const curr = this.store.getRun(runId);
    this.store.updateRun(runId, {
      spentUsd: Number(((curr.spentUsd ?? 0) + metrics.costUsd).toFixed(6)),
      inputTokens: (curr.inputTokens ?? 0) + metrics.inputTokens,
      cachedTokens: (curr.cachedTokens ?? 0) + metrics.cachedTokens,
      outputTokens: (curr.outputTokens ?? 0) + metrics.outputTokens,
    });
  }

  private finishNodeSuccess(
    runId: string,
    workflowId: string,
    node: GraphNode,
    attemptId: string,
    startedAt: string,
    summary: string,
    sessionId: string | null,
    usage?: {
      readonly inputTokens?: number;
      readonly cachedTokens?: number;
      readonly outputTokens?: number;
    },
  ): void {
    const finishedAt = new Date().toISOString();
    const durationSec = Math.max(
      0.01,
      Number(
        ((Date.parse(finishedAt) - Date.parse(startedAt)) / 1000).toFixed(2),
      ),
    );
    const metrics = this.computeAttemptCost(node.assignedModel ?? '', usage);
    this.store.updateNodeState(node.id, {
      status: 'succeeded',
      outputSummary: summary,
    });
    this.store.recordAttempt({
      id: attemptId,
      runId,
      nodeId: node.id,
      nodeCode: node.code,
      attemptNumber: node.attemptCount,
      executorKind: node.executorKind,
      capabilityId: node.capabilityId,
      model: node.assignedModel ?? '',
      status: 'succeeded',
      exitCode: 0,
      durationSec,
      inputSnapshotJson: JSON.stringify({inputContract: node.inputContract}),
      outputSummary: summary,
      errorMessage: '',
      sessionId,
      inputTokens: metrics.inputTokens,
      cachedTokens: metrics.cachedTokens,
      outputTokens: metrics.outputTokens,
      costUsd: metrics.costUsd,
      startedAt,
      finishedAt,
    });
    this.addRunUsage(runId, metrics);
    this.store.recountRunProgress(runId);
    this.broadcast(
      'node.status',
      {workflowId, runId, nodeId: node.id},
      {status: 'succeeded', code: node.code, summary},
    );
  }

  private finishNodeFailure(
    runId: string,
    workflowId: string,
    node: GraphNode,
    attemptId: string,
    startedAt: string,
    exitCode: number,
    errorMessage: string,
    sessionId: string | null,
    usage?: {
      readonly inputTokens?: number;
      readonly cachedTokens?: number;
      readonly outputTokens?: number;
    },
  ): void {
    const finishedAt = new Date().toISOString();
    const durationSec = Math.max(
      0.01,
      Number(
        ((Date.parse(finishedAt) - Date.parse(startedAt)) / 1000).toFixed(2),
      ),
    );
    const metrics = this.computeAttemptCost(node.assignedModel ?? '', usage);
    this.store.updateNodeState(node.id, {
      status: 'failed',
      outputSummary: errorMessage,
    });
    this.store.recordAttempt({
      id: attemptId,
      runId,
      nodeId: node.id,
      nodeCode: node.code,
      attemptNumber: node.attemptCount,
      executorKind: node.executorKind,
      capabilityId: node.capabilityId,
      model: node.assignedModel ?? '',
      status: 'failed',
      exitCode,
      durationSec,
      inputSnapshotJson: JSON.stringify({inputContract: node.inputContract}),
      outputSummary: '',
      errorMessage,
      sessionId,
      inputTokens: metrics.inputTokens,
      cachedTokens: metrics.cachedTokens,
      outputTokens: metrics.outputTokens,
      costUsd: metrics.costUsd,
      startedAt,
      finishedAt,
    });
    this.addRunUsage(runId, metrics);
    this.store.recountRunProgress(runId);
    this.store.appendAudit({
      workflowId,
      runId,
      category: 'execution',
      author: 'OrchestratorEngine',
      title: `Node ${node.code} failed`,
      detail: errorMessage,
    });
    this.broadcast(
      'node.status',
      {workflowId, runId, nodeId: node.id},
      {status: 'failed', code: node.code, errorMessage},
    );
  }
}
