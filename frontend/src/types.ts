export type NodeType = 'start' | 'task' | 'condition' | 'delay' | 'end'
export interface PlanNode { id: string; type: NodeType; x: number; y: number; props: Record<string, any> }
export interface PlanEdge { id: string; source: string; target: string; label?: string }
export interface Plan { id: string; name: string; version: string; meta?: { maxConcurrency?: number; continueOnError?: boolean; description?: string }; nodes: PlanNode[]; edges: PlanEdge[]; createdAt: string; updatedAt: string }
export interface ValidationIssue { nodeId?: string; rule: string; message: string }
export interface Task { key: string; name: string; type: NodeType; dependsOn: string[]; parallelGroup?: number | null; branch?: string | null; expression?: string; output?: string }
export interface TaskSpec { source: string; detectedFormat: 'markdown' | 'numbered'; tasks: Task[] }
export interface NodeRunState { status: string; attempt?: number; startedAt?: string; finishedAt?: string; message?: string; output?: any }
export interface LogEntry { seq: number; time: string; nodeId: string; nodeName: string; event: string; message: string }
