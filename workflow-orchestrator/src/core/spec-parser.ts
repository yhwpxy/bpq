/**
 * Design Spec & Requirements Document (Markdown) Parser + Customizable
 * Twin-Graph Compiler.
 */

import {randomUUID} from 'node:crypto';
import type {
  AcceptanceCriterion,
  CapabilityAdapterManifest,
  CapabilityHealthProfile,
  DesignSpecModule,
  DomainTermEntry,
  GoalAssumption,
  GoalRequirement,
  GoalSpec,
  GraphEdge,
  GraphNode,
  PermissionTier,
  PmDecompositionSlice,
  WorkflowCustomization,
} from '../shared/types.ts';
import {planCustomizableTwinGraph} from './pm-planner.ts';

type SectionKey =
  | 'goal'
  | 'modules'
  | 'inputs'
  | 'outputs'
  | 'constraints'
  | 'domainRules'
  | 'requirements'
  | 'acceptance'
  | 'assumptions'
  | 'other';

function classifyHeading(heading: string): SectionKey {
  const h = heading.toLowerCase();
  if (/goal|objective|summary|概述|目标|背景/.test(h)) {
    return 'goal';
  }
  if (
    /module|architecture|component|subsystem|service|模块|架构|组件|子系统/.test(
      h,
    )
  ) {
    return 'modules';
  }
  if (/input|输入|前置/.test(h)) {
    return 'inputs';
  }
  if (/output|deliverable|artifact|输出|交付/.test(h)) {
    return 'outputs';
  }
  if (/constraint|non-functional|limit|约束|限制/.test(h)) {
    return 'constraints';
  }
  if (/domain|rule|invariant|glossary|领域|规则|不变量/.test(h)) {
    return 'domainRules';
  }
  if (/requirement|feature|scope|fr-|功能|需求/.test(h)) {
    return 'requirements';
  }
  if (/acceptance|criteria|test|verify|ac-|验收|测试/.test(h)) {
    return 'acceptance';
  }
  if (/assumption|假设|前提/.test(h)) {
    return 'assumptions';
  }
  return 'other';
}

function cleanBullet(line: string): string {
  return line.replace(/^\s*(?:[-*+]|\d+[.)]|\[[ xX]\])\s+/, '').trim();
}

function inferModuleLayer(text: string): DesignSpecModule['layer'] {
  if (/security|auth|rbac|合规|安全|权限/i.test(text)) {
    return 'security';
  }
  if (/ui|portal|frontend|view|canvas|界面|前端|可视化/i.test(text)) {
    return 'frontend';
  }
  if (
    /store|db|sqlite|postgres|ledger|schema|persistence|持久化|账本/i.test(text)
  ) {
    return 'data';
  }
  if (/api|webhook|reconcile|adapter|gateway|接入|网关/i.test(text)) {
    return 'integration';
  }
  if (/contract|schema|spec|契约/i.test(text)) {
    return 'contract';
  }
  return 'backend';
}

