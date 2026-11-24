import { beforeEach, afterEach, it, expect } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { createAuditService } from '../backend/services/auditService.js';
import { createApp } from '../backend/server.js';
import { createEmptyPlan, createNode } from '../shared/plan.js';
import { parseGoal } from '../backend/engine/goalParser.js';
import { compileWorkflow } from '../backend/engine/workflowCompiler.js';
let dir, app, s;
beforeEach(async () => { dir = await mkdtemp(path.join(os.tmpdir(), 'vto-evidence-')); app = createApp({ storageDir: dir }); s = app.locals.services; });
afterEach(async () => { await s.runService.close(); await rm(dir, { recursive: true, force: true }); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async fn => { for (let i = 0; i < 600; i++) { const v = await fn(); if (v) return v; await sleep(10); } throw new Error('timeout'); };
async function completed() {
  const p = createEmptyPlan(); const a = createNode('start'), t = createNode('task'), e = createNode('end'); t.props.name = 'Evidence needle'; t.props.duration = 0; p.nodes = [a, t, e]; p.edges = [{ id: 'a', source: a.id, target: t.id }, { id: 'b', source: t.id, target: e.id }];
  await s.planService.save(p); const { runId } = await s.runService.execute(p.id); const run = await until(async () => { const r = await s.runService.get(runId); return r.status === 'SUCCESS' && r; }); return { p, run };
}
it('serializes ledger append and paginates without dropping or duplicating events', async () => {
  const ledger = createAuditService(dir); await Promise.all(Array.from({ length: 25 }, (_, i) => ledger.append({ action: 'test', message: `event ${i}` })));
  const first = await ledger.list({ limit: 10 }); const second = await ledger.list({ since: first.cursor, limit: 10 }); const third = await ledger.list({ since: second.cursor, limit: 10 });
  expect([...first.events, ...second.events, ...third.events].map(e => e.seq)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1)); expect(third.hasMore).toBe(false);
});
it('links save/publication/run events to immutable version identity', async () => {
  const { p, run } = await completed(); const evidence = await s.evidenceService.exportRun(run.id);
  expect(evidence.data.version.id).toBe(run.versionId); expect(evidence.data.designAudit.some(e => e.action === 'save')).toBe(true); expect(evidence.data.designAudit.some(e => e.action === 'publish')).toBe(true);
  expect(evidence.data.run.logs.every(e => e.runId === run.id && e.planId === p.id && e.versionId === run.versionId)).toBe(true);
});
it('exports a verifiable checksum over the redacted evidence data', async () => {
  const { run } = await completed(); const evidence = await s.evidenceService.exportRun(run.id);
  expect(createHash('sha256').update(JSON.stringify(evidence.data)).digest('hex')).toBe(evidence.manifest.checksum);
  expect(evidence.manifest.legacyUnversioned).toBe(false);
});
it('supports event and session search without SQLite', async () => {
  const { run } = await completed(); const result = await s.evidenceService.search('Evidence needle'); expect(result.hits.some(h => h.runId === run.id)).toBe(true);
  expect((await s.evidenceService.search('no-match-xyz')).hits).toEqual([]);
  await expect(s.evidenceService.search('x', { limit: 1000 })).rejects.toMatchObject({ code: 40001 });
});
it('survives process-service recreation and preserves incremental ordering', async () => {
  const { run } = await completed(), again = createApp({ storageDir: dir });
  try { expect((await again.locals.services.evidenceService.exportRun(run.id)).data.run.logs).toEqual(run.logs); expect((await again.locals.services.runService.get(run.id, run.logs[2].seq)).logs.every(e => e.seq > run.logs[2].seq)).toBe(true); }
  finally { await again.locals.services.runService.close(); }
});
it('streams actual process output before completion and keeps a bounded transcript', async () => {
  const caps = await s.capabilityService.list(); const p = compileWorkflow(parseGoal('Stream execution'), { capabilityId: 'local-tool' }, caps);
  const worker = p.nodes.find(n => n.props.capabilityId === 'local-tool'); worker.props.command = process.execPath; worker.props.args = ['-e', 'console.log("STREAM-FIRST");setTimeout(()=>console.log("STREAM-LAST"),250)'];
  await s.planService.save(p); await s.versionService.trial(p.id); await s.versionService.confirm(p.id); const { runId } = await s.runService.execute(p.id, { authorized: true });
  const live = await until(async () => { const r = await s.runService.get(runId); return r.status === 'RUNNING' && r.logs.some(l => l.event === 'chunk' && l.message.includes('STREAM-FIRST')) && r; });
  expect(live.nodeStates[worker.id].status).toBe('RUNNING');
  const final = await until(async () => { const r = await s.runService.get(runId); return r.status === 'SUCCESS' && r; });
  const session = final.sessions.find(x => x.nodeId === worker.id); const transcript = await s.evidenceService.session(runId, session.id);
  expect(transcript.status).toBe('SUCCESS'); expect(transcript.messages.some(m => m.role === 'user')).toBe(true); expect(transcript.messages.some(m => m.content.includes('STREAM-LAST'))).toBe(true);
  expect((await s.evidenceService.search('STREAM-LAST')).hits.some(h => h.source === 'session')).toBe(true);
  await expect(s.evidenceService.session(runId, 'foreign-session')).rejects.toMatchObject({ code: 40401 });
});
it('redacts provider keys including JSON-escaped keys throughout exported structures', async () => {
  const key = 'fixture"secret'; await s.providerService.save({ id: 'secret', name: 'secret', protocol: 'openai', baseUrl: 'http://127.0.0.1:1', model: 'm', apiKey: key });
  const { run } = await completed(); await s.auditService.append({ planId: run.planId, action: 'fixture', message: key, detail: { apiKey: key, nested: { text: key } } });
  const evidence = await s.evidenceService.exportRun(run.id); expect(JSON.stringify(evidence)).not.toContain('fixture\\"secret'); expect(JSON.stringify(evidence)).toContain('[REDACTED]');
  expect(await s.providerService.redact(JSON.stringify({ value: key }))).not.toContain('fixture');
});
it('rejects damaged audit data instead of overwriting it', async () => {
  const ledger = createAuditService(dir); await ledger.append({ action: 'test', message: 'ok' }); const file = path.join(dir, 'audit-ledger.json'); await writeFile(file, '{broken');
  await expect(ledger.append({ action: 'next' })).rejects.toMatchObject({ code: 50000 }); expect(await readFile(file, 'utf8')).toBe('{broken');
});
it('requires authentication for evidence downloads and returns a JSON attachment', async () => {
  const { run } = await completed(); const server = await new Promise(r => { const x = app.listen(0, '127.0.0.1', () => r(x)); });
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/runs/${run.id}/evidence`;
    expect((await fetch(url)).status).toBe(401);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${app.locals.security.token}` } });
    expect(response.status).toBe(200); expect(response.headers.get('content-disposition')).toContain(`evidence-${run.id}.json`); expect((await response.json()).manifest.runId).toBe(run.id);
  } finally { await new Promise(r => server.close(r)); }
});
