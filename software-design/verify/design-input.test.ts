import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync, mkdtempDisposableSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import type {ApprovedRequirementsBaseline, Decision, Prd} from '../../requirements-engineering/src/contracts.ts';
import {hash} from '../../requirements-engineering/src/repository.ts';
import {OrchestratorError} from '../../workflow-orchestrator/src/shared/errors.ts';
import {validateBaseline} from '../src/baseline.ts';
import {DesignService} from '../src/service.ts';

function fixture(): ApprovedRequirementsBaseline {
  const sections: Prd['sections'] = {goals: ['统计文本文件非空行数'], summary: '提供命令行统计工具', approach: ['读取文件并计数'],
    scope: [{key: 'count', kind: 'functional', title: '统计非空行', decision: '输出非空行数', issueIds: ['issue-count']}],
    outOfScope: [], constraints: ['仅本地文件'], tradeoffs: [], risks: [], unresolved: [], businessRules: [], externalDependencies: []};
  const proposal = {id: 'proposal-count', kind: 'proposal' as const, revision: 1, hash: hash(sections)};
  const decision = {actor: '测试评审人', scope: 'proposal' as const, issueIds: [], feedback: '',
    gateKind: 'approval' as const, targetRevision: 1, decidedAt: '2026-11-24T00:00:00.000Z'};
  const approval: Decision = {...decision, id: 'approval-count', action: 'approve', targetId: proposal.id, targetHash: proposal.hash};
  const prd: Prd = {title: '非空行统计', revision: 1, proposal, approvalId: approval.id, sections,
    background: '需要快速统计文本', scenarios: ['在终端查看文件行数'], changes: ['首次建立'], requirements: [{
      id: 'FR-count', scopeKey: 'count', kind: 'functional', title: '统计非空行', description: '输入文件路径，输出非空行数',
      value: '减少人工计数', priority: 'must', dependencies: [], constraints: ['空白字符组成的行不计数'], state: 'under_review',
      acceptance: [{id: 'AC-count-normal', given: '文件含两行文本和一行空白', when: '执行计数命令', then: '输出 2'},
        {id: 'AC-count-missing', given: '文件不存在', when: '执行计数命令', then: '报告文件不存在并非零退出'}],
    }], trace: [{ideaAndDocumentIds: ['idea-count'], issueIds: ['issue-count'], proposal, scopeKey: 'count',
      approvalId: approval.id, requirementId: 'FR-count', acceptanceIds: ['AC-count-normal', 'AC-count-missing']}]};
  const approvedPrd = {id: 'prd-count', kind: 'prd' as const, revision: 1, hash: hash(prd)};
  const confirmation: Decision = {...decision, gateKind: 'confirmation', id: 'confirm-count', action: 'confirm',
    targetId: approvedPrd.id, targetHash: approvedPrd.hash};
  const value = {schemaVersion: 1 as const, id: 'baseline-count', projectId: 'line-counter', revision: 1, parentId: null,
    mode: 'live' as const, approvedPrd, approval, confirmation,
    prd: {...prd, requirements: prd.requirements.map(r => ({...r, state: 'baselined' as const}))}};
  return {...value, sha256: hash(value)};
}

test('baseline digest, approval references and AC provenance reject corrupt input', () => {
  const baseline = fixture();
  validateBaseline(baseline, baseline.id);
  for (const mutate of [
    (b: ApprovedRequirementsBaseline) => {b.schemaVersion = 2 as 1;},
    (b: ApprovedRequirementsBaseline) => {b.confirmation.targetId = 'other-prd';},
    (b: ApprovedRequirementsBaseline) => {
      b.prd.trace[0]!.acceptanceIds = ['unknown-ac'];
      b.approvedPrd.hash = hash({...b.prd, requirements: b.prd.requirements.map(r => ({...r, state: 'under_review'}))});
      b.confirmation.targetHash = b.approvedPrd.hash;
    },
    (b: ApprovedRequirementsBaseline) => {b.sha256 = '0'.repeat(64);},
  ]) {
    const changed = structuredClone(baseline); mutate(changed);
    if (changed.sha256 === baseline.sha256) {
      const {sha256: _oldHash, ...content} = changed;
      changed.sha256 = hash(content);
    }
    assert.throws(() => validateBaseline(changed, baseline.id), OrchestratorError);
  }
});

