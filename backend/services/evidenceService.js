import { createHash } from 'node:crypto';
import { AppError } from './errors.js';
export function createEvidenceService(runs, versions, audit, providers) {
  function scrub(value, redact) {
    if (typeof value === 'string') return redact(value);
    if (Array.isArray(value)) return value.map(v => scrub(v, redact));
    if (value && typeof value === 'object') {
      const result = Object.create(null);
      for (const [k, v] of Object.entries(value)) result[k] = /^(apiKey|authorization|password|secret|token)$/i.test(k) ? '[REDACTED]' : scrub(v, redact);
      return result;
    }
    return value;
  }
  async function exportRun(runId) {
    const run = await runs.get(runId);
    const version = run.versionId ? await versions.get(run.planId, run.versionId) : null;
    const data = scrub({ version, run, designAudit: await audit.all(run.planId) }, await providers.redactor());
    const checksum = createHash('sha256').update(JSON.stringify(data)).digest('hex');
    return { manifest: { schemaVersion: 'evidence-1', runId, versionId: run.versionId || null, exportedAt: new Date().toISOString(), checksumAlgorithm: 'sha256(JSON.stringify(data))', checksum, redaction: 'credential fields and configured provider keys', legacyUnversioned: !run.versionId }, data };
  }
  async function session(runId, sessionId) {
    const run = await runs.get(runId), item = run.sessions?.find(s => s.id === sessionId);
    if (!item) throw new AppError(40401, 'Session not found in this run'); return scrub(item, await providers.redactor());
  }
  async function search(query, { offset = 0, limit = 40 } = {}) {
    if (typeof query !== 'string' || query.length > 200 || !Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new AppError(40001, 'Invalid evidence search');
    const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean); if (!terms.length) return { hits: [], total: 0 };
    const hits = [];
    const add = item => { const text = `${item.nodeId || ''} ${item.title || ''} ${item.text || ''}`; if (terms.every(t => text.toLowerCase().includes(t))) hits.push({ ...item, text: text.slice(0, 600) }); };
    for (const event of await audit.all()) add({ source: 'design-audit', runId: event.runId, nodeId: event.nodeId, title: event.action, text: event.message, time: event.time });
    for (const summary of await runs.list()) {
      const run = await runs.get(summary.id);
      for (const l of run.logs) add({ source: 'run-event', runId: run.id, versionId: run.versionId, nodeId: l.nodeId, title: `${l.nodeName} ${l.event}`, text: l.message, time: l.time, seq: l.seq });
      for (const s of run.sessions || []) for (const m of s.messages) add({ source: 'session', runId: run.id, versionId: run.versionId, nodeId: s.nodeId, sessionId: s.id, title: m.role, text: m.content, time: m.time });
    }
    hits.sort((a, b) => b.time.localeCompare(a.time)); return { hits: scrub(hits.slice(offset, offset + limit), await providers.redactor()), total: hits.length };
  }
  return { exportRun, search, session };
}
