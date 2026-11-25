/**
 * Specification, Decomposition, Validation, Change Impact, Trial Run & Version
 * Snapshot Engine.
 */

import {randomUUID} from 'node:crypto';
import type {ProviderSecretLookup} from '../adapters/contracts.ts';
import {
  analyzeChangeImpact,
  parseRequirementsMarkdown,
  planTwinGraphFromGoalSpec,
  runTrialSimulation,
  validateWorkflowSpec,
} from '../core/index.ts';
import type {
  ConfirmVersionRequest,
  ImportRequirementsRequest,
  UpdateDraftGraphRequest,
  UpdateGoalSpecRequest,
  WorkflowDetailSnapshot,
} from '../shared/api.ts';
import {OrchestratorError} from '../shared/errors.ts';
import type {
  GoalSpec,
  GraphEdge,
  GraphNode,
  PmDecompositionReport,
  WorkflowCustomization,
  WorkflowVersionSnapshot,
} from '../shared/types.ts';
import type {OrchestratorStore} from '../store/database.ts';
import {PmAgentDecomposer} from './pm-agent.ts';

export class WorkflowPlannerEngine {
  private readonly store: OrchestratorStore;
  private readonly pmAgent: PmAgentDecomposer;
  private readonly onBroadcast: (
    type: 'workflow.updated' | 'audit.appended',
    workflowId: string,
    payload: Record<string, unknown>,
  ) => void;

  constructor(
    store: OrchestratorStore,
    onBroadcast: (
      type: 'workflow.updated' | 'audit.appended',
      workflowId: string,
      payload: Record<string, unknown>,
    ) => void,
    resolveProvider?: ProviderSecretLookup,
  ) {
    this.store = store;
    this.pmAgent = new PmAgentDecomposer(store, resolveProvider);
    this.onBroadcast = onBroadcast;
  }

  private persistImportedWorkflow(args: {
    readonly workflowId: string;
    readonly workspaceId: string;
    readonly verifyCommand: string;
    readonly permissionTier: 'turbo' | 'supervised' | 'strict';
    readonly maxReworkIterations: number;
    readonly goalSpec: GoalSpec;
    readonly report: PmDecompositionReport;
    readonly customization: WorkflowCustomization;
    readonly deferBroadcast?: (publish: () => void) => void;
  }): WorkflowDetailSnapshot {
    const {
      workflowId,
      workspaceId,
      verifyCommand,
      permissionTier,
      maxReworkIterations,
      goalSpec,
      report,
      customization,
    } = args;
    const capabilities = this.store.listCapabilities();
    const health = this.store.listCapabilityHealth();
    const domainTerms = this.store.listDomainTerms(workspaceId);
    const planned = planTwinGraphFromGoalSpec({
      scopeId: workflowId,
      goalSpec,
      capabilities,
      healthProfiles: health,
      permissionTier,
      verifyCommand,
      customization,
      pmSlices: report.slices,
      domainTerms: customization.dddStrictCheck ? domainTerms : [],
    });

    const validation = validateWorkflowSpec({
      workflowId,
      goalSpec,
      nodes: planned.nodes,
      edges: planned.edges,
      capabilities,
      healthProfiles: health,
      permissionTier,
      maxReworkIterations,
      domainTerms,
      dddStrictCheck: customization.dddStrictCheck,
    });

    this.store.savepoint(() => {
      const wf = this.store.createWorkflowRecord({
        id: workflowId,
        workspaceId,
        title: goalSpec.title,
        description: goalSpec.goal,
        permissionTier,
        verifyCommand,
        maxReworkIterations,
        customization,
      });
      this.store.updateWorkflowMeta(wf.id, {
        status: validation.valid ? 'validated' : 'draft',
        customization,
      });
      this.store.saveGoalSpec(goalSpec);
      this.store.savePmReport(report);
      this.store.replaceGraph(wf.id, planned.nodes, planned.edges);
      this.store.saveValidationReport(validation);
      this.store.appendAudit({
        workflowId: wf.id,
        runId: null,
        category: 'spec',
        author: `PM Agent (${report.mode})`,
        title: `Imported Design Spec & planned ${planned.nodes.length} nodes`,
        detail: `${report.pmNarrative} (${goalSpec.requirements.length} FRs, ${goalSpec.acceptanceCriteria.length} ACs, ${validation.errorCount} blocking errors, ${validation.warningCount} warnings).`,
      });
    });

    const publish = () => this.onBroadcast('workflow.updated', workflowId, {action: 'imported'});
    if (args.deferBroadcast) args.deferBroadcast(publish);
    else publish();
    return this.getWorkflowDetail(workflowId);
  }

