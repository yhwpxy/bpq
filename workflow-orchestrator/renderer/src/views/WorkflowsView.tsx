import {type ReactElement, useEffect, useMemo, useState} from 'react';
import type {
  ExportWorkflowPlanResponse,
  WorkflowDetailSnapshot,
} from '../../../src/shared/api';
import type {
  BuiltinDesignSpecPreset,
  CapabilityAdapterManifest,
  DomainTermEntry,
  ExecutorKind,
  PermissionTier,
  WorkflowRecord,
  WorkflowTemplatePreset,
  WorkspaceEntry,
} from '../../../src/shared/types';
import {orchApi} from '../api/client';
import {
  formatExecutorKind,
  formatNodeKind,
  formatNodeStatus,
  formatTemplatePreset,
  formatWorkflowStatus,
  tr,
  type UiLang,
} from '../i18n';
import {
  AlertIcon,
  LockIcon,
  PlayIcon,
  PlusIcon,
  ShieldCheckIcon,
} from '../components/Icons';
import {TwinGraphCanvas} from '../components/TwinGraphCanvas';
import type {DesignHandoffReceipt} from '../../../../software-design/src/handoff.ts';

interface WorkflowsViewProps {
  readonly lang: UiLang;
  readonly workspaces: readonly WorkspaceEntry[];
  readonly workflows: readonly WorkflowRecord[];
  readonly capabilities: readonly CapabilityAdapterManifest[];
  readonly designSpecPresets: readonly BuiltinDesignSpecPreset[];
  readonly domainTerms: readonly DomainTermEntry[];
  readonly selectedWorkflowId: string | null;
  readonly onSelectWorkflow: (workflowId: string) => void;
  readonly onRefreshBootstrap: () => Promise<void>;
  readonly onStartedRun: (runId: string) => void;
}

const DEFAULT_IMPORT_MD = `# Payment Settlement Retry Engine

## Goal
Implement bounded exponential retry and dead-letter persistence for failed settlement webhooks.

## Inputs
- Confirmed Webhook Event Contract (JSON)
- PostgreSQL / SQLite storage adapter

## Outputs
- Idempotent retry scheduler (\`src/core/retry-scheduler.ts\`)
- Dead-letter inspection endpoints (\`src/api/dlq.ts\`)

## Constraints
- Never issue concurrent duplicate retries for the same transactionId.
- Maximum 5 retries before transitioning to dead-letter queue.

## Requirements
- FR-01: Bounded Backoff Calculator — Compute jittered exponential backoff intervals cleanly.
- FR-02: Dead-Letter State Machine — Persist exhausted settlements with diagnostic context.

## Acceptance Criteria
- AC-01: Repeated retry requests honor backoff deadline.
- AC-02: Exhausted events transition deterministically to \`dead_letter\`.
`;

