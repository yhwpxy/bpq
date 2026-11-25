export type UiLang = 'ZH' | 'EN';

export function tr(lang: UiLang, zh: string, en: string): string {
  return lang === 'ZH' ? zh : en;
}

export function formatNodeStatus(lang: UiLang, status: string): string {
  switch (status) {
    case 'pending':
      return tr(lang, '待调度', 'Pending');
    case 'ready':
      return tr(lang, '就绪', 'Ready');
    case 'running':
      return tr(lang, '执行中', 'Running');
    case 'succeeded':
      return tr(lang, '已完成', 'Succeeded');
    case 'failed':
      return tr(lang, '失败', 'Failed');
    case 'skipped':
      return tr(lang, '条件跳过', 'Skipped');
    case 'waiting_human':
      return tr(lang, '待人工裁决', 'Waiting Human');
    case 'rewound':
      return tr(lang, '已回退', 'Rewound');
    case 'waived':
      return tr(lang, '已豁免', 'Waived');
    default:
      return status;
  }
}

export function formatRunStatus(lang: UiLang, status: string): string {
  switch (status) {
    case 'queued':
      return tr(lang, '排队中', 'Queued');
    case 'running':
      return tr(lang, '实时编排中', 'Running');
    case 'paused':
      return tr(lang, '已暂停', 'Paused');
    case 'waiting_human':
      return tr(lang, '等待人工门禁', 'Waiting Human');
    case 'succeeded':
      return tr(lang, '已认证完成', 'Succeeded');
    case 'failed':
      return tr(lang, '执行失败', 'Failed');
    case 'cancelled':
      return tr(lang, '已终止', 'Cancelled');
    default:
      return status;
  }
}

export function formatWorkflowStatus(lang: UiLang, status: string): string {
  switch (status) {
    case 'draft':
      return tr(lang, '草稿待校验', 'Draft');
    case 'validated':
      return tr(lang, '已通过校验', 'Validated');
    case 'trial_passed':
      return tr(lang, '试运行通过', 'Trial Passed');
    case 'locked':
      return tr(lang, '版本已锁定', 'Locked');
    default:
      return status;
  }
}

export function formatExecutorKind(lang: UiLang, kind: string): string {
  switch (kind) {
    case 'agent':
      return tr(lang, '智能体', 'Agent');
    case 'tool':
      return tr(lang, '工具', 'Tool');
    case 'human':
      return tr(lang, '人工', 'Human');
    case 'control':
      return tr(lang, '控制流', 'Control');
    default:
      return kind;
  }
}

export function formatNodeKind(lang: UiLang, kind: string): string {
  switch (kind) {
    case 'checkpoint':
      return tr(lang, '检查点', 'Checkpoint');
    case 'restore':
      return tr(lang, '回退恢复', 'Restore');
    case 'human_gate':
      return tr(lang, '人工审批', 'Human Gate');
    case 'decision':
      return tr(lang, '路由裁决', 'Decision');
    case 'join':
      return tr(lang, '汇聚门闩', 'Join');
    case 'gate_shell':
      return tr(lang, '命令门禁', 'Shell Gate');
    case 'selfcheck':
      return tr(lang, '自检校验', 'Self-Check');
    case 'qa_audit':
      return tr(lang, '独立审校', 'QA Audit');
    case 'ghost':
      return tr(lang, '修正节点', 'Amendment');
    case 'start':
      return tr(lang, '起点', 'Start');
    case 'done':
      return tr(lang, '交付完成', 'Done');
    case 'task':
      return tr(lang, '任务', 'Task');
    default:
      return kind;
  }
}

export function formatTemplatePreset(lang: UiLang, preset: string): string {
  switch (preset) {
    case 'fullstack_se':
      return tr(lang, '全栈标准研发流程', 'Full-Stack SE');
    case 'microservice_hardened':
      return tr(lang, '高可用微服务加固流程', 'Hardened Microservice');
    case 'rapid_ui_api':
      return tr(lang, '敏捷前后端原型流程', 'Rapid UI/API');
    case 'custom':
      return tr(lang, '自定义流程', 'Custom');
    default:
      return preset;
  }
}

export function formatEdgeLabel(lang: UiLang, rawLabel: string): string {
  const trimmed = rawLabel.trim();
  if (!trimmed || lang !== 'ZH') {
    return trimmed;
  }
  const lower = trimmed.toLowerCase();
  if (lower === 'fail' || lower === 'gate fail') {
    return '失败回退';
  }
  if (lower === 'qa fail') {
    return '审校退回';
  }
  if (lower === 'rework') {
    return '返工';
  }
  if (lower === 'standard') {
    return '标准';
  }
  if (lower === 'extended') {
    return '扩展';
  }
  if (lower === 'verify') {
    return '验证';
  }
  if (lower === 'audit') {
    return '审校';
  }
  if (lower === 'pass' || lower === 'exit 0') {
    return '通过';
  }
  if (lower === 'certify') {
    return '交付';
  }
  if (lower === 'anchor' || lower === 'checkpoint') {
    return '检查点';
  }
  if (lower === 'init') {
    return '初始化';
  }
  if (lower === 'approve') {
    return '审批';
  }
  if (lower === 'route') {
    return '路由';
  }
  if (lower === 'sync') {
    return '汇合';
  }
  if (lower === 'cleared') {
    return '放行';
  }
  if (lower === 'commit') {
    return '提交';
  }
  if (lower.startsWith('fork-')) {
    return `分支 ${lower.slice(5)}`;
  }
  return trimmed;
}
