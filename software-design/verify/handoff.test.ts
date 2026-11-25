import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync, mkdtempDisposableSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {createOrchestratorRuntime} from '../../workflow-orchestrator/src/server/runtime.ts';
import {OrchestratorHttpServer} from '../../workflow-orchestrator/src/server/http-router.ts';
import {WorkflowPlannerEngine} from '../../workflow-orchestrator/src/engines/planner.ts';
import type {WorkflowDetailSnapshot} from '../../workflow-orchestrator/src/shared/api.ts';
import {DesignService} from '../src/service.ts';
import {DesignReviewService, type DesignRevision} from '../src/reviews.ts';
import {DesignHandoffService, verifyPmReceipt, type DesignHandoffReceipt} from '../src/handoff.ts';
import {projectConfirmedDesign} from '../src/pm-input.ts';
import type {DesignGeneration} from '../src/generator.ts';

const fixture = JSON.parse(readFileSync(new URL('./step4-evidence.json', import.meta.url), 'utf8')) as {confirmedSnapshot: DesignRevision};
const generation = JSON.parse(readFileSync(new URL('./step2-evidence/service.json', import.meta.url), 'utf8')) as DesignGeneration;
type Runtime = Awaited<ReturnType<typeof createOrchestratorRuntime>>;
type HttpResult = {status: number; body: any};

function target(root: string) {
  const path = join(root, 'target'); mkdirSync(path); mkdirSync(join(path, 'src'));
  writeFileSync(join(path, 'src/service.ts'), 'export const count = () => 0;\n');
  const git = (args: string[]) => execFileSync('git', ['-C', path, ...args], {encoding: 'utf8', windowsHide: true}).trim();
  const commit = (message: string) => git(['-c', 'user.name=Handoff Test', '-c', 'user.email=handoff@example.test', 'commit', '-am', message]);
  git(['init', '-b', 'main']); git(['add', 'src/service.ts']); commit('Initial service');
  return {path, git, commit};
}
function services(runtime: Runtime, root: string, planner = runtime.planner) {
  const designs = new DesignService(runtime.store, {baseline: () => structuredClone(fixture.confirmedSnapshot.input.baseline)}, join(root, 'inputs'));
  const reviews = new DesignReviewService(runtime.store.db, designs);
  return {designs, reviews, handoffs: new DesignHandoffService(runtime.store, reviews, designs, planner)};
}
function save(runtime: Runtime, designs: DesignService, reviews: DesignReviewService, workspaceId: string, sourceCommit: string, confirm = true) {
  const input = designs.create({baselineId: fixture.confirmedSnapshot.input.baseline.id, workspaceId, sourceCommit});
  const draft = reviews.createFromGeneration({...generation, designId: input.designId, input, body: structuredClone(fixture.confirmedSnapshot.body)}, {actor: 'Designer', reason: '真实 Planner 原子交接联调'});
  if (!confirm) return draft;
  reviews.review(draft.designId, 1, {expectedHash: draft.contentSha256, actor: 'Reviewer', action: 'submit'});
  return reviews.review(draft.designId, 1, {expectedHash: draft.contentSha256, actor: 'Reviewer', action: 'confirm'});
}
async function request(server: OrchestratorHttpServer, path: string, body?: unknown): Promise<HttpResult> {
  const result = await fetch(server.getBaseUrl() + path, {method: body === undefined ? 'GET' : 'POST',
    headers: {Authorization: `Bearer ${server.getSessionToken()}`, 'Content-Type': 'application/json'}, body: body === undefined ? undefined : JSON.stringify(body)});
  return {status: result.status, body: await result.json()};
}
const postPath = (r: DesignRevision) => `/api/designs/${r.designId}/revisions/${r.revision}/handoff`;
const payload = (r: DesignRevision) => ({workspaceId: r.input.workspace.workspaceId, expectedHash: r.contentSha256});
const queryPath = (r: DesignRevision) => `${postPath(r)}?workspaceId=${r.input.workspace.workspaceId}&expectedHash=${r.contentSha256}`;
const tables = ['workflows', 'goal_specs', 'pm_reports', 'graph_nodes', 'graph_edges', 'validation_reports', 'audit_ledger', 'design_handoffs'];
const counts = (runtime: Runtime) => tables.map(table => runtime.store.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()!['count']);

