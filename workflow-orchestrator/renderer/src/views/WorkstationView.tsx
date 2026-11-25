import {
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type {
  BootstrapSnapshot,
  RunDetailSnapshot,
  RunLiveLogEntry,
  SessionTranscriptView,
} from '../../../src/shared/api';
import type {
  CheckpointRecord,
  GraphEdge,
  GraphNode,
  WorkflowRunRecord,
} from '../../../src/shared/types';
import {orchApi} from '../api/client';
import {
  CpuIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
} from '../components/Icons';
import {TwinGraphCanvas} from '../components/TwinGraphCanvas';
import {
  formatExecutorKind,
  formatNodeStatus,
  formatRunStatus,
  tr,
  type UiLang,
} from '../i18n';

interface WorkstationViewProps {
  readonly lang: UiLang;
  readonly runs: readonly WorkflowRunRecord[];
  readonly selectedRunId: string | null;
  readonly onSelectRun: (runId: string) => void;
  readonly onRefreshBootstrap: () => Promise<void>;
  readonly refreshTick: number;
  readonly infraStatus?: BootstrapSnapshot['infraStatus'];
}

interface PhaseTaskGroup {
  readonly id: string;
  readonly title: string;
  readonly nodes: readonly GraphNode[];
  readonly doneCount: number;
  readonly effectiveTotal: number;
  readonly pct: number;
}

type CenterViewMode = 'graph' | 'wbs' | 'logs';
type InspectorTab = 'detail' | 'logs';
type LogRoleFilter = 'all' | 'assistant' | 'tool' | 'system' | 'user' | 'audit';

function formatTimestamp(iso: string): string {
  return iso.length >= 19 ? iso.slice(11, 19) : iso;
}

function formatShortModelTag(model: string | undefined): string {
  if (!model) {
    return 'dsv4.1f';
  }
  const lower = model.toLowerCase();
  if (lower.includes('deepseek-v4.1-flash')) {
    return 'dsv4.1f';
  }
  if (lower.includes('deepseek-v4-pro')) {
    return 'dsv4-pro';
  }
  return model.length > 16 ? `${model.slice(0, 14)}..` : model;
}

function formatExecutorClean(
  lang: UiLang,
  kind: GraphNode['executorKind'],
): string {
  const raw = formatExecutorKind(lang, kind);
  return lang === 'ZH' ? raw.replace(/\s*\([^)]*\)\s*$/, '') : raw;
}

function formatNodeKindLabel(lang: UiLang, kind: GraphNode['kind']): string {
  switch (kind) {
    case 'phase_container':
      return tr(lang, '阶段容器', 'Phase');
    case 'start':
      return tr(lang, '流程起点', 'Start');
    case 'task':
      return tr(lang, '执行任务', 'Task');
    case 'decision':
      return tr(lang, '路由裁决', 'Decision');
    case 'join':
      return tr(lang, '汇聚屏障', 'Join');
    case 'gate_shell':
      return tr(lang, '命令门禁', 'Shell Gate');
    case 'selfcheck':
      return tr(lang, '自检核验', 'Self-Check');
    case 'qa_audit':
      return tr(lang, '独立审校', 'QA Audit');
    case 'human_gate':
      return tr(lang, '人工审批', 'Human Gate');
    case 'checkpoint':
      return tr(lang, '物理检查点', 'Checkpoint');
    case 'restore':
      return tr(lang, '回退恢复', 'Restore');
    case 'ghost':
      return tr(lang, '修正节点', 'Amendment');
    case 'done':
      return tr(lang, '交付终态', 'Done');
    default:
      return kind;
  }
}

function formatSidebarNodeStatus(
  lang: UiLang,
  status: GraphNode['status'],
): string {
  if (lang === 'ZH' && status === 'skipped') {
    return '已跳过';
  }
  return formatNodeStatus(lang, status);
}

function statusDotColor(status: GraphNode['status']): string {
  switch (status) {
    case 'succeeded':
    case 'waived':
      return '#16a34a';
    case 'running':
      return '#4f46e5';
    case 'failed':
      return '#dc2626';
    case 'waiting_human':
      return '#d97706';
    case 'skipped':
      return '#94a3b8';
    case 'ready':
      return '#0ea5e9';
    case 'rewound':
      return '#f97316';
    default:
      return '#cbd5e1';
  }
}

function statusTagClass(status: string): string {
  switch (status) {
    case 'succeeded':
    case 'waived':
      return 'tag-green';
    case 'failed':
      return 'tag-red';
    case 'waiting_human':
    case 'rewound':
      return 'tag-amber';
    case 'running':
    case 'ready':
      return 'tag-indigo';
    default:
      return '';
  }
}

function formatRetentionTier(lang: UiLang, tier: string): string {
  switch (tier) {
    case 'warm':
      return tr(lang, '热记忆', 'Warm');
    case 'delta_30s':
      return tr(lang, '30秒增量恢复', 'Delta 30s');
    case 'deep_reanchor':
      return tr(lang, '深度重锚', 'Deep Re-anchor');
    default:
      return tier;
  }
}

function formatPhaseHeading(lang: UiLang, container: GraphNode): string {
  if (lang !== 'ZH') {
    return container.title;
  }
  if (/^Phase\s*1\b/i.test(container.title) || container.code === 'P1') {
    return '阶段 1 · 规格与契约基线';
  }
  if (/^Phase\s*2\b/i.test(container.title) || container.code === 'P2') {
    return '阶段 2 · 并行切片执行';
  }
  if (/^Phase\s*3\b/i.test(container.title) || container.code === 'P3') {
    return '阶段 3 · 验证、审计与交付';
  }
  return container.title;
}

function logRoleBadge(
  lang: UiLang,
  role: RunLiveLogEntry['role'],
): {readonly tagClass: string; readonly label: string} {
  switch (role) {
    case 'assistant':
      return {tagClass: 'tag-indigo', label: 'assistant'};
    case 'tool':
      return {tagClass: 'tag-amber', label: 'tool'};
    case 'audit':
      return {tagClass: 'tag-green', label: 'audit'};
    case 'user':
      return {tagClass: 'tag-indigo', label: 'user'};
    default:
      return {tagClass: '', label: lang === 'ZH' ? 'system' : 'system'};
  }
}

