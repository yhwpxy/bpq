import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRun } from '../backend/engine/scheduler.js';
const n = (id, type = 'task', props = {}) => ({ id, type, x: 0, y: 0, props: type === 'task' ? { name: id, duration: 10, retry: 0, failRate: 0, ...props } : props });
const edge = (source, target, label) => ({ id: `${source}_${target}`, source, target, ...(label ? { label } : {}) });
const base = (nodes, edges, meta = {}) => ({ id: 'p', name: '运行测试', version: '1.0', createdAt: '2026-11-17T00:00:00Z', updatedAt: '2026-11-17T00:00:00Z', nodes, edges, meta });
function parallel() { return base([n('s', 'start'), n('f', 'task', { duration: 0 }), n('a'), n('b'), n('j'), n('e', 'end')], [edge('s', 'f'), edge('f', 'a'), edge('f', 'b'), edge('a', 'j'), edge('b', 'j'), edge('j', 'e')]); }
function branch(expression = 'passed == true') { return base([n('s', 'start'), n('t', 'task', { output: 'passed' }), n('c', 'condition', { expression }), n('a'), n('b'), n('e', 'end')], [edge('s', 't'), edge('t', 'c'), edge('c', 'a', 'true'), edge('c', 'b', 'false'), edge('a', 'e'), edge('b', 'e')]); }
afterEach(() => vi.useRealTimers());

