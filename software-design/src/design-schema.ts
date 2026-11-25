import {array, boolean, choice, identifier, integer, object, string, type Validated} from '../../requirements-engineering/src/schema.ts';

const text = string(6000);
const texts = array(text, 0, 100);
const refs = array(identifier, 1, 100);
export const generationRequestSchema = object({
  expectedHash: string(64, 64, /^[a-f0-9]{64}$/), providerId: identifier, model: string(120), feedback: string(6000, 0),
});
export type GenerationRequest = Validated<typeof generationRequestSchema>;

export const designCheckSchema = object({
  id: string(80, 1, /^DC-[A-Za-z0-9_-]+$/),
  source: object({kind: choice('decision', 'interface', 'quality'), id: identifier}),
  rationale: text, requirementIds: refs, moduleIds: refs, method: text, expectedEvidence: text,
});
export type DesignCheck = Validated<typeof designCheckSchema>;
const designChecksSchema = array(designCheckSchema, 0, 100);
const baseDesignBodySchema = object({
  schemaVersion: integer(1, 1), title: string(160), goal: text,
  inputs: array(text, 1, 100), outputs: array(text, 1, 100),
  modules: array(object({
    id: identifier, name: string(160), layer: choice('frontend', 'backend', 'data', 'integration', 'contract', 'security'),
    responsibility: text, inputs: texts, outputs: texts, requirementIds: refs, dependsOn: array(identifier, 0, 100),
    files: array(object({path: string(512), action: choice('create', 'modify', 'reuse')}), 1, 100),
  }), 1, 100),
  interfaces: array(object({
    id: identifier, provider: identifier, consumers: refs, kind: choice('function', 'cli', 'http', 'file', 'event'),
    input: text, result: text, failure: text, sideEffects: text,
  }), 0, 100),
  dataRules: texts, constraints: texts,
  quality: array(object({requirementId: identifier, moduleIds: refs, method: text, passCondition: text}), 0, 100),
  decisions: array(object({id: identifier, decision: text, rationale: text, alternatives: texts, requirementIds: refs, evidence: array(string(512), 1, 100)}), 1, 100),
  assumptions: array(object({id: identifier, text, requirementIds: refs, evidence: array(string(512), 0, 100), verification: text}), 0, 100),
  trace: array(object({
    requirementId: identifier, moduleIds: refs,
    acceptance: array(object({acceptanceId: identifier, method: text, expectedEvidence: text}), 1, 100),
  }), 1, 100),
  unresolved: array(object({id: identifier, question: text, owner: string(160), requirementIds: refs, blocking: boolean}), 0, 100),
});
export type DesignBody = Validated<typeof baseDesignBodySchema> & {designChecks?: DesignCheck[]};
/** Optional extension: old frozen bodies keep their exact representation and digest. */
export const designBodySchema = {
  json: {...baseDesignBodySchema.json, properties: {
    ...(baseDesignBodySchema.json as {properties: Record<string, unknown>}).properties,
    designChecks: designChecksSchema.json,
  }},
  parse(value: unknown, path = '$'): DesignBody {
    if (value && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, 'designChecks')) {
      const {designChecks, ...base} = value as Record<string, unknown>;
      return {...baseDesignBodySchema.parse(base, path), designChecks: designChecksSchema.parse(designChecks, `${path}.designChecks`)};
    }
    return baseDesignBodySchema.parse(value, path);
  },
};
export interface DesignDiagnostic {path: string; code: string; message: string; severity: 'error' | 'warning'}
