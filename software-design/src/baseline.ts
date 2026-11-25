import type {ApprovedRequirementsBaseline} from '../../requirements-engineering/src/contracts.ts';
import {hash} from '../../requirements-engineering/src/repository.ts';
import {OrchestratorError} from '../../workflow-orchestrator/src/shared/errors.ts';

/** Validate the published envelope and its referential integrity without rewriting source text. */
export function validateBaseline(b: ApprovedRequirementsBaseline, requestedId: string): void {
  const check = (ok: unknown, field: string) => {
    if (!ok) throw new OrchestratorError('VALIDATION_ERROR', `基线 ${field} 无效，请在需求工程重新核对已发布版本`, 422, {field, baselineId: requestedId});
  };
  try {
    check(b.schemaVersion === 1, 'schemaVersion');
    check(b.id === requestedId && /^[\w-]+$/.test(b.id), 'id');
    check(typeof b.projectId === 'string' && /^[\w-]+$/.test(b.projectId), 'projectId');
    check(Number.isInteger(b.revision) && b.revision > 0, 'revision');
    check(b.mode === 'live' || b.mode === 'demo', 'mode');
    const {sha256, ...content} = b;
    check(/^[a-f0-9]{64}$/.test(sha256) && hash(content) === sha256, 'sha256');
    const p = b.prd;
    check(hash(p.sections) === p.proposal.hash, 'prd.sections/proposal.hash');
    check(hash({...p, requirements: p.requirements.map(r => ({...r, state: 'under_review'}))}) === b.approvedPrd.hash, 'approvedPrd.hash');
    check(b.approvedPrd.kind === 'prd' && b.approvedPrd.revision === p.revision, 'approvedPrd');
    check(b.confirmation.action === 'confirm' && b.confirmation.targetId === b.approvedPrd.id &&
      b.confirmation.targetHash === b.approvedPrd.hash && b.confirmation.targetRevision === p.revision &&
      b.confirmation.actor && b.confirmation.decidedAt, 'confirmation');
    check(b.approval.id === p.approvalId && b.approval.targetId === p.proposal.id &&
      b.approval.targetHash === p.proposal.hash && b.approval.targetRevision === p.proposal.revision &&
      ['approve', 'release_conditions'].includes(b.approval.action), 'approval');
    if (b.conditionalApproval) {
      check(b.conditionalApproval.action === 'conditional_approve' &&
        b.conditionalApproval.targetId === p.proposal.id && b.conditionalApproval.targetHash === p.proposal.hash &&
        b.approval.action === 'release_conditions', 'conditionalApproval');
    }
    check(b.approval.action !== 'release_conditions' || b.conditionalApproval, 'conditionalApproval');
    check(Array.isArray(p.sections.scope) && p.sections.scope.length && Array.isArray(p.sections.goals), 'prd.sections');
    check(Array.isArray(p.requirements) && p.requirements.length && Array.isArray(p.trace), 'prd.requirements/trace');
    const ids = new Set(p.requirements.map(r => r.id));
    const acIds = new Set<string>();
    check(ids.size === p.requirements.length && p.trace.length === p.requirements.length, 'prd.requirements.id/trace');
    for (const r of p.requirements) {
      const scope = p.sections.scope.find(s => s.key === r.scopeKey);
      check(scope && scope.kind === r.kind && ['functional', 'nonfunctional'].includes(r.kind), `${r.id}.scopeKey/kind`);
      check(['must', 'should', 'could'].includes(r.priority) && r.state === 'baselined' && r.description, `${r.id}.priority/state`);
      check(Array.isArray(r.constraints) && r.constraints.every(c => typeof c === 'string') &&
        Array.isArray(r.dependencies) && r.dependencies.every(id => ids.has(id)), `${r.id}.dependencies/constraints`);
      check(Array.isArray(r.acceptance) && r.acceptance.length, `${r.id}.acceptance`);
      for (const a of r.acceptance) {
        check(a.id && !acIds.has(a.id) && a.given && a.when && a.then, `${r.id}.acceptance.${a.id}`);
        acIds.add(a.id);
      }
      const traces = p.trace.filter(t => t.requirementId === r.id);
      const t = traces[0];
      check(traces.length === 1 && t && t.scopeKey === r.scopeKey && t.approvalId === b.approval.id &&
        hash(t.proposal) === hash(p.proposal) && t.issueIds.length && t.ideaAndDocumentIds.length &&
        t.issueIds.every(id => scope!.issueIds.includes(id)) &&
        t.acceptanceIds.length === r.acceptance.length && new Set(t.acceptanceIds).size === r.acceptance.length &&
        r.acceptance.every(a => t.acceptanceIds.includes(a.id)), `${r.id}.trace`);
    }
  } catch (error) {
    if (error instanceof OrchestratorError) throw error;
    throw new OrchestratorError('VALIDATION_ERROR', '基线结构不完整，请修正 baselineId 对应的已发布数据', 422, {field: 'baselineId'});
  }
}
