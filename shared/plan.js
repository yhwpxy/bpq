import { isForward } from './workflowSchema.js';
import { nanoid } from 'nanoid';
import { NODE_TYPES, START_MAX_OUTGOING } from './constants.js';

export function createEmptyPlan() {
 const now=new Date().toISOString();
 return {id:`plan_${nanoid(10)}`,name:'未命名编排',version:'1.0',meta:{maxConcurrency:3,continueOnError:false,description:''},nodes:[],edges:[],createdAt:now,updatedAt:now};
}
export function createNode(type,x=0,y=0) {
 if(!NODE_TYPES.includes(type)) throw new Error('未知节点类型');
 const defaults={start:{},task:{name:'新任务',duration:800,retry:0,failRate:0},condition:{expression:'passed == true'},delay:{wait:1000},end:{}};
 return {id:`n_${nanoid(10)}`,type,x,y,props:{...defaults[type]}};
}
/** Return a new plan; Kahn levels guarantee every dependency points into a later row. */
export function autoLayout(plan) {
 const result=JSON.parse(JSON.stringify(plan));
 const nodes=new Map(result.nodes.map(n=>[n.id,n]));
 const incoming=new Map(result.nodes.map(n=>[n.id,[]]));
 const outgoing=new Map(result.nodes.map(n=>[n.id,[]]));
 for(const e of result.edges.filter(e=>isForward(result,e))){if(nodes.has(e.source)&&nodes.has(e.target)){incoming.get(e.target).push(e.source);outgoing.get(e.source).push(e.target);}}
 const degrees=new Map([...incoming].map(([id,a])=>[id,a.length]));
 const levels=new Map(result.nodes.map(n=>[n.id,0]));
 const queue=result.nodes.filter(n=>!degrees.get(n.id)).map(n=>n.id);let visited=0;
 while(queue.length){const id=queue.shift();visited++;for(const target of outgoing.get(id)){levels.set(target,Math.max(levels.get(target),levels.get(id)+1));degrees.set(target,degrees.get(target)-1);if(degrees.get(target)===0)queue.push(target);}}
 if(visited!==result.nodes.length) throw new Error('存在循环依赖，请先移除环路再自动布局');
 if(result.workflow?.format==='twin-1'){
  const ordered=[...result.nodes].sort((a,b)=>levels.get(a.id)-levels.get(b.id));
  ordered.forEach((n,index)=>{const row=Math.floor(index/4),column=index%4;n.x=60+(row%2===0?column:3-column)*185;n.y=60+row*115;});
  return result;
 }
 // Align branch tails at their common join, preserving topological direction.
 // Only move a predecessor whose outgoing paths all permit the same later row.
 const joins=result.nodes.filter(n=>incoming.get(n.id).length>1).sort((a,b)=>levels.get(b.id)-levels.get(a.id));
 for(const join of joins){
  const targetLevel=levels.get(join.id)-1;
  for(const id of incoming.get(join.id)){
   if(outgoing.get(id).every(to=>levels.get(to)>targetLevel))levels.set(id,Math.max(levels.get(id),targetLevel));
  }
 }
 const rows=new Map();for(const n of result.nodes){const l=levels.get(n.id);if(!rows.has(l))rows.set(l,[]);rows.get(l).push(n);}
 const center=Math.max(320,Math.max(1,...[...rows.values()].map(a=>a.length))*80);
 for(const [level,row] of [...rows].sort((a,b)=>a[0]-b[0])){
  row.sort((a,b)=>{
   const avg=n=>{const p=incoming.get(n.id);return p.length?p.reduce((s,id)=>s+nodes.get(id).x,0)/p.length:center;};
   return avg(a)-avg(b);
  });
  row.forEach((n,index)=>{n.x=center+(index-(row.length-1)/2)*160;n.y=60+level*120;});
 }
 return result;
}
/** Fast edit-time check. The server remains authoritative for full R1–R8 checks. */
export function connectionError(plan,source,target,label,ignoreEdgeId) {
 if(source===target) return '不能连接节点自身';
 const from=plan.nodes.find(n=>n.id===source), to=plan.nodes.find(n=>n.id===target);
 if(!from||!to) return '连接两端的节点必须存在';
 const edges=plan.edges.filter(e=>e.id!==ignoreEdgeId&&isForward(plan,e));
 if(edges.some(e=>e.source===source&&e.target===target)) return '这两个节点之间已经存在连线';
 if(to.type==='start') return '开始节点没有入端口';
 if(from.type==='end') return '结束节点没有出端口';
 const out=edges.filter(e=>e.source===source);
 if(from.type==='start'&&out.length>=START_MAX_OUTGOING) return '开始节点只能有一条出边';
 if(from.type==='condition'){
  if(!['true','false'].includes(label))return '条件连线必须从 true 或 false 端口引出';
  if(out.length>=2) return '条件节点最多两条出边';
  if(out.some(e=>e.label===label))return `${label} 分支已经连接，请使用另一个端口`;
 }
 const stack=[target],seen=new Set();
 while(stack.length){const id=stack.pop();if(id===source)return '这条连线会形成循环依赖';if(seen.has(id))continue;seen.add(id);for(const e of edges)if(e.source===id)stack.push(e.target);}
 if(edges.length>=200) return '一个方案最多允许 200 条边';
 return null;
}
/** Task selection bypasses omitted tasks, retaining their upstream dependencies. */
export function taskSpecToPlan(taskSpec) {
 if(!taskSpec||!Array.isArray(taskSpec.tasks))throw new Error('任务清单格式非法');
 const all=new Map();
 for(const t of taskSpec.tasks){if(!t.key||all.has(t.key))throw new Error(`任务编号重复或为空：${t.key||'未填写'}`);all.set(t.key,t);}
 const selected=taskSpec.tasks.filter(t=>t.selected!==false);
 if(!selected.length)throw new Error('请至少选择一个任务');
 const chosen=new Set(selected.map(t=>t.key));
 const expand=(key,visiting=new Set(),branch)=>{
  if(visiting.has(key))throw new Error('清单包含循环依赖');
  const t=all.get(key);if(!t)throw new Error(`依赖 ${key} 不存在，请修改依赖列`);
  if(chosen.has(key))return [{key,branch}];
  return (t.dependsOn||[]).flatMap(d=>expand(d,new Set([...visiting,key]),t.branch||branch));
 };
 const starts=selected.filter(t=>t.type==='start'), ends=selected.filter(t=>t.type==='end');
 if(starts.length>1||ends.length>1)throw new Error('清单只能包含一个开始节点和一个结束节点');
 const plan=createEmptyPlan();plan.name=(taskSpec.source||'规格编排').slice(0,50);
 const map=new Map();
 for(const t of selected){
  if(!NODE_TYPES.includes(t.type))throw new Error(`任务 ${t.key} 的节点类型无效`);
  if(typeof t.name!=='string'||!t.name.trim()||[...t.name].length>50)throw new Error(`任务 ${t.key} 名称须为 1～50 字符`);
  const n=createNode(t.type);
  n.props.name=t.name.trim();
  if(t.type==='task'&&t.output)n.props.output=t.output;
  if(t.type==='condition')n.props.expression=t.expression||'passed == true';
  map.set(t.key,n);plan.nodes.push(n);
 }
 const start=starts.length?map.get(starts[0].key):createNode('start');
 const end=ends.length?map.get(ends[0].key):createNode('end');
 if(!starts.length)plan.nodes.unshift(start);if(!ends.length)plan.nodes.push(end);
 const add=(source,target,label)=>{
  if(source===target)throw new Error('任务不能依赖自身');
  if(plan.edges.some(e=>e.source===source&&e.target===target))return;
  plan.edges.push({id:`e_${nanoid(10)}`,source,target,...(label?{label}:{})});
 };
 for(const t of selected){
  const deps=(t.dependsOn||[]).flatMap(k=>expand(k,new Set(),t.branch));
  if(t.type==='start'&&deps.length)throw new Error('开始节点不能有前置依赖');
  for(const d of deps){const parent=map.get(d.key);add(parent.id,map.get(t.key).id,parent.type==='condition'?d.branch:undefined);}
 }
 const roots=plan.nodes.filter(n=>n.id!==start.id&&n.id!==end.id&&!plan.edges.some(e=>e.target===n.id));
 if(roots.length>START_MAX_OUTGOING){
  const bridge=createNode('task');bridge.props={name:'分发并行任务',duration:0,retry:0,failRate:0};
  plan.nodes.splice(1,0,bridge);add(start.id,bridge.id);roots.forEach(n=>add(bridge.id,n.id));
 }else roots.forEach(n=>add(start.id,n.id));
 const tails=plan.nodes.filter(n=>n.id!==end.id&&!plan.edges.some(e=>e.source===n.id));
 tails.forEach(n=>add(n.id,end.id));
 if(plan.nodes.length>100||plan.edges.length>200)throw new Error('画布最多 100 个节点、200 条边，请缩小任务清单');
 for(const n of plan.nodes.filter(n=>n.type==='condition')){
  const out=plan.edges.filter(e=>e.source===n.id);
  if(out.length!==2||!out.some(e=>e.label==='true')||!out.some(e=>e.label==='false'))throw new Error('条件节点需要 true/false 两个分支，请检查清单依赖与分支列');
 }
 return autoLayout(plan);
}