  importRequirements(req: ImportRequirementsRequest): WorkflowDetailSnapshot {
    const workspace = this.store.getWorkspace(req.workspaceId);
    const workflowId = `wf-${randomUUID().slice(0, 8)}`;
    const verifyCommand = req.verifyCommand?.trim() || workspace.verifyCommand;
    const permissionTier = req.permissionTier ?? 'supervised';
    const maxReworkIterations = req.maxReworkIterations ?? 3;

    const goalSpec = parseRequirementsMarkdown({
      workflowId,
      rawMarkdown: req.markdown,
      titleHint: req.title,
      defaultVerifyCommand: verifyCommand,
    });

    const {report, customization} = this.pmAgent.decomposeStructural({
      workflowId,
      goalSpec,
      customization: req.customization,
      permissionTier,
    });

    return this.persistImportedWorkflow({
      workflowId,
      workspaceId: workspace.id,
      verifyCommand,
      permissionTier,
      maxReworkIterations,
      goalSpec,
      report,
      customization,
    });
  }

  async importRequirementsSmart(
    req: ImportRequirementsRequest,
  ): Promise<WorkflowDetailSnapshot> {
    const workspace = this.store.getWorkspace(req.workspaceId);
    const workflowId = `wf-${randomUUID().slice(0, 8)}`;
    const verifyCommand = req.verifyCommand?.trim() || workspace.verifyCommand;
    const permissionTier = req.permissionTier ?? 'supervised';
    const maxReworkIterations = req.maxReworkIterations ?? 3;

    const goalSpec = parseRequirementsMarkdown({
      workflowId,
      rawMarkdown: req.markdown,
      titleHint: req.title,
      defaultVerifyCommand: verifyCommand,
    });

    const {report, customization} = await this.pmAgent.decomposeHybrid({
      workflowId,
      goalSpec,
      customization: req.customization,
      permissionTier,
    });

    return this.persistImportedWorkflow({
      workflowId,
      workspaceId: workspace.id,
      verifyCommand,
      permissionTier,
      maxReworkIterations,
      goalSpec,
      report,
      customization,
    });
  }

  importStructuredRequirements(
    workspaceId: string,
    source: Omit<GoalSpec, 'id' | 'workflowId' | 'updatedAt'>,
    // Owners of an outer transaction must queue this notification until COMMIT succeeds.
    options?: {readonly deferBroadcast: (publish: () => void) => void},
  ): WorkflowDetailSnapshot {
    const workspace = this.store.getWorkspace(workspaceId);
    const workflowId = `wf-${randomUUID().slice(0, 8)}`;
    const goalSpec: GoalSpec = {...source, id: `goal-${workflowId}`, workflowId,
      updatedAt: new Date().toISOString()};
    const permissionTier = 'supervised';
    const {report, customization} = this.pmAgent.decomposeStructural({workflowId, goalSpec, permissionTier});
    return this.persistImportedWorkflow({
      workspaceId, workflowId, goalSpec, report, customization, permissionTier,
      verifyCommand: workspace.verifyCommand, maxReworkIterations: 3, deferBroadcast: options?.deferBroadcast,
    });
  }