function parseModuleBullet(
  rawLine: string,
  index: number,
  allRequirements: readonly GoalRequirement[],
): DesignSpecModule {
  const scopeMatches = Array.from(rawLine.matchAll(/`([^`]+)`/g))
    .map(m => m[1]!.trim())
    .filter(s => s.includes('/') || s.includes('*') || s.includes('.'));

  const stripped = rawLine
    .replace(/\((?:`[^`]+`(?:,\s*`[^`]+`)*)\)/g, '')
    .replace(/\*\*/g, '')
    .trim();

  const colonIdx = stripped.search(/[:：]\s+/);
  const name =
    colonIdx > 0
      ? stripped.slice(0, colonIdx).trim()
      : stripped.slice(0, 48).trim();
  const summary = colonIdx > 0 ? stripped.slice(colonIdx + 1).trim() : stripped;

  const explicitRefs = Array.from(
    summary.matchAll(/\b(FR-\d+|REQ-\d+)\b/gi),
  ).map(m => m[1]!.toUpperCase());

  const distributedRefs =
    explicitRefs.length > 0
      ? explicitRefs
      : allRequirements
          .filter((_, rIdx) => rIdx % Math.max(1, index + 1) === 0)
          .slice(0, 2)
          .map(r => r.code);

  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 20) || `module-${index + 1}`;

  return {
    name: name || `Module ${index + 1}`,
    layer: inferModuleLayer(`${name} ${summary} ${scopeMatches.join(' ')}`),
    summary: summary || name,
    artifacts: scopeMatches.length > 0 ? scopeMatches : [`src/${slug}/**`],
    relatedFrCodes:
      distributedRefs.length > 0
        ? distributedRefs
        : [allRequirements[0]?.code ?? 'FR-01'],
  };
}

export function parseRequirementsMarkdown(input: {
  readonly workflowId: string;
  readonly rawMarkdown: string;
  readonly titleHint?: string;
  readonly defaultVerifyCommand?: string;
}): GoalSpec {
  const now = new Date().toISOString();
  const lines = input.rawMarkdown.split(/\r?\n/);

  let parsedTitle = input.titleHint?.trim() ?? '';
  let activeSection: SectionKey = 'goal';

  const buckets: Record<SectionKey, string[]> = {
    goal: [],
    modules: [],
    inputs: [],
    outputs: [],
    constraints: [],
    domainRules: [],
    requirements: [],
    acceptance: [],
    assumptions: [],
    other: [],
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      continue;
    }
    const h1 = /^#\s+(.+)$/.exec(trimmed);
    if (h1 && !parsedTitle) {
      parsedTitle = h1[1]!.trim();
      continue;
    }
    const h2 = /^#{2,4}\s+(.+)$/.exec(trimmed);
    if (h2) {
      activeSection = classifyHeading(h2[1]!);
      continue;
    }
    buckets[activeSection].push(cleanBullet(trimmed));
  }

  const title = parsedTitle || 'Untitled Design Specification';
  const goal =
    buckets.goal.join(' ').trim() ||
    buckets.other[0] ||
    `Deliver verified implementation for ${title}`;

  const rawReqLines =
    buckets.requirements.length > 0
      ? buckets.requirements
      : buckets.other.length > 0
        ? buckets.other
        : [goal];

  const requirements: GoalRequirement[] = rawReqLines.map((line, index) => {
    const codeMatch = /^(?:\*\*)?(FR-\d+|REQ-\d+)(?:\*\*)?[:：\s-]+(.+)$/i.exec(
      line,
    );
    const code = codeMatch
      ? codeMatch[1]!.toUpperCase()
      : `FR-${String(index + 1).padStart(2, '0')}`;
    const body = codeMatch ? codeMatch[2]!.trim() : line;
    const colonSplit = body.split(/[:：]\s+/);
    const shortTitle =
      colonSplit[0] && colonSplit[0].length <= 64
        ? colonSplit[0].trim()
        : body.slice(0, 56);
    const shouldFlag = /\bshould\b|optional|可选|建议/i.test(body);
    return {
      id: `req-${index + 1}-${randomUUID().slice(0, 6)}`,
      code,
      title: shortTitle,
      description: body,
      priority: shouldFlag ? 'should' : 'must',
      verifyHint: input.defaultVerifyCommand ?? 'echo Verification gate passed',
    };
  });

  const modules: DesignSpecModule[] = buckets.modules.map((line, idx) =>
    parseModuleBullet(line, idx, requirements),
  );

  const acceptanceCriteria: AcceptanceCriterion[] = (
    buckets.acceptance.length > 0
      ? buckets.acceptance
      : requirements.slice(0, 3).map(r => `Verify ${r.code}: ${r.title}`)
  ).map((line, index) => {
    const codeMatch = /^(?:\*\*)?(AC-\d+)(?:\*\*)?[:：\s-]+(.+)$/i.exec(line);
    const code = codeMatch
      ? codeMatch[1]!.toUpperCase()
      : `AC-${String(index + 1).padStart(2, '0')}`;
    const label = codeMatch ? codeMatch[2]!.trim() : line;
    const cmdMatch = /`([^`]+)`/.exec(label);
    return {
      id: `ac-${index + 1}-${randomUUID().slice(0, 6)}`,
      code,
      label,
      verifyCommand: cmdMatch?.[1] ?? input.defaultVerifyCommand,
      verified: false,
    };
  });

  const assumptions: GoalAssumption[] = buckets.assumptions.map(
    (text, idx) => ({
      id: `asm-doc-${idx + 1}`,
      text,
      source: 'doc',
      rationale: 'Extracted directly from Design Specification.',
    }),
  );

  if (buckets.inputs.length === 0) {
    assumptions.push({
      id: 'asm-sug-inputs',
      text: 'Workspace repository source tree serves as primary input state.',
      source: 'suggested',
      rationale:
        'Suggested because no explicit Inputs section was found in Markdown.',
    });
  }
  if (buckets.outputs.length === 0) {
    assumptions.push({
      id: 'asm-sug-outputs',
      text: 'Verified commit diff, gate exit report, and WBS audit bundle constitute deliverables.',
      source: 'suggested',
      rationale: 'Suggested because no explicit Outputs section was specified.',
    });
  }
  if (buckets.acceptance.length === 0) {
    assumptions.push({
      id: 'asm-sug-ac',
      text: 'Acceptance criteria were synthesized automatically from top functional requirements.',
      source: 'suggested',
      rationale:
        'Review suggested AC items before locking workflow version for production runs.',
    });
  }

  return {
    id: `spec-${randomUUID().slice(0, 8)}`,
    workflowId: input.workflowId,
    rawMarkdown: input.rawMarkdown,
    title,
    goal,
    modules,
    inputs:
      buckets.inputs.length > 0
        ? buckets.inputs
        : [
            'Confirmed Design Specification (Markdown)',
            'Target Git Repository',
          ],
    outputs:
      buckets.outputs.length > 0
        ? buckets.outputs
        : [
            'Implemented & Tested Source Changes',
            'Verification & Audit Bundle',
          ],
    constraints:
      buckets.constraints.length > 0
        ? buckets.constraints
        : [
            'All workspace mutations must stay confined within assigned Git worktree.',
            'Execution must fail closed if verification gates fail.',
          ],
    domainRules: buckets.domainRules,
    requirements,
    acceptanceCriteria,
    assumptions,
    updatedAt: now,
  };
}

export interface PlannedTwinGraph {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly resolvedCustomization?: WorkflowCustomization;
  readonly slices?: readonly PmDecompositionSlice[];
}

export function planTwinGraphFromGoalSpec(input: {
  readonly scopeId: string;
  readonly goalSpec: GoalSpec;
  readonly capabilities: readonly CapabilityAdapterManifest[];
  readonly healthProfiles: readonly CapabilityHealthProfile[];
  readonly permissionTier: PermissionTier;
  readonly verifyCommand: string;
  readonly customization?: Partial<WorkflowCustomization>;
  readonly pmSlices?: readonly PmDecompositionSlice[];
  readonly domainTerms?: readonly DomainTermEntry[];
}): PlannedTwinGraph {
  return planCustomizableTwinGraph(input);
}
