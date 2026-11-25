/**
 * Canonical domain types for the Requirements-to-Execution Real-Time Workflow
 * Orchestration Subsystem (Specification, Planning, Twin-Graph, Trial/Version,
 * Live Run Orchestrator, Capabilities, Recovery, and Audit).
 */

export type PermissionTier = 'turbo' | 'supervised' | 'strict';

export type ExecutorKind = 'agent' | 'tool' | 'human' | 'control';

export type AdapterTransport =
  | 'acp-stdio'
  | 'cli-stream'
  | 'native-api'
  | 'local-tool'
  | 'human-gate'
  | 'control-plane';

export type AgentRole = 'lead' | 'worker' | 'evaluator' | 'specialist';

export type ValidationSeverity = 'error' | 'warning' | 'info';

export type AssumptionSource = 'doc' | 'suggested' | 'user_confirmed';

export type WorkflowStatus = 'draft' | 'validated' | 'trial_passed' | 'locked';

export type WorkflowNodeKind =
  | 'phase_container'
  | 'start'
  | 'task'
  | 'decision'
  | 'join'
  | 'gate_shell'
  | 'selfcheck'
  | 'qa_audit'
  | 'human_gate'
  | 'checkpoint'
  | 'restore'
  | 'ghost'
  | 'done';

export type GraphNodeStatus =
  | 'pending'
  | 'ready'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'skipped'
  | 'waiting_human'
  | 'rewound'
  | 'waived';

export type GraphEdgeKind = 'dep' | 'pass' | 'fail' | 'loop';

export type RunStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'waiting_human'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export interface GoalRequirement {
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly description: string;
  readonly priority: 'must' | 'should';
  readonly verifyHint: string;
}

export interface AcceptanceCriterion {
  readonly id: string;
  readonly code: string;
  readonly label: string;
  readonly requirementId?: string;
  readonly verifyCommand?: string;
  readonly verified: boolean;
  readonly evidenceNodeId?: string;
}

export interface GoalAssumption {
  readonly id: string;
  readonly text: string;
  readonly source: AssumptionSource;
  readonly rationale: string;
}

export type WorkflowTemplatePreset =
  'fullstack_se' | 'microservice_hardened' | 'rapid_ui_api' | 'custom';

export interface WorkflowCustomization {
  readonly templatePreset: WorkflowTemplatePreset;
  readonly includeHumanGate: boolean;
  readonly includeSecurityPass: boolean;
  readonly includeQaAudit: boolean;
  readonly maxParallelWorkers: number;
  readonly dddStrictCheck: boolean;
  readonly pmAgentMode: 'hybrid_llm' | 'structural';
  readonly budgetUsdLimit: number;
}

export interface DesignSpecModule {
  readonly name: string;
  readonly layer:
    'contract' | 'backend' | 'frontend' | 'data' | 'security' | 'integration';
  readonly summary: string;
  readonly artifacts: readonly string[];
  readonly relatedFrCodes: readonly string[];
}

export interface PmDecompositionSlice {
  readonly code: string;
  readonly title: string;
  readonly phase: 'P1' | 'P2' | 'P3';
  readonly layer: DesignSpecModule['layer'];
  readonly requirementRefs: readonly string[];
  readonly dependsOnCodes: readonly string[];
  readonly assignedRole: AgentRole;
  readonly executorKind: ExecutorKind;
  readonly fileScope: readonly string[];
  readonly rationale: string;
}

export interface PmDecompositionReport {
  readonly id: string;
  readonly workflowId: string;
  readonly mode: 'llm_assisted' | 'structural_pm';
  readonly templatePreset: WorkflowTemplatePreset;
  readonly detectedModules: readonly DesignSpecModule[];
  readonly slices: readonly PmDecompositionSlice[];
  readonly pmNarrative: string;
  readonly skillsApplied: readonly string[];
  readonly createdAt: string;
}

export interface GoalSpec {
  readonly id: string;
  readonly workflowId: string;
  readonly rawMarkdown: string;
  readonly requirementsBaseline?: {
    readonly id: string;
    readonly projectId: string;
    readonly revision: number;
    readonly sha256: string;
  };
  readonly title: string;
  readonly goal: string;
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
  readonly constraints: readonly string[];
  readonly domainRules: readonly string[];
  readonly modules?: readonly DesignSpecModule[];
  readonly requirements: readonly GoalRequirement[];
  readonly acceptanceCriteria: readonly AcceptanceCriterion[];
  readonly assumptions: readonly GoalAssumption[];
  readonly updatedAt: string;
}

