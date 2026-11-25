import type {
  ApprovedRequirementsBaseline, DecisionInput, RunSummary, RunView, StartInput,
} from '../../../../requirements-engineering/src/contracts.ts';
import type {CreateDesignInput, DesignInputDraft, WorkspaceInventory} from '../../../../software-design/src/contracts.ts';
import type {DesignGeneration} from '../../../../software-design/src/generator.ts';
import type {GenerationRequest} from '../../../../software-design/src/design-schema.ts';
import type {DesignRevision, ReviewRequest} from '../../../../software-design/src/reviews.ts';
import type {DesignPmInput} from '../../../../software-design/src/pm-input.ts';
import type {DesignHandoffReceipt} from '../../../../software-design/src/handoff.ts';
import type {
  BootstrapSnapshot,
  ConfirmVersionRequest,
  EvidenceSearchHit,
  ExportWorkflowPlanResponse,
  ImportRequirementsRequest,
  OrchestratorPreloadBridge,
  OrchestratorSseEvent,
  ProposeGhostNodeRequest,
  RegisterCapabilityRequest,
  ResolveInterventionRequest,
  RunDetailSnapshot,
  SessionTranscriptView,
  StartRunRequest,
  UpdateDraftGraphRequest,
  UpdateGoalSpecRequest,
  UpdateProviderSecretRequest,
  WorkflowDetailSnapshot,
} from '../../../src/shared/api';
import type {
  CapabilityAdapterManifest,
  CapabilityHealthProfile,
  ConstitutionRule,
  DomainTermEntry,
  McpServerEntry,
  ModelProviderConfig,
  RehydrationCapsule,
  SkillEntry,
  WorkflowRecord,
  WorkflowVersionSnapshot,
  WorkspaceEntry,
} from '../../../src/shared/types';

declare global {
  interface Window {
    readonly workflowOrchestrator?: OrchestratorPreloadBridge;
    readonly __ORCH_BOOT__?: {
      readonly apiBaseUrl: string;
      readonly token: string;
    };
  }
}

export interface DoctorReportDto {
  readonly gitReady: boolean;
  readonly gitVersion: string;
  readonly nodeVersion: string;
  readonly capabilityHealth: readonly CapabilityHealthProfile[];
  readonly prunedWorktrees?: readonly string[];
  readonly checkedAt: string;
}

function getBridgeConfig(): {
  readonly apiBaseUrl: string;
  readonly sessionToken: string;
} {
  if (window.workflowOrchestrator?.apiBaseUrl) {
    return {
      apiBaseUrl: window.workflowOrchestrator.apiBaseUrl,
      sessionToken: window.workflowOrchestrator.sessionToken,
    };
  }
  if (window.__ORCH_BOOT__?.token) {
    return {
      apiBaseUrl:
        window.__ORCH_BOOT__.apiBaseUrl ||
        (window.location.protocol.startsWith('http')
          ? window.location.origin
          : 'http://127.0.0.1:4190'),
      sessionToken: window.__ORCH_BOOT__.token,
    };
  }
  const params = new URLSearchParams(window.location.search);
  const originFallback = window.location.protocol.startsWith('http')
    ? window.location.origin
    : 'http://127.0.0.1:4190';
  return {
    apiBaseUrl: params.get('apiBaseUrl') ?? originFallback,
    sessionToken: params.get('token') ?? '',
  };
}