  updateGoalSpec(
    workflowId: string,
    patch: UpdateGoalSpecRequest,
  ): WorkflowDetailSnapshot {
    const wf = this.store.getWorkflow(workflowId);
    const curr = this.store.getGoalSpec(workflowId);
    const next: GoalSpec = {
      ...curr,
      title: patch.title ?? curr.title,
      goal: patch.goal ?? curr.goal,
      rawMarkdown: patch.rawMarkdown ?? curr.rawMarkdown,
      inputs: patch.inputs ?? curr.inputs,
      outputs: patch.outputs ?? curr.outputs,
      constraints: patch.constraints ?? curr.constraints,
      domainRules: patch.domainRules ?? curr.domainRules,
      assumptions: patch.assumptions ?? curr.assumptions,
      requirements: patch.requirements ?? curr.requirements,
      acceptanceCriteria: patch.acceptanceCriteria ?? curr.acceptanceCriteria,
      updatedAt: new Date().toISOString(),
    };

    const nodes = this.store.listGraphNodes(workflowId);
    const edges = this.store.listGraphEdges(workflowId);
    const domainTerms = this.store.listDomainTerms(wf.workspaceId);
    const validation = validateWorkflowSpec({
      workflowId,
      goalSpec: next,
      nodes,
      edges,
      capabilities: this.store.listCapabilities(),
      healthProfiles: this.store.listCapabilityHealth(),
      permissionTier: wf.permissionTier,
      maxReworkIterations: wf.maxReworkIterations,
      domainTerms,
      dddStrictCheck: wf.customization?.dddStrictCheck ?? true,
    });

    this.store.savepoint(() => {
      this.store.saveGoalSpec(next);
      this.store.updateWorkflowMeta(workflowId, {
        title: next.title,
        description: next.goal,
        status: validation.valid ? 'validated' : 'draft',
      });
      this.store.saveValidationReport(validation);
      this.store.appendAudit({
        workflowId,
        runId: null,
        category: 'spec',
        author: 'Design Editor',
        title: 'Updated GoalSpec',
        detail: `Re-validated spec (${validation.errorCount} errors, ${validation.warningCount} warnings).`,
      });
    });

    this.onBroadcast('workflow.updated', workflowId, {action: 'spec_updated'});
    return this.getWorkflowDetail(workflowId);
  }

  replanFromGoalSpec(workflowId: string): WorkflowDetailSnapshot {
    const wf = this.store.getWorkflow(workflowId);
    const spec = this.store.getGoalSpec(workflowId);
    const prevNodes = this.store.listGraphNodes(workflowId);
    const prevEdges = this.store.listGraphEdges(workflowId);
    const capabilities = this.store.listCapabilities();
    const health = this.store.listCapabilityHealth();

    const domainTerms = this.store.listDomainTerms(wf.workspaceId);
    const {report, customization} = this.pmAgent.decomposeStructural({
      workflowId,
      goalSpec: spec,
      customization: wf.customization,
      permissionTier: wf.permissionTier,
    });

    const planned = planTwinGraphFromGoalSpec({
      scopeId: workflowId,
      goalSpec: spec,
      capabilities,
      healthProfiles: health,
      permissionTier: wf.permissionTier,
      verifyCommand: wf.verifyCommand,
      customization,
      pmSlices: report.slices,
      domainTerms: customization.dddStrictCheck ? domainTerms : [],
    });

    const impact = analyzeChangeImpact({
      workflowId,
      prevNodes,
      prevEdges,
      nextNodes: planned.nodes,
      nextEdges: planned.edges,
    });
    const validation = validateWorkflowSpec({
      workflowId,
      goalSpec: spec,
      nodes: planned.nodes,
      edges: planned.edges,
      capabilities,
      healthProfiles: health,
      permissionTier: wf.permissionTier,
      maxReworkIterations: wf.maxReworkIterations,
      domainTerms,
      dddStrictCheck: customization.dddStrictCheck,
    });

    this.store.savepoint(() => {
      this.store.savePmReport(report);
      this.store.replaceGraph(workflowId, planned.nodes, planned.edges);
      this.store.saveImpactReport(impact);
      this.store.saveValidationReport(validation);
      this.store.updateWorkflowMeta(workflowId, {
        status: validation.valid ? 'validated' : 'draft',
      });
      this.store.appendAudit({
        workflowId,
        runId: null,
        category: 'plan',
        author: 'WorkflowPlannerEngine',
        title: 'Re-compiled Twin-Graph from GoalSpec',
        detail: impact.summary,
      });
    });

    this.onBroadcast('workflow.updated', workflowId, {action: 'replanned'});
    return this.getWorkflowDetail(workflowId);
  }

