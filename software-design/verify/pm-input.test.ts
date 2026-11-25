import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync, mkdtempDisposableSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {hash} from '../../requirements-engineering/src/repository.ts';
import {acceptanceText} from '../../requirements-engineering/src/markdown.ts';
import {createOrchestratorRuntime} from '../../workflow-orchestrator/src/server/runtime.ts';
import {OrchestratorHttpServer} from '../../workflow-orchestrator/src/server/http-router.ts';
import type {WorkflowPlannerEngine} from '../../workflow-orchestrator/src/engines/planner.ts';
import {OrchestratorError} from '../../workflow-orchestrator/src/shared/errors.ts';
import type {Requirement} from '../../requirements-engineering/src/contracts.ts';
import type {DesignGeneration} from '../src/generator.ts';
import {DesignService} from '../src/service.ts';
import {DesignReviewService, revisionHash, type DesignRevision} from '../src/reviews.ts';
import {designBodySchema} from '../src/design-schema.ts';
import {validateDesign} from '../src/design-validation.ts';
import {renderDesign} from '../src/design-render.ts';
import {projectConfirmedDesign, type DesignPmInput} from '../src/pm-input.ts';

const fixture = JSON.parse(readFileSync(new URL('./step2-evidence/service.json', import.meta.url), 'utf8')) as DesignGeneration;
const oldEvidence = JSON.parse(readFileSync(new URL('./step3-evidence.json', import.meta.url), 'utf8')) as {technicalRevision: DesignRevision};

function multiRequirementFixture() {
  const baseline = structuredClone(fixture.input.baseline), body = structuredClone(fixture.body!);
  const original = baseline.prd.requirements[0]!;
  const additional: Requirement[] = [
    {id: 'FR-format-options', scopeKey: 'format-options', kind: 'functional', priority: 'should', title: '输出格式',
      description: '成功时只输出十进制行数和换行', value: '便于脚本消费', dependencies: [original.id], constraints: ['成功输出不带说明前缀'], state: 'baselined',
      acceptance: [{id: 'AC-format-zero', given: '输入为空文件', when: '执行计数', then: '标准输出为 0 和换行'}]},
    {id: 'NFR-bounded-memory', scopeKey: 'bounded-memory', kind: 'nonfunctional', priority: 'could', title: '内存上限',
      description: '流式计数时峰值内存不超过 32 MiB', value: '适应受限环境', dependencies: [], constraints: ['不能一次加载完整文件'], state: 'baselined',
      acceptance: [{id: 'AC-memory-limit', given: '10 MiB 的 UTF-8 文件', when: '采集入口和计数模块的峰值内存', then: '峰值不超过 32 MiB'}]},
  ];
  baseline.id = 'baseline-pm-line-counter'; baseline.prd.requirements.push(...additional);
  const reqs = baseline.prd.requirements;
  baseline.prd.sections.scope = reqs.map(r => ({key: r.scopeKey, kind: r.kind, title: r.title, decision: r.description, issueIds: [`issue-${r.scopeKey}`]}));
  baseline.prd.sections.unresolved = ['后续格式扩展是否需要 JSON（当前范围外）'];
  baseline.prd.proposal.hash = hash(baseline.prd.sections); baseline.approval.targetHash = baseline.prd.proposal.hash;
  baseline.prd.trace = reqs.map(r => ({ideaAndDocumentIds: ['idea-count'], issueIds: [`issue-${r.scopeKey}`], proposal: {...baseline.prd.proposal},
    scopeKey: r.scopeKey, approvalId: baseline.approval.id, requirementId: r.id, acceptanceIds: r.acceptance.map(a => a.id)}));
  baseline.approvedPrd.hash = hash({...baseline.prd, requirements: reqs.map(r => ({...r, state: 'under_review'}))});
  baseline.confirmation.targetHash = baseline.approvedPrd.hash;
  const {sha256: _old, ...content} = baseline; baseline.sha256 = hash(content);
  body.modules.forEach(m => {m.requirementIds = reqs.map(r => r.id);});
  body.trace = reqs.map(r => ({requirementId: r.id, moduleIds: body.modules.map(m => m.id), acceptance: r.acceptance.map(a => ({
    acceptanceId: a.id, method: `准备：${a.given}；执行：${a.when}；对输出和资源记录断言`, expectedEvidence: a.then,
  }))}));
  body.quality = [{requirementId: 'NFR-bounded-memory', moduleIds: body.modules.map(m => m.id), method: '对服务入口和计数逻辑采集峰值内存', passCondition: '不超过 32 MiB'}];
  body.decisions[0]!.requirementIds = reqs.map(r => r.id);
  body.assumptions = [{id: 'preserve-entry', text: '保持现有服务入口调用方式', requirementIds: [original.id], evidence: ['src/service.ts'], verification: '对原入口调用执行回归'}];
  body.unresolved = [{id: 'future-format', question: '后续是否增加 JSON 格式（当前范围外）', owner: '产品负责人', requirementIds: ['FR-format-options'], blocking: false}];
  body.designChecks = [
    {id: 'DC-error-no-partial-output', source: {kind: 'interface', id: 'count-file'}, rationale: '明确读取失败时调用方行为',
      requirementIds: [original.id], moduleIds: ['entry', 'counter'], method: '注入读取失败，核对没有部分统计值', expectedEvidence: '错误路径和非零退出码，无部分计数输出'},
    {id: 'DC-shared-counting', source: {kind: 'decision', id: body.decisions[0]!.id}, rationale: '入口与逻辑分离后的契约回归',
      requirementIds: [original.id, 'FR-format-options'], moduleIds: ['entry', 'counter'], method: '用同一输入分别调用入口和计数逻辑', expectedEvidence: '结果一致，入口仅增加格式化换行'},
    {id: 'DC-memory-observation', source: {kind: 'quality', id: 'NFR-bounded-memory'}, rationale: '覆盖跨模块资源观测',
      requirementIds: ['NFR-bounded-memory'], moduleIds: ['entry', 'counter'], method: '分别采集入口与内部实现的内存记录', expectedEvidence: '观测记录关联同一输入及模块'},
  ];
  return {baseline, body};
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {Object.values(value).forEach(freeze); Object.freeze(value);} return value;
}