function sortNodesInPhase(
  groupNodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): GraphNode[] {
  const ids = new Set(groupNodes.map(n => n.id));
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of groupNodes) {
    inDegree.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of edges) {
    if (
      e.kind === 'loop' ||
      !ids.has(e.sourceNodeId) ||
      !ids.has(e.targetNodeId)
    ) {
      continue;
    }
    adj.get(e.sourceNodeId)?.push(e.targetNodeId);
    inDegree.set(e.targetNodeId, (inDegree.get(e.targetNodeId) ?? 0) + 1);
  }

  const compareTie = (a: GraphNode, b: GraphNode): number => {
    const aCkpt = a.kind === 'checkpoint' && !a.containerNodeId ? 1 : 0;
    const bCkpt = b.kind === 'checkpoint' && !b.containerNodeId ? 1 : 0;
    if (aCkpt !== bCkpt) {
      return aCkpt - bCkpt;
    }
    if (Math.abs(a.positionY - b.positionY) > 12) {
      return a.positionY - b.positionY;
    }
    if (Math.abs(a.positionX - b.positionX) > 12) {
      return a.positionX - b.positionX;
    }
    return a.code.localeCompare(b.code);
  };

  const nodeMap = new Map(groupNodes.map(n => [n.id, n]));
  const queue = groupNodes
    .filter(n => (inDegree.get(n.id) ?? 0) === 0)
    .sort(compareTie);
  const ordered: GraphNode[] = [];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (seen.has(cur.id)) {
      continue;
    }
    seen.add(cur.id);
    ordered.push(cur);
    for (const nextId of adj.get(cur.id) ?? []) {
      const nextDeg = (inDegree.get(nextId) ?? 1) - 1;
      inDegree.set(nextId, nextDeg);
      if (nextDeg <= 0) {
        const nextNode = nodeMap.get(nextId);
        if (nextNode && !seen.has(nextId)) {
          queue.push(nextNode);
          queue.sort(compareTie);
        }
      }
    }
  }

  if (ordered.length < groupNodes.length) {
    const rest = groupNodes.filter(n => !seen.has(n.id)).sort(compareTie);
    ordered.push(...rest);
  }
  return ordered;
}

function computePhaseStats(items: readonly GraphNode[]): {
  readonly doneCount: number;
  readonly effectiveTotal: number;
  readonly pct: number;
} {
  const doneCount = items.filter(
    n => n.status === 'succeeded' || n.status === 'waived',
  ).length;
  const skippedCount = items.filter(n => n.status === 'skipped').length;
  const effectiveTotal = Math.max(0, items.length - skippedCount);
  const pct =
    effectiveTotal === 0
      ? skippedCount > 0
        ? 100
        : 0
      : Math.min(100, Math.round((doneCount / effectiveTotal) * 100));
  return {doneCount, effectiveTotal, pct};
}

function buildPhaseGroups(
  lang: UiLang,
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): PhaseTaskGroup[] {
  const containers = nodes
    .filter(n => n.kind === 'phase_container')
    .sort((a, b) => a.code.localeCompare(b.code));
  const execNodes = nodes.filter(n => n.kind !== 'phase_container');
  const assigned = new Set<string>();
  const groups: PhaseTaskGroup[] = [];

  for (const c of containers) {
    const prefix = `${c.code}.`;
    const children = execNodes.filter(n => {
      if (assigned.has(n.id)) {
        return false;
      }
      return (
        n.containerNodeId === c.id ||
        n.phaseId === c.id ||
        (!n.containerNodeId && n.code.startsWith(prefix))
      );
    });
    for (const child of children) {
      assigned.add(child.id);
    }
    const ordered = sortNodesInPhase(children, edges);
    const stats = computePhaseStats(ordered);
    groups.push({
      id: c.id,
      title: formatPhaseHeading(lang, c),
      nodes: ordered,
      ...stats,
    });
  }

  const unattached = execNodes.filter(n => !assigned.has(n.id));
  if (unattached.length > 0) {
    const ordered = sortNodesInPhase(unattached, edges);
    const stats = computePhaseStats(ordered);
    groups.push({
      id: 'unattached-amendments',
      title: tr(lang, '动态修正与附加节点', 'Runtime Amendments'),
      nodes: ordered,
      ...stats,
    });
  }
  return groups;
}

function extractLiveLogs(
  detail: RunDetailSnapshot | null,
): readonly RunLiveLogEntry[] {
  if (!detail) {
    return [];
  }
  if (detail.liveLogs && detail.liveLogs.length > 0) {
    return [...detail.liveLogs].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
  }
  return [...detail.recentAudit]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(a => ({
      id: a.id,
      nodeCode: a.category.toUpperCase(),
      capabilityId: a.author,
      role: 'audit' as const,
      toolName: null,
      content: `${a.title}${a.detail ? ` — ${a.detail}` : ''}`,
      createdAt: a.createdAt,
    }));
}

