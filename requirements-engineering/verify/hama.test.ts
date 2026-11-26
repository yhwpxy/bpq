import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync, mkdtempDisposableSync} from 'node:fs';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {createOrchestratorRuntime} from '../../workflow-orchestrator/src/server/runtime.ts';
import type {WorkflowDetailSnapshot} from '../../workflow-orchestrator/src/shared/api.ts';
import {campusDemo, dimensions, rolesDefault, type DecisionInput, type Prd, type RunView, type StartInput} from '../src/contracts.ts';
import type {AgentRequest, Operation} from '../src/agents.ts';
import {campusResponder} from '../src/demo.ts';
import {renderPrd} from '../src/markdown.ts';
import {hash} from '../src/repository.ts';
import type {DesignInputDraft, WorkspaceInventory} from '../../software-design/src/contracts.ts';

type Runtime = Awaited<ReturnType<typeof createOrchestratorRuntime>>;
const input: StartInput = {...campusDemo, projectId: 'campus', documents: [], mode: 'demo', providerId: '', model: '',
  parentBaselineId: '', roles: rolesDefault, maxDiscussionRounds: 2, maxRevisions: 4};

async function request<T>(r: Runtime, path: string, body?: unknown, expected = 200): Promise<T> {
  const response = await fetch(r.baseUrl + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {Authorization: `Bearer ${r.sessionToken}`, 'Content-Type': 'application/json'},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  assert.equal(response.status, expected, JSON.stringify(result));
  return result as T;
}

async function wait(r: Runtime, id: string, isReady: (view: RunView) => boolean): Promise<RunView> {
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    const view = await request<RunView>(r, '/api/hama/runs/' + id);
    if (isReady(view)) return view;
    assert.notEqual(view.detail.run.status, 'failed', JSON.stringify(view.detail.attempts.filter(a => a.status === 'failed')));
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('HAMA-Loop wait timed out');
}

function decide(r: Runtime, view: RunView, action: DecisionInput['action'], feedback = '', scope: DecisionInput['scope'] = 'local', expected = 200,
  overrides: Partial<DecisionInput> = {}) {
  const gate = view.gate!;
  return request<RunView>(r, `/api/hama/runs/${view.detail.run.id}/gates/${gate.id}`, {
    targetId: gate.target.id, targetHash: gate.target.hash, actor: '课程演示负责人', action,
    feedback, scope, issueIds: [], ...overrides,
  }, expected);
}

function prd(view: RunView): Prd {
  return view.artifacts.findLast(a => a.kind === 'prd')!.data as Prd;
}

test('demo requires human gates, resumes after restart, and publishes immutable versions', async () => {
  const temporary = mkdtempDisposableSync(join(tmpdir(), 'hama-demo-'));
  const dataDir = temporary.path;
  let runtime = await createOrchestratorRuntime({dataDir, seedSample: false});
  try {
    const started = await request<RunView>(runtime, '/api/hama/runs', input, 201);
    const id = started.detail.run.id;
    const clarify = await wait(runtime, id, v => v.gate?.kind === 'clarification');
    assert.ok(existsSync(clarify.detail.run.worktreePath));
    assert.equal(clarify.detail.run.gitBranch, '');
    assert.ok(!existsSync(join(clarify.detail.run.worktreePath, '.git')));
    assert.equal(clarify.detail.checkpoints.length, 0);
    await decide(runtime, clarify, 'clarify', '复用已有校园账号。');
    const approval = await wait(runtime, id, v => v.gate?.kind === 'approval');
    assert.equal(approval.artifacts.filter(a => a.kind === 'evaluation').length, 4);
    assert.equal(approval.artifacts.some(a => a.kind === 'prd'), false);
    await request(runtime, `/api/interventions/${approval.gate!.id}/resolve`, {action: 'approve', resolution: 'bypass'}, 403);
    await request(runtime, '/api/runs', {workflowId: approval.detail.run.workflowId}, 403);
    await decide(runtime, approval, 'approve', '', 'local', 409, {targetHash: '0'.repeat(64)});
    await runtime.stop();
    runtime = await createOrchestratorRuntime({dataDir, seedSample: false});
    const resumed = await wait(runtime, id, v => v.gate?.kind === 'approval');
    assert.equal(resumed.gate?.id, approval.gate?.id);
    let view = await decide(runtime, resumed, 'conditional_approve', '验证账号复用范围');
    assert.equal(view.gate?.kind, 'conditions');
    assert.equal(view.gate?.target.id, approval.gate?.target.id);
    await decide(runtime, view, 'release_conditions', '负责人已确认复用已有登录。');
    view = await wait(runtime, id, v => v.gate?.kind === 'confirmation');
    assert.equal(view.baseline, null);
    const firstPrd = prd(view);
    await decide(runtime, view, 'request_changes', '把成功验收结果写清楚');
    const edited = await wait(runtime, id, v => v.gate?.kind === 'confirmation' && v.gate.id !== view.gate?.id);
    assert.equal(prd(edited).revision, 2);
    assert.deepEqual(prd(edited).requirements.map(r => r.id), firstPrd.requirements.map(r => r.id));
    assert.deepEqual(prd(edited).requirements.flatMap(r => r.acceptance.map(a => a.id)),
      firstPrd.requirements.flatMap(r => r.acceptance.map(a => a.id)));
    assert.equal(prd(edited).approvalId, firstPrd.approvalId);
    await decide(runtime, view, 'confirm', '', 'local', 409);
    await decide(runtime, edited, 'confirm');
    await decide(runtime, edited, 'confirm');
    const finished = await wait(runtime, id, v => v.detail.run.status === 'succeeded');
    const baseline = finished.baseline!;
    const {sha256, ...content} = baseline;
    assert.equal(sha256, hash(content));
    assert.equal(finished.decisions.filter(d => d.action === 'confirm').length, 1);
    for (const req of baseline.prd.requirements) {
      assert.equal(req.state, 'baselined');
      const markdown = renderPrd(baseline.prd, baseline);
      assert.ok(markdown.includes(req.id) && req.acceptance.every(a => markdown.includes(a.id)));
    }
    assert.throws(() => runtime.store.db.prepare('UPDATE hama_baselines SET payload=? WHERE id=?')
      .run('{}', baseline.id), /immutable/);
    const demoTarget = runtime.store.createWorkspace({name: 'Demo design target', rootPath: dataDir});
    const demoDesign = await request<DesignInputDraft>(runtime, '/api/designs',
      {baselineId: baseline.id, workspaceId: demoTarget.id, sourceCommit: null}, 201);
    assert.equal(demoDesign.reviewEligible, false);
    assert.ok(demoDesign.blockers.some(b => b.includes('演示基线')));
    assert.deepEqual(demoDesign.baseline.conditionalApproval, baseline.conditionalApproval);
    await request(runtime, '/api/workflows/import-requirements', {baselineId: baseline.id, workspaceId: 'any'}, 409);
    await request(runtime, '/api/hama/runs', input, 409);
    const next = await request<RunView>(runtime, '/api/hama/runs', {...input, parentBaselineId: baseline.id}, 201);
    const nextId = next.detail.run.id;
    await decide(runtime, await wait(runtime, nextId, v => v.gate?.kind === 'clarification'), 'clarify', '沿用校园账号');
    await decide(runtime, await wait(runtime, nextId, v => v.gate?.kind === 'approval'), 'approve');
    await decide(runtime, await wait(runtime, nextId, v => v.gate?.kind === 'confirmation'), 'confirm');
    const revised = await wait(runtime, nextId, v => v.detail.run.status === 'succeeded');
    assert.equal(revised.baseline?.revision, 2);
    assert.equal(revised.baseline?.parentId, baseline.id);
    assert.deepEqual(await request(runtime, `/api/hama/baselines/${baseline.id}`), baseline);
  } finally {
    await runtime.stop();
    temporary.remove();
  }
});

function identify(role: string, data: Record<string, unknown>): Operation {
  if (role === 'Idea Decomposition') return 'intake';
  if (role === 'Dependency Analysis') return 'dependencies';
  if (role === 'Moderator') return 'drafts' in data ? 'refine' : 'agenda';
  if (role === 'Consensus Agent') return 'integrate';
  if (role === 'Requirements Agent') return 'prd';
  if (Object.values(dimensions).some(d => d.name === role)) return 'evaluate';
  return 'peers' in data ? 'critique' : 'propose';
}

function finding(severity: string) {
  return {severity, category: 'technical', problem: '容量并发待核实', reason: '关键边界缺少充分证明',
    evidence: ['idea-1'], issueIds: ['issue-capacity'], recommendation: '细化末席并发策略',
    owner: '技术负责人', verification: '同时提交两笔末席报名只有一笔成功'};
}

test('agent output failures expose validation details and corrected retries can continue', async t => {
  for (const scenario of [
    {name: 'agenda', detail: 'baseId 必须逐一覆盖'},
    {name: 'critique', detail: '质疑目标必须是其他角色的本轮提案'},
    {name: 'schema', detail: '$.proposal: invalid text length or format'},
    {name: 'source', detail: '提案须引用已存在的来源'},
    {name: 'json', detail: 'JSON 解析失败'},
    {name: 'recovery', detail: '$.proposal: invalid text length or format'},
    {name: 'integration-recovery', detail: '候选范围必须关联真实议题'},
    {name: 'integration-invalid', detail: '候选范围必须关联真实议题'},
  ]) {
    await t.test(scenario.name, async () => {
      const temporary = mkdtempDisposableSync(join(tmpdir(), 'hama-propose-'));
      let proposalCalls = 0;
      let integrationCalls = 0;
      let agendaCalls = 0;
      let critiqueCalls = 0;
      let productCritiqueCalls = 0;
      let payloadError: unknown;
      const fake = createServer(async (req, res) => {
        try {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const body = JSON.parse(Buffer.concat(chunks).toString());
          assert.equal(body.model, 'deepseek-flash');
          assert.deepEqual(body.response_format, {type: 'json_object'});
          assert.deepEqual(body.thinking, {type: 'disabled'});
          assert.equal(body.tools, undefined);
          assert.equal(body.frequency_penalty, undefined);
          assert.equal(body.presence_penalty, undefined);
          const role = /^角色：(.+?)。/.exec(body.messages[0].content)![1]!;
          const {context: data, validationFeedback} = JSON.parse(body.messages[1].content);
          const operation = identify(role, data);
          let value = campusResponder({role, operation, data});
          let content: string | undefined;
          if (operation === 'agenda' && scenario.name === 'agenda') {
            agendaCalls++;
            if (agendaCalls > 1) {
              assert.ok(validationFeedback.includes('issues 必须恰好 4 项'));
              assert.ok(validationFeedback.includes('baseId 必须逐一覆盖：browse, register, capacity, mobile'));
              assert.ok(validationFeedback.includes('owner 只允许：product, architecture'));
            }
            const agenda = value as {issues: object[]};
            value = {issues: [...agenda.issues, {baseId: 'cross-role-conflict', title: '额外议题', owner: 'product', blockers: []}]};
          }
          if (operation === 'critique') critiqueCalls++;
          if (operation === 'critique' && role === 'product' && scenario.name === 'critique') {
            productCritiqueCalls++;
            if (productCritiqueCalls > 1) {
              assert.ok(validationFeedback.includes('当前作者为 product，objections[].roleId 只允许：architecture'));
            }
            value = {objections: [{roleId: 'product', issue: '质疑自己', reason: '错误目标', suggestion: '应指向其他角色'}]};
          }
          if (operation === 'integrate' && scenario.name.startsWith('integration-')) {
            integrationCalls++;
            assert.deepEqual(data.allowedIssueIds, data.board.data.issues.map((issue: {id: string}) => issue.id));
            assert.ok(body.messages[0].content.includes('scope[].issueIds 只能选择 allowedIssueIds'));
            if (integrationCalls > 1) {
              assert.ok(validationFeedback.includes('无效 ID：browse'));
              assert.ok(validationFeedback.includes(`issueIds 只允许：${data.allowedIssueIds.join(', ')}`));
            }
            if (integrationCalls === 1 || scenario.name === 'integration-invalid') {
              const proposal = value as {scope: {issueIds: string[]}[]};
              value = {...proposal, scope: proposal.scope.map(row => ({...row, issueIds: ['browse']}))};
            }
          }
          if (operation === 'propose' && role === 'product' && data.issue.id === 'issue-browse') {
            assert.deepEqual(data.allowedSourceIds, data.evidence.source.map((source: {id: string}) => source.id));
            assert.ok(body.messages[0].content.includes('sources 只能选择 allowedSourceIds'));
            proposalCalls++;
            if (proposalCalls > 1) assert.ok(validationFeedback.includes(scenario.detail));
            if (scenario.name === 'source' && proposalCalls > 1) {
              assert.ok(validationFeedback.includes('无效 ID：unknown-source'));
              assert.ok(validationFeedback.includes(`sources 只允许：${data.allowedSourceIds.join(', ')}`));
            }
            if (!scenario.name.startsWith('integration-') && !['agenda', 'critique'].includes(scenario.name) && (scenario.name !== 'recovery' || proposalCalls === 1)) {
              if (scenario.name === 'json') content = 'not JSON';
              else if (scenario.name === 'source') value = {...value as object, sources: ['unknown-source']};
              else value = {...value as object, proposal: null};
            }
          }
          res.writeHead(200, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({choices: [{message: {content: content ?? JSON.stringify(value),
            reasoning_content: '推理内容不是 JSON，不应参与正文校验。'}}]}));
        } catch (error) {
          payloadError = error;
          res.writeHead(500).end();
        }
      });
      await new Promise<void>(resolve => fake.listen(0, '127.0.0.1', resolve));
      const runtime = await createOrchestratorRuntime({dataDir: temporary.path, seedSample: false});
      try {
        const address = fake.address();
        assert.ok(address && typeof address === 'object');
        runtime.vault.setApiKey('deepseek', 'local-fixture-secret');
        runtime.store.updateProviderBaseUrl('deepseek', `http://127.0.0.1:${address.port}/v1`);
        const started = await request<RunView>(runtime, '/api/hama/runs', {
          ...input, mode: 'live', providerId: 'deepseek', model: 'deepseek-flash', roles: rolesDefault.slice(0, 2),
        }, 201);
        const id = started.detail.run.id;
        await decide(runtime, await wait(runtime, id, v => v.gate?.kind === 'clarification'), 'clarify', '复用校园账号');
        if (scenario.name === 'integration-recovery') {
          const approval = await wait(runtime, id, v => v.gate?.kind === 'approval');
          assert.equal(integrationCalls, 2);
          assert.equal(approval.artifacts.filter(a => a.kind === 'rework').length, 0);
          await decide(runtime, approval, 'approve');
          await decide(runtime, await wait(runtime, id, v => v.gate?.kind === 'confirmation'), 'confirm');
          const completed = await wait(runtime, id, v => v.detail.run.status === 'succeeded');
          assert.ok(completed.baseline);
        } else if (scenario.name === 'recovery') {
          await wait(runtime, id, v => v.gate?.kind === 'approval');
          assert.equal(proposalCalls, 2);
          assert.ok(critiqueCalls > 0);
        } else {
          const failed = await wait(runtime, id, v => v.detail.run.status === 'failed');
          const attempt = failed.detail.attempts.find(a => a.status === 'failed')!;
          const failedAgent = scenario.name === 'integration-invalid' ? 'Consensus Agent / integrate' : scenario.name === 'agenda' ? 'Moderator / agenda' :
            scenario.name === 'critique' ? 'product / critique' : 'product / propose';
          assert.ok(attempt.errorMessage.includes(`Agent ${failedAgent}`));
          assert.ok(attempt.errorMessage.includes('invalid_output，已尝试 3 次'));
          assert.ok(attempt.errorMessage.includes(scenario.detail), attempt.errorMessage);
          assert.equal(scenario.name === 'integration-invalid' ? integrationCalls : scenario.name === 'agenda' ? agendaCalls : scenario.name === 'critique' ? productCritiqueCalls : proposalCalls, 3);
          if (scenario.name !== 'critique' && !scenario.name.startsWith('integration-')) assert.equal(critiqueCalls, 0);
        }
        assert.equal(payloadError, undefined);
      } finally {
        await runtime.stop();
        await new Promise<void>((resolve, reject) => fake.close(error => error ? reject(error) : resolve()));
        temporary.remove();
      }
    });
  }
});

test('HTTP model adapter, selective A/B/C rework, technical retry, and structured baseline handoff', async () => {
  const temporary = mkdtempDisposableSync(join(tmpdir(), 'hama-live-'));
  const dataDir = temporary.path;
  let intakeFailures = 3;
  let checkedPayloads = 0;
  let payloadError: Error | undefined;
  let escalation = false;
  let integrationOnly = false;
  let holdFirstRequest = true;
  let notifyFirstInvocation = () => {};
  const firstInvocation = new Promise<void>(resolve => {notifyFirstInvocation = resolve;});
  const fake = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString());
      assert.equal(req.url, '/v1/chat/completions');
      assert.equal(req.headers.authorization, 'Bearer local-fixture-secret');
      assert.equal(body.model, 'gpt-hama-fixture');
      assert.equal(body.tools, undefined);
      assert.equal(body.response_format, undefined);
      const role = /^角色：(.+?)。/.exec(body.messages[0].content)![1]!;
      const data = JSON.parse(body.messages[1].content).context;
      const operation = identify(role, data);
      checkedPayloads++;
      if (holdFirstRequest && operation === 'intake') {
        holdFirstRequest = false;
        notifyFirstInvocation();
        return;
      }
      let value = campusResponder({role, operation, data} satisfies AgentRequest);
      if (operation === 'intake' && intakeFailures-- > 0) value = {};
      if (operation === 'refine' && data.issue.id === 'issue-capacity' && data.round === 1) {
        value = {...value as object, state: 'discussing'};
      }
      if (operation === 'evaluate') {
        assert.deepEqual(Object.keys(data).sort(), ['facts', 'issueIds', 'proposal', 'source']);
        if (escalation && role === dimensions.risk.name) {
          value = {verdict: 'pass', summary: '有否决项', findings: [finding('veto')]};
        } else if (data.proposal.revision === 1 && role === dimensions.feasibility.name) {
          const obstacle = finding('blocking');
          value = {verdict: 'pass', summary: '有阻断项',
            findings: [integrationOnly ? {...obstacle, category: 'coverage', issueIds: []} : obstacle]};
        }
      }
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({choices: [{message: {content: JSON.stringify(value)}}]}));
    } catch (error) {
      payloadError = error as Error;
      res.writeHead(500).end();
    }
  });
  await new Promise<void>(resolve => fake.listen(0, '127.0.0.1', resolve));
  let runtime = await createOrchestratorRuntime({dataDir, seedSample: false});
  try {
    const address = fake.address();
    assert.ok(address && typeof address === 'object');
    await request(runtime, '/api/hama/runs', {...input, mode: 'live'}, 400);
    runtime.vault.setApiKey('openai', 'local-fixture-secret');
    runtime.store.updateProviderBaseUrl('openai', `http://127.0.0.1:${address.port}/v1`);
    const live = {...input, mode: 'live', providerId: 'openai', model: 'gpt-hama-fixture', roles: rolesDefault.slice(0, 2)};
    const started = await request<RunView>(runtime, '/api/hama/runs', live, 201);
    const id = started.detail.run.id;
    await Promise.race([firstInvocation, new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Model request did not start')), 5000).unref();
    })]);
    await runtime.stop();
    runtime = await createOrchestratorRuntime({dataDir, seedSample: false});
    const failed = await wait(runtime, id, v => v.detail.run.status === 'failed');
    const calls = failed.artifacts.filter(a => a.kind === 'model_call');
    assert.equal(calls.length, 3);
    assert.ok(calls.every(a => (a.data as {outcome: string}).outcome === 'invalid_output'));
    assert.equal(failed.artifacts.some(a => a.kind === 'intake'), false);
    assert.ok(failed.detail.attempts.some(a => a.errorMessage === 'Execution interrupted'));
    const nodeId = failed.detail.nodes.find(n => n.status === 'failed')!.id;
    await request(runtime, `/api/runs/${id}/retry-node`, {nodeId});
    await decide(runtime, await wait(runtime, id, v => v.gate?.kind === 'clarification'), 'clarify', '复用现有账号');
    const approval = await wait(runtime, id, v => v.gate?.kind === 'approval');
    assert.equal(approval.gate!.target.revision, 2);
    const changeRounds = approval.artifacts.filter(a => a.kind === 'discussion');
    assert.equal(changeRounds.filter(a => a.subject === 'issue-capacity').length, 3);
    assert.equal(changeRounds.filter(a => a.subject === 'issue-browse').length, 1);
    assert.ok(approval.artifacts.some(a => a.kind === 'rework_result' && (a.data as {outcome: string}).outcome === 'pass'));
    await decide(runtime, approval, 'approve');
    const confirmation = await wait(runtime, id, v => v.gate?.kind === 'confirmation');
    await decide(runtime, confirmation, 'request_changes', '改变容量方案边界，重新审定策略。', 'proposal', 200,
      {issueIds: ['issue-capacity']});
    const reapproval = await wait(runtime, id, v => v.gate?.kind === 'approval' && v.gate.id !== approval.gate?.id);
    assert.equal(reapproval.gate!.target.revision, 3);
    await decide(runtime, reapproval, 'approve', '', 'local', 409, {
      targetId: approval.gate!.target.id, targetHash: approval.gate!.target.hash,
    });
    await decide(runtime, reapproval, 'approve');
    const newConfirm = await wait(runtime, id, v => v.gate?.kind === 'confirmation');
    assert.notEqual(prd(newConfirm).approvalId, prd(confirmation).approvalId);
    await decide(runtime, newConfirm, 'confirm');
    const completed = await wait(runtime, id, v => v.detail.run.status === 'succeeded');
    assert.ok(!JSON.stringify(completed).includes('local-fixture-secret'));
    const baseline = completed.baseline!;
    const workspace = runtime.store.createWorkspace({name: 'Planning target', rootPath: dataDir});
    const concept = await request<DesignInputDraft>(runtime, '/api/designs',
      {baselineId: baseline.id, workspaceId: workspace.id, sourceCommit: null}, 201);
    assert.equal(concept.reviewEligible, false);
    assert.deepEqual(concept.baseline, baseline);
    const git = (args: string[]) => execFileSync('git', ['-C', dataDir, ...args], {encoding: 'utf8', windowsHide: true});
    git(['init']);
    git(['-c', 'user.name=Design Test', '-c', 'user.email=design@example.test', 'commit', '--allow-empty', '-m', 'Initial target']);
    const commit = git(['rev-parse', 'HEAD']).trim();
    const inventory = await request<WorkspaceInventory>(runtime, `/api/design-workspaces/${workspace.id}`);
    assert.equal(inventory.sourceCommit, commit);
    const workflowCount = runtime.store.listWorkflows().length;
    const design = await request<DesignInputDraft>(runtime, '/api/designs',
      {baselineId: baseline.id, workspaceId: workspace.id, sourceCommit: commit}, 201);
    assert.equal(design.reviewEligible, true);
    assert.equal(design.baselineRef.sha256, baseline.sha256);
    assert.deepEqual(design.baseline.prd.requirements, baseline.prd.requirements);
    assert.deepEqual(design.baseline.prd.trace, baseline.prd.trace);
    assert.equal(runtime.store.listWorkflows().length, workflowCount);
    assert.deepEqual(await request(runtime, `/api/designs/${design.designId}`), design);
    await request(runtime, '/api/designs', {baselineId: 'unknown', workspaceId: workspace.id, sourceCommit: commit}, 404);
    await request(runtime, '/api/designs', {baselineId: baseline.id, workspaceId: workspace.id, sourceCommit: '0'.repeat(40)}, 409);
    const documentWorkspace = runtime.store.listWorkspaces().find(w => w.description === 'hama-document-workspace')!;
    await request(runtime, '/api/designs', {baselineId: baseline.id, workspaceId: documentWorkspace.id, sourceCommit: null}, 422);
    const sampleRequirement = design.baseline.prd.requirements[0]!;
    const sampleAc = sampleRequirement.acceptance[0]!;
    const trace = design.baseline.prd.trace.find(t => t.acceptanceIds.includes(sampleAc.id))!;
    assert.equal(trace.requirementId, sampleRequirement.id);
    assert.equal(trace.approvalId, design.baseline.approval.id);
    assert.deepEqual(trace.proposal, design.baseline.prd.proposal);
    assert.ok(trace.issueIds.length && trace.ideaAndDocumentIds.length);
    const next = await request<WorkflowDetailSnapshot>(runtime, '/api/workflows/import-requirements',
      {baselineId: baseline.id, workspaceId: workspace.id}, 201);
    assert.equal(next.goalSpec.requirementsBaseline?.sha256, baseline.sha256);
    assert.deepEqual(next.goalSpec.requirements.map(r => r.id), baseline.prd.requirements.map(r => r.id));
    assert.deepEqual(next.goalSpec.acceptanceCriteria.map(a => a.id),
      baseline.prd.requirements.flatMap(r => r.acceptance.map(a => a.id)));

    integrationOnly = true;
    const integrating = await request<RunView>(runtime, '/api/hama/runs', {...live, projectId: 'integration-only'}, 201);
    const integratingId = integrating.detail.run.id;
    await decide(runtime, await wait(runtime, integratingId, v => v.gate?.kind === 'clarification'), 'clarify', '复用现有账号');
    const integrated = await wait(runtime, integratingId, v => v.gate?.kind === 'approval');
    assert.equal(integrated.gate?.target.revision, 2);
    assert.equal(integrated.artifacts.filter(a => a.kind === 'discussion' && a.subject === 'issue-capacity').length, 2);
    assert.ok(integrated.artifacts.some(a => a.kind === 'rework' && (a.data as {target: string}).target === 'integrate'));
    await decide(runtime, integrated, 'reject', '由负责人保留现状。');
    integrationOnly = false;

    escalation = true;
    const limited = await request<RunView>(runtime, '/api/hama/runs', {...live, projectId: 'threshold', maxRevisions: 0, maxDiscussionRounds: 1}, 201);
    const limitedId = limited.detail.run.id;
    await decide(runtime, await wait(runtime, limitedId, v => v.gate?.kind === 'clarification'), 'clarify', '复用现有账号');
    const dispute = await wait(runtime, limitedId, v => v.gate?.kind === 'discussion');
    await decide(runtime, dispute, 'resolve_issue', '技术负责人确认用原子更新守住名额上限。');
    const limit = await wait(runtime, limitedId, v => v.gate?.kind === 'limit');
    await decide(runtime, limit, 'approve', '', 'local', 409);
    await decide(runtime, limit, 'escalate', '需要人工评估重大风险');
    const stopped = await wait(runtime, limitedId, v => v.detail.run.status === 'cancelled');
    assert.equal(stopped.baseline, null);
    assert.equal(stopped.artifacts.some(a => a.kind === 'prd'), false);
    assert.equal(payloadError, undefined, payloadError?.stack);
    assert.ok(checkedPayloads > 30);
  } finally {
    await runtime.stop();
    await new Promise<void>(resolve => fake.close(() => resolve()));
    temporary.remove();
  }
});


