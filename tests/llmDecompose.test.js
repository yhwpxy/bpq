import { afterEach, describe, it, expect, vi } from 'vitest';
import { createLlmDecomposeService } from '../backend/services/llmDecomposeService.js';
import { readLlmConfig } from '../backend/config/llm.js';
import { taskSpecToPlan } from '../shared/plan.js';
import { createRun } from '../backend/engine/scheduler.js';
const config = () => readLlmConfig({ LLM_API_KEY: 'fixture-key', LLM_BASE_URL: 'https://fixture.test/v1', LLM_MODEL: 'fixture-model' });
const spec = () => ({ source: '登录流程', detectedFormat: 'numbered', tasks: [
  { key: '1', name: '校验账号密码', type: 'task', dependsOn: [], output: 'passed' },
  { key: '2', name: '判断认证结果', type: 'condition', dependsOn: ['1'], expression: 'passed == true' },
  { key: '3', name: '跳转首页', type: 'task', dependsOn: ['2'], branch: 'true' },
  { key: '4', name: '提示错误', type: 'task', dependsOn: ['2'], branch: 'false' },
  { key: '5', name: '结束流程', type: 'end', dependsOn: ['3', '4'] },
] });
const response = (value = spec(), extra = {}) => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: typeof value === 'string' ? value : JSON.stringify(value) }, ...extra }] }), { status: 200 });
const service = (fetchImpl, options = {}) => createLlmDecomposeService({ config: config(), fetchImpl, ...options });
afterEach(() => vi.useRealTimers());