export function WorkstationView(props: WorkstationViewProps): ReactElement {
  const {
    lang,
    runs,
    selectedRunId,
    onSelectRun,
    onRefreshBootstrap,
    refreshTick,
    infraStatus,
  } = props;

  const activeRunId = selectedRunId ?? runs[0]?.id ?? null;
  const [detail, setDetail] = useState<RunDetailSnapshot | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<CenterViewMode>('graph');
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('detail');
  const [logScope, setLogScope] = useState<'node' | 'all'>('node');
  const [logRoleFilter, setLogRoleFilter] = useState<LogRoleFilter>('all');
  const [transcript, setTranscript] = useState<SessionTranscriptView | null>(
    null,
  );
  const [showGhostModal, setShowGhostModal] = useState(false);
  const [ghostTitle, setGhostTitle] = useState('');
  const [ghostDesc, setGhostDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadRun = useCallback(async (id: string): Promise<void> => {
    try {
      const snap = await orchApi.getRunDetail(id);
      setDetail(snap);
      setSelectedNodeId(prev => {
        if (prev && snap.nodes.some(n => n.id === prev)) {
          return prev;
        }
        const firstTask =
          snap.nodes.find(n => n.kind === 'task') ??
          snap.nodes.find(n => n.kind !== 'phase_container') ??
          snap.nodes[0];
        return firstTask?.id ?? null;
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    if (activeRunId) {
      void loadRun(activeRunId);
    } else {
      setDetail(null);
    }
  }, [activeRunId, refreshTick, loadRun]);

  const selectedNode = useMemo(
    () => detail?.nodes.find(n => n.id === selectedNodeId) ?? null,
    [detail?.nodes, selectedNodeId],
  );

  const nodeAttempts = useMemo(
    () => detail?.attempts.filter(a => a.nodeId === selectedNode?.id) ?? [],
    [detail?.attempts, selectedNode?.id],
  );

  const latestSessionId = useMemo(() => {
    if (!selectedNode) {
      return null;
    }
    const fromAttempt = nodeAttempts.find(a => a.sessionId)?.sessionId;
    if (fromAttempt) {
      return fromAttempt;
    }
    return detail?.sessions.find(s => s.nodeId === selectedNode.id)?.id ?? null;
  }, [detail?.sessions, nodeAttempts, selectedNode]);

  useEffect(() => {
    if (!latestSessionId) {
      setTranscript(null);
      return;
    }
    let active = true;
    void orchApi
      .getSessionTranscript(latestSessionId)
      .then(res => {
        if (active) {
          setTranscript(res);
        }
      })
      .catch(() => {
        if (active) {
          setTranscript(null);
        }
      });
    return () => {
      active = false;
    };
  }, [latestSessionId, refreshTick]);

  const openInterventions = useMemo(
    () => detail?.interventions.filter(i => i.status === 'open') ?? [],
    [detail?.interventions],
  );

  const phaseGroups = useMemo(() => {
    if (!detail) {
      return [];
    }
    return buildPhaseGroups(lang, detail.nodes, detail.edges);
  }, [detail, lang]);

  const allLiveLogs = useMemo(() => extractLiveLogs(detail), [detail]);

  const centerLogs = useMemo(() => {
    return allLiveLogs.filter(entry => {
      if (logRoleFilter !== 'all' && entry.role !== logRoleFilter) {
        return false;
      }
      if (logScope === 'node' && selectedNode) {
        return entry.nodeCode === selectedNode.code;
      }
      return true;
    });
  }, [allLiveLogs, logRoleFilter, logScope, selectedNode]);

  const inspectorLogs = useMemo(() => {
    if (logScope === 'node' && selectedNode) {
      return allLiveLogs.filter(entry => entry.nodeCode === selectedNode.code);
    }
    return allLiveLogs;
  }, [allLiveLogs, logScope, selectedNode]);

  const orderedCheckpoints = useMemo<readonly CheckpointRecord[]>(() => {
    if (!detail) {
      return [];
    }
    return [...detail.checkpoints].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
  }, [detail]);

  const nodeTotals = useMemo(() => {
    let tokens = 0;
    let cost = 0;
    for (const a of nodeAttempts) {
      tokens += (a.inputTokens ?? 0) + (a.outputTokens ?? 0);
      cost += a.costUsd ?? 0;
    }
    return {tokens, cost};
  }, [nodeAttempts]);

  const execAction = async (
    fn: () => Promise<RunDetailSnapshot>,
  ): Promise<void> => {
    setBusy(true);
    setErrorMsg(null);
    try {
      const updated = await fn();
      setDetail(updated);
      await onRefreshBootstrap();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleToggleCollapse = async (
    nodeId: string,
    collapsed: boolean,
  ): Promise<void> => {
    await orchApi.setNodeCollapsed(nodeId, collapsed);
    if (activeRunId) {
      await loadRun(activeRunId);
    }
  };

  const handleGhostSubmit = async (): Promise<void> => {
    if (!detail || !ghostTitle.trim()) {
      return;
    }
    await execAction(() =>
      orchApi.proposeGhostNode(detail.run.id, {
        title: ghostTitle.trim(),
        description:
          ghostDesc.trim() ||
          tr(lang, '运行时动态补充修正任务。', 'Runtime amendment task.'),
        insertBeforeNodeId:
          selectedNode?.kind === 'phase_container' ? null : selectedNode?.id,
      }),
    );
    setGhostTitle('');
    setGhostDesc('');
    setShowGhostModal(false);
  };

  if (!detail) {
    return (
      <div className="page-scroll">
        <div className="card">
          {runs.length === 0
            ? tr(
                lang,
                '暂无运行实例。请先在“编排设计台”校验、锁定版本并点击“发布并实时执行”。',
                'No runs yet. Validate & lock a workflow version in Design Studio first.',
              )
            : tr(
                lang,
                '正在加载实时运行详情...',
                'Loading live run details...',
              )}
        </div>
      </div>
    );
  }

  const run = detail.run;
  const activeTotalNodes = Math.max(1, run.totalNodes - run.skippedNodes);
  const overallPct =
    run.totalNodes === 0
      ? 0
      : run.status === 'succeeded'
        ? 100
        : Math.min(
            100,
            Math.round((run.completedNodes / activeTotalNodes) * 100),
          );

  const guardianOpenCodeOk = infraStatus?.opencodeGoConfigured ?? false;
  const guardianGitOk = infraStatus?.gitReady ?? true;

  return (
    <div
      style={{flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column'}}
    >
      {/* Top Run Control Bar */}
      <div
        style={{
          padding: '8px 16px',
          background: '#ffffff',
          borderBottom: '1px solid var(--border-hairline)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          flexWrap: 'wrap',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <select
            style={{width: 240}}
            value={run.id}
            onChange={e => onSelectRun(e.target.value)}
          >
            {runs.map(r => (
              <option key={r.id} value={r.id}>
                {r.title} · {formatRunStatus(lang, r.status)}
              </option>
            ))}
          </select>
          <span className={`tag ${statusTagClass(run.status)}`}>
            {formatRunStatus(lang, run.status)}
          </span>
          <span className="mono tag">
            {run.versionTag} · {run.completedNodes}/{run.totalNodes}
            {run.skippedNodes > 0
              ? tr(
                  lang,
                  ` · 已跳过 ${run.skippedNodes}`,
                  ` · skipped ${run.skippedNodes}`,
                )
              : ''}
          </span>
          <span className="mono tag" title={run.worktreePath}>
            {run.gitBranch}
          </span>
          <span
            className="mono tag"
            title={tr(
              lang,
              'Token 与成本预算遥测',
              'Token & Cost Budget Telemetry',
            )}
          >
            ${(run.spentUsd ?? 0).toFixed(4)} / $
            {(run.budgetUsdLimit ?? 2.5).toFixed(2)} ·{' '}
            {(
              (run.inputTokens ?? 0) + (run.outputTokens ?? 0)
            ).toLocaleString()}{' '}
            tok
          </span>
        </div>

        <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
          {run.status === 'running' ? (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void execAction(() => orchApi.pauseRun(run.id))}
            >
              <PauseIcon size={13} /> {tr(lang, '暂停', 'Pause')}
            </button>
          ) : run.status === 'paused' ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void execAction(() => orchApi.resumeRun(run.id))}
            >
              <PlayIcon size={13} /> {tr(lang, '继续', 'Resume')}
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-soft"
            disabled={busy}
            onClick={() => setShowGhostModal(true)}
          >
            <PlusIcon size={13} />{' '}
            {tr(lang, '插入修正节点', 'Insert Amendment')}
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="error-banner">
          <span>{errorMsg}</span>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setErrorMsg(null)}
          >
            ×
          </button>
        </div>
      )}

      {/* Ebbinghaus Cognitive Re-hydration Capsule Strip */}
      {detail.rehydrationCapsule && (
        <div
          style={{
            padding: '6px 16px',
            background: '#f8fafc',
            borderBottom: '1px solid var(--border-hairline)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            flexWrap: 'wrap',
            fontSize: 12,
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            <span
              className={`tag ${
                detail.rehydrationCapsule.tier === 'warm'
                  ? 'tag-green'
                  : detail.rehydrationCapsule.tier === 'delta_30s'
                    ? 'tag-indigo'
                    : 'tag-amber'
              }`}
            >
              {formatRetentionTier(lang, detail.rehydrationCapsule.tier)} ·{' '}
              {Math.round(detail.rehydrationCapsule.retentionScore * 100)}%
            </span>
            <span className="mono" style={{color: 'var(--text-muted)'}}>
              {tr(
                lang,
                `已流逝 ${detail.rehydrationCapsule.elapsedHours.toFixed(1)}h · 变更熵 ${detail.rehydrationCapsule.mutationEntropy.toFixed(2)}`,
                `${detail.rehydrationCapsule.elapsedHours.toFixed(1)}h elapsed · entropy ${detail.rehydrationCapsule.mutationEntropy.toFixed(2)}`,
              )}
            </span>
            <span style={{color: 'var(--text-secondary)'}}>
              {detail.rehydrationCapsule.autonomousDeltaBullets[0] ??
                detail.rehydrationCapsule.northStarGoal}
            </span>
          </div>
          <button
            type="button"
            className="btn btn-sm btn-soft"
            disabled={busy}
            onClick={() =>
              void execAction(async () => {
                await orchApi.markWorkflowReviewed(detail.run.workflowId);
                return orchApi.getRunDetail(detail.run.id);
              })
            }
          >
            {tr(lang, '标记人工已复核', 'Mark Human Reviewed')}
          </button>
        </div>
      )}

      {/* Open Human Interventions Strip */}
      {openInterventions.length > 0 && (
        <div
          style={{
            padding: '9px 16px',
            background: '#fffbeb',
            borderBottom: '1px solid #fde68a',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            flexShrink: 0,
          }}
        >
          {openInterventions.map(item => (
            <div
              key={item.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
              }}
            >
              <div>
                <strong style={{color: '#92400e'}}>{item.question}</strong>
                <div style={{fontSize: 12, color: '#78350f'}}>
                  {item.contextSnippet}
                </div>
              </div>
              <div style={{display: 'flex', gap: 6, flexShrink: 0}}>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={busy}
                  onClick={() =>
                    void execAction(() =>
                      orchApi.resolveIntervention(item.id, {
                        action: 'approve',
                        resolution: 'Approved by operator.',
                      }),
                    )
                  }
                >
                  {tr(lang, '批准通过', 'Approve')}
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={busy}
                  onClick={() =>
                    void execAction(() =>
                      orchApi.resolveIntervention(item.id, {
                        action: 'override',
                        resolution: 'Waived by operator.',
                      }),
                    )
                  }
                >
                  {tr(lang, '豁免', 'Waive')}
                </button>
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  disabled={busy}
                  onClick={() =>
                    void execAction(() =>
                      orchApi.resolveIntervention(item.id, {
                        action: 'reject',
                        resolution: 'Rejected by operator.',
                      }),
                    )
                  }
                >
                  {tr(lang, '拒绝终止', 'Reject')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 3-Pane + Bottom Checkpoints Cockpit */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          overflow: 'hidden',
          background: '#f8fafc',
        }}
      >
        {/* LEFT SIDEBAR: Overall Plan & Progress + Phase Task Tree + Pinned Infra Guardians */}
        <aside
          style={{
            width: 276,
            flexShrink: 0,
            background: '#ffffff',
            borderRight: '1px solid var(--border-hairline)',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            overflow: 'hidden',
          }}
        >
          {/* Overall Plan & Progress Header */}
          <div
            style={{
              padding: '12px 14px 10px',
              borderBottom: '1px solid var(--border-hairline)',
              flexShrink: 0,
            }}
          >
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: 'var(--text-primary)',
                marginBottom: 8,
              }}
            >
              {tr(lang, '总体计划与进度', 'Plan & Overall Progress')}
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                marginBottom: 5,
              }}
            >
              <span style={{fontSize: 11.5, color: 'var(--text-muted)'}}>
                {tr(lang, '总体进度', 'Overall Progress')}
              </span>
              <span
                className="mono"
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color:
                    run.status === 'succeeded'
                      ? 'var(--green)'
                      : run.status === 'failed'
                        ? 'var(--red)'
                        : 'var(--accent)',
                }}
              >
                {overallPct}%
              </span>
            </div>
            <div
              style={{
                width: '100%',
                height: 6,
                borderRadius: 999,
                background: '#e2e8f0',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${overallPct}%`,
                  height: '100%',
                  borderRadius: 999,
                  background:
                    run.status === 'succeeded'
                      ? 'var(--green)'
                      : run.status === 'failed'
                        ? 'var(--red)'
                        : 'var(--accent)',
                  transition: 'width 240ms ease',
                }}
              />
            </div>
            <div
              style={{
                marginTop: 6,
                fontSize: 11,
                color: 'var(--text-muted)',
                display: 'flex',
                justifyContent: 'space-between',
              }}
            >
              <span>
                {tr(
                  lang,
                  `已完成 ${run.completedNodes} / ${run.totalNodes} 个任务`,
                  `${run.completedNodes} / ${run.totalNodes} tasks done`,
                )}
              </span>
              {run.failedNodes > 0 && (
                <span style={{color: 'var(--red)', fontWeight: 600}}>
                  {tr(
                    lang,
                    `${run.failedNodes} 失败`,
                    `${run.failedNodes} failed`,
                  )}
                </span>
              )}
            </div>
          </div>

          {/* Phase-grouped Task List */}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              padding: '10px 10px 12px',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            {phaseGroups.map(group => (
              <div key={group.id}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 6,
                    padding: '2px 4px 5px',
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: 'var(--text-secondary)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={group.title}
                  >
                    {group.title}
                  </span>
                  <span
                    className="mono"
                    style={{
                      fontSize: 10.5,
                      fontWeight: 600,
                      color:
                        group.pct === 100
                          ? 'var(--green)'
                          : 'var(--text-muted)',
                      flexShrink: 0,
                    }}
                  >
                    {group.doneCount}/{group.effectiveTotal} ({group.pct}%)
                  </span>
                </div>
                <div style={{display: 'flex', flexDirection: 'column', gap: 4}}>
                  {group.nodes.map(n => {
                    const isSelected = n.id === selectedNodeId;
                    const isCheckpoint = n.kind === 'checkpoint';
                    return (
                      <button
                        key={n.id}
                        type="button"
                        onClick={() => setSelectedNodeId(n.id)}
                        title={`${n.code} · ${n.title}`}
                        style={{
                          width: '100%',
                          textAlign: 'left',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 6,
                          padding: '6px 8px',
                          borderRadius: 7,
                          border: `1px solid ${
                            isSelected
                              ? '#818cf8'
                              : isCheckpoint
                                ? '#99f6e4'
                                : 'var(--border-hairline)'
                          }`,
                          background: isSelected
                            ? 'var(--accent-soft)'
                            : isCheckpoint
                              ? '#f0fdfa'
                              : '#ffffff',
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            minWidth: 0,
                            flex: 1,
                          }}
                        >
                          <span
                            style={{
                              width: 7,
                              height: 7,
                              borderRadius: 999,
                              flexShrink: 0,
                              background: statusDotColor(n.status),
                            }}
                          />
                          <span
                            className="mono"
                            style={{
                              fontSize: 10.5,
                              fontWeight: 700,
                              color: isCheckpoint
                                ? '#0f766e'
                                : 'var(--text-secondary)',
                              flexShrink: 0,
                            }}
                          >
                            {n.code}
                          </span>
                          <span
                            style={{
                              fontSize: 11.5,
                              fontWeight: isSelected ? 600 : 500,
                              color: 'var(--text-primary)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {n.title}
                          </span>
                        </div>
                        <span
                          className={`tag ${statusTagClass(n.status)}`}
                          style={{
                            fontSize: 10,
                            padding: '0 6px',
                            flexShrink: 0,
                          }}
                        >
                          {formatSidebarNodeStatus(lang, n.status)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Pinned Bottom Card: Infrastructure & Runtime Guardians */}
          <div
            style={{
              flexShrink: 0,
              padding: '10px 12px',
              borderTop: '1px solid var(--border-hairline)',
              background: '#f8fafc',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 11.5,
                fontWeight: 700,
                color: 'var(--text-primary)',
                marginBottom: 8,
              }}
            >
              <CpuIcon size={13} />
              <span>
                {tr(lang, '基础设施与运行守护', 'Infrastructure Guardians')}
              </span>
            </div>
            <div
              style={{
                background: '#ffffff',
                border: '1px solid var(--border-card)',
                borderRadius: 8,
                padding: '7px 9px',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                fontSize: 11.5,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 6,
                }}
              >
                <span style={{color: 'var(--text-secondary)', fontWeight: 500}}>
                  OpenCode · {formatShortModelTag(infraStatus?.defaultModel)}
                </span>
                <span
                  className={`tag ${guardianOpenCodeOk ? 'tag-green' : 'tag-amber'}`}
                  style={{fontSize: 10}}
                >
                  {guardianOpenCodeOk
                    ? tr(lang, '已连通', 'Connected')
                    : tr(lang, '离线合成', 'Offline Synth')}
                </span>
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 6,
                }}
                title={
                  detail.rehydrationCapsule
                    ? `${Math.round(detail.rehydrationCapsule.retentionScore * 100)}%`
                    : undefined
                }
              >
                <span style={{color: 'var(--text-secondary)', fontWeight: 500}}>
                  {tr(lang, 'Ebbinghaus 记忆守护', 'Ebbinghaus Memory Guard')}
                </span>
                <span className="tag tag-green" style={{fontSize: 10}}>
                  {tr(lang, '运行中', 'Active')}
                </span>
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 6,
                }}
              >
                <span style={{color: 'var(--text-secondary)', fontWeight: 500}}>
                  {tr(lang, '睡眠整合引擎', 'Dream Consolidation')}
                </span>
                <span className="tag tag-indigo" style={{fontSize: 10}}>
                  {tr(lang, '就绪', 'Ready')}
                </span>
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 6,
                }}
              >
                <span style={{color: 'var(--text-secondary)', fontWeight: 500}}>
                  {tr(lang, 'Git 隔离沙箱', 'Git Isolation Sandbox')}
                </span>
                <span
                  className={`tag ${guardianGitOk ? 'tag-green' : 'tag-amber'}`}
                  style={{fontSize: 10}}
                >
                  {guardianGitOk
                    ? tr(lang, '就绪', 'Ready')
                    : tr(lang, '受限', 'Degraded')}
                </span>
              </div>
            </div>
          </div>
        </aside>

        {/* CENTER AREA: View Switch + Canvas/Table/LiveLogs + Persistent Checkpoints Bar */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* Center Top View Switch Bar */}
          <div
            style={{
              padding: '8px 14px',
              background: '#ffffff',
              borderBottom: '1px solid var(--border-hairline)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              flexShrink: 0,
            }}
          >
            <div className="nav-pills" style={{marginLeft: 0}}>
              <button
                type="button"
                className={`nav-pill ${viewMode === 'graph' ? 'active' : ''}`}
                onClick={() => setViewMode('graph')}
              >
                {tr(lang, '双生执行图', 'Twin Graph')}
              </button>
              <button
                type="button"
                className={`nav-pill ${viewMode === 'wbs' ? 'active' : ''}`}
                onClick={() => setViewMode('wbs')}
              >
                {tr(lang, '计划进度表', 'Plan Schedule')}
              </button>
              <button
                type="button"
                className={`nav-pill ${viewMode === 'logs' ? 'active' : ''}`}
                onClick={() => setViewMode('logs')}
              >
                {tr(lang, '实时执行日志', 'Live Execution Logs')}
                {allLiveLogs.length > 0 && (
                  <span className="tag" style={{fontSize: 10}}>
                    {allLiveLogs.length}
                  </span>
                )}
              </button>
            </div>

            {selectedNode && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  minWidth: 0,
                }}
              >
                <span className="mono tag tag-indigo">{selectedNode.code}</span>
                <span
                  style={{
                    fontSize: 12,
                    color: 'var(--text-secondary)',
                    fontWeight: 500,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    maxWidth: 260,
                  }}
                >
                  {selectedNode.title}
                </span>
              </div>
            )}
          </div>

          {/* Center Viewport */}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              background: '#f8fafc',
            }}
          >
            {viewMode === 'graph' ? (
              <TwinGraphCanvas
                nodes={detail.nodes}
                edges={detail.edges}
                selectedNodeId={selectedNodeId}
                mode="run"
                lang={lang}
                onSelectNode={setSelectedNodeId}
                onToggleCollapse={(id, col) =>
                  void handleToggleCollapse(id, col)
                }
              />
            ) : viewMode === 'wbs' ? (
              <div className="page-scroll">
                <div className="card">
                  <table
                    style={{
                      width: '100%',
                      borderCollapse: 'collapse',
                      fontSize: 12.5,
                    }}
                  >
                    <thead>
                      <tr
                        style={{
                          textAlign: 'left',
                          borderBottom: '1px solid var(--border-hairline)',
                        }}
                      >
                        <th style={{padding: '7px 6px'}}>
                          {tr(lang, '节点编号', 'Code')}
                        </th>
                        <th style={{padding: '7px 6px'}}>
                          {tr(lang, '阶段与任务', 'Phase / Task')}
                        </th>
                        <th style={{padding: '7px 6px'}}>
                          {tr(lang, '执行方式与能力', 'Executor')}
                        </th>
                        <th style={{padding: '7px 6px'}}>
                          {tr(lang, '需求追溯', 'FR Refs')}
                        </th>
                        <th style={{padding: '7px 6px'}}>
                          {tr(lang, '状态', 'Status')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.nodes
                        .filter(n => n.kind !== 'phase_container')
                        .map(n => (
                          <tr
                            key={n.id}
                            onClick={() => setSelectedNodeId(n.id)}
                            style={{
                              cursor: 'pointer',
                              borderBottom: '1px solid var(--border-hairline)',
                              background:
                                n.id === selectedNodeId
                                  ? 'var(--accent-soft)'
                                  : 'transparent',
                            }}
                          >
                            <td
                              className="mono"
                              style={{padding: '7px 6px', fontWeight: 700}}
                            >
                              {n.code}
                            </td>
                            <td style={{padding: '7px 6px'}}>
                              <div style={{fontWeight: 600}}>{n.title}</div>
                              <div
                                style={{
                                  fontSize: 11,
                                  color: 'var(--text-muted)',
                                }}
                              >
                                {n.phaseTitle}
                              </div>
                            </td>
                            <td style={{padding: '7px 6px'}}>
                              {formatExecutorClean(lang, n.executorKind)} ·{' '}
                              <span className="mono">{n.capabilityId}</span>
                            </td>
                            <td className="mono" style={{padding: '7px 6px'}}>
                              {n.requirementRefs.join(', ') || '—'}
                            </td>
                            <td style={{padding: '7px 6px'}}>
                              <span
                                className={`tag ${statusTagClass(n.status)}`}
                              >
                                {formatSidebarNodeStatus(lang, n.status)}
                              </span>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div
                style={{
                  flex: 1,
                  minHeight: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                }}
              >
                {/* Live Logs Filter Toolbar */}
                <div
                  style={{
                    padding: '8px 16px',
                    background: '#f8fafc',
                    borderBottom: '1px solid var(--border-hairline)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 10,
                    flexWrap: 'wrap',
                    flexShrink: 0,
                  }}
                >
                  <div style={{display: 'flex', gap: 6, flexWrap: 'wrap'}}>
                    <button
                      type="button"
                      className={`btn btn-sm ${logScope === 'all' ? 'btn-primary' : ''}`}
                      onClick={() => setLogScope('all')}
                    >
                      {tr(
                        lang,
                        `全部节点 (${allLiveLogs.length})`,
                        `All Nodes (${allLiveLogs.length})`,
                      )}
                    </button>
                    {selectedNode && (
                      <button
                        type="button"
                        className={`btn btn-sm ${logScope === 'node' ? 'btn-primary' : ''}`}
                        onClick={() => setLogScope('node')}
                      >
                        {tr(
                          lang,
                          `仅看 ${selectedNode.code}`,
                          `Only ${selectedNode.code}`,
                        )}
                      </button>
                    )}
                  </div>

                  <div style={{display: 'flex', gap: 4, flexWrap: 'wrap'}}>
                    {(
                      [
                        ['all', tr(lang, '全部角色', 'All')],
                        ['assistant', 'assistant'],
                        ['tool', 'tool'],
                        ['system', 'system'],
                        ['user', 'user'],
                        ['audit', 'audit'],
                      ] as const
                    ).map(([roleKey, roleLabel]) => (
                      <button
                        key={roleKey}
                        type="button"
                        className={`btn btn-sm ${logRoleFilter === roleKey ? 'btn-soft' : ''}`}
                        onClick={() => setLogRoleFilter(roleKey)}
                      >
                        {roleLabel}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Chronological Log Stream */}
                <div
                  style={{
                    flex: 1,
                    minHeight: 0,
                    overflowY: 'auto',
                    padding: '12px 16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  {centerLogs.length === 0 ? (
                    <div className="card" style={{color: 'var(--text-muted)'}}>
                      {tr(
                        lang,
                        '当前筛选范围内暂无实时执行日志。',
                        'No live execution logs match the current filter.',
                      )}
                    </div>
                  ) : (
                    centerLogs.map(entry => {
                      const badge = logRoleBadge(lang, entry.role);
                      const matchingNode = detail.nodes.find(
                        n => n.code === entry.nodeCode,
                      );
                      return (
                        <div
                          key={entry.id}
                          style={{
                            background: '#ffffff',
                            border: '1px solid var(--border-card)',
                            borderRadius: 8,
                            padding: '8px 11px',
                            boxShadow: 'var(--shadow-xs)',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: 8,
                              marginBottom: 4,
                              flexWrap: 'wrap',
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                flexWrap: 'wrap',
                              }}
                            >
                              <button
                                type="button"
                                className="mono tag tag-indigo"
                                style={{
                                  cursor: matchingNode ? 'pointer' : 'default',
                                }}
                                onClick={() => {
                                  if (matchingNode) {
                                    setSelectedNodeId(matchingNode.id);
                                  }
                                }}
                              >
                                {entry.nodeCode}
                              </button>
                              <span className={`mono tag ${badge.tagClass}`}>
                                {badge.label}
                              </span>
                              {entry.toolName && (
                                <span className="mono tag">
                                  {entry.toolName}
                                </span>
                              )}
                              <span
                                className="mono"
                                style={{
                                  fontSize: 10.5,
                                  color: 'var(--text-muted)',
                                }}
                              >
                                {entry.capabilityId}
                              </span>
                            </div>
                            <span
                              className="mono"
                              style={{
                                fontSize: 10.5,
                                color: 'var(--text-muted)',
                              }}
                            >
                              {formatTimestamp(entry.createdAt)}
                            </span>
                          </div>
                          <div
                            className="mono"
                            style={{
                              fontSize: 11.5,
                              color: 'var(--text-primary)',
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                              lineHeight: 1.5,
                            }}
                          >
                            {entry.content}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Persistent Bottom Bar: Physical Checkpoints & Safe Restore */}
          <div
            style={{
              flexShrink: 0,
              background: '#ffffff',
              borderTop: '1px solid var(--border-hairline)',
              padding: '9px 14px',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                marginBottom: 7,
              }}
            >
              <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
                <ShieldCheckIcon size={14} />
                <strong style={{fontSize: 12}}>
                  {tr(
                    lang,
                    '物理检查点与安全回退',
                    'Physical Checkpoints & Safe Restore',
                  )}
                </strong>
                <span
                  className={`tag ${orderedCheckpoints.length > 0 ? 'tag-green' : ''}`}
                  style={{fontSize: 10.5}}
                >
                  {tr(
                    lang,
                    `已锚定 ${orderedCheckpoints.length} 个`,
                    `${orderedCheckpoints.length} anchored`,
                  )}
                </span>
              </div>
              <span style={{fontSize: 11, color: 'var(--text-muted)'}}>
                {tr(
                  lang,
                  '点击任意检查点可安全回退工作区并保留救援分支',
                  'Restore worktree safely while preserving rescue refs',
                )}
              </span>
            </div>

            {orderedCheckpoints.length === 0 ? (
              <div
                style={{
                  padding: '6px 10px',
                  borderRadius: 7,
                  background: '#f8fafc',
                  border: '1px dashed var(--border-strong)',
                  fontSize: 11.5,
                  color: 'var(--text-muted)',
                }}
              >
                {tr(
                  lang,
                  '执行到 P1.CKPT / P2.CKPT / P3.CKPT 节点时自动生成物理 Git 检查点',
                  'Physical Git checkpoints are generated automatically at P1.CKPT / P2.CKPT / P3.CKPT nodes.',
                )}
              </div>
            ) : (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  overflowX: 'auto',
                  paddingBottom: 2,
                }}
              >
                {orderedCheckpoints.map(cp => (
                  <div
                    key={cp.id}
                    style={{
                      flexShrink: 0,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '5px 9px',
                      borderRadius: 8,
                      border: '1px solid var(--border-card)',
                      background: '#f8fafc',
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontSize: 11.5,
                          fontWeight: 600,
                          color: 'var(--text-primary)',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {cp.label}
                      </div>
                      <div
                        className="mono"
                        style={{
                          fontSize: 10.5,
                          color: 'var(--text-muted)',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {cp.gitCommitSha.slice(0, 8)} ·{' '}
                        {formatTimestamp(cp.createdAt)}
                        {cp.rescueRef
                          ? tr(lang, ' · 已保留救援分支', ' · rescue saved')
                          : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-sm btn-soft"
                      disabled={busy}
                      onClick={() =>
                        void execAction(() =>
                          orchApi.manualRestore(run.id, cp.id),
                        )
                      }
                    >
                      <RotateCcwIcon size={11} /> {tr(lang, '回退', 'Restore')}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT INSPECTOR (~370px): 2 Tabs (Node Details & Output | Live Log Stream) */}
        <aside
          style={{
            width: 370,
            flexShrink: 0,
            background: '#ffffff',
            borderLeft: '1px solid var(--border-hairline)',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            overflow: 'hidden',
          }}
        >
          {/* Inspector Top Tabs */}
          <div
            style={{
              padding: '0 14px',
              borderBottom: '1px solid var(--border-hairline)',
              flexShrink: 0,
              background: '#ffffff',
            }}
          >
            <div className="underline-tabs" style={{borderBottom: 'none'}}>
              <button
                type="button"
                className={`underline-tab ${inspectorTab === 'detail' ? 'active' : ''}`}
                onClick={() => setInspectorTab('detail')}
              >
                {tr(lang, '节点详情与产出', 'Node Details & Output')}
              </button>
              <button
                type="button"
                className={`underline-tab ${inspectorTab === 'logs' ? 'active' : ''}`}
                onClick={() => setInspectorTab('logs')}
              >
                {tr(lang, '实时日志流', 'Live Log Stream')}
                {allLiveLogs.length > 0 && (
                  <span
                    className="tag"
                    style={{marginLeft: 6, fontSize: 10, padding: '0 5px'}}
                  >
                    {allLiveLogs.length}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* Inspector Scrollable Body */}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              padding: 14,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            {inspectorTab === 'detail' ? (
              selectedNode ? (
                <>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        flexWrap: 'wrap',
                      }}
                    >
                      <span className="mono tag tag-indigo">
                        {selectedNode.code}
                      </span>
                      <span className="tag">
                        {formatNodeKindLabel(lang, selectedNode.kind)}
                      </span>
                      <span
                        className={`tag ${statusTagClass(selectedNode.status)}`}
                      >
                        {formatSidebarNodeStatus(lang, selectedNode.status)}
                      </span>
                    </div>
                    {(selectedNode.status === 'failed' ||
                      selectedNode.status === 'waiting_human') && (
                      <button
                        type="button"
                        className="btn btn-sm btn-soft"
                        disabled={busy}
                        onClick={() =>
                          void execAction(() =>
                            orchApi.retryNode(run.id, selectedNode.id),
                          )
                        }
                      >
                        <RotateCcwIcon size={12} />{' '}
                        {tr(lang, '重试节点', 'Retry Node')}
                      </button>
                    )}
                  </div>

                  <div>
                    <h4 style={{margin: '0 0 4px', fontSize: 13.5}}>
                      {selectedNode.title}
                    </h4>
                    <div
                      style={{
                        fontSize: 12,
                        color: 'var(--text-secondary)',
                        lineHeight: 1.5,
                      }}
                    >
                      {selectedNode.description}
                    </div>
                  </div>

                  <div
                    className="card"
                    style={{padding: 10, background: 'var(--bg-page)'}}
                  >
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: 'var(--text-muted)',
                      }}
                    >
                      {tr(
                        lang,
                        '规划依据与接口契约',
                        'Planning Rationale & I/O Contracts',
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        marginTop: 4,
                        color: 'var(--text-primary)',
                        lineHeight: 1.45,
                      }}
                    >
                      {selectedNode.planningRationale}
                    </div>
                    <div
                      className="mono"
                      style={{
                        fontSize: 11,
                        marginTop: 6,
                        color: 'var(--text-muted)',
                        lineHeight: 1.55,
                      }}
                    >
                      <div>
                        {tr(lang, '输入契约', 'Input')}:{' '}
                        {selectedNode.inputContract || '—'}
                      </div>
                      <div>
                        {tr(lang, '输出契约', 'Output')}:{' '}
                        {selectedNode.outputContract || '—'}
                      </div>
                      {selectedNode.fileScope.length > 0 && (
                        <div>
                          {tr(lang, '文件作用域', 'Scope')}:{' '}
                          {selectedNode.fileScope.join(', ')}
                        </div>
                      )}
                      {selectedNode.gateCommand && (
                        <div>
                          {tr(lang, '门禁命令', 'Command')}:{' '}
                          {selectedNode.gateCommand}
                        </div>
                      )}
                      {selectedNode.requirementRefs.length > 0 && (
                        <div>
                          {tr(lang, '关联需求', 'Refs')}:{' '}
                          {selectedNode.requirementRefs.join(', ')}
                        </div>
                      )}
                    </div>
                  </div>

                  {selectedNode.outputSummary && (
                    <div>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 6,
                        }}
                      >
                        <strong style={{fontSize: 11.5}}>
                          {tr(lang, '最新执行产出', 'Latest Output')}
                        </strong>
                        {(nodeTotals.tokens > 0 || nodeTotals.cost > 0) && (
                          <span className="mono tag" style={{fontSize: 10}}>
                            {nodeTotals.tokens.toLocaleString()} tok · $
                            {nodeTotals.cost.toFixed(4)}
                          </span>
                        )}
                      </div>
                      <pre
                        className="mono"
                        style={{
                          margin: '5px 0 0',
                          fontSize: 11,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          background: 'var(--bg-page)',
                          border: '1px solid var(--border-card)',
                          padding: 8,
                          borderRadius: 6,
                          maxHeight: 160,
                          overflowY: 'auto',
                        }}
                      >
                        {selectedNode.outputSummary}
                      </pre>
                    </div>
                  )}

                  <div>
                    <strong style={{fontSize: 11.5}}>
                      {tr(lang, '尝试记录', 'Attempt History')}
                    </strong>
                    {nodeAttempts.length === 0 ? (
                      <div
                        style={{
                          fontSize: 12,
                          color: 'var(--text-muted)',
                          marginTop: 4,
                        }}
                      >
                        {tr(
                          lang,
                          '尚未产生执行尝试。',
                          'No attempts recorded yet.',
                        )}
                      </div>
                    ) : (
                      nodeAttempts.map(a => {
                        const tokSum =
                          (a.inputTokens ?? 0) + (a.outputTokens ?? 0);
                        return (
                          <div
                            key={a.id}
                            style={{
                              padding: '7px 9px',
                              border: '1px solid var(--border-card)',
                              borderRadius: 6,
                              marginTop: 5,
                              fontSize: 11.5,
                              background: '#ffffff',
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                gap: 6,
                              }}
                            >
                              <span style={{minWidth: 0}}>
                                #{a.attemptNumber} ·{' '}
                                <span className="mono">{a.capabilityId}</span>
                              </span>
                              <span
                                className={`tag ${statusTagClass(a.status)}`}
                                style={{fontSize: 10}}
                              >
                                {formatSidebarNodeStatus(lang, a.status)} ·{' '}
                                {a.durationSec}s
                              </span>
                            </div>
                            {(tokSum > 0 ||
                              (a.costUsd ?? 0) > 0 ||
                              a.model) && (
                              <div
                                className="mono"
                                style={{
                                  marginTop: 4,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  fontSize: 10.5,
                                  color: 'var(--text-muted)',
                                }}
                              >
                                <span>{a.model || '—'}</span>
                                {(tokSum > 0 || (a.costUsd ?? 0) > 0) && (
                                  <span className="tag" style={{fontSize: 10}}>
                                    {tokSum.toLocaleString()} tok · $
                                    {(a.costUsd ?? 0).toFixed(4)}
                                  </span>
                                )}
                              </div>
                            )}
                            {a.errorMessage && (
                              <div
                                style={{
                                  color: 'var(--red)',
                                  marginTop: 4,
                                  fontSize: 11,
                                  wordBreak: 'break-word',
                                }}
                              >
                                {a.errorMessage}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>

                  {transcript && (
                    <div>
                      <strong style={{fontSize: 11.5}}>
                        {tr(lang, '会话追踪', 'Session Transcript')}
                      </strong>
                      <div
                        style={{
                          marginTop: 5,
                          maxHeight: 180,
                          overflowY: 'auto',
                          border: '1px solid var(--border-card)',
                          borderRadius: 6,
                          padding: 8,
                          fontSize: 11.5,
                          background: '#f8fafc',
                        }}
                      >
                        {transcript.messages.map(m => (
                          <div key={m.id} style={{marginBottom: 6}}>
                            <span
                              className={`mono tag ${logRoleBadge(lang, m.role).tagClass}`}
                              style={{fontSize: 10}}
                            >
                              {m.role}
                            </span>{' '}
                            <span
                              style={{
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word',
                              }}
                            >
                              {m.content}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div style={{fontSize: 12, color: 'var(--text-muted)'}}>
                  {tr(
                    lang,
                    '请在左侧计划列表或画布中点击选择一个节点以查看详情。',
                    'Select a node from the left task tree or graph to inspect details.',
                  )}
                </div>
              )
            ) : (
              /* Inspector Tab 2: Live Log Stream */
              <>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 6,
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{display: 'flex', gap: 6}}>
                    {selectedNode && (
                      <button
                        type="button"
                        className={`btn btn-sm ${logScope === 'node' ? 'btn-primary' : ''}`}
                        onClick={() => setLogScope('node')}
                      >
                        {tr(
                          lang,
                          `当前 · ${selectedNode.code}`,
                          `Node · ${selectedNode.code}`,
                        )}
                      </button>
                    )}
                    <button
                      type="button"
                      className={`btn btn-sm ${logScope === 'all' ? 'btn-primary' : ''}`}
                      onClick={() => setLogScope('all')}
                    >
                      {tr(
                        lang,
                        `全局日志 (${allLiveLogs.length})`,
                        `All (${allLiveLogs.length})`,
                      )}
                    </button>
                  </div>
                </div>

                {inspectorLogs.length === 0 ? (
                  <div
                    style={{
                      padding: 10,
                      borderRadius: 8,
                      border: '1px dashed var(--border-strong)',
                      background: '#f8fafc',
                      fontSize: 12,
                      color: 'var(--text-muted)',
                    }}
                  >
                    {logScope === 'node' && selectedNode
                      ? tr(
                          lang,
                          `节点 ${selectedNode.code} 暂无日志，可切换“全局日志”查看其它节点输出。`,
                          `No logs for ${selectedNode.code} yet. Switch to All to view full run stream.`,
                        )
                      : tr(
                          lang,
                          '尚未产生运行日志流。',
                          'No live log events recorded yet.',
                        )}
                  </div>
                ) : (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 7,
                    }}
                  >
                    {inspectorLogs.map(entry => {
                      const badge = logRoleBadge(lang, entry.role);
                      return (
                        <div
                          key={entry.id}
                          style={{
                            padding: '7px 9px',
                            border: '1px solid var(--border-card)',
                            borderRadius: 7,
                            background: '#f8fafc',
                            fontSize: 11.5,
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: 6,
                              marginBottom: 4,
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 5,
                                flexWrap: 'wrap',
                              }}
                            >
                              <span
                                className="mono tag tag-indigo"
                                style={{fontSize: 10}}
                              >
                                {entry.nodeCode}
                              </span>
                              <span
                                className={`mono tag ${badge.tagClass}`}
                                style={{fontSize: 10}}
                              >
                                {badge.label}
                              </span>
                              {entry.toolName && (
                                <span
                                  className="mono tag"
                                  style={{fontSize: 10}}
                                >
                                  {entry.toolName}
                                </span>
                              )}
                            </div>
                            <span
                              className="mono"
                              style={{fontSize: 10, color: 'var(--text-muted)'}}
                            >
                              {formatTimestamp(entry.createdAt)}
                            </span>
                          </div>
                          <div
                            className="mono"
                            style={{
                              fontSize: 11,
                              color: 'var(--text-primary)',
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                              lineHeight: 1.45,
                            }}
                          >
                            {entry.content}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        </aside>
      </div>

      {showGhostModal && (
        <div
          className="modal-backdrop"
          onClick={() => setShowGhostModal(false)}
        >
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h3 style={{marginTop: 0}}>
              {tr(
                lang,
                '动态插入运行时修正节点',
                'Insert Runtime Amendment Node',
              )}
            </h3>
            <p style={{color: 'var(--text-muted)', fontSize: 12}}>
              {tr(
                lang,
                '仅修改当前运行实例的执行图，不会改动已锁定的不可变版本快照。',
                'Splices into active run graph only; frozen version snapshot remains immutable.',
              )}
            </p>
            <label style={{display: 'block', marginBottom: 8}}>
              <span style={{fontSize: 11.5, fontWeight: 600}}>
                {tr(lang, '任务标题', 'Title')}
              </span>
              <input
                value={ghostTitle}
                onChange={e => setGhostTitle(e.target.value)}
                placeholder={tr(
                  lang,
                  '补充回归校验或边界修复...',
                  'Extra verification or hotfix...',
                )}
              />
            </label>
            <label style={{display: 'block', marginBottom: 12}}>
              <span style={{fontSize: 11.5, fontWeight: 600}}>
                {tr(lang, '任务说明', 'Description')}
              </span>
              <textarea
                rows={3}
                value={ghostDesc}
                onChange={e => setGhostDesc(e.target.value)}
              />
            </label>
            <div style={{display: 'flex', justifyContent: 'flex-end', gap: 8}}>
              <button
                type="button"
                className="btn"
                onClick={() => setShowGhostModal(false)}
              >
                {tr(lang, '取消', 'Cancel')}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !ghostTitle.trim()}
                onClick={() => void handleGhostSubmit()}
              >
                {tr(lang, '插入运行图', 'Splice into Run')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