test('persistent blocking reviews exhaust the shared budget and route integration defects locally', async t => {
  for (const scenario of [
    {name: 'issue-blocking', category: 'technical', issueIds: ['issue-capacity'], target: 'discuss', budget: 2},
    {name: 'coverage', category: 'coverage', issueIds: [], target: 'integrate', budget: 2},
    {name: 'integration-technical', category: 'technical', issueIds: [], target: 'integrate', budget: 2},
    {name: 'human-resolution', category: 'coverage', issueIds: ['issue-capacity'], target: 'integrate', budget: 2, human: true},
    {name: 'review-contract', category: 'technical', issueIds: ['issue-capacity'], target: 'discuss', budget: 2, contract: true},
    {name: 'zero-budget', category: 'technical', issueIds: ['issue-capacity'], target: 'discuss', budget: 0},
  ]) await t.test(scenario.name, async () => {
    const temporary = mkdtempDisposableSync(join(tmpdir(), 'hama-persistent-review-'));
    const fake = createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const role = /^角色：(.+?)。/.exec(body.messages[0].content)![1]!;
      const data = JSON.parse(body.messages[1].content).context;
      const operation = identify(role, data);
      let value = operation === 'evaluate' ? {
        verdict: 'revision_required', summary: '持续阻断，禁止绕过评审',
        findings: [{...finding('blocking'), category: scenario.category, issueIds: scenario.issueIds}],
      } : campusResponder({role, operation, data});
      if ('contract' in scenario && operation === 'evaluate') {
        const feedback = JSON.parse(body.messages[1].content).validationFeedback;
        value = {verdict: feedback ? 'conditional_pass' : 'revision_required', summary: '只有非阻断整改项',
          findings: [finding('condition')]};
      }
      if ('human' in scenario) {
        if (operation === 'refine' && data.issue.id === 'issue-capacity') {
          value = {...value as object, state: 'blocked', blockers: ['名额策略等待人工裁决']};
        }
        if (operation === 'integrate') {
          const item = data.discussions.find((row: {issue: {id: string}}) => row.issue.id === 'issue-capacity');
          const closed = item.humanDecision?.feedback === '采用原子扣减，名额不足则拒绝；此事项已裁决。' &&
            item.conclusion?.state === 'resolved' && item.conclusion.blockers.length === 0 && item.issue.blockers.length === 0;
          value = {...value as object, unresolved: closed ? [] : ['名额策略等待人工裁决']};
        }
        if (operation === 'evaluate' && data.proposal.data.unresolved.length === 0) {
          value = data.proposal.revision === 1 ? {
            verdict: 'revision_required', summary: '独立整合缺漏需补齐',
            findings: [{...finding('blocking'), category: 'coverage', issueIds: [], problem: '候选遗漏跨议题说明'}],
          } : campusResponder({role, operation, data});
        }
      }
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({choices: [{message: {content: JSON.stringify(value)}}]}));
    });
    await new Promise<void>(resolve => fake.listen(0, '127.0.0.1', resolve));
    const runtime = await createOrchestratorRuntime({dataDir: temporary.path, seedSample: false});
    try {
      const address = fake.address();
      assert.ok(address && typeof address === 'object');
      runtime.vault.setApiKey('openai', 'local-fixture-secret');
      runtime.store.updateProviderBaseUrl('openai', `http://127.0.0.1:${address.port}/v1`);
      const started = await request<RunView>(runtime, '/api/hama/runs', {...input,
        mode: 'live', providerId: 'openai', model: 'fixture', maxRevisions: scenario.budget}, 201);
      const id = started.detail.run.id;
      await decide(runtime, await wait(runtime, id, v => v.gate?.kind === 'clarification'), 'clarify', '复用已有账号');
      if ('contract' in scenario) {
        const approval = await wait(runtime, id, v => v.gate?.kind === 'approval' || v.gate?.kind === 'limit');
        assert.equal(approval.gate?.kind, 'approval');
        assert.ok(approval.artifacts.some(a => a.kind === 'model_call' && (a.data as {outcome: string}).outcome === 'invalid_output'));
        assert.equal(approval.artifacts.filter(a => a.kind === 'rework').length, 0);
        assert.ok(approval.artifacts.filter(a => a.kind === 'evaluation').every(a =>
          (a.data as {review: {verdict: string}}).review.verdict === 'conditional_pass'));
        await decide(runtime, approval, 'reject', '一致性纠错测试结束，保留非阻断条件');
        return;
      }
      if ('human' in scenario) {
        const discussion = await wait(runtime, id, v => v.gate?.kind === 'discussion');
        await decide(runtime, discussion, 'resolve_issue', '采用原子扣减，名额不足则拒绝；此事项已裁决。');
        const approval = await wait(runtime, id, v => v.gate?.kind === 'approval' || v.gate?.kind === 'limit');
        assert.equal(approval.gate?.kind, 'approval');
        assert.equal(approval.artifacts.filter(a => a.kind === 'proposal').length, 2);
        const changes = approval.artifacts.filter(a => a.kind === 'rework' && (a.data as {loop: string}).loop === 'B');
        assert.equal(changes.length, 1);
        assert.equal((changes[0]!.data as {target: string}).target, 'integrate');
        assert.equal(approval.artifacts.filter(a => a.kind === 'discussion' && a.subject === 'issue-capacity').length, 1);
        const original = approval.artifacts.find(a => a.kind === 'discussion' && a.subject === 'issue-capacity')!;
        assert.deepEqual((original.data as {conclusion: {blockers: string[]}}).conclusion.blockers, ['名额策略等待人工裁决']);
        await decide(runtime, approval, 'approve');
        await decide(runtime, await wait(runtime, id, v => v.gate?.kind === 'confirmation'), 'confirm');
        assert.ok((await wait(runtime, id, v => v.detail.run.status === 'succeeded')).baseline);
        return;
      }
      const limited = await wait(runtime, id, v => v.gate?.kind === 'limit');
      assert.deepEqual(limited.gate!.options, ['escalate', 'reject']);
      const reworks = limited.artifacts.filter(a => a.kind === 'rework').map(a => a.data as {
        loop: string; round: number; target: string;
      }).filter(a => a.loop !== 'A');
      assert.equal(reworks.length, scenario.budget);
      assert.deepEqual(reworks.map(a => a.round), Array.from({length: scenario.budget}, (_, i) => i + 1));
      assert.ok(reworks.every(a => a.target === scenario.target));
      assert.equal(limited.artifacts.filter(a => a.kind === 'report').length, scenario.budget + 1);
      assert.equal(limited.artifacts.filter(a => a.kind === 'discussion').length,
        4 + (scenario.target === 'discuss' ? scenario.budget : 0));
      assert.equal(limited.baseline, null);
      await decide(runtime, limited, 'approve', '', 'local', 409);
      await decide(runtime, limited, 'escalate', '保留真实阻断并移交负责人');
      await wait(runtime, id, v => v.detail.run.status === 'cancelled');
    } finally {
      await runtime.stop();
      await new Promise<void>(resolve => fake.close(() => resolve()));
      temporary.remove();
    }
  });
});
