import type {DesignInputDraft} from './contracts.ts';
import type {DesignBody, DesignDiagnostic} from './design-schema.ts';

export function validateDesign(body: DesignBody, input: DesignInputDraft): DesignDiagnostic[] {
  const issues: DesignDiagnostic[] = [];
  const add = (path: string, code: string, message: string, severity: 'error' | 'warning' = 'error') => issues.push({path, code, message, severity});
  const requirements = new Map(input.baseline.prd.requirements.map(r => [r.id, r]));
  const modules = new Map(body.modules.map(m => [m.id, m]));
  const existing = new Set(input.workspace.existingPaths);
  const evidence = new Set([input.baseline.id, input.baseline.approval.id, input.baseline.confirmation.id,
    input.baseline.prd.proposal.id, ...requirements.keys(), ...existing,
    ...input.baseline.prd.trace.flatMap(t => [...t.issueIds, ...t.ideaAndDocumentIds, ...t.acceptanceIds])]);
  const unique = (ids: string[], path: string) => {if (new Set(ids).size !== ids.length) add(path, 'duplicate', '编号或引用重复');};
  const reqRefs = (ids: string[], path: string) => ids.forEach(id => {if (!requirements.has(id)) add(path, 'unknown_requirement', `未知原始需求 ${id}`);});
  const modRefs = (ids: string[], path: string) => ids.forEach(id => {if (!modules.has(id)) add(path, 'unknown_module', `未知模块 ${id}`);});
  unique(body.modules.map(m => m.id), 'modules.id');
  unique(body.modules.map(m => m.name), 'modules.name');
  unique(body.interfaces.map(i => i.id), 'interfaces.id');
  unique(body.trace.map(t => t.requirementId), 'trace.requirementId');
  const writers = new Map<string, string>();
  body.modules.forEach((m, i) => {
    const path = `modules[${i}]`;
    reqRefs(m.requirementIds, `${path}.requirementIds`); unique(m.requirementIds, `${path}.requirementIds`);
    modRefs(m.dependsOn, `${path}.dependsOn`); unique(m.dependsOn, `${path}.dependsOn`);
    unique(m.files.map(f => f.path), `${path}.files`);
    m.files.forEach((f, j) => {
      const p = `${path}.files[${j}]`;
      if (/[\\:*?"<>|`\x00-\x1f]/.test(f.path) || f.path.split('/').some(s => !s || s === '.' || s === '..' || s.toLowerCase() === '.git') || f.path.startsWith('/')) add(p, 'unsafe_path', '文件必须为工程内具体相对路径，不接受通配符、绝对路径、Git 元数据或目录跳转');
      if (f.action === 'create' ? existing.has(f.path) : !existing.has(f.path)) add(p, 'file_action', 'create 必须是拟新增文件，modify/reuse 必须指向选定提交内已有文件');
      if (f.action !== 'reuse') {
        const key = f.path.toLowerCase();
        const owner = [...writers].find(([other]) => other === key || other.startsWith(`${key}/`) || key.startsWith(`${other}/`));
        if (owner) add(p, 'overlapping_write', `文件写入责任与模块 ${owner[1]} 重叠`);
        writers.set(key, m.id);
      }
    });
  });
  const visiting = new Set<string>(), visited = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) {add(`modules.${id}.dependsOn`, 'dependency_cycle', '模块依赖形成环'); return;}
    if (visited.has(id)) return;
    visiting.add(id); modules.get(id)?.dependsOn.forEach(visit); visiting.delete(id); visited.add(id);
  };
  modules.forEach(m => visit(m.id));
  body.interfaces.forEach((c, i) => {
    modRefs([c.provider, ...c.consumers.filter(id => id !== 'external')], `interfaces[${i}]`);
    for (const id of c.consumers) if (id !== 'external' && id !== c.provider && !modules.get(id)?.dependsOn.includes(c.provider)) add(`interfaces[${i}].consumers`, 'missing_dependency', `${id} 消费 ${c.provider} 的接口但未声明依赖`);
  });
  body.modules.forEach((m, i) => m.dependsOn.forEach(id => {
    if (!body.interfaces.some(c => c.provider === id && c.consumers.includes(m.id))) add(`modules[${i}].dependsOn`, 'missing_interface', `${m.id} 与 ${id} 缺少跨模块契约`);
  }));
  for (const r of requirements.values()) {
    const t = body.trace.find(t => t.requirementId === r.id);
    if (!t) {add('trace', 'uncovered_requirement', `${r.id} 缺少实现及验收追踪`); continue;}
    modRefs(t.moduleIds, `trace.${r.id}.moduleIds`); unique(t.moduleIds, `trace.${r.id}.moduleIds`);
    const owners = body.modules.filter(m => m.requirementIds.includes(r.id)).map(m => m.id);
    if (!owners.length || owners.length !== t.moduleIds.length || owners.some(id => !t.moduleIds.includes(id))) add(`trace.${r.id}`, 'ownership_mismatch', '需求的模块归属与追踪表不一致');
    unique(t.acceptance.map(a => a.acceptanceId), `trace.${r.id}.acceptance`);
    for (const a of r.acceptance) if (!t.acceptance.some(v => v.acceptanceId === a.id)) add(`trace.${r.id}.acceptance`, 'uncovered_ac', `${a.id} 缺少验证方法和预期证据`);
    t.acceptance.forEach(a => {if (!r.acceptance.some(v => v.id === a.acceptanceId)) add(`trace.${r.id}.acceptance`, 'unknown_ac', `${a.acceptanceId} 不属于原始需求`);});
    if (r.kind === 'nonfunctional' && owners.some(id => !body.quality.some(q => q.requirementId === r.id && q.moduleIds.includes(id)))) add('quality', 'uncovered_nfr', `${r.id} 缺少适用模块的观测及判定条件`);
    for (const dep of r.dependencies) {
      const targets = body.modules.filter(m => m.requirementIds.includes(dep));
      if (!owners.some(id => targets.some(target => target.id === id || modules.get(id)?.dependsOn.includes(target.id)))) add(`trace.${r.id}`, 'requirement_dependency', `未体现对需求 ${dep} 的依赖`);
    }
  }
  body.trace.forEach((t, i) => reqRefs([t.requirementId], `trace[${i}]`));
  body.quality.forEach((q, i) => {
    reqRefs([q.requirementId], `quality[${i}]`); modRefs(q.moduleIds, `quality[${i}].moduleIds`);
    if (q.moduleIds.some(id => !modules.get(id)?.requirementIds.includes(q.requirementId))) add(`quality[${i}]`, 'quality_ownership', '质量要求未关联到适用模块');
  });
  for (const group of ['decisions', 'assumptions'] as const) {
    unique(body[group].map(item => item.id), `${group}.id`);
    body[group].forEach((item, i) => {
      reqRefs(item.requirementIds, `${group}[${i}].requirementIds`);
      item.evidence.forEach(id => {if (!evidence.has(id)) add(`${group}[${i}].evidence`, 'unknown_evidence', `证据 ${id} 不在基线或源码清单中`);});
      if (!item.evidence.length) add(`${group}[${i}].evidence`, 'unsupported_assumption', '假设缺少证据，需要人工确认', 'warning');
    });
  }
  body.unresolved.forEach((u, i) => reqRefs(u.requirementIds, `unresolved[${i}].requirementIds`));
  unique((body.designChecks ?? []).map(c => c.id), 'designChecks.id');
  const upstreamAcIds = new Set(input.baseline.prd.requirements.flatMap(r => r.acceptance.map(a => a.id)));
  (body.designChecks ?? []).forEach((c, i) => {
    const path = `designChecks[${i}]`;
    if (upstreamAcIds.has(c.id)) add(`${path}.id`, 'upstream_ac_collision', '设计补充检查不得使用上游 AC 编号');
    reqRefs(c.requirementIds, `${path}.requirementIds`); modRefs(c.moduleIds, `${path}.moduleIds`);
    unique(c.requirementIds, `${path}.requirementIds`); unique(c.moduleIds, `${path}.moduleIds`);
    const origin = c.source.kind === 'decision' ? body.decisions.find(d => d.id === c.source.id)?.requirementIds
      : c.source.kind === 'quality' ? body.quality.filter(q => q.requirementId === c.source.id).map(q => q.requirementId)
      : body.interfaces.filter(api => api.id === c.source.id).flatMap(api => [api.provider, ...api.consumers]
        .flatMap(id => modules.get(id)?.requirementIds ?? []));
    if (!origin?.length) add(`${path}.source`, 'unknown_check_source', '补充检查必须引用本修订的真实决策、接口或质量要求');
    else if (c.requirementIds.some(id => !origin.includes(id))) add(`${path}.requirementIds`, 'check_source_mismatch', '关联需求与补充检查的来源不一致');
    const sourceModules = c.source.kind === 'interface' ? body.interfaces.filter(api => api.id === c.source.id).flatMap(api => [api.provider, ...api.consumers])
      : c.source.kind === 'quality' ? body.quality.filter(q => q.requirementId === c.source.id).flatMap(q => q.moduleIds) : null;
    if (sourceModules && c.moduleIds.some(id => !sourceModules.includes(id))) add(`${path}.moduleIds`, 'check_source_modules', '检查模块超出来源接口或质量要求的适用模块');
    if (c.moduleIds.some(id => !modules.get(id)?.requirementIds.some(r => c.requirementIds.includes(r))) ||
      c.requirementIds.some(r => !c.moduleIds.some(id => modules.get(id)?.requirementIds.includes(r)))) add(`${path}.moduleIds`, 'check_ownership', '补充检查的模块和关联需求缺少实现归属');
  });
  return issues;
}