  updateDraftGraph(
    workflowId: string,
    req: UpdateDraftGraphRequest,
  ): WorkflowDetailSnapshot {
    const wf = this.store.getWorkflow(workflowId);
    const spec = this.store.getGoalSpec(workflowId);
    const prevNodes = this.store.listGraphNodes(workflowId);
    const prevEdges = this.store.listGraphEdges(workflowId);
    const now = new Date().toISOString();

    let nextNodes: GraphNode[] = [...prevNodes];
    let nextEdges: GraphEdge[] = [...prevEdges];

    if (req.nodePatches) {
      const patchMap = new Map(req.nodePatches.map(p => [p.id, p]));
      nextNodes = nextNodes.map(n => {
        const p = patchMap.get(n.id);
        if (!p) {
          return n;
        }
        return {
          ...n,
          title: p.title ?? n.title,
          description: p.description ?? n.description,
          planningRationale: p.planningRationale ?? n.planningRationale,
          capabilityId: p.capabilityId ?? n.capabilityId,
          assignedModel:
            p.assignedModel !== undefined ? p.assignedModel : n.assignedModel,
          executorKind: p.executorKind ?? n.executorKind,
          requirementRefs: p.requirementRefs ?? n.requirementRefs,
          inputContract: p.inputContract ?? n.inputContract,
          outputContract: p.outputContract ?? n.outputContract,
          fileScope: p.fileScope ?? n.fileScope,
          gateCommand:
            p.gateCommand !== undefined ? p.gateCommand : n.gateCommand,
          branchCondition:
            p.branchCondition !== undefined
              ? p.branchCondition
              : n.branchCondition,
          positionX: p.positionX ?? n.positionX,
          positionY: p.positionY ?? n.positionY,
          updatedAt: now,
        };
      });
    }

    if (req.addNodes) {
      for (const add of req.addNodes) {
        const newId = `node-${randomUUID().slice(0, 8)}`;
        const anchor = add.afterNodeId
          ? nextNodes.find(n => n.id === add.afterNodeId)
          : nextNodes.find(n => n.kind === 'phase_container');
        nextNodes.push({
          id: newId,
          scopeId: workflowId,
          code: add.code,
          parentWbsId: add.parentWbsId ?? anchor?.parentWbsId ?? null,
          containerNodeId:
            add.containerNodeId ??
            anchor?.containerNodeId ??
            anchor?.id ??
            null,
          phaseId: add.phaseId ?? anchor?.phaseId ?? null,
          phaseTitle: add.phaseTitle ?? anchor?.phaseTitle ?? 'Custom Phase',
          depth: 1,
          kind: add.kind,
          executorKind: add.executorKind,
          capabilityId: add.capabilityId,
          assignedRole: 'worker',
          assignedModel: null,
          title: add.title,
          description: add.description,
          planningRationale: add.planningRationale,
          requirementRefs: add.requirementRefs ?? [],
          inputContract: add.inputContract ?? 'Upstream Context',
          outputContract: add.outputContract ?? 'Step Output',
          fileScope: add.fileScope ?? [],
          gateCommand: add.gateCommand ?? null,
          branchCondition: null,
          status: 'pending',
          attemptCount: 0,
          maxAttempts: 3,
          collapsed: false,
          positionX: (anchor?.positionX ?? 120) + 40,
          positionY: (anchor?.positionY ?? 120) + 96,
          width: 220,
          height: 76,
          outputSummary: '',
          restoreTargetCheckpointId: null,
          updatedAt: now,
        });
        if (add.afterNodeId) {
          nextEdges.push({
            id: `edge-${randomUUID().slice(0, 8)}`,
            scopeId: workflowId,
            sourceNodeId: add.afterNodeId,
            targetNodeId: newId,
            kind: 'dep',
            label: 'dep',
            conditionExpr: null,
          });
        }
      }
    }

    if (req.removeNodeIds && req.removeNodeIds.length > 0) {
      const rmSet = new Set(req.removeNodeIds);
      nextNodes = nextNodes.filter(n => !rmSet.has(n.id));
      nextEdges = nextEdges.filter(
        e => !rmSet.has(e.sourceNodeId) && !rmSet.has(e.targetNodeId),
      );
    }

    if (req.removeEdgeIds && req.removeEdgeIds.length > 0) {
      const rmEdgeSet = new Set(req.removeEdgeIds);
      nextEdges = nextEdges.filter(e => !rmEdgeSet.has(e.id));
    }

    if (req.addEdges) {
      for (const e of req.addEdges) {
        nextEdges.push({
          id: `edge-${randomUUID().slice(0, 8)}`,
          scopeId: workflowId,
          sourceNodeId: e.sourceNodeId,
          targetNodeId: e.targetNodeId,
          kind: e.kind,
          label: e.label ?? e.kind,
          conditionExpr: e.conditionExpr ?? null,
        });
      }
    }

    const impact = analyzeChangeImpact({
      workflowId,
      prevNodes,
      prevEdges,
      nextNodes,
      nextEdges,
    });
    const validation = validateWorkflowSpec({
      workflowId,
      goalSpec: spec,
      nodes: nextNodes,
      edges: nextEdges,
      capabilities: this.store.listCapabilities(),
      healthProfiles: this.store.listCapabilityHealth(),
      permissionTier: wf.permissionTier,
      maxReworkIterations: wf.maxReworkIterations,
      domainTerms: this.store.listDomainTerms(wf.workspaceId),
      dddStrictCheck: wf.customization?.dddStrictCheck ?? true,
    });

    this.store.savepoint(() => {
      this.store.replaceGraph(workflowId, nextNodes, nextEdges);
      this.store.saveImpactReport(impact);
      this.store.saveValidationReport(validation);
      this.store.updateWorkflowMeta(workflowId, {
        status: validation.valid ? 'validated' : 'draft',
      });
      this.store.appendAudit({
        workflowId,
        runId: null,
        category: 'validation',
        author: 'Design Studio',
        title: 'Edited Draft Twin-Graph',
        detail: `${impact.summary} | Validation errors=${validation.errorCount}`,
      });
    });

    this.onBroadcast('workflow.updated', workflowId, {action: 'graph_edited'});
    return this.getWorkflowDetail(workflowId);
  }

