import {parseRequirementsMarkdown} from '../../workflow-orchestrator/src/core/spec-parser.ts';
import type {DesignInputDraft} from './contracts.ts';
import type {DesignBody, DesignDiagnostic} from './design-schema.ts';

const line = (s: string) => s.replace(/[\r\n`]+/g, ' ').trim();
export function renderDesign(body: DesignBody, input: DesignInputDraft) {
  const reqs = input.baseline.prd.requirements;
  const codes = new Map(reqs.map((r, i) => [r.id, `FR-${String(i + 1).padStart(2, '0')}`]));
  const acs = reqs.flatMap(r => r.acceptance.map(a => ({...a, requirementId: r.id})));
  const list = (values: string[]) => values.map(v => `- ${line(v)}`).join('\n');
  const pmMarkdown = [
    `# ${line(body.title)}`, `## 目标\n${line(body.goal)}`,
    `## 输入\n${list(body.inputs)}`, `## 输出\n${list(body.outputs)}`,
    `## 需求\n${list(reqs.map(r => `${codes.get(r.id)} [${r.id}] ${r.description} 优先级 ${r.priority}`))}`,
    `## 模块\n${body.modules.map(m => `- ${line(m.name)}: ${line(m.responsibility)}；依赖 ${m.dependsOn.join(', ') || '无'}；接口 ${line(body.interfaces.filter(c => c.provider === m.id || c.consumers.includes(m.id)).map(c => `${c.id}: ${c.input} → ${c.result}；失败 ${c.failure}`).join('；'))}；覆盖 ${m.requirementIds.map(id => codes.get(id)).join(', ')} (${m.files.map(f => `\`${/[/.]/.test(f.path) ? f.path : `./${f.path}`}\``).join(', ')})`).join('\n')}`,
    `## 约束\n${list([...input.baseline.prd.sections.constraints, ...reqs.flatMap(r => r.constraints.map(c => `${r.id}: ${c}`)), ...body.constraints])}`,
    `## 领域规则\n${list([...input.baseline.prd.sections.businessRules, ...body.dataRules])}`,
    `## 验收\n${list(acs.map((a, i) => {
      const check = body.trace.find(t => t.requirementId === a.requirementId)?.acceptance.find(v => v.acceptanceId === a.id);
      return `AC-${String(i + 1).padStart(2, '0')} ${codes.get(a.requirementId)} [${a.id}] Given ${a.given}; When ${a.when}; Then ${a.then}; 验证 ${check?.method}; 证据 ${check?.expectedEvidence}`;
    }))}`,
    `## 假设\n${list(body.assumptions.map(a => `${a.id}: ${a.text}；核验 ${a.verification}`))}`,
  ].join('\n\n') + '\n';
  const reviewMarkdown = [pmMarkdown,
    `## 来源记录\n${list([`基线 ${input.baselineRef.id} / ${input.baselineRef.projectId} / v${input.baselineRef.revision} / ${input.baselineRef.sha256}`,
      `目标 ${input.workspace.workspaceId} / ${input.workspace.sourceCommit ?? '概念设计'}`, `范围外 ${input.baseline.prd.sections.outOfScope.join('；') || '无'}`])}`,
    ...(['modules', 'interfaces', 'quality', 'decisions', 'assumptions', 'trace', 'unresolved'] as const).map(key =>
      `## ${key}\n\n\`\`\`json\n${JSON.stringify(body[key], null, 2)}\n\`\`\``),
    ...(body.designChecks?.length ? [`## 设计补充检查（独立于 HAMA 原始 AC）\n\n\`\`\`json\n${JSON.stringify(body.designChecks, null, 2)}\n\`\`\``] : []),
  ].join('\n\n');
  return {pmMarkdown, reviewMarkdown};
}

export function validatePreview(body: DesignBody, input: DesignInputDraft, markdown: string): DesignDiagnostic[] {
  const parsed = parseRequirementsMarkdown({workflowId: input.designId, rawMarkdown: markdown});
  const diagnostics: DesignDiagnostic[] = [];
  const fail = (message: string) => diagnostics.push({path: 'pmMarkdown', code: 'preview_mismatch', message, severity: 'error'});
  if (parsed.goal !== line(body.goal)) fail('预览目标与正文不一致');
  if (parsed.modules?.length !== body.modules.length || parsed.requirements.length !== input.baseline.prd.requirements.length ||
    parsed.acceptanceCriteria.length !== input.baseline.prd.requirements.flatMap(r => r.acceptance).length) fail('预览模块、需求或验收数量不一致');
  body.modules.forEach((m, i) => {
    const got = parsed.modules?.[i];
    if (!got || got.name !== m.name || got.artifacts.length !== m.files.length || m.files.some(f => !got.artifacts.map(p => p.replace(/^\.\//, '')).includes(f.path))) fail(`模块 ${m.id} 的名称或文件范围不能被既有解析器识别`);
    const expected = m.requirementIds.map(id => `FR-${String(input.baseline.prd.requirements.findIndex(r => r.id === id) + 1).padStart(2, '0')}`);
    if (!got || got.relatedFrCodes.length !== expected.length || expected.some(code => !got.relatedFrCodes.includes(code))) fail(`模块 ${m.id} 的需求引用不一致`);
  });
  input.baseline.prd.requirements.forEach(r => {
    if (!parsed.requirements.some(p => p.description.includes(`[${r.id}]`))) fail(`预览缺少原始需求 ${r.id}`);
    r.acceptance.forEach(a => {if (!parsed.acceptanceCriteria.some(p => p.label.includes(`[${a.id}]`))) fail(`预览缺少原始 AC ${a.id}`);});
  });
  return diagnostics;
}
