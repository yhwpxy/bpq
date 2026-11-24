/** Only Playwright starts this isolated fixture. Never reads .env or real API keys.
 * Actual frontend, HTTP routes, adapter, validators and engine run against a
 * local Chat Completions protocol fixture, with disposable JSON storage.
 */
import http from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../../backend/server.js';
import { readLlmConfig } from '../../backend/config/llm.js';
const spec = JSON.parse(await readFile(new URL('../fixtures/nl-login-task-spec.json', import.meta.url), 'utf8'));
const storageDir = await mkdtemp(path.join(os.tmpdir(), 'vto-e2e-'));
const providers = [];
let app, server, stopping = false;
const listen = (service, port) => new Promise((resolve, reject) => { service.once('error', reject); service.listen(port, '127.0.0.1', resolve); });
const close = service => service && new Promise(resolve => { service.close(resolve); service.closeAllConnections?.(); });
async function stop() {
  if (stopping) return; stopping = true;
  await app?.locals.services.runService.close();
  await close(server); await Promise.all(providers.map(close));
  await rm(storageDir, { recursive: true, force: true });
}
process.once('SIGTERM', () => { void stop().then(() => process.exit(0)); });
process.once('SIGINT', () => { void stop().then(() => process.exit(0)); });
try {
  const provider = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
      if (req.url !== '/v1/chat/completions' || req.method !== 'POST' || req.headers.authorization !== 'Bearer e2e-fixture-key') throw new Error('Unexpected provider request');
      let raw = ''; for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 1024*1024) throw new Error('Fixture input limit'); }
      const body = JSON.parse(raw);
      if (body.model !== 'e2e-fixture-model' || body.stream !== false || body.messages?.[0]?.role !== 'system' || body.messages?.[1]?.role !== 'user' || (!body.messages[0].content.includes('dependsOn') && !body.messages[0].content.includes('GoalSpec'))) throw new Error('Unexpected request contract');
      const result = body.messages[0].content.includes('GoalSpec') ? { title:'自然语言契约',goal:body.messages[1].content,requirements:[{id:'FR-01',text:'处理发票'}],acceptanceCriteria:[{id:'AC-01',text:'输出核对报告',requirementRefs:['FR-01']}],inputs:[{id:'IN-01',text:'发票数组',name:'invoices',type:'array',required:true}],outputs:[{id:'OUT-01',text:'核对报告',name:'report',type:'file',required:true}],constraints:[{id:'CON-01',text:'不得修改原始文件'}],assumptions:[],modules:[] } : spec;
    res.end(JSON.stringify({ id: 'fixture-completion', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(result) } }] }));
    } catch { res.statusCode=400;res.end(JSON.stringify({error:{message:'Invalid fixture request'}})); }
  });
  providers.push(provider); await listen(provider, 0);
  const llmConfig = readLlmConfig({ LLM_API_KEY:'e2e-fixture-key', LLM_BASE_URL:`http://127.0.0.1:${provider.address().port}/v1`, LLM_MODEL:'e2e-fixture-model' });
  app = createApp({ storageDir, llmConfig });
  server = http.createServer(app); await listen(server, 4173);
  console.log('VTO isolated browser fixture ready on http://127.0.0.1:4173 (local model substitute)');
} catch (error) { await stop(); console.error(error.message); process.exitCode=1; }
