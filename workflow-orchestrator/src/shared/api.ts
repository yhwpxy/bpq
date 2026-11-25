/**
 * Shared HTTP + Multiplexed SSE wire DTO contracts and Electron Preload Bridge.
 */

import type {
  AuditLedgerEntry,
  BuiltinDesignSpecPreset,
  CapabilityAdapterManifest,
  CapabilityHealthProfile,
  ChangeImpactReport,
  CheckpointRecord,
  ConstitutionRule,
  DomainTermEntry,
  GoalSpec,
  GraphEdge,
  GraphNode,
  InterventionItem,
  McpServerEntry,
  ModelProviderConfig,
  NodeAttemptRecord,
  PermissionTier,
  PmDecompositionReport,
  RehydrationCapsule,
  SkillEntry,
  SlotLoadSnapshot,
  TranscriptMessage,
  TranscriptSession,
  TrialRunReport,
  ValidationReport,
  WorkflowCustomization,
  WorkflowRecord,
  WorkflowRunRecord,
  WorkflowVersionSnapshot,
  WorkspaceEntry,
} from './types.ts';

export interface OrchestratorSseEvent {
  readonly seq: number;
  readonly type:
    | 'snapshot.invalidated'
    | 'workflow.updated'
    | 'run.status'
    | 'node.status'
    | 'attempt.updated'
    | 'checkpoint.created'
    | 'intervention.created'
    | 'intervention.resolved'
    | 'session.chunk'
    | 'audit.appended'
    | 'heartbeat';
  readonly workflowId?: string | null;
  readonly runId?: string | null;
  readonly nodeId?: string | null;
  readonly payload: Record<string, unknown>;
  readonly timestamp: string;
}

export interface EvidenceSearchHit {
  readonly source: 'session_message' | 'audit_ledger' | 'attempt';
  readonly id: string;
  readonly title: string;
  readonly snippet: string;
  readonly runId: string | null;
  readonly nodeId: string | null;
  readonly createdAt: string;
}

export interface RunLiveLogEntry {
  readonly id: string;
  readonly nodeCode: string;
  readonly capabilityId: string;
  readonly role: 'system' | 'user' | 'assistant' | 'tool' | 'audit';
  readonly toolName: string | null;
  readonly content: string;
  readonly createdAt: string;
}

export interface InfraStatusSnapshot {
  readonly opencodeGoConfigured: boolean;
  readonly defaultModel: string;
  readonly proxyConfigured: boolean;
  readonly gitReady: boolean;
}

export interface BootstrapSnapshot {
  readonly daemonVersion: string;
  readonly startedAt: string;
  readonly slots: SlotLoadSnapshot;
  readonly workspaces: readonly WorkspaceEntry[];
  readonly workflows: readonly WorkflowRecord[];
  readonly versions: readonly WorkflowVersionSnapshot[];
  readonly runs: readonly WorkflowRunRecord[];
  readonly openInterventions: readonly InterventionItem[];
  readonly capabilities: readonly CapabilityAdapterManifest[];
  readonly capabilityHealth: readonly CapabilityHealthProfile[];
  readonly modelProviders: readonly ModelProviderConfig[];
  readonly recentAudit: readonly AuditLedgerEntry[];
  readonly domainTerms: readonly DomainTermEntry[];
  readonly skills: readonly SkillEntry[];
  readonly mcpServers: readonly McpServerEntry[];
  readonly constitution: ConstitutionRule;
  readonly rehydrationCapsules: readonly RehydrationCapsule[];
  readonly designSpecPresets: readonly BuiltinDesignSpecPreset[];
  readonly infraStatus?: InfraStatusSnapshot;
}

export interface WorkflowDetailSnapshot {
  readonly workflow: WorkflowRecord;
  readonly goalSpec: GoalSpec;
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly validation: ValidationReport;
  readonly latestTrial: TrialRunReport | null;
  readonly lastImpact: ChangeImpactReport | null;
  readonly pmReport: PmDecompositionReport | null;
  readonly versions: readonly WorkflowVersionSnapshot[];
}

export interface RunDetailSnapshot {
  readonly run: WorkflowRunRecord;
  readonly version: WorkflowVersionSnapshot;
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly attempts: readonly NodeAttemptRecord[];
  readonly checkpoints: readonly CheckpointRecord[];
  readonly interventions: readonly InterventionItem[];
  readonly sessions: readonly TranscriptSession[];
  readonly recentAudit: readonly AuditLedgerEntry[];
  readonly rehydrationCapsule?: RehydrationCapsule | null;
  readonly liveLogs?: readonly RunLiveLogEntry[];
}