test('legacy confirmed snapshots project without changing frozen body, digest or confirmation Markdown', () => {
  const snapshot = freeze(structuredClone(oldEvidence.technicalRevision));
  const projected = projectConfirmedDesign(snapshot, snapshot.contentSha256);
  assert.equal(projected.goalSpec.rawMarkdown, snapshot.reviewMarkdown);
  assert.deepEqual(projected.designChecks, []);
  assert.equal(projected.goalSpec.requirements[0]!.id, snapshot.input.baseline.prd.requirements[0]!.id);
  assert.deepEqual(designBodySchema.parse(snapshot.body), snapshot.body);
});

test('design checks validate their source and ownership; changes require a new confirmed digest', () => {
  const {body} = multiRequirementFixture();
  const input = structuredClone(fixture.input);
  const {baseline} = multiRequirementFixture(); input.baseline = baseline;
  assert.deepEqual(validateDesign(body, input), []);
  const invalid = structuredClone(body); invalid.designChecks![0]!.source.id = 'missing-interface';
  assert.ok(validateDesign(invalid, input).some(d => d.code === 'unknown_check_source'));
  invalid.designChecks![0]!.requirementIds = ['unknown-requirement'];
  assert.ok(validateDesign(invalid, input).some(d => d.code === 'unknown_requirement'));
  invalid.designChecks![1]!.requirementIds = ['NFR-bounded-memory']; invalid.designChecks![1]!.moduleIds = ['missing-module'];
  assert.ok(validateDesign(invalid, input).some(d => d.code === 'check_ownership'));
  assert.throws(() => designBodySchema.parse({...body, designChecks: [{...body.designChecks![0], id: 'AC-forged'}]}), /designChecks/);
  const duplicate = structuredClone(body); duplicate.designChecks!.push(structuredClone(duplicate.designChecks![0]!));
  assert.ok(validateDesign(duplicate, input).some(d => d.path === 'designChecks.id' && d.code === 'duplicate'));
  const wrongModules = structuredClone(body); wrongModules.quality[0]!.moduleIds = ['entry'];
  assert.ok(validateDesign(wrongModules, input).some(d => d.code === 'check_source_modules'));
  const collisionInput = structuredClone(input); collisionInput.baseline.prd.requirements[0]!.acceptance[0]!.id = body.designChecks![0]!.id;
  assert.ok(validateDesign(body, collisionInput).some(d => d.code === 'upstream_ac_collision'));
  const rendered = renderDesign(body, input);
  assert.ok(rendered.reviewMarkdown.includes('DC-error-no-partial-output'));
  const changed = structuredClone(oldEvidence.technicalRevision);
  changed.body.designChecks = body.designChecks;
  assert.notEqual(revisionHash(changed.input, changed.body), changed.contentSha256);
  assert.throws(() => projectConfirmedDesign(changed, changed.contentSha256), /摘要不一致/);
});

