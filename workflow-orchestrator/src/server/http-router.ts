/**
 * Loopback HTTP REST + Multiplexed SSE Server (`127.0.0.1`).
 */

import {execFileSync} from 'node:child_process';
import {randomUUID, timingSafeEqual} from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import {existsSync, readFileSync} from 'node:fs';
import {extname, join, resolve} from 'node:path';
import type {HamaService} from '../../../requirements-engineering/src/service.ts';
import type {DesignService} from '../../../software-design/src/service.ts';
import type {DesignGenerator} from '../../../software-design/src/generator.ts';
import type {DesignReviewService} from '../../../software-design/src/reviews.ts';
import {projectConfirmedDesign} from '../../../software-design/src/pm-input.ts';
import type {DesignHandoffService} from '../../../software-design/src/handoff.ts';
import type {CreateDesignInput} from '../../../software-design/src/contracts.ts';
import type {ICapabilityHub} from '../adapters/contracts.ts';
import {exportWorkflowPlan} from '../core/pm-planner.ts';
import {BUILTIN_DESIGN_SPEC_PRESETS} from '../core/presets.ts';
import {CognitiveConsolidator} from '../engines/dreaming.ts';
import type {WorkflowOrchestratorEngine} from '../engines/orchestrator.ts';
import type {WorkflowPlannerEngine} from '../engines/planner.ts';
import type {
  IGitWorktreeManager,
  ISandboxProcessRunner,
} from '../sandbox/contracts.ts';
import type {
  BootstrapSnapshot,
  ExportWorkflowPlanResponse,
  OrchestratorSseEvent,
  RunDetailSnapshot,
  UpdateDraftGraphRequest,
  UpdateGoalSpecRequest,
} from '../shared/api.ts';
import {OrchestratorError} from '../shared/errors.ts';
import type {
  SkillEntry,
  WorkflowCustomization,
  WorkflowTemplatePreset,
} from '../shared/types.ts';
import {
  asRecord,
  optBoolean,
  optNumber,
  optString,
  PERMISSION_TIERS,
  reqEnum,
  reqString,
  validateCapabilityManifest,
} from '../shared/validation.ts';
import type {OrchestratorStore} from '../store/database.ts';
import type {HostSecretVault} from './secret-vault.ts';

const MIME_BY_EXT: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
};

function constantTimeMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

let cachedWinProxy: {checkedAt: number; configured: boolean} | null = null;

function isProxyConfigured(): boolean {
  if (
    process.env['HTTPS_PROXY'] ||
    process.env['https_proxy'] ||
    process.env['HTTP_PROXY'] ||
    process.env['http_proxy']
  ) {
    return true;
  }
  if (
    process.platform !== 'win32' ||
    process.env['ORCH_OFFLINE_VERIFY'] === '1'
  ) {
    return false;
  }
  const now = Date.now();
  if (cachedWinProxy && now - cachedWinProxy.checkedAt < 30_000) {
    return cachedWinProxy.configured;
  }
  let configured = false;
  try {
    const out = execFileSync(
      'reg.exe',
      [
        'query',
        'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
      ],
      {encoding: 'utf8', timeout: 800, windowsHide: true},
    );
    configured =
      /ProxyEnable\s+REG_DWORD\s+0x1/i.test(out) &&
      /ProxyServer\s+REG_SZ\s+\S+/i.test(out);
  } catch {
    configured = false;
  }
  cachedWinProxy = {checkedAt: now, configured};
  return configured;
}

export class OrchestratorHttpServer {
  private readonly store: OrchestratorStore;
  private readonly vault: HostSecretVault;
  private readonly runner: ISandboxProcessRunner;
  private readonly worktrees: IGitWorktreeManager;
  private readonly hub: ICapabilityHub;
  private readonly planner: WorkflowPlannerEngine;
  private readonly orchestrator: WorkflowOrchestratorEngine;
  private readonly requirements?: HamaService;
  private readonly designs?: DesignService;
  private readonly designGenerator?: DesignGenerator;
  private readonly designReviews?: DesignReviewService;
  private readonly designHandoffs?: DesignHandoffService;
  private readonly consolidator = new CognitiveConsolidator();
  private readonly token: string;
  private readonly startedAt = new Date().toISOString();
  private readonly staticDir: string | null;

  private server: Server | null = null;
  private port = 0;
  private sseSeq = 0;
  private readonly sseClients = new Set<ServerResponse>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private gitReadyCache: boolean | null = null;

  constructor(input: {
    readonly store: OrchestratorStore;
    readonly vault: HostSecretVault;
    readonly runner: ISandboxProcessRunner;
    readonly worktrees: IGitWorktreeManager;
    readonly hub: ICapabilityHub;
    readonly planner: WorkflowPlannerEngine;
    readonly orchestrator: WorkflowOrchestratorEngine;
    readonly requirements?: HamaService;
    readonly designs?: DesignService;
    readonly designGenerator?: DesignGenerator;
    readonly designReviews?: DesignReviewService;
    readonly designHandoffs?: DesignHandoffService;
    readonly token?: string;
    readonly staticDir?: string | null;
  }) {
    this.store = input.store;
    this.vault = input.vault;
    this.runner = input.runner;
    this.worktrees = input.worktrees;
    this.hub = input.hub;
    this.planner = input.planner;
    this.orchestrator = input.orchestrator;
    this.requirements = input.requirements;
    this.designs = input.designs;
    this.designGenerator = input.designGenerator;
    this.designReviews = input.designReviews;
    this.designHandoffs = input.designHandoffs;
    this.token = input.token ?? randomUUID().replace(/-/g, '');
    this.staticDir = input.staticDir ?? null;
  }