export interface ImportRequirementsRequest {
  readonly workspaceId: string;
  readonly title?: string;
  readonly markdown: string;
  readonly verifyCommand?: string;
  readonly permissionTier?: PermissionTier;
  readonly maxReworkIterations?: number;
  readonly preferAiPlanner?: boolean;
  readonly customization?: Partial<WorkflowCustomization>;
}

export interface ExportWorkflowPlanResponse {
  readonly workflowId: string;
  readonly code: string;
  readonly title: string;
  readonly markdown: string;
  readonly mermaid: string;
  readonly json: Record<string, unknown>;
}

export interface UpdateGoalSpecRequest {
  readonly title?: string;
  readonly goal?: string;
  readonly rawMarkdown?: string;
  readonly inputs?: readonly string[];
  readonly outputs?: readonly string[];
  readonly constraints?: readonly string[];
  readonly domainRules?: readonly string[];
  readonly assumptions?: GoalSpec['assumptions'];
  readonly requirements?: GoalSpec['requirements'];
  readonly acceptanceCriteria?: GoalSpec['acceptanceCriteria'];
}

export interface DraftNodePatchInput {
  readonly id: string;
  readonly title?: string;
  readonly description?: string;
  readonly planningRationale?: string;
  readonly capabilityId?: string;
  readonly assignedModel?: string | null;
  readonly executorKind?: GraphNode['executorKind'];
  readonly requirementRefs?: readonly string[];
  readonly inputContract?: string;
  readonly outputContract?: string;
  readonly fileScope?: readonly string[];
  readonly gateCommand?: string | null;
  readonly branchCondition?: string | null;
  readonly positionX?: number;
  readonly positionY?: number;
}

export interface UpdateDraftGraphRequest {
  readonly nodePatches?: readonly DraftNodePatchInput[];
  readonly addNodes?: readonly {
    readonly code: string;
    readonly title: string;
    readonly description: string;
    readonly planningRationale: string;
    readonly kind: GraphNode['kind'];
    readonly executorKind: GraphNode['executorKind'];
    readonly capabilityId: string;
    readonly parentWbsId?: string | null;
    readonly containerNodeId?: string | null;
    readonly phaseId?: string | null;
    readonly phaseTitle?: string;
    readonly requirementRefs?: readonly string[];
    readonly inputContract?: string;
    readonly outputContract?: string;
    readonly fileScope?: readonly string[];
    readonly gateCommand?: string | null;
    readonly afterNodeId?: string | null;
  }[];
  readonly removeNodeIds?: readonly string[];
  readonly addEdges?: readonly {
    readonly sourceNodeId: string;
    readonly targetNodeId: string;
    readonly kind: GraphEdge['kind'];
    readonly label?: string;
    readonly conditionExpr?: string | null;
  }[];
  readonly removeEdgeIds?: readonly string[];
}

export interface ConfirmVersionRequest {
  readonly label?: string;
  readonly frozenBy?: string;
}

export interface StartRunRequest {
  readonly workflowId: string;
  readonly versionId?: string;
  readonly title?: string;
  readonly permissionTier?: PermissionTier;
}

export interface ResolveInterventionRequest {
  readonly resolution: string;
  readonly action?: 'approve' | 'reject' | 'override';
}

export interface ProposeGhostNodeRequest {
  readonly title: string;
  readonly description: string;
  readonly executorKind?: GraphNode['executorKind'];
  readonly capabilityId?: string;
  readonly gateCommand?: string | null;
  readonly insertBeforeNodeId?: string | null;
}

export interface RegisterCapabilityRequest {
  readonly manifest: Omit<
    CapabilityAdapterManifest,
    'probeOk' | 'probeMessage' | 'probedAt'
  >;
}

export interface UpdateProviderSecretRequest {
  readonly apiKey: string;
  readonly baseUrl?: string;
}

export interface OrchestratorPreloadBridge {
  readonly apiBaseUrl: string;
  readonly sessionToken: string;
  readonly platform: string;
}

export type SessionTranscriptView = {
  readonly session: TranscriptSession;
  readonly messages: readonly TranscriptMessage[];
};
