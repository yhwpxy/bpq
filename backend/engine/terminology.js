export function terminologyIssues(text, terms, nodeId = '') {
  const issues = [];
  for (const term of terms) for (const alias of term.aliases) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = /^[A-Za-z0-9_ -]+$/.test(alias) ? `\\b${escaped}\\b` : escaped;
    if (new RegExp(pattern, 'i').test(text)) issues.push({ rule: 'R6', code: 'DDD_DRIFT', level: 2, severity: 'warning', nodeId, termId: term.id, message: `Use ${term.term} instead of ${alias} (${term.context})` });
  }
  return issues;
}
