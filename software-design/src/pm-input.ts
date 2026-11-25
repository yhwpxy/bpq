import type {GoalSpec} from '../../workflow-orchestrator/src/shared/types.ts';
import {OrchestratorError} from '../../workflow-orchestrator/src/shared/errors.ts';
import {acceptanceText} from '../../requirements-engineering/src/markdown.ts';
import {validateBaseline} from './baseline.ts';
import {designBodySchema, type DesignCheck} from './design-schema.ts';
import {validateDesign} from './design-validation.ts';
import {renderDesign} from './design-render.ts';
import {canonical, revisionHash, type DesignRevision} from './reviews.ts';

/** Exact argument accepted by WorkflowPlannerEngine.importStructuredRequirements. */
export type PmGoalInput = Omit<GoalSpec, 'id' | 'workflowId' | 'updatedAt'>;
export interface DesignPmInput {
  schemaVersion: 1;
  designRef: {designId: string; revision: number; contentSha256: string; workspaceId: string; sourceCommit: string};
  goalSpec: PmGoalInput;
  designChecks: Array<DesignCheck & {origin: 'design'; designId: string; revision: number; contentSha256: string; verified: false}>;
  moduleDependencies: Array<{moduleId: string; dependsOn: string[]}>;
}

/** Pure projection: no parser, model, database writes, IDs or workflow allocation. */
export function projectConfirmedDesign(snapshot: DesignRevision, expectedHash: string): DesignPmInput {
  if (typeof expectedHash !== 'string' || !/^[a-f0-9]{64}$/.test(expectedHash)) throw new OrchestratorError('VALIDATION_ERROR', '请提供确认修订的完整 expectedHash');
  if (snapshot.state !== 'confirmed' || snapshot.contentSha256 !== expectedHash) {
    throw new OrchestratorError('CONFLICT', '请选择已确认且摘要一致的设计修订', 409,
      {current: {designId: snapshot.designId, revision: snapshot.revision, contentSha256: snapshot.contentSha256, state: snapshot.state}});
  }
  if (snapshot.schemaVersion !== 1 || snapshot.input.designId !== snapshot.designId || revisionHash(snapshot.input, snapshot.body) !== expectedHash) {
    throw new OrchestratorError('SPEC_INVALID', '确认快照的来源或正文摘要不一致', 422);
  }
  const {input, body} = snapshot, {baseline} = input;
  validateBaseline(baseline, input.baselineRef.id);
  const {id, projectId, revision, sha256, schemaVersion, mode} = baseline;
  if (JSON.stringify(canonical(input.baselineRef)) !== JSON.stringify(canonical({id, projectId, revision, sha256, schemaVersion, mode}))) {
    throw new OrchestratorError('SPEC_INVALID', '确认快照中的基线引用与原始基线不一致', 422);
  }
  if (mode !== 'live' || !input.workspace.sourceCommit || !/^[a-f0-9]{40,64}$/.test(input.workspace.sourceCommit)) throw new OrchestratorError('SPEC_INVALID', '正式 PM 输入需要 live 基线及已绑定提交的工程', 422);
  if (!snapshot.decisions.some(d => d.action === 'confirm' && d.designId === snapshot.designId && d.revision === snapshot.revision && d.expectedHash === expectedHash)) throw new OrchestratorError('SPEC_INVALID', '缺少绑定同一修订和摘要的确认决定', 422);
  try {designBodySchema.parse(body);} catch (e) {throw new OrchestratorError('SPEC_INVALID', `确认正文结构无效：${(e as Error).message}`, 422);}
  const diagnostics = validateDesign(body, input);
  if (diagnostics.length || snapshot.diagnostics.length || body.unresolved.some(u => u.blocking)) throw new OrchestratorError('SPEC_INVALID', '确认快照仍有未解决的设计诊断', 422, {diagnostics});
  const rendered = renderDesign(body, input);
  if (rendered.reviewMarkdown !== snapshot.reviewMarkdown || rendered.pmMarkdown !== snapshot.pmMarkdown) throw new OrchestratorError('SPEC_INVALID', '确认稿与同一修订的结构化正文不一致', 422);
  const checks = body.designChecks ?? [];
  const modules = new Map(body.modules.map(m => [m.id, m.name]));
  const goalSpec: PmGoalInput = {
    rawMarkdown: snapshot.reviewMarkdown, title: body.title, goal: body.goal,
    requirementsBaseline: {id, projectId, revision, sha256},
    inputs: [...body.inputs], outputs: [...body.outputs], constraints: [...body.constraints], domainRules: [...body.dataRules],
    assumptions: [
      ...baseline.prd.sections.unresolved.map((text, i) => ({id: `hama-unresolved-${i + 1}`, text, source: 'suggested' as const,
        rationale: `HAMA 基线未决事项；来源 ${baseline.id} / v${baseline.revision} / ${baseline.sha256}`})),
      ...body.assumptions.map(a => ({id: `design-assumption-${a.id}`, text: a.text, source: 'doc' as const,
        rationale: `设计假设 ${a.id}；需求 ${a.requirementIds.join(', ')}；证据 ${a.evidence.join(', ')}；核验 ${a.verification}`})),
      ...body.unresolved.map(u => ({id: `design-unresolved-${u.id}`, text: u.question, source: 'suggested' as const,
        rationale: `设计未决项；责任人 ${u.owner}；需求 ${u.requirementIds.join(', ')}`})),
    ],
    requirements: baseline.prd.requirements.map(r => {
      const trace = body.trace.find(t => t.requirementId === r.id)!;
      return {id: r.id, code: r.id, title: r.title, description: r.description,
        priority: r.priority === 'must' ? 'must' : 'should',
        verifyHint: [...r.acceptance.map(a => {
          const v = trace.acceptance.find(v => v.acceptanceId === a.id)!;
          return `[${a.id}] ${acceptanceText(a)} 验证：${v.method}。证据：${v.expectedEvidence}。`;
        }), ...checks.filter(c => c.requirementIds.includes(r.id)).map(c => `设计补充检查 [${c.id}]（非原始 AC，来源 ${c.source.kind}:${c.source.id}）：${c.method}；证据 ${c.expectedEvidence}`)].join('\n')};
    }),
    acceptanceCriteria: baseline.prd.requirements.flatMap(r => r.acceptance.map(a => ({
      id: a.id, code: a.id, requirementId: r.id, label: acceptanceText(a), verified: false,
    }))),
    modules: body.modules.map(m => ({
      name: m.name, layer: m.layer, artifacts: m.files.map(f => f.path), relatedFrCodes: [...m.requirementIds],
      summary: [
        `模块 ${m.id}：${m.responsibility}`,
        `输入：${m.inputs.join('；')}\n输出：${m.outputs.join('；')}`,
        `依赖：${m.dependsOn.map(id => `${id} (${modules.get(id)})`).join('；') || '无'}`,
        ...body.interfaces.filter(c => c.provider === m.id || c.consumers.includes(m.id)).map(c =>
          `接口 ${c.id} [${c.kind}]；提供方 ${c.provider}；消费方 ${c.consumers.join(', ')}；输入 ${c.input}；结果 ${c.result}；失败 ${c.failure}；副作用 ${c.sideEffects}`),
        `文件动作：${m.files.map(f => `${f.action} ${f.path}`).join('；')}`,
        ...body.quality.filter(q => q.moduleIds.includes(m.id)).map(q => `质量要求 ${q.requirementId}：${q.method}；通过条件 ${q.passCondition}`),
        ...checks.filter(c => c.moduleIds.includes(m.id)).map(c => `设计补充检查 ${c.id}（非原始 AC，来源 ${c.source.kind}:${c.source.id}，关联需求 ${c.requirementIds.join(', ')}）：${c.method}；证据 ${c.expectedEvidence}`),
      ].join('\n'),
    })),
  };
  return {
    schemaVersion: 1,
    designRef: {designId: snapshot.designId, revision: snapshot.revision, contentSha256: expectedHash,
      workspaceId: input.workspace.workspaceId, sourceCommit: input.workspace.sourceCommit},
    goalSpec, moduleDependencies: body.modules.map(m => ({moduleId: m.id, dependsOn: [...m.dependsOn]})),
    designChecks: checks.map(c => ({...structuredClone(c), origin: 'design', designId: snapshot.designId,
      revision: snapshot.revision, contentSha256: expectedHash, verified: false})),
  };
}
