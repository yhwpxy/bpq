import {createServer} from 'node:http';
import {mkdirSync, writeFileSync, existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve, join} from 'node:path';
import {createOrchestratorRuntime} from '../workflow-orchestrator/src/server/runtime.ts';
import {dimensions, rolesDefault} from '../requirements-engineering/src/contracts.ts';
import {acceptanceCases, designResponse, fixtureCase, requirementsResponse} from '../software-design/verify/acceptance-fixtures.ts';

// Local protocol fixture for manual acceptance; never imported by production.
process.env.ORCH_OFFLINE_VERIFY = '1';
for (const key of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'DEEPSEEK_API_KEY', 'OPENCODE_API_KEY']) delete process.env[key];
const root = resolve(import.meta.dirname, '..'), dataDir = resolve(root, 'work/ui-fixture');
mkdirSync(dataDir, {recursive: true});
const model = createServer(async (req, res) => {
  try {
    if (req.url !== '/v1/chat/completions' || req.headers.authorization !== 'Bearer local-ui-fixture') throw new Error('Unexpected fixture request');
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const packet = JSON.parse(Buffer.concat(chunks).toString());
    const system = packet.messages[0].content, data = JSON.parse(packet.messages[1].content);
    let value;
    if (system.includes('你是 Design Agent')) value = designResponse(data.baseline, data.workspace);
    else {
      const role = /^角色：(.+?)。/.exec(system)[1];
      const operation = role === 'Idea Decomposition' ? 'intake' : role === 'Dependency Analysis' ? 'dependencies' :
        role === 'Moderator' ? (Object.hasOwn(data.context, 'drafts') ? 'refine' : 'agenda') :
        role === 'Consensus Agent' ? 'integrate' : role === 'Requirements Agent' ? 'prd' :
        Object.values(dimensions).some(d => d.name === role) ? 'evaluate' : Object.hasOwn(data.context, 'peers') ? 'critique' : 'propose';
      value = requirementsResponse({operation, role, data: data.context}, fixtureCase(data.context));
    }
    res.writeHead(200, {'Content-Type':'application/json'}).end(JSON.stringify({choices:[{message:{content:JSON.stringify(value)}}]}));
  } catch (e) {res.writeHead(500).end(JSON.stringify({error:e.message}));}
});
await new Promise(r => model.listen(0, '127.0.0.1', r));
const runtime = await createOrchestratorRuntime({dataDir, port: Number(process.env.ORCH_FIXTURE_PORT ?? 4193), seedSample: false,
  staticDir: resolve(root, 'workflow-orchestrator/dist/renderer')});
runtime.vault.setApiKey('openai', 'local-ui-fixture');
runtime.store.updateProviderBaseUrl('openai', `http://127.0.0.1:${model.address().port}/v1`);
const repository = join(dataDir, 'target'); mkdirSync(repository, {recursive:true});
if (!existsSync(join(repository, '.git'))) {
  writeFileSync(join(repository, 'README.md'), '# Local UI acceptance target\n');
  const git = args => execFileSync('git', ['-C',repository,...args], {stdio:'ignore'});
  git(['init','-b','main']);git(['add','README.md']);
  git(['-c','user.name=UI Fixture','-c','user.email=fixture@example.test','commit','-m','Initial UI acceptance target']);
}
if (!runtime.store.listWorkspaces().length) runtime.store.createWorkspace({name:'UI 验收目标工程',rootPath:repository,verifyCommand:'node --test'});
const request = async (path, body) => {
  const res = await fetch(runtime.baseUrl+path,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${runtime.sessionToken}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const json = await res.json();if (!res.ok) throw new Error(JSON.stringify(json));return json;
};
if (!(await request('/api/hama/runs')).length) {
  const spec=acceptanceCases[0];
  let view=await request('/api/hama/runs',{projectId:spec.projectId,title:spec.title,ideas:[`[${spec.key}] ${spec.goal}`],background:spec.goal,problem:'需要可验证的实现方案',goals:spec.goal,constraints:spec.constraints.join('；'),preferences:'',documents:[],mode:'live',providerId:'openai',model:'acceptance-fixture',roles:rolesDefault.slice(0,2),maxDiscussionRounds:1,maxRevisions:2,parentBaselineId:''});
  const deadline=Date.now()+30000;
  while (view.detail.run.status!=='succeeded') {
    if (Date.now()>deadline || ['failed','cancelled'].includes(view.detail.run.status)) throw new Error('Fixture HAMA publication failed');
    if (view.gate) {
      const action={clarification:'clarify',approval:'approve',confirmation:'confirm'}[view.gate.kind];
      if (!action) throw new Error(`Unexpected fixture gate: ${view.gate.kind}`);
      await request(`/api/hama/runs/${view.detail.run.id}/gates/${view.gate.id}`,{targetId:view.gate.target.id,targetHash:view.gate.target.hash,actor:'UI 验收脚本模拟审批人',action,feedback:action==='clarify'?'确认需求':'',scope:'local',issueIds:[]});
    }
    await new Promise(r=>setTimeout(r,30));view=await request('/api/hama/runs/'+view.detail.run.id);
  }
}
console.log('LOCAL FIXTURE ONLY: deterministic model protocol responses, not a commercial model.');
console.log(`${runtime.baseUrl}/?apiBaseUrl=${encodeURIComponent(runtime.baseUrl)}&token=${runtime.sessionToken}`);
let stopping=false;
const stop=async()=>{if(stopping)return;stopping=true;await runtime.stop();model.close(()=>process.exit(0));};
process.on('SIGINT',stop);process.on('SIGTERM',stop);
