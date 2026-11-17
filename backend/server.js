import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPlanService } from './services/planService.js';
import { createRunService } from './services/runService.js';
import { createApiRouter } from './routes/api.js';
import { statusForCode } from './services/errors.js';

const directory = path.dirname(fileURLToPath(import.meta.url));
export function createApp({ storageDir = path.join(directory, 'storage'), runOptions } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: [/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/] }));
  // 200KB applies to the decoded specification text; escaping may enlarge JSON.
  app.use(express.json({ limit: '2mb', strict: true }));
  const planService = createPlanService(storageDir); const runService = createRunService(storageDir, planService, runOptions);
  app.locals.services = { planService, runService };
  app.use('/api', createApiRouter({ planService, runService }));
  app.use(express.static(path.resolve(directory, '../frontend/dist')));
  app.use('/api', (_req, res) => res.status(404).json({ code: 40001, message: '接口不存在' }));
  app.use((error, req, res, _next) => {
    let code = Number(error.code);
    if (error.type === 'entity.parse.failed' || error instanceof SyntaxError) code = 40001;
    if (error.type === 'entity.too.large') code = req.path === '/api/decompose' ? 40003 : 40001;
    if (![40001, 40002, 40003, 40401, 40402, 40901, 50000].includes(code)) code = 50000;
    const message = error.type === 'entity.parse.failed' ? '请求 JSON 格式非法' : error.type === 'entity.too.large' ? '请求内容过大' : code === 50000 && error.code !== 50000 ? '服务器内部错误，请稍后重试' : error.message;
    const body = { code, message };
    if (error.details) body.details = error.details;
    res.status(statusForCode(code)).json(body);
  });
  return app;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createApp(); const server = app.listen(3000, '0.0.0.0', () => console.log('VTO 后端已启动：http://localhost:3000'));
  const stop = async () => { await app.locals.services.runService.close(); server.close(() => process.exit(0)); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
