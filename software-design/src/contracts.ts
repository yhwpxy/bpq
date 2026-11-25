import type {ApprovedRequirementsBaseline} from '../../requirements-engineering/src/contracts.ts';

export interface CreateDesignInput {
  baselineId: string;
  workspaceId: string;
  /** null means an explicitly uncommitted new project. */
  sourceCommit: string | null;
}

export interface WorkspaceInventory {
  workspaceId: string;
  name: string;
  sourceCommit: string | null;
  existingPaths: string[];
  entryPoints: string[];
  manifests: Array<{path: string; content: string}>;
  dependencies: Array<{manifest: string; name: string; version: string}>;
  testCommands: Array<{directory: string; command: string; source: string}>;
  proposedPaths: string[];
  notes: string[];
}

/** Step 1 captures facts; Design Spec generation and review follow in later steps. */
export interface DesignInputDraft {
  designId: string;
  revision: 1;
  state: 'draft';
  stage: 'input_ready';
  createdAt: string;
  contentSha256: string;
  baselineRef: Pick<ApprovedRequirementsBaseline, 'id' | 'projectId' | 'revision' | 'sha256' | 'schemaVersion' | 'mode'>;
  baseline: ApprovedRequirementsBaseline;
  workspace: WorkspaceInventory;
  reviewEligible: boolean;
  blockers: string[];
}
