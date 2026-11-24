import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { createProviderService } from '../backend/services/providerService.js';
import { createCapabilityService } from '../backend/services/capabilityService.js';
import { runProcess, cleanEnvironment } from '../backend/sandbox/processRunner.js';
import { inside, matchesScope } from '../backend/sandbox/pathPolicy.js';
import { worktreeTool, invokeNative } from '../backend/adapters/nativeApi.js';
import { parseCliOutput } from '../backend/adapters/cliStream.js';
import { invokeAcp } from '../backend/adapters/acp.js';
import { createApp } from '../backend/server.js';
let dir, providers, caps;
beforeEach(async () => { dir = await mkdtemp(path.join(os.tmpdir(), 'vto-cap-')); providers = createProviderService(dir); caps = createCapabilityService(dir, providers); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });
const config = extra => ({ id: 'p', name: 'Local protocol fixture', baseUrl: 'http://127.0.0.1:1/v1', protocol: 'openai', model: 'fixture', apiKey: 'very-private-key', ...extra });
const request = extra => ({ cwd: dir, fileScope: ['src/**'], permissionTier: 'supervised', title: 'task', ...extra });

describe('Provider, capabilities and processes', () => {
  it('stores secrets separately and never returns them in public views', async () => {
    const saved = await providers.save(config()); expect(saved).not.toHaveProperty('apiKey'); expect(saved.hasApiKey).toBe(true);
    expect(JSON.stringify(await providers.list())).not.toContain('very-private-key');
    expect((await providers.resolve('p')).apiKey).toBe('very-private-key');
    expect(await providers.redact('very-private-key Bearer token123')).toBe('[REDACTED] Bearer [REDACTED]');
    await providers.save(config({ apiKey: '' })); await expect(providers.resolve('p')).rejects.toMatchObject({ code: 50301 });
  });
  it.each(['http://remote.test/v1', 'https://u:p@test/v1', 'https://test/v1?secret=1', 'file:///etc/passwd'])('rejects unsafe configuration %s', async baseUrl => { await expect(providers.save(config({ baseUrl }))).rejects.toMatchObject({ code: 40001 }); });
  it('validates key headers and rates', async () => {
    await expect(providers.save(config({ apiKey: 'a\nb' }))).rejects.toMatchObject({ code: 40001 });
    await expect(providers.save(config({ rates: { input: -1, cached: 0, output: 1 } }))).rejects.toMatchObject({ code: 40001 });
  });
  it('retains legacy provider configuration without exposing its key', async () => {
    const p = createProviderService(dir, { enabled: true, endpoint: 'http://127.0.0.1:1/v1/chat/completions', apiKey: 'legacy-key', model: 'old' });
    expect((await p.list())[0]).toMatchObject({ id: 'legacy-llm', hasApiKey: true }); expect((await p.resolve('legacy-llm')).baseUrl).toBe('http://127.0.0.1:1/v1');
  });
  it('executes a real process and captures exit codes', async () => {
    const r = await runProcess(process.execPath, ['-e', 'console.log("done");process.exit(7)'], request());
    expect(r.exitCode).toBe(7); expect(r.stdout).toContain('done'); expect(r.outcome).toBe('task_failure');
  });
  it('classifies missing executable as environment fault', async () => { expect((await runProcess('vto-nonexistent-executable-123', [], request())).outcome).toBe('env_fault'); });
  it('cancels a running process', async () => {
    const controller = new AbortController(); const running = runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], request({ signal: controller.signal }));
    setTimeout(() => controller.abort(), 50); expect((await running).outcome).toBe('aborted');
  });
  it('enforces time and output limits', async () => {
    expect((await runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], request({ timeoutMs: 50 }))).reason).toBe('timeout');
    expect((await runProcess(process.execPath, ['-e', 'console.log("x".repeat(3000))'], request({ maxBytes: 100 }))).reason).toBe('output_limit');
  });
  it('does not inherit secret environment variables implicitly', () => {
    process.env.VTO_FIXTURE_SECRET = 'private'; try { expect(cleanEnvironment()).not.toHaveProperty('VTO_FIXTURE_SECRET'); expect(cleanEnvironment(['VTO_FIXTURE_SECRET']).VTO_FIXTURE_SECRET).toBe('private'); } finally { delete process.env.VTO_FIXTURE_SECRET; }
  });
  it('opens a circuit after three failures and blocks dispatch', async () => {
    await caps.save({ id: 'bad', name: 'bad', transport: 'local', enabled: true });
    for (let i = 0; i < 3; i++) await caps.invoke('bad', request({ command: process.execPath, args: ['-e', 'process.exit(1)'] }));
    expect((await caps.get('bad')).circuit).toBe('open'); await expect(caps.invoke('bad', request())).rejects.toMatchObject({ code: 40002 });
    await caps.probe('bad'); expect((await caps.get('bad')).circuit).toBe('closed');
  });
  it('disabling a capability blocks dispatch and survives a new service instance', async () => {
    await caps.save({ id: 'simulated', name: 'sim', transport: 'simulated', enabled: false });
    await expect(createCapabilityService(dir, providers).invoke('simulated', request())).rejects.toMatchObject({ code: 40002 });
  });
  it('parses CLI JSONL text and usage', () => {
    const parsed = parseCliOutput('{"item":{"text":"artifact ready"}}\n{"usage":{"input_tokens":12,"output_tokens":4}}\n');
    expect(parsed.output).toBe('artifact ready'); expect(parsed.usage.inputTokens).toBe(12);
  });
});