  runTrial(workflowId: string): WorkflowDetailSnapshot {
    const wf = this.store.getWorkflow(workflowId);
    const spec = this.store.getGoalSpec(workflowId);
    const nodes = this.store.listGraphNodes(workflowId);
    const edges = this.store.listGraphEdges(workflowId);
    const validation = validateWorkflowSpec({
      workflowId,
      goalSpec: spec,
      nodes,
      edges,
      capabilities: this.store.listCapabilities(),
      healthProfiles: this.store.listCapabilityHealth(),
      permissionTier: wf.permissionTier,
      maxReworkIterations: wf.maxReworkIterations,
      domainTerms: this.store.listDomainTerms(wf.workspaceId),
      dddStrictCheck: wf.customization?.dddStrictCheck ?? true,
    });

    const trial = runTrialSimulation({
      workflowId,
      goalSpec: spec,
      nodes,
      edges,
      validation,
    });

    this.store.savepoint(() => {
      this.store.saveValidationReport(validation);
      this.store.saveTrialReport(trial);
      this.store.updateWorkflowMeta(workflowId, {
        status: trial.passed
          ? 'trial_passed'
          : validation.valid
            ? 'validated'
            : 'draft',
      });
      this.store.appendAudit({
        workflowId,
        runId: null,
        category: 'trial',
        author: 'Trial Simulator',
        title: trial.passed
          ? `Trial Run PASSED (${trial.simulatedPath.length} active, ${trial.skippedNodes.length} skipped)`
          : `Trial Run BLOCKED (${trial.blockingIssues.length} errors)`,
        detail: `Path: ${trial.simulatedPath.join(' -> ')}`,
      });
    });

    this.onBroadcast('workflow.updated', workflowId, {action: 'trial_ran'});
    return this.getWorkflowDetail(workflowId);
  }

