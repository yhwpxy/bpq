/**
 * Sleep-Time Cognitive Consolidation ("Dreaming") & Ebbinghaus Re-hydration.
 *
 * Computes per-workflow cognitive retention scores for fast 30-second human
 * re-anchoring and distills completed verification telemetry into SkillsBank.
 */

import {
  buildRehydrationCapsule,
  reinforceSkillStability,
} from '../core/cognitive.ts';
import type {RehydrationCapsule, SkillEntry} from '../shared/types.ts';
import type {OrchestratorStore} from '../store/database.ts';

export interface DreamConsolidationResult {
  readonly consolidatedRuns: number;
  readonly reinforcedSkills: number;
  readonly distilledSkill: SkillEntry | null;
  readonly capsules: readonly RehydrationCapsule[];
  readonly totalSpentUsd: number;
}

export class CognitiveConsolidator {
  computeWorkflowCapsule(
    store: OrchestratorStore,
    workflowId: string,
  ): RehydrationCapsule {
    const workflow = store.getWorkflow(workflowId);
    const runs = store.listRuns(workflowId);
    const latestRun = runs[0] ?? null;
    const nodes = latestRun
      ? store.listGraphNodes(latestRun.id)
      : store.listGraphNodes(workflowId);

    return buildRehydrationCapsule({
      workflow,
      goalSpec: store.getGoalSpec(workflowId),
      nodes,
      latestRun,
    });
  }

  computeAllCapsules(store: OrchestratorStore): RehydrationCapsule[] {
    return store
      .listWorkflows()
      .map(wf => this.computeWorkflowCapsule(store, wf.id));
  }

  runConsolidation(store: OrchestratorStore): DreamConsolidationResult {
    const runs = store.listRuns();
    const skills = store.listSkills();
    const completedRuns = runs.filter(
      r => r.status === 'succeeded' || r.status === 'failed',
    );

    let reinforcedCount = 0;
    for (const skill of skills.slice(0, 3)) {
      const nextHours = reinforceSkillStability(
        skill.stabilityHours,
        skill.timesUsed + 1,
      );
      store.incrementSkillUsage(skill.id, nextHours);
      reinforcedCount += 1;
    }

    const totalSpentUsd = Number(
      runs.reduce((acc, r) => acc + (r.spentUsd ?? 0), 0).toFixed(4),
    );
    const totalReworks = runs.reduce((acc, r) => acc + (r.reworkCount ?? 0), 0);

    let distilledSkill: SkillEntry | null = null;
    if (completedRuns.length > 0) {
      const latest = completedRuns[0]!;
      distilledSkill = store.upsertSkill({
        slug: 'run-telemetry-consolidation',
        title: `Run Experience Playbook (${completedRuns.length} verified runs)`,
        category: 'governance',
        content: `Consolidated across ${completedRuns.length} execution runs (${totalReworks} bounded reworks, total $${totalSpentUsd.toFixed(4)} USD). Latest reference: ${latest.title} [${latest.status}] verifying \`${latest.verifyCommand}\`.`,
        timesUsed: completedRuns.length,
        stabilityHours: Math.min(240, 36 + completedRuns.length * 12),
      });
    }

    store.appendAudit({
      workflowId: completedRuns[0]?.workflowId ?? null,
      runId: completedRuns[0]?.id ?? null,
      category: 'dreaming',
      author: 'CognitiveConsolidator',
      title: `Sleep-time Dreaming consolidated ${reinforcedCount} skills`,
      detail: `Analyzed ${runs.length} run(s) ($${totalSpentUsd.toFixed(4)} total spend); refreshed Ebbinghaus stability & SkillsBank memory.`,
    });

    return {
      consolidatedRuns: completedRuns.length,
      reinforcedSkills: reinforcedCount,
      distilledSkill,
      capsules: this.computeAllCapsules(store),
      totalSpentUsd,
    };
  }
}
