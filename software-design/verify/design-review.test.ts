import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync, mkdtempDisposableSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {hash} from '../../requirements-engineering/src/repository.ts';
import type {ApprovedRequirementsBaseline} from '../../requirements-engineering/src/contracts.ts';
import {OrchestratorStore} from '../../workflow-orchestrator/src/store/database.ts';
import {createOrchestratorRuntime} from '../../workflow-orchestrator/src/server/runtime.ts';
import {OrchestratorHttpServer} from '../../workflow-orchestrator/src/server/http-router.ts';
import type {DesignGeneration} from '../src/generator.ts';
import {DesignGenerator} from '../src/generator.ts';
import {DesignService} from '../src/service.ts';
import {DesignReviewService, revisionHash, type DesignRevision} from '../src/reviews.ts';

const fixture = JSON.parse(readFileSync(new URL('./step2-evidence/service.json', import.meta.url), 'utf8')) as DesignGeneration;
function publishChanged(before: ApprovedRequirementsBaseline) {
  const b = structuredClone(before);
  b.id = `${b.id}-v2`; b.parentId = before.id; b.revision++;
  b.prd.revision++; b.approvedPrd.revision++; b.approvedPrd.id += '-v2';
  b.prd.requirements[0]!.description += '，明确文件不存在时返回错误';
  b.prd.requirements[0]!.acceptance[1]!.then += '并输出路径';
  b.approvedPrd.hash = hash({...b.prd, requirements: b.prd.requirements.map(r => ({...r, state: 'under_review'}))});
  b.confirmation.id += '-v2'; b.confirmation.targetId = b.approvedPrd.id; b.confirmation.targetRevision = b.prd.revision; b.confirmation.targetHash = b.approvedPrd.hash;
  const {sha256: _old, ...content} = b; b.sha256 = hash(content); return b;
}
function setup(root: string) {
  const work = join(root, 'target'); mkdirSync(work);
  mkdirSync(join(work, 'src')); writeFileSync(join(work, 'src/service.ts'), 'export const count = () => 0;\n');
  const git = (args: string[]) => execFileSync('git', ['-C', work, ...args], {encoding: 'utf8', windowsHide: true}).trim();
  git(['init', '-b', 'main']); git(['add', 'src/service.ts']);
  git(['-c', 'user.name=Review Test', '-c', 'user.email=review@example.test', 'commit', '-m', 'Initial service']);
  return {work, commit: git(['rev-parse', 'HEAD'])};
}

