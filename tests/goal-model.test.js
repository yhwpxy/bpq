import { it,expect,vi } from 'vitest';
import { createGoalModelService } from '../backend/services/goalModelService.js';
const config={enabled:true,endpoint:'https://model.test/chat/completions',apiKey:'fixture-secret',model:'fixture'};
const goal=()=>({title:'Import',goal:'Process invoices',requirements:[{id:'FR-01',text:'处理发票'}],acceptanceCriteria:[{id:'AC-01',text:'生成报告',requirementRefs:['FR-01']}],inputs:[{id:'IN-01',text:'发票数组',name:'invoices',type:'array',required:true}],outputs:[{id:'OUT-01',text:'核对报告',name:'report',type:'file',required:true}],constraints:[{id:'CON-01',text:'不得修改输入'}],assumptions:[],modules:[]});
const response=value=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:typeof value==='string'?value:JSON.stringify(value)}}]}));
it('extracts NL requirements, acceptance, typed inputs/outputs and constraints with server-assigned provenance',async()=>{
 const fetchImpl=vi.fn(async()=>response(goal())),extract=createGoalModelService({config,fetchImpl});const result=await extract('处理发票，输入发票数组，不得修改输入');
 expect(result.inputs[0]).toMatchObject({name:'invoices',type:'array',source:'doc'});expect(result.outputs[0].source).toBe('suggested');expect(result.constraints[0].source).toBe('doc');expect(result.acceptanceCriteria[0].requirementRefs).toEqual(['FR-01']);expect(fetchImpl).toHaveBeenCalledTimes(1);
});
it('does not trust model claimed user confirmation or fabricated source positions',async()=>{
 const g=goal();g.outputs[0].source='user_confirmed';g.outputs[0].sourceLine=123;const r=await createGoalModelService({config,fetchImpl:async()=>response(g)})('处理发票');expect(r.outputs[0]).toMatchObject({source:'suggested',origin:'suggested',sourceLine:null});
});
it.each(['not json','```json\n{}\n```','{}'])('rejects invalid GoalSpec output %#',async value=>await expect(createGoalModelService({config,fetchImpl:async()=>response(value)})('需求')).rejects.toMatchObject({code:40001}));
it('rejects a model-produced dangling AC reference',async()=>{const g=goal();g.acceptanceCriteria[0].requirementRefs=['FR-999'];await expect(createGoalModelService({config,fetchImpl:async()=>response(g)})('需求')).rejects.toMatchObject({code:40001});});
it('fails explicitly without configuration and never sends a request',async()=>{const fetchImpl=vi.fn();await expect(createGoalModelService({config:{enabled:false},fetchImpl})('需求')).rejects.toMatchObject({code:50301});expect(fetchImpl).not.toHaveBeenCalled();});
it('times out and aborts an unresponsive provider without leaking credentials',async()=>{let signal;const extract=createGoalModelService({config,timeoutMs:10,fetchImpl:async(_u,o)=>{signal=o.signal;return new Promise(()=>{});}});await expect(extract('需求')).rejects.toMatchObject({code:50401});expect(signal.aborted).toBe(true);});
it('supports caller cancellation and limits response size',async()=>{const c=new AbortController();const promise=createGoalModelService({config,fetchImpl:async()=>new Promise(()=>{})})('需求',{signal:c.signal});c.abort();await expect(promise).rejects.toMatchObject({code:50201});await expect(createGoalModelService({config,maxResponseBytes:10,fetchImpl:async()=>response(goal())})('需求')).rejects.toMatchObject({code:50201});});
