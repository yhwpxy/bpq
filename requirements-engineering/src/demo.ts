import type {AgentRequest} from './agents.ts';
import type {Issue, Proposal, StartInput} from './contracts.ts';

const base = [
  {id: 'browse', problem: '难以在移动端找到可报名活动', goal: '浏览可报名活动'},
  {id: 'register', problem: '缺少活动报名入口和取消入口', goal: '报名或取消'},
  {id: 'capacity', problem: '并发报名时可能超过名额', goal: '确认报名时校验容量'},
  {id: 'mobile', problem: '小屏幕上的操作步骤过多', goal: '移动端易用'},
].map(row => ({...row, affectedUsers: '学生', sources: ['idea-1']}));
const dependencies = [{from: 'register', to: 'capacity', relation: 'prerequisite', rationale: '确认报名必须先获得名额。'}];

export function campusResponder(request: AgentRequest): unknown {
  switch (request.operation) {
    case 'intake':
      return {
        brief: '在有限周期内为校园服务平台增加易用的移动端活动报名。',
        evidence: [{sourceId: 'idea-1', kind: 'user_fact', claim: '需要移动报名和人数限制，开发周期有限。'}],
        requirements: base, questions: [{
          id: 'account', critical: true, question: '首版能否沿用已有校园账号？', reason: '身份入口影响范围和进度。',
        }],
      };
    case 'dependencies':
      return {relations: dependencies, findings: ['确认和取消均影响剩余名额。']};
    case 'agenda': {
      const {roles} = request.data as {roles: StartInput['roles']};
      return {issues: base.map((req, i) => ({
        baseId: req.id, title: req.goal, owner: roles[i % roles.length]!.id, blockers: [],
      }))};
    }
    case 'propose': {
      const {issue} = request.data as {issue: Issue};
      return {proposal: `${request.role} 建议优先交付 ${issue.title}，并检查失败提示。`,
        rationale: '保持首版范围可控。', assumptions: [], sources: ['idea-1']};
    }
    case 'critique': {
      const {peers} = request.data as {peers: {roleId: string}[]};
      return {objections: peers.slice(0, 1).map(peer => ({
        roleId: peer.roleId, issue: '需要定义失败路径', reason: '结果未知会误导用户', suggestion: '展示可观察的失败状态',
      }))};
    }
    case 'refine': {
      const {issue} = request.data as {issue: Issue};
      return {state: 'resolved', candidate: `支持${issue.title}，同时明确成功与失败结果。`,
        rationale: '采纳对失败路径和容量上限的质疑。', blockers: [], relations: [],
        rejected: [{opinion: '首版增加候补队列', reason: '首版周期有限，候补超出当前范围。'}]};
    }
    case 'integrate':
      return {
        goals: ['完成移动活动报名，保证名额上限'], summary: '复用校园身份和活动列表，明确报名状态。',
        approach: ['确认报名时以原子操作扣减容量', '取消成功后释放名额'],
        scope: base.map(row => ({
          key: row.id, kind: row.id === 'mobile' ? 'nonfunctional' : 'functional',
          title: row.goal, decision: row.goal, issueIds: [`issue-${row.id}`],
        })),
        outOfScope: ['候补队列'], constraints: ['复用已有校园登录', '首版使用现有活动列表'],
        tradeoffs: ['先交付报名与容量校验'], risks: ['需验证末席并发报名'], unresolved: [],
        businessRules: ['同一学生不可重复报名同一活动'], externalDependencies: ['校园统一身份认证'],
      };
    case 'evaluate':
      return {verdict: 'pass', summary: `${request.role} 已检查提案与校园报名目标的对应关系。`, findings: []};
    case 'prd': {
      const {proposal} = request.data as {proposal: {data: Proposal}};
      const acceptance = {
        browse: ['存在一个可报名活动', '学生打开活动列表', '列表显示该活动及其报名状态'],
        register: ['用户尚未报名且有余量', '用户连续提交两次报名', '仅产生一个有效报名记录'],
        capacity: ['活动仅余一个名额', '两名学生同时报名', '仅一人成功，另一人收到名额已满提示'],
        mobile: ['视口宽度为 360 CSS 像素', '学生打开并操作报名页面', '页面无横向滚动且可完成报名'],
      };
      return {
        background: '校园服务平台的学生需要在移动端完成活动报名。',
        scenarios: ['学生浏览活动、确认报名、取消报名。'],
        requirements: proposal.data.scope.map(scope => {
          const [given, when, then] = acceptance[scope.key as keyof typeof acceptance]!;
          return {scopeKey: scope.key, description: scope.decision, value: '便于学生管理活动报名。',
            priority: 'must', dependencies: scope.key === 'register' ? ['capacity'] : [],
            constraints: ['复用已有校园登录'], acceptance: [{key: 'main', given, when, then}]};
        }),
      };
    }
  }
}
