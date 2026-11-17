import { describe, it, expect } from 'vitest';
import { validatePlan, topologicalLevels } from '../backend/engine/validator.js';
const node = (id, type = 'task', props = {}) => ({ id, type, x: 0, y: 0, props: type === 'task' ? { name: id, duration: 0, retry: 0, failRate: 0, ...props } : props });
function plan() { return { id: 'p', name: '测试', version: '1.0', createdAt: '2026-11-17T00:00:00Z', updatedAt: '2026-11-17T00:00:00Z', nodes: [node('s', 'start'), node('a'), node('b'), node('e', 'end')], edges: [{ id: 'sa', source: 's', target: 'a' }, { id: 'ab', source: 'a', target: 'b' }, { id: 'be', source: 'b', target: 'e' }] }; }
const rules = p => validatePlan(p).map(e => e.rule);

describe('R1～R8 服务端全量校验', () => {
  it('合法串行方案和 Kahn 分层', () => { const p = plan(); expect(validatePlan(p)).toEqual([]); expect([...topologicalLevels(p).values()]).toEqual([0, 1, 2, 3]); });
  it('R1 start/end 必须唯一', () => { const p = plan(); p.nodes.push(node('s2', 'start')); expect(rules(p)).toContain('R1'); });
  it('AC-04 start 二出拒绝', () => { const p = plan(); p.edges.push({ id: 'sb', source: 's', target: 'b' }); expect(validatePlan(p)).toContainEqual(expect.objectContaining({ nodeId: 's', rule: 'R1' })); });
  it('AC-05 环上全部节点均定位', () => {
    const p = plan(); p.edges.push({ id: 'ba', source: 'b', target: 'a' });
    expect(validatePlan(p).filter(e => e.rule === 'R2').map(e => e.nodeId).sort()).toEqual(['a', 'b']);
    expect(() => topologicalLevels(p)).toThrow('环');
  });
  it('R3 孤立节点和无法到达结束的节点', () => { const p = plan(); p.nodes.push(node('orphan')); expect(validatePlan(p)).toContainEqual(expect.objectContaining({ nodeId: 'orphan', rule: 'R3' })); });
  it('R4 缺少条件分支或条件三出', () => {
    const p = plan(); p.nodes[1] = node('a', 'condition', { expression: 'true' }); p.edges[1].label = 'true';
    expect(rules(p)).toContain('R4');
    p.edges.push({ id: 'ae', source: 'a', target: 'e', label: 'false' }); expect(validatePlan(p)).toEqual([]);
    p.edges.push({ id: 'ae2', source: 'a', target: 'e', label: 'true' }); expect(rules(p)).toContain('R4');
  });
  it('R5 自环、重复边和不存在端口', () => { const p = plan(); p.edges.push({ id: 'aa', source: 'a', target: 'a' }, { id: 'ab2', source: 'a', target: 'b' }, { id: 'es', source: 'e', target: 's' }); expect(validatePlan(p).filter(e => e.rule === 'R5').length).toBeGreaterThanOrEqual(3); });
  it.each([{ duration: -1 }, { duration: 60001 }, { retry: 4 }, { retry: 0.5 }, { failRate: 1.1 }, { name: '' }, { output: '__proto__' }])('R6 属性非法 %j', props => { const p = plan(); Object.assign(p.nodes[1].props, props); expect(rules(p)).toContain('R6'); });
  it('R6 危险条件表达式在执行前拦截', () => { const p = plan(); p.nodes[1] = node('a', 'condition', { expression: 'process.exit()' }); expect(rules(p)).toContain('R6'); });
  it('R7 节点/边 ID 重复', () => { const p = plan(); p.nodes.push(node('a')); p.edges.push({ ...p.edges[0] }); expect(validatePlan(p).filter(e => e.rule === 'R7')).toHaveLength(2); });
  it('R8 悬空边', () => { const p = plan(); p.edges.push({ id: 'bad', source: 'a', target: 'missing' }); expect(rules(p)).toContain('R8'); });
  it('空/损坏 JSON 给出错误而非崩溃', () => { expect(validatePlan(null)).not.toEqual([]); expect(validatePlan({ nodes: [null] })).not.toEqual([]); });
  it('并发数必须为正整数', () => { const p = plan(); p.meta = { maxConcurrency: 0 }; expect(rules(p)).toContain('R6'); });
});
