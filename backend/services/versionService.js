import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { atomicWrite, atomicCreate, readJson, withLock } from './storage.js';
import { assertSafeId, AppError } from './errors.js';
import { validatePlan } from '../engine/validator.js';
import { validatePlanSchema } from '../../shared/schema.js';
import { isWorkflow } from '../../shared/workflowSchema.js';
import { runTrial } from '../engine/trialRunner.js';
import { graphDigest } from '../engine/changeImpact.js';
export function createVersionService(root, plans, capabilities) {
  const directory = id => path.join(root, 'versions', assertSafeId(id));
  const reportPath = id => path.join(root, 'trials', `${assertSafeId(id)}.json`);
  async function get(planId, versionId) {
    const v = await readJson(path.join(directory(planId), `${assertSafeId(versionId)}.json`));
    if (v.planId !== planId || v.id !== versionId || validatePlanSchema(v.plan).length || graphDigest(v.plan) !== v.digest) throw new AppError(50000, 'Version snapshot integrity failure');
    return v;
  }
  async function list(planId) {
    const names = await readdir(directory(planId)).catch(e => { if (e.code === 'ENOENT') return []; throw e; });
    const items = await Promise.all(names.filter(n => n.endsWith('.json')).map(n => get(planId, n.slice(0, -5))));
    return items.sort((a, b) => b.number - a.number);
  }
  async function trial(planId, scenarios = {}) {
    const plan = await plans.get(planId);
    const report = runTrial(plan, { capabilities: await capabilities.list(), failures: scenarios.failures || {} });
    await atomicWrite(reportPath(planId), report); return report;
  }
  async function report(planId) { await plans.get(planId); return readJson(reportPath(planId), { fallback: null }); }
  async function freeze(plan, validation, trialReport) {
    const versions = await list(plan.id), number = (versions[0]?.number || 0) + 1;
    const snapshot = { id: `version_${randomUUID()}`, planId: plan.id, number, tag: `v${number}.0`, digest: graphDigest(plan), plan: structuredClone(plan), validation, trial: trialReport, createdAt: new Date().toISOString() };
    await atomicCreate(path.join(directory(plan.id), `${snapshot.id}.json`), snapshot); return snapshot;
  }
  async function confirm(planId, expectedDigest) {
    return withLock(`${directory(planId)}:publish`, async () => {
      const plan = await plans.get(planId), digest = graphDigest(plan);
      if (expectedDigest && expectedDigest !== digest) throw new AppError(40901, 'Draft changed; review it again');
      const validation = validatePlan(plan, { capabilities: await capabilities.list() });
      if (validation.some(i => !i.severity || i.severity === 'error')) throw new AppError(40002, 'Workflow validation failed', validation);
      const latest = await report(planId);
      if (!latest?.passed || latest.digest !== digest) throw new AppError(40901, 'A passing trial for the current draft is required');
      return freeze(plan, validation, latest);
    });
  }
  async function forExecution(planId, versionId) {
    if (versionId) return get(planId, versionId);
    const plan = await plans.get(planId);
    if (isWorkflow(plan)) {
      const versions = await list(planId); if (!versions.length) throw new AppError(40901, 'Publish a version before running'); return versions[0];
    }
    return withLock(`${directory(planId)}:publish`, async () => {
      const validation = validatePlan(plan); if (validation.length) throw new AppError(40002, '编排方案校验失败', validation);
      const versions = await list(planId), digest = graphDigest(plan);
      if (versions[0]?.digest === digest) return versions[0];
      return freeze(plan, validation, { mode: 'legacy-execution-snapshot', passed: null, note: 'Legacy compatibility snapshot; no trial certification claimed' });
    });
  }
  return { list, get, trial, report, confirm, forExecution };
}
