import {randomUUID} from 'node:crypto';
import type {
  CapabilityAdapterManifest,
  CapabilityHealthProfile,
  DesignSpecModule,
  DomainTermEntry,
  GoalSpec,
  GraphEdge,
  GraphNode,
  PermissionTier,
  PmDecompositionReport,
  PmDecompositionSlice,
  WorkflowCustomization,
  WorkflowTemplatePreset,
} from '../shared/types.ts';
import {DEFAULT_WORKFLOW_CUSTOMIZATION} from './presets.ts';
import {selectHealthyCapability} from './telemetry.ts';

function makeNodeId(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

function slugifyModule(value: string, fallbackIndex: number): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.slice(0, 22) || `module-${fallbackIndex}`;
}

export function resolveWorkflowCustomization(
  partial: Partial<WorkflowCustomization> | undefined,
  permissionTier: PermissionTier,
): WorkflowCustomization {
  const preset: WorkflowTemplatePreset =
    partial?.templatePreset ?? DEFAULT_WORKFLOW_CUSTOMIZATION.templatePreset;

  const presetBase: WorkflowCustomization =
    preset === 'microservice_hardened'
      ? {
          templatePreset: preset,
          includeHumanGate: true,
          includeSecurityPass: true,
          includeQaAudit: true,
          maxParallelWorkers: 4,
          dddStrictCheck: true,
          pmAgentMode: 'hybrid_llm',
          budgetUsdLimit: 4.0,
        }
      : preset === 'rapid_ui_api'
        ? {
            templatePreset: preset,
            includeHumanGate: false,
            includeSecurityPass: false,
            includeQaAudit: true,
            maxParallelWorkers: 2,
            dddStrictCheck: false,
            pmAgentMode: 'hybrid_llm',
            budgetUsdLimit: 1.5,
          }
        : {
            ...DEFAULT_WORKFLOW_CUSTOMIZATION,
            templatePreset: preset,
            includeHumanGate: permissionTier === 'strict',
          };

  return {
    templatePreset: preset,
    includeHumanGate:
      partial?.includeHumanGate !== undefined
        ? partial.includeHumanGate
        : presetBase.includeHumanGate,
    includeSecurityPass:
      partial?.includeSecurityPass ?? presetBase.includeSecurityPass,
    includeQaAudit: partial?.includeQaAudit ?? presetBase.includeQaAudit,
    maxParallelWorkers: Math.max(
      2,
      Math.min(
        5,
        Math.round(
          partial?.maxParallelWorkers ?? presetBase.maxParallelWorkers,
        ),
      ),
    ),
    dddStrictCheck: partial?.dddStrictCheck ?? presetBase.dddStrictCheck,
    pmAgentMode: partial?.pmAgentMode ?? presetBase.pmAgentMode,
    budgetUsdLimit: Number(
      Math.max(
        0.2,
        Math.min(25, partial?.budgetUsdLimit ?? presetBase.budgetUsdLimit),
      ).toFixed(2),
    ),
  };
}

export function buildStructuralPmSlices(input: {
  readonly goalSpec: GoalSpec;
  readonly customization: WorkflowCustomization;
  readonly domainTerms?: readonly DomainTermEntry[];
}): PmDecompositionSlice[] {
  const {goalSpec, customization, domainTerms} = input;
  const capLimit = Math.max(2, Math.min(5, customization.maxParallelWorkers));
  const modules: readonly DesignSpecModule[] =
    goalSpec.modules && goalSpec.modules.length > 0
      ? goalSpec.modules
      : synthesizeFallbackModules(goalSpec);

  const mergedModules = compactModulesToCap(modules, capLimit);
  const termsHint =
    domainTerms && domainTerms.length > 0
      ? `Follow DDD canonical terms (${domainTerms
          .slice(0, 3)
          .map(t => t.canonicalTerm)
          .join(', ')}).`
      : 'Keep module interfaces strongly typed and isolated.';

  const usedScopes = new Set<string>();
  return mergedModules.map((mod, idx) => {
    const scope = deduplicateScope(
      mod.artifacts,
      `src/${slugifyModule(mod.name, idx + 1)}/**`,
      usedScopes,
    );
    const reqRefs =
      mod.relatedFrCodes.length > 0
        ? mod.relatedFrCodes
        : goalSpec.requirements
            .filter((_, rIdx) => rIdx % mergedModules.length === idx)
            .map(r => r.code);
    const finalRefs =
      reqRefs.length > 0
        ? reqRefs
        : [goalSpec.requirements[0]?.code ?? 'FR-01'];

    const isSecurity = mod.layer === 'security';
    return {
      code: `P2.T${idx + 1}`,
      title: mod.name.slice(0, 46),
      phase: 'P2',
      layer: mod.layer,
      requirementRefs: finalRefs,
      dependsOnCodes: ['P1.T1'],
      assignedRole: isSecurity ? 'evaluator' : 'worker',
      executorKind: 'agent',
      fileScope: scope,
      rationale: `${mod.summary} [Layer=${mod.layer}, Scope=${scope.join(', ')}]. ${termsHint}`,
    };
  });
}

function synthesizeFallbackModules(goalSpec: GoalSpec): DesignSpecModule[] {
  const half = Math.max(1, Math.ceil(goalSpec.requirements.length / 2));
  const aReqs = goalSpec.requirements.slice(0, half);
  const bReqs = goalSpec.requirements.slice(half);
  return [
    {
      name: aReqs[0]?.title.slice(0, 42) || 'Core Domain & Service Logic',
      layer: 'backend',
      summary:
        aReqs.map(r => `${r.code}: ${r.description}`).join('\n') ||
        goalSpec.goal,
      artifacts: ['src/core/**'],
      relatedFrCodes: aReqs.length > 0 ? aReqs.map(r => r.code) : ['FR-01'],
    },
    {
      name:
        bReqs[0]?.title.slice(0, 42) || 'Adapter Integration & API Handlers',
      layer: 'integration',
      summary:
        bReqs.map(r => `${r.code}: ${r.description}`).join('\n') ||
        'Integrate adapter endpoints, validation schemas, and error boundaries.',
      artifacts: ['src/adapters/**', 'src/api/**'],
      relatedFrCodes:
        bReqs.length > 0 ? bReqs.map(r => r.code) : aReqs.map(r => r.code),
    },
  ];
}

