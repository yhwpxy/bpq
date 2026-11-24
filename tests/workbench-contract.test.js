import { it, expect } from 'vitest';
import { compileWorkflow } from '../backend/engine/workflowCompiler.js';
import { parseGoal } from '../backend/engine/goalParser.js';
import { autoLayout, connectionError } from '../shared/plan.js';
import { createApp } from '../backend/server.js';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const caps=[{id:'simulated',kind:'tool',enabled:true}];
it('lays out advanced nodes in a readable bounded grid without changing graph semantics',()=>{
  const p=compileWorkflow(parseGoal('# UI\nFR-01: one\nFR-02: two'),{},caps),next=autoLayout(p);
  expect(next.nodes.map(n=>n.id)).toEqual(p.nodes.map(n=>n.id));expect(next.edges).toEqual(p.edges);
  expect(Math.max(...next.nodes.map(n=>n.x))).toBeLessThan(800);
  expect(Math.max(...next.nodes.map(n=>n.y))).toBeLessThan(650);
  expect(new Set(next.nodes.map(n=>`${n.x}:${n.y}`)).size).toBe(next.nodes.length);
});
it('does not mistake a legitimate recovery loop for a new forward connection cycle',()=>{
  const p=compileWorkflow(parseGoal('# UI\nFR-01: one\nFR-02: two'),{},caps);
  const first=p.nodes.find(n=>n.props.requirementRefs.includes('FR-01')),second=p.nodes.find(n=>n.props.requirementRefs.includes('FR-02'));
  expect(connectionError(p,first.id,second.id)).toBeNull();
  expect(connectionError(p,p.nodes.find(n=>n.type==='end').id,first.id)).not.toBeNull();
});
it('serves an authenticated real artifact demo with command verification and explicit workspace',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'workbench-api-')),app=createApp({storageDir:dir,sessionToken:'ui-token'});
  const server=await new Promise(r=>{const x=app.listen(0,'127.0.0.1',()=>r(x));});const url=`http://127.0.0.1:${server.address().port}/api/workflows/demo`;
  try{expect((await fetch(url,{method:'POST'})).status).toBe(401);const r=await fetch(url,{method:'POST',headers:{Authorization:'Bearer ui-token','Content-Type':'application/json'},body:JSON.stringify({human:true})});const data=await r.json();expect(r.status).toBe(200);expect(data.plan.workflow.workspaceId).toBe(data.workspace.id);expect(data.plan.nodes.some(n=>n.props.control==='human')).toBe(true);const gate=data.plan.nodes.find(n=>n.props.control==='gate');expect(gate.props.demonstrationGate).toBe(false);expect(gate.props.args).toContain('--fail-once');}
  finally{await app.locals.services.runService.close();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});
