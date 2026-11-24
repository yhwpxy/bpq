import { Router } from 'express';
export const route = fn => (req, res, next) => Promise.resolve().then(() => fn(req, res)).catch(next);

export function workflowRouter({ planningService, providerService, capabilityService, security }) {
  const router = Router();
  router.post('/goals/parse', route(async (req, res) => {
    const controller = new AbortController();
    const abort = () => { if (!res.writableEnded) controller.abort(); };
    req.once('aborted', abort); res.once('close', abort);
    try { res.json({ goalSpec: await planningService.parse(req.body, { signal: controller.signal }) }); }
    finally { req.off('aborted', abort); res.off('close', abort); }
  }));
  router.post('/goals/validate', route((req, res) => res.json({ goalSpec: planningService.validate(req.body) })));
  router.post('/goals/confirm', route((req, res) => res.json({ goalSpec: planningService.confirm(req.body?.goalSpec, req.body?.id) })));
  router.use('/providers', security.requireAuth);
  router.use('/capabilities', security.requireAuth);
  router.get('/providers', route(async (_req, res) => res.json(await providerService.list())));
  router.post('/providers', route(async (req, res) => res.json(await providerService.save(req.body))));
  router.get('/capabilities', route(async (_req, res) => res.json(await capabilityService.list())));
  router.post('/capabilities', route(async (req, res) => res.json(await capabilityService.save(req.body))));
  router.post('/capabilities/:id/probe', route(async (req, res) => res.json(await capabilityService.probe(req.params.id))));
  return router;
}
