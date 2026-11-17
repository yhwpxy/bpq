/** Single source of truth for the node contract and §5.6 status colors. */
export const NODE_TYPES = ['start', 'task', 'condition', 'delay', 'end'];
export const NODE_TYPE_LABELS = {start:'开始', task:'任务', condition:'条件分支', delay:'延时', end:'结束'};
export const NODE_TYPE_COLORS = {start:'#41a779', task:'#4f6ef2', condition:'#e6a23c', delay:'#9564d5', end:'#24734f'};
export const NODE_STATUS_COLORS = {PENDING:'#d9d9d9', RUNNING:'#409eff', SUCCESS:'#67c23a', FAILED:'#f56c6c', SKIPPED:'#e6a23c', CANCELED:'#909399'};
export const NODE_STATUS_LABELS = {PENDING:'待执行',RUNNING:'执行中',SUCCESS:'成功',FAILED:'失败',SKIPPED:'已跳过',CANCELED:'已停止'};
export const SETTLED_STATUSES = ['SUCCESS','FAILED','SKIPPED','CANCELED'];
export const MAX_SPEC_BYTES = 200 * 1024;
export const MAX_NODES = 100;
export const MAX_EDGES = 200;
// Contract conflict resolution is documented in docs/实现约定.md.
export const START_MAX_OUTGOING = 1;
