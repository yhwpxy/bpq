import { createEmptyPlan, createNode, autoLayout } from '../../shared/plan.js';
import { WORKFLOW_TEMPLATES } from '../../shared/workflowTemplates.js';
import { assertGoal } from './goalParser.js';
import { AppError } from '../services/errors.js';
export function compileWorkflow(goalSpec, options = {}, capabilities = []) {
  assertGoal(goalSpec);
  const template = WORKFLOW_TEMPLATES.find(t => t.id === (options.template || 'rapid'));
  if (!template) throw new AppError(40001, 'Unknown workflow template');
  const config = { ...template, ...options }, plan = createEmptyPlan();
  const tier = config.permissionTier || 'supervised';
  plan.name = goalSpec.title.slice(0, 50); plan.meta.maxConcurrency = config.maxConcurrency;
  plan.workflow = { format: 'twin-1', goalSpec: structuredClone(goalSpec), permissionTier: tier, maxReworkIterations: config.maxReworkIterations ?? 2, template: config.id, budgetUsd: config.budgetUsd ?? null, groups: [] };
  const phases = ['理解与准备 / Prepare', '并行交付 / Deliver', '验证与恢复 / Verify'].map((title, i) => ({ id: `phase_${i + 1}`, kind: 'phase', parentId: null, title }));
  plan.workflow.groups.push(...phases);
  const inputs = goalSpec.inputs.map(({ name, type, required }) => ({ name, type, required }));
  const outputs = goalSpec.outputs.map(({ name, type, required }) => ({ name, type, required }));
  function node(type, name, phase, control, extra = {}) {
    const n = createNode(type); n.props = { ...n.props, name: name.slice(0, 50), duration: 0, retry: 0, failRate: 0,
      executorKind: control === 'human' ? 'human' : 'control', planningRationale: `为“${goalSpec.title}”提供${name}；通过明确的输入、输出和依赖接续执行。`, requirementRefs: [], acceptanceRefs: [], inputContract: inputs, outputContract: inputs, fileScope: [], parentId: phases[phase].id, phaseId: phases[phase].id, depth: 1, ...(control ? { control } : {}), ...extra };
    plan.nodes.push(n); return n;
  }
  const edge = (a, b, kind = 'dep', label) => plan.edges.push({ id: `edge_${plan.edges.length + 1}`, source: a.id, target: b.id, kind, ...(label ? { label } : {}) });
  const start = node('start', '开始', 0);
  const prepare = node('task', '确认输入契约', 0, 'prepare'); edge(start, prepare);
  let tail = prepare;
  if (config.human || tier === 'strict') { const human = node('task', '确认执行授权', 0, 'human'); edge(tail, human); tail = human; }
  const cp1 = node('task', '输入基线检查点', 0, 'checkpoint'); edge(tail, cp1);
  const workers = goalSpec.requirements.map((req, i) => {
    const module = goalSpec.modules[i % Math.max(1, goalSpec.modules.length)];
    const group = { id: `task_${i + 1}`, kind: 'task', parentId: phases[1].id, title: module ? `${module.text} / ${req.text}` : req.text }; plan.workflow.groups.push(group);
    const cap = capabilities.find(c => c.id === (config.capabilityId || 'simulated'));
    const n = node('task', req.text, 1, undefined, { executorKind: cap?.kind || 'tool', capabilityId: config.capabilityId || 'simulated', parentId: group.id, depth: 2, requirementRefs: [req.id], outputContract: outputs, fileScope: [`artifacts/${req.id.toLowerCase()}/**`], prompt: req.text, moduleId: module?.id || null, planningRationale: `以 ${req.id} 为可验收单元${module ? `，归属模块 ${module.text}` : ''}；限定写入 artifacts/${req.id.toLowerCase()}/，允许与其他交付任务并行。` });
    edge(cp1, n); return n;
  });
  const outputProps = { inputContract: outputs, outputContract: outputs };
  const join = node('task', '汇总交付物', 1, 'join', outputProps); workers.forEach(w => edge(w, join));
  const condition = node('condition', '选择验证路径', 1, undefined, { ...outputProps, expression: config.branchExpression || String(Boolean(config.security)) }); edge(join, condition);
  const full = node('task', '扩展检查路径', 1, 'prepare', outputProps), quick = node('task', '基础检查路径', 1, 'prepare', outputProps);
  edge(condition, full, 'pass', 'true'); edge(condition, quick, 'pass', 'false');
  const merge = node('task', '等待验证路径汇合', 1, 'join', outputProps); edge(full, merge); edge(quick, merge);
  const cp2 = node('task', '交付检查点', 1, 'checkpoint', outputProps); edge(merge, cp2);
  const gate = node('task', '执行验收命令', 2, 'gate', { ...outputProps, command: config.command || process.execPath, args: config.args || ['-e', 'console.log("Demonstration gate; configure real acceptance command")'], acceptanceRefs: goalSpec.acceptanceCriteria.map(a => a.id), demonstrationGate: !config.command }); edge(cp2, gate);
  const self = node('task', '检查产物差异', 2, 'selfcheck', outputProps); edge(gate, self, 'pass'); tail = self;
  let qa;
  if (config.qa) { qa = node('task', '独立验收复核', 2, 'qa', { ...outputProps, capabilityId: config.qaCapabilityId || 'native-api', executorKind: 'agent', acceptanceRefs: goalSpec.acceptanceCriteria.map(a => a.id) }); edge(self, qa); tail = qa; }
  const cp3 = node('task', '验收检查点', 2, 'checkpoint', outputProps); edge(tail, cp3, 'pass');
  const done = node('end', '完成', 2, undefined, outputProps); edge(cp3, done);
  const restore = node('task', '从交付检查点返工', 2, 'restore', { inputContract: [], outputContract: [], restoreTarget: cp2.id });
  edge(gate, restore, 'fail'); if (qa) edge(qa, restore, 'fail'); edge(restore, cp2, 'loop');
  if (plan.nodes.length > 100 || plan.edges.length > 200) throw new AppError(40001, 'Compiled workflow exceeds 100 nodes / 200 edges; split the requirements');
  return autoLayout(plan);
}