  getSessionToken(): string {
    return this.token;
  }

  getBaseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  broadcast(
    type: OrchestratorSseEvent['type'],
    ids: {
      readonly workflowId?: string | null;
      readonly runId?: string | null;
      readonly nodeId?: string | null;
    },
    payload: Record<string, unknown>,
  ): void {
    this.sseSeq += 1;
    const evt: OrchestratorSseEvent = {
      seq: this.sseSeq,
      type,
      workflowId: ids.workflowId ?? null,
      runId: ids.runId ?? null,
      nodeId: ids.nodeId ?? null,
      payload,
      timestamp: new Date().toISOString(),
    };
    const chunk = `event: ${type}\ndata: ${JSON.stringify(evt)}\n\n`;
    for (const res of this.sseClients) {
      try {
        res.write(chunk);
      } catch {
        this.sseClients.delete(res);
      }
    }
  }

  async start(preferredPort = 0): Promise<number> {
    this.server = createServer((req, res) => {
      void this.handleRequest(req, res);
    });

    await new Promise<void>((resolveListen, rejectListen) => {
      this.server!.once('error', rejectListen);
      this.server!.listen(preferredPort, '127.0.0.1', () => {
        const addr = this.server!.address();
        this.port =
          typeof addr === 'object' && addr ? addr.port : preferredPort;
        resolveListen();
      });
    });

    this.heartbeatTimer = setInterval(() => {
      this.broadcast('heartbeat', {}, {uptime: process.uptime()});
    }, 15_000);
    this.heartbeatTimer.unref();

    return this.port;
  }

  async stop(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    for (const client of this.sseClients) {
      try {
        client.end();
      } catch {
        // ignore
      }
    }
    this.sseClients.clear();
    if (this.server) {
      await new Promise<void>(res => this.server!.close(() => res()));
      this.server = null;
    }
  }

  private isGitReady(): boolean {
    if (this.gitReadyCache === null) {
      this.gitReadyCache = Boolean(this.runner.resolveExecutable('git'));
    }
    return this.gitReadyCache;
  }

  private withRunLiveLogs(detail: RunDetailSnapshot): RunDetailSnapshot {
    return {
      ...detail,
      liveLogs: this.store.listRunLiveLogs(detail.run.id),
    };
  }

  getBootstrapSnapshot(): BootstrapSnapshot {
    const nativeCap = this.store
      .listCapabilities()
      .find(c => c.id === 'native-api');
    return {
      daemonVersion: '0.2.0',
      startedAt: this.startedAt,
      slots: this.hub.getSlotSnapshot(),
      workspaces: this.store.listWorkspaces(),
      workflows: this.store.listWorkflows(),
      versions: this.store.listVersions(),
      runs: this.store.listRuns(),
      openInterventions: this.store.listInterventions(),
      capabilities: this.store.listCapabilities(),
      capabilityHealth: this.store.listCapabilityHealth(),
      modelProviders: this.store.listModelProviders(id =>
        this.vault.getKeyStatus(id),
      ),
      recentAudit: this.store.listRecentAudit(50),
      domainTerms: this.store.listDomainTerms(),
      skills: this.store.listSkills(),
      mcpServers: this.store.listMcpServers(),
      constitution: this.store.getConstitutionRule(),
      rehydrationCapsules: this.consolidator.computeAllCapsules(this.store),
      designSpecPresets: BUILTIN_DESIGN_SPEC_PRESETS,
      infraStatus: {
        opencodeGoConfigured: this.vault.getKeyStatus('opencode-go').hasApiKey,
        defaultModel: nativeCap?.defaultModel || 'deepseek-flash',
        proxyConfigured: isProxyConfigured(),
        gitReady: this.isGitReady(),
      },
    };
  }

