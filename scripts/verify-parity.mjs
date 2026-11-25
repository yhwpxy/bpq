import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve, join} from 'node:path';
import {tmpdir} from 'node:os';

const root = resolve(import.meta.dirname, '..');
if (!process.argv[2]) throw new Error('Usage: npm run verify:parity -- /absolute/path/to/reference');
const reference = resolve(process.argv[2]);
const expectedCommit = '472cd7a5891a1a1bd22247a53197c78dc637d452';
assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], {cwd: reference, encoding: 'utf8'}).trim(), expectedCommit);
assert.equal(execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {cwd: reference, encoding: 'utf8'}).trim(), '', 'Reference tracked files must be clean');
process.env.ORCH_OFFLINE_VERIFY = '1';
for (const key of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'DEEPSEEK_API_KEY', 'OPENCODE_API_KEY']) delete process.env[key];
const require = createRequire(import.meta.url);
const temporary = mkdtempSync(join(tmpdir(), 'bpq-parity-'));
const runtimes = [];
const routes = JSON.parse(readFileSync(resolve(root, 'docs/api-routes.json'), 'utf8'));
const results = [];
const shape = value => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return [...new Set(value.map(v => JSON.stringify(shape(v))))].sort();
  if (typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, shape(value[k])]));
  return typeof value;
};
async function probe(runtime, route, authenticated = true) {
  const path = route.path.replaceAll(':id', 'missing-id').replaceAll(':revision', '1');
  const controller = new AbortController();
  const response = await fetch(runtime.baseUrl + path, {
    method: route.method,
    headers: {'Content-Type': 'application/json', ...(authenticated ? {Authorization: `Bearer ${runtime.sessionToken}`} : {})},
    body: route.method === 'POST' ? '{}' : undefined,
    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
  });
  if (route.path === '/api/events' && response.ok) {
    const reader = response.body.getReader();
    const chunk = await reader.read();
    const text = new TextDecoder().decode(chunk.value);
    controller.abort();
    assert.match(text, /event: connected/);
    return {status: response.status, contentType: response.headers.get('content-type'), connected: true};
  }
  const body = await response.json();
  return {status: response.status, shape: shape(body), ...(body.code ? {code: body.code} : {}), ...(body.error ? {error: body.error} : {})};
}
try {
  for (const [name, source] of [['reference', reference], ['bpq', root]]) {
    const {createOrchestratorRuntime} = require(resolve(source, 'workflow-orchestrator/dist/server/runtime.cjs'));
    runtimes.push(await createOrchestratorRuntime({dataDir: join(temporary, name), port: 0, seedSample: true}));
  }
  const schemas = runtimes.map(runtime => runtime.store.db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type, name").all());
  assert.deepEqual(schemas[1], schemas[0], 'SQLite tables, indexes and triggers differ');
  for (const route of routes) {
    const pair = [];
    for (const runtime of runtimes) pair.push(await probe(runtime, route));
    assert.deepEqual(pair[1], pair[0], `${route.method} ${route.path} differs`);
    if (route.path !== '/api/health') {
      for (const runtime of runtimes) assert.equal((await probe(runtime, route, false)).status, 401, `${route.path} authentication`);
    }
    results.push({...route, ...pair[1], passed: true});
  }
  const schema = schemas[1].filter(x => x.type === 'table').map(x => ({...x,
    columns: runtimes[1].store.db.prepare(`PRAGMA table_info("${x.name.replaceAll('"', '""')}")`).all(),
    foreignKeys: runtimes[1].store.db.prepare(`PRAGMA foreign_key_list("${x.name.replaceAll('"', '""')}")`).all(),
  }));
  const directory = resolve(root, 'work');
  mkdirSync(directory, {recursive: true});
  writeFileSync(join(directory, 'parity-results.json'), JSON.stringify({referenceCommit: expectedCommit, schemasMatched: true, schemaObjects: schemas[0].length, routes: results}, null, 2) + '\n');
  writeFileSync(join(directory, 'schema-inventory.json'), JSON.stringify(schema, null, 2) + '\n');
  console.log(`PASS: ${schemas[0].length} SQLite schema objects, ${results.length} route probes, ${results.length - 1} auth checks per app and SSE connected frame match.`);
  console.log('Route probes compare status, error code/message and response shape for empty bodies/missing IDs; successful business flows are covered separately by the upstream suites.');
} finally {
  for (const runtime of runtimes.reverse()) await runtime.stop();
  rmSync(temporary, {recursive: true, force: true});
}
