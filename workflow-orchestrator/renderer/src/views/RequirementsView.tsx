import {type FormEvent, useEffect, useState} from 'react';
import {
  campusDemo, dimensions, rolesDefault, type ApprovedRequirementsBaseline, type Artifact, type Intake,
  type DecisionInput, type Evaluation, type Issue, type Prd, type Proposal, type RunSummary, type RunView, type StartInput,
} from '../../../../requirements-engineering/src/contracts.ts';
import {renderPrd} from '../../../../requirements-engineering/src/markdown.ts';
import type {ModelProviderConfig, WorkspaceEntry} from '../../../src/shared/types';
import {orchApi} from '../api/client';
import {TwinGraphCanvas} from '../components/TwinGraphCanvas';
import {DesignStart} from '../components/DesignStart';
import {formatRunStatus, type UiLang} from '../i18n';

const labels: Record<DecisionInput['action'], string> = {
  clarify: '提交澄清', resolve_issue: '裁决议题', approve: '批准方案', conditional_approve: '附条件批准',
  release_conditions: '确认条件已满足', request_changes: '退回修改', confirm: '确认需求并发布基线',
  reject: '否决并结束', escalate: '移交人工处理', retry_review: '退回整改并重新评价',
};
const gateTitles: Record<NonNullable<RunView['gate']>['kind'], string> = {
  clarification: '关键事实澄清',
  discussion: '讨论议题裁决',
  evaluation: '评价风险处置',
  approval: '建设方案审批',
  conditions: '批准条件核验',
  confirmation: '最终需求确认',
  limit: '返工上限处置',
};
const nodeLabels: Record<string, string> = {
  pending: '待执行', ready: '就绪', running: '运行中', succeeded: '已完成', failed: '执行失败',
  skipped: '跳过', waiting_human: '等待人工', rewound: '返工', waived: '已豁免',
};
const verdicts: Record<string, string> = {
  pass: '通过', conditional_pass: '有条件通过', revision_required: '需要返工', escalation: '需要人工介入',
};
const issueLabels: Record<Issue['state'], string> = {
  open: '待讨论', discussing: '讨论中', resolved: '已形成候选方案', blocked: '等待人工裁决', escalated: '已由人工裁决',
};

const blank: StartInput = {
  projectId: '', title: '', ideas: [''], background: '', problem: '', goals: '', constraints: '', preferences: '',
  documents: [], mode: 'live', providerId: '', model: '', roles: rolesDefault, maxDiscussionRounds: 2,
  maxRevisions: 3, parentBaselineId: '',
};
const extraFields = [['background', '背景'], ['problem', '待解决的问题'], ['goals', '预期目标'],
  ['constraints', '已知约束'], ['preferences', '用户偏好']] as const;

