import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateTaskSpec } from '../shared/taskSpecSchema.js';
const appendix = JSON.parse(readFileSync(new URL('../examples/appendix-task-spec.json', import.meta.url), 'utf8'));
const fixture = () => ({ source: '编号规格', detectedFormat: 'numbered', tasks: [{ key: '1', name: '任务', type: 'task', dependsOn: [] }, { key: '2', name: '结果', type: 'end', dependsOn: ['1'] }] });

describe('TaskSpec 不可信 JSON 结构边界', () => {
  it('接受原始完整附录与编号任务，不改变数据', () => {
    const source = JSON.stringify(appendix); expect(validateTaskSpec(appendix)).toEqual([]); expect(JSON.stringify(appendix)).toBe(source);
    expect(validateTaskSpec(fixture())).toEqual([]);
  });
  it.each([null, [], 'text', 42, false, {}, {tasks:[]}, {tasks:Array(101).fill({})}])('拒绝非法顶层与空清单 %#', value => { expect(validateTaskSpec(value).length).toBeGreaterThan(0); });
  it.each([null, [], 'task', 42])('拒绝非法任务且不抛异常 %#', task => { const p=fixture();p.tasks[0]=task;expect(validateTaskSpec(p).length).toBeGreaterThan(0); });
  it.each([null, 1, '1', {}, ['1', null]])('依赖必须是字符串数组 %#', dependsOn => { const p=fixture();p.tasks[1].dependsOn=dependsOn;expect(validateTaskSpec(p).some(e=>e.path.startsWith('tasks[1].dependsOn'))).toBe(true); });
  it('禁止改名字段、计划字段和UI临时字段', () => {
    const p=fixture();p.version='1.0';p.tasks[0].id='x';p.tasks[0].title='任务';p.tasks[0].selected=true;
    expect(validateTaskSpec(p).filter(e=>e.message.includes('不支持'))).toHaveLength(4);
  });
  it.each(['', ' ', 'a,b', 'a b', 'x'.repeat(129)])('拒绝不适合依赖编辑器的编号 %s', key=>{const p=fixture();p.tasks[0].key=key;expect(validateTaskSpec(p).some(e=>e.path==='tasks[0].key')).toBe(true);});
  it('拒绝重复编号、自依赖、重复依赖、悬空引用', () => {
    let p=fixture();p.tasks[1].key='1';expect(validateTaskSpec(p).some(e=>e.message.includes('编号重复'))).toBe(true);
    p=fixture();p.tasks[0].dependsOn=['1'];expect(validateTaskSpec(p).some(e=>e.message.includes('自身'))).toBe(true);
    p=fixture();p.tasks[1].dependsOn=['1','1'];expect(validateTaskSpec(p).some(e=>e.message.includes('依赖编号重复'))).toBe(true);
    p=fixture();p.tasks[1].dependsOn=['missing'];expect(validateTaskSpec(p)).toContainEqual(expect.objectContaining({path:'tasks[1].dependsOn[0]',message:'引用的任务不存在：missing'}));
  });
  it('循环依赖定位所有环内任务',()=>{const p=fixture();p.tasks[0].dependsOn=['2'];expect(validateTaskSpec(p).map(e=>e.path).sort()).toEqual(['tasks[0].dependsOn','tasks[1].dependsOn']);});
  it.each([true, false, 1, 'yes', ''])('分支不能使用布尔值或未知内容 %#', branch=>{const p=fixture();p.tasks[0].branch=branch;expect(validateTaskSpec(p).some(e=>e.path==='tasks[0].branch')).toBe(true);});
  it.each([0, -1, 1.5, '1', Number.MAX_SAFE_INTEGER+1])('并行组仅支持正整数或null %#', parallelGroup=>{const p=fixture();p.tasks[0].parallelGroup=parallelGroup;expect(validateTaskSpec(p).some(e=>e.path==='tasks[0].parallelGroup')).toBe(true);});
  it('名称限制、格式枚举、类型与条件表达式必填',()=>{
    const p=fixture();p.source='字'.repeat(51);p.detectedFormat='llm';p.tasks[0].name='';p.tasks[1].type='condition';
    expect(validateTaskSpec(p).map(e=>e.path)).toEqual(expect.arrayContaining(['source','detectedFormat','tasks[0].name','tasks[1].expression']));
    p.tasks[0].type='http';expect(validateTaskSpec(p).some(e=>e.path==='tasks[0].type')).toBe(true);
  });
  it('输出变量类型与危险名称，以及表达式字段适用类型',()=>{
    const p=fixture();p.tasks[0].output='__proto__';p.tasks[1].output='passed';p.tasks[0].expression='true';
    expect(validateTaskSpec(p).map(e=>e.path)).toEqual(expect.arrayContaining(['tasks[0].output','tasks[1].output','tasks[0].expression']));
  });
  it('允许可选null和正常变量、中文或小数任务key',()=>{
    const p=fixture();p.tasks[0]={...p.tasks[0],key:'阶段1.1',parallelGroup:null,branch:null,output:'passed'};p.tasks[1].dependsOn=['阶段1.1'];
    expect(validateTaskSpec(p)).toEqual([]);
  });
  it('200条依赖上限在转换前检查',()=>{
    const p=fixture();p.tasks=Array.from({length:30},(_,i)=>({key:String(i),name:'步骤',type:'task',dependsOn:Array.from({length:i},(_,j)=>String(j))}));
    expect(validateTaskSpec(p)).toContainEqual({path:'tasks',message:'依赖数量超过 200 条边上限'});
  });
});