test('atomic HTTP handoff: failed ledger write rolls back all PM artifacts; concurrent retries commit once, broadcast after commit, and recover after source drift/restart', async () => {
  using temp = mkdtempDisposableSync(join(tmpdir(), 'design-handoff-'));
  const repo = target(temp.path), dataDir = join(temp.path, 'host');
  let runtime = await createOrchestratorRuntime({dataDir, seedSample: false});
  let server: OrchestratorHttpServer | undefined;
  try {
    const events: Array<{workflowId: string; linked: number; pmReports: number}> = [];
    let abortOnCommit: AbortController | null = null;
    const planner = new WorkflowPlannerEngine(runtime.store, (_type, workflowId) => {
      using observer = new DatabaseSync(join(dataDir, 'orchestrator.sqlite'), {readOnly: true});
      events.push({workflowId, linked: Number(observer.prepare('SELECT COUNT(*) AS count FROM design_handoffs WHERE workflow_id=?').get(workflowId)!['count']),
        pmReports: Number(observer.prepare('SELECT COUNT(*) AS count FROM pm_reports WHERE workflow_id=?').get(workflowId)!['count'])});
      abortOnCommit?.abort();
    });
    const {designs, reviews, handoffs} = services(runtime, temp.path, planner);
    server = new OrchestratorHttpServer({...runtime, designs, designReviews: reviews, designHandoffs: handoffs, planner}); await server.start(0);
    const workspace = runtime.store.createWorkspace({name: 'Handoff target', rootPath: repo.path});
    const commit = repo.git(['rev-parse', 'HEAD']);
    const confirmed = save(runtime, designs, reviews, workspace.id, commit);
    const draft = save(runtime, designs, reviews, workspace.id, commit, false);
    assert.equal((await request(server, postPath(draft), payload(draft))).status, 409);
    assert.equal((await request(server, postPath(confirmed), {...payload(confirmed), expectedHash: '0'.repeat(64)})).status, 409);
    assert.equal((await request(server, postPath(confirmed), {...payload(confirmed), workspaceId: 'other-workspace'})).status, 409);
    runtime.store.db.prepare('UPDATE workspaces SET description=? WHERE id=?').run('hama-document-workspace', workspace.id);
    assert.equal((await request(server, postPath(confirmed), payload(confirmed))).status, 422);
    runtime.store.db.prepare('UPDATE workspaces SET description=? WHERE id=?').run('', workspace.id);
    assert.equal((await request(server, queryPath(confirmed))).status, 404);
    const beforeFailure = counts(runtime);
    runtime.store.db.exec(`CREATE TRIGGER test_handoff_failure BEFORE INSERT ON design_handoffs
      BEGIN SELECT RAISE(ABORT, 'injected handoff failure'); END;`);
    const failure = await request(server, postPath(confirmed), payload(confirmed));
    assert.equal(failure.status, 500); assert.match(failure.body.error, /injected handoff failure/);
    assert.deepEqual(counts(runtime), beforeFailure); assert.deepEqual(events, []);
    runtime.store.db.exec('DROP TRIGGER test_handoff_failure');
    // Graph validation errors must retain a draft and its diagnostics, rather than discard the handoff.
    runtime.store.listCapabilities().filter(c => c.executorKind === 'agent').forEach(c => runtime.store.setCapabilityProbe(c.id, false, 'offline gate fixture', false));
    const responses = await Promise.all([request(server, postPath(confirmed), payload(confirmed)), request(server, postPath(confirmed), payload(confirmed))]);
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 201]);
    const receipt = responses[0]!.body as DesignHandoffReceipt;
    assert.equal(receipt.status, 'received', JSON.stringify(receipt.diagnostics));
    assert.deepEqual(responses[1]!.body, receipt); assert.ok(receipt.pmReportId);
    assert.equal(receipt.workflow!.pmReport!.workflowId, receipt.workflowId);
    assert.equal(receipt.workflow!.goalSpec.rawMarkdown, confirmed.reviewMarkdown);
    assert.ok(receipt.workflow!.validation.errorCount > 0); assert.equal(receipt.workflow!.workflow.status, 'draft');
    assert.deepEqual(events, [{workflowId: receipt.workflowId, linked: 1, pmReports: 1}]);
    assert.equal(runtime.store.listWorkflows().length, 1);
    assert.equal(runtime.store.db.prepare('SELECT COUNT(*) AS count FROM design_handoffs').get()!['count'], 1);
    assert.equal(runtime.store.db.prepare('SELECT pm_report_id FROM design_handoffs WHERE workflow_id=?').get(receipt.workflowId)!['pm_report_id'], receipt.pmReportId);
    assert.deepEqual((await request(server, `/api/workflows/${receipt.workflowId}/design-handoff`)).body, receipt);
    const lostResponseDesign = save(runtime, designs, reviews, workspace.id, commit);
    const controller = new AbortController(); abortOnCommit = controller;
    await assert.rejects(fetch(server.getBaseUrl() + postPath(lostResponseDesign), {method: 'POST', signal: controller.signal,
      headers: {Authorization: `Bearer ${server.getSessionToken()}`, 'Content-Type': 'application/json'}, body: JSON.stringify(payload(lostResponseDesign))}), /abort/i);
    abortOnCommit = null;
    const recoveredLost = await request(server, queryPath(lostResponseDesign));
    assert.equal(recoveredLost.status, 200); assert.equal(recoveredLost.body.status, 'received');
    assert.equal((await request(server, postPath(lostResponseDesign), payload(lostResponseDesign))).body.workflowId, recoveredLost.body.workflowId);
    // A second confirmed design bound to the old source has no ledger yet.
    const stale = save(runtime, designs, reviews, workspace.id, commit);
    writeFileSync(join(repo.path, 'src/service.ts'), 'export const count = () => 1;\n'); repo.commit('Change service after confirmation');
    const beforeDrift = counts(runtime);
    const drift = await request(server, postPath(stale), payload(stale));
    assert.equal(drift.status, 409); assert.equal(drift.body.details.route, 'design_review');
    assert.deepEqual(drift.body.details.changedPaths, ['src/service.ts']); assert.equal(drift.body.details.affectedModules[0].id, 'entry');
    assert.deepEqual(counts(runtime), beforeDrift);
    assert.deepEqual((await request(server, postPath(confirmed), payload(confirmed))).body, receipt);
    assert.deepEqual((await request(server, queryPath(confirmed))).body, receipt);
    assert.equal(events.length, 2);
    const evidence = process.env['DESIGN_HANDOFF_EVIDENCE'];
    if (evidence) writeFileSync(evidence, JSON.stringify({confirmedSnapshot: confirmed, receipt, sourceConflict: drift.body}, null, 2) + '\n');
    await server.stop(); server = undefined; await runtime.stop(); runtime = await createOrchestratorRuntime({dataDir, seedSample: false});
    assert.deepEqual((await request(runtime.server, postPath(confirmed), payload(confirmed))).body, receipt);
    assert.deepEqual((await request(runtime.server, `/api/workflows/${receipt.workflowId}/design-handoff`)).body, receipt);
    // Downstream edits cannot overwrite the initial, version-bound PM acknowledgement.
    runtime.planner.updateGoalSpec(receipt.workflowId, {title: 'Edited downstream title'});
    assert.deepEqual((await request(runtime.server, queryPath(confirmed))).body, receipt);
    assert.equal(runtime.store.listWorkflows().length, 2);
  } finally {await server?.stop(); await runtime.stop();}
});

