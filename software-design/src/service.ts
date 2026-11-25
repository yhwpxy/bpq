import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import type {HamaService} from '../../requirements-engineering/src/service.ts';
import {hash} from '../../requirements-engineering/src/repository.ts';
import {OrchestratorError} from '../../workflow-orchestrator/src/shared/errors.ts';
import type {OrchestratorStore} from '../../workflow-orchestrator/src/store/database.ts';
import {validateBaseline} from './baseline.ts';
import type {CreateDesignInput, DesignInputDraft, WorkspaceInventory} from './contracts.ts';

export class DesignService {
  constructor(
    private readonly store: Pick<OrchestratorStore, 'getWorkspace'>,
    private readonly requirements: Pick<HamaService, 'baseline'>,
    private readonly draftRoot: string,
  ) {}

  inspectWorkspace(workspaceId: string, expectedCommit?: string | null): WorkspaceInventory {
    const ws = this.store.getWorkspace(workspaceId);
    if (ws.description === 'hama-document-workspace') {
      throw new OrchestratorError('VALIDATION_ERROR', 'workspaceId 指向需求文档工作区，请选择目标工程工作区', 422, {field: 'workspaceId'});
    }
    if (!existsSync(ws.rootPath)) {
      throw new OrchestratorError('NOT_FOUND', 'workspaceId 对应的目录不存在，请修正目标工程路径', 404, {field: 'workspaceId'});
    }
    const git = (args: string[]) => execFileSync('git', ['-C', ws.rootPath, ...args], {
      encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let sourceCommit: string | null = null;
    if (existsSync(join(ws.rootPath, '.git'))) {
      try {
        if (realpathSync(git(['rev-parse', '--show-toplevel']).trim()).toLowerCase() !== realpathSync(ws.rootPath).toLowerCase()) throw new Error('root');
        // symbolic-ref identifies an unborn branch; other failures must not silently become concept designs.
        try {sourceCommit = git(['rev-parse', '--verify', 'HEAD^{commit}']).trim();}
        catch {git(['symbolic-ref', 'HEAD']); if (git(['rev-list', '--all']).trim()) throw new Error('Invalid HEAD');}
      } catch {
        throw new OrchestratorError('VALIDATION_ERROR', 'workspaceId 的 Git 仓库无法读取，请修复目标工程仓库', 422, {field: 'workspaceId'});
      }
    }
    if (expectedCommit !== undefined && expectedCommit !== sourceCommit) {
      throw new OrchestratorError('CONFLICT', 'sourceCommit 与目标工程当前提交不符，请刷新目标提交后重新创建设计', 409,
        {field: 'sourceCommit', expected: expectedCommit, current: sourceCommit});
    }
    const existingPaths = sourceCommit ? git(['ls-tree', '-r', '--name-only', '-z', sourceCommit]).split('\0').filter(Boolean) : [];
    const manifests: WorkspaceInventory['manifests'] = [];
    const dependencies: WorkspaceInventory['dependencies'] = [];
    const testCommands: WorkspaceInventory['testCommands'] = [];
    const entryPoints = new Set(existingPaths.filter(p => /(^|\/)(main|index|app|server|cli)\.[^/]+$/.test(p)));
    const notes: string[] = [];
    for (const path of existingPaths.filter(p => /(^|\/)(package\.json|pyproject\.toml|requirements\.txt|Cargo\.toml|go\.mod|pom\.xml|Makefile)$/.test(p))) {
      const content = git(['show', `${sourceCommit}:${path}`]);
      manifests.push({path, content});
      if (path.endsWith('package.json')) {
        try {
          const pkg = JSON.parse(content) as Record<string, unknown>;
          for (const group of ['dependencies', 'devDependencies', 'peerDependencies']) {
            const values = pkg[group];
            if (values && typeof values === 'object') for (const [name, version] of Object.entries(values)) dependencies.push({manifest: path, name, version: String(version)});
          }
          const directory = dirname(path).replaceAll('\\', '/');
          const scripts = pkg['scripts'];
          if (scripts && typeof scripts === 'object') for (const [name] of Object.entries(scripts)) {
            if (/^(test|verify|typecheck|lint)(:|$)/.test(name)) testCommands.push({directory, command: `npm run ${name}`, source: path});
          }
          for (const field of ['main', 'module']) if (typeof pkg[field] === 'string') {
            const candidate = join(directory, pkg[field]).replaceAll('\\', '/');
            if (existingPaths.includes(candidate)) entryPoints.add(candidate);
          }
        } catch {notes.push(`${path} 无法解析为 JSON，保留原文供设计核对。`);}
      }
    }
    if (!sourceCommit) notes.push('目标尚无提交：仅记录概念设计；绑定初始提交后才能进入正式评审。源码清单在初始提交后生成。');
    if (sourceCommit) {
      if (git(['rev-parse', '--verify', 'HEAD^{commit}']).trim() !== sourceCommit) {
        throw new OrchestratorError('CONFLICT', '源码清点期间 sourceCommit 已改变，请刷新目标提交', 409, {field: 'sourceCommit'});
      }
      notes.push('清单及依赖取自目标提交，未提交或未跟踪文件不计入该版本。');
    }
    notes.push('输入阶段尚未推导拟新增路径；生成后的拟建工件见设计正文 modules.files 中 action=create 的条目。');
    if (ws.verifyCommand) testCommands.push({directory: '.', command: ws.verifyCommand, source: 'workspace.verifyCommand（配置值，尚未执行）'});
    return {workspaceId, name: ws.name, sourceCommit, existingPaths, entryPoints: [...entryPoints],
      manifests, dependencies, testCommands, proposedPaths: [], notes};
  }

  create(input: CreateDesignInput): DesignInputDraft {
    if (!input || typeof input.baselineId !== 'string' || !/^[\w-]{1,80}$/.test(input.baselineId) ||
      typeof input.workspaceId !== 'string' || !input.workspaceId ||
      !(input.sourceCommit === null || (typeof input.sourceCommit === 'string' && /^[a-f0-9]{40,64}$/.test(input.sourceCommit)))) {
      throw new OrchestratorError('VALIDATION_ERROR', '请提供 baselineId、workspaceId 和完整 sourceCommit；无提交的新工程请显式传 null', 400);
    }
    // Fetch solely by ID; no PRD or project supplied by a browser is trusted.
    const baseline = structuredClone(this.requirements.baseline(input.baselineId));
    validateBaseline(baseline, input.baselineId);
    const workspace = this.inspectWorkspace(input.workspaceId, input.sourceCommit);
    const {id, projectId, revision, sha256, schemaVersion, mode} = baseline;
    const baselineRef = {id, projectId, revision, sha256, schemaVersion, mode};
    const blockers = [...(mode === 'demo' ? ['演示基线仅供演练；正式交接需要 live 基线。'] : []),
      ...(!workspace.sourceCommit ? ['目标工程尚无提交，请绑定初始提交后进入正式评审。'] : [])];
    const content = {baselineRef, baseline, workspace};
    const draft: DesignInputDraft = {designId: `design-${randomUUID()}`, revision: 1, state: 'draft', stage: 'input_ready',
      createdAt: new Date().toISOString(), contentSha256: hash(content), ...content, reviewEligible: blockers.length === 0, blockers};
    mkdirSync(this.draftRoot, {recursive: true});
    writeFileSync(join(this.draftRoot, `${draft.designId}.json`), JSON.stringify(draft, null, 2), {flag: 'wx'});
    return draft;
  }

  read(id: string): DesignInputDraft {
    if (!/^design-[a-f0-9-]{36}$/.test(id)) throw new OrchestratorError('VALIDATION_ERROR', 'designId 格式无效');
    const path = resolve(this.draftRoot, `${id}.json`);
    if (!existsSync(path)) throw new OrchestratorError('NOT_FOUND', '设计输入草案不存在', 404);
    return JSON.parse(readFileSync(path, 'utf8')) as DesignInputDraft;
  }

  compareSource(workspaceId: string, expectedCommit: string) {
    const current = this.inspectWorkspace(workspaceId);
    const result = {expectedCommit, currentCommit: current.sourceCommit, changedPaths: [] as string[], complete: true};
    if (current.sourceCommit === expectedCommit) return result;
    if (!current.sourceCommit) return {...result, complete: false};
    try {
      result.changedPaths = execFileSync('git', ['-C', this.store.getWorkspace(workspaceId).rootPath,
        'diff', '--name-only', '-z', '--no-renames', expectedCommit, current.sourceCommit, '--'],
      {encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']}).split('\0').filter(Boolean);
    } catch {result.complete = false;}
    return result;
  }
}