test('canonical hash, durable review, technical rework, rollback, immutable history and cross-baseline lineage', () => {
  using temp = mkdtempDisposableSync(join(tmpdir(), 'design-review-'));
  const {work, commit} = setup(temp.path), database = join(temp.path, 'host.sqlite');
  let store = new OrchestratorStore(database);
  try {
  let activeBaseline = structuredClone(fixture.input.baseline);
  const workspace = store.createWorkspace({name: 'Service review target', rootPath: work});
  const makeServices = () => {
    const designs = new DesignService(store, {baseline: () => structuredClone(activeBaseline)}, join(temp.path, 'inputs'));
    return {designs, reviews: new DesignReviewService(store.db, designs)};
  };
  let {designs, reviews} = makeServices();
  const input = designs.create({baselineId: activeBaseline.id, workspaceId: workspace.id, sourceCommit: commit});
  const generation = {...structuredClone(fixture), designId: input.designId, input};
  const first = reviews.createFromGeneration(generation, {actor: 'Designer', reason: '首次保存'});
  assert.equal(first.state, 'draft'); assert.equal(first.parentRevision, null);
  const reordered = Object.fromEntries(Object.entries(first.body).reverse()) as typeof first.body;
  assert.equal(revisionHash(input, reordered), first.contentSha256);
  const changed = structuredClone(first.body); changed.goal += '（补充）';
  assert.notEqual(revisionHash(input, changed), first.contentSha256);
  const otherSource = structuredClone(input); otherSource.baselineRef.revision++;
  assert.notEqual(revisionHash(otherSource, first.body), first.contentSha256);
  const otherCommit = structuredClone(input); otherCommit.workspace.sourceCommit = 'a'.repeat(40);
  assert.notEqual(revisionHash(otherCommit, first.body), first.contentSha256);
  const review = (r: DesignRevision, action: 'submit' | 'confirm' | 'request_changes', extra = {}) => reviews.review(r.designId, r.revision,
    {expectedHash: r.contentSha256, actor: 'Reviewer', action, ...extra});
  const finding = {target: 'interfaces.count-file', severity: 'blocking', evidence: '需要补充错误调用者的返回说明', resolution: ''};
  const inReview = review(first, 'submit', {findings: [finding]});
  store.close(); store = new OrchestratorStore(database); ({designs, reviews} = makeServices());
  assert.deepEqual(reviews.read(first.designId, 1), inReview);
  assert.throws(() => review(first, 'confirm'), /阻断/); // Client omission cannot erase a stored finding.
  assert.throws(() => review(first, 'confirm', {findings: [finding]}), /阻断/);
  assert.equal(reviews.read(first.designId, 1).state, 'in_review');
  assert.throws(() => store.db.prepare('INSERT INTO design_handoffs VALUES (?,?,?,?,?)').run(first.designId, 1, workspace.id, 'missing-workflow', new Date().toISOString()), /confirmed/);
  const rejected = review(first, 'request_changes', {findings: [finding]});
  assert.throws(() => review(first, 'confirm'), /状态已变化/);
  const request = {parentRevision: 1, expectedHash: first.contentSha256, actor: 'Designer', reason: '补充失败路径', body: changed};
  assert.throws(() => reviews.revise(first.designId, request), /逐项记录/);
  const second = reviews.revise(first.designId, {...request, resolutions: rejected.decisions.filter(d => d.findings.some(f => f.severity === 'blocking'))
    .map(d => ({decisionId: d.decisionId, target: finding.target, resolution: '补充错误调用者的可观察结果'}))});
  assert.equal(second.revision, 2); assert.equal(second.parentRevision, 1);
  assert.ok(second.diff.changedFields.includes('goal')); assert.deepEqual(reviews.read(first.designId, 1), rejected);
  assert.throws(() => reviews.revise(first.designId, request), /状态已变化/);
  review(second, 'submit');
  store.db.exec(`CREATE TRIGGER test_design_decision_failure BEFORE INSERT ON design_decisions WHEN NEW.action='confirm'
    BEGIN SELECT RAISE(ABORT, 'injected decision failure'); END;`);
  assert.throws(() => review(second, 'confirm'), /injected decision failure/);
  assert.equal(reviews.read(first.designId, 2).state, 'in_review');
  assert.equal(reviews.read(first.designId, 2).decisions.length, 1);
  store.db.exec('DROP TRIGGER test_design_decision_failure');
  const confirmed = review(second, 'confirm');
  assert.equal(confirmed.state, 'confirmed');
  assert.throws(() => store.db.prepare('INSERT INTO design_handoffs VALUES (?,?,?,?,?)').run(first.designId, 2, workspace.id, 'missing-workflow', new Date().toISOString()), /FOREIGN KEY/);
  const handoffPk = store.db.prepare("PRAGMA table_info('design_handoffs')").all().filter(r => r['pk']).map(r => r['name']);
  assert.deepEqual(handoffPk, ['design_id', 'revision', 'workspace_id']);
  assert.throws(() => store.db.prepare('UPDATE design_revisions SET body_json=? WHERE design_id=? AND revision=2').run('{}', first.designId), /immutable/);
  assert.throws(() => store.db.prepare("UPDATE design_revisions SET state='draft' WHERE design_id=? AND revision=2").run(first.designId), /immutable/);
  assert.throws(() => store.db.prepare('DELETE FROM design_decisions WHERE design_id=?').run(first.designId), /immutable/);
  const third = reviews.revise(first.designId, {parentRevision: 2, expectedHash: confirmed.contentSha256, actor: 'Designer', reason: '需要新的验收口径', body: confirmed.body});
  review(third, 'submit');
  const requirementChange = review(third, 'request_changes', {scope: 'requirements', findings: [{...finding, evidence: '用户改变文件不存在时的验收标准'}]});
  assert.throws(() => reviews.revise(first.designId, {...request, parentRevision: 3, expectedHash: third.contentSha256}), /HAMA/);
  activeBaseline = publishChanged(activeBaseline);
  const newInput = designs.create({baselineId: activeBaseline.id, workspaceId: workspace.id, sourceCommit: commit});
  const newBody = structuredClone(confirmed.body); newBody.trace[0]!.acceptance[1]!.expectedEvidence += '并输出路径';
  const nextSeries = reviews.createFromGeneration({...generation, designId: newInput.designId, input: newInput, body: newBody},
    {actor: 'Designer', reason: 'HAMA 已发布新验收基线', previousDesign: {designId: first.designId, revision: 3, contentSha256: third.contentSha256}});
  assert.equal(nextSeries.revision, 1);
  assert.deepEqual(nextSeries.metadata.baselineDiff?.requirements.changed, [activeBaseline.prd.requirements[0]!.id]);
  assert.deepEqual(nextSeries.metadata.baselineDiff?.acceptance.changed, [activeBaseline.prd.requirements[0]!.acceptance[1]!.id]);
  assert.deepEqual(reviews.read(first.designId, 2), confirmed);
  assert.deepEqual(reviews.read(first.designId, 3), requirementChange);
  const submittedNew = review(nextSeries, 'submit'); const confirmedNew = review(submittedNew, 'confirm');
  const evidence = process.env['DESIGN_REVIEW_EVIDENCE'];
  if (evidence) writeFileSync(evidence, JSON.stringify({first: rejected, technicalRevision: confirmed, returnedToHama: requirementChange,
    newBaselineDesign: confirmedNew}, null, 2) + '\n');
  store.close(); store = new OrchestratorStore(database); ({reviews} = makeServices());
  assert.deepEqual(reviews.read(confirmedNew.designId, 1), confirmedNew);
  assert.equal(reviews.heads().length, 2);
  } finally {store.close();}
});