function compactModulesToCap(
  modules: readonly DesignSpecModule[],
  cap: number,
): DesignSpecModule[] {
  if (modules.length <= cap) {
    return [...modules];
  }
  const buckets: DesignSpecModule[] = modules.slice(0, cap).map(m => ({
    ...m,
    artifacts: [...m.artifacts],
    relatedFrCodes: [...m.relatedFrCodes],
  }));
  for (let i = cap; i < modules.length; i += 1) {
    const target = buckets[i % cap]!;
    const extra = modules[i]!;
    buckets[i % cap] = {
      ...target,
      summary: `${target.summary}\n+ ${extra.name}: ${extra.summary}`,
      artifacts: Array.from(new Set([...target.artifacts, ...extra.artifacts])),
      relatedFrCodes: Array.from(
        new Set([...target.relatedFrCodes, ...extra.relatedFrCodes]),
      ),
    };
  }
  return buckets;
}

function deduplicateScope(
  proposed: readonly string[],
  fallbackGlob: string,
  used: Set<string>,
): string[] {
  const unique = proposed.filter(s => s && !used.has(s));
  const chosen = unique.length > 0 ? unique : [fallbackGlob];
  for (const s of chosen) {
    used.add(s);
  }
  return chosen;
}

export function planCustomizableTwinGraph(input: {
  readonly scopeId: string;
  readonly goalSpec: GoalSpec;
  readonly capabilities: readonly CapabilityAdapterManifest[];
  readonly healthProfiles: readonly CapabilityHealthProfile[];
  readonly permissionTier: PermissionTier;
  readonly verifyCommand: string;
  readonly customization?: Partial<WorkflowCustomization>;
  readonly pmSlices?: readonly PmDecompositionSlice[];
  readonly domainTerms?: readonly DomainTermEntry[];
}): {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly resolvedCustomization: WorkflowCustomization;
  readonly slices: readonly PmDecompositionSlice[];
} {
  const {
    scopeId,
    goalSpec,
    capabilities,
    healthProfiles,
    permissionTier,
    verifyCommand,
  } = input;
  const now = new Date().toISOString();
  const resolved = resolveWorkflowCustomization(
    input.customization,
    permissionTier,
  );

  const leadCap =
    selectHealthyCapability(capabilities, healthProfiles, 'agent', 'lead')
      ?.id ?? 'native-api';
  const workerCap =
    selectHealthyCapability(capabilities, healthProfiles, 'agent', 'worker')
      ?.id ?? leadCap;
  const evalCap =
    selectHealthyCapability(capabilities, healthProfiles, 'agent', 'evaluator')
      ?.id ?? leadCap;
  const shellCap =
    selectHealthyCapability(capabilities, healthProfiles, 'tool', 'evaluator')
      ?.id ?? 'local-shell';
  const controlCap =
    selectHealthyCapability(
      capabilities,
      healthProfiles,
      'control',
      'evaluator',
    )?.id ?? 'git-control';
  const humanCap =
    selectHealthyCapability(capabilities, healthProfiles, 'human', 'lead')
      ?.id ?? 'human-gate';

  const slices =
    input.pmSlices && input.pmSlices.length > 0
      ? input.pmSlices
      : buildStructuralPmSlices({
          goalSpec,
          customization: resolved,
          domainTerms: input.domainTerms,
        });

  const allReqCodes =
    goalSpec.requirements.map(r => r.code).length > 0
      ? goalSpec.requirements.map(r => r.code)
      : ['FR-01'];
  const allAcCodes =
    goalSpec.acceptanceCriteria.map(a => a.code).length > 0
      ? goalSpec.acceptanceCriteria.map(a => a.code)
      : ['AC-01'];

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  const p1ContainerId = makeNodeId('p1');
  const p1CkptId = makeNodeId('p1ckpt');
  const p2ContainerId = makeNodeId('p2');
  const p2CkptId = makeNodeId('p2ckpt');
  const p3ContainerId = makeNodeId('p3');

  const p1Top = 20;
  const p1Width = 840;
  const p1Height = 174;
  const p1CkptY = p1Top + p1Height + 54; // 248
  const p2Top = p1CkptY + 68 + 72; // 388
  const p2Width = Math.max(840, 24 + slices.length * 272);
  const p2Height = 424;
  const p2CkptY = p2Top + p2Height + 50; // 862
  const p3Top = p2CkptY + 68 + 72; // 1002
  const p3Width = 840;
  const p3Height = 320;

  nodes.push(
    {
      id: p1ContainerId,
      scopeId,
      code: 'P1',
      parentWbsId: null,
      containerNodeId: null,
      phaseId: p1ContainerId,
      phaseTitle: 'Phase 1 · Design Spec & Contract Plan',
      depth: 0,
      kind: 'phase_container',
      executorKind: 'control',
      capabilityId: controlCap,
      assignedRole: 'lead',
      assignedModel: null,
      title: 'Phase 1 · Design Spec & Contracts',
      description: `Synthesize GoalSpec contracts, DDD glossary bindings, and PM decomposition baseline (${resolved.templatePreset}).`,
      planningRationale:
        'Separates architectural planning and schema locking from downstream parallel code generation.',
      requirementRefs: allReqCodes.slice(0, 2),
      inputContract: goalSpec.inputs.join(' + '),
      outputContract: 'Verified Shared Contracts & WBS Decomposition',
      fileScope: [],
      gateCommand: null,
      branchCondition: null,
      status: 'pending',
      attemptCount: 0,
      maxAttempts: 1,
      collapsed: false,
      positionX: 40,
      positionY: p1Top,
      width: p1Width,
      height: p1Height,
      outputSummary: '',
      restoreTargetCheckpointId: null,
      updatedAt: now,
    },
    {
      id: p2ContainerId,
      scopeId,
      code: 'P2',
      parentWbsId: null,
      containerNodeId: null,
      phaseId: p2ContainerId,
      phaseTitle: 'Phase 2 · Parallel PM Task Execution',
      depth: 0,
      kind: 'phase_container',
      executorKind: 'control',
      capabilityId: controlCap,
      assignedRole: 'worker',
      assignedModel: null,
      title: `Phase 2 · Parallel Tasks (${slices.length} streams)`,
      description:
        'Execute PM-decomposed module slices on disjoint fileScopes, conditional routing, optional security pass, and Join barrier.',
      planningRationale:
        'Maximizes safe throughput with disjoint scopes and fail-closed Join convergence.',
      requirementRefs: allReqCodes,
      inputContract: 'Phase 1 Git Baseline SHA',
      outputContract: 'Integrated Feature Diff & Artifacts',
      fileScope: [],
      gateCommand: null,
      branchCondition: null,
      status: 'pending',
      attemptCount: 0,
      maxAttempts: 1,
      collapsed: false,
      positionX: 40,
      positionY: p2Top,
      width: p2Width,
      height: p2Height,
      outputSummary: '',
      restoreTargetCheckpointId: null,
      updatedAt: now,
    },
    {
      id: p3ContainerId,
      scopeId,
      code: 'P3',
      parentWbsId: null,
      containerNodeId: null,
      phaseId: p3ContainerId,
      phaseTitle: 'Phase 3 · Verification & Recovery',
      depth: 0,
      kind: 'phase_container',
      executorKind: 'control',
      capabilityId: controlCap,
      assignedRole: 'evaluator',
      assignedModel: null,
      title: 'Phase 3 · Verification & Recovery',
      description:
        'Deterministic shell gate, DDD/Diff self-check, optional independent QA audit, Git checkpoint, and bounded rewind loop.',
      planningRationale:
        'Separates objective command gates from independent QA review with bounded automatic rollback.',
      requirementRefs: allAcCodes,
      inputContract: 'Phase 2 Integrated Git Commit SHA',
      outputContract: goalSpec.outputs.join(' + '),
      fileScope: [],
      gateCommand: null,
      branchCondition: null,
      status: 'pending',
      attemptCount: 0,
      maxAttempts: 1,
      collapsed: false,
      positionX: 40,
      positionY: p3Top,
      width: p3Width,
      height: p3Height,
      outputSummary: '',
      restoreTargetCheckpointId: null,
      updatedAt: now,
    },
  );

  // Phase 1 nodes (top clearance >= 56px inside P1)
  const startId = makeNodeId('start');
  const p1TaskId = makeNodeId('p1t1');
  const p1GateId = resolved.includeHumanGate ? makeNodeId('p1gate') : null;

  const dddNote =
    input.domainTerms && input.domainTerms.length > 0
      ? ` Enforce DDD glossary: ${input.domainTerms.map(t => t.canonicalTerm).join(', ')}.`
      : '';

  nodes.push(
    {
      id: startId,
      scopeId,
      code: 'START',
      parentWbsId: p1ContainerId,
      containerNodeId: p1ContainerId,
      phaseId: p1ContainerId,
      phaseTitle: 'Phase 1 · Design Spec & Contract Plan',
      depth: 1,
      kind: 'start',
      executorKind: 'control',
      capabilityId: controlCap,
      assignedRole: 'lead',
      assignedModel: null,
      title: 'Workflow Start',
      description: `Anchor base Git SHA and freeze Design Spec baseline for "${goalSpec.title}".`,
      planningRationale:
        'Establishes deterministic root state and initial Git rollback anchor.',
      requirementRefs: allReqCodes.slice(0, 1),
      inputContract: goalSpec.inputs.join(' + '),
      outputContract: 'Baseline Commit Anchor',
      fileScope: [],
      gateCommand: null,
      branchCondition: null,
      status: 'pending',
      attemptCount: 0,
      maxAttempts: 1,
      collapsed: false,
      positionX: 64,
      positionY: p1Top + 56,
      width: 196,
      height: 72,
      outputSummary: '',
      restoreTargetCheckpointId: null,
      updatedAt: now,
    },
    {
      id: p1TaskId,
      scopeId,
      code: 'P1.T1',
      parentWbsId: p1ContainerId,
      containerNodeId: p1ContainerId,
      phaseId: p1ContainerId,
      phaseTitle: 'Phase 1 · Design Spec & Contract Plan',
      depth: 1,
      kind: 'task',
      executorKind: 'agent',
      capabilityId: leadCap,
      assignedRole: 'lead',
      assignedModel: null,
      title: 'Lock Interfaces & Shared Schemas',
      description: `Produce shared contracts and interface boundaries covering ${allReqCodes.join(', ')}.${dddNote}`,
      planningRationale:
        'Defining shared contracts upfront prevents merge conflicts across PM-decomposed parallel tasks.',
      requirementRefs: allReqCodes,
      inputContract: 'Baseline Commit Anchor',
      outputContract: 'Verified Shared Contracts',
      fileScope: ['src/shared/**'],
      gateCommand: null,
      branchCondition: null,
      status: 'pending',
      attemptCount: 0,
      maxAttempts: 2,
      collapsed: false,
      positionX: 336,
      positionY: p1Top + 56,
      width: 212,
      height: 72,
      outputSummary: '',
      restoreTargetCheckpointId: null,
      updatedAt: now,
    },
  );

  edges.push({
    id: makeNodeId('edge'),
    scopeId,
    sourceNodeId: startId,
    targetNodeId: p1TaskId,
    kind: 'dep',
    label: 'init',
    conditionExpr: null,
  });

  let phase1ExitId = p1TaskId;
  if (p1GateId) {
    nodes.push({
      id: p1GateId,
      scopeId,
      code: 'P1.GATE',
      parentWbsId: p1ContainerId,
      containerNodeId: p1ContainerId,
      phaseId: p1ContainerId,
      phaseTitle: 'Phase 1 · Design Spec & Contract Plan',
      depth: 1,
      kind: 'human_gate',
      executorKind: 'human',
      capabilityId: humanCap,
      assignedRole: 'lead',
      assignedModel: null,
      title: 'Human Contract & Plan Sign-Off',
      description:
        'Review PM Agent WBS decomposition and approve shared contracts before parallel edits.',
      planningRationale:
        'Enforces human-in-the-loop sign-off prior to multi-worker code mutations.',
      requirementRefs: allReqCodes.slice(0, 1),
      inputContract: 'Verified Shared Contracts',
      outputContract: 'Human Approval Token',
      fileScope: [],
      gateCommand: null,
      branchCondition: null,
      status: 'pending',
      attemptCount: 0,
      maxAttempts: 1,
      collapsed: false,
      positionX: 608,
      positionY: p1Top + 56,
      width: 212,
      height: 72,
      outputSummary: '',
      restoreTargetCheckpointId: null,
      updatedAt: now,
    });
    edges.push({
      id: makeNodeId('edge'),
      scopeId,
      sourceNodeId: p1TaskId,
      targetNodeId: p1GateId,
      kind: 'dep',
      label: 'approve',
      conditionExpr: null,
    });
    phase1ExitId = p1GateId;
  }

  // Explicit Inter-Phase Checkpoint 1 (between Phase 1 & Phase 2)
  nodes.push({
    id: p1CkptId,
    scopeId,
    code: 'P1.CKPT',
    parentWbsId: null,
    containerNodeId: null,
    phaseId: null,
    phaseTitle: 'Phase 1 -> Phase 2 Physical Checkpoint',
    depth: 1,
    kind: 'checkpoint',
    executorKind: 'control',
    capabilityId: controlCap,
    assignedRole: 'lead',
    assignedModel: null,
    title: 'Phase 1 基线物理检查点',
    description:
      'Commit Phase 1 design contracts and create a recoverable Git baseline checkpoint before parallel execution.',
    planningRationale:
      'Anchors an immutable Git commit before Phase 2 parallel workers mutate the worktree.',
    requirementRefs: allReqCodes.slice(0, 1),
    inputContract: p1GateId
      ? 'Human Approval Token'
      : 'Verified Shared Contracts',
    outputContract: 'Phase 1 Git Baseline SHA',
    fileScope: [],
    gateCommand: null,
    branchCondition: null,
    status: 'pending',
    attemptCount: 0,
    maxAttempts: 1,
    collapsed: false,
    positionX: 336,
    positionY: p1CkptY,
    width: 212,
    height: 68,
    outputSummary: '',
    restoreTargetCheckpointId: null,
    updatedAt: now,
  });

  edges.push({
    id: makeNodeId('edge'),
    scopeId,
    sourceNodeId: phase1ExitId,
    targetNodeId: p1CkptId,
    kind: 'dep',
    label: 'anchor',
    conditionExpr: null,
  });

  // Phase 2 dynamic slices + decision routing + optional security gate + Join
  const p2DecisionId = makeNodeId('p2d1');
  const p2StandardId = makeNodeId('p2std');
  const p2ExtendedId = makeNodeId('p2ext');
  const p2SecurityId = resolved.includeSecurityPass
    ? makeNodeId('p2sec')
    : null;
  const p2JoinId = makeNodeId('p2join');

  const p2Row1Y = p2Top + 58;
  const p2Row2Y = p2Top + 190;
  const p2Row3Y = p2Top + 322;

  const sliceNodeIds: string[] = [];
  slices.forEach((slice, index) => {
    const nodeId = makeNodeId(`p2t${index + 1}`);
    sliceNodeIds.push(nodeId);
    const assignedCap =
      slice.assignedRole === 'evaluator' ? evalCap : workerCap;
    nodes.push({
      id: nodeId,
      scopeId,
      code: slice.code || `P2.T${index + 1}`,
      parentWbsId: p2ContainerId,
      containerNodeId: p2ContainerId,
      phaseId: p2ContainerId,
      phaseTitle: 'Phase 2 · Parallel PM Task Execution',
      depth: 1,
      kind: 'task',
      executorKind: slice.executorKind || 'agent',
      capabilityId: assignedCap,
      assignedRole: slice.assignedRole || 'worker',
      assignedModel: null,
      title: slice.title,
      description: `Implement [${slice.layer}] module slice for ${slice.requirementRefs.join(', ') || allReqCodes[0]}`,
      planningRationale: slice.rationale,
      requirementRefs:
        slice.requirementRefs.length > 0
          ? slice.requirementRefs
          : [allReqCodes[0]!],
      inputContract: 'Phase 1 Git Baseline SHA',
      outputContract: `${slice.title} Diff`,
      fileScope: slice.fileScope,
      gateCommand: null,
      branchCondition: null,
      status: 'pending',
      attemptCount: 0,
      maxAttempts: 3,
      collapsed: false,
      positionX: 64 + index * 272,
      positionY: p2Row1Y,
      width: 212,
      height: 76,
      outputSummary: '',
      restoreTargetCheckpointId: null,
      updatedAt: now,
    });
    edges.push({
      id: makeNodeId('edge'),
      scopeId,
      sourceNodeId: p1CkptId,
      targetNodeId: nodeId,
      kind: 'dep',
      label: `fork-${index + 1}`,
      conditionExpr: null,
    });
  });

  const firstSliceId = sliceNodeIds[0]!;
  nodes.push(
    {
      id: p2DecisionId,
      scopeId,
      code: 'P2.D1',
      parentWbsId: p2ContainerId,
      containerNodeId: p2ContainerId,
      phaseId: p2ContainerId,
      phaseTitle: 'Phase 2 · Parallel PM Task Execution',
      depth: 1,
      kind: 'decision',
      executorKind: 'control',
      capabilityId: controlCap,
      assignedRole: 'lead',
      assignedModel: null,
      title: 'Execution Profile Router',
      description:
        'Select standard integration path or extended verification path based on change scope.',
      planningRationale:
        'Avoids unnecessary latency for standard changes while routing complex diffs through extended hardening.',
      requirementRefs: allReqCodes.slice(0, 1),
      inputContract: 'Primary Slice Output',
      outputContract: 'Routing Decision (standard | extended)',
      fileScope: [],
      gateCommand: null,
      branchCondition: 'standard',
      status: 'pending',
      attemptCount: 0,
      maxAttempts: 1,
      collapsed: false,
      positionX: 64,
      positionY: p2Row2Y,
      width: 212,
      height: 76,
      outputSummary: '',
      restoreTargetCheckpointId: null,
      updatedAt: now,
    },
    {
      id: p2StandardId,
      scopeId,
      code: 'P2.STD',
      parentWbsId: p2ContainerId,
      containerNodeId: p2ContainerId,
      phaseId: p2ContainerId,
      phaseTitle: 'Phase 2 · Parallel PM Task Execution',
      depth: 1,
      kind: 'task',
      executorKind: 'agent',
      capabilityId: workerCap,
      assignedRole: 'worker',
      assignedModel: null,
      title: 'Standard Integration & Docs',
      description: 'Wire cross-module interfaces and finalize runtime wiring.',
      planningRationale:
        'Fast integration branch when extended hardening path is not triggered.',
      requirementRefs: allReqCodes.slice(0, 1),
      inputContract: 'Primary Slice Output',
      outputContract: 'Standard Integration Diff',
      fileScope: ['src/index.ts'],
      gateCommand: null,
      branchCondition: null,
      status: 'pending',
      attemptCount: 0,
      maxAttempts: 2,
      collapsed: false,
      positionX: 336,
      positionY: p2Row2Y,
      width: 212,
      height: 76,
      outputSummary: '',
      restoreTargetCheckpointId: null,
      updatedAt: now,
    },
    {
      id: p2ExtendedId,
      scopeId,
      code: 'P2.EXT',
      parentWbsId: p2ContainerId,
      containerNodeId: p2ContainerId,
      phaseId: p2ContainerId,
      phaseTitle: 'Phase 2 · Parallel PM Task Execution',
      depth: 1,
      kind: 'task',
      executorKind: 'agent',
      capabilityId: evalCap,
      assignedRole: 'evaluator',
      assignedModel: null,
      title: 'Extended Contract & Stress Pass',
      description:
        'Deep edge-case and resilience checks before Phase 3 certification.',
      planningRationale:
        'Explicit alternate conditional branch selectable during risk-heavy iterations.',
      requirementRefs: allReqCodes.slice(-1),
      inputContract: 'Primary Slice Output',
      outputContract: 'Extended Verification Notes',
      fileScope: ['docs/**'],
      gateCommand: null,
      branchCondition: null,
      status: 'pending',
      attemptCount: 0,
      maxAttempts: 2,
      collapsed: false,
      positionX: 336,
      positionY: p2Row3Y,
      width: 212,
      height: 76,
      outputSummary: '',
      restoreTargetCheckpointId: null,
      updatedAt: now,
    },
  );

  if (p2SecurityId) {
    nodes.push({
      id: p2SecurityId,
      scopeId,
      code: 'P2.SEC',
      parentWbsId: p2ContainerId,
      containerNodeId: p2ContainerId,
      phaseId: p2ContainerId,
      phaseTitle: 'Phase 2 · Parallel PM Task Execution',
      depth: 1,
      kind: 'task',
      executorKind: 'agent',
      capabilityId: evalCap,
      assignedRole: 'evaluator',
      assignedModel: null,
      title: 'Security & Guardrail Scan',
      description:
        'Verify constitution compliance, path confinement, and auth boundaries across all Phase 2 diffs.',
      planningRationale:
        'Enabled by workflow template customization to enforce pre-merge security posture.',
      requirementRefs: allReqCodes,
      inputContract: 'Integrated Module Diffs',
      outputContract: 'Security Posture Check',
      fileScope: [],
      gateCommand: null,
      branchCondition: null,
      status: 'pending',
      attemptCount: 0,
      maxAttempts: 2,
      collapsed: false,
      positionX: 608,
      positionY: p2Row2Y,
      width: 212,
      height: 76,
      outputSummary: '',
      restoreTargetCheckpointId: null,
      updatedAt: now,
    });
  }

  nodes.push({
    id: p2JoinId,
    scopeId,
    code: 'P2.JOIN',
    parentWbsId: p2ContainerId,
    containerNodeId: p2ContainerId,
    phaseId: p2ContainerId,
    phaseTitle: 'Phase 2 · Parallel PM Task Execution',
    depth: 1,
    kind: 'join',
    executorKind: 'control',
    capabilityId: controlCap,
    assignedRole: 'lead',
    assignedModel: null,
    title: 'Phase 2 Join Barrier',
    description:
      'Synchronize parallel PM slices and routed branches into unified verification snapshot.',
    planningRationale:
      'Guarantees no verification gate executes against partially completed slices.',
    requirementRefs: allReqCodes,
    inputContract: 'All Phase 2 Active Branch Artifacts',
    outputContract: 'Unified Ready-to-Verify Snapshot',
    fileScope: [],
    gateCommand: null,
    branchCondition: null,
    status: 'pending',
    attemptCount: 0,
    maxAttempts: 1,
    collapsed: false,
    positionX: 608,
    positionY: p2Row3Y,
    width: 212,
    height: 76,
    outputSummary: '',
    restoreTargetCheckpointId: null,
    updatedAt: now,
  });

  edges.push(
    {
      id: makeNodeId('edge'),
      scopeId,
      sourceNodeId: firstSliceId,
      targetNodeId: p2DecisionId,
      kind: 'dep',
      label: 'route',
      conditionExpr: null,
    },
    {
      id: makeNodeId('edge'),
      scopeId,
      sourceNodeId: p2DecisionId,
      targetNodeId: p2StandardId,
      kind: 'pass',
      label: 'standard',
      conditionExpr: 'standard',
    },
    {
      id: makeNodeId('edge'),
      scopeId,
      sourceNodeId: p2DecisionId,
      targetNodeId: p2ExtendedId,
      kind: 'pass',
      label: 'extended',
      conditionExpr: 'extended',
    },
  );

  for (const id of sliceNodeIds.slice(1)) {
    edges.push({
      id: makeNodeId('edge'),
      scopeId,
      sourceNodeId: id,
      targetNodeId: p2SecurityId ?? p2JoinId,
      kind: 'dep',
      label: 'sync',
      conditionExpr: null,
    });
  }
  edges.push(
    {
      id: makeNodeId('edge'),
      scopeId,
      sourceNodeId: p2StandardId,
      targetNodeId: p2SecurityId ?? p2JoinId,
      kind: 'dep',
      label: 'sync',
      conditionExpr: null,
    },
    {
      id: makeNodeId('edge'),
      scopeId,
      sourceNodeId: p2ExtendedId,
      targetNodeId: p2SecurityId ?? p2JoinId,
      kind: 'dep',
      label: 'sync',
      conditionExpr: null,
    },
  );
  if (p2SecurityId) {
    edges.push({
      id: makeNodeId('edge'),
      scopeId,
      sourceNodeId: p2SecurityId,
      targetNodeId: p2JoinId,
      kind: 'dep',
      label: 'cleared',
      conditionExpr: null,
    });
  }

  // Explicit Inter-Phase Checkpoint 2 (between Phase 2 & Phase 3)
  nodes.push({
    id: p2CkptId,
    scopeId,
    code: 'P2.CKPT',
    parentWbsId: null,
    containerNodeId: null,
    phaseId: null,
    phaseTitle: 'Phase 2 -> Phase 3 Physical Checkpoint',
    depth: 1,
    kind: 'checkpoint',
    executorKind: 'control',
    capabilityId: controlCap,
    assignedRole: 'evaluator',
    assignedModel: null,
    title: 'Phase 2 集成物理检查点',
    description:
      'Commit integrated Phase 2 parallel worker diffs into a clean Git checkpoint prior to Phase 3 verification.',
    planningRationale:
      'Separates worker implementation state from Phase 3 shell gates and rewind boundaries.',
    requirementRefs: allReqCodes,
    inputContract: 'Unified Ready-to-Verify Snapshot',
    outputContract: 'Phase 2 Integrated Git Commit SHA',
    fileScope: [],
    gateCommand: null,
    branchCondition: null,
    status: 'pending',
    attemptCount: 0,
    maxAttempts: 1,
    collapsed: false,
    positionX: 336,
    positionY: p2CkptY,
    width: 212,
    height: 68,
    outputSummary: '',
    restoreTargetCheckpointId: null,
    updatedAt: now,
  });

  edges.push({
    id: makeNodeId('edge'),
    scopeId,
    sourceNodeId: p2JoinId,
    targetNodeId: p2CkptId,
    kind: 'dep',
    label: 'checkpoint',
    conditionExpr: null,
  });

  // Phase 3 Verification, Audit & Recovery Loop
  const gateId = makeNodeId('p3gate');
  const selfcheckId = makeNodeId('p3sc');
  const qaId = resolved.includeQaAudit ? makeNodeId('p3qa') : null;
  const ckptId = makeNodeId('p3ckpt');
  const restoreId = makeNodeId('p3rst');
  const doneId = makeNodeId('p3done');

  const p3Row1Y = p3Top + 58;
  const p3Row2Y = p3Top + 194;

  nodes.push(
    {
      id: gateId,
      scopeId,
      code: 'P3.GATE',
      parentWbsId: p3ContainerId,
      containerNodeId: p3ContainerId,
      phaseId: p3ContainerId,
      phaseTitle: 'Phase 3 · Verification & Recovery',
      depth: 1,
      kind: 'gate_shell',
      executorKind: 'tool',
      capabilityId: shellCap,
      assignedRole: 'evaluator',
      assignedModel: null,
      title: 'Deterministic Shell Gate',
      description: `Run verification command: ${verifyCommand}`,
      planningRationale:
        'Objective exit-code gate prevents self-grading before QA review.',
      requirementRefs: allAcCodes,
      inputContract: 'Phase 2 Integrated Git Commit SHA',
      outputContract: 'Gate Exit Code & Logs',
      fileScope: [],
      gateCommand: verifyCommand,
      branchCondition: null,
      status: 'pending',
      attemptCount: 0,
      maxAttempts: 2,
      collapsed: false,
      positionX: 64,
      positionY: p3Row1Y,
      width: 212,
      height: 74,
      outputSummary: '',
      restoreTargetCheckpointId: null,
      updatedAt: now,
    },
    {
      id: selfcheckId,
      scopeId,
      code: 'P3.SC',
      parentWbsId: p3ContainerId,
      containerNodeId: p3ContainerId,
      phaseId: p3ContainerId,
      phaseTitle: 'Phase 3 · Verification & Recovery',
      depth: 1,
      kind: 'selfcheck',
      executorKind: 'tool',
      capabilityId: shellCap,
      assignedRole: 'evaluator',
      assignedModel: null,
      title: 'Diff, AC & DDD Drift Check',
      description:
        'Inspect git diff, verify AC coverage, and check DDD ubiquitous terminology alignment.',
      planningRationale:
        'Catches terminology drift and incomplete acceptance evidence early.',
      requirementRefs: allAcCodes,
      inputContract: 'Gate Exit Code & Logs',
      outputContract: 'Diff & DDD Evidence Manifest',
      fileScope: [],
      gateCommand: null,
      branchCondition: null,
      status: 'pending',
      attemptCount: 0,
      maxAttempts: 2,
      collapsed: false,
      positionX: 336,
      positionY: p3Row1Y,
      width: 212,
      height: 74,
      outputSummary: '',
      restoreTargetCheckpointId: null,
      updatedAt: now,
    },
  );

  if (qaId) {
    nodes.push({
      id: qaId,
      scopeId,
      code: 'P3.QA',
      parentWbsId: p3ContainerId,
      containerNodeId: p3ContainerId,
      phaseId: p3ContainerId,
      phaseTitle: 'Phase 3 · Verification & Recovery',
      depth: 1,
      kind: 'qa_audit',
      executorKind: 'agent',
      capabilityId: evalCap,
      assignedRole: 'evaluator',
      assignedModel: null,
      title: 'Independent QA Audit',
      description:
        'Evaluate deliverable strictly against GoalSpec constraints and acceptance criteria.',
      planningRationale:
        'Independent evaluator verdict separates pass commit checkpoint from bounded fail-rewind.',
      requirementRefs: allAcCodes,
      inputContract: 'Diff & DDD Evidence Manifest',
      outputContract: 'Fail-Closed JSON Audit Verdict',
      fileScope: [],
      gateCommand: null,
      branchCondition: null,
      status: 'pending',
      attemptCount: 0,
      maxAttempts: 3,
      collapsed: false,
      positionX: 608,
      positionY: p3Row1Y,
      width: 212,
      height: 74,
      outputSummary: '',
      restoreTargetCheckpointId: null,
      updatedAt: now,
    });
  }

  nodes.push(
    {
      id: ckptId,
      scopeId,
      code: 'P3.CKPT',
      parentWbsId: p3ContainerId,
      containerNodeId: p3ContainerId,
      phaseId: p3ContainerId,
      phaseTitle: 'Phase 3 · Verification & Recovery',
      depth: 1,
      kind: 'checkpoint',
      executorKind: 'control',
      capabilityId: controlCap,
      assignedRole: 'evaluator',
      assignedModel: null,
      title: 'Physical Git Checkpoint',
      description: 'Commit certified worktree state and tag durable snapshot.',
      planningRationale:
        'Persists recoverable milestone snapshot on verified pass.',
      requirementRefs: allAcCodes.slice(0, 1),
      inputContract: qaId ? 'Pass Audit Verdict' : 'Verified Self-Check',
      outputContract: 'Git Commit SHA & Tag',
      fileScope: [],
      gateCommand: null,
      branchCondition: null,
      status: 'pending',
      attemptCount: 0,
      maxAttempts: 1,
      collapsed: false,
      positionX: 336,
      positionY: p3Row2Y,
      width: 212,
      height: 74,
      outputSummary: '',
      restoreTargetCheckpointId: null,
      updatedAt: now,
    },
    {
      id: restoreId,
      scopeId,
      code: 'P3.RST',
      parentWbsId: p3ContainerId,
      containerNodeId: p3ContainerId,
      phaseId: p3ContainerId,
      phaseTitle: 'Phase 3 · Verification & Recovery',
      depth: 1,
      kind: 'restore',
      executorKind: 'control',
      capabilityId: controlCap,
      assignedRole: 'evaluator',
      assignedModel: null,
      title: 'Bounded Rescue Rewind',
      description:
        'Create non-destructive git rescue ref and rewind execution frontier on failure.',
      planningRationale:
        'Preserves debug artifacts in rescue branch while deterministically retrying up to maxReworkIterations.',
      requirementRefs: allAcCodes.slice(0, 1),
      inputContract: 'Fail Audit / Gate Error',
      outputContract: 'Rescue Branch Ref & Re-armed Frontier',
      fileScope: [],
      gateCommand: null,
      branchCondition: null,
      status: 'pending',
      attemptCount: 0,
      maxAttempts: 3,
      collapsed: false,
      positionX: 64,
      positionY: p3Row2Y,
      width: 212,
      height: 74,
      outputSummary: '',
      restoreTargetCheckpointId: null,
      updatedAt: now,
    },
    {
      id: doneId,
      scopeId,
      code: 'DONE',
      parentWbsId: p3ContainerId,
      containerNodeId: p3ContainerId,
      phaseId: p3ContainerId,
      phaseTitle: 'Phase 3 · Verification & Recovery',
      depth: 1,
      kind: 'done',
      executorKind: 'control',
      capabilityId: controlCap,
      assignedRole: 'lead',
      assignedModel: null,
      title: 'Certified Release Complete',
      description: 'All gates, constraints, and acceptance criteria satisfied.',
      planningRationale: 'Terminal sink asserting full specification closure.',
      requirementRefs: allAcCodes,
      inputContract: 'Git Commit SHA & Tag',
      outputContract: goalSpec.outputs.join(' + '),
      fileScope: [],
      gateCommand: null,
      branchCondition: null,
      status: 'pending',
      attemptCount: 0,
      maxAttempts: 1,
      collapsed: false,
      positionX: 608,
      positionY: p3Row2Y,
      width: 212,
      height: 74,
      outputSummary: '',
      restoreTargetCheckpointId: null,
      updatedAt: now,
    },
  );

  edges.push(
    {
      id: makeNodeId('edge'),
      scopeId,
      sourceNodeId: p2CkptId,
      targetNodeId: gateId,
      kind: 'dep',
      label: 'verify',
      conditionExpr: null,
    },
    {
      id: makeNodeId('edge'),
      scopeId,
      sourceNodeId: gateId,
      targetNodeId: selfcheckId,
      kind: 'pass',
      label: 'exit 0',
      conditionExpr: null,
    },
    {
      id: makeNodeId('edge'),
      scopeId,
      sourceNodeId: gateId,
      targetNodeId: restoreId,
      kind: 'fail',
      label: 'gate fail',
      conditionExpr: null,
    },
    ...(qaId
      ? [
          {
            id: makeNodeId('edge'),
            scopeId,
            sourceNodeId: selfcheckId,
            targetNodeId: qaId,
            kind: 'dep' as const,
            label: 'audit',
            conditionExpr: null,
          },
          {
            id: makeNodeId('edge'),
            scopeId,
            sourceNodeId: qaId,
            targetNodeId: ckptId,
            kind: 'pass' as const,
            label: 'pass',
            conditionExpr: null,
          },
          {
            id: makeNodeId('edge'),
            scopeId,
            sourceNodeId: qaId,
            targetNodeId: restoreId,
            kind: 'fail' as const,
            label: 'qa fail',
            conditionExpr: null,
          },
        ]
      : [
          {
            id: makeNodeId('edge'),
            scopeId,
            sourceNodeId: selfcheckId,
            targetNodeId: ckptId,
            kind: 'dep' as const,
            label: 'commit',
            conditionExpr: null,
          },
        ]),
    {
      id: makeNodeId('edge'),
      scopeId,
      sourceNodeId: restoreId,
      targetNodeId: gateId,
      kind: 'loop',
      label: 'rework',
      conditionExpr: null,
    },
    {
      id: makeNodeId('edge'),
      scopeId,
      sourceNodeId: ckptId,
      targetNodeId: doneId,
      kind: 'dep',
      label: 'certify',
      conditionExpr: null,
    },
  );

  return {nodes, edges, resolvedCustomization: resolved, slices};
}

