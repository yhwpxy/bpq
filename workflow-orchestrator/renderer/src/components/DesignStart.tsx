import {useEffect, useState} from 'react';
import type {ApprovedRequirementsBaseline} from '../../../../requirements-engineering/src/contracts.ts';
import type {DesignInputDraft, WorkspaceInventory} from '../../../../software-design/src/contracts.ts';
import type {WorkspaceEntry, ModelProviderConfig} from '../../../src/shared/types';
import type {DesignGeneration} from '../../../../software-design/src/generator.ts';
import {orchApi} from '../api/client';
import {DesignReviewPanel} from './DesignReviewPanel';
import type {DesignRevision} from '../../../../software-design/src/reviews.ts';

export function DesignStart({baseline, workspaces, providers, onReturnToHama, onOpenWorkflow}: {
  baseline: ApprovedRequirementsBaseline; workspaces: readonly WorkspaceEntry[]; providers: readonly ModelProviderConfig[];
  onReturnToHama: (revision: DesignRevision) => void;
  onOpenWorkflow: (id: string) => void;
}) {
  const [workspaceId, setWorkspaceId] = useState('');
  const [inventory, setInventory] = useState<WorkspaceInventory | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<DesignInputDraft | null>(null);
  const [providerId, setProviderId] = useState('');
  const [model, setModel] = useState('');
  const [feedback, setFeedback] = useState('');
  const [generation, setGeneration] = useState<DesignGeneration | null>(null);
  const validProviders = providers.filter(p => p.hasApiKey);
  useEffect(() => {
    let active = true;
    setInventory(null);
    setError('');
    if (workspaceId) void orchApi.designWorkspace(workspaceId).then(value => {
      if (active) setInventory(value);
    }).catch(e => {if (active) setError((e as Error).message);});
    return () => {active = false;};
  }, [workspaceId, refresh]);
  return <div className="hama-stack">
    <h3>生成软件设计</h3>
    <p>来源项目 {baseline.projectId} · 基线 {baseline.id} · v{baseline.revision} · {baseline.sha256}</p>
    <label>目标工程工作区<select value={workspaceId} disabled={busy} onChange={e => {
      setWorkspaceId(e.target.value); setInventory(null); setDraft(null); setGeneration(null);
    }}>
      <option value="">请显式选择目标工程</option>
      {workspaces.filter(w => w.description !== 'hama-document-workspace').map(w =>
        <option key={w.id} value={w.id}>{w.name} · {w.rootPath}</option>)}
    </select></label>
    {inventory && <p>目标提交：{inventory.sourceCommit ?? '尚无提交（概念设计）'} · 已有文件 {inventory.existingPaths.length} 个</p>}
    {baseline.mode === 'demo' && <p>演示基线仅供演练，正式交接需要 live 基线。</p>}
    {inventory?.notes.map(note => <p key={note}>{note}</p>)}
    <div className="hama-actions">
      <button className="btn" disabled={!workspaceId || busy} onClick={() => setRefresh(n => n + 1)}>刷新目标提交</button>
      <button className="btn btn-primary" disabled={busy || !inventory || inventory.workspaceId !== workspaceId}
        onClick={() => {
          if (!inventory) return;
          setBusy(true); setError('');
          void orchApi.createDesign({baselineId: baseline.id, workspaceId, sourceCommit: inventory.sourceCommit})
            .then(value => {setDraft(value); setGeneration(null);}).catch(e => setError((e as Error).message)).finally(() => setBusy(false));
        }}>{busy ? '正在创建设计草案…' : '生成软件设计'}</button>
    </div>
    <p className="hama-muted">先保存基线与工程输入，再选择模型起草设计正文。</p>
    {error && <p role="alert">{error}</p>}
      <label>设计模型提供商<select value={providerId} disabled={busy} onChange={e => {setProviderId(e.target.value); setModel('');}}>
        <option value="">选择已配置提供商</option>
        {validProviders.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}
      </select></label>
      <label>模型 ID<input value={model} disabled={busy} onChange={e => setModel(e.target.value)} list="design-models" />
        <datalist id="design-models">{validProviders.find(p => p.id === providerId)?.models.map(m => <option value={m.id} key={m.id} />)}</datalist>
      </label>
      <label>本次设计反馈<textarea value={feedback} disabled={busy} maxLength={6000} onChange={e => setFeedback(e.target.value)} /></label>
    {draft && <div className="hama-stack" role="status">
      <p>已保存设计输入草案 {draft.designId} · 修订 {draft.revision} · {draft.contentSha256}</p>
      {draft.blockers.map(b => <p key={b}>{b}</p>)}
      <button className="btn btn-primary" disabled={busy || !model.trim() || !validProviders.some(p => p.id === providerId)} onClick={() => {
        setBusy(true); setError(''); setGeneration(null);
        void orchApi.generateDesign(draft.designId, {expectedHash: draft.contentSha256, providerId, model, feedback})
          .then(setGeneration).catch(async e => {
            setError((e as Error).message);
            try {setGeneration((await orchApi.designGenerations(draft.designId)).at(-1) ?? null);} catch { /* keep the original error */ }
          }).finally(() => setBusy(false));
      }}>{busy ? '正在处理…' : '生成正文 / 按反馈重新起草'}</button>
      {generation && <>
        <p>{generation.status === 'ready' ? '设计草案已生成' : '本次生成未通过校验'} · {generation.generationId}</p>
        {generation.diagnostics.map((d, i) => <p key={i}>{d.severity} · {d.path} · {d.message}</p>)}
        {generation.body?.unresolved.map(u => <p key={u.id}>{u.blocking ? '待解决' : '待确认'}：{u.question} · 责任人 {u.owner}</p>)}
        {generation.status === 'ready' && <>
          <p>草案摘要：{generation.contentSha256} · {generation.reviewEligible ? '可供后续评审' : '需先处理概念设计、演练限制或待确认项'}</p>
          <details className="hama-details"><summary>结构化设计正文</summary><pre>{JSON.stringify(generation.body, null, 2)}</pre></details>
          <details className="hama-details"><summary>设计评审稿（含原始追踪编号）</summary><pre>{generation.reviewMarkdown}</pre></details>
          <details className="hama-details"><summary>PM 导入 Markdown 预览</summary><pre>{generation.pmMarkdown}</pre></details>
          <button className="btn" onClick={() => {
            const url = URL.createObjectURL(new Blob([generation.reviewMarkdown], {type: 'text/markdown;charset=utf-8'}));
            const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${generation.generationId}.md`; anchor.click();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}>导出设计评审稿</button>
          <button className="btn" onClick={() => {
            const url = URL.createObjectURL(new Blob([JSON.stringify(generation, null, 2)], {type: 'application/json'}));
            const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${generation.generationId}.json`; anchor.click();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}>导出完整草案记录</button>
        </>}
      </>}
      <details className="hama-details"><summary>基线引用、目标提交与需求 / AC 清单</summary>
        <pre>{JSON.stringify({baselineRef: draft.baselineRef, workspace: draft.workspace,
          requirements: draft.baseline.prd.requirements, trace: draft.baseline.prd.trace}, null, 2)}</pre>
      </details>
      <button className="btn" onClick={() => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(draft, null, 2)], {type: 'application/json'}));
        const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${draft.designId}.json`; anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }}>导出设计输入记录</button>
    </div>}
    <DesignReviewPanel baselineId={baseline.id} generation={generation} onReturnToHama={onReturnToHama} modelSettings={{providerId, model, feedback}} onOpenWorkflow={onOpenWorkflow} />
  </div>;
}