export function WorkflowsView(props: WorkflowsViewProps): ReactElement {
  const {
    lang,
    workspaces,
    workflows,
    capabilities,
    designSpecPresets,
    domainTerms,
    selectedWorkflowId,
    onSelectWorkflow,
    onRefreshBootstrap,
    onStartedRun,
  } = props;

  const [detail, setDetail] = useState<WorkflowDetailSnapshot | null>(null);
  const [designOrigin, setDesignOrigin] = useState<DesignHandoffReceipt | null>(null);
  const [subTab, setSubTab] = useState<'spec' | 'graph' | 'validate'>('graph');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Import Design Spec Modal & SE Workflow Customization
  const [showImport, setShowImport] = useState(false);
  const [selectedPresetId, setSelectedPresetId] = useState(
    designSpecPresets[0]?.id ?? '',
  );
  const [importMd, setImportMd] = useState(
    designSpecPresets[0]?.markdown ?? DEFAULT_IMPORT_MD,
  );
  const [importTier, setImportTier] = useState<PermissionTier>('supervised');
  const [importVerifyCmd, setImportVerifyCmd] = useState(
    'echo Verification gate passed',
  );
  const [templatePreset, setTemplatePreset] =
    useState<WorkflowTemplatePreset>('fullstack_se');
  const [includeHumanGate, setIncludeHumanGate] = useState(true);
  const [includeSecurityPass, setIncludeSecurityPass] = useState(false);
  const [includeQaAudit, setIncludeQaAudit] = useState(true);
  const [dddStrictCheck, setDddStrictCheck] = useState(true);
  const [pmAgentMode, setPmAgentMode] = useState<'hybrid_llm' | 'structural'>(
    'hybrid_llm',
  );
  const [maxParallelWorkers, setMaxParallelWorkers] = useState(3);
  const [budgetUsdLimit, setBudgetUsdLimit] = useState(2.5);

  // Export Plan Modal
  const [exportPlan, setExportPlan] =
    useState<ExportWorkflowPlanResponse | null>(null);
  const [exportTab, setExportTab] = useState<'markdown' | 'mermaid' | 'json'>(
    'markdown',
  );
  const [copiedExport, setCopiedExport] = useState(false);

  // Draft Node Editor form
  const [editTitle, setEditTitle] = useState('');
  const [editCapId, setEditCapId] = useState('');
  const [editExecKind, setEditExecKind] = useState<ExecutorKind>('agent');
  const [editRationale, setEditRationale] = useState('');
  const [editInputContract, setEditInputContract] = useState('');
  const [editOutputContract, setEditOutputContract] = useState('');
  const [editReqRefs, setEditReqRefs] = useState('');
  const [editFileScope, setEditFileScope] = useState('');
  const [editGateCmd, setEditGateCmd] = useState('');

  // Quick add node
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskCode, setNewTaskCode] = useState('P2.CUSTOM');

  const activeId = selectedWorkflowId ?? workflows[0]?.id ?? null;

  const loadDetail = async (id: string): Promise<void> => {
    try {
      const snap = await orchApi.getWorkflowDetail(id);
      setDetail(snap);
      if (
        snap.nodes.length > 0 &&
        !snap.nodes.some(n => n.id === selectedNodeId)
      ) {
        const firstTask =
          snap.nodes.find(n => n.kind === 'task') ?? snap.nodes[0]!;
        setSelectedNodeId(firstTask.id);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    if (activeId) {
      void loadDetail(activeId);
    } else {
      setDetail(null);
    }
  }, [activeId]);
  useEffect(() => {
    let active = true; setDesignOrigin(null);
    if (activeId) void orchApi.workflowDesignHandoff(activeId).then(value => {if (active) setDesignOrigin(value);})
      .catch(e => {if (active && e.status !== 404) setErrorMsg(e.message);});
    return () => {active = false;};
  }, [activeId]);

  const selectedNode = useMemo(
    () => detail?.nodes.find(n => n.id === selectedNodeId) ?? null,
    [detail?.nodes, selectedNodeId],
  );

  useEffect(() => {
    if (!selectedNode) {
      return;
    }
    setEditTitle(selectedNode.title);
    setEditCapId(selectedNode.capabilityId);
    setEditExecKind(selectedNode.executorKind);
    setEditRationale(selectedNode.planningRationale);
    setEditInputContract(selectedNode.inputContract);
    setEditOutputContract(selectedNode.outputContract);
    setEditReqRefs(selectedNode.requirementRefs.join(', '));
    setEditFileScope(selectedNode.fileScope.join(', '));
    setEditGateCmd(selectedNode.gateCommand ?? '');
  }, [selectedNode]);

  const applyDesignPreset = (presetId: string): void => {
    const preset = designSpecPresets.find(p => p.id === presetId);
    if (!preset) {
      return;
    }
    setSelectedPresetId(preset.id);
    setImportMd(preset.markdown);
    setTemplatePreset(preset.recommendedTemplate);
    setIncludeSecurityPass(
      preset.recommendedTemplate === 'microservice_hardened',
    );
    setIncludeHumanGate(preset.recommendedTemplate !== 'rapid_ui_api');
    setIncludeQaAudit(true);
  };

  const handleUploadDesignSpecFile = (file: File | undefined): void => {
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string' && reader.result.trim()) {
        setSelectedPresetId('');
        setImportMd(reader.result);
      }
    };
    reader.readAsText(file);
  };

  const handleImportPrd = async (): Promise<void> => {
    const ws = workspaces[0];
    if (!ws || !importMd.trim()) {
      return;
    }
    setBusy(true);
    setErrorMsg(null);
    try {
      const created = await orchApi.importRequirements({
        workspaceId: ws.id,
        markdown: importMd,
        permissionTier: importTier,
        verifyCommand: importVerifyCmd.trim() || undefined,
        customization: {
          templatePreset,
          includeHumanGate,
          includeSecurityPass,
          includeQaAudit,
          dddStrictCheck,
          pmAgentMode,
          maxParallelWorkers,
          budgetUsdLimit,
        },
      });
      setShowImport(false);
      await onRefreshBootstrap();
      onSelectWorkflow(created.workflow.id);
      setDetail(created);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleExportPlan = async (): Promise<void> => {
    if (!detail) {
      return;
    }
    setBusy(true);
    setErrorMsg(null);
    try {
      const plan = await orchApi.exportWorkflowPlan(detail.workflow.id);
      setExportPlan(plan);
      setExportTab('markdown');
      setCopiedExport(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmAssumption = async (asmId: string): Promise<void> => {
    if (!detail) {
      return;
    }
    setBusy(true);
    try {
      const updated = await orchApi.updateGoalSpec(detail.workflow.id, {
        assumptions: detail.goalSpec.assumptions.map(a =>
          a.id === asmId ? {...a, source: 'user_confirmed'} : a,
        ),
      });
      setDetail(updated);
      await onRefreshBootstrap();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleSaveNodePatch = async (): Promise<void> => {
    if (!detail || !selectedNode) {
      return;
    }
    setBusy(true);
    setErrorMsg(null);
    try {
      const updated = await orchApi.updateDraftGraph(detail.workflow.id, {
        nodePatches: [
          {
            id: selectedNode.id,
            title: editTitle.trim() || selectedNode.title,
            capabilityId: editCapId,
            executorKind: editExecKind,
            planningRationale: editRationale.trim(),
            inputContract: editInputContract.trim(),
            outputContract: editOutputContract.trim(),
            requirementRefs: editReqRefs
              .split(',')
              .map(s => s.trim())
              .filter(Boolean),
            fileScope: editFileScope
              .split(',')
              .map(s => s.trim())
              .filter(Boolean),
            gateCommand: editGateCmd.trim() || null,
          },
        ],
      });
      setDetail(updated);
      await onRefreshBootstrap();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleAddDraftNode = async (): Promise<void> => {
    if (!detail || !newTaskTitle.trim()) {
      return;
    }
    setBusy(true);
    try {
      const updated = await orchApi.updateDraftGraph(detail.workflow.id, {
        addNodes: [
          {
            code: newTaskCode.trim() || 'P2.T_CUSTOM',
            title: newTaskTitle.trim(),
            description: 'Manually added draft node from Design Studio.',
            planningRationale: 'Operator manual addition for domain coverage.',
            kind: 'task',
            executorKind: 'agent',
            capabilityId: 'native-api',
            requirementRefs: detail.goalSpec.requirements
              .slice(0, 1)
              .map(r => r.code),
            afterNodeId: selectedNode?.id ?? null,
          },
        ],
      });
      setNewTaskTitle('');
      setDetail(updated);
      await onRefreshBootstrap();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleReplan = async (): Promise<void> => {
    if (!detail) {
      return;
    }
    setBusy(true);
    try {
      const updated = await orchApi.replanWorkflow(detail.workflow.id);
      setDetail(updated);
      await onRefreshBootstrap();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleTrial = async (): Promise<void> => {
    if (!detail) {
      return;
    }
    setBusy(true);
    try {
      const updated = await orchApi.runTrial(detail.workflow.id);
      setDetail(updated);
      setSubTab('validate');
      await onRefreshBootstrap();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleLockAndOrStart = async (andStart: boolean): Promise<void> => {
    if (!detail) {
      return;
    }
    setBusy(true);
    setErrorMsg(null);
    try {
      let versionId = detail.versions[0]?.id;
      if (detail.workflow.status !== 'locked' || !versionId) {
        const res = await orchApi.confirmVersion(detail.workflow.id, {});
        setDetail(res.workflow);
        versionId = res.version.id;
      }
      if (andStart) {
        const runSnap = await orchApi.startRun({
          workflowId: detail.workflow.id,
          versionId,
        });
        await onRefreshBootstrap();
        onStartedRun(runSnap.run.id);
      } else {
        await onRefreshBootstrap();
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column'}}
    >
      {/* Top Design Studio Bar */}
      <div
        style={{
          padding: '10px 18px',
          background: '#ffffff',
          borderBottom: '1px solid var(--border-hairline)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div style={{display: 'flex', alignItems: 'center', gap: 10}}>
          <select
            style={{width: 280}}
            value={activeId ?? ''}
            onChange={e => onSelectWorkflow(e.target.value)}
          >
            {workflows.map(wf => (
              <option key={wf.id} value={wf.id}>
                {wf.code} · {wf.title}
              </option>
            ))}
          </select>
          {detail && (
            <>
              <span
                className={`tag ${
                  detail.validation.valid ? 'tag-green' : 'tag-red'
                }`}
              >
                {formatWorkflowStatus(lang, detail.workflow.status)}
              </span>
              <span className="tag">
                {detail.goalSpec.requirements.length} {tr(lang, '需求', 'FR')} ·{' '}
                {detail.goalSpec.acceptanceCriteria.length}{' '}
                {tr(lang, '验收', 'AC')} · {domainTerms.length}{' '}
                {tr(lang, '术语', 'DDD')}
              </span>
              {detail.workflow.customization && (
                <span className="tag tag-indigo">
                  {formatTemplatePreset(
                    lang,
                    detail.workflow.customization.templatePreset,
                  )}
                </span>
              )}
              {detail.validation.errorCount > 0 && (
                <span className="tag tag-red">
                  <AlertIcon size={12} /> {detail.validation.errorCount}{' '}
                  {tr(lang, '阻断错误', 'Blocking Errors')}
                </span>
              )}
            </>
          )}
        </div>

        <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
          <button
            type="button"
            className="btn"
            onClick={() => setShowImport(true)}
          >
            <PlusIcon size={14} />{' '}
            {tr(lang, '导入设计规格', 'Import Design Spec')}
          </button>
          <button
            type="button"
            className="btn btn-soft"
            disabled={!detail || busy}
            onClick={() => void handleExportPlan()}
          >
            {tr(lang, '导出编排方案', 'Export Plan / Mermaid')}
          </button>
          <button
            type="button"
            className="btn btn-soft"
            disabled={!detail || busy}
            onClick={() => void handleTrial()}
          >
            {tr(lang, '隔离试运行', 'Trial Run')}
          </button>
          <button
            type="button"
            className="btn"
            disabled={!detail || busy || !detail.validation.valid}
            onClick={() => void handleLockAndOrStart(false)}
          >
            <LockIcon size={13} /> {tr(lang, '锁定不可变版本', 'Lock Version')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!detail || busy || !detail.validation.valid}
            onClick={() => void handleLockAndOrStart(true)}
          >
            <PlayIcon size={13} />{' '}
            {tr(lang, '发布并实时执行', 'Lock & Launch Run')}
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

      {/* Design Tabs */}
      {designOrigin && <div className="card" style={{margin: '12px 20px'}}>
        <strong>{tr(lang, '软件设计交接', 'Software design handoff')} · {designOrigin.status === 'received' ? tr(lang, 'PM 已签收', 'PM received') : tr(lang, '待核查', 'Needs review')}</strong>
        <p>{designOrigin.designRef.designId} / v{designOrigin.designRef.revision} · {designOrigin.designRef.contentSha256}</p>
        <p>{tr(lang, '原始 PM 报告', 'Original PM report')}：{designOrigin.pmReportId ?? '—'} · {tr(lang, '目标提交', 'Target commit')}：{designOrigin.designRef.sourceCommit}</p>
        <details><summary>{tr(lang, '查看交接报告与核对诊断', 'Handoff report and diagnostics')}</summary><pre>{JSON.stringify({diagnostics: designOrigin.diagnostics, pmReport: designOrigin.workflow?.pmReport}, null, 2)}</pre></details>
      </div>}
      <div
        className="underline-tabs"
        style={{padding: '0 20px', background: '#ffffff'}}
      >
        <button
          type="button"
          className={`underline-tab ${subTab === 'spec' ? 'active' : ''}`}
          onClick={() => setSubTab('spec')}
        >
          {tr(lang, '1. 规格目标与需求追踪', '1. GoalSpec & Traceability')}
        </button>
        <button
          type="button"
          className={`underline-tab ${subTab === 'graph' ? 'active' : ''}`}
          onClick={() => setSubTab('graph')}
        >
          {tr(lang, '2. 任务拆解与双态编排图', '2. WBS & Dual-Mode Twin-Graph')}
        </button>
        <button
          type="button"
          className={`underline-tab ${subTab === 'validate' ? 'active' : ''}`}
          onClick={() => setSubTab('validate')}
        >
          {tr(
            lang,
            `3. 三级校验与试运行报告 (${detail?.validation.issues.length ?? 0})`,
            `3. Validation & Trial Report (${detail?.validation.issues.length ?? 0})`,
          )}
        </button>
      </div>

      {!detail ? (
        <div className="page-scroll">
          <div className="card">
            {tr(
              lang,
              '请点击上方“导入设计规格”开始编排。',
              'Import a Requirements Markdown document to begin.',
            )}
          </div>
        </div>
      ) : subTab === 'spec' ? (
        <div className="page-scroll">
          {(detail.pmReport || (detail.goalSpec.modules?.length ?? 0) > 0) && (
            <div className="card" style={{marginBottom: 16}}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 8,
                }}
              >
                <div>
                  <strong style={{fontSize: 13.5}}>
                    {tr(
                      lang,
                      'PM 智能体规格分解与模块编排摘要',
                      'PM Agent Design Spec Decomposition & SE Modules',
                    )}
                  </strong>
                  {detail.pmReport && (
                    <div
                      style={{
                        color: 'var(--text-muted)',
                        fontSize: 12,
                        marginTop: 2,
                      }}
                    >
                      {detail.pmReport.pmNarrative}
                    </div>
                  )}
                </div>
                <div style={{display: 'flex', gap: 6, flexWrap: 'wrap'}}>
                  {detail.pmReport && (
                    <span className="tag tag-indigo">
                      {detail.pmReport.mode === 'llm_assisted'
                        ? tr(lang, '大模型协同分解', 'LLM Assisted')
                        : tr(lang, '结构化分解', 'Structural PM')}{' '}
                      ·{' '}
                      {formatTemplatePreset(
                        lang,
                        detail.pmReport.templatePreset,
                      )}
                    </span>
                  )}
                  {detail.pmReport?.skillsApplied.map(sk => (
                    <span key={sk} className="tag tag-green mono">
                      {tr(lang, '技能', 'skill')}:{sk}
                    </span>
                  ))}
                </div>
              </div>

              {(detail.goalSpec.modules?.length ?? 0) > 0 && (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                    gap: 8,
                    marginTop: 10,
                  }}
                >
                  {detail.goalSpec.modules!.map((mod, idx) => (
                    <div
                      key={`${mod.name}-${idx}`}
                      style={{
                        padding: '8px 10px',
                        border: '1px solid var(--border-card)',
                        borderRadius: 6,
                        background: 'var(--bg-page)',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          gap: 6,
                          alignItems: 'center',
                        }}
                      >
                        <strong style={{fontSize: 12.5}}>{mod.name}</strong>
                        <span className="tag tag-indigo mono">{mod.layer}</span>
                      </div>
                      <div
                        style={{
                          fontSize: 11.5,
                          color: 'var(--text-muted)',
                          marginTop: 3,
                        }}
                      >
                        {mod.summary}
                      </div>
                      {(mod.relatedFrCodes.length > 0 ||
                        mod.artifacts.length > 0) && (
                        <div
                          className="mono"
                          style={{
                            fontSize: 10.5,
                            color: 'var(--text-secondary)',
                            marginTop: 4,
                          }}
                        >
                          {[...mod.relatedFrCodes, ...mod.artifacts].join(
                            ' · ',
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {detail.pmReport && detail.pmReport.slices.length > 0 && (
                <div style={{marginTop: 10, overflowX: 'auto'}}>
                  <table
                    style={{
                      width: '100%',
                      borderCollapse: 'collapse',
                      fontSize: 11.5,
                    }}
                  >
                    <thead>
                      <tr
                        style={{
                          textAlign: 'left',
                          borderBottom: '1px solid var(--border-hairline)',
                          color: 'var(--text-muted)',
                        }}
                      >
                        <th style={{padding: '5px 6px'}}>
                          {tr(lang, '节点编号', 'WBS')}
                        </th>
                        <th style={{padding: '5px 6px'}}>
                          {tr(lang, '任务切片', 'Task Slice')}
                        </th>
                        <th style={{padding: '5px 6px'}}>
                          {tr(lang, '层级', 'Layer')}
                        </th>
                        <th style={{padding: '5px 6px'}}>
                          {tr(lang, '角色与执行', 'Role')}
                        </th>
                        <th style={{padding: '5px 6px'}}>
                          {tr(lang, '关联需求', 'FR')}
                        </th>
                        <th style={{padding: '5px 6px'}}>
                          {tr(lang, '前置依赖', 'Deps')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.pmReport.slices.map(s => (
                        <tr
                          key={s.code}
                          style={{
                            borderBottom: '1px solid var(--border-hairline)',
                          }}
                        >
                          <td className="mono" style={{padding: '5px 6px'}}>
                            {s.code}
                          </td>
                          <td style={{padding: '5px 6px', fontWeight: 600}}>
                            {s.title}
                          </td>
                          <td className="mono" style={{padding: '5px 6px'}}>
                            {s.layer}
                          </td>
                          <td className="mono" style={{padding: '5px 6px'}}>
                            {s.assignedRole}/{s.executorKind}
                          </td>
                          <td className="mono" style={{padding: '5px 6px'}}>
                            {s.requirementRefs.join(', ') || '-'}
                          </td>
                          <td className="mono" style={{padding: '5px 6px'}}>
                            {s.dependsOnCodes.join(', ') || 'start'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          <div
            style={{display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 16}}
          >
            <div className="card">
              <h3 style={{marginTop: 0}}>{detail.goalSpec.title}</h3>
              <p style={{color: 'var(--text-secondary)'}}>
                <strong>{tr(lang, '目标:', 'Goal:')}</strong>{' '}
                {detail.goalSpec.goal}
              </p>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 12,
                  marginTop: 12,
                }}
              >
                <div>
                  <div style={{fontWeight: 700, marginBottom: 4}}>
                    {tr(lang, '输入契约', 'Inputs')}
                  </div>
                  <ul style={{margin: 0, paddingLeft: 18}}>
                    {detail.goalSpec.inputs.map((inp, i) => (
                      <li key={i}>{inp}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div style={{fontWeight: 700, marginBottom: 4}}>
                    {tr(lang, '输出契约', 'Outputs')}
                  </div>
                  <ul style={{margin: 0, paddingLeft: 18}}>
                    {detail.goalSpec.outputs.map((out, i) => (
                      <li key={i}>{out}</li>
                    ))}
                  </ul>
                </div>
              </div>
              <div style={{marginTop: 14}}>
                <div style={{fontWeight: 700, marginBottom: 6}}>
                  {tr(
                    lang,
                    '功能需求条目与节点映射',
                    'Functional Requirements',
                  )}
                </div>
                {detail.goalSpec.requirements.map(r => {
                  const mapped = detail.nodes
                    .filter(
                      n =>
                        n.kind !== 'phase_container' &&
                        n.requirementRefs.includes(r.code),
                    )
                    .map(n => n.code);
                  return (
                    <div
                      key={r.id}
                      style={{
                        padding: '8px 10px',
                        border: '1px solid var(--border-card)',
                        borderRadius: 6,
                        marginBottom: 6,
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 8,
                      }}
                    >
                      <div>
                        <span className="mono tag tag-indigo">{r.code}</span>{' '}
                        <strong>{r.title}</strong>
                        <div
                          style={{
                            color: 'var(--text-muted)',
                            fontSize: 12,
                            marginTop: 2,
                          }}
                        >
                          {r.description}
                        </div>
                      </div>
                      <div style={{textAlign: 'right'}}>
                        <span
                          className={`tag ${
                            mapped.length > 0 ? 'tag-green' : 'tag-red'
                          }`}
                        >
                          {mapped.length > 0
                            ? `${tr(lang, '映射', 'Mapped')}: ${mapped.join(', ')}`
                            : tr(lang, '未覆盖!', 'Unmapped!')}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{display: 'flex', flexDirection: 'column', gap: 14}}>
              <div className="card">
                <div style={{fontWeight: 700, marginBottom: 8}}>
                  {tr(
                    lang,
                    '系统识别假设与人工确认',
                    'Assumptions & Confirmations',
                  )}
                </div>
                {detail.goalSpec.assumptions.map(a => (
                  <div
                    key={a.id}
                    style={{
                      padding: '8px 10px',
                      border: '1px solid var(--border-card)',
                      borderRadius: 6,
                      marginBottom: 6,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 6,
                      }}
                    >
                      <span
                        className={`tag ${
                          a.source === 'suggested'
                            ? 'tag-amber'
                            : a.source === 'user_confirmed'
                              ? 'tag-green'
                              : 'tag-indigo'
                        }`}
                      >
                        {a.source === 'suggested'
                          ? tr(lang, '智能推测', 'Suggested')
                          : a.source === 'user_confirmed'
                            ? tr(lang, '人工已确认', 'User Confirmed')
                            : tr(lang, '规格原文', 'Spec Document')}
                      </span>
                      {a.source === 'suggested' && (
                        <button
                          type="button"
                          className="btn btn-sm"
                          disabled={busy}
                          onClick={() => void handleConfirmAssumption(a.id)}
                        >
                          {tr(lang, '确认此假设', 'Confirm Assumption')}
                        </button>
                      )}
                    </div>
                    <div style={{marginTop: 4, fontWeight: 500}}>{a.text}</div>
                    <div style={{fontSize: 11.5, color: 'var(--text-muted)'}}>
                      {a.rationale}
                    </div>
                  </div>
                ))}
              </div>

              <div className="card">
                <div style={{fontWeight: 700, marginBottom: 8}}>
                  {tr(lang, '原始规格文档', 'Raw Requirements Markdown')}
                </div>
                <pre
                  className="mono"
                  style={{
                    margin: 0,
                    fontSize: 11.5,
                    whiteSpace: 'pre-wrap',
                    background: 'var(--bg-page)',
                    padding: 10,
                    borderRadius: 6,
                    maxHeight: 280,
                    overflowY: 'auto',
                  }}
                >
                  {detail.goalSpec.rawMarkdown}
                </pre>
              </div>
            </div>
          </div>
        </div>
      ) : subTab === 'graph' ? (
        <div className="split-workbench">
          <div className="canvas-pane">
            {detail.lastImpact && (
              <div
                style={{
                  padding: '6px 14px',
                  background: '#fffbeb',
                  borderBottom: '1px solid #fde68a',
                  fontSize: 12,
                  color: '#92400e',
                  display: 'flex',
                  justifyContent: 'space-between',
                }}
              >
                <span>
                  <strong>{tr(lang, '变更影响分析:', 'Change Impact:')}</strong>{' '}
                  {detail.lastImpact.summary}
                </span>
                {detail.lastImpact.affectedDownstreamCodes.length > 0 && (
                  <span className="mono">
                    {tr(lang, '受影响下游', 'Downstream')}:{' '}
                    {detail.lastImpact.affectedDownstreamCodes.join(', ')}
                  </span>
                )}
              </div>
            )}
            <TwinGraphCanvas
              nodes={detail.nodes}
              edges={detail.edges}
              selectedNodeId={selectedNodeId}
              impactedCodes={detail.lastImpact?.affectedDownstreamCodes}
              mode="design"
              lang={lang}
              onSelectNode={setSelectedNodeId}
            />
          </div>

          <div className="inspector-pane">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <strong style={{fontSize: 13.5}}>
                {tr(lang, '双态节点配置器', 'Draft Node Editor')}
              </strong>
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy}
                onClick={() => void handleReplan()}
              >
                {tr(lang, '由规格重生成', 'Recompile Graph')}
              </button>
            </div>

            {selectedNode && selectedNode.kind !== 'phase_container' ? (
              <div style={{display: 'flex', flexDirection: 'column', gap: 9}}>
                <div>
                  <span className="mono tag tag-indigo">
                    {selectedNode.code}
                  </span>{' '}
                  <span className="tag">
                    {formatNodeKind(lang, selectedNode.kind)}
                  </span>
                </div>
                <label>
                  <span style={{fontSize: 11, color: 'var(--text-muted)'}}>
                    {tr(lang, '节点名称', 'Title')}
                  </span>
                  <input
                    value={editTitle}
                    onChange={e => setEditTitle(e.target.value)}
                  />
                </label>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 8,
                  }}
                >
                  <label>
                    <span style={{fontSize: 11, color: 'var(--text-muted)'}}>
                      {tr(lang, '执行者类型', 'Executor Kind')}
                    </span>
                    <select
                      value={editExecKind}
                      onChange={e =>
                        setEditExecKind(e.target.value as ExecutorKind)
                      }
                    >
                      <option value="agent">
                        {formatExecutorKind(lang, 'agent')}
                      </option>
                      <option value="tool">
                        {formatExecutorKind(lang, 'tool')}
                      </option>
                      <option value="human">
                        {formatExecutorKind(lang, 'human')}
                      </option>
                      <option value="control">
                        {formatExecutorKind(lang, 'control')}
                      </option>
                    </select>
                  </label>
                  <label>
                    <span style={{fontSize: 11, color: 'var(--text-muted)'}}>
                      {tr(lang, '绑定能力', 'Capability')}
                    </span>
                    <select
                      value={editCapId}
                      onChange={e => setEditCapId(e.target.value)}
                    >
                      {capabilities.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.id}
                          {!c.enabled
                            ? ` · ${tr(lang, '已禁用', 'disabled')}`
                            : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label>
                  <span style={{fontSize: 11, color: 'var(--text-muted)'}}>
                    {tr(lang, '规划依据', 'Planning Rationale')}
                  </span>
                  <textarea
                    rows={2}
                    value={editRationale}
                    onChange={e => setEditRationale(e.target.value)}
                  />
                </label>
                <label>
                  <span style={{fontSize: 11, color: 'var(--text-muted)'}}>
                    {tr(lang, '映射需求', 'Requirement Refs')}
                  </span>
                  <input
                    value={editReqRefs}
                    onChange={e => setEditReqRefs(e.target.value)}
                    placeholder="FR-01, FR-02"
                  />
                </label>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 8,
                  }}
                >
                  <label>
                    <span style={{fontSize: 11, color: 'var(--text-muted)'}}>
                      {tr(lang, '输入契约', 'Input Contract')}
                    </span>
                    <input
                      value={editInputContract}
                      onChange={e => setEditInputContract(e.target.value)}
                    />
                  </label>
                  <label>
                    <span style={{fontSize: 11, color: 'var(--text-muted)'}}>
                      {tr(lang, '输出契约', 'Output Contract')}
                    </span>
                    <input
                      value={editOutputContract}
                      onChange={e => setEditOutputContract(e.target.value)}
                    />
                  </label>
                </div>
                <label>
                  <span style={{fontSize: 11, color: 'var(--text-muted)'}}>
                    {tr(lang, '影响范围', 'File Scope')}
                  </span>
                  <input
                    value={editFileScope}
                    onChange={e => setEditFileScope(e.target.value)}
                    placeholder={tr(
                      lang,
                      '用于并行写冲突检测，逗号分隔路径',
                      'Comma-separated paths for write-conflict guard',
                    )}
                  />
                </label>
                <label>
                  <span style={{fontSize: 11, color: 'var(--text-muted)'}}>
                    {tr(lang, '验证命令', 'Gate / Tool Command')}
                  </span>
                  <input
                    className="mono"
                    value={editGateCmd}
                    onChange={e => setEditGateCmd(e.target.value)}
                    placeholder={tr(
                      lang,
                      '可选门禁命令',
                      'Optional gate command',
                    )}
                  />
                </label>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => void handleSaveNodePatch()}
                >
                  {tr(
                    lang,
                    '保存节点修改并分析影响',
                    'Save & Run Impact Check',
                  )}
                </button>
              </div>
            ) : (
              <div style={{color: 'var(--text-muted)'}}>
                {tr(
                  lang,
                  '点击画布中任意任务或检查点节点以查看或修改属性。',
                  'Select a node on the canvas to inspect or edit.',
                )}
              </div>
            )}

            <hr
              style={{
                border: 'none',
                borderTop: '1px solid var(--border-hairline)',
                width: '100%',
              }}
            />
            <div>
              <strong style={{fontSize: 12.5}}>
                {tr(lang, '人工新增子任务节点', 'Add Draft Task Node')}
              </strong>
              <div style={{display: 'flex', gap: 6, marginTop: 6}}>
                <input
                  style={{width: 96}}
                  value={newTaskCode}
                  onChange={e => setNewTaskCode(e.target.value)}
                  placeholder="P2.T_ADD"
                />
                <input
                  value={newTaskTitle}
                  onChange={e => setNewTaskTitle(e.target.value)}
                  placeholder={tr(lang, '新任务名称...', 'New task title...')}
                />
                <button
                  type="button"
                  className="btn btn-soft"
                  disabled={busy || !newTaskTitle.trim()}
                  onClick={() => void handleAddDraftNode()}
                >
                  {tr(lang, '添加', 'Add')}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="page-scroll">
          <div
            style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16}}
          >
            <div className="card">
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 10,
                }}
              >
                <strong style={{fontSize: 14}}>
                  <ShieldCheckIcon size={15} />{' '}
                  {tr(
                    lang,
                    '三级一致性与结构校验诊断',
                    '3-Level Validation Diagnostics',
                  )}
                </strong>
                <span
                  className={`tag ${detail.validation.valid ? 'tag-green' : 'tag-red'}`}
                >
                  E:{detail.validation.errorCount} / W:
                  {detail.validation.warningCount} / I:
                  {detail.validation.infoCount}
                </span>
              </div>
              {detail.validation.issues.length === 0 ? (
                <div className="tag tag-green">
                  {tr(
                    lang,
                    '所有结构、需求映射与能力约束检查全部通过。',
                    'Zero validation issues found.',
                  )}
                </div>
              ) : (
                detail.validation.issues.map(iss => (
                  <div
                    key={iss.id}
                    style={{
                      padding: '8px 10px',
                      border: '1px solid var(--border-card)',
                      borderRadius: 6,
                      marginBottom: 8,
                    }}
                  >
                    <div
                      style={{display: 'flex', gap: 6, alignItems: 'center'}}
                    >
                      <span
                        className={`tag ${
                          iss.level === 'error'
                            ? 'tag-red'
                            : iss.level === 'warning'
                              ? 'tag-amber'
                              : 'tag-indigo'
                        }`}
                      >
                        {iss.level.toUpperCase()} · {iss.category}
                      </span>
                      {iss.nodeCode && (
                        <span className="mono tag">{iss.nodeCode}</span>
                      )}
                      {iss.requirementCode && (
                        <span className="mono tag">{iss.requirementCode}</span>
                      )}
                    </div>
                    <div style={{marginTop: 4, fontWeight: 500}}>
                      {iss.message}
                    </div>
                    <div style={{fontSize: 11.5, color: 'var(--text-muted)'}}>
                      {tr(lang, '修复建议:', 'Suggestion:')} {iss.suggestion}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="card">
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 10,
                }}
              >
                <strong style={{fontSize: 14}}>
                  {tr(
                    lang,
                    '隔离试运行仿真链路',
                    'Isolated Trial Simulation Report',
                  )}
                </strong>
                <button
                  type="button"
                  className="btn btn-sm btn-soft"
                  disabled={busy}
                  onClick={() => void handleTrial()}
                >
                  {tr(lang, '重新试运行', 'Re-Run Trial')}
                </button>
              </div>
              {!detail.latestTrial ? (
                <div style={{color: 'var(--text-muted)'}}>
                  {tr(
                    lang,
                    '尚未执行试运行；点击“隔离试运行”在不改动工作区的前提下检验条件分支与契约流转。',
                    'No trial run yet. Run isolated simulation before locking version.',
                  )}
                </div>
              ) : (
                <div>
                  <div style={{display: 'flex', gap: 8, marginBottom: 10}}>
                    <span
                      className={`tag ${
                        detail.latestTrial.passed ? 'tag-green' : 'tag-red'
                      }`}
                    >
                      {detail.latestTrial.passed
                        ? tr(lang, '试运行通过', 'TRIAL PASSED')
                        : tr(lang, '试运行阻断', 'TRIAL BLOCKED')}
                    </span>
                    <span className="tag">
                      {tr(lang, '激活', 'Active')}:{' '}
                      {detail.latestTrial.simulatedPath.length} ·{' '}
                      {tr(lang, '跳过', 'Skipped')}:{' '}
                      {detail.latestTrial.skippedNodes.length}
                    </span>
                  </div>
                  {detail.latestTrial.steps.map((s, idx) => (
                    <div
                      key={`${s.nodeCode}-${idx}`}
                      style={{
                        padding: '6px 9px',
                        borderBottom: '1px solid var(--border-hairline)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 8,
                        fontSize: 12,
                      }}
                    >
                      <div>
                        <span className="mono" style={{fontWeight: 700}}>
                          {s.nodeCode}
                        </span>{' '}
                        {s.title}
                        <div style={{color: 'var(--text-muted)', fontSize: 11}}>
                          {s.note}
                        </div>
                      </div>
                      <span
                        className={`tag ${
                          s.simulatedStatus === 'skipped'
                            ? ''
                            : s.simulatedStatus === 'waiting_human'
                              ? 'tag-amber'
                              : 'tag-green'
                        }`}
                      >
                        {formatNodeStatus(lang, s.simulatedStatus)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Import Design Spec & Customize SE Workflow Modal */}
      {showImport && (
        <div className="modal-backdrop" onClick={() => setShowImport(false)}>
          <div
            className="modal-card"
            style={{
              maxHeight: '88vh',
              overflowY: 'auto',
              width: 'min(820px, 94vw)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <h3 style={{marginTop: 0}}>
              {tr(
                lang,
                '导入产品设计规格并生成研发编排流程',
                'Compile Customizable Workflow from Design Spec',
              )}
            </h3>
            <p style={{color: 'var(--text-muted)', marginTop: 4}}>
              {tr(
                lang,
                '支持上传或切换任意产品的设计规格，由 PM 智能体分解模块任务并生成并行与条件分支编排图。内置产品仅作可切换测试用例。',
                'Upload or select any product design spec; PM Agent decomposes modules into a customizable parallel/conditional Twin-Graph.',
              )}
            </p>

            {/* Built-in Test Case Switcher + Local File Upload */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap',
                marginBottom: 10,
              }}
            >
              <select
                style={{flex: 1, minWidth: 260}}
                value={selectedPresetId}
                onChange={e => applyDesignPreset(e.target.value)}
              >
                <option value="">
                  {tr(
                    lang,
                    '-- 选择内置测试产品设计规格 --',
                    '-- Select Built-in Design Spec Case --',
                  )}
                </option>
                {designSpecPresets.map(p => (
                  <option key={p.id} value={p.id}>
                    {tr(
                      lang,
                      `${p.categoryZh} · ${p.nameZh}`,
                      `${p.categoryEn}: ${p.nameEn}`,
                    )}{' '}
                    · {formatTemplatePreset(lang, p.recommendedTemplate)}
                  </option>
                ))}
              </select>
              <label className="btn btn-soft" style={{cursor: 'pointer'}}>
                {tr(lang, '上传 .md/.txt 规格文件', 'Upload .md/.txt Spec')}
                <input
                  type="file"
                  accept=".md,.markdown,.txt"
                  style={{display: 'none'}}
                  onChange={e => {
                    handleUploadDesignSpecFile(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>

            {/* SE Workflow Customization Controls */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                gap: 8,
                marginBottom: 10,
                padding: '10px 12px',
                border: '1px solid var(--border-card)',
                borderRadius: 8,
                background: 'var(--bg-page)',
              }}
            >
              <label>
                <span style={{fontSize: 11, fontWeight: 600}}>
                  {tr(lang, '流程模板', 'Workflow Template')}
                </span>
                <select
                  value={templatePreset}
                  onChange={e => {
                    const next = e.target.value as WorkflowTemplatePreset;
                    setTemplatePreset(next);
                    if (next === 'microservice_hardened') {
                      setIncludeSecurityPass(true);
                      setIncludeHumanGate(true);
                    } else if (next === 'rapid_ui_api') {
                      setIncludeHumanGate(false);
                      setIncludeSecurityPass(false);
                    }
                  }}
                >
                  <option value="fullstack_se">
                    {formatTemplatePreset(lang, 'fullstack_se')}
                  </option>
                  <option value="microservice_hardened">
                    {formatTemplatePreset(lang, 'microservice_hardened')}
                  </option>
                  <option value="rapid_ui_api">
                    {formatTemplatePreset(lang, 'rapid_ui_api')}
                  </option>
                  <option value="custom">
                    {formatTemplatePreset(lang, 'custom')}
                  </option>
                </select>
              </label>
              <label>
                <span style={{fontSize: 11, fontWeight: 600}}>
                  {tr(lang, 'PM 分解引擎', 'PM Decomposer')}
                </span>
                <select
                  value={pmAgentMode}
                  onChange={e =>
                    setPmAgentMode(
                      e.target.value as 'hybrid_llm' | 'structural',
                    )
                  }
                >
                  <option value="hybrid_llm">
                    {tr(
                      lang,
                      '智能混合分解 (OpenCode 大模型)',
                      'Hybrid LLM PM',
                    )}
                  </option>
                  <option value="structural">
                    {tr(lang, '确定性结构分解', 'Structural PM')}
                  </option>
                </select>
              </label>
              <label>
                <span style={{fontSize: 11, fontWeight: 600}}>
                  {tr(lang, '最大并发节点', 'Max Parallel')}
                </span>
                <input
                  type="number"
                  min={1}
                  max={6}
                  value={maxParallelWorkers}
                  onChange={e =>
                    setMaxParallelWorkers(
                      Math.max(1, Math.min(6, Number(e.target.value) || 1)),
                    )
                  }
                />
              </label>
              <label>
                <span style={{fontSize: 11, fontWeight: 600}}>
                  {tr(lang, '美元预算上限', 'Budget Limit ($)')}
                </span>
                <input
                  type="number"
                  min={0.5}
                  step={0.5}
                  value={budgetUsdLimit}
                  onChange={e =>
                    setBudgetUsdLimit(
                      Math.max(0.5, Number(e.target.value) || 2.5),
                    )
                  }
                />
              </label>

              <div
                style={{
                  gridColumn: '1 / -1',
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  gap: 18,
                  fontSize: 12,
                  paddingTop: 4,
                }}
              >
                <label
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    whiteSpace: 'nowrap',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={includeHumanGate}
                    onChange={e => setIncludeHumanGate(e.target.checked)}
                  />
                  {tr(lang, '人工审批', 'Human Approval Gate')}
                </label>
                <label
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    whiteSpace: 'nowrap',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={includeSecurityPass}
                    onChange={e => setIncludeSecurityPass(e.target.checked)}
                  />
                  {tr(lang, '安全加固', 'Security Hardening Pass')}
                </label>
                <label
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    whiteSpace: 'nowrap',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={includeQaAudit}
                    onChange={e => setIncludeQaAudit(e.target.checked)}
                  />
                  {tr(lang, '独立审校', 'Adversarial QA Audit')}
                </label>
                <label
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    whiteSpace: 'nowrap',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={dddStrictCheck}
                    onChange={e => setDddStrictCheck(e.target.checked)}
                  />
                  {tr(lang, '术语守卫', 'DDD Terminology Guard')}
                </label>
              </div>
              <div
                style={{
                  gridColumn: '1 / -1',
                  fontSize: 11,
                  color: 'var(--text-muted)',
                  lineHeight: 1.4,
                }}
              >
                {tr(
                  lang,
                  '流程模板决定阶段结构与默认检查点；四个开关控制是否插入人工门禁、安全扫描、QA 审校与术语检查。',
                  'Workflow template selects phase layout & default checkpoints; toggles insert human gate, security scan, QA audit, and DDD guard.',
                )}
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 10,
                marginBottom: 10,
              }}
            >
              <label>
                <span style={{fontSize: 11.5, fontWeight: 600}}>
                  {tr(lang, '权限治理等级', 'Permission Tier')}
                </span>
                <select
                  value={importTier}
                  onChange={e =>
                    setImportTier(e.target.value as PermissionTier)
                  }
                >
                  <option value="supervised">
                    {tr(lang, '监督模式 (门禁护栏)', 'Supervised')}
                  </option>
                  <option value="strict">
                    {tr(lang, '严格审批模式 (含人工闸)', 'Strict (Human Gate)')}
                  </option>
                  <option value="turbo">
                    {tr(lang, '高速自治模式', 'Turbo')}
                  </option>
                </select>
              </label>
              <label>
                <span style={{fontSize: 11.5, fontWeight: 600}}>
                  {tr(lang, '确定性验证命令', 'Verification Gate Command')}
                </span>
                <input
                  className="mono"
                  value={importVerifyCmd}
                  onChange={e => setImportVerifyCmd(e.target.value)}
                />
              </label>
            </div>
            <textarea
              className="mono"
              rows={11}
              value={importMd}
              onChange={e => setImportMd(e.target.value)}
            />
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 8,
                marginTop: 12,
              }}
            >
              <button
                type="button"
                className="btn"
                onClick={() => setShowImport(false)}
              >
                {tr(lang, '取消', 'Cancel')}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !importMd.trim()}
                onClick={() => void handleImportPrd()}
              >
                {tr(
                  lang,
                  'PM 分解并生成编排图',
                  'PM Decompose & Compile Twin-Graph',
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export Workflow Plan Modal */}
      {exportPlan && (
        <div className="modal-backdrop" onClick={() => setExportPlan(null)}>
          <div
            className="modal-card"
            style={{
              maxHeight: '88vh',
              overflowY: 'auto',
              width: 'min(800px, 94vw)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 8,
                marginBottom: 8,
              }}
            >
              <h3 style={{margin: 0}}>
                {exportPlan.code} · {exportPlan.title}
              </h3>
              <div className="nav-pills" style={{marginLeft: 0}}>
                <button
                  type="button"
                  className={`nav-pill ${exportTab === 'markdown' ? 'active' : ''}`}
                  onClick={() => setExportTab('markdown')}
                >
                  {tr(lang, 'Markdown 方案', 'Markdown WBS')}
                </button>
                <button
                  type="button"
                  className={`nav-pill ${exportTab === 'mermaid' ? 'active' : ''}`}
                  onClick={() => setExportTab('mermaid')}
                >
                  {tr(lang, 'Mermaid 流程图', 'Mermaid DAG')}
                </button>
                <button
                  type="button"
                  className={`nav-pill ${exportTab === 'json' ? 'active' : ''}`}
                  onClick={() => setExportTab('json')}
                >
                  JSON
                </button>
              </div>
            </div>
            <pre
              className="mono"
              style={{
                background: 'var(--bg-page)',
                padding: 12,
                borderRadius: 8,
                fontSize: 11.5,
                maxHeight: 400,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                margin: 0,
              }}
            >
              {exportTab === 'markdown'
                ? exportPlan.markdown
                : exportTab === 'mermaid'
                  ? exportPlan.mermaid
                  : JSON.stringify(exportPlan.json, null, 2)}
            </pre>
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 8,
                marginTop: 12,
              }}
            >
              <button
                type="button"
                className="btn"
                onClick={() => {
                  const text =
                    exportTab === 'markdown'
                      ? exportPlan.markdown
                      : exportTab === 'mermaid'
                        ? exportPlan.mermaid
                        : JSON.stringify(exportPlan.json, null, 2);
                  void navigator.clipboard?.writeText(text);
                  setCopiedExport(true);
                }}
              >
                {copiedExport
                  ? tr(lang, '已复制!', 'Copied!')
                  : tr(lang, '复制到剪贴板', 'Copy')}
              </button>
              <button
                type="button"
                className="btn btn-soft"
                onClick={() => {
                  const ext =
                    exportTab === 'markdown'
                      ? 'md'
                      : exportTab === 'mermaid'
                        ? 'mmd'
                        : 'json';
                  const text =
                    exportTab === 'markdown'
                      ? exportPlan.markdown
                      : exportTab === 'mermaid'
                        ? exportPlan.mermaid
                        : JSON.stringify(exportPlan.json, null, 2);
                  const blob = new Blob([text], {
                    type: 'text/plain;charset=utf-8',
                  });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `${exportPlan.code}-plan.${ext}`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                {tr(lang, '下载文件', 'Download File')}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setExportPlan(null)}
              >
                {tr(lang, '关闭', 'Close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
