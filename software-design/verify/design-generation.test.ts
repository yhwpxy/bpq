import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync, mkdtempDisposableSync, readFileSync, writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {createOrchestratorRuntime} from '../../workflow-orchestrator/src/server/runtime.ts';
import {OrchestratorHttpServer} from '../../workflow-orchestrator/src/server/http-router.ts';
import {DesignService} from '../src/service.ts';
import {DesignGenerator, type DesignGeneration} from '../src/generator.ts';
import {designBodySchema, type DesignBody} from '../src/design-schema.ts';
import {validateDesign} from '../src/design-validation.ts';
import {renderDesign, validatePreview} from '../src/design-render.ts';
import type {DesignInputDraft} from '../src/contracts.ts';

const source = JSON.parse(readFileSync(new URL('./step1-evidence.json', import.meta.url), 'utf8')) as DesignInputDraft;
function bodyFor(input: DesignInputDraft): DesignBody {
  const r = input.baseline.prd.requirements[0]!;
  const existing = input.workspace.existingPaths.includes('src/service.ts');
  return {schemaVersion: 1, title: existing ? '现有统计服务改造' : '新建非空行命令', goal: input.baseline.prd.sections.goals.join('；'),
    inputs: ['UTF-8 文件路径'], outputs: ['非空行数；失败时错误消息及非零退出码'],
    modules: [{id: 'entry', name: existing ? '统计服务入口' : '命令行入口', layer: 'integration',
      responsibility: '接收路径，调用计数逻辑并将结果输出；异常转为错误消息', inputs: ['文件路径'], outputs: ['计数结果或错误'],
      requirementIds: [r.id], dependsOn: ['counter'], files: [{path: existing ? 'src/service.ts' : 'src/cli.ts', action: existing ? 'modify' : 'create'}]},
    {id: 'counter', name: '非空行计数', layer: 'backend', responsibility: '读取 UTF-8 文件，trim 后非空则计数，文件不存在时抛出错误', inputs: ['路径'], outputs: ['非负整数'],
      requirementIds: [r.id], dependsOn: [], files: [{path: 'src/count.ts', action: 'create'}]}],
    interfaces: [{id: 'count-file', provider: 'counter', consumers: ['entry'], kind: 'function', input: 'countFile(path: string)',
      result: 'Promise<number> 非空行数', failure: '文件不存在或读取失败时抛出带路径的错误；调用方返回非零退出码', sideEffects: '只读取指定文件，不改动原文件'}],
    dataRules: ['按换行拆分，trim 后长度为零的行不计入'], constraints: [...r.constraints], quality: [],
    decisions: [{id: 'separate-count', decision: '分离入口与纯计数逻辑', rationale: '便于命令和服务复用及自动化验证', alternatives: ['全部写在入口中'], requirementIds: [r.id], evidence: [r.id]}],
    assumptions: [], trace: [{requirementId: r.id, moduleIds: ['entry', 'counter'], acceptance: r.acceptance.map(a => ({acceptanceId: a.id,
      method: `准备夹具：${a.given}；${a.when}，对输出及退出码断言`, expectedEvidence: a.then}))}], unresolved: []};
}

test('reference validation locates AC gaps, NFR coverage, unsafe paths, overlapping writes, assumptions and dependency failures', () => {
  const input = structuredClone(source); input.workspace.existingPaths = [];
  const good = bodyFor(input);
  assert.deepEqual(validateDesign(good, input), []);
  const cases: Array<[string, (b: DesignBody) => void]> = [
    ['uncovered_ac', b => {b.trace[0]!.acceptance.pop();}],
    ['unknown_requirement', b => {b.modules[0]!.requirementIds = ['unknown'];}],
    ['unsafe_path', b => {b.modules[0]!.files[0]!.path = '../escape.ts';}],
    ['overlapping_write', b => {b.modules[1]!.files = b.modules[0]!.files;}],
    ['missing_dependency', b => {b.modules[0]!.dependsOn = [];}],
    ['dependency_cycle', b => {b.modules[1]!.dependsOn = ['entry'];}],
    ['unknown_evidence', b => {b.decisions[0]!.evidence = ['invented-source'];}],
    ['unsupported_assumption', b => {b.assumptions = [{id: 'uncertain', text: '假定文件很小', requirementIds: [input.baseline.prd.requirements[0]!.id], evidence: [], verification: '向负责人确认输入上限'}];}],
  ];
  for (const [code, mutate] of cases) {
    const bad = structuredClone(good); mutate(bad);
    assert.ok(validateDesign(bad, input).some(d => d.code === code), code);
  }
  input.baseline.prd.requirements[0]!.kind = 'nonfunctional';
  assert.ok(validateDesign(good, input).some(d => d.code === 'uncovered_nfr'));
  assert.throws(() => designBodySchema.parse({...good, interfaces: [{}]}), /interfaces/);
  const rendered = renderDesign(good, source);
  assert.deepEqual(validatePreview(good, source, rendered.pmMarkdown), []);
  assert.ok(source.baseline.prd.requirements.every(r => rendered.reviewMarkdown.includes(r.id) && r.acceptance.every(a => rendered.reviewMarkdown.includes(a.id))));
});

