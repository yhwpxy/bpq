import { randomUUID } from 'node:crypto';
import { settingsStore } from './settingsStore.js';
import { AppError, assertSafeId } from './errors.js';
import { DEFAULT_RULES } from '../engine/executionPolicy.js';
export function createGovernanceService(root, audit) {
  const store = settingsStore(root, 'governance', { terms: [], policy: DEFAULT_RULES });
  async function get() { const value = await store.read(); if (!Array.isArray(value.terms) || !value.policy || !Array.isArray(value.policy.blockedCommands)) throw new AppError(50000, 'Governance storage damaged'); return value; }
  async function saveTerm(input) {
    if (!input || typeof input.term !== 'string' || !input.term.trim() || input.term.length > 100 || !Array.isArray(input.aliases) || input.aliases.length > 30 || input.aliases.some(a => typeof a !== 'string' || !a.trim() || a.length > 100)) throw new AppError(40001, 'Term and bounded alias list required');
    const id = input.id || `term_${randomUUID()}`; assertSafeId(id);
    const term = { id, term: input.term.trim(), context: String(input.context || 'Workflow').slice(0, 100), definition: String(input.definition || '').slice(0, 2000), aliases: [...new Set(input.aliases.filter(a => a.toLowerCase() !== input.term.toLowerCase()))] };
    await store.update(d => { d.terms = d.terms.filter(t => t.id !== id); d.terms.push(term); }); await audit?.append({ category: 'governance', action: 'term', message: `Saved term ${term.term}` }); return term;
  }
  async function removeTerm(id) { assertSafeId(id); await store.update(d => { d.terms = d.terms.filter(t => t.id !== id); }); await audit?.append({ category: 'governance', action: 'term-delete', message: `Removed term ${id}` }); }
  async function savePolicy(input) {
    if (!input || typeof input.text !== 'string' || input.text.length > 20000 || !Array.isArray(input.blockedCommands) || input.blockedCommands.length > 100 || input.blockedCommands.some(c => typeof c !== 'string' || !c.trim() || c.length > 200)) throw new AppError(40001, 'Invalid engineering rules');
    const policy = { text: input.text, blockedCommands: [...new Set([...DEFAULT_RULES.blockedCommands, ...input.blockedCommands.map(s => s.trim())])] };
    await store.update(d => { d.policy = policy; }); await audit?.append({ category: 'governance', action: 'policy', message: `Updated command rules (${policy.blockedCommands.length})` }); return policy;
  }
  return { get, saveTerm, removeTerm, savePolicy };
}
