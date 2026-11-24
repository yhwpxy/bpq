export function costForUsage(usage, rates) {
  if (!usage || usage.known === false || ['inputTokens', 'cachedTokens', 'outputTokens'].some(k => !Number.isFinite(usage[k] ?? 0) || (usage[k] ?? 0) < 0)) return { known: false, costUsd: null };
  const inputTokens = usage.inputTokens || 0, cachedTokens = Math.min(inputTokens, usage.cachedTokens || 0), outputTokens = usage.outputTokens || 0;
  if (!rates || ['input', 'cached', 'output'].some(k => !Number.isFinite(rates[k]) || rates[k] < 0)) return { known: false, inputTokens, cachedTokens, outputTokens, costUsd: null };
  return { known: true, inputTokens, cachedTokens, outputTokens, costUsd: Number((((inputTokens - cachedTokens) * rates.input + cachedTokens * rates.cached + outputTokens * rates.output) / 1e6).toFixed(8)), rates: { ...rates } };
}
export function aggregateUsage(attempts, budgetUsd = null) {
  const unknownAgents = attempts.filter(a => a.capabilityKind === 'agent' && a.finishedAt && !a.output?.usage).length;
  const summaries = attempts.filter(a => a.output?.usage).map(a => ({ attemptId: a.id, ...costForUsage(a.output.usage, a.output.rates) }));
  const totals = { inputTokens: 0, cachedTokens: 0, outputTokens: 0, estimatedCostUsd: 0, unknownAttempts: unknownAgents, budgetUsd, source: 'provider usage × configured rates (estimate)', summaries };
  for (const s of summaries) { for (const k of ['inputTokens', 'cachedTokens', 'outputTokens']) totals[k] += s[k] || 0; if (!s.known) totals.unknownAttempts++; else totals.estimatedCostUsd += s.costUsd; }
  totals.estimatedCostUsd = Number(totals.estimatedCostUsd.toFixed(8)); totals.budgetExceeded = Number.isFinite(budgetUsd) && totals.estimatedCostUsd > budgetUsd;
  return totals;
}
