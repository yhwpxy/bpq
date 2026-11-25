import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync, mkdtempDisposableSync, writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {createOrchestratorRuntime} from '../../workflow-orchestrator/src/server/runtime.ts';
import {campusDemo, dimensions, rolesDefault, type ApprovedRequirementsBaseline, type DecisionInput, type RunView, type StartInput} from '../../requirements-engineering/src/contracts.ts';
import type {Operation} from '../../requirements-engineering/src/agents.ts';
import {hash} from '../../requirements-engineering/src/repository.ts';
import type {DesignInputDraft} from '../src/contracts.ts';
import type {DesignGeneration} from '../src/generator.ts';
import type {DesignRevision} from '../src/reviews.ts';
import type {DesignHandoffReceipt} from '../src/handoff.ts';
import {acceptanceCases, designResponse, fixtureCase, requirementsResponse, type AcceptanceCase} from './acceptance-fixtures.ts';

type Runtime = Awaited<ReturnType<typeof createOrchestratorRuntime>>;
interface CoverageRow {
  requirementId: string; scopeKey: string; kind: string; priority: string; dependencies: string[]; constraints: string[];
  moduleIds: string[]; acceptance: Array<{id: string; given: string; when: string; then: string; method: string; expectedEvidence: string}>;
  issueIds: string[]; proposalId: string;
}
interface AcceptanceEvidence {
  caseId: string; baseline: ApprovedRequirementsBaseline; input: DesignInputDraft; generation: DesignGeneration;
  draft: DesignRevision; confirmed: DesignRevision | null; receipt: DesignHandoffReceipt | null; coverage: CoverageRow[];
}
function operationOf(role: string, data: unknown): Operation {
  if (role === 'Idea Decomposition') return 'intake';
  if (role === 'Dependency Analysis') return 'dependencies';
  if (role === 'Moderator') return Object.hasOwn(data as object, 'drafts') ? 'refine' : 'agenda';
  if (role === 'Consensus Agent') return 'integrate';
  if (role === 'Requirements Agent') return 'prd';
  if (Object.values(dimensions).some(d => d.name === role)) return 'evaluate';
  return Object.hasOwn(data as object, 'peers') ? 'critique' : 'propose';
}

