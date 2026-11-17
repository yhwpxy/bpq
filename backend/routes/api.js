import { Router } from 'express';
import { decompose } from '../engine/decomposer.js';
import { AppError } from '../services/errors.js';
const asyncRoute = fn => (req, res, next) => Promise.resolve().then(() => fn(req, res)).catch(next);

export function createApiRouter({ planService, runService }) {
  const router = Router();
  router.post('/decompose', asyncRoute((req, res) => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || typeof req.body.text !== 'string' || (req.body.format !== undefined && !['auto', 'markdown', 'numbered'].includes(req.body.format))) throw new AppError(40001, '请求须包含 text 字符串和合法 format');
    res.json({ ok: true, taskSpec: decompose(req.body.text, req.body.format ?? 'auto') });
  }));
  router.post('/plans', asyncRoute(async (req, res) => { res.json(await planService.save(req.body)); }));
  router.get('/plans', asyncRoute(async (_req, res) => { res.json(await planService.list()); }));
  router.get('/plans/:id', asyncRoute(async (req, res) => { res.json(await planService.get(req.params.id)); }));
  router.delete('/plans/:id', asyncRoute(async (req, res) => { res.json(await runService.removePlan(req.params.id)); }));
  router.post('/plans/:id/execute', asyncRoute(async (req, res) => { res.json(await runService.execute(req.params.id)); }));
  router.get('/runs/:runId', asyncRoute(async (req, res) => {
    const raw = req.query.since;
    if (raw !== undefined && (typeof raw !== 'string' || !/^\d+$/.test(raw))) throw new AppError(40001, 'since 必须是非负整数');
    res.json(await runService.get(req.params.runId, raw === undefined ? undefined : Number(raw)));
  }));
  router.post('/runs/:runId/cancel', asyncRoute(async (req, res) => { res.json(await runService.cancel(req.params.runId)); }));
  return router;
}
