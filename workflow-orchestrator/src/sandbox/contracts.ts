/**
 * Sandbox & Git Worktree contracts for confined tool/agent execution and
 * non-destructive checkpoint rollback.
 */

export interface ProcessRunOptions {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly envAllowlist?: readonly string[];
  readonly extraEnv?: Readonly<Record<string, string>>;
  readonly stdinText?: string;
  readonly timeoutMs?: number;
  readonly blockedCommandPatterns?: readonly string[];
  readonly onStdoutLine?: (line: string) => void;
  readonly onStderrLine?: (line: string) => void;
  readonly signal?: AbortSignal;
}

export interface ProcessRunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly durationMs: number;
}

export interface ISandboxProcessRunner {
  setBlockedCommandPatterns?(patterns: readonly string[]): void;
  resolveExecutable(command: string): string | null;
  run(options: ProcessRunOptions): Promise<ProcessRunResult>;
  runCommandString(
    commandLine: string,
    cwd: string,
    timeoutMs?: number,
    blockedPatterns?: readonly string[],
  ): Promise<ProcessRunResult>;
}

export interface WorktreeHandle {
  readonly repoId: string;
  readonly runCode: string;
  readonly worktreePath: string;
  readonly branchName: string;
  readonly baseCommitSha: string;
}

export interface CheckpointCommitResult {
  readonly commitSha: string;
  readonly gitTag: string;
  readonly changedFiles: readonly string[];
}

export interface RewindWorktreeResult {
  readonly restoredCommitSha: string;
  readonly rescueRef: string;
}

export interface WorktreeDiffSummary {
  readonly summary: string;
  readonly patch: string;
  readonly changedFiles: readonly string[];
}

export interface IGitWorktreeManager {
  resolveInside(rootDir: string, candidatePath: string): string;
  ensureGitRepoInitialized(
    repoPath: string,
    defaultBranch?: string,
  ): Promise<string>;
  provisionWorktree(input: {
    readonly repoPath: string;
    readonly worktreesRoot: string;
    readonly repoId: string;
    readonly runCode: string;
    readonly baseRef?: string;
  }): Promise<WorktreeHandle>;
  createCheckpoint(input: {
    readonly worktreePath: string;
    readonly runCode: string;
    readonly nodeCode: string;
    readonly message: string;
  }): Promise<CheckpointCommitResult>;
  rewindToCheckpoint(input: {
    readonly worktreePath: string;
    readonly runCode: string;
    readonly targetCommitSha: string;
  }): Promise<RewindWorktreeResult>;
  diffSinceCommit(
    worktreePath: string,
    fromCommitSha: string,
  ): Promise<WorktreeDiffSummary>;
  cleanupOrphanWorktrees(repoPath: string): Promise<readonly string[]>;
}
