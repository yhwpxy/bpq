import { describe,it,expect } from 'vitest';
import fs from 'node:fs';
import { createEmptyPlan,createNode,taskSpecToPlan,autoLayout,connectionError } from '../shared/plan.js';
import { validatePlanSchema } from '../shared/schema.js';
import { decompose } from '../backend/engine/decomposer.js';
import { LOGIN_SPEC } from '../shared/example.js';

describe('画布生成与共享契约',()=>{
 it('TC-03 原始附录保留10节点11边；运行图按用户裁定11节点12边',()=>{
  const original=JSON.parse(fs.readFileSync(new URL('../examples/appendix-original-plan.json',import.meta.url),'utf8'));
  expect(original.nodes).toHaveLength(10);expect(original.edges).toHaveLength(11);
  const p=taskSpecToPlan(decompose(LOGIN_SPEC));
  expect(p.nodes).toHaveLength(11);expect(p.edges).toHaveLength(12);
  expect(p.edges.filter(e=>e.source===p.nodes.find(n=>n.type==='start').id)).toHaveLength(1);
  expect(p.nodes.filter(n=>n.type==='condition')).toHaveLength(1);
  expect(validatePlanSchema(p)).toEqual([]);
  for(let i=0;i<p.nodes.length;i++)for(let j=i+1;j<p.nodes.length;j++){
   const a=p.nodes[i],b=p.nodes[j];expect(Math.abs(a.x-b.x)>=144||Math.abs(a.y-b.y)>=72).toBe(true);
  }
 });
 it('条件分支尾节点在汇聚前对齐',()=>{
  const p=taskSpecToPlan(decompose(LOGIN_SPEC));const end=p.nodes.find(n=>n.type==='end');
  const parents=p.edges.filter(e=>e.target===end.id).map(e=>p.nodes.find(n=>n.id===e.source));
  expect(new Set(parents.map(n=>n.y)).size).toBe(1);expect(parents[0].y).toBe(end.y-120);
 });
 it('确认修改名称、类型、选择与依赖影响生成结果',()=>{
  const spec={source:'编辑确认',tasks:[{key:'a',type:'task',name:'第一步',dependsOn:[]},{key:'b',type:'task',name:'省略',dependsOn:['a'],selected:false},{key:'c',type:'delay',name:'等待',dependsOn:['b']}]};
  const p=taskSpecToPlan(spec); const first=p.nodes.find(n=>n.props.name==='第一步');const delay=p.nodes.find(n=>n.type==='delay');
  expect(p.nodes.some(n=>n.props.name==='省略')).toBe(false);expect(p.edges.some(e=>e.source===first.id&&e.target===delay.id)).toBe(true);
 });
 it('取消分支任务仍保留条件到汇聚点的分支标签',()=>{
  const spec=decompose(LOGIN_SPEC);spec.tasks.find(t=>t.key==='3.4').selected=false;
  const p=taskSpecToPlan(spec);const c=p.nodes.find(n=>n.type==='condition'),end=p.nodes.find(n=>n.type==='end');
  expect(p.edges.some(e=>e.source===c.id&&e.target===end.id&&e.label==='false')).toBe(true);
 });
 it('缺失依赖、空清单、重复key、循环清单给出可读错误',()=>{
  expect(()=>taskSpecToPlan({tasks:[]})).toThrow('至少选择');
  expect(()=>taskSpecToPlan({tasks:[{key:'a',name:'a',type:'task',dependsOn:['missing']}]})).toThrow('依赖 missing');
  expect(()=>taskSpecToPlan({tasks:[{key:'a'},{key:'a'}]})).toThrow('重复');
  expect(()=>taskSpecToPlan({tasks:[{key:'a',name:'a',type:'task',dependsOn:['b']},{key:'b',name:'b',type:'task',dependsOn:['a']}]})).toThrow('循环');
 });
 it('TC-04 前端实时拒绝自环、重复、start二出、condition第三边及环路',()=>{
  const p=createEmptyPlan();p.nodes=['start','task','task','condition','end'].map(t=>createNode(t));
  const [s,a,b,c,e]=p.nodes;p.edges=[{id:'e1',source:s.id,target:a.id},{id:'e2',source:c.id,target:b.id,label:'true'},{id:'e3',source:c.id,target:e.id,label:'false'}];
  expect(connectionError(p,a.id,a.id)).toContain('自身');expect(connectionError(p,s.id,a.id)).toContain('已经');expect(connectionError(p,s.id,b.id)).toContain('一条');expect(connectionError(p,c.id,a.id,'true')).toContain('最多两条');expect(connectionError(p,a.id,s.id)).toContain('入端口');
  p.edges.push({id:'e4',source:a.id,target:b.id});expect(connectionError(p,b.id,a.id)).toContain('循环');
 });
 it('布局不改变节点ID、属性与边',()=>{
  const p=taskSpecToPlan(decompose(LOGIN_SPEC));const layout=autoLayout(p);
  expect(layout.edges).toEqual(p.edges);expect(layout.nodes.map(n=>[n.id,n.type,n.props])).toEqual(p.nodes.map(n=>[n.id,n.type,n.props]));
 });
 it('导入Schema拒绝损坏文件、非法版本、非有限数、越界属性',()=>{
  expect(validatePlanSchema(null).length).toBeGreaterThan(0);
  const p=createEmptyPlan();p.nodes=[createNode('task')];p.version='9';p.nodes[0].x=NaN;p.nodes[0].props.retry=4;
  expect(validatePlanSchema(p).length).toBe(3);
 });
});
