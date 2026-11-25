import {useEffect, useState} from 'react';
import type {DesignRevision, ReviewRequest} from '../../../../software-design/src/reviews.ts';
import type {DesignGeneration} from '../../../../software-design/src/generator.ts';
import type {DesignPmInput} from '../../../../software-design/src/pm-input.ts';
import {orchApi} from '../api/client';
import {DesignHandoffPanel} from './DesignHandoffPanel';

const states = {draft: '草案', in_review: '评审中', changes_requested: '已退回', confirmed: '已确认（正文冻结）'};
export function DesignReviewPanel({baselineId, generation, onReturnToHama, modelSettings, onOpenWorkflow}: {baselineId: string; generation: DesignGeneration | null; onReturnToHama: (revision: DesignRevision) => void; modelSettings: {providerId: string; model: string; feedback: string}; onOpenWorkflow: (id: string) => void}) {
  const [heads, setHeads] = useState<DesignRevision[]>([]);
  const [versions, setVersions] = useState<DesignRevision[]>([]);
  const [current, setCurrent] = useState<DesignRevision | null>(null);
  const [pmInput, setPmInput] = useState<DesignPmInput | null>(null);
  const [actor, setActor] = useState('');
  const [reason, setReason] = useState('');
  const [scope, setScope] = useState<ReviewRequest['scope']>('technical');
  const [findings, setFindings] = useState('[]');
  const [body, setBody] = useState('');
  const [resolutions, setResolutions] = useState('[]');
  const [sourceCommit, setSourceCommit] = useState('');
  const [previousDesign, setPreviousDesign] = useState('');
  const [previousCandidates, setPreviousCandidates] = useState<DesignRevision[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const select = async (id: string, revision?: number) => {
    setPmInput(null);
    const rows = await orchApi.designRevisions(id); setVersions(rows);
    const selected = revision ? rows.find(r => r.revision === revision) : rows.at(-1);
    setCurrent(selected ?? null); setBody(JSON.stringify(selected?.body, null, 2));
    setFindings('[]'); setScope('technical');
    setSourceCommit(selected?.input.workspace.sourceCommit ?? '');
    setResolutions(JSON.stringify(selected?.decisions.flatMap(d => d.findings.filter(f => f.severity === 'blocking' && !f.resolution)
      .map(f => ({decisionId: d.decisionId, target: f.target, resolution: ''}))) ?? [], null, 2));
  };
  const refresh = async () => setHeads(await orchApi.designHeads(baselineId));
  useEffect(() => {
    let active = true;
    void orchApi.designHeads(baselineId).then(rows => {if (active) setHeads(rows);}).catch(e => {if (active) setError((e as Error).message);});
    return () => {active = false;};
  }, [baselineId, generation?.generationId]);
  useEffect(() => {
    let active = true;
    if (generation?.status === 'ready') void orchApi.designHeads().then(rows => {
      if (active) setPreviousCandidates(rows.filter(r => r.input.baselineRef.projectId === generation.input.baselineRef.projectId &&
        r.input.workspace.workspaceId === generation.input.workspace.workspaceId && r.input.baselineRef.revision < generation.input.baselineRef.revision &&
        ['changes_requested', 'confirmed'].includes(r.state)));
    }).catch(e => {if (active) setError((e as Error).message);});
    else setPreviousCandidates([]);
    return () => {active = false;};
  }, [generation?.generationId]);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try {await fn(); await refresh();}
    catch (e) {const error = e as Error & {details?: unknown}; setError(`${error.message}${error.details ? `\n${JSON.stringify(error.details, null, 2)}` : ''}`);}
    finally {setBusy(false);}
  };
  const review = (action: ReviewRequest['action']) => void act(async () => {
    if (!current) return;
    const updated = await orchApi.reviewDesignRevision(current.designId, current.revision,
      {expectedHash: current.contentSha256, actor, action, scope, findings: JSON.parse(findings)});
    await select(updated.designId, updated.revision);
  });
  return <section className="hama-stack">
    <h3>设计修订与评审</h3>
    <label>操作人<input value={actor} maxLength={120} onChange={e => setActor(e.target.value)} disabled={busy} /></label>
    <label>修订原因 / 处理说明<textarea value={reason} maxLength={6000} onChange={e => setReason(e.target.value)} disabled={busy} /></label>
    <label>新基线的来源设计（可选 JSON）<textarea rows={2} value={previousDesign} onChange={e => setPreviousDesign(e.target.value)}
      placeholder={'{"designId":"design-…","revision":1,"contentSha256":"…"}'} disabled={busy} /></label>
    {previousCandidates.length > 0 && <label>选择新基线对应的旧设计<select disabled={busy} defaultValue="" onChange={e => {
      const old = previousCandidates.find(r => r.designId === e.target.value);
      setPreviousDesign(old ? JSON.stringify({designId: old.designId, revision: old.revision, contentSha256: old.contentSha256}) : '');
    }}><option value="">选择来源以保存需求 / AC 版本对比</option>{previousCandidates.map(r => <option value={r.designId} key={r.designId}>
      {r.body.title} · 基线 v{r.input.baselineRef.revision} · 修订 {r.revision} · {r.designId}</option>)}</select></label>}
    {generation?.status === 'ready' && <button className="btn" disabled={busy || !actor.trim() || !reason.trim() || heads.some(h => h.designId === generation.designId)} onClick={() => void act(async () => {
      const saved = await orchApi.createDesignRevision(generation.designId, {generationId: generation.generationId, actor, reason,
        ...(previousDesign.trim() ? {previousDesign: JSON.parse(previousDesign)} : {})});
      await select(saved.designId, saved.revision);
    })}>将本次生成保存为评审修订</button>}
    <div className="hama-actions">
      <label>已保存的设计<select disabled={busy} value={current?.designId ?? ''} onChange={e => {
        const id = e.target.value; if (id) void act(() => select(id)); else {setCurrent(null); setVersions([]);}
      }}><option value="">选择设计（服务重启后可继续）</option>{heads.map(h => <option key={h.designId} value={h.designId}>
        {h.body.title} · {h.input.workspace.name} · {h.designId} · v{h.revision} {states[h.state]}</option>)}</select></label>
      <button className="btn" disabled={busy} onClick={() => void act(async () => {await refresh(); if (current) await select(current.designId);})}>刷新当前版本</button>
    </div>
    {error && <pre role="alert">{error}</pre>}
    {current && <>
      <label>历史修订<select disabled={busy} value={current.revision} onChange={e => void act(() => select(current.designId, Number(e.target.value)))}>
        {versions.map(r => <option key={r.revision} value={r.revision}>v{r.revision} · {states[r.state]}</option>)}
      </select></label>
      <p>{states[current.state]} · {current.designId} / v{current.revision} · {current.contentSha256}</p>
      <p>基线 {current.input.baselineRef.id} · v{current.input.baselineRef.revision} · {current.input.baselineRef.sha256}</p>
      <p>工作区 {current.input.workspace.name} · 提交 {current.input.workspace.sourceCommit ?? '尚无提交（概念设计）'}</p>
      <details className="hama-details"><summary>需求到模块 / AC 追踪</summary><pre>{JSON.stringify(current.body.trace, null, 2)}</pre></details>
      {!!current.body.designChecks?.length && <details className="hama-details"><summary>设计补充检查（非上游 AC）</summary><pre>{JSON.stringify(current.body.designChecks, null, 2)}</pre></details>}
      <details className="hama-details"><summary>未决项与校验</summary><pre>{JSON.stringify({unresolved: current.body.unresolved, diagnostics: current.diagnostics}, null, 2)}</pre></details>
      <details className="hama-details"><summary>与父修订的差异 / 新基线对比</summary><pre>{JSON.stringify({diff: current.diff, metadata: current.metadata}, null, 2)}</pre></details>
      <details className="hama-details"><summary>此修订的决定记录</summary><pre>{JSON.stringify(current.decisions, null, 2)}</pre></details>
      <details className="hama-details"><summary>此修订评审稿</summary><pre>{current.reviewMarkdown}</pre></details>
      {current.state === 'confirmed' && <>
        <DesignHandoffPanel key={`${current.designId}-${current.revision}-${current.contentSha256}`} snapshot={current} onOpenWorkflow={onOpenWorkflow} />
        <button className="btn" disabled={busy} onClick={() => void act(async () => setPmInput(await orchApi.designPmInput(current.designId, current.revision, current.contentSha256)))}>查看结构化 PM 输入</button>
        {pmInput && <>
          <p>来源：{pmInput.designRef.designId} / v{pmInput.designRef.revision} · {pmInput.designRef.contentSha256}</p>
          <details className="hama-details"><summary>原始需求 / AC 与 PM 字段</summary><pre>{JSON.stringify(pmInput.goalSpec, null, 2)}</pre></details>
          <details className="hama-details"><summary>设计补充检查及模块依赖</summary><pre>{JSON.stringify({designChecks: pmInput.designChecks, moduleDependencies: pmInput.moduleDependencies}, null, 2)}</pre></details>
          <button className="btn" onClick={() => {
            const url = URL.createObjectURL(new Blob([JSON.stringify(pmInput, null, 2)], {type: 'application/json'}));
            const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${pmInput.designRef.designId}-v${pmInput.designRef.revision}-pm-input.json`; anchor.click();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}>导出结构化 PM 输入</button>
        </>}
      </>}
      <label>反馈范围<select value={scope} disabled={busy} onChange={e => setScope(e.target.value as ReviewRequest['scope'])}>
        <option value="technical">技术方案（同基线修订）</option><option value="requirements">用户目标 / 验收标准（返回 HAMA）</option>
      </select></label>
      <label>逐项评审意见（JSON）<textarea rows={5} value={findings} disabled={busy} onChange={e => setFindings(e.target.value)}
        placeholder={'[{"target":"interfaces.count","severity":"blocking","evidence":"缺少失败语义","resolution":""}]'} /></label>
      <div className="hama-actions">
        <button className="btn" disabled={busy || !actor.trim() || current.state !== 'draft'} onClick={() => review('submit')}>提交评审</button>
        <button className="btn" disabled={busy || !actor.trim() || current.state !== 'in_review'} onClick={() => review('request_changes')}>退回修改</button>
        <button className="btn btn-primary" disabled={busy || !actor.trim() || current.state !== 'in_review'} onClick={() => review('confirm')}>确认并冻结正文</button>
      </div>
      {current.decisions.some(d => d.action === 'request_changes' && d.scope === 'requirements') && <>
        <p>此变更涉及需求范围。新基线发布后启动新设计，并填写上方来源设计引用以保留对比关系。</p>
        <button className="btn" disabled={busy} onClick={() => onReturnToHama(current)}>返回 HAMA 填写需求变更</button>
      </>}
      <details className="hama-details"><summary>追加技术修订 / 为概念设计绑定初始提交</summary>
        <p>填写新的完整正文及阻断意见处理结果。确认版和退回版保持原样。</p>
        {generation?.status === 'ready' && generation.designId === current.designId && <button className="btn" disabled={busy} onClick={() => setBody(JSON.stringify(generation.body, null, 2))}>使用本次生成的正文</button>}
        <label>新正文（JSON）<textarea rows={14} value={body} disabled={busy} onChange={e => setBody(e.target.value)} /></label>
        <label>目标提交（变更时请先核对工程当前提交）<input value={sourceCommit} disabled={busy} onChange={e => setSourceCommit(e.target.value)} /></label>
        <label>逐项处理结果（JSON）<textarea rows={4} value={resolutions} disabled={busy} onChange={e => setResolutions(e.target.value)} /></label>
        <button className="btn" disabled={busy || !actor.trim() || !reason.trim() || current.state === 'in_review'} onClick={() => void act(async () => {
          const saved = await orchApi.createDesignRevision(current.designId, {parentRevision: current.revision, expectedHash: current.contentSha256,
            actor, reason, body: JSON.parse(body), resolutions: JSON.parse(resolutions),
            ...(sourceCommit !== current.input.workspace.sourceCommit && sourceCommit.trim() ? {sourceCommit} : {})});
          await select(saved.designId, saved.revision);
        })}>保存下一修订</button>
        <button className="btn" disabled={busy || !actor.trim() || !reason.trim() || !modelSettings.providerId || !modelSettings.model.trim() || current.state === 'in_review'} onClick={() => void act(async () => {
          const saved = await orchApi.createDesignRevision(current.designId, {parentRevision: current.revision, expectedHash: current.contentSha256,
            actor, reason, ...modelSettings, feedback: modelSettings.feedback || reason, resolutions: JSON.parse(resolutions),
            ...(sourceCommit !== current.input.workspace.sourceCommit && sourceCommit.trim() ? {sourceCommit} : {})});
          await select(saved.designId, saved.revision);
        })}>按本修订反馈生成并保存下一修订</button>
      </details>
    </>}
  </section>;
}
