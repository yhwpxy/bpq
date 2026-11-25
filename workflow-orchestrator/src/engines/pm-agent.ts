/**
 * PM Agent Task Decomposer.
 *
 * Transforms any Design Spec (`GoalSpec` + extracted architecture modules) into
 * modular, non-overlapping SE development task slices with DDD glossary bindings,
 * SkillsBank context injection, and optional hybrid LLM decomposition fallback.
 */

import {randomUUID} from 'node:crypto';
import type {ProviderSecretLookup} from '../adapters/contracts.ts';
import {postJsonWithOptionalProxy} from '../adapters/native-api.ts';
import {
  buildStructuralPmSlices,
  resolveWorkflowCustomization,
} from '../core/pm-planner.ts';
import {renderUbiquitousLanguageSection} from '../core/ddd.ts';
import type {
  DesignSpecModule,
  GoalSpec,
  PmDecompositionReport,
  PmDecompositionSlice,
  WorkflowCustomization,
} from '../shared/types.ts';
import type {OrchestratorStore} from '../store/database.ts';

export class PmAgentDecomposer {
  private readonly store: OrchestratorStore;
  private readonly resolveProvider?: ProviderSecretLookup;

  constructor(
    store: OrchestratorStore,
    resolveProvider?: ProviderSecretLookup,
  ) {
    this.store = store;
    this.resolveProvider = resolveProvider;
  }

  decomposeStructural(input: {
    readonly workflowId: string;
    readonly goalSpec: GoalSpec;
    readonly customization?: Partial<WorkflowCustomization>;
    readonly permissionTier: 'turbo' | 'supervised' | 'strict';
  }): {
    readonly report: PmDecompositionReport;
    readonly customization: WorkflowCustomization;
  } {
    const resolved = resolveWorkflowCustomization(
      input.customization,
      input.permissionTier,
    );
    const domainTerms = this.store.listDomainTerms();
    const skills = this.store.listSkills().slice(0, 3);

    const slices = buildStructuralPmSlices({
      goalSpec: input.goalSpec,
      customization: resolved,
      domainTerms: resolved.dddStrictCheck ? domainTerms : [],
    });

    const moduleCount = input.goalSpec.modules?.length ?? 0;
    const pmNarrative = [
      `PM Agent analyzed "${input.goalSpec.title}" using template "${resolved.templatePreset}"`,
      `(${moduleCount > 0 ? `${moduleCount} explicit Design Spec modules` : 'FR-derived modules'} -> ${slices.length} parallel P2 task slices, maxWorkers=${resolved.maxParallelWorkers}).`,
      resolved.includeHumanGate
        ? 'Human sign-off gate enabled before parallel mutations.'
        : 'Autonomous Phase 1 -> Phase 2 handoff enabled.',
      resolved.includeSecurityPass
        ? 'Pre-merge Security & Guardrail scan armed.'
        : 'Streamlined integration without standalone security pass.',
    ].join(' ');

    const report: PmDecompositionReport = {
      id: `pm-${randomUUID().slice(0, 8)}`,
      workflowId: input.workflowId,
      mode: 'structural_pm',
      templatePreset: resolved.templatePreset,
      detectedModules: input.goalSpec.modules ?? [],
      slices,
      pmNarrative,
      skillsApplied: skills.map(s => s.slug),
      createdAt: new Date().toISOString(),
    };

    return {report, customization: resolved};
  }

