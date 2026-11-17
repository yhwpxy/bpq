import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../backend/server.js';
import { readLlmConfig } from '../backend/config/llm.js';
const spec = { source: '自然语言示例', detectedFormat: 'numbered', tasks: [{ key: '1', name: '完成需求', type: 'task', dependsOn: [] }, { key: '2', name: '结束流程', type: 'end', dependsOn: ['1'] }] };
const configured = () => readLlmConfig({ LLM_API_KEY: 'api-fixture-key', LLM_BASE_URL: 'https://fixture.invalid/v1', LLM_MODEL: 'fixture-model' });
const success = () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(spec) } }] }));
let directory, app, server, url;
beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), 'vto-nl-api-')); });
afterEach(async () => { if (app) await app.locals.services.runService.close(); if (server) await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); app = undefined; server = undefined; });
async function start(options) { app = createApp({ storageDir: directory, ...options }); await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); }); url = `http://127.0.0.1:${server.address().port}`; }
async function request(route, method = 'GET', body) { const response = await fetch(`${url}/api${route}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); return { status: response.status, body: await response.json() }; }

describe('自然语言REST接口', () => {
  it('缺配置status明确disabled，POST返回50301，规则路径照常工作', async () => {
    const fetchImpl = vi.fn(); await start({ llmConfig: readLlmConfig({}), fetchImpl });
    expect(await request('/decompose-nl/status')).toEqual({ status: 200, body: { enabled: false, code: 50301, message: expect.stringContaining('LLM_API_KEY') } });
    expect(await request('/decompose-nl', 'POST', { text: '帮我做登录' })).toEqual({ status: 503, body: { code: 50301, message: expect.stringContaining('LLM_API_KEY') } });
    const rules = await request('/decompose', 'POST', { text: '# 规格\n- 普通任务', format: 'auto' }); expect(rules.status).toBe(200); expect(rules.body.ok).toBe(true); expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('有配置status不暴露Key或URL，成功响应严格复用原封装', async () => {
    const fetchImpl = vi.fn(async () => success()); await start({ llmConfig: configured(), fetchImpl });
    expect(await request('/decompose-nl/status')).toEqual({ status: 200, body: { enabled: true } });
    expect(await request('/decompose-nl', 'POST', { text: '完成一个任务然后结束' })).toEqual({ status: 200, body: { ok: true, taskSpec: spec } }); expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('非法输入、额外字段与超大UTF8请求返回40001，不请求模型', async () => {
    const fetchImpl = vi.fn(); await start({ llmConfig: configured(), fetchImpl });
    for (const body of [{}, { text: 1 }, { text: '' }, { text: '需求', apiKey: 'untrusted' }, { text: '字'.repeat(70000) }]) { const result = await request('/decompose-nl', 'POST', body); expect(result.status).toBe(400); expect(result.body.code).toBe(40001); }
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('模型非法JSON和不合法TaskSpec得到可读40001，服务保持可用', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '```json\n{}\n```' } }] }))).mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '{"tasks":[]}' } }] })));
    await start({ llmConfig: configured(), fetchImpl });
    const invalidJson = await request('/decompose-nl', 'POST', { text: '需求' }); expect(invalidJson.status).toBe(400); expect(invalidJson.body.code).toBe(40001); expect(invalidJson.body.message).toContain('JSON');
    const invalidSpec = await request('/decompose-nl', 'POST', { text: '需求' }); expect(invalidSpec.body.code).toBe(40001); expect(invalidSpec.body.details.length).toBeGreaterThan(0);
    expect((await request('/plans')).status).toBe(200);
  });
  it('浏览器断开请求时中止模型请求，不保留后台调用', async () => {
    let upstreamSignal;
    const fetchImpl = vi.fn((_url, options) => {
      upstreamSignal = options.signal;
      return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
    });
    await start({ llmConfig: configured(), fetchImpl });
    const controller = new AbortController();
    const pending = fetch(`${url}/api/decompose-nl`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '需求' }), signal: controller.signal }).catch(error => error);
    for (let i = 0; i < 100 && !upstreamSignal; i++) await new Promise(resolve => setTimeout(resolve, 5));
    expect(upstreamSignal).toBeDefined(); controller.abort(); await pending;
    for (let i = 0; i < 100 && !upstreamSignal.aborted; i++) await new Promise(resolve => setTimeout(resolve, 5));
    expect(upstreamSignal.aborted).toBe(true);
    expect((await request('/plans')).status).toBe(200);
  });
  it('上游错误映射50201，超时映射50401，无未捕获异常', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response('provider secret api-fixture-key', { status: 401 })).mockImplementationOnce(() => new Promise(() => {}));
    await start({ llmConfig: configured(), fetchImpl, llmOptions: { timeoutMs: 25 } });
    const upstream = await request('/decompose-nl', 'POST', { text: '需求' }); expect(upstream.status).toBe(502); expect(upstream.body.code).toBe(50201); expect(JSON.stringify(upstream.body)).not.toContain('api-fixture-key');
    const timeout = await request('/decompose-nl', 'POST', { text: '需求' }); expect(timeout.status).toBe(504); expect(timeout.body.code).toBe(50401);
  });
});
