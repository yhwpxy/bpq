import { describe, it, expect, vi } from 'vitest';
import { parseGoal } from '../backend/engine/goalParser.js';
import { validateGoalSpec, confirmSource } from '../shared/goalSpecSchema.js';
import { createPlanningService } from '../backend/services/planningService.js';

const text = '# 发票核对\n## 目标\n核对发票并导出结果\n## 输入\n- invoices: array\n## 输出\n- report: file\n## 功能需求\n- FR-01: 校验发票\n- FR-02: 导出报告\n## 验收标准\n- AC-01: FR-01 拒绝重复编号\n- AC-02: FR-02 生成报告文件\n## 约束\n- 不修改输入\n## 假设\n- 输入为 UTF-8\n## 模块\n- 核对服务';

describe('GoalSpec 与来源', () => {
  it('抽取全部契约，保留编号、源码行、模块和原始文本', () => {
    const s = parseGoal(text);
    expect(s.goal).toBe('核对发票并导出结果');
    expect(s.requirements.map(r => r.id)).toEqual(['FR-01', 'FR-02']);
    expect(s.acceptanceCriteria[0].requirementRefs).toEqual(['FR-01']);
    expect(s.inputs[0]).toMatchObject({ name: 'invoices', type: 'array', source: 'doc', origin: 'doc', sourceLine: 5 });
    expect(s.outputs[0].type).toBe('file'); expect(s.constraints).toHaveLength(1); expect(s.modules).toHaveLength(1);
    expect(s.assumptions[0].source).toBe('doc'); expect(s.rawText).toBe(text); expect(validateGoalSpec(s)).toEqual([]);
  });
  it('缺失信息必须标 suggested，不伪称文档事实', () => {
    const s = parseGoal('核对发票'); expect(s.requirements[0].source).toBe('suggested');
    expect(s.acceptanceCriteria[0].source).toBe('suggested'); expect(s.inputs[0].source).toBe('suggested');
  });
  it('确认保留原始来源且不修改输入', () => {
    const s = parseGoal('核对发票'), next = confirmSource(s, 'AC-01');
    expect(next.acceptanceCriteria[0]).toMatchObject({ source: 'user_confirmed', origin: 'suggested' });
    expect(s.acceptanceCriteria[0].source).toBe('suggested'); expect(() => confirmSource(s, 'missing')).toThrow();
  });
  it('支持 BOM、CRLF、英文标题、显式编号及忽略代码围栏', () => {
    const s = parseGoal('\uFEFF# Invoice\r\n## Goal\r\nCheck\r\n## Requirements\r\n- FR-42: Validate\r\n```\r\nFR-99: ignore\r\n```\r\n## Acceptance\r\n- AC-08: FR-42 works');
    expect(s.requirements.map(r => r.id)).toEqual(['FR-42']); expect(s.acceptanceCriteria[0].id).toBe('AC-08');
  });
  it.each(['', '   ', null, 12, '字'.repeat(70000)])('拒绝非法或超限输入 %#', v => expect(() => parseGoal(v)).toThrow());
  it('拒绝重复需求编号和悬空 AC 引用', () => {
    expect(() => parseGoal('# A\nFR-01: a\nFR-01: b')).toThrow();
    expect(() => parseGoal('# A\nFR-01: a\nAC-01: FR-99')).toThrow();
  });
  it.each([null, [], {}, { title: 'x' }])('不可信结构给出诊断而非崩溃 %#', v => expect(validateGoalSpec(v).length).toBeGreaterThan(0));
  it('检查原始来源、契约类型和危险标识', () => {
    const s = parseGoal(text); s.inputs[0].name = '__proto__'; s.outputs[0].type = 'function'; s.requirements[0].origin = 'fake';
    expect(validateGoalSpec(s).map(i => i.path)).toEqual(expect.arrayContaining(['inputs[0].name', 'outputs[0].type', 'requirements[0].origin']));
  });
  it('自然语言结果独立映射，不改变旧 TaskSpec', async () => {
    const taskSpec = { source: '发票', tasks: [{ key: '1', name: '校验', type: 'task', dependsOn: [] }] };
    const provider = { decompose: vi.fn(async () => structuredClone(taskSpec)) };
    const s = await createPlanningService(provider).parse({ text: '帮我校验发票', mode: 'natural' });
    expect(s.requirements[0]).toMatchObject({ text: '校验', source: 'suggested' }); expect(taskSpec.tasks[0]).not.toHaveProperty('source');
  });
  it('规则路径不访问模型，模型错误不伪装成成功', async () => {
    const provider = { decompose: vi.fn(async () => { throw new Error('unavailable'); }) }, service = createPlanningService(provider);
    await service.parse({ text }); expect(provider.decompose).not.toHaveBeenCalled();
    await expect(service.parse({ text, mode: 'natural' })).rejects.toThrow('unavailable');
    await expect(service.parse({ text, mode: 'other' })).rejects.toThrow();
  });
});
