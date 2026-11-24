import { validateGoalSpec } from '../../shared/goalSpecSchema.js';
import { AppError } from '../services/errors.js';

const headings = [
  ['acceptanceCriteria', /acceptance|criteria|验收/i], ['requirements', /requirement|feature|功能|需求/i],
  ['inputs', /input|输入/i], ['outputs', /output|deliverable|输出|交付/i],
  ['constraints', /constraint|限制|约束|non.functional/i], ['assumptions', /assumption|假设|前提/i],
  ['modules', /module|component|模块|组件/i], ['goal', /goal|objective|目标|概述/i],
];
const prefixes = { requirements: 'FR', acceptanceCriteria: 'AC', inputs: 'IN', outputs: 'OUT', constraints: 'CON', assumptions: 'ASM', modules: 'MOD' };
const item = (id, text, source = 'doc', line = null) => ({ id, text, source, origin: source, sourceLine: line });

export function parseGoal(text) {
  if (typeof text !== 'string' || !text.trim() || Buffer.byteLength(text) > 204800) throw new AppError(40001, '需求须为非空文本，最多 200KB');
  const spec = { title: '新工作流', goal: '', rawText: text, ...Object.fromEntries(Object.keys(prefixes).map(k => [k, []])) };
  let section = 'goal', fence = false;
  const goals = [];
  text.replace(/^\uFEFF/, '').split(/\r?\n/).forEach((raw, index) => {
    let line = raw.trim();
    if (/^(```|~~~)/.test(line)) { fence = !fence; return; }
    if (fence || !line) return;
    const title = /^#\s+(.+)$/.exec(line);
    if (title) { spec.title = title[1]; return; }
    const heading = /^#{2,6}\s+(.+)$/.exec(line);
    if (heading) { section = headings.find(([, re]) => re.test(heading[1]))?.[0] ?? 'goal'; return; }
    line = line.replace(/^\s*(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/, '').replace(/\*\*/g, '');
    const explicit = /^(FR|AC)-(\d+)\s*[:：\-]?\s*(.+)$/i.exec(line);
    const field = explicit ? (explicit[1].toUpperCase() === 'FR' ? 'requirements' : 'acceptanceCriteria') : section;
    if (field === 'goal') { goals.push(line); return; }
    const values = spec[field];
    const id = explicit ? `${explicit[1].toUpperCase()}-${explicit[2]}` : `${prefixes[field]}-${String(values.length + 1).padStart(2, '0')}`;
    const value = item(id, explicit?.[3] ?? line, 'doc', index + 1);
    if (field === 'acceptanceCriteria') value.requirementRefs = [...new Set(value.text.match(/FR-\d+/g) ?? [])];
    if (field === 'inputs' || field === 'outputs') {
      const contract = /^([A-Za-z_]\w*)\s*[:：]\s*(string|number|boolean|object|array|file|any)\b/.exec(value.text);
      Object.assign(value, { name: contract?.[1] ?? `${field === 'inputs' ? 'input' : 'output'}_${values.length + 1}`, type: contract?.[2] ?? 'any', required: true });
    }
    values.push(value);
  });
  spec.goal = goals.join('\n') || spec.title;
  if (!spec.requirements.length) spec.requirements.push(item('FR-01', spec.goal, 'suggested'));
  if (!spec.acceptanceCriteria.length) spec.acceptanceCriteria.push({ ...item('AC-01', '验证交付物满足所列需求；请补充可执行验收标准。', 'suggested'), requirementRefs: spec.requirements.map(r => r.id) });
  for (const field of ['inputs', 'outputs']) if (!spec[field].length) spec[field].push({ ...item(`${prefixes[field]}-01`, field === 'inputs' ? '确认的需求和工作区基线' : '执行产物与验收证据', 'suggested'), name: field === 'inputs' ? 'source' : 'result', type: 'object', required: true });
  if (Object.values(spec).some(v => Array.isArray(v) && v.some(x => x.source === 'suggested'))) spec.assumptions.push(item('ASM-inferred', '缺失的契约或验收标准由规则补充，需要人工核对。', 'suggested'));
  assertGoal(spec);
  return spec;
}

export function assertGoal(spec) {
  const issues = validateGoalSpec(spec);
  if (issues.length) throw new AppError(40001, '需求契约不合法', issues);
  return spec;
}

/** Existing NL provider remains strict; new provenance is added outside TaskSpec. */
export function goalFromTasks(text, taskSpec) {
  const spec = parseGoal(text);
  spec.title = taskSpec.source;
  spec.requirements = taskSpec.tasks.filter(t => t.type !== 'start' && t.type !== 'end').map((t, i) => item(`FR-${String(i + 1).padStart(2, '0')}`, t.name, 'suggested'));
  spec.acceptanceCriteria = [{ ...item('AC-01', '核对模型拆分的任务与原始需求，并补充可执行验收标准。', 'suggested'), requirementRefs: spec.requirements.map(r => r.id) }];
  return assertGoal(spec);
}
