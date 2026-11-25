/**
 * Typed domain errors and exhaustiveness guard across Orchestrator boundaries.
 */

export type OrchestratorErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN_PATH'
  | 'POLICY_DENIED'
  | 'SPEC_INVALID'
  | 'DAG_CYCLE'
  | 'CAPABILITY_UNAVAILABLE'
  | 'GATE_FAILED'
  | 'CONFLICT'
  | 'VERSION_LOCKED'
  | 'INTERNAL_ERROR';

export class OrchestratorError extends Error {
  readonly code: OrchestratorErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: OrchestratorErrorCode,
    message: string,
    status = 400,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'OrchestratorError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function assertNever(value: never, label = 'Unhandled variant'): never {
  throw new Error(`${label}: ${JSON.stringify(value)}`);
}