export interface GraphNode {
  readonly id: string;
  readonly scopeId: string;
  readonly code: string;
  readonly parentWbsId: string | null;
  readonly containerNodeId: string | null;
  readonly phaseId: string | null;
  readonly phaseTitle: string;
  readonly depth: number;
  readonly kind: WorkflowNodeKind;
  readonly executorKind: ExecutorKind;
  readonly capabilityId: string;
  readonly assignedRole: AgentRole;
  readonly assignedModel: string | null;
  readonly title: string;
  readonly description: string;
  readonly planningRationale: string;
  readonly requirementRefs: readonly string[];
  readonly inputContract: string;
  readonly outputContract: string;
  readonly fileScope: readonly string[];
  readonly gateCommand: string | null;
  readonly branchCondition: string | null;
  readonly status: GraphNodeStatus;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly collapsed: boolean;
  readonly positionX: number;
  readonly positionY: number;
  readonly width: number;
  readonly height: number;
  readonly outputSummary: string;
  readonly restoreTargetCheckpointId: string | null;
  readonly updatedAt: string;
}

export interface GraphEdge {
  readonly id: string;
  readonly scopeId: string;
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
  readonly kind: GraphEdgeKind;
  readonly label: string;
  readonly conditionExpr: string | null;
}

export type ValidationCategory =
  | 'structure'
  | 'spec_coverage'
  | 'contract'
  | 'capability'
  | 'policy'
  | 'conflict'
  | 'ddd_drift';

export interface ValidationIssue {
  readonly id: string;
  readonly level: ValidationSeverity;
  readonly category: ValidationCategory;
  readonly nodeCode: string | null;
  readonly requirementCode: string | null;
  readonly message: string;
  readonly suggestion: string;
}

export interface ValidationReport {
  readonly workflowId: string;
  readonly valid: boolean;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly infoCount: number;
  readonly issues: readonly ValidationIssue[];
  readonly checkedAt: string;
}

export interface ChangeImpactReport {
  readonly workflowId: string;
  readonly modifiedNodeCodes: readonly string[];
  readonly addedNodeCodes: readonly string[];
  readonly removedNodeCodes: readonly string[];
  readonly affectedDownstreamCodes: readonly string[];
  readonly impactedRequirementCodes: readonly string[];
  readonly requiresRevalidation: boolean;
  readonly requiresRetrial: boolean;
  readonly summary: string;
  readonly analyzedAt: string;
}

export interface TrialStepTrace {
  readonly nodeCode: string;
  readonly title: string;
  readonly executorKind: ExecutorKind;
  readonly capabilityId: string;
  readonly simulatedStatus:
    'succeeded' | 'skipped' | 'waiting_human' | 'failed';
  readonly branchDecision: string | null;
  readonly note: string;
}

export interface TrialRunReport {
  readonly id: string;
  readonly workflowId: string;
  readonly passed: boolean;
  readonly durationMs: number;
  readonly simulatedPath: readonly string[];
  readonly skippedNodes: readonly string[];
  readonly blockingIssues: readonly ValidationIssue[];
  readonly steps: readonly TrialStepTrace[];
  readonly ranAt: string;
}

export interface WorkspaceEntry {
  readonly id: string;
  readonly name: string;
  readonly rootPath: string;
  readonly defaultBranch: string;
  readonly verifyCommand: string;
  readonly description: string;
  readonly createdAt: string;
}

export interface WorkflowRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly code: string;
  readonly title: string;
  readonly description: string;
  readonly status: WorkflowStatus;
  readonly currentVersionNumber: number;
  readonly permissionTier: PermissionTier;
  readonly verifyCommand: string;
  readonly maxReworkIterations: number;
  readonly customization?: WorkflowCustomization;
  readonly lastHumanReviewedAt?: string;
  readonly spacedReviewCount?: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WorkflowVersionSnapshot {
  readonly id: string;
  readonly workflowId: string;
  readonly versionNumber: number;
  readonly versionTag: string;
  readonly label: string;
  readonly goalSpec: GoalSpec;
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly validation: ValidationReport;
  readonly trial: TrialRunReport | null;
  readonly frozenBy: string;
  readonly createdAt: string;
}

