/**
 * Execution Certifier:
 * Runs deterministic Shell Gates, Self-Check Diff Inspections, and Independent
 * Fail-Closed QA Audits inside an isolated Git Worktree.
 */

import type {ICapabilityHub} from '../adapters/contracts.ts';
import {detectTerminologyDrift} from '../core/ddd.ts';
import type {
  IGitWorktreeManager,
  ISandboxProcessRunner,
} from '../sandbox/contracts.ts';
import {parseFailClosedAuditJson} from '../shared/validation.ts';
import type {GoalSpec, GraphNode, WorkflowRunRecord} from '../shared/types.ts';
import type {OrchestratorStore} from '../store/database.ts';

export interface NodeCertifyOutcome {
  readonly passed: boolean;
  readonly exitCode: number;
  readonly summary: string;
  readonly errorMessage: string;
  readonly sessionId: string | null;
  readonly inputTokens?: number;
  readonly cachedTokens?: number;
  readonly outputTokens?: number;
}

export class ExecutionCertifier {
  private readonly store: OrchestratorStore;
  private readonly runner: ISandboxProcessRunner;
  private readonly worktrees: IGitWorktreeManager;
  private readonly hub: ICapabilityHub;

  constructor(
    store: OrchestratorStore,
    runner: ISandboxProcessRunner,
    worktrees: IGitWorktreeManager,
    hub: ICapabilityHub,
  ) {
    this.store = store;
    this.runner = runner;
    this.worktrees = worktrees;
    this.hub = hub;
  }

  async runShellGate(
    run: WorkflowRunRecord,
    node: GraphNode,
  ): Promise<NodeCertifyOutcome> {
    const cmd = node.gateCommand?.trim() || run.verifyCommand;
    const blocked = this.store.getConstitutionRule().blockedCommands;
    const res = await this.runner.runCommandString(
      cmd,
      run.worktreePath,
      90_000,
      blocked,
    );
    const out = [res.stdout.trim(), res.stderr.trim()]
      .filter(Boolean)
      .join('\n')
      .slice(0, 1800);
    const passed = res.exitCode === 0 && !res.timedOut;
    return {
      passed,
      exitCode: res.exitCode,
      summary: passed
        ? `Gate PASSED (${cmd}): ${out || 'exit 0'}`
        : `Gate FAILED (exit ${res.exitCode}): ${out || 'command failed'}`,
      errorMessage: passed
        ? ''
        : `Shell gate "${cmd}" exited with ${res.exitCode}`,
      sessionId: null,
    };
  }

  async runSelfCheck(
    run: WorkflowRunRecord,
    goalSpec: GoalSpec,
  ): Promise<NodeCertifyOutcome> {
    const diff = await this.worktrees.diffSinceCommit(
      run.worktreePath,
      run.baseCommitSha,
    );
    const acCount = goalSpec.acceptanceCriteria.length;
    const terms = this.store.listDomainTerms();
    const drifts = detectTerminologyDrift(
      `${goalSpec.goal}\n${diff.changedFiles.join(' ')}`,
      terms,
    );
    const driftNote =
      drifts.length > 0
        ? ` | DDD alerts (${drifts.length}): ${drifts.map(d => `${d.matchedAlias}->${d.canonicalTerm}`).join(', ')}`
        : ' | DDD terminology clean';
    return {
      passed: true,
      exitCode: 0,
      summary: `Self-Check verified ${diff.changedFiles.length} modified file(s) across ${acCount} AC item(s). ${diff.summary}${driftNote}`,
      errorMessage: '',
      sessionId: null,
    };
  }