function download(markdown: string, name: string): void {
  const url = URL.createObjectURL(new Blob([markdown], {type: 'text/markdown;charset=utf-8'}));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function dataOf<T>(artifacts: Artifact[], kind: string): T | undefined {
  return artifacts.findLast(a => a.kind === kind)?.data as T | undefined;
}
function Details({title, data}: {title: string; data: unknown}) {
  return <details className="hama-details">
    <summary>{title}</summary>
    <pre>{JSON.stringify(data, null, 2)}</pre>
  </details>;
}

function IntakeForm({providers, busy, onStart, history, initial}: {
  providers: readonly ModelProviderConfig[]; busy: boolean; onStart: (input: StartInput) => void;
  history: ApprovedRequirementsBaseline[];
  initial: StartInput | null;
}) {
  const [input, setInput] = useState(initial ?? blank);
  const [ideas, setIdeas] = useState(initial?.ideas.join('\n\n') ?? '');
  const [docs, setDocs] = useState(initial?.documents.map(d => `${d.title}\n${d.content}`).join('\n\n') ?? '');
  const validProviders = providers.filter(p => p.hasApiKey);
  const provider = validProviders.find(p => p.id === input.providerId);
  const set = <K extends keyof StartInput>(key: K, value: StartInput[K]) =>
    setInput(current => ({...current, [key]: value}));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onStart({...input, ideas: ideas.split(/\r?\n\s*\r?\n/).map(s => s.trim()).filter(Boolean),
      documents: docs.trim() ? [{title: '补充资料', content: docs.trim()}] : []});
  };
  const parents = history.filter(row => row.projectId === input.projectId && row.mode === input.mode);
  return <form className="card hama-card hama-stack" onSubmit={submit}>
    <div className="hama-row">
      <h2>创建需求工程运行</h2>
      <button type="button" className="btn" onClick={() => {
        setInput(current => ({...current, ...campusDemo, projectId: 'campus-demo', mode: 'demo', parentBaselineId: ''}));
        setIdeas(campusDemo.ideas.join('\n\n'));
      }}>载入校园演示</button>
    </div>
    <div className="hama-fields">
      <label>项目 ID<input required pattern="[A-Za-z0-9][A-Za-z0-9_\-]*" value={input.projectId}
        onChange={e => setInput(current => ({...current, projectId: e.target.value, parentBaselineId: ''}))} /></label>
      <label>项目名称<input required value={input.title} onChange={e => set('title', e.target.value)} /></label>
      <label>运行模式<select value={input.mode} onChange={e => setInput(current => ({...current,
        mode: e.target.value === 'demo' ? 'demo' : 'live', parentBaselineId: ''}))}>
        <option value="live">真实模型</option><option value="demo">校园演示（模拟 Agent）</option>
      </select></label>
      <label>基线版本来源<select value={input.parentBaselineId} onChange={e => set('parentBaselineId', e.target.value)}>
        <option value="">首次建立基线</option>
        {parents.slice(0, 1).map(b => <option key={b.id} value={b.id}>v{b.revision} · {b.prd.title}</option>)}
      </select></label>
    </div>
    {input.mode === 'live' && <>
      <div className="hama-fields">
        <label>模型提供商<select required value={input.providerId} onChange={e => set('providerId', e.target.value)}>
          <option value="">选择已配置提供商</option>
          {validProviders.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select></label>
        <label>模型 ID<input required value={input.model} onChange={e => set('model', e.target.value)} list="hama-models" />
          <datalist id="hama-models">{provider?.models.map(m => <option key={m.id} value={m.id} />)}</datalist>
        </label>
      </div>
      {validProviders.length === 0 && <p className="hama-muted">请先在「基础设施与模型池」配置模型提供商密钥。</p>}
    </>}
    <label>初始 Idea<textarea required rows={4} value={ideas} onChange={e => setIdeas(e.target.value)}
      placeholder="描述你的想法。多个 Idea 用空行分隔。" /></label>
    <details className="hama-details">
      <summary>背景、补充资料与运行设置</summary>
      <div className="hama-fields">
        {extraFields.map(([key,label]) => <label key={key}>{label}
          <textarea rows={2} value={input[key]} onChange={e => set(key, e.target.value)} /></label>)}
        <label>补充文档内容<textarea rows={2} value={docs} onChange={e => setDocs(e.target.value)} /></label>
        <label>单议题讨论轮次上限<input type="number" min="1" max="5" required value={input.maxDiscussionRounds}
          onChange={e => set('maxDiscussionRounds', e.target.valueAsNumber)} /></label>
        <label>方案及 PRD 返工总上限<input type="number" min="0" max="5" required value={input.maxRevisions}
          onChange={e => set('maxRevisions', e.target.valueAsNumber)} /></label>
      </div>
      <h3>讨论角色</h3>
      {input.roles.map((role, i) => <div className="hama-role" key={i}>
        <label>ID<input aria-label={`角色 ${i + 1} ID`} required value={role.id}
          onChange={e => set('roles', input.roles.map((r, j) => j === i ? {...r, id: e.target.value} : r))} /></label>
        <label>名称<input required value={role.name}
          onChange={e => set('roles', input.roles.map((r, j) => j === i ? {...r, name: e.target.value} : r))} /></label>
        <label>职责<input required value={role.instructions}
          onChange={e => set('roles', input.roles.map((r, j) => j === i ? {...r, instructions: e.target.value} : r))} /></label>
        <button type="button" className="btn" disabled={input.roles.length <= 2}
          onClick={() => set('roles', input.roles.filter((_, j) => j !== i))}>移除</button>
      </div>)}
      <button type="button" className="btn" disabled={input.roles.length >= 10}
        onClick={() => set('roles', [...input.roles, {id: '', name: '', instructions: ''}])}>添加角色</button>
    </details>
    <button type="submit" className="btn btn-primary hama-start" disabled={busy || (input.mode === 'live' && !provider)}>
      启动 HAMA-Loop
    </button>
  </form>;
}

function GateForm({gate, view, disabled, submit}: {
  gate: NonNullable<RunView['gate']>; view: RunView; disabled: boolean; submit: (body: DecisionInput) => void;
}) {
  const [actor, setActor] = useState(view.decisions.at(-1)?.actor ?? '');
  const [action, setAction] = useState<DecisionInput['action'] | ''>('');
  const [feedback, setFeedback] = useState('');
  const [scope, setScope] = useState<DecisionInput['scope']>('local');
  const [issue, setIssue] = useState('');
  const board = dataOf<{issues: Issue[]}>(view.artifacts, 'issue_board');
  const target = view.artifacts.find(a => a.id === gate.target.id);
  const questions = gate.kind === 'clarification' ? (target?.data as {intake: Intake} | undefined)?.intake.questions : undefined;
  const needsFeedback = action !== 'approve' && action !== 'confirm';
  return <form className="card hama-card hama-stack hama-gate" onSubmit={event => {
    event.preventDefault();
    if (action) submit({actor, feedback, action, scope, issueIds: issue ? [issue] : [],
      targetId: gate.target.id, targetHash: gate.target.hash});
  }}>
    <div className="hama-row"><h2>{gateTitles[gate.kind]}</h2><span className="tag tag-amber">v{gate.target.revision}</span></div>
    <p>{gate.question}</p>
    {questions && <ul>{questions.filter(row => row.critical).map(row =>
      <li key={row.id}>{row.question} {row.reason}</li>)}</ul>}
    {gate.kind === 'conditions' && <p>待处理条件：{view.decisions.findLast(d =>
      d.targetId === gate.target.id && d.action === 'conditional_approve')?.feedback}</p>}
    {target && <Details title="查看此审批绑定的工件" data={target.data} />}
    <div className="hama-fields">
      <label>审批人<input required maxLength={120} value={actor} onChange={event => setActor(event.target.value)} /></label>
      <label>决定<select required value={action} onChange={event => setAction(event.target.value as DecisionInput['action'])}>
        <option value="">选择决定</option>
        {gate.options.map(option => <option key={option} value={option}>{labels[option]}</option>)}
      </select></label>
      {gate.kind === 'confirmation' && action === 'request_changes' && <label>变更范围<select value={scope}
        onChange={event => setScope(event.target.value as DecisionInput['scope'])}>
        <option value="local">局部文字或验收</option><option value="proposal">方案方向或重大约束</option>
      </select></label>}
      {((action === 'request_changes' && (gate.kind !== 'confirmation' || scope === 'proposal')) || action === 'retry_review') && board &&
        <label>相关议题<select value={issue} onChange={e => setIssue(e.target.value)}>
          <option value="">使用评价建议或全量讨论</option>
          {board.issues.map(row => <option value={row.id} key={row.id}>{row.title}</option>)}
        </select></label>}
    </div>
    <label>{needsFeedback ? '原因、答复或核验证据' : '审批意见（可选）'}
      <textarea rows={3} value={feedback} required={needsFeedback} maxLength={6000} onChange={e => setFeedback(e.target.value)} />
    </label>
    <button className="btn btn-primary hama-start" disabled={disabled || !action}>记录人工决定</button>
  </form>;
}

function Discussions({artifacts}: {artifacts: Artifact[]}) {
  const board = dataOf<{issues: Issue[]}>(artifacts, 'issue_board');
  if (!board) return null;
  return <section className="card hama-card">
    <h2>议题看板</h2>
    {board.issues.map(issue => <details key={issue.id} className="hama-details">
      <summary>{issue.title} <span className="tag">{issueLabels[issue.state]} · {issue.round} 轮</span></summary>
      <p>责任角色 {issue.owner}{issue.pendingDecisionBy ? ` · 待 ${issue.pendingDecisionBy} 处理` : ''}</p>
      {issue.blockers.length > 0 && <ul>{issue.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul>}
      {artifacts.filter(a => a.subject === issue.id && ['discussion', 'proposal_drafts'].includes(a.kind)).map(a =>
        <Details key={a.id} title={`v${a.revision} · ${a.kind === 'discussion' ? '质疑、共识与取舍' : '各角色提案与修订'}`} data={a.data} />)}
    </details>)}
    <Details title="依赖关系图与冲突" data={dataOf(artifacts, 'dependency_map')} />
  </section>;
}

function Evaluations({artifacts}: {artifacts: Artifact[]}) {
  const proposal = dataOf<Proposal>(artifacts, 'proposal');
  if (!proposal) return null;
  const current = artifacts.findLast(a => a.kind === 'proposal')!;
  const reports = artifacts.filter(a => a.kind === 'evaluation' &&
    (a.data as {proposal: {id: string}}).proposal.id === current.id);
  const report = artifacts.findLast(a => a.kind === 'report' &&
    (a.data as {proposal: {id: string}}).proposal.id === current.id)?.data as {verdict: string} | undefined;
  return <section className="card hama-card">
    <div className="hama-row"><h2>候选方案 v{current.revision}</h2>{report && <span className="tag">{verdicts[report.verdict]}</span>}</div>
    <p>{proposal.summary}</p>
    <Details title="当前方案的范围、技术路径、风险和未决事项" data={proposal} />
    <h3>独立评价</h3>
    {reports.map(a => {
      const dim = dimensions[a.subject as keyof typeof dimensions];
      const review = (a.data as {review: Evaluation}).review;
      return <details className="hama-details" key={a.id}>
        <summary>{dim.name} <span className="tag">{verdicts[review.verdict]}</span></summary>
        <p>{review.summary}</p>
        {review.findings.map((f, i) => <article className="hama-finding" key={i}>
          <strong>{f.problem}</strong> <span className="tag">{f.severity}</span>
          <p>{f.reason}</p><p>证据 {f.evidence.join('、')} · 建议 {f.recommendation}</p>
          {f.owner && <p>责任人 {f.owner} · 核验 {f.verification}</p>}
        </article>)}
      </details>;
    })}
  </section>;
}

export function RequirementsView({lang, providers, workspaces, onOpenWorkflow}: {
  lang: UiLang; providers: readonly ModelProviderConfig[]; workspaces: readonly WorkspaceEntry[];
  onOpenWorkflow: (id: string) => void;
}) {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [id, setId] = useState('');
  const [view, setView] = useState<RunView | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const [history, setHistory] = useState<ApprovedRequirementsBaseline[]>([]);
  const [pendingHamaInput, setPendingHamaInput] = useState<StartInput | null>(null);
  const [targetWorkspace, setTargetWorkspace] = useState('');
  const projectKey = [...new Set(runs.map(run => run.projectId))].sort().join(',');
  const newestBaseline = view?.baseline?.id ?? '';

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const [list, result] = await Promise.all([orchApi.hamaRuns(), id ? orchApi.hamaRun(id) : null]);
        if (active) {
          setRuns(list);
          setView(result);
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    };
    void load();
    const timer = window.setInterval(load, 1500);
    return () => {active = false; window.clearInterval(timer);};
  }, [id]);
  useEffect(() => {
    let active = true;
    void Promise.all(projectKey.split(',').filter(Boolean).map(key => orchApi.hamaBaselines(key)))
      .then(values => {if (active) setHistory(values.flat());})
      .catch(e => {if (active) setError((e as Error).message);});
    return () => {active = false;};
  }, [projectKey, newestBaseline]);

  const action = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const selected = view?.detail.run.id === id ? view : null;
  const run = selected?.detail.run;
  const prd = selected?.baseline?.prd ?? (selected ? dataOf<Prd>(selected.artifacts, 'prd') : undefined);
  // Hide stale drafts while another proposal or PRD revision is under preparation.
  const activePrd = prd && selected && (selected.baseline || selected.detail.nodes.find(n => n.code === 'prd')?.status === 'succeeded') ? prd : undefined;
  const baseline = selected?.baseline;
  const activeNode = selected?.detail.nodes.find(n => n.id === focus)
    ?? selected?.detail.nodes.find(n => ['waiting_human', 'failed', 'running'].includes(n.status));
  return <div className="page-scroll hama-page">
    <header className="hama-row hama-title">
      <div><h1>HAMA-Loop 需求工程</h1><p>从 Idea 出发，协同评审方案与需求，发布正式需求基线。</p></div>
      <button type="button" className="btn" onClick={() => {setPendingHamaInput(null); setId(''); setFocus(null);}} disabled={!id || busy}>新建运行</button>
    </header>
    {error && <div className="error-banner" role="alert">{error}<button className="btn" onClick={() => setError('')}>关闭</button></div>}
    <div className="hama-layout">
      <aside className="card hama-card hama-stack hama-sidebar">
        <h2>需求运行</h2>
        {runs.length === 0 && <p className="hama-muted">暂无需求运行</p>}
        {runs.map(row => <button className={`hama-run ${id === row.id ? 'selected' : ''}`} key={row.id}
          onClick={() => {setId(row.id); setFocus(null); setError('');}} disabled={busy}>
          <strong>{row.title}</strong><small>{row.projectId} · {row.mode === 'demo' ? '演示' : '真实模型'}</small>
          <span className="tag">{formatRunStatus(lang, row.status)}</span>
        </button>)}
      </aside>
      <div className="hama-stack">
        {!id && <IntakeForm providers={providers} busy={busy} history={history} initial={pendingHamaInput} onStart={input => void action(async () => {
          const result = await orchApi.startHamaRun(input);
          setId(result.detail.run.id);
          setView(result);
        })} />}
        {id && !selected && <p className="hama-muted">正在加载运行…</p>}
        {selected && run && <>
          <section className="card hama-card hama-stack">
            <div className="hama-row">
              <div><h2>{selected.input.title}</h2><p className="hama-muted">{run.id} · {selected.input.mode === 'demo' ? '模拟 Agent' : selected.input.model}</p></div>
              <div className="hama-actions">
                <span className="tag">{formatRunStatus(lang, run.status)}</span>
                {run.reworkCount > 0 && <span className="tag tag-amber">返工 {run.reworkCount} 次</span>}
                {['running', 'waiting_human'].includes(run.status) && <button className="btn" disabled={busy}
                  onClick={() => void action(() => orchApi.pauseRun(id))}>暂停</button>}
                {run.status === 'paused' && <button className="btn" disabled={busy}
                  onClick={() => void action(() => orchApi.resumeRun(id))}>恢复</button>}
              </div>
            </div>
            <div className="hama-graph">
              <TwinGraphCanvas nodes={selected.detail.nodes} edges={selected.detail.edges} lang={lang} mode="run"
                selectedNodeId={activeNode?.id ?? null} onSelectNode={setFocus} />
            </div>
            {activeNode && <p className="hama-muted">{activeNode.title} · {nodeLabels[activeNode.status]} · 尝试 {activeNode.attemptCount} 次</p>}
            {selected.detail.nodes.filter(n => n.status === 'failed').map(node => <div className="hama-finding" key={node.id}>
              <p>{node.title} · {node.outputSummary}</p>
              <button className="btn" disabled={busy || run.status !== 'failed'}
                onClick={() => void action(() => orchApi.retryNode(id, node.id))}>重试此节点</button>
            </div>)}
            {run.status === 'failed' && <button className="btn hama-start" disabled={busy}
              onClick={() => void action(() => orchApi.cancelRun(id))}>结束失败运行</button>}
          </section>
          {selected.gate && <GateForm key={selected.gate.id} gate={selected.gate} view={selected} disabled={busy} submit={body => {
            const gate = selected.gate;
            if (gate) void action(async () => setView(await orchApi.decideHamaGate(id, gate.id, body)));
          }} />}
          <Evaluations artifacts={selected.artifacts} />
          <Discussions artifacts={selected.artifacts} />
          {activePrd && <section className="card hama-card hama-stack">
            <div className="hama-row"><h2>{baseline ? `已确认基线 v${baseline.revision}` : `待确认 PRD v${activePrd.revision}`}</h2>
              <button className="btn" onClick={() => download(renderPrd(activePrd, baseline ?? undefined),
                `${baseline?.id ?? `prd-${id}-v${activePrd.revision}`}.md`)}>导出 Markdown</button></div>
            {baseline && <p>由 {baseline.confirmation.actor} 于 {new Date(baseline.confirmation.decidedAt).toLocaleString()} 确认</p>}
            <details className="hama-details"><summary>查看 PRD</summary>
              <pre>{renderPrd(activePrd, baseline ?? undefined)}</pre></details>
            <Details title="需求追踪关系" data={activePrd.trace} />
            {baseline && <Details title="基线版本、摘要与审批记录" data={{
              id: baseline.id, parentId: baseline.parentId, revision: baseline.revision, sha256: baseline.sha256,
              approval: baseline.approval, confirmation: baseline.confirmation,
            }} />}
            {baseline && <DesignStart key={baseline.id} baseline={baseline} workspaces={workspaces} providers={providers} onOpenWorkflow={onOpenWorkflow} onReturnToHama={revision => {
              setPendingHamaInput({...selected.input, projectId: revision.input.baselineRef.projectId,
                title: revision.input.baseline.prd.title, mode: revision.input.baseline.mode, parentBaselineId: revision.input.baselineRef.id,
                ideas: [...selected.input.ideas, ...revision.decisions.filter(d => d.action === 'request_changes' && d.scope === 'requirements')
                  .flatMap(d => d.findings.map(f => `设计评审反馈（待需求确认）：${f.evidence}`))]});
              setId(''); setView(null); setFocus(null); setError('');
            }} />}
            {baseline?.mode === 'live' && <div className="hama-actions">
              <label>下游工作区<select value={targetWorkspace} onChange={event => setTargetWorkspace(event.target.value)}>
                <option value="">选择工作区</option>
                {workspaces.filter(w => w.description !== 'hama-document-workspace').map(w =>
                  <option value={w.id} key={w.id}>{w.name}</option>)}
              </select></label>
              <button className="btn btn-primary" disabled={busy || !targetWorkspace} onClick={() => void action(async () => {
                const workflow = await orchApi.importHamaBaseline({workspaceId: targetWorkspace, baselineId: baseline.id});
                onOpenWorkflow(workflow.goalSpec.workflowId);
              })}>导入下游编排</button>
            </div>}
          </section>}
          <section className="card hama-card">
            <h2>过程与版本记录</h2>
            <Details title="Idea 分解与澄清问题" data={dataOf(selected.artifacts, 'intake')} />
            <Details title="返工、前后版本与重新评价" data={selected.artifacts.filter(a => a.kind.startsWith('rework'))} />
            <Details title="历次候选方案与评价报告" data={selected.artifacts.filter(a => ['proposal', 'report', 'evaluation'].includes(a.kind))} />
            <Details title="人工决定" data={selected.decisions} />
            <Details title="模型调用与技术错误" data={selected.artifacts.filter(a => a.kind === 'model_call')} />
            <Details title="项目基线版本" data={history.filter(b => b.projectId === selected.input.projectId).map(b =>
              ({id: b.id, revision: b.revision, mode: b.mode, sha256: b.sha256, confirmation: b.confirmation}))} />
          </section>
        </>}
      </div>
    </div>
  </div>;
}