describe('调度器语义与运行状态', () => {
  it('AC-06 并行任务同时 RUNNING，join 等待全部入边', async () => {
    vi.useFakeTimers(); const observed = []; const run = createRun(parallel(), { onUpdate: s => observed.push(s) });
    await vi.runAllTimersAsync(); const result = await run.done;
    expect(result.status).toBe('SUCCESS');
    expect(observed.some(s => s.nodeStates.a.status === 'RUNNING' && s.nodeStates.b.status === 'RUNNING')).toBe(true);
    const joinStart = result.logs.find(l => l.nodeId === 'j' && l.event === 'start').seq;
    expect(result.logs.find(l => l.nodeId === 'a' && l.event === 'success').seq).toBeLessThan(joinStart);
    expect(result.logs.find(l => l.nodeId === 'b' && l.event === 'success').seq).toBeLessThan(joinStart);
  });
  it('全局并发上限为 1 时无重叠', async () => {
    vi.useFakeTimers(); const p = parallel(); p.meta.maxConcurrency = 1;
    const counts = []; const run = createRun(p, { onUpdate: s => counts.push(Object.values(s.nodeStates).filter(n => n.status === 'RUNNING').length) });
    await vi.runAllTimersAsync(); await run.done; expect(Math.max(...counts)).toBe(1);
  });
  it.each([['passed == true', 'a', 'b'], ['false', 'b', 'a']])('条件 %s 正确路由，输出可用', async (expression, active, inactive) => {
    vi.useFakeTimers(); const run = createRun(branch(expression)); await vi.runAllTimersAsync(); const result = await run.done;
    expect(result.status).toBe('SUCCESS'); expect(result.nodeStates[active].status).toBe('SUCCESS'); expect(result.nodeStates[inactive].status).toBe('SKIPPED'); expect(result.nodeStates.e.status).toBe('SUCCESS'); expect(result.nodeStates.t.output).toEqual({ passed: true });
  });
  it('AC-07 失败按 500ms × attempt 重试并向所有下游传播', async () => {
    vi.useFakeTimers(); const p = parallel(); Object.assign(p.nodes.find(n => n.id === 'a').props, { retry: 2, failRate: 1 });
    const run = createRun(p); await vi.runAllTimersAsync(); const result = await run.done;
    expect(result.status).toBe('FAILED'); expect(result.nodeStates.a.attempt).toBe(3); expect(result.nodeStates.j.status).toBe('SKIPPED'); expect(result.nodeStates.e.status).toBe('SKIPPED'); expect(result.nodeStates.b.status).toBe('SUCCESS');
    expect(result.logs.filter(l => l.event === 'retry').map(l => l.message)).toEqual(['第 1 次尝试失败，500ms 后重试', '第 2 次尝试失败，1000ms 后重试']);
  });
  it('重试恢复成功后正常执行下游', async () => {
    vi.useFakeTimers(); const p = parallel(); Object.assign(p.nodes.find(n => n.id === 'a').props, { retry: 1, failRate: 0.5 }); let calls = 0;
    const run = createRun(p, { random: () => (++calls === 2 ? 0 : 1) }); await vi.runAllTimersAsync(); const result = await run.done;
    expect(result.status).toBe('SUCCESS'); expect(result.nodeStates.a.attempt).toBe(2);
  });
  it('continueOnError 忽略上游失败继续执行，但运行最终仍 FAILED', async () => {
    vi.useFakeTimers(); const p = parallel(); p.meta.continueOnError = true; p.nodes.find(n => n.id === 'a').props.failRate = 1;
    const run = createRun(p); await vi.runAllTimersAsync(); const result = await run.done;
    expect(result.status).toBe('FAILED'); expect(result.nodeStates.j.status).toBe('SUCCESS'); expect(result.nodeStates.e.status).toBe('SUCCESS');
  });
  it('未激活嵌套条件内部 join 不会意外执行', async () => {
    vi.useFakeTimers(); const p = base([n('s', 'start'), n('c', 'condition', { expression: 'false' }), n('inner', 'condition', { expression: 'true' }), n('a'), n('b'), n('join'), n('active'), n('e', 'end')], [edge('s', 'c'), edge('c', 'inner', 'true'), edge('c', 'active', 'false'), edge('inner', 'a', 'true'), edge('inner', 'b', 'false'), edge('a', 'join'), edge('b', 'join'), edge('join', 'e'), edge('active', 'e')]);
    const run = createRun(p); await vi.runAllTimersAsync(); const result = await run.done;
    for (const id of ['inner', 'a', 'b', 'join']) expect(result.nodeStates[id].status).toBe('SKIPPED');
    expect(result.nodeStates.e.status).toBe('SUCCESS');
  });
  it('取消正在等待的任务和未开始节点，无迟到成功覆盖', async () => {
    vi.useFakeTimers(); const p = parallel(); p.nodes.find(n => n.id === 'a').props.duration = 60000;
    const run = createRun(p); await vi.advanceTimersByTimeAsync(1); expect(run.snapshot.nodeStates.a.status).toBe('RUNNING'); run.cancel();
    await vi.runAllTimersAsync(); const result = await run.done;
    expect(result.status).toBe('CANCELED'); expect(result.nodeStates.a.status).toBe('CANCELED'); expect(result.nodeStates.j.status).toBe('CANCELED');
    expect(result.logs.some(l => l.nodeId === 'a' && l.event === 'success')).toBe(false);
  });
  it('delay 等待指定时间', async () => {
    vi.useFakeTimers(); const p = base([n('s', 'start'), n('d', 'delay', { wait: 200 }), n('e', 'end')], [edge('s', 'd'), edge('d', 'e')]);
    const run = createRun(p); await vi.advanceTimersByTimeAsync(199); expect(run.snapshot.nodeStates.d.status).toBe('RUNNING'); await vi.advanceTimersByTimeAsync(1); expect((await run.done).status).toBe('SUCCESS');
  });
  it('引擎异常隔离并记录 FAILED', async () => {
    vi.useFakeTimers(); const run = createRun(parallel(), { random: () => { throw new Error('随机源故障'); } }); await vi.runAllTimersAsync(); const result = await run.done; expect(result.status).toBe('FAILED'); expect(result.error).toContain('随机源故障'); expect(result.logs.some(l => l.event === 'fail')).toBe(true);
  });
  it('持久化回调异常不会未处理拒绝或崩溃', async () => {
    vi.useFakeTimers(); const run = createRun(parallel(), { onUpdate: () => { throw new Error('磁盘写入失败'); } }); await vi.runAllTimersAsync(); const result = await run.done; expect(result.status).toBe('FAILED'); expect(result.error).toContain('磁盘写入失败');
  });
  it('校验失败时不得启动任何节点', () => {
    const p = parallel(); p.edges.push(edge('j', 'f')); const onUpdate = vi.fn(); expect(() => createRun(p, { onUpdate })).toThrow('校验失败'); expect(onUpdate).not.toHaveBeenCalled();
  });
  it('每次状态变化提供独立快照，日志 seq 严格单调', async () => {
    vi.useFakeTimers(); const observed = []; const run = createRun(parallel(), { onUpdate: s => observed.push(s) }); await vi.runAllTimersAsync(); const result = await run.done;
    expect(observed[0].nodeStates.s.status).toBe('PENDING'); expect(observed.at(-1).status).toBe('SUCCESS'); expect(result.logs.map(l => l.seq)).toEqual(result.logs.map((_, i) => i + 1));
  });
});
