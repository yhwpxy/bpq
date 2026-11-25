import {useEffect, useState} from 'react';
import type {DesignRevision} from '../../../../software-design/src/reviews.ts';
import type {DesignHandoffReceipt} from '../../../../software-design/src/handoff.ts';
import {orchApi} from '../api/client';

export function DesignHandoffPanel({snapshot, onOpenWorkflow}: {snapshot: DesignRevision; onOpenWorkflow: (id: string) => void}) {
  const [receipt, setReceipt] = useState<DesignHandoffReceipt | null>(null);
  const [knownAbsent, setKnownAbsent] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const {designId, revision, contentSha256} = snapshot;
  const workspaceId = snapshot.input.workspace.workspaceId;
  const query = () => orchApi.designHandoff(designId, revision, workspaceId, contentSha256);
  const errorText = (e: unknown) => {
    const err = e as Error & {details?: unknown};
    return `${err.message}${err.details ? `\n${JSON.stringify(err.details, null, 2)}` : ''}`;
  };
  useEffect(() => {
    let active = true;
    void query().then(value => {if (active) setReceipt(value);}).catch(e => {
      if (!active) return;
      if (e.status === 404) setKnownAbsent(true); else setError(errorText(e));
    }).finally(() => {if (active) setBusy(false);});
    return () => {active = false;};
  }, [designId, revision, contentSha256]);
  const submit = async () => {
    setBusy(true); setError('');
    try {
      const value = await orchApi.handoffDesign(designId, revision, {workspaceId, expectedHash: contentSha256});
      setReceipt(value); setKnownAbsent(false);
      if (value.status === 'received') onOpenWorkflow(value.workflowId);
    } catch (e) {
      setError(errorText(e));
      // A lost response or server error may follow a successful commit. Always recover by the original key.
      if (!(e as {status?: number}).status || (e as {status: number}).status >= 500) {
        try {
          const value = await query(); setReceipt(value); setKnownAbsent(false);
          setError('已按原交接键找回结果。');
          if (value.status === 'received') onOpenWorkflow(value.workflowId);
        } catch (lookupError) {setKnownAbsent((lookupError as {status?: number}).status === 404);}
      }
    } finally {setBusy(false);}
  };
  return <div className="hama-stack">
    <h4>交接现有 PM Agent</h4>
    <p>目标：{snapshot.input.workspace.name} · {workspaceId} · {snapshot.input.workspace.sourceCommit}</p>
    {error && <pre role="alert">{error}</pre>}
    <div className="hama-actions">
      {!receipt && <button className="btn btn-primary" disabled={busy || !knownAbsent} onClick={() => void submit()}>交接 PM 并打开工作流</button>}
      <button className="btn" disabled={busy} onClick={() => {
        setBusy(true); setError('');
        void query().then(value => {setReceipt(value); setKnownAbsent(false);}).catch(e => {
          if (e.status === 404) {setKnownAbsent(true); setError('尚无交接记录，可提交本次确认设计。');}
          else setError(errorText(e));
        }).finally(() => setBusy(false));
      }}>按原键查询交接</button>
    </div>
    {receipt && <>
      <p>{receipt.status === 'received' ? 'PM 已签收' : '交接待核查'} · 工作流 {receipt.workflowId} · 报告 {receipt.pmReportId ?? '待核对'}</p>
      {receipt.diagnostics.map((d, i) => <p key={i}>{d.path} · {d.message}</p>)}
      {receipt.workflow && <p>工作流状态 {receipt.workflow.workflow.status} · 校验阻断 {receipt.workflow.validation.errorCount} 项、警告 {receipt.workflow.validation.warningCount} 项</p>}
      <details className="hama-details"><summary>交接回执、PM 报告与校验诊断</summary><pre>{JSON.stringify(receipt, null, 2)}</pre></details>
      <button className="btn" disabled={busy} onClick={() => onOpenWorkflow(receipt.workflowId)}>打开此工作流</button>
    </>}
  </div>;
}