export function exportWorkflowPlan(args: {
  readonly workflowTitle: string;
  readonly goalSpec: GoalSpec;
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly customization?: WorkflowCustomization;
  readonly pmReport?: PmDecompositionReport | null;
}): {
  readonly markdown: string;
  readonly mermaid: string;
  readonly json: string;
} {
  const execNodes = args.nodes.filter(n => n.kind !== 'phase_container');
  const nodeById = new Map(args.nodes.map(n => [n.id, n]));

  const mermaidLines = ['flowchart LR'];
  for (const node of execNodes) {
    const safeId = node.code.replace(/[^A-Za-z0-9_]/g, '_');
    const safeLabel = `${node.code}: ${node.title}`.replace(/"/g, "'");
    if (node.kind === 'decision') {
      mermaidLines.push(`  ${safeId}{"${safeLabel}"}`);
    } else if (node.kind === 'start' || node.kind === 'done') {
      mermaidLines.push(`  ${safeId}(["${safeLabel}"])`);
    } else {
      mermaidLines.push(`  ${safeId}["${safeLabel}"]`);
    }
  }
  for (const edge of args.edges) {
    const src = nodeById.get(edge.sourceNodeId);
    const dst = nodeById.get(edge.targetNodeId);
    if (!src || !dst) {
      continue;
    }
    const s = src.code.replace(/[^A-Za-z0-9_]/g, '_');
    const d = dst.code.replace(/[^A-Za-z0-9_]/g, '_');
    const lbl = (edge.label || edge.kind).replace(/\|/g, '/');
    if (edge.kind === 'loop') {
      mermaidLines.push(`  ${s} -.->|${lbl}| ${d}`);
    } else {
      mermaidLines.push(`  ${s} -->|${lbl}| ${d}`);
    }
  }
  const mermaid = mermaidLines.join('\n');

  const lines: string[] = [
    `# SE Workflow Execution Plan: ${args.workflowTitle}`,
    '',
    `> **North Star Goal**: ${args.goalSpec.goal}`,
    '',
  ];

  if (args.customization) {
    lines.push(
      '## 1. Workflow Customization Profile',
      `- Template Preset: \`${args.customization.templatePreset}\``,
      `- Human Contract Gate: \`${String(args.customization.includeHumanGate)}\``,
      `- Security Pass: \`${String(args.customization.includeSecurityPass)}\``,
      `- Independent QA Audit: \`${String(args.customization.includeQaAudit)}\``,
      `- Max Parallel Workers: \`${args.customization.maxParallelWorkers}\``,
      `- Budget Cap (USD): \`$${args.customization.budgetUsdLimit.toFixed(2)}\``,
      '',
    );
  }

  if (args.pmReport) {
    lines.push(
      '## 2. PM Agent Task Decomposition',
      `- Mode: \`${args.pmReport.mode}\``,
      `- Narrative: ${args.pmReport.pmNarrative}`,
      '',
      '| Slice | Layer | Role | File Scope | FR Refs | Planning Rationale |',
      '| --- | --- | --- | --- | --- | --- |',
      ...args.pmReport.slices.map(
        s =>
          `| ${s.code} | ${s.layer} | ${s.assignedRole} | \`${s.fileScope.join(', ')}\` | ${s.requirementRefs.join(', ')} | ${s.rationale.replace(/\|/g, '/')} |`,
      ),
      '',
    );
  }

  lines.push(
    '## 3. Orchestrated Twin-Graph WBS Nodes',
    '| Code | Phase | Kind | Capability | Role | Trace Refs | Rationale |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...execNodes.map(
      n =>
        `| ${n.code} | ${n.phaseTitle} | ${n.kind} | ${n.capabilityId} | ${n.assignedRole} | ${n.requirementRefs.join(', ')} | ${n.planningRationale.replace(/\|/g, '/')} |`,
    ),
    '',
    '## 4. Visualized Execution DAG (Mermaid)',
    '```mermaid',
    mermaid,
    '```',
    '',
  );

  const json = JSON.stringify(
    {
      workflowTitle: args.workflowTitle,
      goalSpec: args.goalSpec,
      customization: args.customization ?? null,
      pmReport: args.pmReport ?? null,
      nodes: execNodes,
      edges: args.edges,
    },
    null,
    2,
  );

  return {
    markdown: lines.join('\n'),
    mermaid,
    json,
  };
}