  async decomposeHybrid(input: {
    readonly workflowId: string;
    readonly goalSpec: GoalSpec;
    readonly customization?: Partial<WorkflowCustomization>;
    readonly permissionTier: 'turbo' | 'supervised' | 'strict';
  }): Promise<{
    readonly report: PmDecompositionReport;
    readonly customization: WorkflowCustomization;
  }> {
    const baseline = this.decomposeStructural(input);
    if (
      baseline.customization.pmAgentMode !== 'hybrid_llm' ||
      !this.resolveProvider
    ) {
      return baseline;
    }

    const providers = this.store.listModelProviders(() => ({
      hasApiKey: false,
      maskedKeyHint: '',
    }));
    const orderedProviders = [...providers].sort((a, b) =>
      a.id === 'deepseek' ? -1 : b.id === 'deepseek' ? 1 : 0,
    );
    const activeProvider = orderedProviders
      .map(p => this.resolveProvider!(p.id))
      .find(p => p && p.apiKey && p.apiKey.trim().length > 0);

    if (!activeProvider?.apiKey) {
      return baseline;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const skillsText = this.store
        .listSkills()
        .slice(0, 3)
        .map(s => `- ${s.slug}: ${s.content}`)
        .join('\n');
      const dddText = renderUbiquitousLanguageSection(
        this.store.listDomainTerms().slice(0, 6),
      );
      const userPrompt = [
        `Decompose Design Spec "${input.goalSpec.title}" into 2..${baseline.customization.maxParallelWorkers} parallel SE slices.`,
        `Goal: ${input.goalSpec.goal}`,
        `Modules: ${(input.goalSpec.modules ?? []).map(m => `${m.name} (${m.artifacts.join(',')})`).join('; ') || 'Synthesize from FRs'}`,
        `Requirements: ${input.goalSpec.requirements.map(r => `${r.code}: ${r.title}`).join('; ')}`,
        dddText,
        skillsText ? `Reusable Skills:\n${skillsText}` : '',
        'Respond strictly with JSON: {"narrative": string, "slices": [{"title": string, "layer": "backend"|"frontend"|"data"|"security"|"integration"|"contract", "fileScope": string[], "requirementRefs": string[], "rationale": string}]}',
      ]
        .filter(Boolean)
        .join('\n\n');

      const isAnthropic = activeProvider.protocol === 'anthropic-messages';
      const url = isAnthropic
        ? `${activeProvider.baseUrl.replace(/\/$/, '')}/messages`
        : `${activeProvider.baseUrl.replace(/\/$/, '')}/chat/completions`;
      const providerRow = orderedProviders.find(
        p => p.id === activeProvider.providerId,
      );
      const modelId =
        providerRow?.models[0]?.id ??
        (activeProvider.providerId === 'opencode-go'
          ? 'deepseek-v4.1-flash'
          : 'gpt-4o-mini');

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(isAnthropic
          ? {
              'x-api-key': activeProvider.apiKey,
              'anthropic-version': '2023-06-01',
            }
          : {Authorization: `Bearer ${activeProvider.apiKey}`}),
      };
      if (activeProvider.providerId === 'opencode-go') {
        headers['x-opencode-session'] = `ses-pm-${input.workflowId}`;
      }

      const lowerModel = modelId.toLowerCase();
      const useLowReasoning =
        lowerModel.includes('deepseek-v4') ||
        lowerModel.includes('dsv4') ||
        lowerModel.includes('flash');

      const bodyPayload = isAnthropic
        ? {
            model: modelId,
            max_tokens: 2048,
            messages: [{role: 'user', content: userPrompt}],
          }
        : {
            model: modelId,
            max_tokens: 2048,
            temperature: 0.2,
            ...(activeProvider.providerId === 'deepseek' ? {thinking: {type: 'disabled'}} : useLowReasoning ? {reasoning_effort: 'low'} : {}),
            messages: [
              {
                role: 'system',
                content:
                  'You are a Principal Software Engineering PM Agent. Output valid JSON only.',
              },
              {role: 'user', content: userPrompt},
            ],
          };

      const res = await postJsonWithOptionalProxy(
        url,
        headers,
        bodyPayload,
        controller.signal,
      );

      if (!res.ok) {
        return baseline;
      }

      const data = res.json() as Record<string, unknown>;
      const rawText = extractLlmText(data, isAnthropic);
      const jsonMatch = /\{[\s\S]*\}/.exec(rawText);
      if (!jsonMatch) {
        return baseline;
      }
      const parsed = JSON.parse(jsonMatch[0]) as {
        narrative?: unknown;
        slices?: unknown;
      };
      if (!Array.isArray(parsed.slices) || parsed.slices.length < 2) {
        return baseline;
      }

      const validLayers = new Set<DesignSpecModule['layer']>([
        'contract',
        'backend',
        'frontend',
        'data',
        'security',
        'integration',
      ]);

      const llmSlices: PmDecompositionSlice[] = parsed.slices
        .slice(0, baseline.customization.maxParallelWorkers)
        .map((item, idx) => {
          const obj = item as Record<string, unknown>;
          const fallback =
            baseline.report.slices[idx] ?? baseline.report.slices[0]!;
          const rawScopes = Array.isArray(obj['fileScope'])
            ? obj['fileScope'].map(String).filter(Boolean)
            : fallback.fileScope;
          const rawRefs = Array.isArray(obj['requirementRefs'])
            ? obj['requirementRefs'].map(String).filter(Boolean)
            : fallback.requirementRefs;
          const layerStr = String(obj['layer'] ?? fallback.layer);
          const layer = validLayers.has(layerStr as DesignSpecModule['layer'])
            ? (layerStr as DesignSpecModule['layer'])
            : fallback.layer;
          return {
            ...fallback,
            code: `P2.T${idx + 1}`,
            title: String(obj['title'] ?? fallback.title).slice(0, 46),
            layer,
            fileScope: rawScopes.length > 0 ? rawScopes : fallback.fileScope,
            requirementRefs:
              rawRefs.length > 0 ? rawRefs : fallback.requirementRefs,
            rationale: String(obj['rationale'] ?? fallback.rationale),
          };
        });

      return {
        customization: baseline.customization,
        report: {
          ...baseline.report,
          mode: 'llm_assisted',
          slices: llmSlices,
          pmNarrative:
            typeof parsed.narrative === 'string' && parsed.narrative.trim()
              ? parsed.narrative.trim()
              : baseline.report.pmNarrative,
        },
      };
    } catch {
      return baseline;
    } finally {
      clearTimeout(timer);
    }
  }
}

function extractLlmText(
  data: Record<string, unknown>,
  isAnthropic: boolean,
): string {
  if (isAnthropic && Array.isArray(data['content'])) {
    return data['content']
      .map(c =>
        typeof (c as {text?: unknown}).text === 'string'
          ? (c as {text: string}).text
          : '',
      )
      .join('\n');
  }
  const choices = data['choices'];
  if (Array.isArray(choices) && choices[0]) {
    const msg = (
      choices[0] as {message?: {content?: unknown; reasoning_content?: unknown}}
    ).message;
    if (typeof msg?.content === 'string' && msg.content.trim()) {
      return msg.content;
    }
    if (typeof msg?.reasoning_content === 'string') {
      return msg.reasoning_content;
    }
  }
  return '';
}