test('missing reports and input mismatches keep a pending ledger; queries recover the original workflow without another import', async () => {
  using temp = mkdtempDisposableSync(join(tmpdir(), 'design-handoff-pending-'));
  const repo = target(temp.path), runtime = await createOrchestratorRuntime({dataDir: join(temp.path, 'host'), seedSample: false});
  let server: OrchestratorHttpServer | undefined;
  try {
    const {designs, reviews} = services(runtime, temp.path);
    const workspace = runtime.store.createWorkspace({name: 'Pending target', rootPath: repo.path});
    let fault: 'missing' | 'input' | null = 'missing', imports = 0;
    const alter = (detail: WorkflowDetailSnapshot): WorkflowDetailSnapshot => fault === 'missing' ? {...detail, pmReport: null}
      : fault === 'input' ? {...detail, goalSpec: {...detail.goalSpec, rawMarkdown: 'wrong revision'}} : detail;
    const handoffs = new DesignHandoffService(runtime.store, reviews, designs, {
      importStructuredRequirements: (id, source, options) => {imports++; return alter(runtime.planner.importStructuredRequirements(id, source, options));},
      getWorkflowDetail: id => alter(runtime.planner.getWorkflowDetail(id)),
    });
    server = new OrchestratorHttpServer({...runtime, designs, designReviews: reviews, designHandoffs: handoffs}); await server.start(0);
    for (const currentFault of ['missing', 'input'] as const) {
      fault = currentFault;
      const confirmed = save(runtime, designs, reviews, workspace.id, repo.git(['rev-parse', 'HEAD']));
      const first = await request(server, postPath(confirmed), payload(confirmed));
      assert.equal(first.status, 201); assert.equal(first.body.status, 'pending_review');
      assert.ok(first.body.diagnostics.some((d: {code: string}) => d.code === (fault === 'missing' ? 'missing_pm_report' : 'input_mismatch')));
      const count = imports;
      const retry = await request(server, postPath(confirmed), payload(confirmed));
      assert.equal(retry.status, 200); assert.equal(retry.body.workflowId, first.body.workflowId); assert.equal(imports, count);
      fault = null;
      const recovered = await request(server, queryPath(confirmed));
      assert.equal(recovered.status, 200); assert.equal(recovered.body.status, 'received', JSON.stringify(recovered.body.diagnostics));
      assert.equal(recovered.body.workflowId, first.body.workflowId); assert.equal(imports, count);
      assert.ok(recovered.body.pmReportId); assert.equal(recovered.body.workflow.pmReport.workflowId, recovered.body.workflowId);
      const source = projectConfirmedDesign(confirmed, confirmed.contentSha256);
      const detail = recovered.body.workflow as WorkflowDetailSnapshot;
      assert.deepEqual(verifyPmReceipt(source, detail, recovered.body.workflowId), []);
      const badReport = {...detail, pmReport: {...detail.pmReport!, workflowId: 'wrong-workflow'}};
      assert.ok(verifyPmReceipt(source, badReport, recovered.body.workflowId).some(d => d.code === 'pm_report_mismatch'));
      const badModule = {...detail, pmReport: {...detail.pmReport!, detectedModules: []}};
      assert.ok(verifyPmReceipt(source, badModule, recovered.body.workflowId).some(d => d.code === 'module_mismatch'));
      const badSlice = {...detail, pmReport: {...detail.pmReport!, slices: []}};
      assert.ok(verifyPmReceipt(source, badSlice, recovered.body.workflowId).some(d => d.code === 'uncovered_module'));
    }
    assert.equal(imports, 2); assert.equal(runtime.store.listWorkflows().length, 2);
  } finally {await server?.stop(); await runtime.stop();}
});
