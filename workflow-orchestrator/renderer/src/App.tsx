import {type ReactElement, useCallback, useEffect, useState} from 'react';
import type {BootstrapSnapshot} from '../../src/shared/api';
import {orchApi} from './api/client';
import {
  CpuIcon,
  FileTextIcon,
  FlowIcon,
  GlobeIcon,
  HistoryIcon,
  SearchIcon,
} from './components/Icons';
import {formatRunStatus, tr, type UiLang} from './i18n';
import {CapabilitiesView} from './views/CapabilitiesView';
import {RequirementsView} from './views/RequirementsView';
import {RunsAuditView} from './views/RunsAuditView';
import {WorkflowsView} from './views/WorkflowsView';
import {WorkstationView} from './views/WorkstationView';

type TopSection = 'design' | 'requirements' | 'live' | 'capabilities' | 'audit';

export function App(): ReactElement {
  const [lang, setLang] = useState<UiLang>('ZH');
  const [section, setSection] = useState<TopSection>('design');
  const [snapshot, setSnapshot] = useState<BootstrapSnapshot | null>(null);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(
    null,
  );
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [sseConnected, setSseConnected] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showPalette, setShowPalette] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');

  const loadBootstrap = useCallback(async () => {
    try {
      const snap = await orchApi.getBootstrap();
      setSnapshot(snap);
      if (snap.workflows.length > 0 && !selectedWorkflowId) {
        setSelectedWorkflowId(snap.workflows[0]!.id);
      }
      if (snap.runs.length > 0 && !selectedRunId) {
        setSelectedRunId(snap.runs[0]!.id);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }, [selectedWorkflowId, selectedRunId]);

  useEffect(() => {
    void loadBootstrap();
  }, [loadBootstrap]);

  useEffect(() => {
    return orchApi.subscribeSse(evt => {
      if (evt.type !== 'heartbeat') {
        setRefreshTick(t => t + 1);
        void orchApi
          .getBootstrap()
          .then(setSnapshot)
          .catch(() => {});
      }
    }, setSseConnected);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowPalette(s => !s);
      }
      if (e.key === 'Escape') {
        setShowPalette(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const isWin = (window.workflowOrchestrator?.platform ?? navigator.platform)
    .toLowerCase()
    .includes('win');

  const quickCommands = [
    {label: tr(lang, '切换到 · 需求工程', 'Go to · Requirements'), run: () => setSection('requirements')},
    {
      label: tr(lang, '切换到 · 编排设计台', 'Go to · Design Studio'),
      run: () => setSection('design'),
    },
    {
      label: tr(lang, '切换到 · 实时编排控制台', 'Go to · Live Orchestrator'),
      run: () => setSection('live'),
    },
    {
      label: tr(lang, '切换到 · 基础设施与模型池', 'Go to · Infra & Models'),
      run: () => setSection('capabilities'),
    },
    {
      label: tr(lang, '切换到 · 版本与日志审计', 'Go to · Versions & Audit'),
      run: () => setSection('audit'),
    },
    ...(snapshot?.workflows.map(wf => ({
      label: `${tr(lang, '工作流', 'Workflow')} · ${wf.code}: ${wf.title}`,
      run: () => {
        setSelectedWorkflowId(wf.id);
        setSection('design');
      },
    })) ?? []),
    ...(snapshot?.runs.map(r => ({
      label: `${tr(lang, '运行', 'Run')} · ${r.title} · ${formatRunStatus(lang, r.status)}`,
      run: () => {
        setSelectedRunId(r.id);
        setSection('live');
      },
    })) ?? []),
  ].filter(c =>
    c.label.toLowerCase().includes(paletteQuery.trim().toLowerCase()),
  );

  return (
    <div className="app-shell">
      <header className={`topbar ${isWin ? 'topbar-win' : ''}`}>
        <div className="topbar-left">
          <div className="brand-mark">
            <span className="brand-badge">WO</span>
            <span>Workflow Orchestrator</span>
          </div>

          <nav className="nav-pills">
            <button
              type="button"
              className={`nav-pill ${section === 'requirements' ? 'active' : ''}`}
              onClick={() => setSection('requirements')}
            >
              <FileTextIcon size={14} /> {tr(lang, '需求工程', 'Requirements')}
            </button>
            <button
              type="button"
              className={`nav-pill ${section === 'design' ? 'active' : ''}`}
              onClick={() => setSection('design')}
            >
              <FileTextIcon size={14} />{' '}
              {tr(lang, '编排设计台', 'Design Studio')}
            </button>
            <button
              type="button"
              className={`nav-pill ${section === 'live' ? 'active' : ''}`}
              onClick={() => setSection('live')}
            >
              <FlowIcon size={14} />{' '}
              {tr(lang, '实时编排控制台', 'Live Orchestrator')}
              {(snapshot?.openInterventions.length ?? 0) > 0 && (
                <span className="tag tag-amber">
                  {snapshot?.openInterventions.length}
                </span>
              )}
            </button>
            <button
              type="button"
              className={`nav-pill ${section === 'capabilities' ? 'active' : ''}`}
              onClick={() => setSection('capabilities')}
            >
              <CpuIcon size={14} />{' '}
              {tr(lang, '基础设施与模型池', 'Infra & Models')}
            </button>
            <button
              type="button"
              className={`nav-pill ${section === 'audit' ? 'active' : ''}`}
              onClick={() => setSection('audit')}
            >
              <HistoryIcon size={14} />{' '}
              {tr(lang, '版本与日志审计', 'Versions & Audit')}
            </button>
          </nav>
        </div>

        <div className="topbar-right">
          {snapshot && (
            <span className="mono tag">
              {tr(lang, '槽位', 'Slots')} {snapshot.slots.activeWorkerSlots}/
              {snapshot.slots.maxWorkerSlots}
            </span>
          )}
          <span className={`tag ${sseConnected ? 'tag-green' : ''}`}>
            ●{' '}
            {sseConnected
              ? tr(lang, '实时连接', 'SSE Live')
              : tr(lang, '轮询', 'Polling')}
          </span>
          <button
            type="button"
            className="btn btn-sm"
            title="Ctrl+K"
            onClick={() => setShowPalette(true)}
          >
            <SearchIcon size={12} /> {tr(lang, '检索', 'Search')}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setLang(l => (l === 'ZH' ? 'EN' : 'ZH'))}
          >
            <GlobeIcon size={12} /> {lang === 'ZH' ? '中文/EN' : 'EN/中文'}
          </button>
        </div>
      </header>

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

      <main className="main-body">
        {!snapshot ? (
          <div className="page-scroll">
            <div className="card">
              {tr(
                lang,
                '正在连接本地 Workflow 编排守护进程...',
                'Connecting to Workflow Orchestrator loopback runtime...',
              )}
            </div>
          </div>
        ) : section === 'requirements' ? (
          <RequirementsView lang={lang} providers={snapshot.modelProviders} workspaces={snapshot.workspaces}
            onOpenWorkflow={workflowId => {
              setSelectedWorkflowId(workflowId);
              setSection('design');
            }}
          />
        ) : section === 'design' ? (
          <WorkflowsView
            lang={lang}
            workspaces={snapshot.workspaces}
            workflows={snapshot.workflows}
            capabilities={snapshot.capabilities}
            designSpecPresets={snapshot.designSpecPresets}
            domainTerms={snapshot.domainTerms}
            selectedWorkflowId={selectedWorkflowId}
            onSelectWorkflow={setSelectedWorkflowId}
            onRefreshBootstrap={loadBootstrap}
            onStartedRun={runId => {
              setSelectedRunId(runId);
              setSection('live');
            }}
          />
        ) : section === 'live' ? (
          <WorkstationView
            lang={lang}
            runs={snapshot.runs}
            selectedRunId={selectedRunId}
            onSelectRun={setSelectedRunId}
            onRefreshBootstrap={loadBootstrap}
            refreshTick={refreshTick}
            infraStatus={snapshot.infraStatus}
          />
        ) : section === 'capabilities' ? (
          <CapabilitiesView
            lang={lang}
            capabilities={snapshot.capabilities}
            capabilityHealth={snapshot.capabilityHealth}
            modelProviders={snapshot.modelProviders}
            skills={snapshot.skills}
            mcpServers={snapshot.mcpServers}
            domainTerms={snapshot.domainTerms}
            infraStatus={snapshot.infraStatus}
            onRefresh={loadBootstrap}
          />
        ) : (
          <RunsAuditView
            lang={lang}
            versions={snapshot.versions}
            runs={snapshot.runs}
            recentAudit={snapshot.recentAudit}
            rehydrationCapsules={snapshot.rehydrationCapsules}
            constitution={snapshot.constitution}
            onRefresh={loadBootstrap}
            onOpenRun={runId => {
              setSelectedRunId(runId);
              setSection('live');
            }}
          />
        )}
      </main>

      {showPalette && (
        <div className="modal-backdrop" onClick={() => setShowPalette(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <input
              autoFocus
              value={paletteQuery}
              onChange={e => setPaletteQuery(e.target.value)}
              placeholder={tr(
                lang,
                '快速跳转页面、工作流或运行实例...',
                'Jump to section, workflow, or run...',
              )}
            />
            <div
              style={{
                marginTop: 10,
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              {quickCommands.map((cmd, idx) => (
                <button
                  key={idx}
                  type="button"
                  className="btn"
                  style={{justifyContent: 'flex-start'}}
                  onClick={() => {
                    cmd.run();
                    setShowPalette(false);
                    setPaletteQuery('');
                  }}
                >
                  {cmd.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
