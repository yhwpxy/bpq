import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../backend/server.js';
let directory, app, server, url;
const task = (id, props = {}) => ({ id, type: 'task', x: 160, y: 0, props: { name: id, duration: 30, retry: 0, failRate: 0, ...props } });
const plan = () => ({ id: 'p', name: '接口测试', version: '1.0', createdAt: '2026-11-17T00:00:00Z', updatedAt: '2026-11-17T00:00:00Z', nodes: [{ id: 's', type: 'start', x: 0, y: 0, props: {} }, task('t'), { id: 'e', type: 'end', x: 320, y: 0, props: {} }], edges: [{ id: 'st', source: 's', target: 't' }, { id: 'te', source: 't', target: 'e' }] });
async function request(route, method = 'GET', body) { const response = await fetch(`${url}/api${route}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); return { status: response.status, body: await response.json() }; }
async function waitForRun(id) { for (let i = 0; i < 100; i++) { const { body } = await request(`/runs/${id}`); if (!['RUNNING', 'VALIDATING'].includes(body.status)) return body; await new Promise(resolve => setTimeout(resolve, 10)); } throw new Error('run timeout'); }
beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), 'vto-api-')); app = createApp({ storageDir: directory }); await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); }); url = `http://127.0.0.1:${server.address().port}`; });
afterEach(async () => { await app.locals.services.runService.close(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });

describe('REST 6.7 契约与异常路径', () => {
  it('规格分解返回精确响应封装，识别错误 40003', async () => {
    const valid = await request('/decompose', 'POST', { text: '# 规格\n## 流程\n- 一个任务\n- 输出结果', format: 'auto' });
    expect(valid.status).toBe(200); expect(valid.body.ok).toBe(true); expect(valid.body.taskSpec.detectedFormat).toBe('markdown');
    expect((await request('/decompose', 'POST', { text: '没有结构的文本', format: 'auto' })).body.code).toBe(40003);
    expect((await request('/decompose', 'POST', { text: 3 })).body.code).toBe(40001);
    expect((await request('/decompose', 'POST', { text: '# 规格\n- ' + '字'.repeat(70000) })).body.code).toBe(40003);
  });
  it('方案完整增删改查，成功均 200', async () => {
    const saved = await request('/plans', 'POST', plan()); expect(saved.status).toBe(200); expect(saved.body).toEqual({ id: 'p', updatedAt: expect.any(String) });
    expect((await request('/plans')).body).toHaveLength(1); expect((await request('/plans/p')).body.nodes).toEqual(plan().nodes);
    expect((await request('/plans/p', 'DELETE')).status).toBe(200); expect((await request('/plans/p')).body.code).toBe(40401);
  });
  it('新建时允许不传 id，拒绝损坏 JSON 和非法 Schema', async () => {
    const p = plan(); delete p.id; expect((await request('/plans', 'POST', p)).body.id).toMatch(/^plan_/);
    expect((await request('/plans', 'POST', {})).body.code).toBe(40001);
    const response = await fetch(`${url}/api/plans`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' }); expect(response.status).toBe(400); expect((await response.json()).code).toBe(40001);
  });
  it('执行、增量轮询、持久化恢复运行记录', async () => {
    await request('/plans', 'POST', plan()); const started = await request('/plans/p/execute', 'POST'); expect(started.status).toBe(200);
    const id = started.body.runId; const completed = await waitForRun(id); expect(completed.status).toBe('SUCCESS');
    const since = completed.logs[1].seq; const increment = await request(`/runs/${id}?since=${since}`);
    expect(increment.body.logs.every(l => l.seq > since)).toBe(true); expect(increment.body.nodeStates).toEqual(completed.nodeStates);
    const restored = createApp({ storageDir: directory }); expect(await restored.locals.services.runService.get(id)).toEqual(completed); await restored.locals.services.runService.close();
  });
  it('同方案并发执行只允许一个，执行中不可删除', async () => {
    const p = plan(); p.nodes[1].props.duration = 60000; await request('/plans', 'POST', p);
    const results = await Promise.all([request('/plans/p/execute', 'POST'), request('/plans/p/execute', 'POST')]); expect(results.map(r => r.status).sort()).toEqual([200, 409]); expect(results.find(r => r.status === 409).body.code).toBe(40901);
    expect((await request('/plans/p', 'DELETE')).body.code).toBe(40901);
    const id = results.find(r => r.status === 200).body.runId; expect(await request(`/runs/${id}/cancel`, 'POST')).toEqual({ status: 200, body: { status: 'CANCELED' } }); expect((await request(`/runs/${id}`)).body.status).toBe('CANCELED');
  });
  it('AC-05 服务端拒绝含环图并返回节点级规则，未创建运行', async () => {
    const p = plan(); p.nodes.push(task('b')); p.edges.push({ id: 'tb', source: 't', target: 'b' }, { id: 'bt', source: 'b', target: 't' }); await request('/plans', 'POST', p);
    const response = await request('/plans/p/execute', 'POST'); expect(response.status).toBe(400); expect(response.body.code).toBe(40002); expect(response.body.details).toContainEqual(expect.objectContaining({ rule: 'R2', nodeId: 't' }));
    expect(response.body.details.filter(issue => issue.rule === 'R2').map(issue => issue.nodeId).sort()).toEqual(['b', 't']);
    expect(await readdir(path.join(directory, 'runs')).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error))).toEqual([]);
    expect(app.locals.services.runService.isRunning('p')).toBe(false);
  });
  it('Schema 拒绝不能覆盖已保存方案，也不能创建运行', async () => {
    await request('/plans', 'POST', plan());
    const invalid = plan(); invalid.nodes[1].props.duration = -1;
    const response = await request('/plans', 'POST', invalid);
    expect(response.status).toBe(400); expect(response.body.code).toBe(40001);
    expect(response.body.details).toContainEqual(expect.objectContaining({ nodeId: 't' }));
    expect((await request('/plans/p')).body.nodes[1].props.duration).toBe(30);
    // Simulate damaged-on-disk structured data: execute must validate again.
    await writeFile(path.join(directory, 'plans/p.json'), JSON.stringify(invalid));
    expect((await request('/plans/p/execute', 'POST')).body.code).toBe(40001);
    expect(await readdir(path.join(directory, 'runs')).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error))).toEqual([]);
  });
  it('运行中的方案编辑只影响下一次运行，当前执行快照隔离', async () => {
    const original = plan(); original.nodes[1].props.duration = 200;
    await request('/plans', 'POST', original);
    const firstId = (await request('/plans/p/execute', 'POST')).body.runId;
    const edited = structuredClone(original); edited.name = '修改后的方案'; edited.nodes[1].props.name = '修改后的任务'; edited.nodes[1].props.duration = 0; edited.nodes[1].props.failRate = 1;
    expect((await request('/plans', 'POST', edited)).status).toBe(200);
    const first = await waitForRun(firstId); expect(first.status).toBe('SUCCESS'); expect(first.planName).toBe('接口测试');
    expect(first.logs.filter(log => log.nodeId === 't').every(log => log.nodeName === 't')).toBe(true);
    const secondId = (await request('/plans/p/execute', 'POST')).body.runId;
    const second = await waitForRun(secondId); expect(second.status).toBe('FAILED'); expect(second.planName).toBe('修改后的方案'); expect(second.nodeStates.e.status).toBe('SKIPPED');
  });
  it('40401/40402 和非法 since', async () => {
    expect((await request('/plans/missing')).body.code).toBe(40401); expect((await request('/plans/missing/execute', 'POST')).body.code).toBe(40401);
    expect((await request('/runs/missing')).body.code).toBe(40402); expect((await request('/runs/missing/cancel', 'POST')).body.code).toBe(40402); expect((await request('/runs/missing?since=-1')).body.code).toBe(40001);
  });
  it('结构损坏的持久化快照返回 50000，服务仍可用', async () => {
    await request('/plans', 'POST', plan()); const { body } = await request('/plans/p/execute', 'POST'); await waitForRun(body.runId);
    await writeFile(path.join(directory, 'runs', `${body.runId}.json`), '{}');
    const other = createApp({ storageDir: directory }); await expect(other.locals.services.runService.get(body.runId)).rejects.toMatchObject({ code: 50000 }); expect((await request('/plans')).status).toBe(200);
  });
});