describe('Workspace model tools and protocol transports', () => {
  it('writes actual scoped files and lists/reads them', async () => {
    await worktreeTool('write_file', { path: 'src/a.txt', content: 'hello' }, request());
    expect(await worktreeTool('read_file', { path: 'src/a.txt' }, request())).toBe('hello');
    expect(await worktreeTool('list_dir', { path: 'src' }, request())).toContain('a.txt');
  });
  it.each(['../outside', '/etc/passwd', '.git/config'])('blocks path escape %s', async file => { await expect(inside(dir, file)).rejects.toThrow(); });
  it('rejects symlink escapes including dangling links', async () => {
    await symlink(os.tmpdir(), path.join(dir, 'escape'));
    await expect(inside(dir, 'escape/new-file')).rejects.toThrow();
    await symlink(path.join(os.tmpdir(), 'vto-uncreated-target-abc'), path.join(dir, 'broken'));
    await expect(inside(dir, 'broken')).rejects.toThrow();
  });
  it('enforces assigned scope and read-only/strict permission', async () => {
    expect(matchesScope('src/a.js', ['src/**'])).toBe(true); expect(matchesScope('src-other/a', ['src/**'])).toBe(false);
    await expect(worktreeTool('write_file', { path: 'other/a', content: 'x' }, request())).rejects.toThrow();
    await expect(worktreeTool('write_file', { path: 'src/a', content: 'x' }, request({ readOnly: true }))).rejects.toThrow();
    await expect(worktreeTool('write_file', { path: 'src/a', content: 'x' }, request({ permissionTier: 'strict' }))).rejects.toThrow();
  });
  it('runs a full local HTTP model tool-call conversation without real credentials', async () => {
    let calls = 0;
    const server = http.createServer(async (req, res) => {
      let body = ''; for await (const c of req) body += c; const parsed = JSON.parse(body); calls++;
      res.setHeader('Content-Type', 'application/json');
      if (calls === 1) res.end(JSON.stringify({ choices: [{ message: { content: '', tool_calls: [{ id: 't1', function: { name: 'write_file', arguments: JSON.stringify({ path: 'src/output.txt', content: 'actual artifact' }) } }] } }], usage: { prompt_tokens: 10, completion_tokens: 3 } }));
      else { expect(parsed.messages.at(-1).role).toBe('tool'); res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'Created output.txt' } }], usage: { prompt_tokens: 20, completion_tokens: 4 } })); }
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    try {
      const r = await invokeNative(config({ baseUrl: `http://127.0.0.1:${server.address().port}` }), request());
      expect(r.outcome).toBe('completed'); expect(r.usage.inputTokens).toBe(30); expect(calls).toBe(2);
      expect(await readFile(path.join(dir, 'src/output.txt'), 'utf8')).toBe('actual artifact');
    } finally { await new Promise(r => server.close(r)); }
  });
  it('does not invent success on malformed or rejected model responses', async () => {
    const r = await invokeNative(config(), request(), { post: async () => ({ status: 200, data: {} }) }); expect(r.outcome).toBe('task_failure');
    expect((await invokeNative(config(), request(), { post: async () => ({ status: 429 }) })).outcome).toBe('rate_limited');
  });
  it('uses ACP server session ID after ordered initialization', async () => {
    const file = path.join(dir, 'acp.cjs');
    await writeFile(file, `const rl=require('readline').createInterface({input:process.stdin});rl.on('line',l=>{const r=JSON.parse(l);let result;if(r.id===1)result={protocolVersion:1};if(r.id===2)result={sessionId:'server-session'};if(r.id===3){if(r.params.sessionId!=='server-session')process.exit(7);console.log(JSON.stringify({jsonrpc:'2.0',method:'session/update',params:{update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'ACP result'}}}}));result={stopReason:'end_turn'};}if(result)console.log(JSON.stringify({jsonrpc:'2.0',id:r.id,result}));});`);
    const r = await invokeAcp({ command: process.execPath, args: [file] }, request()); expect(r.outcome).toBe('completed'); expect(r.output).toBe('ACP result');
  });
  it('protects management endpoints and limits browser bootstrap', async () => {
    const app = createApp({ storageDir: dir, sessionToken: 'fixture-session' });
    const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    const url = `http://127.0.0.1:${server.address().port}/api`;
    try {
      expect((await fetch(`${url}/providers`)).status).toBe(401);
      expect((await fetch(`${url}/providers`, { headers: { Authorization: 'Bearer fixture-session' } })).status).toBe(200);
      expect((await fetch(`${url}/local-session`, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status).toBe(403);
      expect((await fetch(`${url}/local-session`, { headers: { 'Sec-Fetch-Site': 'same-origin' } })).status).toBe(200);
    } finally { await app.locals.services.runService.close(); await new Promise(r => server.close(r)); }
  });
});