describe('自然语言分解模型服务', () => {
  it('返回合法TaskSpec且可生成画布并执行，模型使用真实契约字段', async () => {
    const fetchImpl = vi.fn(async () => response()); const client = service(fetchImpl);
    const result = await client.decompose('  帮我做登录功能，成功去首页，失败提示  ');
    expect(result).toEqual(spec()); expect(client.status()).toEqual({ enabled: true });
    const [url, options] = fetchImpl.mock.calls[0]; expect(url).toBe('https://fixture.test/v1/chat/completions'); expect(options.redirect).toBe('error'); expect(options.headers.Authorization).toBe('Bearer fixture-key');
    const payload = JSON.parse(options.body); expect(payload.model).toBe('fixture-model'); expect(payload.stream).toBe(false);
    expect(payload.messages[0].role).toBe('system'); expect(payload.messages[0].content).toContain('dependsOn'); expect(payload.messages[1]).toEqual({ role: 'user', content: '帮我做登录功能，成功去首页，失败提示' });
    expect(payload).not.toHaveProperty('response_format');
    const plan = taskSpecToPlan(result); plan.nodes.filter(node => node.type === 'task').forEach(node => { node.props.duration = 0; });
    const completed = await createRun(plan).done; expect(completed.status).toBe('SUCCESS'); expect(Object.values(completed.nodeStates).filter(state => state.status === 'SKIPPED')).toHaveLength(1);
  });
  it.each(['not json', '```json\n{}\n```', '{"source":', '{} explanation'])('非法模型JSON返回40001：%s', async value => { await expect(service(async () => response(value)).decompose('需求')).rejects.toMatchObject({ code: 40001, message: expect.stringContaining('JSON') }); });
  it('未配置API Key返回50301，不发出模型请求', async () => {
    const fetchImpl = vi.fn(); const client = service(fetchImpl, { config: readLlmConfig({}) });
    expect(client.status()).toEqual({ enabled: false, code: 50301, message: expect.stringContaining('LLM_API_KEY') });
    await expect(client.decompose('登录功能')).rejects.toMatchObject({ code: 50301 }); expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each(['', '  ', 1, null])('非法输入不请求模型：%s', async text => { const fetchImpl = vi.fn(); await expect(service(fetchImpl).decompose(text)).rejects.toMatchObject({ code: 40001 }); expect(fetchImpl).not.toHaveBeenCalled(); });
  it('UTF8需求超过200KB不请求模型', async () => { const fetchImpl = vi.fn(); await expect(service(fetchImpl).decompose('字'.repeat(70000))).rejects.toMatchObject({ code: 40001, message: expect.stringContaining('200KB') }); expect(fetchImpl).not.toHaveBeenCalled(); });
  it.each([
    value => { value.tasks[0].dependsOn = '2'; },
    value => { value.tasks[1].dependsOn = ['missing']; },
    value => { value.tasks[0].dependsOn = ['2']; },
    value => { value.tasks[2].branch = true; },
    value => { value.tasks[0].id = 'invented-field'; },
  ])('拒绝结构、字段或依赖不合法的TaskSpec', async mutate => { const value = spec(); mutate(value); await expect(service(async () => response(value)).decompose('需求')).rejects.toMatchObject({ code: 40001, details: expect.any(Array) }); });
  it('不允许偷偷扩充detectedFormat或伪称AI输入为Markdown', async () => { const value = spec(); value.detectedFormat = 'markdown'; await expect(service(async () => response(value)).decompose('需求')).rejects.toMatchObject({ code: 40001, details: expect.arrayContaining([expect.objectContaining({ path: 'detectedFormat' })]) }); });
  it('禁止未经解析的条件代码与没有上游来源的变量', async () => {
    for (const expression of ['process.exit()', 'missing == true']) { const value = spec(); value.tasks[1].expression = expression; await expect(service(async () => response(value)).decompose('需求')).rejects.toMatchObject({ code: 40001, details: expect.any(Array) }); }
  });
  it('拒绝孤立分支标记和实际串行的并行组', async () => {
    const orphan = spec(); orphan.tasks[0].branch = 'true';
    await expect(service(async () => response(orphan)).decompose('需求')).rejects.toMatchObject({ code: 40001, details: expect.arrayContaining([expect.objectContaining({ path: 'tasks[0].branch' })]) });
    const grouped = spec(); grouped.tasks[0].parallelGroup = 1; grouped.tasks[2].parallelGroup = 1;
    await expect(service(async () => response(grouped)).decompose('需求')).rejects.toMatchObject({ code: 40001, details: expect.arrayContaining([expect.objectContaining({ path: 'tasks[2].parallelGroup' })]) });
  });
  it('分支继承必须与最近条件信号一致，合流后不得遗留单侧标签', async () => {
    const inherited = spec(); inherited.tasks.splice(3, 0, { key: '3.1', name: '记录成功日志', type: 'task', dependsOn: ['3'], branch: 'true' }); inherited.tasks.at(-1).dependsOn = ['3.1', '4'];
    await expect(service(async () => response(inherited)).decompose('需求')).resolves.toEqual(inherited);
    inherited.tasks.find(task => task.key === '3.1').branch = 'false';
    await expect(service(async () => response(inherited)).decompose('需求')).rejects.toMatchObject({ code: 40001 });
    const joined = spec(); joined.tasks.at(-1).branch = 'true';
    await expect(service(async () => response(joined)).decompose('需求')).rejects.toMatchObject({ code: 40001 });
  });
  it('条件缺少false分支不能作为成功结果返回', async () => { const value = spec(); value.tasks[3].branch = 'true'; await expect(service(async () => response(value)).decompose('需求')).rejects.toMatchObject({ code: 40001 }); });
  it('拒绝模型截断、拒绝回答、空内容和错误协议', async () => {
    await expect(service(async () => response(spec(), { finish_reason: 'length' })).decompose('需求')).rejects.toMatchObject({ code: 40001 });
    await expect(service(async () => response('')).decompose('需求')).rejects.toMatchObject({ code: 40001 });
    await expect(service(async () => new Response('not json')).decompose('需求')).rejects.toMatchObject({ code: 50201 });
    await expect(service(async () => new Response('{}')).decompose('需求')).rejects.toMatchObject({ code: 40001 });
  });
  it.each([401, 403, 429, 500])('上游HTTP%s转50201，不回传原始敏感响应、不自动重试', async status => {
    const fetchImpl = vi.fn(async () => new Response('secret upstream details fixture-key', { status }));
    const error = await service(fetchImpl).decompose('需求').catch(e => e); expect(error.code).toBe(50201); expect(error.message).not.toContain('fixture-key'); expect(error.message).not.toContain('secret'); expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('网络错误脱敏，不泄漏包含密钥的异常', async () => { const client = service(async () => { throw new Error('Authorization Bearer fixture-key'); }); const error = await client.decompose('需求').catch(e => e); expect(error.code).toBe(50201); expect(error.message).not.toContain('fixture-key'); });
  it('请求超时包括连接阶段，返回50401并abort', async () => {
    vi.useFakeTimers(); let signal; const client = service(async (_url, options) => { signal = options.signal; return new Promise(() => {}); }, { timeoutMs: 40 });
    const pending = expect(client.decompose('需求')).rejects.toMatchObject({ code: 50401 }); await vi.advanceTimersByTimeAsync(41); await pending; expect(signal.aborted).toBe(true);
  });
  it('响应body不结束也受同一总超时限制', async () => {
    vi.useFakeTimers(); const client = service(async () => new Response(new ReadableStream({ start() {} })), { timeoutMs: 40 });
    const pending = expect(client.decompose('需求')).rejects.toMatchObject({ code: 50401 }); await vi.advanceTimersByTimeAsync(41); await pending;
  });
  it('客户端取消会中止上游请求', async () => {
    let upstream; const abort = new AbortController(); const client = service(async (_url, options) => { upstream = options.signal; return new Promise(() => {}); });
    const pending = expect(client.decompose('需求', { signal: abort.signal })).rejects.toMatchObject({ code: 50201, message: expect.stringContaining('取消') }); abort.abort(); await pending; expect(upstream.aborted).toBe(true);
  });
  it('响应大小限制在读取过程中生效', async () => { await expect(service(async () => response(), { maxResponseBytes: 32 }).decompose('需求')).rejects.toMatchObject({ code: 50201, message: expect.stringContaining('过大') }); });
});
