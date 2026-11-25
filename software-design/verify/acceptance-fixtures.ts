/** Explicit local model fixtures for protocol/integration acceptance, never imported by production. */
import type {AgentRequest} from '../../requirements-engineering/src/agents.ts';
import type {ApprovedRequirementsBaseline, Draft, Proposal, StartInput} from '../../requirements-engineering/src/contracts.ts';
import type {WorkspaceInventory} from '../src/contracts.ts';
import type {DesignBody} from '../src/design-schema.ts';

type Scope = Draft['requirements'][number] & {kind: 'functional' | 'nonfunctional'; title: string};
export interface AcceptanceCase {key: string; projectId: string; title: string; goal: string; constraints: string[]; rules: string[]; scopes: Scope[]}
const countScope = (revision: number): Scope => ({scopeKey: 'count', kind: 'functional', title: '统计非空行',
  description: revision === 1 ? '输入文本文件路径，输出非空行数，文件不存在时报告错误' : '输入文本文件路径，输出非空行数，文件不存在时向标准错误写入错误并以退出码 2 结束',
  value: '为脚本提供可复核的统计结果', priority: 'must', dependencies: [], constraints: ['UTF-8 编码；trim 后长度为零的行不计数'],
  acceptance: [{key: 'normal', given: '文件含两行文本、一行空行和一行仅空白字符', when: '运行非空行统计', then: '输出非空行数 2'},
    {key: 'empty', given: '存在一个空文件', when: '运行非空行统计', then: '输出非空行数 0'},
    {key: 'missing', given: '文件路径不存在', when: '运行非空行统计', then: revision === 1 ? '报告文件不存在' : '向标准错误输出文件不存在，退出码为 2'}]});
const streamScope: Scope = {scopeKey: 'stream', kind: 'nonfunctional', title: '流式内存限制', description: '流式读取文本，峰值内存不超过 64 MiB',
  value: '避免大文件耗尽内存', priority: 'should', dependencies: ['count'], constraints: ['禁止一次加载整个文件'],
  acceptance: [{key: 'large', given: '一个 1 GiB UTF-8 文本文件', when: '统计非空行并采集峰值内存', then: '结果正确且峰值内存不超过 64 MiB'}]};
export const acceptanceCases: AcceptanceCase[] = [1, 2].map(revision => ({key: `counter-v${revision}`, projectId: 'acceptance-counter',
  title: '文本非空行统计工具', goal: '统计本地文本文件的非空行数', constraints: ['提供命令行接口，不引入 Web 页面或数据库'],
  rules: ['文件按 UTF-8 解码；按换行读取；trim 后非空则计数'], scopes: [countScope(revision), structuredClone(streamScope)]}));
acceptanceCases.push({key: 'ledger', projectId: 'acceptance-ledger', title: '多币种记账服务', goal: '保存平衡分录及可回查的汇率快照',
  constraints: ['金额使用十进制定点数，禁止二进制浮点金额计算', '一次过账的所有写入在单个事务内完成'],
  rules: ['借方合计等于贷方合计才能过账', '换算使用记账日期的汇率快照，四舍五入保留两位小数'], scopes: [
    {scopeKey: 'journal', kind: 'functional', title: '分录过账', description: '验证借贷平衡后保存分录，失败时不保存部分分录', value: '保证账本一致性', priority: 'must',
      dependencies: [], constraints: ['必须保存唯一业务请求编号'], acceptance: [
        {key: 'balanced', given: '借方与贷方各 100.00 元', when: '提交过账', then: '返回分录编号并保存两笔平衡分录'},
        {key: 'unbalanced', given: '借方 100.00 元且贷方 90.00 元', when: '提交过账', then: '拒绝请求且账本无新增记录'}]},
    {scopeKey: 'fx', kind: 'functional', title: '汇率快照', description: '用记账日期汇率换算金额并保存快照', value: '支持对账追溯', priority: 'should',
      dependencies: ['journal'], constraints: ['缺少当日汇率时拒绝过账'], acceptance: [
        {key: 'convert', given: 'USD 100.00、当日 USD/CNY 汇率 7.2000', when: '换算并过账', then: '保存 CNY 720.00 和汇率 7.2000 的快照'},
        {key: 'missing-rate', given: '缺少记账日期的汇率', when: '请求换算过账', then: '返回缺失汇率错误且无部分分录'}]},
    {scopeKey: 'atomic', kind: 'nonfunctional', title: '事务幂等', description: '相同业务请求编号并发提交只产生一次过账', value: '避免重复入账', priority: 'must',
      dependencies: ['journal'], constraints: ['业务请求编号唯一，检查和写入必须原子完成'], acceptance: [
        {key: 'duplicate', given: '两笔带相同业务请求编号的平衡分录请求', when: '并发提交', then: '只有一个分录编号和一组过账记录'}]},
  ]});

