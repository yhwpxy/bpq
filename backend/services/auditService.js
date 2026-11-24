import { settingsStore } from './settingsStore.js';
import { AppError } from './errors.js';
export function createAuditService(root) {
  const store = settingsStore(root, 'audit-ledger', { events: [] });
  async function append(entry) {
    return store.update(data => {
      if (!Array.isArray(data.events)) throw new AppError(50000, 'Audit ledger damaged');
      const event = { seq: (data.events.at(-1)?.seq || 0) + 1, time: new Date().toISOString(), actor: 'local-user', planId: null, runId: null, versionId: null, nodeId: null, ...entry };
      data.events.push(event); return event;
    });
  }
  async function list({ since = 0, planId, limit = 1000 } = {}) {
    if (!Number.isSafeInteger(since) || since < 0 || !Number.isInteger(limit) || limit < 1 || limit > 1000) throw new AppError(40001, 'Invalid audit cursor/limit');
    const { events } = await store.read();
    if (!Array.isArray(events)) throw new AppError(50000, 'Audit ledger damaged');
    const selected = events.filter(e => e.seq > since && (!planId || e.planId === planId));
    const page = selected.slice(0, limit);
    return { events: page, cursor: page.at(-1)?.seq || since, hasMore: selected.length > limit };
  }
  async function all(planId) { const { events } = await store.read(); if (!Array.isArray(events)) throw new AppError(50000, 'Audit ledger damaged'); return events.filter(e => !planId || e.planId === planId); }
  return { append, list, all };
}