test('real no-tool model adapter and HTTP generation: new CLI, existing service, failed attempts and feedback retry', async () => {
  using temporary = mkdtempDisposableSync(join(tmpdir(), 'design-generation-'));
  const root = temporary.path;
  let output: unknown;
  let seen: Record<string, unknown> | undefined;
  let badPayload: unknown;
  const fake = createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const payload = JSON.parse(Buffer.concat(chunks).toString());
      assert.equal(payload.model, 'design-fixture'); assert.equal(payload.tools, undefined);
      assert.equal(req.headers.authorization, 'Bearer design-local-secret');
      assert.ok(payload.messages[0].content.includes('Design Agent'));
      seen = JSON.parse(payload.messages[1].content);
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({choices: [{message: {content: JSON.stringify(output)}}]}));
    } catch (e) {badPayload = e; res.writeHead(500).end();}
  });
  await new Promise<void>(resolve => fake.listen(0, '127.0.0.1', resolve));
  const runtime = await createOrchestratorRuntime({dataDir: join(root, 'host'), seedSample: false});
  let server: OrchestratorHttpServer | undefined;
  try {
    const port = (fake.address() as {port: number}).port;
    runtime.store.updateProviderBaseUrl('openai', `http://127.0.0.1:${port}/v1`);
    runtime.vault.setApiKey('openai', 'design-local-secret');
    const designs = new DesignService(runtime.store, {baseline: () => structuredClone(source.baseline)}, join(root, 'inputs'));
    const generator = new DesignGenerator(designs, runtime.store, runtime.hub,
      id => runtime.vault.resolveProvider(runtime.store, id), join(root, 'generations'));
    server = new OrchestratorHttpServer({...runtime, designs, designGenerator: generator});
    await server.start(0);
    const request = async (path: string, body?: unknown, expected = 200) => {
      const res = await fetch(server!.getBaseUrl() + path, {method: body ? 'POST' : 'GET',
        headers: {Authorization: `Bearer ${server!.getSessionToken()}`, 'Content-Type': 'application/json'},
        body: body ? JSON.stringify(body) : undefined});
      const json = await res.json(); assert.equal(res.status, expected, JSON.stringify(json)); return json;
    };
    for (const kind of ['cli', 'service']) {
      const workspaceRoot = join(root, kind); mkdirSync(workspaceRoot);
      let commit = null;
      if (kind === 'service') {
        mkdirSync(join(workspaceRoot, 'src')); writeFileSync(join(workspaceRoot, 'src/service.ts'), 'export const count = () => 0;\n');
        const git = (args: string[]) => execFileSync('git', ['-C', workspaceRoot, ...args], {encoding: 'utf8', windowsHide: true}).trim();
        git(['init', '-b', 'main']); git(['add', 'src/service.ts']);
        git(['-c', 'user.name=Design Test', '-c', 'user.email=design@example.test', 'commit', '-m', 'Existing service']); commit = git(['rev-parse', 'HEAD']);
      }
      const workspace = runtime.store.createWorkspace({name: kind, rootPath: workspaceRoot});
      const input = await request('/api/designs', {baselineId: source.baseline.id, workspaceId: workspace.id, sourceCommit: commit}, 201) as DesignInputDraft;
      const settings = {expectedHash: input.contentSha256, providerId: 'openai', model: 'design-fixture', feedback: ''};
      const route = `/api/designs/${input.designId}/generate`;
      const body = bodyFor(input); output = {...body, trace: []};
      await request(route, settings, 422);
      let attempts = await request(`/api/designs/${input.designId}/generations`) as DesignGeneration[];
      assert.equal(attempts[0]!.status, 'failed');
      output = {...body, trace: [{...body.trace[0], acceptance: body.trace[0]!.acceptance.slice(0, 1)}]};
      const invalid = await request(route, settings, 422) as {details: {diagnostics: Array<{code: string}>}};
      assert.ok(invalid.details.diagnostics.some((d: {code: string}) => d.code === 'uncovered_ac'));
      output = body;
      const result = await request(route, {...settings, feedback: '补齐所有原始验收与失败语义'}, 201) as DesignGeneration;
      assert.equal(result.status, 'ready'); assert.ok(result.contentSha256);
      assert.deepEqual(seen!['baseline'], input.baseline);
      assert.equal(seen!['feedback'], '补齐所有原始验收与失败语义');
      assert.ok((seen!['previousDiagnostics'] as unknown[]).length);
      assert.equal(badPayload, undefined);
      assert.ok(!JSON.stringify(result).includes('design-local-secret'));
      assert.equal(runtime.store.listWorkflows().length, 0);
      attempts = new DesignGenerator(designs, runtime.store, runtime.hub, id => runtime.vault.resolveProvider(runtime.store, id), join(root, 'generations')).list(input.designId);
      assert.equal(attempts.length, 3); assert.deepEqual(attempts.at(-1), result);
      const evidenceDir = process.env['DESIGN_GENERATION_EVIDENCE'];
      if (evidenceDir) {mkdirSync(evidenceDir, {recursive: true}); writeFileSync(join(evidenceDir, `${kind}.json`), JSON.stringify(result, null, 2) + '\n');}
    }
  } finally {
    await server?.stop(); await runtime.stop(); await new Promise<void>(resolve => fake.close(() => resolve()));
  }
});