test('published PRD → generated design → confirmed revision → real PM receipt across projects and baseline revisions', async () => {
  using temporary = mkdtempDisposableSync(join(tmpdir(), 'design-acceptance-'));
  const dataDir = join(temporary.path, 'host');
  const calls: Array<{role: string; domain: string; baselineId?: string; requestSha256: string}> = [];
  let fixtureError: unknown;
  const model = createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const packet = JSON.parse(Buffer.concat(chunks).toString()) as {model: string; tools?: unknown; messages: Array<{content: string}>};
      assert.equal(req.url, '/v1/chat/completions'); assert.equal(req.headers.authorization, 'Bearer acceptance-local-secret');
      assert.equal(packet.model, 'acceptance-fixture'); assert.equal(packet.tools, undefined);
      const system = packet.messages[0]!.content;
      const data = JSON.parse(packet.messages[1]!.content);
      let value: unknown;
      if (system.includes('你是 Design Agent')) {
        const baseline = data.baseline as ApprovedRequirementsBaseline;
        value = designResponse(baseline, data.workspace);
        calls.push({role: 'design', domain: baseline.projectId, baselineId: baseline.id, requestSha256: hash(data)});
        if (baseline.projectId === 'acceptance-counter') assert.ok(!/校园|报名|分录|汇率/.test(JSON.stringify(data)));
        if (baseline.projectId === 'acceptance-ledger') assert.ok(!/校园|报名|非空行/.test(JSON.stringify(data)));
      } else {
        const role = /^角色：(.+?)。/.exec(system)![1]!;
        const spec = fixtureCase(data.context);
        value = requirementsResponse({operation: operationOf(role, data.context), role, data: data.context}, spec);
        calls.push({role, domain: spec.key, requestSha256: hash(data.context)});
      }
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({choices: [{message: {content: JSON.stringify(value)}}]}));
    } catch (e) {fixtureError = e; res.writeHead(500).end();}
  });
  await new Promise<void>(resolve => model.listen(0, '127.0.0.1', resolve));
  let runtime = await createOrchestratorRuntime({dataDir, seedSample: false});
  const request = async <T>(path: string, body?: unknown, expected = 200): Promise<T> => {
    const result = await fetch(runtime.baseUrl + path, {method: body === undefined ? 'GET' : 'POST',
      headers: {Authorization: `Bearer ${runtime.sessionToken}`, 'Content-Type': 'application/json'}, body: body === undefined ? undefined : JSON.stringify(body)});
    const data = await result.json(); assert.equal(result.status, expected, JSON.stringify(data)); return data as T;
  };
  const wait = async (id: string, ready: (view: RunView) => boolean) => {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const view = await request<RunView>(`/api/hama/runs/${id}`);
      if (ready(view)) return view;
      assert.notEqual(view.detail.run.status, 'failed', JSON.stringify(view.detail.attempts.filter(a => a.status === 'failed')));
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error(`Acceptance timed out waiting for HAMA ${id}`);
  };
  const decide = (view: RunView, action: DecisionInput['action']) => request<RunView>(`/api/hama/runs/${view.detail.run.id}/gates/${view.gate!.id}`, {
    targetId: view.gate!.target.id, targetHash: view.gate!.target.hash, actor: '验收脚本模拟审批人', action, scope: 'local', issueIds: [], feedback: action === 'clarify' ? '复用校园账号' : '',
  });
  const publish = async (spec: AcceptanceCase | null, parentBaselineId = '') => {
    const input: StartInput = spec ? {projectId: spec.projectId, title: spec.title, ideas: [`[${spec.key}] ${spec.goal}。${spec.scopes.map(s => s.description).join('；')}`],
      background: spec.goal, problem: '需要可验证的实现方案', goals: spec.goal, constraints: spec.constraints.join('；'), preferences: '', documents: [],
      mode: 'live', providerId: 'openai', model: 'acceptance-fixture', roles: rolesDefault.slice(0, 2), maxDiscussionRounds: 1, maxRevisions: 2, parentBaselineId}
      : {...campusDemo, projectId: 'acceptance-campus', mode: 'demo', providerId: '', model: '', roles: rolesDefault.slice(0, 2), maxDiscussionRounds: 1, maxRevisions: 2, documents: [], parentBaselineId: ''};
    const started = await request<RunView>('/api/hama/runs', input, 201);
    let view = await wait(started.detail.run.id, v => !!v.gate);
    if (view.gate!.kind === 'clarification') {await decide(view, 'clarify'); view = await wait(started.detail.run.id, v => v.gate?.kind === 'approval');}
    assert.equal(view.gate!.kind, 'approval'); await decide(view, 'approve');
    view = await wait(started.detail.run.id, v => v.gate?.kind === 'confirmation'); await decide(view, 'confirm');
    view = await wait(started.detail.run.id, v => v.detail.run.status === 'succeeded');
    assert.ok(view.baseline); assert.equal(view.baseline.parentId, parentBaselineId || null);
    assert.deepEqual(await request(`/api/hama/baselines/${view.baseline.id}`), view.baseline);
    return view.baseline;
  };
  const repositories = new Map<string, {workspaceId: string; commit: string}>();
  const evidence: AcceptanceEvidence[] = [];
  try {
    const port = (model.address() as {port: number}).port;
    runtime.vault.setApiKey('openai', 'acceptance-local-secret');
    runtime.store.updateProviderBaseUrl('openai', `http://127.0.0.1:${port}/v1`);
    const processBaseline = async (baseline: ApprovedRequirementsBaseline, caseId: string, previous?: DesignRevision): Promise<AcceptanceEvidence> => {
      let repository = repositories.get(baseline.projectId);
      if (!repository) {
        const root = join(temporary.path, baseline.projectId); mkdirSync(root); writeFileSync(join(root, 'README.md'), `# ${baseline.prd.title}\n`);
        const git = (args: string[]) => execFileSync('git', ['-C', root, ...args], {encoding: 'utf8', windowsHide: true}).trim();
        git(['init', '-b', 'main']); git(['add', 'README.md']);
        git(['-c', 'user.name=Acceptance Test', '-c', 'user.email=acceptance@example.test', 'commit', '-m', 'Initial acceptance target']);
        const workspace = runtime.store.createWorkspace({name: baseline.prd.title, rootPath: root, verifyCommand: 'node --test'});
        repository = {workspaceId: workspace.id, commit: git(['rev-parse', 'HEAD'])}; repositories.set(baseline.projectId, repository);
      }
      const input = await request<DesignInputDraft>('/api/designs', {baselineId: baseline.id, workspaceId: repository.workspaceId, sourceCommit: repository.commit}, 201);
      const generation = await request<DesignGeneration>(`/api/designs/${input.designId}/generate`, {expectedHash: input.contentSha256, providerId: 'openai', model: 'acceptance-fixture', feedback: '按本项目原始需求推导具体契约，保留未知项和来源'}, 201);
      assert.equal(generation.status, 'ready'); assert.deepEqual(generation.input.baseline, baseline);
      assert.deepEqual(generation.diagnostics, []);
      const coverage = baseline.prd.requirements.map(r => {
        const trace = generation.body!.trace.find(t => t.requirementId === r.id)!;
        const originalTrace = baseline.prd.trace.find(t => t.requirementId === r.id)!;
        assert.ok(trace.moduleIds.length);
        assert.deepEqual(trace.acceptance.map(a => a.acceptanceId), r.acceptance.map(a => a.id));
        return {requirementId: r.id, scopeKey: r.scopeKey, kind: r.kind, priority: r.priority, dependencies: r.dependencies, constraints: r.constraints,
          moduleIds: trace.moduleIds, acceptance: r.acceptance.map(a => ({...a, ...trace.acceptance.find(v => v.acceptanceId === a.id)!})),
          issueIds: originalTrace.issueIds, proposalId: originalTrace.proposal.id};
      });
      const draft = await request<DesignRevision>(`/api/designs/${input.designId}/revisions`, {generationId: generation.generationId, actor: '验收脚本模拟设计负责人', reason: caseId,
        ...(previous ? {previousDesign: {designId: previous.designId, revision: previous.revision, contentSha256: previous.contentSha256}} : {})}, 201);
      const reviewPath = `/api/designs/${input.designId}/revisions/1/review`;
      if (baseline.mode === 'demo') {
        await request(reviewPath, {expectedHash: draft.contentSha256, actor: '验收脚本模拟评审人', action: 'submit'}, 422);
        await request(`/api/designs/${input.designId}/revisions/1/handoff`, {expectedHash: draft.contentSha256, workspaceId: repository.workspaceId}, 409);
        return {caseId, baseline, input, generation, draft, confirmed: null, receipt: null, coverage};
      }
      await request(reviewPath, {expectedHash: draft.contentSha256, actor: '验收脚本模拟评审人', action: 'submit'});
      const confirmed = await request<DesignRevision>(reviewPath, {expectedHash: draft.contentSha256, actor: '验收脚本模拟评审人', action: 'confirm'});
      const handoffPath = `/api/designs/${input.designId}/revisions/1/handoff`;
      const body = {expectedHash: confirmed.contentSha256, workspaceId: repository.workspaceId};
      const send = async () => {
        const response = await fetch(runtime.baseUrl + handoffPath, {method: 'POST',
          headers: {Authorization: `Bearer ${runtime.sessionToken}`, 'Content-Type': 'application/json'}, body: JSON.stringify(body)});
        return {status: response.status, receipt: await response.json() as DesignHandoffReceipt};
      };
      const results = await Promise.all([send(), send()]);
      assert.deepEqual(results.map(r => r.status).sort(), [200, 201]);
      const receipt = results[0]!.receipt; assert.deepEqual(results[1]!.receipt, receipt);
      assert.equal(receipt.status, 'received', JSON.stringify(receipt.diagnostics)); assert.ok(receipt.pmReportId);
      assert.equal(receipt.workflow!.validation.errorCount, 0, JSON.stringify(receipt.workflow!.validation.issues));
      assert.equal(receipt.workflow!.workflow.status, 'validated');
      assert.equal(receipt.workflow!.goalSpec.rawMarkdown, confirmed.reviewMarkdown);
      assert.equal(receipt.workflow!.pmReport!.workflowId, receipt.workflowId);
      assert.deepEqual(receipt.workflow!.goalSpec.requirements.map(r => r.id), baseline.prd.requirements.map(r => r.id));
      assert.deepEqual(receipt.workflow!.goalSpec.acceptanceCriteria.map(a => [a.id, a.requirementId]), baseline.prd.requirements.flatMap(r => r.acceptance.map(a => [a.id, r.id])));
      const module = confirmed.body.modules[0]!;
      const slice = receipt.workflow!.pmReport!.slices.find(s => module.files.every(f => s.fileScope.includes(f.path)) && module.requirementIds.every(id => s.requirementRefs.includes(id)));
      assert.ok(slice, 'PM slice must preserve a module’s original requirements and target files');
      assert.deepEqual(await request(`/api/workflows/${receipt.workflowId}/design-handoff`), receipt);
      return {caseId, baseline, input, generation, draft, confirmed, receipt, coverage};
    };
    const v1Baseline = await publish(acceptanceCases[0]!);
    const counterV1 = await processBaseline(v1Baseline, 'counter-v1'); evidence.push(counterV1);
    const counterDesign = counterV1.generation.body!;
    assert.ok(counterDesign.inputs.some(s => /UTF-8.*路径/.test(s)));
    assert.ok(counterDesign.modules.some(m => /stdout/.test(m.responsibility) && /stderr/.test(m.responsibility)));
    assert.ok(counterDesign.modules.some(m => /trim/.test(m.responsibility) && /流/.test(m.responsibility)));
    assert.ok(counterDesign.interfaces.some(c => /文件不存在/.test(c.failure) && /非零/.test(c.failure)));
    assert.ok(counterDesign.unresolved.some(u => u.owner && /退出码/.test(u.question)));
    assert.equal(/校园|报名|分录|汇率/.test(JSON.stringify(counterDesign)), false);
    const ledger = await processBaseline(await publish(acceptanceCases[2]!), 'ledger'); evidence.push(ledger);
    assert.ok(ledger.generation.body!.interfaces.some(c => /720.00/.test(c.result) && /7.2000/.test(c.result)));
    assert.ok(ledger.generation.body!.interfaces.some(c => /借贷不平衡/.test(c.failure) && /缺失当日汇率/.test(c.failure) && /不保存部分分录/.test(c.failure)));
    assert.ok(ledger.generation.body!.modules.some(m => /十进制/.test(m.responsibility) && /事务/.test(m.responsibility)));
    const campus = await processBaseline(await publish(null), 'campus-demo'); evidence.push(campus);
    assert.ok(campus.generation.body!.modules.some(m => /360 CSS/.test(m.responsibility)));
    assert.ok(campus.generation.body!.modules.some(m => /原子检查容量/.test(m.responsibility)));
    const v2Baseline = await publish(acceptanceCases[1]!, v1Baseline.id);
    const counterV2 = await processBaseline(v2Baseline, 'counter-v2', counterV1.confirmed!); evidence.push(counterV2);
    assert.equal(v2Baseline.revision, 2);
    assert.deepEqual(v2Baseline.prd.requirements.map(r => r.id), v1Baseline.prd.requirements.map(r => r.id));
    assert.deepEqual(v2Baseline.prd.requirements.flatMap(r => r.acceptance.map(a => a.id)), v1Baseline.prd.requirements.flatMap(r => r.acceptance.map(a => a.id)));
    const countId = v2Baseline.prd.requirements.find(r => r.scopeKey === 'count')!.id;
    const missingAc = v2Baseline.prd.requirements.find(r => r.id === countId)!.acceptance.find(a => a.then.includes('退出码为 2'))!.id;
    assert.deepEqual(counterV2.confirmed!.metadata.baselineDiff!.requirements.changed, [countId]);
    assert.deepEqual(counterV2.confirmed!.metadata.baselineDiff!.acceptance.changed, [missingAc]);
    assert.ok(counterV2.generation.body!.interfaces.some(c => /退出码为 2/.test(c.failure)));
    assert.notEqual(counterV1.confirmed!.contentSha256, counterV2.confirmed!.contentSha256);
    assert.notEqual(counterV1.receipt!.workflowId, counterV2.receipt!.workflowId);
    const baselinePayloads = runtime.store.db.prepare('SELECT COUNT(*) AS count FROM hama_baselines').get()!['count'];
    assert.equal(baselinePayloads, 4); assert.equal(runtime.store.db.prepare('SELECT COUNT(*) AS count FROM design_handoffs').get()!['count'], 3);
    assert.equal(fixtureError, undefined, String(fixtureError));
    assert.ok(calls.some(c => c.domain === 'counter-v1' && c.role === 'Requirements Agent'));
    assert.ok(calls.some(c => c.domain === 'counter-v2' && c.role === 'Requirements Agent'));
    assert.ok(calls.some(c => c.domain === 'ledger' && c.role === 'Requirements Agent'));
    assert.equal(calls.filter(c => c.role === 'design').length, 4);
    const serialize = JSON.stringify(evidence); assert.equal(serialize.includes('acceptance-local-secret'), false);
    await runtime.stop(); runtime = await createOrchestratorRuntime({dataDir, seedSample: false});
    assert.deepEqual(await request(`/api/hama/baselines/${campus.baseline.id}`), campus.baseline);
    assert.deepEqual(await request(`/api/designs/${campus.input.designId}/revisions/1`), campus.draft);
    for (const row of evidence.filter(e => e.confirmed)) {
      assert.deepEqual(await request(`/api/hama/baselines/${row.baseline.id}`), row.baseline);
      assert.deepEqual(await request(`/api/designs/${row.confirmed!.designId}/revisions/1`), {...row.confirmed!,
        handoffs: runtime.store.db.prepare('SELECT * FROM design_handoffs WHERE design_id=? AND revision=1').all(row.confirmed!.designId).map(r => ({...r}))});
      const query = `/api/designs/${row.confirmed!.designId}/revisions/1/handoff?workspaceId=${row.input.workspace.workspaceId}&expectedHash=${row.confirmed!.contentSha256}`;
      assert.deepEqual(await request(query), row.receipt);
      assert.deepEqual(await request(`/api/designs/${row.confirmed!.designId}/revisions/1/handoff`, {workspaceId: row.input.workspace.workspaceId, expectedHash: row.confirmed!.contentSha256}), row.receipt);
    }
    const output = process.env['DESIGN_ACCEPTANCE_EVIDENCE'];
    if (output) {
      mkdirSync(output, {recursive: true});
      for (const row of evidence) writeFileSync(join(output, `${row.caseId}.json`), JSON.stringify(row, null, 2) + '\n');
      const summary = {scope: '真实 HAMA / 设计 / Planner / SQLite / HTTP，本地模型协议夹具与脚本化审批；非在线质量评测', calls,
        rows: evidence.map(row => ({caseId: row.caseId, projectId: row.baseline.projectId, baselineId: row.baseline.id, baselineRevision: row.baseline.revision,
          baselineSha256: row.baseline.sha256, workspaceId: row.input.workspace.workspaceId, sourceCommit: row.input.workspace.sourceCommit,
          designId: row.input.designId, designRevision: row.confirmed?.revision ?? row.draft.revision, designSha256: row.confirmed?.contentSha256 ?? row.draft.contentSha256,
          workflowId: row.receipt?.workflowId ?? null, pmReportId: row.receipt?.pmReportId ?? null, status: row.receipt?.status ?? 'demo_draft_only',
          requirements: row.coverage.length, acceptance: row.coverage.flatMap(r => r.acceptance).length,
          sample: {requirementId: row.coverage[0]!.requirementId, acceptanceId: row.coverage[0]!.acceptance[0]!.id,
            moduleId: row.generation.body!.modules[0]!.id, file: row.generation.body!.modules[0]!.files[0]!.path,
            pmSliceCode: row.receipt?.workflow?.pmReport?.slices.find(s => s.fileScope.includes(row.generation.body!.modules[0]!.files[0]!.path))?.code ?? null},
          evidence: `${row.caseId}.json`}))};
      writeFileSync(join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
      const columns = '| 项目 / PRD 基线版本与摘要 | 工作区 / 目标提交 | Design Spec 修订与摘要 | workflow.id / pmReport.id | 抽查的原始需求与 AC / PM 模块 / 结果 |';
      const rows = summary.rows.map(r => `| ${r.caseId} · ${r.projectId}<br>${r.baselineId} / v${r.baselineRevision}<br>${r.baselineSha256} | ${r.workspaceId}<br>${r.sourceCommit} | ${r.designId} / v${r.designRevision}<br>${r.designSha256} | ${r.workflowId ?? '演练，不创建工作流'}<br>${r.pmReportId ?? '无 PM 回执'} | ${r.sample.requirementId}<br>${r.sample.acceptanceId}<br>${r.sample.moduleId} / ${r.sample.file} / ${r.sample.pmSliceCode ?? '演练草案'}<br>${r.status}；[完整证据](${r.evidence}) |`);
      writeFileSync(join(output, 'summary.md'), ['# 第 6 部分交接验收总表', '', summary.scope, '', columns,
        '| --- | --- | --- | --- | --- |', ...rows, ''].join('\n'));
    }
  } finally {await runtime.stop(); await new Promise<void>(resolve => model.close(() => resolve()));}
});
