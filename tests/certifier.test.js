import { it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { parseAuditVerdict, verifyValues, createCertifier } from '../backend/engine/certifier.js';
let dir;
beforeEach(async () => { dir = await mkdtemp(path.join(os.tmpdir(), 'certifier-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });
it.each(['not JSON', '```json\n{}\n```', '{"passed":"true","score":1,"findings":[]}', '{"passed":true,"score":2,"findings":[]}', '{"passed":true,"score":0.7,"findings":[]}'])('fails closed for malformed/insufficient QA verdict %#', raw => { expect(parseAuditVerdict(raw).passed).toBe(false); });
it('accepts only typed complete QA verdicts meeting the threshold', () => { expect(parseAuditVerdict('{"passed":true,"score":0.9,"findings":["Evidence matches"]}').passed).toBe(true); expect(parseAuditVerdict('{"passed":false,"score":1,"findings":[]}').passed).toBe(false); });
it('verifies actual file outputs and prevents paths outside the worktree', async () => {
  const c = [{ name: 'report', type: 'file', required: true }];
  expect((await verifyValues(c, { report: '../outside' }, dir)).length).toBe(1);
  expect((await verifyValues(c, { report: 'missing' }, dir)).length).toBe(1);
  await writeFile(path.join(dir, 'report.txt'), 'actual'); expect(await verifyValues(c, { report: 'report.txt' }, dir)).toEqual([]);
});
it('rejects wrong runtime contract types without treating null/arrays as objects', async () => {
  expect((await verifyValues([{ name: 'x', type: 'object', required: true }], { x: null }, dir)).length).toBe(1);
  expect((await verifyValues([{ name: 'x', type: 'number', required: true }], { x: '12' }, dir)).length).toBe(1);
  expect(await verifyValues([{ name: 'x', type: 'string', required: false }], {}, dir)).toEqual([]);
});
it('records actual gate failure instead of accepting an exit message', async () => {
  const certifier = createCertifier({ invoke: async () => ({ outcome: 'task_failure', exitCode: 7, output: 'looks successful' }) }, {});
  const result = await certifier.gate({ props: { command: 'node', args: [], acceptanceRefs: ['AC-01'] } }, { snapshot: { id: 'run', workspaceHandle: { cwd: dir }, graph: { workflow: { permissionTier: 'supervised' } } }, attempt: 1 });
  expect(result.certification.passed).toBe(false); expect(result.certification.exitCode).toBe(7);
});
it('blocks QA on demonstration or unpassed gates before invoking a model', async () => {
  let invoked = false; const certifier = createCertifier({ invoke: async () => { invoked = true; } }, {});
  const result = await certifier.qa({ props: {} }, { snapshot: { graph: { nodes: [{ id: 'g', props: { control: 'gate', demonstrationGate: true } }] }, nodeStates: { g: { status: 'SUCCESS' } } } });
  expect(result.outcome).toBe('task_failure'); expect(invoked).toBe(false);
});
it('provides actual diff and AC evidence to a read-only QA capability', async () => {
  let request;
  const certifier = createCertifier({ invoke: async (_id, r) => { request = r; return { outcome: 'completed', output: '{"passed":true,"score":0.8,"findings":["ok"]}' }; } }, { diff: async () => ({ files: ['report.txt'], patch: '+ actual result' }) });
  const result = await certifier.qa({ props: { capabilityId: 'qa' } }, { snapshot: { id: 'r', workspaceHandle: { cwd: dir }, graph: { workflow: { permissionTier: 'supervised', goalSpec: { goal: 'Deliver', acceptanceCriteria: [{ id: 'AC-01', text: 'Report' }] } }, nodes: [{ id: 'gate', props: { control: 'gate', command: 'node', args: ['verify'] } }] }, nodeStates: { gate: { status: 'SUCCESS' } } }, attempt: 1 });
  expect(request.readOnly).toBe(true); expect(JSON.parse(request.prompt).changedFiles).toContain('report.txt'); expect(JSON.parse(request.prompt).acceptanceCriteria[0].id).toBe('AC-01'); expect(result.certification.passed).toBe(true);
});
it('certifies a complete live worktree run through a local QA HTTP protocol fixture', async () => {
  const http = await import('node:http'); const { createApp } = await import('../backend/server.js'); const { parseGoal } = await import('../backend/engine/goalParser.js'); const { compileWorkflow } = await import('../backend/engine/workflowCompiler.js');
  let payload;
  const server = http.createServer(async (req, res) => { let text = ''; for await (const chunk of req) text += chunk; payload = JSON.parse(text); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"passed":true,"score":0.9,"findings":["Fixture evidence reviewed"]}' } }], usage: { prompt_tokens: 100, completion_tokens: 30 } })); });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const app = createApp({ storageDir: dir }), s = app.locals.services;
  try {
    await s.providerService.save({ id: 'qa-provider', name: 'QA fixture', baseUrl: `http://127.0.0.1:${server.address().port}`, model: 'fixture', protocol: 'openai', apiKey: 'fixture-only' });
    await s.capabilityService.save({ id: 'qa-agent', name: 'QA', transport: 'native', enabled: true, providerId: 'qa-provider' });
    const p = compileWorkflow(parseGoal('# QA delivery\nFR-01: Write report'), { template: 'fullstack', human: false, capabilityId: 'local-tool', qaCapabilityId: 'qa-agent', command: process.execPath, args: ['tools/verify.cjs'] }, await s.capabilityService.list());
    const worker = p.nodes.find(n => n.props.requirementRefs.length); worker.props.command = process.execPath; worker.props.args = ['tools/deliver.cjs', 'fr-01'];
    await s.planService.save(p); await s.versionService.trial(p.id); await s.versionService.confirm(p.id); const { runId } = await s.runService.execute(p.id, { authorized: true });
    let run;
    for (let i = 0; i < 500; i++) { run = await s.runService.get(runId); if (['SUCCESS', 'FAILED'].includes(run.status)) break; await new Promise(r => setTimeout(r, 10)); }
    expect(run.status).toBe('SUCCESS'); expect(run.certifications.find(c => c.kind === 'qa').passed).toBe(true);
    expect(payload.tools.map(t => t.function.name)).toEqual(['read_file', 'list_dir']); expect(payload.messages.at(-1).content).toContain('AC-01');
  } finally { await s.runService.close(); await new Promise(r => server.close(r)); }
});
it('extended verification detects scope escapes and credential-like artifacts', async () => {
  const certifier=createCertifier({}, {diff:async()=>({files:['outside.txt','.env'],patch:''})});
  const r=await certifier.security({}, {snapshot:{workspaceHandle:{cwd:dir},graph:{nodes:[{props:{executorKind:'tool',fileScope:['artifacts/**']}}]}}});
  expect(r.outcome).toBe('task_failure');expect(r.certification.findings.some(x=>x.includes('credential'))).toBe(true);
});
it('extended verification reports the explicit limit of its artifact checks', async () => {
  const certifier=createCertifier({}, {diff:async()=>({files:[],patch:''})});
  const r=await certifier.security({}, {snapshot:{workspaceHandle:{cwd:dir},graph:{nodes:[]}}});expect(r.outcome).toBe('completed');expect(r.output).toContain('not a vulnerability scanner');
});
