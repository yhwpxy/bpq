import { stat } from 'node:fs/promises';
import { inside, matchesScope } from '../sandbox/pathPolicy.js';
export function valueMatches(type, value) {
  if (type === 'any') return value !== undefined;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (type === 'file') return typeof value === 'string' && value.length > 0;
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === type;
}
export async function verifyValues(contracts, values, cwd) {
  const problems = [];
  for (const c of contracts) {
    const value = values?.[c.name];
    if (value === undefined && !c.required) continue;
    if (!valueMatches(c.type, value)) { problems.push(`Invalid ${c.name}: expected ${c.type}`); continue; }
    if (c.type === 'file') {
      try { if (!(await stat(await inside(cwd, value))).isFile()) throw new Error('not file'); }
      catch { problems.push(`File output is unavailable inside the worktree: ${c.name}`); }
    }
  }
  return problems;
}
export function parseAuditVerdict(text) {
  try {
    const v = JSON.parse(text);
    if (!v || typeof v.passed !== 'boolean' || !Number.isFinite(v.score) || v.score < 0 || v.score > 1 || !Array.isArray(v.findings) || v.findings.some(f => typeof f !== 'string')) throw new Error();
    return { passed: v.passed && v.score >= 0.75, score: v.score, findings: v.findings };
  } catch { return { passed: false, score: 0, findings: ['QA response must be a complete JSON verdict with passed, score and findings'] }; }
}
export function createCertifier(capabilities, workspaces) {
  const requestFor = (node, env) => ({ cwd: env.snapshot.workspaceHandle.cwd, command: node.props.command, args: node.props.args || [], signal: env.signal, onChunk: env.onChunk, timeoutMs: node.props.timeoutMs || 60000,
    permissionTier: env.snapshot.graph.workflow.permissionTier, approved: env.snapshot.approved,
    extraEnv: { VTO_ATTEMPT: String(env.attempt), VTO_RUN_ID: env.snapshot.id } });
  async function gate(node, env) {
    if (typeof node.props.command !== 'string' || !node.props.command.trim()) return { outcome: 'task_failure', output: 'Verification command is required' };
    const result = await capabilities.invoke('local-tool', requestFor(node, env));
    return { ...result, output: `${node.props.demonstrationGate ? '[演示门禁，仅验证编排链路] ' : ''}${result.output}`,
      certification: { kind: 'command', passed: result.outcome === 'completed', exitCode: result.exitCode, demonstration: Boolean(node.props.demonstrationGate), acceptanceRefs: node.props.acceptanceRefs } };
  }
  async function selfcheck(_node, env) {
    const diff = await workspaces.diff(env.snapshot.workspaceHandle), checks = [];
    if (env.snapshot.mode !== 'simulation') {
      for (const node of env.snapshot.graph.nodes.filter(n => ['tool', 'agent'].includes(n.props.executorKind) && env.snapshot.nodeStates[n.id].status === 'SUCCESS')) {
        const values = env.context.outputs[node.id];
        if (values) checks.push(...await verifyValues(node.props.outputContract, values, env.snapshot.workspaceHandle.cwd));
      }
    }
    return { outcome: checks.length ? 'task_failure' : 'completed', output: `${env.snapshot.mode === 'simulation' ? '[模拟自检，不认证业务产物] ' : ''}Diff: ${diff.files.length} files${checks.length ? `; ${checks.join('; ')}` : ''}`, diff,
      certification: { kind: 'selfcheck', passed: !checks.length, simulation: env.snapshot.mode === 'simulation', findings: checks, files: diff.files } };
  }
  async function qa(node, env) {
    const gates = env.snapshot.graph.nodes.filter(n => n.props.control === 'gate');
    if (!gates.length || gates.some(n => env.snapshot.nodeStates[n.id].status !== 'SUCCESS' || n.props.demonstrationGate)) return { outcome: 'task_failure', output: 'Independent QA requires actual passing verification commands' };
    const diff = await workspaces.diff(env.snapshot.workspaceHandle);
    const result = await capabilities.invoke(node.props.capabilityId, {
      ...requestFor(node, env), role: 'evaluator', readOnly: true, fileScope: [],
      prompt: JSON.stringify({ goal: env.snapshot.graph.workflow.goalSpec.goal, acceptanceCriteria: env.snapshot.graph.workflow.goalSpec.acceptanceCriteria,
        verifiedCommands: gates.map(n => ({ command: n.props.command, args: n.props.args })), changedFiles: diff.files, patch: diff.patch.slice(0, 24000),
        instruction: 'Read-only independent review. Evaluate actual evidence against acceptance criteria. Return only JSON: {"passed":boolean,"score":number,"findings":string[]}. Do not assume missing evidence passes.' }),
    });
    const verdict = result.outcome === 'completed' ? parseAuditVerdict(result.output) : { passed: false, score: 0, findings: [result.output || 'QA invocation failed'] };
    return { ...result, outcome: verdict.passed ? 'completed' : 'task_failure', output: JSON.stringify(verdict), certification: { kind: 'qa', ...verdict, files: diff.files } };
  }
  async function security(_node, env) {
    const diff = await workspaces.diff(env.snapshot.workspaceHandle);
    const scopes = env.snapshot.graph.nodes.filter(n => ['tool','agent'].includes(n.props.executorKind)).flatMap(n => n.props.fileScope || []);
    const findings = [];
    for (const file of diff.files) {
      if (!matchesScope(file, scopes)) findings.push(`Changed file outside declared worker scopes: ${file}`);
      if (/(^|\/)\.env(?:\.|$)|\.(?:pem|key)$/i.test(file)) findings.push(`Potential credential artifact requires review: ${file}`);
      try { await inside(env.snapshot.workspaceHandle.cwd, file); } catch { findings.push(`Unsafe artifact path: ${file}`); }
    }
    return { outcome: findings.length ? 'task_failure' : 'completed', output: findings.length ? findings.join('; ') : `Scoped artifact checks passed (${diff.files.length} files); not a vulnerability scanner`, certification: { kind: 'scope-security', passed: !findings.length, findings } };
  }
  return { gate, selfcheck, qa, security };
}