  confirmVersion(
    workflowId: string,
    req: ConfirmVersionRequest = {},
  ): WorkflowVersionSnapshot {
    const wf = this.store.getWorkflow(workflowId);
    const spec = this.store.getGoalSpec(workflowId);
    const nodes = this.store.listGraphNodes(workflowId);
    const edges = this.store.listGraphEdges(workflowId);
    const validation = validateWorkflowSpec({
      workflowId,
      goalSpec: spec,
      nodes,
      edges,
      capabilities: this.store.listCapabilities(),
      healthProfiles: this.store.listCapabilityHealth(),
      permissionTier: wf.permissionTier,
      maxReworkIterations: wf.maxReworkIterations,
      domainTerms: this.store.listDomainTerms(wf.workspaceId),
      dddStrictCheck: wf.customization?.dddStrictCheck ?? true,
    });

    if (!validation.valid) {
      throw new OrchestratorError(
        'SPEC_INVALID',
        `Cannot lock workflow version: ${validation.errorCount} blocking validation error(s) remain.`,
        400,
        {issues: validation.issues},
      );
    }

    const nextNum = wf.currentVersionNumber + 1;
    const versionTag = `v${nextNum}.0`;
    const latestTrial = this.store.getLatestTrialReport(workflowId);
    const versionId = `ver-${randomUUID().slice(0, 8)}`;

    const snapshot: WorkflowVersionSnapshot = {
      id: versionId,
      workflowId,
      versionNumber: nextNum,
      versionTag,
      label: req.label?.trim() || `${wf.code} ${versionTag}`,
      goalSpec: spec,
      nodes: nodes.map(n => ({...n, scopeId: versionId, status: 'pending'})),
      edges: edges.map(e => ({...e, scopeId: versionId})),
      validation,
      trial: latestTrial,
      frozenBy: req.frozenBy?.trim() || 'User',
      createdAt: new Date().toISOString(),
    };

    this.store.savepoint(() => {
      this.store.saveValidationReport(validation);
      this.store.createVersionSnapshot(snapshot);
      this.store.updateWorkflowMeta(workflowId, {
        currentVersionNumber: nextNum,
        status: 'locked',
      });
      this.store.appendAudit({
        workflowId,
        runId: null,
        category: 'version',
        author: snapshot.frozenBy,
        title: `Locked immutable snapshot ${versionTag}`,
        detail: `${snapshot.nodes.length} nodes & GoalSpec frozen into ${versionId}.`,
      });
    });

    this.onBroadcast('workflow.updated', workflowId, {
      action: 'version_locked',
      versionId,
      versionTag,
    });
    return snapshot;
  }

  getWorkflowDetail(workflowId: string): WorkflowDetailSnapshot {
    const workflow = this.store.getWorkflow(workflowId);
    return {
      workflow,
      goalSpec: this.store.getGoalSpec(workflowId),
      nodes: this.store.listGraphNodes(workflowId),
      edges: this.store.listGraphEdges(workflowId),
      validation: this.store.getValidationReport(workflowId),
      latestTrial: this.store.getLatestTrialReport(workflowId),
      lastImpact: this.store.getImpactReport(workflowId),
      versions: this.store.listVersions(workflowId),
      pmReport: this.store.getPmReport(workflowId),
    };
  }
}
