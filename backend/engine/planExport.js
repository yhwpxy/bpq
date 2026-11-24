import { validatePlanSchema } from '../../shared/schema.js';
import { AppError } from '../services/errors.js';
const cell = value => String(value ?? '').replaceAll('|', '\\|').replace(/[\r\n]+/g, ' ');
const label = value => String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;').replace(/[\r\n]/g,' ');
export function exportPlan(plan) {
  const errors = validatePlanSchema(plan); if (errors.length) throw new AppError(40001, 'Cannot export malformed plan', errors);
  const ids = new Map(plan.nodes.map((n,i)=>[n.id,`n${i}`]));
  const lines = ['flowchart LR'];
  for (const n of plan.nodes) lines.push(`  ${ids.get(n.id)}["${label(n.props.name || n.type)}"]`);
  for (const e of plan.edges) if (ids.has(e.source) && ids.has(e.target)) lines.push(`  ${ids.get(e.source)} ${e.kind==='loop'?'-.->':'-->'}|"${label(e.label || e.kind || 'dep')}"| ${ids.get(e.target)}`);
  const goal = plan.workflow?.goalSpec;
  const md = [`# ${cell(plan.name)}`, '', '## Goal / 目标', '', goal?.goal || plan.meta?.description || '', '', '## Requirements and acceptance / 需求与验收', '',
    ...(goal ? [...goal.requirements,...goal.acceptanceCriteria].map(r=>`- **${r.id}** — ${cell(r.text)} (${r.source}; origin=${r.origin})`) : []), '',
    '## Work breakdown / 任务层级', '', ...(plan.workflow?.groups || []).map(g=>`${g.kind==='task'?'  ':''}- ${cell(g.title)} (${g.id})`), '',
    '| Node | Parent | Executor | FR / AC | Planning rationale |', '| --- | --- | --- | --- | --- |',
    ...plan.nodes.map(n=>`| ${cell(n.props.name || n.type)} | ${cell(n.props.parentId)} | ${cell(n.props.capabilityId || n.props.executorKind || 'simulation')} | ${cell([...(n.props.requirementRefs||[]),...(n.props.acceptanceRefs||[])].join(', '))} | ${cell(n.props.planningRationale)} |`), '', '## Flow / 执行图', '', '```mermaid', ...lines, '```', '', 'This is a design export, not a successful execution certificate. / 本文件是设计导出，不是执行成功证明。', ''];
  return { markdown: md.join('\n'), mermaid: lines.join('\n'), json: structuredClone(plan) };
}
