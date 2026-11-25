import {type ReactElement, useState} from 'react';
import type {InfraStatusSnapshot} from '../../../src/shared/api';
import type {
  CapabilityAdapterManifest,
  CapabilityHealthProfile,
  DomainTermEntry,
  ExecutorKind,
  McpServerEntry,
  ModelProviderConfig,
  SkillEntry,
} from '../../../src/shared/types';
import {orchApi, type DoctorReportDto} from '../api/client';
import {CpuIcon, ShieldCheckIcon} from '../components/Icons';
import {formatExecutorKind, tr, type UiLang} from '../i18n';

interface CapabilitiesViewProps {
  readonly lang: UiLang;
  readonly capabilities: readonly CapabilityAdapterManifest[];
  readonly capabilityHealth: readonly CapabilityHealthProfile[];
  readonly modelProviders: readonly ModelProviderConfig[];
  readonly skills: readonly SkillEntry[];
  readonly mcpServers: readonly McpServerEntry[];
  readonly domainTerms: readonly DomainTermEntry[];
  readonly infraStatus?: InfraStatusSnapshot;
  readonly onRefresh: () => Promise<void>;
}

export function CapabilitiesView(props: CapabilitiesViewProps): ReactElement {
  const {
    lang,
    capabilities,
    capabilityHealth,
    modelProviders,
    skills,
    mcpServers,
    domainTerms,
    infraStatus,
    onRefresh,
  } = props;

  const [capTab, setCapTab] = useState<'agents' | 'skills_dream' | 'mcp_ddd'>(
    'agents',
  );
  const [busy, setBusy] = useState(false);
  const [doctor, setDoctor] = useState<DoctorReportDto | null>(null);
  const [apiKeyDraft, setApiKeyDraft] = useState<Record<string, string>>({});

  // Inline sovereignSoul editor
  const [editingSoulId, setEditingSoulId] = useState<string | null>(null);
  const [soulDraft, setSoulDraft] = useState('');

  // Custom Capability Form
  const [newId, setNewId] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newCommand, setNewCommand] = useState('');
  const [newExecKind, setNewExecKind] = useState<ExecutorKind>('tool');
  const [errMsg, setErrMsg] = useState<string | null>(null);

  // SkillsBank & Sleep-Time Dreaming
  const [skillSlug, setSkillSlug] = useState('');
  const [skillTitle, setSkillTitle] = useState('');
  const [skillCat, setSkillCat] = useState<SkillEntry['category']>('backend');
  const [skillContent, setSkillContent] = useState('');
  const [dreamBanner, setDreamBanner] = useState<string | null>(null);

  // MCP Server Pool & DDD Glossary
  const [mcpName, setMcpName] = useState('');
  const [mcpTransport, setMcpTransport] = useState<'stdio' | 'http'>('stdio');
  const [mcpEndpoint, setMcpEndpoint] = useState('');
  const [mcpDesc, setMcpDesc] = useState('');

  const [dddContext, setDddContext] = useState('Orchestration');
  const [dddTerm, setDddTerm] = useState('');
  const [dddAliases, setDddAliases] = useState('');
  const [dddDef, setDddDef] = useState('');

  const healthById = new Map(capabilityHealth.map(h => [h.capabilityId, h]));
  const opencodeProvider = modelProviders.find(p => p.id === 'opencode-go');
  const opencodeConnected =
    infraStatus?.opencodeGoConfigured ?? Boolean(opencodeProvider?.hasApiKey);
  const defaultModel = infraStatus?.defaultModel || 'deepseek-v4.1-flash';
  const proxyConfigured = infraStatus?.proxyConfigured ?? false;
  const gitCap = capabilities.find(c => c.id === 'git-control');
  const gitReady =
    infraStatus?.gitReady ?? (gitCap ? gitCap.probeOk !== false : true);

  const handleProbe = async (id: string): Promise<void> => {
    setBusy(true);
    setErrMsg(null);
    try {
      await orchApi.probeCapability(id);
      await onRefresh();
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleToggle = async (id: string, enabled: boolean): Promise<void> => {
    setBusy(true);
    setErrMsg(null);
    try {
      await orchApi.toggleCapability(id, enabled);
      await onRefresh();
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleSaveProviderKey = async (providerId: string): Promise<void> => {
    setBusy(true);
    setErrMsg(null);
    try {
      await orchApi.setProviderSecret(providerId, {
        apiKey: apiKeyDraft[providerId] ?? '',
      });
      setApiKeyDraft(prev => ({...prev, [providerId]: ''}));
      await onRefresh();
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRegisterCustom = async (): Promise<void> => {
    if (!newId.trim() || !newLabel.trim()) {
      return;
    }
    setBusy(true);
    setErrMsg(null);
    try {
      await orchApi.registerCapability({
        manifest: {
          id: newId.trim(),
          label: newLabel.trim(),
          executorKind: newExecKind,
          specialty: 'Custom registered workflow capability',
          sovereignSoul: 'Execute custom command/agent slice safely.',
          transport: newExecKind === 'tool' ? 'local-tool' : 'cli-stream',
          command: newCommand.trim() || 'node',
          baseArgs: [],
          healthProbeArgs: ['--version'],
          mcpInjection: 'none',
          jsonlParser: 'generic-jsonl',
          permissionFlags: {turbo: [], supervised: [], strict: []},
          envAllowlist: [],
          defaultModel: 'default',
          supportedRoles: ['worker'],
          maxConcurrentSlots: 2,
          enabled: true,
          builtIn: false,
        },
      });
      setNewId('');
      setNewLabel('');
      setNewCommand('');
      await onRefresh();
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRunDoctor = async (): Promise<void> => {
    setBusy(true);
    try {
      const report = await orchApi.runDoctor();
      setDoctor(report);
      await onRefresh();
    } finally {
      setBusy(false);
    }
  };

  const handleSaveSoul = async (
    cap: CapabilityAdapterManifest,
  ): Promise<void> => {
    setBusy(true);
    setErrMsg(null);
    try {
      await orchApi.registerCapability({
        manifest: {...cap, sovereignSoul: soulDraft.trim()},
      });
      setEditingSoulId(null);
      await onRefresh();
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRunDream = async (): Promise<void> => {
    setBusy(true);
    setErrMsg(null);
    try {
      const res = await orchApi.runDreamConsolidation();
      setDreamBanner(
        tr(
          lang,
          `睡眠整合完成：检查 ${res.consolidatedRuns} 次运行，强化 ${res.reinforcedSkills} 个技能${res.distilledSkill ? `，新蒸馏 ${res.distilledSkill.slug}` : ''}（累计开销 $${res.totalSpentUsd.toFixed(4)}）。`,
          `Dream consolidation finished: ${res.consolidatedRuns} runs inspected, ${res.reinforcedSkills} skills reinforced${res.distilledSkill ? `, distilled ${res.distilledSkill.slug}` : ''} ($${res.totalSpentUsd.toFixed(4)} total).`,
        ),
      );
      await onRefresh();
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleAddSkill = async (): Promise<void> => {
    if (!skillSlug.trim() || !skillTitle.trim()) {
      return;
    }
    setBusy(true);
    setErrMsg(null);
    try {
      await orchApi.upsertSkill({
        slug: skillSlug.trim(),
        title: skillTitle.trim(),
        category: skillCat,
        content: skillContent.trim() || skillTitle.trim(),
      });
      setSkillSlug('');
      setSkillTitle('');
      setSkillContent('');
      await onRefresh();
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleAddMcp = async (): Promise<void> => {
    if (!mcpName.trim() || !mcpEndpoint.trim()) {
      return;
    }
    setBusy(true);
    setErrMsg(null);
    try {
      await orchApi.upsertMcpServer({
        name: mcpName.trim(),
        transport: mcpTransport,
        endpointOrCommand: mcpEndpoint.trim(),
        description: mcpDesc.trim() || undefined,
      });
      setMcpName('');
      setMcpEndpoint('');
      setMcpDesc('');
      await onRefresh();
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleProbeMcp = async (id: string): Promise<void> => {
    setBusy(true);
    setErrMsg(null);
    try {
      await orchApi.probeMcpServer(id);
      await onRefresh();
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleAddDddTerm = async (): Promise<void> => {
    if (!dddTerm.trim()) {
      return;
    }
    setBusy(true);
    setErrMsg(null);
    try {
      await orchApi.upsertDomainTerm({
        boundedContext: dddContext.trim() || 'Core',
        canonicalTerm: dddTerm.trim(),
        definition: dddDef.trim(),
        forbiddenAliases: dddAliases
          .split(',')
          .map(s => s.trim())
          .filter(Boolean),
      });
      setDddTerm('');
      setDddAliases('');
      setDddDef('');
      await onRefresh();
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteDddTerm = async (id: string): Promise<void> => {
    setBusy(true);
    setErrMsg(null);
    try {
      await orchApi.deleteDomainTerm(id);
      await onRefresh();
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-scroll">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12,
        }}
      >
        <div>
          <h2
            style={{margin: 0, display: 'flex', alignItems: 'center', gap: 8}}
          >
            <CpuIcon size={18} />{' '}
            {tr(lang, '基础设施与模型池', 'Infrastructure & Model Pool')}
          </h2>
          <div style={{color: 'var(--text-muted)', marginTop: 3}}>
            {tr(
              lang,
              '管理智能体灵魂指令、模型供应凭证、技能库睡眠整合、工具协议与领域统一语言。',
              'Manage agent sovereign souls, model providers, SkillsBank dreaming, MCP pool, and DDD ubiquitous language.',
            )}
          </div>
        </div>
        <div style={{display: 'flex', gap: 8}}>
          <button
            type="button"
            className="btn btn-soft"
            disabled={busy}
            onClick={() => void handleRunDream()}
          >
            {tr(lang, '执行睡眠进化整合', 'Run Dream Consolidation')}
          </button>
          <button
            type="button"
            className="btn btn-soft"
            disabled={busy}
            onClick={() => void handleRunDoctor()}
          >
            <ShieldCheckIcon size={14} />{' '}
            {tr(lang, '环境体检', 'Run Env Doctor')}
          </button>
        </div>
      </div>

      {/* OpenCode Go & Sandbox Infrastructure Readiness Banner */}
      <div
        className="card"
        style={{
          marginBottom: 14,
          background: opencodeConnected ? '#f0fdf4' : '#f8fafc',
          borderColor: opencodeConnected ? '#86efac' : 'var(--border-card)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            flexWrap: 'wrap',
          }}
        >
          <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
            <span
              className={`tag ${opencodeConnected ? 'tag-green' : 'tag-amber'}`}
            >
              {opencodeConnected
                ? tr(lang, 'OpenCode Go 已连通', 'OpenCode Go Ready')
                : tr(
                    lang,
                    'OpenCode Go 未配置 · 离线降级',
                    'OpenCode Go Offline',
                  )}
            </span>
            <span className="mono" style={{fontSize: 12, fontWeight: 700}}>
              {defaultModel}
            </span>
            {opencodeProvider?.hasApiKey && opencodeProvider.maskedKeyHint && (
              <span className="mono tag">{opencodeProvider.maskedKeyHint}</span>
            )}
          </div>
          <span className={`tag ${proxyConfigured ? 'tag-indigo' : ''}`}>
            {proxyConfigured
              ? tr(lang, '代理通道已就绪', 'Proxy Active')
              : tr(lang, '直连通道', 'Direct Network')}
          </span>
          <span className={`tag ${gitReady ? 'tag-teal' : 'tag-red'}`}>
            {gitReady
              ? tr(lang, 'Git 隔离沙箱引擎就绪', 'Git Worktree Sandbox Ready')
              : tr(lang, 'Git 沙箱待体检', 'Git Probe Needed')}
          </span>
        </div>
        <div style={{fontSize: 11.5, color: 'var(--text-secondary)'}}>
          {opencodeConnected
            ? tr(
                lang,
                '默认优先调度 OpenCode Go 订阅引擎，异常或断网时自动降级本地执行。',
                'OpenCode Go subscription active; offline deterministic synthesis acts as fallback.',
              )
            : tr(
                lang,
                '在右侧模型密钥池填入凭证或登录后即可启用实时大模型推理。',
                'Configure API key below to enable live LLM inference.',
              )}
        </div>
      </div>

      <div className="underline-tabs" style={{marginBottom: 14}}>
        <button
          type="button"
          className={`underline-tab ${capTab === 'agents' ? 'active' : ''}`}
          onClick={() => setCapTab('agents')}
        >
          {tr(lang, '1. 能力与模型接入', '1. Capabilities & Vault')} (
          {capabilities.length})
        </button>
        <button
          type="button"
          className={`underline-tab ${capTab === 'skills_dream' ? 'active' : ''}`}
          onClick={() => setCapTab('skills_dream')}
        >
          {tr(lang, '2. 技能库与睡眠整合', '2. SkillsBank & Dreaming')} (
          {skills.length})
        </button>
        <button
          type="button"
          className={`underline-tab ${capTab === 'mcp_ddd' ? 'active' : ''}`}
          onClick={() => setCapTab('mcp_ddd')}
        >
          {tr(lang, '3. 工具协议与领域术语', '3. MCP Pool & DDD Glossary')} (
          {mcpServers.length} / {domainTerms.length})
        </button>
      </div>

      {errMsg && (
        <div
          className="error-banner"
          style={{marginBottom: 12, borderRadius: 8}}
        >
          <span>{errMsg}</span>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setErrMsg(null)}
          >
            ×
          </button>
        </div>
      )}

      {dreamBanner && (
        <div
          className="card"
          style={{
            marginBottom: 12,
            background: '#eef2ff',
            borderColor: '#c7d2fe',
          }}
        >
          {dreamBanner}
        </div>
      )}

      {doctor && (
        <div
          className="card"
          style={{
            marginBottom: 16,
            background: '#f0fdf4',
            borderColor: '#86efac',
          }}
        >
          <strong>
            {tr(lang, '环境体检报告', 'Environment Doctor Report')}
          </strong>{' '}
          · Node {doctor.nodeVersion} · Git:{' '}
          <span className="mono">{doctor.gitVersion}</span> ·{' '}
          {tr(lang, '已清理工作树', 'Pruned Worktrees')}:{' '}
          <span className="mono">{doctor.prunedWorktrees?.length ?? 0}</span>
        </div>
      )}

      {capTab === 'agents' && (
        <div
          style={{display: 'grid', gridTemplateColumns: '1.25fr 1fr', gap: 16}}
        >
          {/* Capabilities Registry & Health */}
          <div style={{display: 'flex', flexDirection: 'column', gap: 12}}>
            <div className="card">
              <strong style={{fontSize: 13.5}}>
                {tr(
                  lang,
                  '能力注册与熔断监控',
                  'Capability Registry & Circuit Status',
                )}
              </strong>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  marginTop: 10,
                }}
              >
                {capabilities.map(cap => {
                  const hp = healthById.get(cap.id);
                  const circuit =
                    hp?.circuitState ?? (cap.enabled ? 'closed' : 'open');
                  return (
                    <div
                      key={cap.id}
                      style={{
                        border: '1px solid var(--border-card)',
                        borderRadius: 8,
                        padding: '10px 12px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 12,
                      }}
                    >
                      <div>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                          }}
                        >
                          <span className="mono" style={{fontWeight: 700}}>
                            {cap.id}
                          </span>
                          <span className="tag tag-indigo">
                            {formatExecutorKind(lang, cap.executorKind)}
                          </span>
                          <span
                            className={`tag ${
                              circuit === 'closed'
                                ? 'tag-green'
                                : circuit === 'half_open'
                                  ? 'tag-amber'
                                  : 'tag-red'
                            }`}
                          >
                            {tr(lang, '熔断', 'circuit')}:{' '}
                            {circuit === 'closed'
                              ? tr(lang, '闭合', 'closed')
                              : circuit === 'half_open'
                                ? tr(lang, '半开', 'half_open')
                                : tr(lang, '熔断', 'open')}
                          </span>
                        </div>
                        <div style={{fontWeight: 600, marginTop: 3}}>
                          {cap.label}
                        </div>
                        <div
                          style={{fontSize: 11.5, color: 'var(--text-muted)'}}
                        >
                          {cap.specialty} · {tr(lang, '探测', 'Probe')}:{' '}
                          {cap.probeMessage}
                        </div>
                        {editingSoulId === cap.id ? (
                          <div style={{marginTop: 6, display: 'flex', gap: 6}}>
                            <input
                              value={soulDraft}
                              onChange={e => setSoulDraft(e.target.value)}
                              placeholder={tr(
                                lang,
                                '输入灵魂指令...',
                                'Sovereign Soul directive...',
                              )}
                            />
                            <button
                              type="button"
                              className="btn btn-sm btn-primary"
                              disabled={busy}
                              onClick={() => void handleSaveSoul(cap)}
                            >
                              {tr(lang, '保存', 'Save')}
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={() => setEditingSoulId(null)}
                            >
                              {tr(lang, '取消', 'Cancel')}
                            </button>
                          </div>
                        ) : (
                          <div
                            style={{
                              fontSize: 11,
                              color: 'var(--text-secondary)',
                              marginTop: 4,
                            }}
                          >
                            {tr(lang, '灵魂指令', 'Soul')}: {cap.sovereignSoul}
                          </div>
                        )}
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          flexShrink: 0,
                        }}
                      >
                        <button
                          type="button"
                          className="btn btn-sm"
                          disabled={busy}
                          onClick={() => {
                            setEditingSoulId(cap.id);
                            setSoulDraft(cap.sovereignSoul);
                          }}
                        >
                          {tr(lang, '灵魂指令', 'Soul')}
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm"
                          disabled={busy}
                          onClick={() => void handleProbe(cap.id)}
                        >
                          {tr(lang, '探测', 'Probe')}
                        </button>
                        <button
                          type="button"
                          className={`btn btn-sm ${cap.enabled ? '' : 'btn-primary'}`}
                          disabled={busy}
                          onClick={() =>
                            void handleToggle(cap.id, !cap.enabled)
                          }
                        >
                          {cap.enabled
                            ? tr(lang, '禁用', 'Disable')
                            : tr(lang, '启用', 'Enable')}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="card">
              <strong style={{fontSize: 13}}>
                {tr(lang, '注册自定义能力', 'Register Custom Capability')}
              </strong>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr 1fr 1fr auto',
                  gap: 8,
                  marginTop: 8,
                }}
              >
                <input
                  value={newId}
                  onChange={e => setNewId(e.target.value)}
                  placeholder={tr(lang, '如 tool:pytest', 'tool:pytest')}
                />
                <input
                  value={newLabel}
                  onChange={e => setNewLabel(e.target.value)}
                  placeholder={tr(lang, '能力名称', 'Pytest Runner')}
                />
                <select
                  value={newExecKind}
                  onChange={e => setNewExecKind(e.target.value as ExecutorKind)}
                >
                  <option value="tool">
                    {formatExecutorKind(lang, 'tool')}
                  </option>
                  <option value="agent">
                    {formatExecutorKind(lang, 'agent')}
                  </option>
                </select>
                <input
                  value={newCommand}
                  onChange={e => setNewCommand(e.target.value)}
                  placeholder={tr(
                    lang,
                    '执行命令或可执行文件',
                    'command / bin',
                  )}
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy || !newId.trim() || !newLabel.trim()}
                  onClick={() => void handleRegisterCustom()}
                >
                  {tr(lang, '注册', 'Register')}
                </button>
              </div>
            </div>
          </div>

          {/* Provider Vault */}
          <div className="card" style={{height: 'fit-content'}}>
            <strong style={{fontSize: 13.5}}>
              {tr(
                lang,
                '模型供应与密钥保险库',
                'Model Providers & Secret Vault',
              )}
            </strong>
            <div
              style={{
                fontSize: 11.5,
                color: 'var(--text-muted)',
                marginTop: 3,
                marginBottom: 10,
              }}
            >
              {tr(
                lang,
                '密钥持久化在主机安全文件，永不进入 SQLite 转录日志；未配密钥时自动降级为确定性本地执行以保障演示和离线验证。',
                'API keys live outside SQLite transcripts; offline deterministic synthesis works cleanly when unconfigured.',
              )}
            </div>
            {modelProviders.map(p => (
              <div
                key={p.id}
                style={{
                  border: '1px solid var(--border-card)',
                  borderRadius: 8,
                  padding: '10px 12px',
                  marginBottom: 10,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <strong>{p.name}</strong>
                  <span className={`tag ${p.hasApiKey ? 'tag-green' : ''}`}>
                    {p.hasApiKey
                      ? p.maskedKeyHint
                      : tr(lang, '未配置', 'Not configured')}
                  </span>
                </div>
                <div
                  className="mono"
                  style={{
                    fontSize: 11,
                    color: 'var(--text-muted)',
                    marginTop: 3,
                  }}
                >
                  {p.baseUrl} · {p.models.map(m => m.id).join(', ')}
                </div>
                <div style={{display: 'flex', gap: 6, marginTop: 8}}>
                  <input
                    type="password"
                    value={apiKeyDraft[p.id] ?? ''}
                    onChange={e =>
                      setApiKeyDraft(prev => ({
                        ...prev,
                        [p.id]: e.target.value,
                      }))
                    }
                    placeholder={tr(
                      lang,
                      '输入 API 密钥，留空则清除...',
                      'Enter API Key, leave empty to clear...',
                    )}
                  />
                  <button
                    type="button"
                    className="btn btn-soft"
                    disabled={busy}
                    onClick={() => void handleSaveProviderKey(p.id)}
                  >
                    {tr(lang, '保存', 'Save')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {capTab === 'skills_dream' && (
        <div
          style={{display: 'grid', gridTemplateColumns: '1.35fr 1fr', gap: 16}}
        >
          <div className="card">
            <strong style={{fontSize: 13.5}}>
              {tr(
                lang,
                '可复用工程技能库与艾宾浩斯记忆稳定度',
                'Reusable Engineering SkillsBank',
              )}
            </strong>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                marginTop: 10,
              }}
            >
              {skills.map(sk => (
                <div
                  key={sk.id}
                  style={{
                    border: '1px solid var(--border-card)',
                    borderRadius: 8,
                    padding: '9px 12px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 8,
                    }}
                  >
                    <div>
                      <span className="mono tag tag-indigo">{sk.slug}</span>{' '}
                      <span className="tag">{sk.category}</span>{' '}
                      <strong>{sk.title}</strong>
                    </div>
                    <span className="mono tag tag-green">
                      {tr(lang, '调用', 'used')} {sk.timesUsed}{' '}
                      {tr(lang, '次', '')} · {tr(lang, '稳定度', 'stability')}{' '}
                      {sk.stabilityHours.toFixed(1)}h
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--text-secondary)',
                      marginTop: 4,
                    }}
                  >
                    {sk.content}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card" style={{height: 'fit-content'}}>
            <strong style={{fontSize: 13.5}}>
              {tr(lang, '新增或更新技能条目', 'Upsert Skill Entry')}
            </strong>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                marginTop: 10,
              }}
            >
              <input
                className="mono"
                value={skillSlug}
                onChange={e => setSkillSlug(e.target.value)}
                placeholder={tr(
                  lang,
                  '技能标识，如 strict-ddd-contract',
                  'slug (e.g. strict-ddd-contract)',
                )}
              />
              <input
                value={skillTitle}
                onChange={e => setSkillTitle(e.target.value)}
                placeholder={tr(lang, '技能标题', 'Skill title')}
              />
              <select
                value={skillCat}
                onChange={e =>
                  setSkillCat(e.target.value as SkillEntry['category'])
                }
              >
                <option value="pm_plan">
                  {tr(lang, '规划拆解', 'pm_plan')}
                </option>
                <option value="backend">
                  {tr(lang, '后端工程', 'backend')}
                </option>
                <option value="frontend">
                  {tr(lang, '前端界面', 'frontend')}
                </option>
                <option value="qa">{tr(lang, '质量审校', 'qa')}</option>
                <option value="governance">
                  {tr(lang, '架构治理', 'governance')}
                </option>
              </select>
              <textarea
                rows={4}
                value={skillContent}
                onChange={e => setSkillContent(e.target.value)}
                placeholder={tr(
                  lang,
                  '工程规范与避坑指引...',
                  'Engineering guidance...',
                )}
              />
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !skillSlug.trim() || !skillTitle.trim()}
                onClick={() => void handleAddSkill()}
              >
                {tr(lang, '写入技能库', 'Save to SkillsBank')}
              </button>
            </div>
          </div>
        </div>
      )}

      {capTab === 'mcp_ddd' && (
        <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16}}>
          <div className="card">
            <strong style={{fontSize: 13.5}}>
              {tr(lang, 'MCP 工具服务器池', 'MCP Server Pool')}
            </strong>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                marginTop: 10,
              }}
            >
              {mcpServers.map(m => (
                <div
                  key={m.id}
                  style={{
                    border: '1px solid var(--border-card)',
                    borderRadius: 8,
                    padding: '9px 11px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 8,
                  }}
                >
                  <div>
                    <div
                      style={{display: 'flex', alignItems: 'center', gap: 6}}
                    >
                      <strong>{m.name}</strong>
                      <span className="mono tag">{m.transport}</span>
                      <span
                        className={`tag ${
                          m.status === 'ready'
                            ? 'tag-green'
                            : m.status === 'offline'
                              ? 'tag-red'
                              : ''
                        }`}
                      >
                        {m.status === 'ready'
                          ? tr(lang, '就绪', 'ready')
                          : m.status === 'offline'
                            ? tr(lang, '离线', 'offline')
                            : tr(lang, '未探测', 'untested')}{' '}
                        · {m.toolsCount} {tr(lang, '个工具', 'tools')}
                      </span>
                    </div>
                    <div
                      className="mono"
                      style={{
                        fontSize: 11,
                        color: 'var(--text-muted)',
                        marginTop: 3,
                      }}
                    >
                      {m.endpointOrCommand}
                    </div>
                    <div
                      style={{fontSize: 11.5, color: 'var(--text-secondary)'}}
                    >
                      {m.description}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={busy}
                    onClick={() => void handleProbeMcp(m.id)}
                  >
                    {tr(lang, '探测', 'Probe')}
                  </button>
                </div>
              ))}
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 90px',
                gap: 6,
                marginTop: 12,
              }}
            >
              <input
                value={mcpName}
                onChange={e => setMcpName(e.target.value)}
                placeholder={tr(lang, 'MCP 服务器名称', 'MCP name')}
              />
              <select
                value={mcpTransport}
                onChange={e =>
                  setMcpTransport(e.target.value as 'stdio' | 'http')
                }
              >
                <option value="stdio">stdio</option>
                <option value="http">http</option>
              </select>
              <input
                className="mono"
                style={{gridColumn: '1 / -1'}}
                value={mcpEndpoint}
                onChange={e => setMcpEndpoint(e.target.value)}
                placeholder="node tools/mcp.js OR https://..."
              />
              <input
                style={{gridColumn: '1 / -1'}}
                value={mcpDesc}
                onChange={e => setMcpDesc(e.target.value)}
                placeholder={tr(lang, '描述用途', 'Description')}
              />
              <button
                type="button"
                className="btn btn-primary"
                style={{gridColumn: '1 / -1'}}
                disabled={busy || !mcpName.trim() || !mcpEndpoint.trim()}
                onClick={() => void handleAddMcp()}
              >
                {tr(lang, '注册 MCP 服务器', 'Register MCP Server')}
              </button>
            </div>
          </div>

          <div className="card">
            <strong style={{fontSize: 13.5}}>
              {tr(
                lang,
                '领域统一语言与禁用别名守卫',
                'DDD Ubiquitous Language & Alias Guard',
              )}
            </strong>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                marginTop: 10,
              }}
            >
              {domainTerms.map(t => (
                <div
                  key={t.id}
                  style={{
                    border: '1px solid var(--border-card)',
                    borderRadius: 8,
                    padding: '9px 11px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 8,
                  }}
                >
                  <div>
                    <div
                      style={{display: 'flex', alignItems: 'center', gap: 6}}
                    >
                      <span className="tag tag-indigo">{t.boundedContext}</span>
                      <strong className="mono">{t.canonicalTerm}</strong>
                      {t.localLabel && (
                        <span className="tag">{t.localLabel}</span>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: 11.5,
                        color: 'var(--text-secondary)',
                        marginTop: 3,
                      }}
                    >
                      {t.definition}
                    </div>
                    {t.forbiddenAliases.length > 0 && (
                      <div
                        style={{fontSize: 11, color: '#b91c1c', marginTop: 2}}
                      >
                        {tr(lang, '禁用别名', 'Forbidden aliases')}:{' '}
                        {t.forbiddenAliases.join(', ')}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={busy}
                    onClick={() => void handleDeleteDddTerm(t.id)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 6,
                marginTop: 12,
              }}
            >
              <input
                value={dddContext}
                onChange={e => setDddContext(e.target.value)}
                placeholder={tr(lang, '限界上下文', 'Bounded Context')}
              />
              <input
                className="mono"
                value={dddTerm}
                onChange={e => setDddTerm(e.target.value)}
                placeholder={tr(lang, '规范术语名称', 'CanonicalTerm')}
              />
              <input
                style={{gridColumn: '1 / -1'}}
                value={dddAliases}
                onChange={e => setDddAliases(e.target.value)}
                placeholder={tr(
                  lang,
                  '禁用别名，逗号分隔，如 step_box, task_unit',
                  'Forbidden aliases (comma-separated, e.g. step_box, task_unit)',
                )}
              />
              <input
                style={{gridColumn: '1 / -1'}}
                value={dddDef}
                onChange={e => setDddDef(e.target.value)}
                placeholder={tr(lang, '领域语义定义', 'Canonical definition')}
              />
              <button
                type="button"
                className="btn btn-primary"
                style={{gridColumn: '1 / -1'}}
                disabled={busy || !dddTerm.trim()}
                onClick={() => void handleAddDddTerm()}
              >
                {tr(lang, '添加领域术语守卫', 'Add DDD Term Guard')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
