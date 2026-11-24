import { createGoalModelService } from './services/goalModelService.js';
import { createGovernanceService } from './services/governanceService.js';
import { createMcpService } from './services/mcpService.js';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPlanService } from './services/planService.js';
import { createRunService } from './services/runService.js';
import { createApiRouter } from './routes/api.js';
import { createLlmDecomposeService } from './services/llmDecomposeService.js';
import { loadLlmEnvironment, readLlmConfig } from './config/llm.js';
import { statusForCode } from './services/errors.js';
import { createPlanningService } from './services/planningService.js';
import { workflowRouter } from './routes/workflow.js';
import { createProviderService } from './services/providerService.js';
import { createCapabilityService } from './services/capabilityService.js';
import { createAuditService } from './services/auditService.js';
import { createEvidenceService } from './services/evidenceService.js';
import { createWorkspaceService } from './services/workspaceService.js';
import { createVersionService } from './services/versionService.js';
import { createLocalAuth } from './middleware/localAuth.js';

const directory = path.dirname(fileURLToPath(import.meta.url));
export function createApp({ storageDir = process.env.VTO_DATA_DIR ? path.resolve(process.env.VTO_DATA_DIR) : path.join(directory, 'storage'), runOptions, llmConfig = readLlmConfig(), fetchImpl, llmOptions, sessionToken } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: [/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/] }));
  // 200KB applies to the decoded specification text; escaping may enlarge JSON.
  app.use(express.json({ limit: '2mb', strict: true }));
  const auditService = createAuditService(storageDir);
  const planService = createPlanService(storageDir, { audit: auditService });
  const llmDecomposeService = createLlmDecomposeService({ ...llmOptions, config: llmConfig, fetchImpl });
  const planningService = createPlanningService(llmDecomposeService, createGoalModelService({ config: llmConfig, fetchImpl, ...llmOptions }));
  const providerService = createProviderService(storageDir, llmConfig);
  const governanceService = createGovernanceService(storageDir, auditService);
  const mcpService = createMcpService(storageDir, auditService);
  const capabilityService = createCapabilityService(storageDir, providerService, { governance: governanceService });
  const workspaceService = createWorkspaceService(storageDir);
  const versionService = createVersionService(storageDir, planService, capabilityService, auditService, governanceService);
  const runService = createRunService(storageDir, planService, { ...runOptions, versionService, capabilityService, workspaceService, governanceService });
  const evidenceService = createEvidenceService(runService, versionService, auditService, providerService);
  const security = createLocalAuth(sessionToken);
  app.locals.security = security;
  app.locals.services = { planService, runService, llmDecomposeService, planningService, providerService, capabilityService, versionService, workspaceService, auditService, evidenceService, governanceService, mcpService, security };
  app.get('/api/local-session', security.session);
  app.use('/api', workflowRouter(app.locals.services));
  app.use('/api', createApiRouter({ planService, runService, llmDecomposeService, security }));
  app.use(express.static(path.resolve(directory, '../frontend/dist')));
  app.use('/api', (_req, res) => res.status(404).json({ code: 40001, message: '接口不存在' }));
  app.use((error, req, res, _next) => {
    let code = Number(error.code);
    if (error.type === 'entity.parse.failed' || error instanceof SyntaxError) code = 40001;
    if (error.type === 'entity.too.large') code = req.path === '/api/decompose' ? 40003 : 40001;
    if (![40101, 40301, 40001, 40002, 40003, 40401, 40402, 40901, 50000, 50201, 50301, 50401].includes(code)) code = 50000;
    const message = error.type === 'entity.parse.failed' ? '请求 JSON 格式非法' : error.type === 'entity.too.large' ? '请求内容过大' : code === 50000 && error.code !== 50000 ? '服务器内部错误，请稍后重试' : error.message;
    const body = { code, message };
    if (error.details) body.details = error.details;
    res.status(statusForCode(code)).json(body);
  });
  return app;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createApp({ llmConfig: loadLlmEnvironment() }); const port = Number(process.env.PORT || 3000); const server = app.listen(port, '127.0.0.1', () => console.log(`VTO backend: http://127.0.0.1:${server.address().port}/#workbench`));
  const stop = async () => { await app.locals.services.runService.close(); server.close(() => process.exit(0)); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
