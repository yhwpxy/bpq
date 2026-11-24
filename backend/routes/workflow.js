import { exportPlan } from '../engine/planExport.js';
import { REQUIREMENT_PRESETS } from '../../shared/workflowPresets.js';
import { changeImpact } from '../engine/changeImpact.js';
import { validatePlanSchema } from '../../shared/schema.js';
import { AppError } from '../services/errors.js';
import { compileWorkflow } from '../engine/workflowCompiler.js';
import { validatePlan } from '../engine/validator.js';
import { Router } from 'express';
export const route = fn => (req, res, next) => Promise.resolve().then(() => fn(req, res)).catch(next);

export function workflowRouter({ planningService, planService, providerService, capabilityService, versionService, workspaceService, runService, auditService, evidenceService, governanceService, mcpService, security }) {
  const router = Router();
  router.post('/goals/parse', route(async (req, res) => {
    const controller = new AbortController();
    const abort = () => { if (!res.writableEnded) controller.abort(); };
    req.once('aborted', abort); res.once('close', abort);
    try { res.json({ goalSpec: await planningService.parse(req.body, { signal: controller.signal }) }); }
    finally { req.off('aborted', abort); res.off('close', abort); }
  }));
  router.post('/goals/validate', route((req, res) => res.json({ goalSpec: planningService.validate(req.body) })));
  router.post('/goals/confirm', route(async (req, res) => { const goalSpec = planningService.confirm(req.body?.goalSpec, req.body?.id); await auditService.append({ category: 'contract', action: 'confirm-source', message: `Confirmed ${req.body.id}` }); res.json({ goalSpec }); }));
  router.use('/providers', security.requireAuth);
  router.use('/capabilities', security.requireAuth);
  router.get('/providers', route(async (_req, res) => res.json(await providerService.list())));
  router.post('/providers', route(async (req, res) => res.json(await providerService.save(req.body))));
  router.get('/capabilities', route(async (_req, res) => res.json(await capabilityService.list())));
  router.post('/capabilities', route(async (req, res) => res.json(await capabilityService.save(req.body))));
  router.post('/capabilities/:id/probe', route(async (req, res) => res.json(await capabilityService.probe(req.params.id))));
  router.post('/workflows/compile', security.requireAuth, route(async (req, res) => {
    const capabilities = await capabilityService.list();
    const plan = compileWorkflow(req.body?.goalSpec, req.body?.options, capabilities);
    res.json({ plan, diagnostics: validatePlan(plan, { capabilities, governance: await governanceService.get() }) });
  }));
  router.post('/workflows/validate', security.requireAuth, route(async (req, res) => {
    res.json({ diagnostics: validatePlan(req.body, { capabilities: await capabilityService.list(), governance: await governanceService.get() }) });
  }));
  router.post('/workflows/impact', security.requireAuth, route((req, res) => {
    if (validatePlanSchema(req.body?.before).length || validatePlanSchema(req.body?.after).length) throw new AppError(40001, 'Invalid impact comparison plans');
    res.json(changeImpact(req.body.before, req.body.after));
  }));
  router.get('/plans/:id/versions', security.requireAuth, route(async (req, res) => res.json(await versionService.list(req.params.id))));
  router.get('/plans/:id/versions/:versionId', security.requireAuth, route(async (req, res) => res.json(await versionService.get(req.params.id, req.params.versionId))));
  router.get('/plans/:id/trial', security.requireAuth, route(async (req, res) => res.json(await versionService.report(req.params.id))));
  router.post('/plans/:id/trial', security.requireAuth, route(async (req, res) => res.json(await versionService.trial(req.params.id, req.body))));
  router.post('/plans/:id/versions', security.requireAuth, route(async (req, res) => res.json(await versionService.confirm(req.params.id, req.body?.digest))));
  router.use('/workspaces', security.requireAuth);
  router.get('/workspaces', route(async (_req, res) => res.json(await workspaceService.list())));
  router.post('/workspaces', route(async (req, res) => res.json(await workspaceService.register(req.body))));
  router.post('/workspaces/demo', route(async (_req, res) => res.json(await workspaceService.demo())));
  router.get('/resources', security.requireAuth, (_req, res) => res.json(runService.resources()));
  for (const action of ['pause', 'resume', 'retry', 'resolve', 'ghost', 'restore']) router.post(`/runs/:id/${action}`, security.requireAuth, route(async (req, res) => res.json(await runService.control(req.params.id, action, { ...req.body, authorized: true }))));
  router.get('/runs', security.requireAuth, route(async (_req, res) => res.json(await runService.list())));
  router.get('/runs/:id/sessions/:sessionId', security.requireAuth, route(async (req, res) => res.json(await evidenceService.session(req.params.id, req.params.sessionId))));
  router.get('/runs/:id/evidence', security.requireAuth, route(async (req, res) => {
    const evidence = await evidenceService.exportRun(req.params.id);
    res.set('Content-Disposition', `attachment; filename="evidence-${evidence.manifest.runId}.json"`).json(evidence);
  }));
  router.get('/evidence/search', security.requireAuth, route(async (req, res) => res.json(await evidenceService.search(req.query.q || '', { offset: Number(req.query.offset || 0), limit: Number(req.query.limit || 40) }))));
  router.get('/audit', security.requireAuth, route(async (req, res) => res.json(await auditService.list({ since: Number(req.query.since || 0), planId: req.query.planId, limit: Number(req.query.limit || 1000) }))));
  router.get('/governance', security.requireAuth, route(async (_req, res) => res.json(await governanceService.get())));
  router.post('/governance/terms', security.requireAuth, route(async (req, res) => res.json(await governanceService.saveTerm(req.body))));
  router.delete('/governance/terms/:id', security.requireAuth, route(async (req, res) => { await governanceService.removeTerm(req.params.id); res.json({ ok: true }); }));
  router.post('/governance/policy', security.requireAuth, route(async (req, res) => res.json(await governanceService.savePolicy(req.body))));
  router.get('/mcp', security.requireAuth, route(async (_req, res) => res.json(await mcpService.list())));
  router.post('/mcp', security.requireAuth, route(async (req, res) => res.json(await mcpService.save(req.body))));
  router.post('/mcp/:id/probe', security.requireAuth, route(async (req, res) => res.json(await mcpService.probe(req.params.id))));
  router.post('/doctor', security.requireAuth, route(async (_req, res) => {
    const result = await workspaceService.doctor();
    result.capabilities = [];
    for (const c of await capabilityService.list()) result.capabilities.push({ id: c.id, ...await capabilityService.probe(c.id) });
    res.json(result);
  }));
  router.post('/workflows/demo', security.requireAuth, route(async (req, res) => {
    const workspace = await workspaceService.demo();
    const goal = await planningService.parse({ text: '# 报告交付演示 / Report delivery demo\n## 目标\n在独立工作区中生成两份报告并通过文件校验。\n## 功能需求\n- FR-01: 生成第一份报告\n- FR-02: 生成第二份报告\n## 验收标准\n- AC-01: FR-01 报告文件包含 verified=true\n- AC-02: FR-02 报告文件包含 verified=true' });
    const plan = compileWorkflow(goal, { capabilityId: 'local-tool', human: req.body?.human !== false, permissionTier: req.body?.human === false ? 'supervised' : 'strict', command: process.execPath, args: ['tools/verify.cjs', '--fail-once'] }, await capabilityService.list());
    plan.workflow.workspaceId = workspace.id;
    for (const n of plan.nodes.filter(n => n.props.capabilityId === 'local-tool')) { n.props.command = process.execPath; n.props.args = ['tools/deliver.cjs', n.props.requirementRefs[0].toLowerCase()]; n.props.duration = 0; }
    res.json({ plan, workspace });
  }));
  router.get('/workflow-presets', security.requireAuth, (_req, res) => res.json(REQUIREMENT_PRESETS));
  router.post('/workflows/export', security.requireAuth, route((req, res) => res.json(exportPlan(req.body))));
  router.get('/plans/:id/export', security.requireAuth, route(async (req, res) => res.json(exportPlan(await planService.get(req.params.id)))));
  return router;
}
