import { it, expect } from 'vitest';
import { exportPlan } from '../backend/engine/planExport.js';
import { compileWorkflow } from '../backend/engine/workflowCompiler.js';
import { parseGoal } from '../backend/engine/goalParser.js';
import { REQUIREMENT_PRESETS } from '../shared/workflowPresets.js';
import { validatePlan } from '../backend/engine/validator.js';
const caps=[{id:'simulated',kind:'tool',enabled:true},{id:'local-tool',kind:'tool',enabled:true}];
it.each(REQUIREMENT_PRESETS.map(p=>[p.id,p.text]))('compiles original preset %s and exports three equivalent formats',(_id,text)=>{
  const plan=compileWorkflow(parseGoal(text),{},caps),result=exportPlan(plan);
  expect(result.json).toEqual(plan);expect(result.mermaid).toContain('flowchart LR');expect(result.mermaid).toContain('-.->');
  expect(result.markdown).toContain('FR-01');expect(result.markdown).toContain('AC-01');expect(result.markdown).toContain('Planning rationale');
  expect(validatePlan(plan,{capabilities:caps}).filter(i=>!i.severity||i.severity==='error')).toEqual([]);
});
it('escapes user-authored labels and Markdown table separators',()=>{
  const p=compileWorkflow(parseGoal('safe'),{},caps);p.nodes[0].props.name='x" <tag> | y';const r=exportPlan(p);
  expect(r.mermaid).toContain('&quot;');expect(r.mermaid).toContain('&lt;tag&gt;');expect(r.markdown).toContain('\\|');
});
it('rejects invalid plans instead of generating misleading exports',()=>expect(()=>exportPlan({nodes:[]})).toThrow());
it('strict policy rejects a bypass around an otherwise present human gate',()=>{
  const p=compileWorkflow(parseGoal('strict'),{permissionTier:'strict',capabilityId:'local-tool'},caps);
  const prepare=p.nodes.find(n=>n.props.control==='prepare'),worker=p.nodes.find(n=>n.props.requirementRefs.length);
  p.edges.push({id:'bypass',source:prepare.id,target:worker.id,kind:'dep'});
  expect(validatePlan(p,{capabilities:caps}).some(i=>i.code==='HUMAN_ORDER'&&i.nodeId===worker.id)).toBe(true);
});
