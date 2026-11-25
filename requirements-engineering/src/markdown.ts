import type {ApprovedRequirementsBaseline, Prd} from './contracts.ts';

export function acceptanceText(a: {given: string; when: string; then: string}): string {
  return `前提：${a.given}。操作：${a.when}。预期：${a.then}。`;
}

export function renderPrd(prd: Prd, baseline?: ApprovedRequirementsBaseline): string {
  const s = prd.sections;
  const bullets = (rows: string[]) => rows.length ? rows.map(value => `- ${value}`).join('\n') : '无记录';
  const sections = [
    `# ${prd.title}`,
    baseline ? [
      `需求基线 ${baseline.id} / v${baseline.revision}`,
      `内容校验 SHA-256 ${baseline.sha256}`,
      `确认人 ${baseline.confirmation.actor} · ${baseline.confirmation.decidedAt}`,
    ].join('\n\n') : '待确认 PRD 草案',
    `PRD v${prd.revision} · 候选方案 v${prd.proposal.revision} · 方案审批 ${prd.approvalId}`,
    `## 背景与目标\n\n${prd.background}\n\n${bullets(s.goals)}`,
    `## 用户与场景\n\n${bullets(prd.scenarios)}`,
    `## 方案摘要\n\n${s.summary}\n\n${bullets(s.approach)}`,
    `## 范围与取舍\n\n${bullets([...s.outOfScope.map(row => `范围外 · ${row}`), ...s.tradeoffs])}`,
    `## 业务规则\n\n${bullets(s.businessRules)}`,
    `## 约束与外部依赖\n\n${bullets([...s.constraints, ...s.externalDependencies])}`,
    `## 风险、假设与未决事项\n\n${bullets([...s.risks, ...s.unresolved])}`,
    ...(['functional', 'nonfunctional'] as const).map(kind => [
      `## ${kind === 'functional' ? '功能需求' : '非功能需求'}`,
      ...prd.requirements.filter(r => r.kind === kind).map(r => [
        `### ${r.id} · ${r.title}`, r.description,
        `优先级 ${r.priority} · 状态 ${r.state} · 业务价值 ${r.value}`,
        ...r.dependencies.map(dep => `- 依赖 ${dep}`),
        ...r.constraints.map(constraint => `- 约束 ${constraint}`),
        ...r.acceptance.map(a => `- **${a.id}** ${acceptanceText(a)}`),
      ].join('\n\n')),
    ].join('\n\n')),
    `## 需求追踪\n\n${prd.trace.map(link =>
      `- ${link.ideaAndDocumentIds.join(', ')} → ${link.issueIds.join(', ')} → 方案 v${link.proposal.revision} / ${link.scopeKey} → 审批 ${link.approvalId} → ${link.requirementId} → ${link.acceptanceIds.join(', ')}`,
    ).join('\n')}`,
    `## 变更记录\n\n${bullets(prd.changes)}`,
  ];
  return `${sections.join('\n\n')}\n`;
}
