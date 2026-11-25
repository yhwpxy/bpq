import type {GraphNode, WorkflowRunRecord} from '../shared/types.ts';

export interface WorkflowStepContext {
  readonly run: WorkflowRunRecord;
  readonly node: GraphNode;
  readonly attemptId: string;
}

export interface WorkflowWait {
  readonly question: string;
  readonly contextSnippet: string;
  readonly options: readonly string[];
  readonly bind: (interventionId: string) => void;
}

export interface WorkflowStepResult {
  readonly summary: string;
  readonly selectedBranch?: string;
  readonly repeatFrom?: string;
  readonly countRework?: boolean;
  readonly stop?: boolean;
  readonly wait?: WorkflowWait;
  readonly commit?: () => void;
}

/** Registered document workflow nodes use the existing graph frontier and run journal. */
export interface WorkflowHandler {
  matches(workflowId: string): boolean;
  handles(node: GraphNode): boolean;
  execute(context: WorkflowStepContext, signal: AbortSignal): Promise<WorkflowStepResult>;
  resolve(context: WorkflowStepContext, interventionId: string, input: unknown): WorkflowStepResult | null;
}