test('committed inventory, conceptual drafts, failures, immutable source facts and recovery', () => {
  using temporary = mkdtempDisposableSync(join(tmpdir(), 'design-input-'));
  const root = temporary.path;
  const git = (args: string[]) => execFileSync('git', ['-C', root, ...args], {encoding: 'utf8', windowsHide: true,
    env: {...process.env, GIT_AUTHOR_DATE: '2026-11-24T00:00:00Z', GIT_COMMITTER_DATE: '2026-11-24T00:00:00Z'}}).trim();
  const baseline = fixture();
  const store = {getWorkspace(id: string) {
    if (!['target', 'document'].includes(id)) throw new OrchestratorError('NOT_FOUND', 'workspaceId unknown', 404);
    return {id, name: 'Line counter', rootPath: root, defaultBranch: 'main', verifyCommand: 'npm test',
      description: id === 'document' ? 'hama-document-workspace' : '', createdAt: ''};
  }};
  const requirements = {baseline(id: string) {
    if (id !== baseline.id) throw new OrchestratorError('NOT_FOUND', 'baselineId unknown', 404);
    return baseline;
  }};
  const draftRoot = join(root, 'drafts');
  const service = new DesignService(store, requirements, draftRoot);
  const input = {baselineId: baseline.id, workspaceId: 'target', sourceCommit: null};
  assert.equal(service.create(input).reviewEligible, false);
  git(['init', '-b', 'main']);
  assert.equal(service.inspectWorkspace('target').sourceCommit, null);
  mkdirSync(join(root, 'src'));
  const manifest = {name: 'line-counter', scripts: {test: 'node --test'}, dependencies: {example: '1.0.0'}};
  writeFileSync(join(root, 'package.json'), JSON.stringify(manifest));
  writeFileSync(join(root, 'src', 'cli.ts'), 'console.log(2);\n');
  git(['add', 'package.json', 'src/cli.ts']);
  git(['-c', 'user.name=Design Test', '-c', 'user.email=design@example.test', 'commit', '-m', 'Initial line counter']);
  const sourceCommit = git(['rev-parse', 'HEAD']);
  writeFileSync(join(root, 'package.json'), '{}'); // The working tree must not leak into the selected revision.
  const draft = service.create({...input, sourceCommit});
  assert.equal(draft.reviewEligible, true);
  assert.deepEqual(draft.workspace.existingPaths, ['package.json', 'src/cli.ts']);
  assert.ok(draft.workspace.entryPoints.includes('src/cli.ts'));
  assert.equal(draft.workspace.dependencies[0]!.version, '1.0.0');
  assert.equal(draft.workspace.manifests[0]!.content, JSON.stringify(manifest));
  assert.ok(draft.workspace.testCommands.some(c => c.command === 'npm run test'));
  assert.deepEqual(draft.baseline, baseline);
  assert.deepEqual(new DesignService(store, requirements, draftRoot).read(draft.designId), draft);
  const ac = draft.baseline.prd.requirements[0]!.acceptance[1]!;
  assert.equal(draft.baseline.prd.trace.find(t => t.acceptanceIds.includes(ac.id))!.proposal.id, 'proposal-count');
  const status = (expected: number) => (e: unknown) => e instanceof OrchestratorError && e.status === expected;
  assert.throws(() => service.create({...input, sourceCommit: '0'.repeat(40)}), status(409));
  assert.throws(() => service.create({...input, baselineId: 'unknown'}), status(404));
  assert.throws(() => service.create({...input, workspaceId: 'unknown'}), status(404));
  assert.throws(() => service.create({...input, workspaceId: 'document'}), status(422));
  assert.throws(() => service.create({...input, sourceCommit: undefined as unknown as null}), status(400));
  const evidence = process.env['DESIGN_INPUT_EVIDENCE'];
  if (evidence) writeFileSync(evidence, JSON.stringify(draft, null, 2) + '\n');
});