async function apiFetch<T>(
  path: string,
  options?: {readonly method?: 'GET' | 'POST'; readonly body?: unknown},
): Promise<T> {
  const cfg = getBridgeConfig();
  const res = await fetch(`${cfg.apiBaseUrl}${path}`, {
    method: options?.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${cfg.sessionToken}`,
      'Content-Type': 'application/json',
    },
    body:
      options?.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const msg =
      typeof json['error'] === 'string'
        ? json['error']
        : `HTTP ${res.status} error`;
    throw Object.assign(new Error(msg), {code: json['code'], details: json['details'], status: res.status});
  }
  return json as T;
}

export const orchApi = {
  handoffDesign: (id: string, revision: number, body: {workspaceId: string; expectedHash: string}) =>
    apiFetch<DesignHandoffReceipt>(`/api/designs/${id}/revisions/${revision}/handoff`, {method: 'POST', body}),
  designHandoff: (id: string, revision: number, workspaceId: string, expectedHash: string) =>
    apiFetch<DesignHandoffReceipt>(`/api/designs/${id}/revisions/${revision}/handoff?workspaceId=${encodeURIComponent(workspaceId)}&expectedHash=${encodeURIComponent(expectedHash)}`),
  workflowDesignHandoff: (id: string) => apiFetch<DesignHandoffReceipt>(`/api/workflows/${id}/design-handoff`),
  designPmInput: (id: string, revision: number, expectedHash: string) => apiFetch<DesignPmInput>(`/api/designs/${id}/revisions/${revision}/pm-input?expectedHash=${encodeURIComponent(expectedHash)}`),
  designHeads: (baselineId?: string) => apiFetch<DesignRevision[]>(`/api/designs${baselineId ? `?baselineId=${encodeURIComponent(baselineId)}` : ''}`),
  designRevisions: (id: string) => apiFetch<DesignRevision[]>(`/api/designs/${id}/revisions`),
  designRevision: (id: string, revision: number) => apiFetch<DesignRevision>(`/api/designs/${id}/revisions/${revision}`),
  createDesignRevision: (id: string, body: unknown) => apiFetch<DesignRevision>(`/api/designs/${id}/revisions`, {method: 'POST', body}),
  reviewDesignRevision: (id: string, revision: number, body: ReviewRequest) => apiFetch<DesignRevision>(`/api/designs/${id}/revisions/${revision}/review`, {method: 'POST', body}),
  generateDesign: (id: string, body: GenerationRequest) => apiFetch<DesignGeneration>(`/api/designs/${id}/generate`, {method: 'POST', body}),
  designGenerations: (id: string) => apiFetch<DesignGeneration[]>(`/api/designs/${id}/generations`),
  designWorkspace: (id: string) => apiFetch<WorkspaceInventory>(`/api/design-workspaces/${encodeURIComponent(id)}`),
  createDesign: (body: CreateDesignInput) => apiFetch<DesignInputDraft>('/api/designs', {method: 'POST', body}),
  getBootstrap: () => apiFetch<BootstrapSnapshot>('/api/bootstrap'),
  hamaRuns: () => apiFetch<RunSummary[]>('/api/hama/runs'),
  hamaRun: (id: string) => apiFetch<RunView>(`/api/hama/runs/${id}`),
  startHamaRun: (body: StartInput) => apiFetch<RunView>('/api/hama/runs', {method: 'POST', body}),
  decideHamaGate: (run: string, gate: string, body: DecisionInput) =>
    apiFetch<RunView>(`/api/hama/runs/${run}/gates/${gate}`, {method: 'POST', body}),
  hamaBaselines: (project: string) => apiFetch<ApprovedRequirementsBaseline[]>(
    `/api/hama/baselines?projectId=${encodeURIComponent(project)}`),
  importHamaBaseline: (body: {workspaceId: string; baselineId: string}) =>
    apiFetch<WorkflowDetailSnapshot>('/api/workflows/import-requirements', {method: 'POST', body}),

  createWorkspace: (body: {
    readonly name: string;
    readonly rootPath: string;
    readonly verifyCommand?: string;
    readonly description?: string;
  }) =>
    apiFetch<{readonly workspace: WorkspaceEntry}>('/api/workspaces', {
      method: 'POST',
      body,
    }),

  importRequirements: (body: ImportRequirementsRequest) =>
    apiFetch<WorkflowDetailSnapshot>('/api/workflows/import-requirements', {
      method: 'POST',
      body,
    }),

  getWorkflowDetail: (workflowId: string) =>
    apiFetch<WorkflowDetailSnapshot>(`/api/workflows/${workflowId}`),

  updateGoalSpec: (workflowId: string, body: UpdateGoalSpecRequest) =>
    apiFetch<WorkflowDetailSnapshot>(`/api/workflows/${workflowId}/spec`, {
      method: 'POST',
      body,
    }),

  updateDraftGraph: (workflowId: string, body: UpdateDraftGraphRequest) =>
    apiFetch<WorkflowDetailSnapshot>(
      `/api/workflows/${workflowId}/draft-graph`,
      {
        method: 'POST',
        body,
      },
    ),

  replanWorkflow: (workflowId: string) =>
    apiFetch<WorkflowDetailSnapshot>(`/api/workflows/${workflowId}/replan`, {
      method: 'POST',
      body: {},
    }),

  runTrial: (workflowId: string) =>
    apiFetch<WorkflowDetailSnapshot>(`/api/workflows/${workflowId}/trial`, {
      method: 'POST',
      body: {},
    }),

  confirmVersion: (workflowId: string, body: ConfirmVersionRequest = {}) =>
    apiFetch<{
      readonly version: WorkflowVersionSnapshot;
      readonly workflow: WorkflowDetailSnapshot;
    }>(`/api/workflows/${workflowId}/confirm-version`, {
      method: 'POST',
      body,
    }),

  startRun: (body: StartRunRequest) =>
    apiFetch<RunDetailSnapshot>('/api/runs', {method: 'POST', body}),

  getRunDetail: (runId: string) =>
    apiFetch<RunDetailSnapshot>(`/api/runs/${runId}`),

  pauseRun: (runId: string) =>
    apiFetch<RunDetailSnapshot>(`/api/runs/${runId}/pause`, {
      method: 'POST',
      body: {},
    }),

  resumeRun: (runId: string) =>
    apiFetch<RunDetailSnapshot>(`/api/runs/${runId}/resume`, {
      method: 'POST',
      body: {},
    }),

  cancelRun: (runId: string) =>
    apiFetch<RunDetailSnapshot>(`/api/runs/${runId}/cancel`, {
      method: 'POST',
      body: {},
    }),

  retryNode: (runId: string, nodeId: string) =>
    apiFetch<RunDetailSnapshot>(`/api/runs/${runId}/retry-node`, {
      method: 'POST',
      body: {nodeId},
    }),

  proposeGhostNode: (runId: string, body: ProposeGhostNodeRequest) =>
    apiFetch<RunDetailSnapshot>(`/api/runs/${runId}/ghost-node`, {
      method: 'POST',
      body,
    }),

  manualRestore: (runId: string, checkpointId: string) =>
    apiFetch<RunDetailSnapshot>(`/api/runs/${runId}/restore`, {
      method: 'POST',
      body: {checkpointId},
    }),

  setNodeCollapsed: (nodeId: string, collapsed: boolean) =>
    apiFetch(`/api/nodes/${nodeId}/collapse`, {
      method: 'POST',
      body: {collapsed},
    }),

  resolveIntervention: (
    interventionId: string,
    body: ResolveInterventionRequest,
  ) =>
    apiFetch<RunDetailSnapshot>(
      `/api/interventions/${interventionId}/resolve`,
      {
        method: 'POST',
        body,
      },
    ),

  registerCapability: (body: RegisterCapabilityRequest) =>
    apiFetch<{
      readonly capabilities: readonly CapabilityAdapterManifest[];
      readonly capabilityHealth: readonly CapabilityHealthProfile[];
    }>('/api/capabilities', {method: 'POST', body}),

  probeCapability: (id: string) =>
    apiFetch<{
      readonly probe: {readonly ok: boolean; readonly message: string};
      readonly capabilities: readonly CapabilityAdapterManifest[];
      readonly capabilityHealth: readonly CapabilityHealthProfile[];
    }>(`/api/capabilities/${id}/probe`, {method: 'POST', body: {}}),

  toggleCapability: (id: string, enabled: boolean) =>
    apiFetch<{
      readonly capabilities: readonly CapabilityAdapterManifest[];
      readonly capabilityHealth: readonly CapabilityHealthProfile[];
    }>(`/api/capabilities/${id}/toggle`, {method: 'POST', body: {enabled}}),

  setProviderSecret: (providerId: string, body: UpdateProviderSecretRequest) =>
    apiFetch<{readonly modelProviders: readonly ModelProviderConfig[]}>(
      `/api/providers/${providerId}/secret`,
      {method: 'POST', body},
    ),

  getSessionTranscript: (sessionId: string) =>
    apiFetch<SessionTranscriptView>(`/api/sessions/${sessionId}`),

  searchEvidence: (q: string) =>
    apiFetch<{readonly hits: readonly EvidenceSearchHit[]}>(
      `/api/evidence/search?q=${encodeURIComponent(q)}`,
    ),

  runDoctor: () =>
    apiFetch<DoctorReportDto>('/api/doctor', {method: 'POST', body: {}}),

  exportWorkflowPlan: (workflowId: string) =>
    apiFetch<ExportWorkflowPlanResponse>(`/api/workflows/${workflowId}/export`),

  markWorkflowReviewed: (workflowId: string) =>
    apiFetch<{
      readonly workflow: WorkflowRecord;
      readonly capsule: RehydrationCapsule;
    }>(`/api/workflows/${workflowId}/review-anchor`, {
      method: 'POST',
      body: {},
    }),

  upsertDomainTerm: (body: {
    readonly id?: string;
    readonly workspaceId?: string;
    readonly boundedContext: string;
    readonly canonicalTerm: string;
    readonly localLabel?: string;
    readonly definition?: string;
    readonly forbiddenAliases: readonly string[];
  }) =>
    apiFetch<{
      readonly term: DomainTermEntry;
      readonly domainTerms: readonly DomainTermEntry[];
    }>('/api/ddd-terms', {method: 'POST', body}),

  deleteDomainTerm: (id: string) =>
    apiFetch<{readonly domainTerms: readonly DomainTermEntry[]}>(
      `/api/ddd-terms/${id}/delete`,
      {method: 'POST', body: {}},
    ),

  upsertSkill: (body: {
    readonly id?: string;
    readonly slug: string;
    readonly title: string;
    readonly category: SkillEntry['category'];
    readonly content: string;
  }) =>
    apiFetch<{
      readonly skill: SkillEntry;
      readonly skills: readonly SkillEntry[];
    }>('/api/skills', {method: 'POST', body}),

  runDreamConsolidation: () =>
    apiFetch<{
      readonly consolidatedRuns: number;
      readonly reinforcedSkills: number;
      readonly distilledSkill: SkillEntry | null;
      readonly capsules: readonly RehydrationCapsule[];
      readonly totalSpentUsd: number;
      readonly skills: readonly SkillEntry[];
    }>('/api/dream/consolidate', {method: 'POST', body: {}}),

  upsertMcpServer: (body: {
    readonly id?: string;
    readonly name: string;
    readonly transport: 'http' | 'stdio';
    readonly endpointOrCommand: string;
    readonly description?: string;
    readonly enabled?: boolean;
    readonly toolsCount?: number;
  }) =>
    apiFetch<{
      readonly mcpServer: McpServerEntry;
      readonly mcpServers: readonly McpServerEntry[];
    }>('/api/mcp-servers', {method: 'POST', body}),

  probeMcpServer: (id: string) =>
    apiFetch<{
      readonly mcpServer: McpServerEntry;
      readonly mcpServers: readonly McpServerEntry[];
    }>(`/api/mcp-servers/${id}/probe`, {method: 'POST', body: {}}),

  saveConstitution: (body: {
    readonly markdown: string;
    readonly blockedCommands: readonly string[];
  }) =>
    apiFetch<{readonly constitution: ConstitutionRule}>('/api/constitution', {
      method: 'POST',
      body,
    }),

  subscribeSse: (
    onEvent: (evt: OrchestratorSseEvent) => void,
    onStatusChange?: (connected: boolean) => void,
  ): (() => void) => {
    const cfg = getBridgeConfig();
    const url = `${cfg.apiBaseUrl}/api/events?token=${encodeURIComponent(cfg.sessionToken)}`;
    const source = new EventSource(url);
    const eventTypes: OrchestratorSseEvent['type'][] = [
      'snapshot.invalidated',
      'workflow.updated',
      'run.status',
      'node.status',
      'attempt.updated',
      'checkpoint.created',
      'intervention.created',
      'intervention.resolved',
      'session.chunk',
      'audit.appended',
      'heartbeat',
    ];
    source.onopen = () => onStatusChange?.(true);
    source.onerror = () => onStatusChange?.(false);
    for (const evtType of eventTypes) {
      source.addEventListener(evtType, msg => {
        try {
          onEvent(
            JSON.parse(
              (msg as MessageEvent<string>).data,
            ) as OrchestratorSseEvent,
          );
        } catch {
          // ignore malformed chunks
        }
      });
    }
    return () => source.close();
  },
};