export interface WorkflowRunRecord {
  readonly id: string;
  readonly workflowId: string;
  readonly versionId: string;
  readonly versionTag: string;
  readonly title: string;
  readonly status: RunStatus;
  readonly permissionTier: PermissionTier;
  readonly worktreePath: string;
  readonly gitBranch: string;
  readonly baseCommitSha: string;
  readonly verifyCommand: string;
  readonly maxReworkIterations: number;
  readonly reworkCount: number;
  readonly totalNodes: number;
  readonly completedNodes: number;
  readonly failedNodes: number;
  readonly skippedNodes: number;
  readonly budgetUsdLimit?: number;
  readonly spentUsd?: number;
  readonly inputTokens?: number;
  readonly cachedTokens?: number;
  readonly outputTokens?: number;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly updatedAt: string;
}

export interface NodeAttemptRecord {
  readonly id: string;
  readonly runId: string;
  readonly nodeId: string;
  readonly nodeCode: string;
  readonly attemptNumber: number;
  readonly executorKind: ExecutorKind;
  readonly capabilityId: string;
  readonly model: string;
  readonly status: 'running' | 'succeeded' | 'failed' | 'skipped';
  readonly exitCode: number | null;
  readonly durationSec: number;
  readonly inputTokens?: number;
  readonly cachedTokens?: number;
  readonly outputTokens?: number;
  readonly costUsd?: number;
  readonly inputSnapshotJson: string;
  readonly outputSummary: string;
  readonly errorMessage: string;
  readonly sessionId: string | null;
  readonly startedAt: string;
  readonly finishedAt: string | null;
}

export interface CheckpointRecord {
  readonly id: string;
  readonly runId: string;
  readonly nodeId: string;
  readonly label: string;
  readonly gitCommitSha: string;
  readonly gitTag: string;
  readonly rescueRef: string | null;
  readonly completedNodeCount: number;
  readonly totalNodeCount: number;
  readonly engineSnapshotJson: string;
  readonly createdAt: string;
}

export interface InterventionItem {
  readonly id: string;
  readonly runId: string;
  readonly nodeId: string | null;
  readonly kind:
    | 'human_gate'
    | 'ambiguity'
    | 'escalation'
    | 'ghost_amendment'
    | 'circuit_breaker';
  readonly question: string;
  readonly contextSnippet: string;
  readonly options: readonly string[];
  readonly recommendedIndex: number;
  readonly downstreamBlockedCount: number;
  readonly estimatedReadSeconds: number;
  readonly status: 'open' | 'resolved' | 'dismissed';
  readonly resolution: string | null;
  readonly createdAt: string;
  readonly resolvedAt: string | null;
}

export interface CapabilityAdapterManifest {
  readonly id: string;
  readonly label: string;
  readonly executorKind: ExecutorKind;
  readonly specialty: string;
  readonly sovereignSoul: string;
  readonly transport: AdapterTransport;
  readonly command: string;
  readonly baseArgs: readonly string[];
  readonly healthProbeArgs: readonly string[];
  readonly mcpInjection:
    'acp-session' | 'claude-mcp-json' | 'codex-flag' | 'env-url' | 'none';
  readonly jsonlParser:
    | 'claude-stream'
    | 'codex-rpc'
    | 'opencode-json'
    | 'pi-json'
    | 'generic-jsonl'
    | 'none';
  readonly permissionFlags: {
    readonly turbo: readonly string[];
    readonly supervised: readonly string[];
    readonly strict: readonly string[];
  };
  readonly envAllowlist: readonly string[];
  readonly defaultModel: string;
  readonly supportedRoles: readonly AgentRole[];
  readonly maxConcurrentSlots: number;
  readonly enabled: boolean;
  readonly builtIn: boolean;
  readonly probeOk: boolean | null;
  readonly probeMessage: string;
  readonly probedAt: string | null;
}

export interface CapabilityHealthProfile {
  readonly capabilityId: string;
  readonly totalRuns: number;
  readonly recentFailureCount: number;
  readonly avgDurationSec: number;
  readonly successRate: number;
  readonly circuitState: 'closed' | 'half_open' | 'open';
  readonly lastCheckedAt: string | null;
  readonly lastError: string;
}