it('enforces strict approval before launching local mutation', async () => {
  await expect(caps.invoke('local-tool', request({ permissionTier: 'strict', command: process.execPath, args: ['-e', 'process.exit(0)'] }))).rejects.toMatchObject({ code: 40002 });
});
it('redacts actual command output and streamed chunks before persistence', async () => {
  await providers.save(config()); const chunks = [];
  const r = await caps.invoke('local-tool', request({ command: process.execPath, args: ['-e', 'console.log("very-private-key")'], onChunk: (_role, text) => chunks.push(text) }));
  expect(r.outcome).toBe('completed'); expect(r.output).toContain('[REDACTED]'); expect(chunks.join('')).not.toContain('very-private-key');
});
it('supports Anthropic tool results and cached usage accounting', async () => {
  let calls = 0;
  const fake = { post: async (_url, body) => {
    calls++;
    if (calls === 1) return { status: 200, data: { content: [{ type: 'tool_use', id: 'a1', name: 'write_file', input: { path: 'src/a', content: 'written' } }], usage: { input_tokens: 5, cache_read_input_tokens: 3, output_tokens: 2 } } };
    expect(body.messages.at(-1).content[0].type).toBe('tool_result');
    return { status: 200, data: { content: [{ type: 'text', text: 'done' }], usage: { input_tokens: 6, output_tokens: 2 } } };
  } };
  const r = await invokeNative(config({ protocol: 'anthropic' }), request(), fake);
  expect(r.outcome).toBe('completed'); expect(r.usage).toMatchObject({ inputTokens: 14, cachedTokens: 3, outputTokens: 4 });
});
it('labels native capability probes as configuration checks, not live access', async () => {
  await providers.save(config()); await caps.save({ id: 'native-api', name: 'api', transport: 'native', enabled: true, providerId: 'p' });
  expect(await caps.probe('native-api')).toMatchObject({ ok: true, check: 'configuration' });
});
it('blocks a workspace symlink that resolves to protected Git metadata', async () => {
  await mkdir(path.join(dir,'.git'));await writeFile(path.join(dir,'.git','config'),'protected');await symlink(path.join(dir,'.git'),path.join(dir,'alias'));
  await expect(inside(dir,'alias/config')).rejects.toThrow();
});
