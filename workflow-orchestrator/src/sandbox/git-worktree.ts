/**
 * Git Worktree Isolation, Symlink-Safe Path Confinement, Physical Checkpoints,
 * and Non-Destructive Rescue Ref Rewinds.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {dirname, isAbsolute, join, relative, resolve} from 'node:path';
import {OrchestratorError} from '../shared/errors.ts';
import type {
  CheckpointCommitResult,
  IGitWorktreeManager,
  ISandboxProcessRunner,
  RewindWorktreeResult,
  WorktreeDiffSummary,
  WorktreeHandle,
} from './contracts.ts';

function canonicalizeWithExistingAncestors(targetPath: string): string {
  const abs = resolve(targetPath);
  const tailSegments: string[] = [];
  let cursor = abs;

  while (!existsSync(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) {
      break;
    }
    const base = cursor.slice(parent.length).replace(/^[/\\]+/, '');
    tailSegments.unshift(base);
    cursor = parent;
  }

  let resolvedBase = cursor;
  if (existsSync(cursor)) {
    try {
      resolvedBase = realpathSync.native(cursor);
    } catch {
      resolvedBase = resolve(cursor);
    }
  }

  return tailSegments.length > 0
    ? resolve(resolvedBase, ...tailSegments)
    : resolvedBase;
}

function sanitizeRefSegment(raw: string): string {
  return (
    raw
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'default'
  );
}

export class GitWorktreeManager implements IGitWorktreeManager {
  private readonly runner: ISandboxProcessRunner;

  constructor(runner: ISandboxProcessRunner) {
    this.runner = runner;
  }

  resolveInside(rootDir: string, candidatePath: string): string {
    if (rootDir.includes('\0') || candidatePath.includes('\0')) {
      throw new OrchestratorError(
        'FORBIDDEN_PATH',
        'SANDBOX_ESCAPE: Null byte in path is forbidden',
        403,
      );
    }

    const canonicalRoot = canonicalizeWithExistingAncestors(rootDir);
    const joinedCandidate = isAbsolute(candidatePath)
      ? resolve(candidatePath)
      : resolve(canonicalRoot, candidatePath);
    const canonicalTarget = canonicalizeWithExistingAncestors(joinedCandidate);

    const rel = relative(canonicalRoot, canonicalTarget);
    const escapes =
      rel.startsWith('..') ||
      isAbsolute(rel) ||
      (process.platform === 'win32' &&
        canonicalRoot[0]?.toLowerCase() !== canonicalTarget[0]?.toLowerCase());

    if (escapes) {
      throw new OrchestratorError(
        'FORBIDDEN_PATH',
        `SANDBOX_ESCAPE: Candidate path "${candidatePath}" escapes root "${rootDir}"`,
        403,
      );
    }
    return canonicalTarget;
  }

  async ensureGitRepoInitialized(
    repoPath: string,
    defaultBranch = 'main',
  ): Promise<string> {
    mkdirSync(repoPath, {recursive: true});

    const hasOwnGit = existsSync(join(repoPath, '.git'));
    if (hasOwnGit) {
      const headCheck = await this.runner.run({
        executable: 'git',
        args: ['rev-parse', '--verify', 'HEAD'],
        cwd: repoPath,
      });
      if (headCheck.exitCode === 0 && headCheck.stdout.trim().length > 0) {
        return headCheck.stdout.trim();
      }
    } else {
      const initRes = await this.runner.run({
        executable: 'git',
        args: ['init', '-b', defaultBranch],
        cwd: repoPath,
      });
      if (initRes.exitCode !== 0) {
        await this.runner.run({
          executable: 'git',
          args: ['init'],
          cwd: repoPath,
        });
        await this.runner.run({
          executable: 'git',
          args: ['checkout', '-B', defaultBranch],
          cwd: repoPath,
        });
      }
    }

    await this.configureLocalGitIdentity(repoPath);
    const entries = readdirSync(repoPath).filter(name => name !== '.git');
    if (entries.length === 0) {
      writeFileSync(
        join(repoPath, '.gitkeep'),
        '# Workflow Orchestrator Workspace\n',
        'utf8',
      );
    }

    await this.runner.run({
      executable: 'git',
      args: ['add', '-A'],
      cwd: repoPath,
    });
    const commitRes = await this.runner.run({
      executable: 'git',
      args: ['commit', '--allow-empty', '-m', 'chore: initialize repository'],
      cwd: repoPath,
    });
    if (commitRes.exitCode !== 0) {
      throw new OrchestratorError(
        'INTERNAL_ERROR',
        `Failed to create initial commit in ${repoPath}: ${commitRes.stderr}`,
        500,
      );
    }

    const shaRes = await this.runner.run({
      executable: 'git',
      args: ['rev-parse', 'HEAD'],
      cwd: repoPath,
    });
    return shaRes.stdout.trim();
  }

  async provisionWorktree(input: {
    readonly repoPath: string;
    readonly worktreesRoot: string;
    readonly repoId: string;
    readonly runCode: string;
    readonly baseRef?: string;
  }): Promise<WorktreeHandle> {
    const defaultHead = await this.ensureGitRepoInitialized(input.repoPath);
    mkdirSync(input.worktreesRoot, {recursive: true});

    const cleanRun = sanitizeRefSegment(input.runCode);
    const cleanRepo = sanitizeRefSegment(input.repoId);
    const worktreePath = this.resolveInside(
      input.worktreesRoot,
      `${cleanRepo}-${cleanRun}`,
    );
    const branchName = `orchestrator/${cleanRun}`;

    await this.runner.run({
      executable: 'git',
      args: ['worktree', 'prune'],
      cwd: input.repoPath,
    });

    if (existsSync(worktreePath)) {
      await this.runner.run({
        executable: 'git',
        args: ['worktree', 'remove', '--force', worktreePath],
        cwd: input.repoPath,
      });
      rmSync(worktreePath, {recursive: true, force: true});
    }

    let baseCommitSha = defaultHead;
    if (input.baseRef) {
      const refRes = await this.runner.run({
        executable: 'git',
        args: ['rev-parse', '--verify', input.baseRef],
        cwd: input.repoPath,
      });
      if (refRes.exitCode === 0 && refRes.stdout.trim().length > 0) {
        baseCommitSha = refRes.stdout.trim();
      }
    }

    const addRes = await this.runner.run({
      executable: 'git',
      args: [
        'worktree',
        'add',
        '--force',
        '-B',
        branchName,
        worktreePath,
        baseCommitSha,
      ],
      cwd: input.repoPath,
    });

    if (addRes.exitCode !== 0) {
      throw new OrchestratorError(
        'INTERNAL_ERROR',
        `git worktree add failed: ${addRes.stderr || addRes.stdout}`,
        500,
      );
    }

    await this.configureLocalGitIdentity(worktreePath);
    return {
      repoId: input.repoId,
      runCode: input.runCode,
      worktreePath,
      branchName,
      baseCommitSha,
    };
  }

  async createCheckpoint(input: {
    readonly worktreePath: string;
    readonly runCode: string;
    readonly nodeCode: string;
    readonly message: string;
  }): Promise<CheckpointCommitResult> {
    await this.configureLocalGitIdentity(input.worktreePath);

    await this.runner.run({
      executable: 'git',
      args: ['add', '-A'],
      cwd: input.worktreePath,
    });

    const diffCached = await this.runner.run({
      executable: 'git',
      args: ['diff', '--cached', '--name-only'],
      cwd: input.worktreePath,
    });
    const changedFiles = diffCached.stdout
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(Boolean);

    const commitRes = await this.runner.run({
      executable: 'git',
      args: ['commit', '--allow-empty', '-m', input.message],
      cwd: input.worktreePath,
    });
    if (commitRes.exitCode !== 0) {
      throw new OrchestratorError(
        'INTERNAL_ERROR',
        `Checkpoint commit failed: ${commitRes.stderr || commitRes.stdout}`,
        500,
      );
    }

    const revRes = await this.runner.run({
      executable: 'git',
      args: ['rev-parse', 'HEAD'],
      cwd: input.worktreePath,
    });
    const commitSha = revRes.stdout.trim();
    const shortSha = commitSha.slice(0, 8);
    const gitTag = `orchestrator/${sanitizeRefSegment(input.runCode)}/${sanitizeRefSegment(input.nodeCode)}-${shortSha}`;

    await this.runner.run({
      executable: 'git',
      args: ['tag', '-f', gitTag, commitSha],
      cwd: input.worktreePath,
    });

    return {commitSha, gitTag, changedFiles};
  }

  async rewindToCheckpoint(input: {
    readonly worktreePath: string;
    readonly runCode: string;
    readonly targetCommitSha: string;
  }): Promise<RewindWorktreeResult> {
    const cleanRun = sanitizeRefSegment(input.runCode);
    const rescueRef = `refs/orchestrator-backup/${cleanRun}/${Date.now()}`;

    const refRes = await this.runner.run({
      executable: 'git',
      args: ['update-ref', rescueRef, 'HEAD'],
      cwd: input.worktreePath,
    });
    if (refRes.exitCode !== 0) {
      throw new OrchestratorError(
        'INTERNAL_ERROR',
        `Failed to create rescue ref "${rescueRef}": ${refRes.stderr}`,
        500,
      );
    }

    const resetRes = await this.runner.run({
      executable: 'git',
      args: ['reset', '--hard', input.targetCommitSha],
      cwd: input.worktreePath,
    });
    if (resetRes.exitCode !== 0) {
      throw new OrchestratorError(
        'INTERNAL_ERROR',
        `Failed to rewind worktree to "${input.targetCommitSha}": ${resetRes.stderr}`,
        500,
      );
    }

    await this.runner.run({
      executable: 'git',
      args: ['clean', '-fd'],
      cwd: input.worktreePath,
    });

    const headRes = await this.runner.run({
      executable: 'git',
      args: ['rev-parse', 'HEAD'],
      cwd: input.worktreePath,
    });

    return {
      restoredCommitSha: headRes.stdout.trim() || input.targetCommitSha,
      rescueRef,
    };
  }

  async diffSinceCommit(
    worktreePath: string,
    fromCommitSha: string,
  ): Promise<WorktreeDiffSummary> {
    await this.runner.run({
      executable: 'git',
      args: ['add', '-N', '.'],
      cwd: worktreePath,
    });

    const [statRes, patchRes, namesRes] = await Promise.all([
      this.runner.run({
        executable: 'git',
        args: ['diff', '--stat', fromCommitSha],
        cwd: worktreePath,
      }),
      this.runner.run({
        executable: 'git',
        args: ['diff', fromCommitSha],
        cwd: worktreePath,
      }),
      this.runner.run({
        executable: 'git',
        args: ['diff', '--name-only', fromCommitSha],
        cwd: worktreePath,
      }),
    ]);

    const changedFiles = namesRes.stdout
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(Boolean);

    return {
      summary:
        statRes.stdout.trim() || `${changedFiles.length} file(s) changed`,
      patch: patchRes.stdout,
      changedFiles,
    };
  }

  async cleanupOrphanWorktrees(repoPath: string): Promise<readonly string[]> {
    const pruneRes = await this.runner.run({
      executable: 'git',
      args: ['worktree', 'prune', '-v'],
      cwd: repoPath,
    });
    return `${pruneRes.stdout}\n${pruneRes.stderr}`
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(Boolean);
  }

  private async configureLocalGitIdentity(cwd: string): Promise<void> {
    await this.runner.run({
      executable: 'git',
      args: ['config', 'user.name', 'WorkflowOrchestrator'],
      cwd,
    });
    await this.runner.run({
      executable: 'git',
      args: ['config', 'user.email', 'orchestrator@local'],
      cwd,
    });
  }
}
