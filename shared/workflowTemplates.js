export const WORKFLOW_TEMPLATES = [
  { id: 'fullstack', name: '完整交付 / Full delivery', human: true, security: true, qa: true, maxConcurrency: 3 },
  { id: 'hardened', name: '强化验证 / Hardened', human: true, security: true, qa: true, maxConcurrency: 2 },
  { id: 'rapid', name: '快速原型 / Rapid prototype', human: false, security: false, qa: false, maxConcurrency: 3 },
  { id: 'custom', name: '自定义 / Custom', human: false, security: false, qa: false, maxConcurrency: 3 },
];