test('HTTP revisions: adoption, concurrent stale decisions, blockers, concept commit binding and reopening after host restart', async () => {
  using temp = mkdtempDisposableSync(join(tmpdir(), 'design-review-http-'));
  const {work, commit} = setup(temp.path), dataDir = join(temp.path, 'host');
  let runtime = await createOrchestratorRuntime({dataDir, seedSample: false});
  let server: OrchestratorHttpServer;
  let drafts: DesignService;
  let modelContext: {parentBody: unknown; reviewDecisions: unknown; workspace: unknown} | undefined;
  let modelOutput = structuredClone(fixture.body!);
  const attach = async () => {
    drafts = new DesignService(runtime.store, {baseline: () => structuredClone(fixture.input.baseline)}, join(dataDir, 'inputs'));
    const generator = new DesignGenerator(drafts, runtime.store, {invokeCapability: async req => {
      modelContext = JSON.parse(req.userPrompt);
      return {outcome: 'completed', exitCode: 0, finalText: JSON.stringify(modelOutput), modifiedFiles: [],
        inputTokens: 0, cachedTokens: 0, outputTokens: 0, durationSec: 0, errorMessage: ''};
    }}, () => ({providerId: 'fixture', protocol: 'openai-compatible', baseUrl: 'http://127.0.0.1', apiKey: 'fixture'}), join(dataDir, 'generations'));
    const reviews = new DesignReviewService(runtime.store.db, drafts);
    server = new OrchestratorHttpServer({...runtime, designs: drafts, designGenerator: generator, designReviews: reviews}); await server.start(0);
  };
  const request = async (path: string, body?: unknown) => {
    const response = await fetch(server.getBaseUrl() + path, {method: body === undefined ? 'GET' : 'POST',
      headers: {Authorization: `Bearer ${server.getSessionToken()}`, 'Content-Type': 'application/json'}, body: body === undefined ? undefined : JSON.stringify(body)});
    return {status: response.status, body: await response.json() as any};
  };
  try {
    await attach();
    const workspace = runtime.store.createWorkspace({name: 'Service', rootPath: work});
    const input = drafts!.create({baselineId: fixture.input.baseline.id, workspaceId: workspace.id, sourceCommit: commit});
    const dir = join(dataDir, 'generations', input.designId); mkdirSync(dir, {recursive: true});
    writeFileSync(join(dir, `${fixture.generationId}.json`), JSON.stringify({...fixture, designId: input.designId, input}));
    const saved = await request(`/api/designs/${input.designId}/revisions`, {generationId: fixture.generationId, actor: 'Designer', reason: '保存草案'});
    assert.equal(saved.status, 201, JSON.stringify(saved.body));
    const first = saved.body as DesignRevision;
    const route = `/api/designs/${first.designId}/revisions/1/review`;
    assert.equal((await request(route, {expectedHash: '0'.repeat(64), actor: 'Reviewer', action: 'submit'})).status, 409);
    assert.equal((await request(route, {expectedHash: first.contentSha256, actor: '', action: 'submit'})).status, 400);
    assert.equal((await request(route, {expectedHash: first.contentSha256, actor: 'Submitter', action: 'submit'})).status, 200);
    const competing = await Promise.all([
      request(route, {expectedHash: first.contentSha256, actor: 'Reviewer A', action: 'confirm'}),
      request(route, {expectedHash: first.contentSha256, actor: 'Reviewer B', action: 'request_changes', findings: [{target: 'goal', severity: 'blocking', evidence: '技术反馈', resolution: ''}]}),
    ]);
    assert.deepEqual(competing.map(r => r.status).sort(), [200, 409]);
    const conflict = competing.find(r => r.status === 409)!;
    assert.equal(conflict.body.details.current.revision, 1); assert.equal(conflict.body.details.current.contentSha256, first.contentSha256);
    const beforeRestart = (await request(`/api/designs/${first.designId}/revisions/1`)).body;
    await server!.stop(); await runtime.stop(); runtime = await createOrchestratorRuntime({dataDir, seedSample: false}); await attach();
    assert.deepEqual((await request(`/api/designs/${first.designId}/revisions/1`)).body, beforeRestart);
    assert.equal((await request(`/api/designs?baselineId=${input.baselineRef.id}`)).body.length, 1);
    assert.equal((await request(`/api/designs/${first.designId}/revisions`)).body.length, 1);
    assert.equal((await request(`/api/designs/${first.designId}/revisions/999`)).status, 404);
    const conceptualRoot = join(temp.path, 'concept'); mkdirSync(conceptualRoot);
    const conceptWs = runtime.store.createWorkspace({name: 'New project', rootPath: conceptualRoot});
    const concept = drafts!.create({baselineId: fixture.input.baseline.id, workspaceId: conceptWs.id, sourceCommit: null});
    const conceptBody = structuredClone(fixture.body!); conceptBody.modules[0]!.files[0]!.action = 'create';
    const reviews = new DesignReviewService(runtime.store.db, drafts!);
    const draft = reviews.createFromGeneration({...fixture, designId: concept.designId, input: concept, body: conceptBody}, {actor: 'Designer', reason: '概念草案'});
    assert.equal((await request(`/api/designs/${draft.designId}/revisions/1/review`, {expectedHash: draft.contentSha256, actor: 'Reviewer', action: 'submit'})).status, 422);
    const git = (args: string[]) => execFileSync('git', ['-C', conceptualRoot, ...args], {encoding: 'utf8', windowsHide: true}).trim();
    git(['init', '-b', 'main']); git(['-c', 'user.name=Review Test', '-c', 'user.email=review@example.test', 'commit', '--allow-empty', '-m', 'Initial concept project']);
    const bound = await request(`/api/designs/${draft.designId}/revisions`, {parentRevision: 1, expectedHash: draft.contentSha256, actor: 'Designer', reason: '绑定初始提交', body: conceptBody, sourceCommit: git(['rev-parse', 'HEAD'])});
    assert.equal(bound.status, 201, JSON.stringify(bound.body)); assert.equal(bound.body.diff.targetChanged, true);
    assert.equal((await request(`/api/designs/${draft.designId}/revisions/2/review`, {expectedHash: bound.body.contentSha256, actor: 'Reviewer', action: 'submit'})).status, 200);
    const target = 'interfaces.count-file';
    const returned = await request(`/api/designs/${draft.designId}/revisions/2/review`, {expectedHash: bound.body.contentSha256, actor: 'Reviewer', action: 'request_changes',
      findings: [{target, severity: 'blocking', evidence: '补充失败契约', resolution: ''}]});
    modelOutput = structuredClone(conceptBody); modelOutput.interfaces[0]!.failure += '；失败不输出部分统计值';
    const regenerated = await request(`/api/designs/${draft.designId}/revisions`, {parentRevision: 2, expectedHash: bound.body.contentSha256,
      actor: 'Designer', reason: '按评审意见重新生成', providerId: 'fixture', model: 'fixture-model', feedback: '补充失败契约',
      resolutions: [{decisionId: returned.body.decisions.at(-1).decisionId, target, resolution: '在新正文中补充失败行为'}]});
    assert.equal(regenerated.status, 201, JSON.stringify(regenerated.body));
    assert.equal(regenerated.body.revision, 3); assert.ok(regenerated.body.metadata.generationId);
    assert.deepEqual(modelContext!.parentBody, bound.body.body);
    assert.deepEqual(modelContext!.reviewDecisions, returned.body.decisions);
    assert.deepEqual(modelContext!.workspace, bound.body.input.workspace);
    assert.equal(runtime.store.listWorkflows().length, 0);
  } finally {await server!?.stop(); await runtime.stop();}
});