export function fixtureCase(data: unknown): AcceptanceCase {
  const serialized = JSON.stringify(data);
  const spec = [...acceptanceCases].reverse().find(c => serialized.includes(`[${c.key}]`));
  if (!spec) throw new Error('HAMA fixture request did not preserve its case marker');
  return spec;
}
export function requirementsResponse(request: AgentRequest, spec: AcceptanceCase): unknown {
  const data = request.data as {roles: StartInput['roles']; issue: {title: string; baseId: string}; peers: Array<{roleId: string}>};
  switch (request.operation) {
    case 'intake': return {brief: `[${spec.key}] ${spec.goal}`, evidence: [{sourceId: 'idea-1', kind: 'user_fact', claim: spec.goal}],
      requirements: spec.scopes.map(s => ({id: s.scopeKey, problem: `缺少${s.title}`, goal: s.title, affectedUsers: '本项目操作人员', sources: ['idea-1']})), questions: []};
    case 'dependencies': return {relations: spec.scopes.flatMap(s => s.dependencies.map(to => ({from: s.scopeKey, to, relation: 'depends_on', rationale: '需要先满足前置契约'}))), findings: []};
    case 'agenda': return {issues: spec.scopes.map((s, i) => ({baseId: s.scopeKey, title: s.title, owner: data.roles[i % data.roles.length]!.id, blockers: []}))};
    case 'propose': return {proposal: `[${spec.key}] ${data.issue.title}应明确成功、失败及边界行为`, rationale: '遵守当前来源约束', assumptions: [], sources: ['idea-1']};
    case 'critique': return {objections: data.peers.slice(0, 1).map(peer => ({roleId: peer.roleId, issue: '失败路径需可观察', reason: '调用方需要判断是否成功', suggestion: '记录明确错误和持久化结果'}))};
    case 'refine': return {state: 'resolved', candidate: spec.scopes.find(s => s.scopeKey === data.issue.baseId)!.description,
      rationale: '明确成功及失败结果，并保留原约束', rejected: [], blockers: [], relations: []};
    case 'integrate': return {goals: [spec.goal], summary: `[${spec.key}] ${spec.title}`, approach: spec.rules,
      scope: spec.scopes.map(s => ({key: s.scopeKey, kind: s.kind, title: s.title, decision: s.description, issueIds: [`issue-${s.scopeKey}`]})),
      constraints: spec.constraints, businessRules: spec.rules, outOfScope: ['未列出的扩展功能'], tradeoffs: [], risks: [], unresolved: [], externalDependencies: []} satisfies Proposal;
    case 'evaluate': return {verdict: 'pass', summary: '本地协议夹具：确认所给范围与验收有对应关系', findings: []};
    case 'prd': return {background: `[${spec.key}] ${spec.goal}`, scenarios: [spec.goal], requirements: spec.scopes.map(({kind: _kind, title: _title, ...s}) => s)} satisfies Draft;
  }
}