  private async readJsonBody(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of req) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (total > 2_097_152) {
        throw new OrchestratorError(
          'VALIDATION_ERROR',
          'Request body exceeds 2 MB limit',
          413,
        );
      }
      chunks.push(buf);
    }
    if (chunks.length === 0) {
      return {};
    }
    const raw = Buffer.concat(chunks).toString('utf8').trim();
    if (!raw) {
      return {};
    }
    try {
      return JSON.parse(raw);
    } catch {
      throw new OrchestratorError('VALIDATION_ERROR', 'Invalid JSON body', 400);
    }
  }

  private writeJson(res: ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    });
    res.end(JSON.stringify(data));
  }

  private authorize(req: IncomingMessage, url: URL): boolean {
    const authHeader = req.headers['authorization'] ?? '';
    const bearer = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : '';
    const queryToken = url.searchParams.get('token') ?? '';
    const presented = bearer || queryToken;
    return presented.length > 0 && constantTimeMatch(presented, this.token);
  }

  private serveHtmlWithBootstrap(filePath: string, res: ServerResponse): void {
    let html = readFileSync(filePath, 'utf8');
    const bootScript = `<script>window.__ORCH_BOOT__=${JSON.stringify({
      apiBaseUrl: this.getBaseUrl(),
      token: this.token,
    })};</script>`;
    if (html.includes('</head>')) {
      html = html.replace('</head>', `${bootScript}</head>`);
    } else {
      html = `${bootScript}${html}`;
    }
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(html);
  }

  private serveStaticAsset(pathname: string, res: ServerResponse): boolean {
    if (!this.staticDir || !existsSync(this.staticDir)) {
      return false;
    }
    const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const abs = resolve(this.staticDir, rel);
    if (!abs.startsWith(resolve(this.staticDir)) || !existsSync(abs)) {
      const indexFile = join(this.staticDir, 'index.html');
      if (existsSync(indexFile)) {
        this.serveHtmlWithBootstrap(indexFile, res);
        return true;
      }
      return false;
    }
    const ext = extname(abs).toLowerCase();
    if (ext === '.html') {
      this.serveHtmlWithBootstrap(abs, res);
      return true;
    }
    res.writeHead(200, {
      'Content-Type': MIME_BY_EXT[ext] ?? 'application/octet-stream',
    });
    res.end(readFileSync(abs));
    return true;
  }

  private async handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      });
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', `http://127.0.0.1:${this.port}`);
    const path = url.pathname;

    if (!path.startsWith('/api/')) {
      if (this.serveStaticAsset(path, res)) {
        return;
      }
      this.writeJson(res, 404, {error: 'Not found'});
      return;
    }

    if (path === '/api/health') {
      this.writeJson(res, 200, {ok: true, version: '0.2.0'});
      return;
    }

    if (!this.authorize(req, url)) {
      this.writeJson(res, 401, {
        code: 'UNAUTHORIZED',
        error: 'Missing or invalid Bearer token',
      });
      return;
    }

    if (req.method === 'GET' && path === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });
      res.write(
        `event: connected\ndata: ${JSON.stringify({connected: true})}\n\n`,
      );
      this.sseClients.add(res);
      req.on('close', () => {
        this.sseClients.delete(res);
      });
      return;
    }

    try {
      const method = req.method ?? 'GET';
      const requirements = this.requirements;
      if (this.designHandoffs) {
        const handoff = /^\/api\/designs\/([\w-]+)\/revisions\/([1-9]\d*)\/handoff$/.exec(path);
        const origin = /^\/api\/workflows\/([\w-]+)\/design-handoff$/.exec(path);
        if (method === 'POST' && handoff) {
          const result = this.designHandoffs.handoff(handoff[1]!, Number(handoff[2]), await this.readJsonBody(req));
          this.writeJson(res, result.created ? 201 : 200, result.receipt); return;
        }
        if (method === 'GET' && handoff) {
          this.writeJson(res, 200, this.designHandoffs.lookup(handoff[1]!, Number(handoff[2]), {
            workspaceId: url.searchParams.get('workspaceId'), expectedHash: url.searchParams.get('expectedHash'),
          })); return;
        }
        if (method === 'GET' && origin) {
          this.writeJson(res, 200, this.designHandoffs.forWorkflow(origin[1]!)); return;
        }
      }
      if (this.designReviews) {
        const pmInput = /^\/api\/designs\/([\w-]+)\/revisions\/([1-9]\d*)\/pm-input$/.exec(path);
        if (method === 'GET' && pmInput) {
          this.writeJson(res, 200, projectConfirmedDesign(this.designReviews.read(pmInput[1]!, Number(pmInput[2])), url.searchParams.get('expectedHash') ?? ''));
          return;
        }
        const revisions = /^\/api\/designs\/([\w-]+)\/revisions$/.exec(path);
        const revision = /^\/api\/designs\/([\w-]+)\/revisions\/([1-9]\d*)$/.exec(path);
        const review = /^\/api\/designs\/([\w-]+)\/revisions\/([1-9]\d*)\/review$/.exec(path);
        if (method === 'GET' && path === '/api/designs') {
          this.writeJson(res, 200, this.designReviews.heads(url.searchParams.get('baselineId') ?? undefined)); return;
        }
        if (method === 'GET' && revisions) {
          this.writeJson(res, 200, this.designReviews.list(revisions[1]!)); return;
        }
        if (method === 'GET' && revision) {
          this.writeJson(res, 200, this.designReviews.read(revision[1]!, Number(revision[2]))); return;
        }
        if (method === 'POST' && review) {
          this.writeJson(res, 200, this.designReviews.review(review[1]!, Number(review[2]), await this.readJsonBody(req))); return;
        }
        if (method === 'POST' && revisions) {
          const body = asRecord(await this.readJsonBody(req));
          if (body['parentRevision'] !== undefined) {
            let generationId: string | undefined;
            if (body['body'] === undefined && this.designGenerator) {
              reqString(body, 'actor', 120);
              reqString(body, 'reason', 6000);
              const context = this.designReviews.generationContext(revisions[1]!, Number(body['parentRevision']), String(body['expectedHash']), body['sourceCommit']);
              const generated = await this.designGenerator.generate(revisions[1]!, {expectedHash: context.input.contentSha256,
                providerId: body['providerId'], model: body['model'], feedback: body['feedback'] ?? body['reason']}, context);
              body['body'] = generated.body;
              generationId = generated.generationId;
            }
            this.writeJson(res, 201, this.designReviews.revise(revisions[1]!, body, generationId));
          }
          else {
            const generation = this.designGenerator?.list(revisions[1]!).find(g => g.generationId === body['generationId']);
            if (!generation) throw new OrchestratorError('NOT_FOUND', '生成记录不存在', 404);
            this.writeJson(res, 201, this.designReviews.createFromGeneration(generation, body));
          }
          return;
        }
      }
      const generate = /^\/api\/designs\/([\w-]+)\/generate$/.exec(path);
      const generations = /^\/api\/designs\/([\w-]+)\/generations$/.exec(path);
      if (this.designGenerator && generate && method === 'POST') {
        this.writeJson(res, 201, await this.designGenerator.generate(generate[1]!, await this.readJsonBody(req)));
        return;
      }
      if (this.designGenerator && generations && method === 'GET') {
        this.writeJson(res, 200, this.designGenerator.list(generations[1]!));
        return;
      }
      if (this.designs) {
        const workspace = /^\/api\/design-workspaces\/([\w-]+)$/.exec(path);
        const design = /^\/api\/designs\/([\w-]+)$/.exec(path);
        if (method === 'GET' && workspace) {
          this.writeJson(res, 200, this.designs.inspectWorkspace(workspace[1]!));
          return;
        }
        if (method === 'POST' && path === '/api/designs') {
          this.writeJson(res, 201, this.designs.create(await this.readJsonBody(req) as CreateDesignInput));
          return;
        }
        if (method === 'GET' && design) {
          this.writeJson(res, 200, this.designs.read(design[1]!));
          return;
        }
      }
      if (requirements && path.startsWith('/api/hama/')) {
        const run = /^\/api\/hama\/runs\/([\w-]+)$/.exec(path);
        const decision = /^\/api\/hama\/runs\/([\w-]+)\/gates\/([\w-]+)$/.exec(path);
        const baseline = /^\/api\/hama\/baselines\/([\w-]+)$/.exec(path);
        if (method === 'GET' && path === '/api/hama/runs') {
          this.writeJson(res, 200, requirements.list());
        } else if (method === 'POST' && path === '/api/hama/runs') {
          this.writeJson(res, 201, await requirements.start(await this.readJsonBody(req)));
        } else if (method === 'GET' && run) {
          this.writeJson(res, 200, requirements.view(run[1]!));
        } else if (method === 'POST' && decision) {
          this.writeJson(res, 200, requirements.decide(decision[1]!, decision[2]!, await this.readJsonBody(req)));
        } else if (method === 'GET' && baseline) {
          this.writeJson(res, 200, requirements.baseline(baseline[1]!));
        } else if (method === 'GET' && path === '/api/hama/baselines') {
          this.writeJson(res, 200, requirements.baselines(url.searchParams.get('projectId') ?? ''));
        } else {
          this.writeJson(res, 404, {error: 'Not found'});
        }
        return;
      }

      const workflowMutation = /^\/api\/workflows\/([^/]+)\//.exec(path);
      if (method === 'POST' && workflowMutation && this.orchestrator.hasHandler(workflowMutation[1]!)) {
        throw new OrchestratorError('POLICY_DENIED', 'Use the registered workflow controls.', 403);
      }

      if (method === 'GET' && path === '/api/bootstrap') {
        this.writeJson(res, 200, this.getBootstrapSnapshot());
        return;
      }

      if (method === 'POST' && path === '/api/workspaces') {
        const rec = asRecord(await this.readJsonBody(req));
        const ws = this.store.createWorkspace({
          name: reqString(rec, 'name', 120),
          rootPath: reqString(rec, 'rootPath', 1024),
          defaultBranch: optString(rec, 'defaultBranch', 'main', 80),
          verifyCommand: optString(
            rec,
            'verifyCommand',
            'echo Verification gate passed',
            512,
          ),
          description: optString(rec, 'description', '', 2048),
        });
        this.writeJson(res, 201, {workspace: ws});
        return;
      }

      if (method === 'POST' && path === '/api/workflows/import-requirements') {
        const rec = asRecord(await this.readJsonBody(req));
        if (requirements && rec['baselineId'] !== undefined) {
          this.writeJson(res, 201, requirements.handoff(
            reqString(rec, 'baselineId', 80), reqString(rec, 'workspaceId', 80)));
          return;
        }
        let customization: Partial<WorkflowCustomization> | undefined;
        if (rec['customization'] && typeof rec['customization'] === 'object') {
          const c = asRecord(rec['customization']);
          customization = {
            templatePreset: c['templatePreset'] as
              WorkflowTemplatePreset | undefined,
            includeHumanGate:
              typeof c['includeHumanGate'] === 'boolean'
                ? c['includeHumanGate']
                : undefined,
            includeSecurityPass:
              typeof c['includeSecurityPass'] === 'boolean'
                ? c['includeSecurityPass']
                : undefined,
            includeQaAudit:
              typeof c['includeQaAudit'] === 'boolean'
                ? c['includeQaAudit']
                : undefined,
            maxParallelWorkers:
              typeof c['maxParallelWorkers'] === 'number'
                ? c['maxParallelWorkers']
                : undefined,
            dddStrictCheck:
              typeof c['dddStrictCheck'] === 'boolean'
                ? c['dddStrictCheck']
                : undefined,
            pmAgentMode:
              c['pmAgentMode'] === 'structural' ||
              c['pmAgentMode'] === 'hybrid_llm'
                ? c['pmAgentMode']
                : undefined,
            budgetUsdLimit:
              typeof c['budgetUsdLimit'] === 'number'
                ? c['budgetUsdLimit']
                : undefined,
          };
        }
        const detail = await this.planner.importRequirementsSmart({
          workspaceId: reqString(rec, 'workspaceId', 80),
          title: optString(rec, 'title', '', 240) || undefined,
          markdown: reqString(rec, 'markdown', 200_000),
          verifyCommand: optString(rec, 'verifyCommand', '', 512) || undefined,
          permissionTier: rec['permissionTier']
            ? reqEnum(rec, 'permissionTier', PERMISSION_TIERS)
            : 'supervised',
          maxReworkIterations: optNumber(rec, 'maxReworkIterations', 3, 1, 20),
          preferAiPlanner: optBoolean(rec, 'preferAiPlanner', false),
          customization,
        });
        this.writeJson(res, 201, detail);
        return;
      }

      const wfExportMatch = /^\/api\/workflows\/([^/]+)\/export$/.exec(path);
      if (method === 'GET' && wfExportMatch) {
        const detail = this.planner.getWorkflowDetail(wfExportMatch[1]!);
        const exported = exportWorkflowPlan({
          workflowTitle: detail.workflow.title,
          goalSpec: detail.goalSpec,
          nodes: detail.nodes,
          edges: detail.edges,
          customization: detail.workflow.customization,
          pmReport: detail.pmReport,
        });
        const payload: ExportWorkflowPlanResponse = {
          workflowId: detail.workflow.id,
          code: detail.workflow.code,
          title: detail.workflow.title,
          markdown: exported.markdown,
          mermaid: exported.mermaid,
          json: JSON.parse(exported.json) as Record<string, unknown>,
        };
        this.writeJson(res, 200, payload);
        return;
      }

      const wfReviewMatch = /^\/api\/workflows\/([^/]+)\/review-anchor$/.exec(
        path,
      );
      if (method === 'POST' && wfReviewMatch) {
        const wf = this.store.markWorkflowReviewed(wfReviewMatch[1]!);
        this.store.appendAudit({
          workflowId: wf.id,
          runId: null,
          category: 'dreaming',
          author: 'Human Reviewer',
          title: `Cognitive Re-Anchor #${wf.spacedReviewCount ?? 1}`,
          detail: `Human review anchor refreshed on ${wf.code} (${wf.title}); retention reset to 100%.`,
        });
        const capsule = this.consolidator.computeWorkflowCapsule(
          this.store,
          wf.id,
        );
        this.broadcast(
          'workflow.updated',
          {workflowId: wf.id},
          {action: 'reviewed'},
        );
        this.writeJson(res, 200, {workflow: wf, capsule});
        return;
      }

      const wfDetailMatch = /^\/api\/workflows\/([^/]+)$/.exec(path);
      if (method === 'GET' && wfDetailMatch) {
        this.writeJson(
          res,
          200,
          this.planner.getWorkflowDetail(wfDetailMatch[1]!),
        );
        return;
      }

      const wfSpecMatch = /^\/api\/workflows\/([^/]+)\/spec$/.exec(path);
      if (method === 'POST' && wfSpecMatch) {
        const body = (await this.readJsonBody(req)) as UpdateGoalSpecRequest;
        this.writeJson(
          res,
          200,
          this.planner.updateGoalSpec(wfSpecMatch[1]!, body),
        );
        return;
      }

      const wfGraphMatch = /^\/api\/workflows\/([^/]+)\/draft-graph$/.exec(
        path,
      );
      if (method === 'POST' && wfGraphMatch) {
        const body = (await this.readJsonBody(req)) as UpdateDraftGraphRequest;
        this.writeJson(
          res,
          200,
          this.planner.updateDraftGraph(wfGraphMatch[1]!, body),
        );
        return;
      }

      const wfReplanMatch = /^\/api\/workflows\/([^/]+)\/replan$/.exec(path);
      if (method === 'POST' && wfReplanMatch) {
        this.writeJson(
          res,
          200,
          this.planner.replanFromGoalSpec(wfReplanMatch[1]!),
        );
        return;
      }

      const wfTrialMatch = /^\/api\/workflows\/([^/]+)\/trial$/.exec(path);
      if (method === 'POST' && wfTrialMatch) {
        this.writeJson(res, 200, this.planner.runTrial(wfTrialMatch[1]!));
        return;
      }

      const wfConfirmMatch =
        /^\/api\/workflows\/([^/]+)\/confirm-version$/.exec(path);
      if (method === 'POST' && wfConfirmMatch) {
        const rec = asRecord(await this.readJsonBody(req));
        const version = this.planner.confirmVersion(wfConfirmMatch[1]!, {
          label: optString(rec, 'label', '', 160) || undefined,
          frozenBy: optString(rec, 'frozenBy', 'User', 80),
        });
        this.writeJson(res, 201, {
          version,
          workflow: this.planner.getWorkflowDetail(wfConfirmMatch[1]!),
        });
        return;
      }

      if (method === 'POST' && path === '/api/runs') {
        const rec = asRecord(await this.readJsonBody(req));
        const detail = await this.orchestrator.startRun({
          workflowId: reqString(rec, 'workflowId', 80),
          versionId: optString(rec, 'versionId', '', 80) || undefined,
          title: optString(rec, 'title', '', 200) || undefined,
          permissionTier: rec['permissionTier']
            ? reqEnum(rec, 'permissionTier', PERMISSION_TIERS)
            : undefined,
        });
        this.writeJson(res, 201, this.withRunLiveLogs(detail));
        return;
      }

      const runDetailMatch = /^\/api\/runs\/([^/]+)$/.exec(path);
      if (method === 'GET' && runDetailMatch) {
        const detail = this.orchestrator.getRunDetail(runDetailMatch[1]!);
        this.writeJson(res, 200, this.withRunLiveLogs(detail));
        return;
      }

      const runPauseMatch = /^\/api\/runs\/([^/]+)\/pause$/.exec(path);
      if (method === 'POST' && runPauseMatch) {
        this.writeJson(
          res,
          200,
          this.withRunLiveLogs(this.orchestrator.pauseRun(runPauseMatch[1]!)),
        );
        return;
      }

      const runResumeMatch = /^\/api\/runs\/([^/]+)\/resume$/.exec(path);
      if (method === 'POST' && runResumeMatch) {
        this.writeJson(
          res,
          200,
          this.withRunLiveLogs(this.orchestrator.resumeRun(runResumeMatch[1]!)),
        );
        return;
      }

      const runCancelMatch = /^\/api\/runs\/([^/]+)\/cancel$/.exec(path);
      if (method === 'POST' && runCancelMatch) {
        this.writeJson(
          res,
          200,
          this.withRunLiveLogs(this.orchestrator.cancelRun(runCancelMatch[1]!)),
        );
        return;
      }

      const runRetryMatch = /^\/api\/runs\/([^/]+)\/retry-node$/.exec(path);
      if (method === 'POST' && runRetryMatch) {
        const rec = asRecord(await this.readJsonBody(req));
        this.writeJson(
          res,
          200,
          this.withRunLiveLogs(
            this.orchestrator.retryNode(
              runRetryMatch[1]!,
              reqString(rec, 'nodeId', 80),
            ),
          ),
        );
        return;
      }

      const runGhostMatch = /^\/api\/runs\/([^/]+)\/ghost-node$/.exec(path);
      if (method === 'POST' && runGhostMatch) {
        const rec = asRecord(await this.readJsonBody(req));
        this.writeJson(
          res,
          200,
          this.withRunLiveLogs(
            this.orchestrator.proposeGhostNode(runGhostMatch[1]!, {
              title: reqString(rec, 'title', 160),
              description: optString(rec, 'description', '', 2048),
              executorKind: rec['executorKind']
                ? reqEnum(rec, 'executorKind', [
                    'agent',
                    'tool',
                    'human',
                    'control',
                  ] as const)
                : 'agent',
              capabilityId: optString(rec, 'capabilityId', 'native-api', 80),
              gateCommand: optString(rec, 'gateCommand', '', 512) || null,
              insertBeforeNodeId:
                optString(rec, 'insertBeforeNodeId', '', 80) || null,
            }),
          ),
        );
        return;
      }

      const runRestoreMatch = /^\/api\/runs\/([^/]+)\/restore$/.exec(path);
      if (method === 'POST' && runRestoreMatch) {
        const rec = asRecord(await this.readJsonBody(req));
        this.writeJson(
          res,
          200,
          this.withRunLiveLogs(
            await this.orchestrator.manualRestoreCheckpoint(
              runRestoreMatch[1]!,
              reqString(rec, 'checkpointId', 80),
            ),
          ),
        );
        return;
      }

      const nodeCollapseMatch = /^\/api\/nodes\/([^/]+)\/collapse$/.exec(path);
      if (method === 'POST' && nodeCollapseMatch) {
        const rec = asRecord(await this.readJsonBody(req));
        const node = this.store.updateNodeState(nodeCollapseMatch[1]!, {
          collapsed: optBoolean(rec, 'collapsed', false),
        });
        this.writeJson(res, 200, {node});
        return;
      }

      const intResolveMatch = /^\/api\/interventions\/([^/]+)\/resolve$/.exec(
        path,
      );
      if (method === 'POST' && intResolveMatch) {
        const rec = asRecord(await this.readJsonBody(req));
        const runDetail = this.orchestrator.resolveIntervention(
          intResolveMatch[1]!,
          {
            resolution: reqString(rec, 'resolution', 4096),
            action: rec['action']
              ? reqEnum(rec, 'action', [
                  'approve',
                  'reject',
                  'override',
                ] as const)
              : 'approve',
          },
        );
        this.writeJson(res, 200, this.withRunLiveLogs(runDetail));
        return;
      }

      if (method === 'POST' && path === '/api/capabilities') {
        const rec = asRecord(await this.readJsonBody(req));
        const manifest = validateCapabilityManifest(rec['manifest'] ?? rec);
        this.store.upsertCapability(manifest);
        this.writeJson(res, 201, {
          capabilities: this.store.listCapabilities(),
          capabilityHealth: this.store.listCapabilityHealth(),
        });
        return;
      }

      const capProbeMatch = /^\/api\/capabilities\/([^/]+)\/probe$/.exec(path);
      if (method === 'POST' && capProbeMatch) {
        const cap = this.store
          .listCapabilities()
          .find(c => c.id === capProbeMatch[1]!);
        if (!cap) {
          throw new OrchestratorError('NOT_FOUND', 'Capability not found', 404);
        }
        const probe = await this.hub.probeCapability(cap);
        this.writeJson(res, 200, {
          probe,
          capabilities: this.store.listCapabilities(),
          capabilityHealth: this.store.listCapabilityHealth(),
        });
        return;
      }

      const capToggleMatch = /^\/api\/capabilities\/([^/]+)\/toggle$/.exec(
        path,
      );
      if (method === 'POST' && capToggleMatch) {
        const rec = asRecord(await this.readJsonBody(req));
        const cap = this.store
          .listCapabilities()
          .find(c => c.id === capToggleMatch[1]!);
        if (!cap) {
          throw new OrchestratorError('NOT_FOUND', 'Capability not found', 404);
        }
        const enabled = optBoolean(rec, 'enabled', !cap.enabled);
        this.store.setCapabilityProbe(
          cap.id,
          cap.probeOk ?? true,
          enabled ? 'Enabled by user' : 'Disabled (circuit test / maintenance)',
          enabled,
        );
        this.writeJson(res, 200, {
          capabilities: this.store.listCapabilities(),
          capabilityHealth: this.store.listCapabilityHealth(),
        });
        return;
      }

      const provSecretMatch = /^\/api\/providers\/([^/]+)\/secret$/.exec(path);
      if (method === 'POST' && provSecretMatch) {
        const rec = asRecord(await this.readJsonBody(req));
        const providerId = provSecretMatch[1]!;
        this.vault.setApiKey(providerId, optString(rec, 'apiKey', '', 512));
        if (rec['baseUrl']) {
          this.store.updateProviderBaseUrl(
            providerId,
            reqString(rec, 'baseUrl', 512),
          );
        }
        this.writeJson(res, 200, {
          modelProviders: this.store.listModelProviders(id =>
            this.vault.getKeyStatus(id),
          ),
        });
        return;
      }

      const sessMatch = /^\/api\/sessions\/([^/]+)$/.exec(path);
      if (method === 'GET' && sessMatch) {
        this.writeJson(
          res,
          200,
          this.store.getSessionTranscript(sessMatch[1]!),
        );
        return;
      }

      if (method === 'GET' && path === '/api/evidence/search') {
        const q = url.searchParams.get('q') ?? '';
        const hits = this.store.searchEvidence(q, 40);
        this.writeJson(res, 200, {hits});
        return;
      }

      if (method === 'GET' && path === '/api/ddd-terms') {
        const wsId = url.searchParams.get('workspaceId') || undefined;
        this.writeJson(res, 200, {
          domainTerms: this.store.listDomainTerms(wsId),
        });
        return;
      }

      if (method === 'POST' && path === '/api/ddd-terms') {
        const rec = asRecord(await this.readJsonBody(req));
        const aliasesRaw = Array.isArray(rec['forbiddenAliases'])
          ? rec['forbiddenAliases'].map(String)
          : String(rec['forbiddenAliases'] ?? '')
              .split(',')
              .map(s => s.trim())
              .filter(Boolean);
        const term = this.store.upsertDomainTerm({
          id: optString(rec, 'id', '', 80) || undefined,
          workspaceId: optString(rec, 'workspaceId', 'global', 80),
          boundedContext: reqString(rec, 'boundedContext', 120),
          canonicalTerm: reqString(rec, 'canonicalTerm', 120),
          localLabel: optString(rec, 'localLabel', '', 120),
          definition: optString(rec, 'definition', '', 1000),
          forbiddenAliases: aliasesRaw,
        });
        this.writeJson(res, 200, {
          term,
          domainTerms: this.store.listDomainTerms(),
        });
        return;
      }

      const dddDelMatch = /^\/api\/ddd-terms\/([^/]+)\/delete$/.exec(path);
      if (method === 'POST' && dddDelMatch) {
        this.store.deleteDomainTerm(dddDelMatch[1]!);
        this.writeJson(res, 200, {
          domainTerms: this.store.listDomainTerms(),
        });
        return;
      }

      if (method === 'GET' && path === '/api/skills') {
        this.writeJson(res, 200, {skills: this.store.listSkills()});
        return;
      }

      if (method === 'POST' && path === '/api/skills') {
        const rec = asRecord(await this.readJsonBody(req));
        const rawCategory = optString(rec, 'category', 'governance', 40);
        const category = (
          ['pm_plan', 'backend', 'frontend', 'qa', 'governance'].includes(
            rawCategory,
          )
            ? rawCategory
            : 'governance'
        ) as SkillEntry['category'];
        const skill = this.store.upsertSkill({
          id: optString(rec, 'id', '', 80) || undefined,
          slug: reqString(rec, 'slug', 120),
          title: reqString(rec, 'title', 200),
          category,
          content: reqString(rec, 'content', 10_000),
        });
        this.writeJson(res, 200, {
          skill,
          skills: this.store.listSkills(),
        });
        return;
      }

      if (method === 'POST' && path === '/api/dream/consolidate') {
        const result = this.consolidator.runConsolidation(this.store);
        this.broadcast('snapshot.invalidated', {}, {source: 'dreaming'});
        this.writeJson(res, 200, {
          ...result,
          skills: this.store.listSkills(),
        });
        return;
      }

      if (method === 'GET' && path === '/api/mcp-servers') {
        this.writeJson(res, 200, {mcpServers: this.store.listMcpServers()});
        return;
      }

      if (method === 'POST' && path === '/api/mcp-servers') {
        const rec = asRecord(await this.readJsonBody(req));
        const transport =
          rec['transport'] === 'stdio' ? ('stdio' as const) : ('http' as const);
        const server = this.store.upsertMcpServer({
          id: optString(rec, 'id', '', 80) || undefined,
          name: reqString(rec, 'name', 120),
          transport,
          endpointOrCommand: reqString(rec, 'endpointOrCommand', 512),
          description: optString(rec, 'description', '', 1000),
          enabled: optBoolean(rec, 'enabled', true),
          toolsCount: optNumber(rec, 'toolsCount', 4, 0, 200),
        });
        this.writeJson(res, 200, {
          mcpServer: server,
          mcpServers: this.store.listMcpServers(),
        });
        return;
      }

      const mcpProbeMatch = /^\/api\/mcp-servers\/([^/]+)\/probe$/.exec(path);
      if (method === 'POST' && mcpProbeMatch) {
        const entry = this.store
          .listMcpServers()
          .find(m => m.id === mcpProbeMatch[1]!);
        if (!entry) {
          throw new OrchestratorError('NOT_FOUND', 'MCP server not found', 404);
        }
        let ok = false;
        if (entry.endpointOrCommand.includes('127.0.0.1:4319')) {
          ok = true;
        } else if (entry.transport === 'stdio') {
          const bin = entry.endpointOrCommand.split(/\s+/)[0] ?? '';
          ok = Boolean(this.runner.resolveExecutable(bin));
        } else {
          try {
            const r = await fetch(entry.endpointOrCommand, {
              signal: AbortSignal.timeout(2500),
            });
            ok = r.status < 500;
          } catch {
            ok = false;
          }
        }
        const updated = this.store.setMcpServerStatus(
          entry.id,
          ok ? 'ready' : 'offline',
        );
        this.writeJson(res, 200, {
          mcpServer: updated,
          mcpServers: this.store.listMcpServers(),
        });
        return;
      }

      if (method === 'POST' && path === '/api/constitution') {
        const rec = asRecord(await this.readJsonBody(req));
        const markdown = reqString(rec, 'markdown', 20_000);
        const blocked = Array.isArray(rec['blockedCommands'])
          ? rec['blockedCommands'].map(String)
          : String(rec['blockedCommands'] ?? '')
              .split(/\r?\n|,/)
              .map(s => s.trim())
              .filter(Boolean);
        const constitution = this.store.saveConstitutionRule(markdown, blocked);
        this.runner.setBlockedCommandPatterns?.(constitution.blockedCommands);
        this.store.appendAudit({
          workflowId: null,
          runId: null,
          category: 'governance',
          author: 'Engineering Constitution',
          title: `Updated Engineering Constitution (${constitution.blockedCommands.length} blocked commands)`,
          detail: constitution.blockedCommands.join(', '),
        });
        this.writeJson(res, 200, {constitution});
        return;
      }

      if (method === 'POST' && path === '/api/doctor') {
        const gitRes = await this.runner.run({
          executable: 'git',
          args: ['--version'],
          cwd: process.cwd(),
        });
        const health = await this.hub.probeAllCapabilities();
        const prunedWorktrees: string[] = [];
        for (const ws of this.store.listWorkspaces()) {
          if (existsSync(join(ws.rootPath, '.git'))) {
            try {
              const pruned = await this.worktrees.cleanupOrphanWorktrees(
                ws.rootPath,
              );
              prunedWorktrees.push(...pruned);
            } catch {
              // ignore non-git workspace dir
            }
          }
        }
        this.writeJson(res, 200, {
          gitReady: gitRes.exitCode === 0,
          gitVersion: gitRes.stdout.trim() || 'Unavailable',
          nodeVersion: process.version,
          capabilityHealth: health,
          prunedWorktrees,
          checkedAt: new Date().toISOString(),
        });
        return;
      }

      this.writeJson(res, 404, {error: `Unknown API route: ${path}`});
    } catch (err) {
      if (err instanceof OrchestratorError) {
        this.writeJson(res, err.status, {
          code: err.code,
          error: err.message,
          details: err.details,
        });
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      this.writeJson(res, 500, {code: 'INTERNAL_ERROR', error: message});
    }
  }
}