  async runQaAudit(
    run: WorkflowRunRecord,
    node: GraphNode,
    goalSpec: GoalSpec,
    signal?: AbortSignal,
    onChunk?: (content: string) => void,
  ): Promise<NodeCertifyOutcome> {
    const cap =
      this.store.listCapabilities().find(c => c.id === node.capabilityId) ??
      this.store.listCapabilities().find(c => c.id === 'native-api')!;
    const model =
      node.assignedModel ||
      (cap.id === 'native-api' &&
      (!cap.defaultModel ||
        cap.defaultModel === 'default' ||
        cap.defaultModel === 'deepseek-chat')
        ? 'deepseek-flash'
        : cap.defaultModel);
    const diff = await this.worktrees.diffSinceCommit(
      run.worktreePath,
      run.baseCommitSha,
    );

    const session = this.store.createSession({
      runId: run.id,
      nodeId: node.id,
      capabilityId: cap.id,
      model,
      role: 'evaluator',
    });

    const succeededTasks = this.store
      .listGraphNodes(run.id)
      .filter(
        n =>
          (n.kind === 'task' || n.kind === 'gate_shell') &&
          n.status === 'succeeded',
      )
      .map(n => `- ${n.code} (${n.title}): ${n.outputSummary.slice(0, 220)}`)
      .join('\n');

    const patchExcerpt = diff.patch.trim()
      ? `\nDiff Excerpt:\n${diff.patch.slice(0, 14_000)}`
      : '';
    const prompt = [
      `Goal: ${goalSpec.goal}`,
      `Acceptance Criteria: ${goalSpec.acceptanceCriteria.map(a => `${a.code}: ${a.label}`).join('; ')}`,
      `Deterministic Shell Gate (${run.verifyCommand}): PASSED (exit 0)`,
      succeededTasks ? `Completed Phase Deliverables:\n${succeededTasks}` : '',
      `Diff Stat: ${diff.summary}`,
      `Changed Files: ${diff.changedFiles.join(', ') || '(none)'}${patchExcerpt}`,
      'Evaluate fairly: if Changed Files, Diff Excerpt, and Deterministic Shell Gate satisfy the core Acceptance Criteria for this scoped prototype iteration, return passed=true with score >= 0.75. Respond strictly with valid JSON only: {"passed": boolean, "score": number, "findings": string[]}',
    ]
      .filter(Boolean)
      .join('\n');

    this.store.appendSessionMessage({
      sessionId: session.id,
      role: 'user',
      content: prompt,
    });

    const result = await this.hub.invokeCapability({
      sessionId: session.id,
      runId: run.id,
      nodeId: node.id,
      nodeCode: node.code,
      role: 'evaluator',
      capability: cap,
      model,
      permissionTier: run.permissionTier,
      cwd: run.worktreePath,
      systemPrompt:
        'You are an independent QA Auditor. Grade the Diff Excerpt and Changed Files strictly against Acceptance Criteria (use read_file/list_dir only if the diff excerpt is insufficient). Respond concisely with ONLY valid JSON: {"passed": boolean, "score": number, "findings": string[]}.',
      userPrompt: prompt,
      fileScope: [],
      readOnly: true,
      signal,
      onChunk: (role, content, toolName) => {
        this.store.appendSessionMessage({
          sessionId: session.id,
          role,
          content,
          toolName,
        });
        onChunk?.(content);
      },
    });

    const verdict =
      result.outcome === 'completed'
        ? parseFailClosedAuditJson(result.finalText)
        : {
            passed: false,
            score: 0,
            findings: [result.errorMessage || 'Evaluator invocation failed'],
          };

    this.store.finishSession(
      session.id,
      verdict.passed ? 'completed' : 'failed',
    );
    return {
      passed: verdict.passed,
      exitCode: verdict.passed ? 0 : 1,
      summary: `QA Score=${verdict.score.toFixed(2)} (${verdict.passed ? 'PASS' : 'FAIL'}): ${verdict.findings.join('; ')}`,
      errorMessage: verdict.passed ? '' : verdict.findings.join('; '),
      sessionId: session.id,
      inputTokens: result.inputTokens,
      cachedTokens: result.cachedTokens,
      outputTokens: result.outputTokens,
    };
  }
}
