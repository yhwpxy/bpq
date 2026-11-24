import { Router } from 'express';
export const route = fn => (req, res, next) => Promise.resolve().then(() => fn(req, res)).catch(next);

export function workflowRouter({ planningService }) {
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
  return router;
}
