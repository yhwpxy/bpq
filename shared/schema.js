import { workflowSchema } from './workflowSchema.js';
import { NODE_TYPES, MAX_NODES, MAX_EDGES } from './constants.js';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (v, max=128) => typeof v === 'string' && v.trim().length > 0 && [...v].length <= max;
export const isSafeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
export const isSafeVariable = value => typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value) && !['__proto__','prototype','constructor','true','false'].includes(value);
const number = (v,min,max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const date = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v));
/** Structural validation is shared by import, draft restore and the authoritative API. */
export function validatePlanSchema(plan, {allowMissingId=false}={}) {
 const errors=[];
 const add=(message,nodeId='')=>errors.push({nodeId,rule:'SCHEMA',message});
 if(!object(plan)){add('方案必须是 JSON 对象');return errors;}
 if(!(allowMissingId && plan.id === undefined) && !isSafeId(plan.id)) add('方案 id 只能包含字母、数字、下划线与短横线');
 if(!text(plan.name,50)) add('方案名称不能为空且不得超过 50 字符');
 if(plan.version !== '1.0') add('不支持的数据版本，当前仅支持 1.0');
 if(!date(plan.createdAt)||!date(plan.updatedAt)) add('createdAt 与 updatedAt 必须是 ISO 8601 时间');
 if(plan.meta !== undefined){
  if(!object(plan.meta)) add('meta 必须是对象');
  else {
   if(plan.meta.maxConcurrency !== undefined && (!number(plan.meta.maxConcurrency,1,100)||!Number.isInteger(plan.meta.maxConcurrency))) add('并发上限须为 1～100 的整数');
   if(plan.meta.continueOnError !== undefined && typeof plan.meta.continueOnError !== 'boolean') add('continueOnError 必须是布尔值');
   if(plan.meta.description !== undefined && typeof plan.meta.description !== 'string') add('description 必须是字符串');
  }
 }
 if(!Array.isArray(plan.nodes)||plan.nodes.length>MAX_NODES){add('nodes 必须是数组，最多 100 个节点');}
 else for(const n of plan.nodes){
  if(!object(n)){add('节点必须是对象');continue;}
  const id=typeof n.id === 'string'?n.id:'';
  if(!isSafeId(n.id)) add('节点 ID 格式非法',id);
  if(!NODE_TYPES.includes(n.type)) add('未知节点类型',id);
  if(!Number.isFinite(n.x)||!Number.isFinite(n.y)) add('节点坐标必须为有限数字',id);
  if(!object(n.props)){add('节点 props 必须是对象',id);continue;}
  const p=n.props;
  if(p.name !== undefined && !text(p.name,50)) add('节点显示名称须为 1～50 字符',id);
  if(n.type==='task'){
   if(!text(p.name,50)) add('任务名称须为 1～50 字符',id);
   if(!number(p.duration,0,60000)) add('duration 须在 0～60000 毫秒内',id);
   if(!number(p.retry,0,3)||!Number.isInteger(p.retry)) add('retry 须为 0～3 的整数',id);
   if(p.failRate !== undefined && !number(p.failRate,0,1)) add('failRate 须在 0～1 内',id);
   if(p.output !== undefined && p.output !== '' && !isSafeVariable(p.output)) add('output 必须是安全变量名（英文字母、数字与下划线，不能以数字开头）',id);
  }
  if(n.type==='delay'&&!number(p.wait,0,60000)) add('wait 须在 0～60000 毫秒内',id);
  if(n.type==='condition'&&!text(p.expression,1000)) add('条件表达式不能为空且不得超过 1000 字符',id);
 }
 if(!Array.isArray(plan.edges)||plan.edges.length>MAX_EDGES){add('edges 必须是数组，最多 200 条边');}
 else for(const e of plan.edges){
  if(!object(e)){add('边必须是对象');continue;}
  if(!isSafeId(e.id)) add('边 ID 格式非法');
  if(!isSafeId(e.source)||!isSafeId(e.target)) add('边的 source 与 target 必须是节点 ID');
  if(e.label !== undefined && typeof e.label !== 'string') add('边标签必须是字符串');
 }
 if (!errors.length) errors.push(...workflowSchema(plan));
 return errors;
}