test('HTTP PM input preserves original IDs, priority projection, cross-module NFR, contracts and check provenance without creating workflows', async () => {
  using temp = mkdtempDisposableSync(join(tmpdir(), 'design-pm-input-'));
  const work = join(temp.path, 'target'); mkdirSync(work); mkdirSync(join(work, 'src'));
  writeFileSync(join(work, 'src/service.ts'), 'export const count = () => 0;\n');
  const git = (args: string[]) => execFileSync('git', ['-C', work, ...args], {encoding: 'utf8', windowsHide: true}).trim();
  git(['init', '-b', 'main']); git(['add', 'src/service.ts']);
  git(['-c', 'user.name=PM Input Test', '-c', 'user.email=pm-input@example.test', 'commit', '-m', 'Initial service']);
  const runtime = await createOrchestratorRuntime({dataDir: join(temp.path, 'host'), seedSample: false});
  let server: OrchestratorHttpServer | undefined;
  try {
    const {baseline, body} = multiRequirementFixture();
    const workspace = runtime.store.createWorkspace({name: 'PM input target', rootPath: work});
    const designs = new DesignService(runtime.store, {baseline: () => structuredClone(baseline)}, join(temp.path, 'inputs'));
    const reviews = new DesignReviewService(runtime.store.db, designs);
    server = new OrchestratorHttpServer({...runtime, designs, designReviews: reviews}); await server.start(0);
    const input = designs.create({baselineId: baseline.id, workspaceId: workspace.id, sourceCommit: git(['rev-parse', 'HEAD'])});
    const first = reviews.createFromGeneration({...fixture, designId: input.designId, input, body}, {actor: 'Designer', reason: 'PM 输入字段保真联调'});
    const path = `/api/designs/${first.designId}/revisions/1/pm-input`;
    const request = async (query: string, expected: number) => {
      const response = await fetch(server!.getBaseUrl() + path + query, {headers: {Authorization: `Bearer ${server!.getSessionToken()}`}});
      const json = await response.json(); assert.equal(response.status, expected, JSON.stringify(json)); return json as DesignPmInput;
    };
    const query = `?expectedHash=${first.contentSha256}`;
    await request(query, 409); await request('', 400);
    reviews.review(first.designId, 1, {expectedHash: first.contentSha256, actor: 'Reviewer', action: 'submit'});
    await request(query, 409);
    const confirmed = reviews.review(first.designId, 1, {expectedHash: first.contentSha256, actor: 'Reviewer', action: 'confirm'});
    const before = JSON.stringify(confirmed);
    const counts = () => ['workflows', 'design_revisions', 'design_decisions', 'design_handoffs'].map(name => runtime.store.db.prepare(`SELECT COUNT(*) AS count FROM ${name}`).get()!['count']);
    const initialCounts = counts();
    const result = await request(query, 200);
    const compatible: Parameters<WorkflowPlannerEngine['importStructuredRequirements']>[1] = result.goalSpec;
    assert.equal(compatible.rawMarkdown, confirmed.reviewMarkdown);
    assert.equal(compatible.title, confirmed.body.title); assert.equal(compatible.goal, confirmed.body.goal);
    for (const key of ['inputs', 'outputs', 'constraints'] as const) assert.deepEqual(compatible[key], confirmed.body[key]);
    assert.deepEqual(compatible.domainRules, confirmed.body.dataRules);
    assert.deepEqual(compatible.requirementsBaseline, {id: baseline.id, projectId: baseline.projectId, revision: baseline.revision, sha256: baseline.sha256});
    assert.deepEqual(compatible.requirements.map(r => [r.id, r.code]), baseline.prd.requirements.map(r => [r.id, r.id]));
    assert.deepEqual(compatible.requirements.map(r => [r.title, r.description]), baseline.prd.requirements.map(r => [r.title, r.description]));
    assert.deepEqual(compatible.requirements.map(r => r.priority), ['must', 'should', 'should']);
    assert.deepEqual(confirmed.input.baseline.prd.requirements.map(r => r.priority), ['must', 'should', 'could']);
    assert.deepEqual(compatible.acceptanceCriteria, baseline.prd.requirements.flatMap(r => r.acceptance.map(a => ({id: a.id, code: a.id,
      requirementId: r.id, label: acceptanceText(a), verified: false}))));
    assert.ok(compatible.requirements[0]!.verifyHint.includes(baseline.prd.requirements[0]!.acceptance[1]!.id));
    assert.deepEqual(compatible.modules!.map(m => m.relatedFrCodes), confirmed.body.modules.map(m => m.requirementIds));
    confirmed.body.modules.forEach((m, i) => {
      const mapped = compatible.modules![i]!;
      assert.equal(mapped.name, m.name); assert.equal(mapped.layer, m.layer);
      assert.deepEqual(mapped.artifacts, m.files.map(f => f.path));
      assert.ok(mapped.relatedFrCodes.includes('NFR-bounded-memory'));
      for (const api of confirmed.body.interfaces.filter(c => c.provider === m.id || c.consumers.includes(m.id))) {
        for (const field of [api.id, api.provider, ...api.consumers, api.input, api.result, api.failure, api.sideEffects]) assert.ok(mapped.summary.includes(field), field);
        assert.ok(compatible.rawMarkdown.includes(api.id));
      }
      m.dependsOn.forEach(id => {assert.ok(mapped.summary.includes(id)); assert.ok(compatible.rawMarkdown.includes(`"${id}"`));});
    });
    assert.deepEqual(result.moduleDependencies, confirmed.body.modules.map(m => ({moduleId: m.id, dependsOn: m.dependsOn})));
    assert.equal(result.designChecks.length, 3);
    result.designChecks.forEach(c => {
      assert.equal(c.origin, 'design'); assert.equal(c.verified, false); assert.equal(c.designId, confirmed.designId);
      assert.equal(c.revision, confirmed.revision); assert.equal(c.contentSha256, confirmed.contentSha256);
      assert.ok(!compatible.acceptanceCriteria.some(a => a.id === c.id));
      assert.ok(compatible.rawMarkdown.includes(c.id)); assert.ok(compatible.requirements.some(r => r.verifyHint.includes(c.id)));
    });
    assert.ok(compatible.assumptions.some(a => a.id === 'design-assumption-preserve-entry' && a.source === 'doc'));
    assert.ok(compatible.assumptions.some(a => a.id === 'design-unresolved-future-format' && a.source === 'suggested'));
    assert.ok(compatible.assumptions.some(a => a.id === 'hama-unresolved-1' && a.text === baseline.prd.sections.unresolved[0] && a.source === 'suggested'));
    assert.equal('workflowId' in compatible, false); assert.equal('id' in compatible, false); assert.equal('updatedAt' in compatible, false);
    assert.deepEqual(await request(query, 200), result);
    assert.deepEqual(counts(), initialCounts); assert.equal(runtime.store.listWorkflows().length, 0);
    assert.equal(JSON.stringify(reviews.read(first.designId, 1)), before);
    assert.deepEqual(projectConfirmedDesign(freeze(structuredClone(confirmed)), confirmed.contentSha256), result);
    const localProjection = projectConfirmedDesign(confirmed, confirmed.contentSha256);
    (localProjection.goalSpec.inputs as string[]).push('changed-client-copy');
    localProjection.moduleDependencies[0]!.dependsOn.push('changed-client-copy');
    localProjection.designChecks[0]!.requirementIds.push('changed-client-copy');
    assert.equal(JSON.stringify(confirmed), before);
    await request(`?expectedHash=${'0'.repeat(64)}`, 409);
    const tampered = structuredClone(confirmed); tampered.reviewMarkdown += '\n篡改';
    assert.throws(() => projectConfirmedDesign(tampered, tampered.contentSha256), /确认稿/);
    const noConfirmation = structuredClone(confirmed); noConfirmation.decisions = [];
    assert.throws(() => projectConfirmedDesign(noConfirmation, noConfirmation.contentSha256), /缺少/);
    const next = reviews.revise(confirmed.designId, {parentRevision: 1, expectedHash: confirmed.contentSha256, actor: 'Designer', reason: '后续修订', body: confirmed.body});
    assert.equal(next.state, 'draft'); assert.deepEqual(await request(query, 200), projectConfirmedDesign(confirmed, confirmed.contentSha256));
    // Optional checks can be added or removed through new revisions without altering old frozen records.
    const legacyInput = designs.create({baselineId: baseline.id, workspaceId: workspace.id, sourceCommit: git(['rev-parse', 'HEAD'])});
    const legacyBody = structuredClone(confirmed.body); delete legacyBody.designChecks;
    const legacy = reviews.createFromGeneration({...fixture, designId: legacyInput.designId, input: legacyInput, body: legacyBody}, {actor: 'Designer', reason: '旧版正文兼容性'});
    const confirm = (r: DesignRevision) => {
      reviews.review(r.designId, r.revision, {expectedHash: r.contentSha256, actor: 'Reviewer', action: 'submit'});
      return reviews.review(r.designId, r.revision, {expectedHash: r.contentSha256, actor: 'Reviewer', action: 'confirm'});
    };
    const oldConfirmed = confirm(legacy);
    const withChecks = reviews.revise(legacy.designId, {parentRevision: 1, expectedHash: legacy.contentSha256, actor: 'Designer', reason: '补充设计检查', body: confirmed.body});
    assert.ok(withChecks.diff.changedFields.includes('designChecks'));
    assert.equal(withChecks.diff.changes.find(c => c.field === 'designChecks')!.before, null);
    confirm(withChecks);
    const withoutChecks = reviews.revise(legacy.designId, {parentRevision: 2, expectedHash: withChecks.contentSha256, actor: 'Designer', reason: '移除非必要补充检查', body: legacyBody});
    assert.ok(withoutChecks.diff.changedFields.includes('designChecks'));
    assert.equal(withoutChecks.diff.changes.find(c => c.field === 'designChecks')!.after, null);
    assert.deepEqual(reviews.read(legacy.designId, 1), oldConfirmed);
    const evidencePath = process.env['DESIGN_PM_INPUT_EVIDENCE'];
    if (evidencePath) writeFileSync(evidencePath, JSON.stringify({confirmedSnapshot: confirmed, projection: projectConfirmedDesign(confirmed, confirmed.contentSha256)}, null, 2) + '\n');
  } finally {await server?.stop(); await runtime.stop();}
});
