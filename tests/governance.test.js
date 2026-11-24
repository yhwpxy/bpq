import { beforeEach, afterEach, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createApp } from '../backend/server.js';
import { terminologyIssues } from '../backend/engine/terminology.js';
import { costForUsage, aggregateUsage } from '../backend/engine/usageMeter.js';
import { policyViolation } from '../backend/engine/executionPolicy.js';
import { parseGoal } from '../backend/engine/goalParser.js';
import { compileWorkflow } from '../backend/engine/workflowCompiler.js';
import { validatePlan } from '../backend/engine/validator.js';
let dir, app, s;
beforeEach(async () => { dir = await mkdtemp(path.join(os.tmpdir(), 'governance-')); app = createApp({ storageDir: dir }); s = app.locals.services; });
afterEach(async () => { await s.runService.close(); await rm(dir, { recursive: true, force: true }); });
it('manages glossary entries and reports DDD warnings through R6', async () => {
  const term = await s.governanceService.saveTerm({ term: 'GraphNode', aliases: ['task_unit'], context: 'Execution', definition: 'A node' });
  const caps = await s.capabilityService.list(), p = compileWorkflow(parseGoal('# Review\nFR-01: inspect task_unit'), {}, caps);
  const issues = validatePlan(p, { capabilities: caps, governance: await s.governanceService.get() });
  expect(issues.some(i => i.code === 'DDD_DRIFT' && i.rule === 'R6' && i.nodeId)).toBe(true);
  await s.governanceService.removeTerm(term.id); expect((await s.governanceService.get()).terms).toEqual([]);
});
it('treats aliases literally and matches Chinese without ASCII word boundaries', () => {
  expect(terminologyIssues('旧名称', [{ id: 't', term: '新名称', aliases: ['旧名称'], context: 'c' }])).toHaveLength(1);
  expect(terminologyIssues('anything', [{ id: 't', term: 'safe', aliases: ['.*'], context: 'c' }])).toHaveLength(0);
});
it('applies changed engineering rules at the next invocation', async () => {
  await s.governanceService.savePolicy({ text: 'local rule', blockedCommands: ['forbidden-marker'] });
  await expect(s.capabilityService.invoke('local-tool', { cwd: dir, command: process.execPath, args: ['-e', 'console.log("forbidden-marker")'], permissionTier: 'supervised' })).rejects.toMatchObject({ code: 40002 });
  expect((await s.governanceService.get()).policy.blockedCommands).toContain('git push --force');
});
it('differentiates strict approval, supervised restrictions and turbo with hard rules', () => {
  expect(policyViolation('node', ['script.js'], undefined, 'strict', false)).toContain('approval');
  expect(policyViolation('git', ['push'], undefined, 'supervised', true)).toContain('Supervised');
  expect(policyViolation('git', ['push'], undefined, 'turbo', true)).toBeNull();
  expect(policyViolation('git', ['push', '--force'], undefined, 'turbo', true)).toContain('Blocked');
});
it('counts cached tokens once and labels configured-price results as estimates', () => {
  const usage = { inputTokens: 100, cachedTokens: 40, outputTokens: 20, known: true }, rates = { input: 2, cached: 0.5, output: 5 };
  expect(costForUsage(usage, rates).costUsd).toBe(0.00024);
  const totals = aggregateUsage([{ id: 'a', output: { usage, rates } }], 0.0001); expect(totals.budgetExceeded).toBe(true); expect(totals.source).toContain('estimate');
});
it('does not invent costs when provider usage or model rates are unavailable', () => {
  expect(costForUsage(null, {})).toMatchObject({ known: false, costUsd: null });
  expect(costForUsage({ inputTokens: 10, outputTokens: 2 }, null).known).toBe(false);
  expect(aggregateUsage([{ id: 'a', output: { usage: { known: false } } }]).unknownAttempts).toBe(1);
});
it('probes actual HTTP connectivity with no special success for a demo address', async () => {
  const server = http.createServer((_req, res) => { res.writeHead(200); res.end('reachable'); }); await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const entry = await s.mcpService.save({ name: 'fixture', transport: 'http', enabled: true, endpoint: `http://127.0.0.1:${server.address().port}` });
    expect(await s.mcpService.probe(entry.id)).toMatchObject({ status: 'reachable', check: 'connectivity-only' });
    const unavailable = await s.mcpService.save({ name: 'missing', transport: 'http', enabled: true, endpoint: 'http://127.0.0.1:1' }); expect((await s.mcpService.probe(unavailable.id)).status).toBe('offline');
  } finally { await new Promise(r => server.close(r)); }
});
it('stdio probe checks executable presence without claiming tool handshake', async () => {
  const entry = await s.mcpService.save({ name: 'node', transport: 'stdio', enabled: true, endpoint: process.execPath });
  const result = await s.mcpService.probe(entry.id); expect(result.status).toBe('reachable'); expect(result.detail).toContain('not checked');
  await s.mcpService.save({ ...entry, enabled: false }); expect((await s.mcpService.probe(entry.id)).status).toBe('offline');
});
it('rejects credential-bearing MCP URLs and invalid governance data', async () => {
  await expect(s.mcpService.save({ name: 'bad', enabled: true, transport: 'http', endpoint: 'https://u:p@host' })).rejects.toMatchObject({ code: 40001 });
  await expect(s.governanceService.saveTerm({ term: '', aliases: [] })).rejects.toMatchObject({ code: 40001 });
});
it('blocks policy violations in validation before executing commands', async () => {
  const caps = await s.capabilityService.list(), p = compileWorkflow(parseGoal('run'), { command: 'git', args: ['push', '--force'] }, caps);
  expect(validatePlan(p, { capabilities: caps }).some(i => i.code === 'EXECUTION_POLICY' && i.severity === 'error')).toBe(true);
});