export interface ModelCatalogEntry {
  readonly id: string;
  readonly label: string;
  readonly tier: 'strong' | 'fast';
  readonly inputUsdPerMillion: number;
  readonly cachedInputUsdPerMillion: number;
  readonly outputUsdPerMillion: number;
  readonly contextWindowTokens: number;
}

export interface ModelProviderConfig {
  readonly id: string;
  readonly name: string;
  readonly protocol: 'openai-compatible' | 'anthropic-messages';
  readonly baseUrl: string;
  readonly models: readonly ModelCatalogEntry[];
  readonly hasApiKey: boolean;
  readonly maskedKeyHint: string;
  readonly updatedAt: string;
}

export interface TranscriptSession {
  readonly id: string;
  readonly runId: string | null;
  readonly nodeId: string | null;
  readonly capabilityId: string;
  readonly model: string;
  readonly role: AgentRole;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly status: 'running' | 'completed' | 'failed';
}

export interface TranscriptMessage {
  readonly id: string;
  readonly sessionId: string;
  readonly seq: number;
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string;
  readonly toolName: string | null;
  readonly isError: boolean;
  readonly inputTokens: number;
  readonly cachedTokens: number;
  readonly outputTokens: number;
  readonly createdAt: string;
}

export interface AuditLedgerEntry {
  readonly id: string;
  readonly workflowId: string | null;
  readonly runId: string | null;
  readonly category:
    | 'spec'
    | 'plan'
    | 'validation'
    | 'trial'
    | 'version'
    | 'execution'
    | 'checkpoint'
    | 'intervention'
    | 'capability'
    | 'governance'
    | 'dreaming';
  readonly author: string;
  readonly title: string;
  readonly detail: string;
  readonly createdAt: string;
}

export interface DomainTermEntry {
  readonly id: string;
  readonly workspaceId: string;
  readonly boundedContext: string;
  readonly canonicalTerm: string;
  readonly localLabel: string;
  readonly definition: string;
  readonly forbiddenAliases: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SkillEntry {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly category: 'pm_plan' | 'backend' | 'frontend' | 'qa' | 'governance';
  readonly content: string;
  readonly timesUsed: number;
  readonly stabilityHours: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface McpServerEntry {
  readonly id: string;
  readonly name: string;
  readonly transport: 'stdio' | 'http';
  readonly endpointOrCommand: string;
  readonly description: string;
  readonly enabled: boolean;
  readonly toolsCount: number;
  readonly status: 'ready' | 'untested' | 'offline';
  readonly updatedAt: string;
}

export interface ConstitutionRule {
  readonly id: string;
  readonly markdown: string;
  readonly blockedCommands: readonly string[];
  readonly updatedAt: string;
}

export type RehydrationTier = 'warm' | 'delta_30s' | 'deep_reanchor';

export interface RehydrationCapsule {
  readonly workflowId: string;
  readonly workflowTitle: string;
  readonly workflowCode: string;
  readonly retentionScore: number;
  readonly stabilityHours: number;
  readonly elapsedHours: number;
  readonly mutationEntropy: number;
  readonly tier: RehydrationTier;
  readonly northStarGoal: string;
  readonly lastHumanAnchor: string;
  readonly autonomousDeltaBullets: readonly string[];
  readonly lockedDecisions: readonly string[];
  readonly nextDecisionPrompt: string | null;
  readonly generatedAt: string;
}

export interface BuiltinDesignSpecPreset {
  readonly id: string;
  readonly nameZh: string;
  readonly nameEn: string;
  readonly categoryZh: string;
  readonly categoryEn: string;
  readonly recommendedTemplate: WorkflowTemplatePreset;
  readonly markdown: string;
}

export interface SlotLoadSnapshot {
  readonly maxWorkerSlots: number;
  readonly activeWorkerSlots: number;
  readonly queuedWorkerTasks: number;
  readonly humanPrioritySlotBusy: boolean;
}

export interface EpistemicHandoff {
  readonly specConfirmedFacts: readonly string[];
  readonly agentHypotheses: readonly string[];
  readonly openConflicts: readonly string[];
  readonly uncertifiedCriteria: readonly string[];
}