export function designResponse(baseline: ApprovedRequirementsBaseline, workspace: WorkspaceInventory): DesignBody {
  const campus = baseline.mode === 'demo' && baseline.projectId === 'acceptance-campus';
  const ledger = baseline.projectId === 'acceptance-ledger';
  if (!campus && !ledger && baseline.projectId !== 'acceptance-counter') throw new Error('Unexpected project in design fixture');
  const counter = !campus && !ledger;
  const requirements = baseline.prd.requirements;
  const ids = (keys: string[]) => requirements.filter(r => keys.includes(r.scopeKey)).map(r => r.id);
  const entryReqs = campus ? ids(['browse', 'register', 'mobile']) : counter ? ids(['count']) : requirements.map(r => r.id);
  const coreReqs = campus ? ids(['browse', 'register', 'capacity']) : requirements.map(r => r.id);
  const path = (p: string) => ({path: p, action: workspace.existingPaths.includes(p) ? 'modify' as const : 'create' as const});
  const failure = counter ? baseline.revision === 1 ? '文件不存在时向 stderr 报告错误，退出码非零；失败不输出部分计数' : '文件不存在时向 stderr 输出文件不存在，退出码为 2；其他读取错误非零退出'
    : ledger ? '借贷不平衡或缺失当日汇率时拒绝整个事务，不保存部分分录；重复业务编号返回原分录编号' : '无名额或重复报名时返回明确状态，不多扣名额；身份无效时拒绝报名';
  const modules: DesignBody['modules'] = [
    {id: 'entry', name: campus ? '移动报名界面' : ledger ? '记账接口' : '命令行入口', layer: campus ? 'frontend' : 'integration',
      responsibility: counter ? '接收文件路径，调用计数函数，成功向 stdout 输出整数和换行；失败向 stderr 输出错误并非零退出'
        : ledger ? '校验业务请求、币种和记账日期，返回分录编号或明确错误' : '在 360 CSS 像素视口中显示活动状态并完成报名和取消，避免横向滚动',
      inputs: [counter ? 'UTF-8 文件路径参数' : ledger ? '业务请求编号、日期、币种及借贷分录' : '活动、校园身份和用户操作'],
      outputs: [counter ? 'stdout 非空行数或 stderr 错误' : ledger ? '分录编号或过账错误' : '报名状态和失败提示'],
      files: [path(campus ? 'src/registration-view.tsx' : ledger ? 'src/journal-api.ts' : 'src/cli.ts')], requirementIds: entryReqs, dependsOn: ['core']},
    {id: 'core', name: campus ? '报名名额服务' : ledger ? '分录与汇率引擎' : '流式计数逻辑', layer: ledger ? 'data' : 'backend',
      responsibility: counter ? '以流方式按 UTF-8 逐行读取；使用 trim 后长度判断空白行；累计非空行数，不保留完整文件'
        : ledger ? '以十进制定点数检查借贷平衡，按日期汇率快照换算并四舍五入到分；按业务编号幂等地在单个事务过账'
          : '按学生和活动唯一键防重复，原子检查容量和写入报名，取消时释放名额',
      inputs: [counter ? '文件路径' : ledger ? '业务请求编号、十进制金额、记账日期及汇率快照' : '活动编号、学生编号、报名或取消操作'],
      outputs: [counter ? 'Promise<number> 非负行数' : ledger ? '平衡分录编号和换算金额' : '有效报名或明确业务状态'],
      files: [path(campus ? 'src/registration.ts' : ledger ? 'src/ledger.ts' : 'src/count.ts')], requirementIds: coreReqs, dependsOn: []},
  ];
  const owners = (id: string) => modules.filter(m => m.requirementIds.includes(id)).map(m => m.id);
  const primary = ids([campus ? 'register' : ledger ? 'journal' : 'count']);
  return {schemaVersion: 1, title: `${baseline.prd.title}软件设计`, goal: baseline.prd.sections.goals.join('；'),
    inputs: modules[0]!.inputs, outputs: modules[0]!.outputs, modules,
    interfaces: [{id: 'operation', provider: 'core', consumers: ['entry'], kind: campus ? 'http' : 'function',
      input: counter ? 'countFile(path: string): Promise<number>，路径必须指向 UTF-8 文件'
        : ledger ? 'postJournal({requestId,date,currency,debits,credits,exchangeRateSnapshot})，金额使用十进制字符串'
          : 'POST /registrations 或 DELETE /registrations/{id}；携带有效校园身份及活动编号',
      result: counter ? '返回非负整数；CLI 将其写入 stdout 并追加换行'
        : ledger ? '返回分录编号、换算后本币金额和汇率快照；USD 100.00 × 7.2000 = CNY 720.00' : '返回有效报名和剩余名额或取消状态',
      failure, sideEffects: counter ? '只读取指定文件，不修改输入文件' : ledger ? '仅成功事务保存整组分录和汇率快照' : '成功报名占用一个名额，成功取消释放名额'}],
    constraints: [...baseline.prd.sections.constraints, ...requirements.flatMap(r => r.constraints)],
    dataRules: counter ? ['逐行解码和计数；trim 后为空的行不计数；文件句柄在结束或失败时关闭']
      : ledger ? ['十进制定点金额，借贷合计相等；记录日期、币种及汇率快照；业务请求编号唯一'] : ['学生与活动唯一，名额扣减和报名写入原子完成'],
    quality: requirements.filter(r => r.kind === 'nonfunctional').map(r => ({requirementId: r.id, moduleIds: owners(r.id),
      method: `准备：${r.acceptance[0]!.given}；执行：${r.acceptance[0]!.when}；记录可观察结果`, passCondition: r.acceptance[0]!.then})),
    decisions: [{id: 'module-boundary', decision: counter ? '将 CLI 格式化和流式文件计数分开' : ledger ? '将请求接入和事务记账引擎分开' : '将移动交互与名额原子事务分开',
      rationale: '明确实现职责、跨模块契约和验证入口', alternatives: ['把所有职责放在单个入口中'], requirementIds: requirements.map(r => r.id), evidence: requirements.map(r => r.id)}],
    assumptions: [], trace: requirements.map(r => ({requirementId: r.id, moduleIds: owners(r.id), acceptance: r.acceptance.map(a => ({
      acceptanceId: a.id, method: `准备夹具：${a.given}；${a.when}；断言：${a.then}`, expectedEvidence: a.then}))})),
    unresolved: counter ? [{id: 'other-io-codes', question: '除文件不存在外的读取错误使用哪个具体非零退出码？该细分值后续确认，当前保证失败为非零退出。',
      owner: '接口负责人', requirementIds: primary, blocking: false}] : [],
    designChecks: [{id: 'DC-operation-failure', source: {kind: 'interface', id: 'operation'}, rationale: '核对设计新增的跨模块失败契约',
      requirementIds: primary, moduleIds: owners(primary[0]!), method: `向入口注入失败并核对调用方可见行为：${failure}`, expectedEvidence: failure}],
  };
}
