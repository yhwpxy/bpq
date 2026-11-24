import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import axios from 'axios';
import { settingsStore } from './settingsStore.js';
import { AppError, assertSafeId } from './errors.js';
export function createMcpService(root, audit) {
  const store = settingsStore(root, 'mcp-pool', { servers: [] });
  async function list() { const { servers } = await store.read(); if (!Array.isArray(servers)) throw new AppError(50000, 'MCP storage damaged'); return servers; }
  async function save(input) {
    if (!input || !['http', 'stdio'].includes(input.transport) || typeof input.name !== 'string' || !input.name.trim() || typeof input.enabled !== 'boolean' || typeof input.endpoint !== 'string' || !input.endpoint.trim()) throw new AppError(40001, 'Invalid MCP service');
    if (input.transport === 'http') { let url; try { url = new URL(input.endpoint); } catch { throw new AppError(40001, 'Invalid MCP URL'); } if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new AppError(40001, 'MCP endpoint must not contain credentials or query tokens'); }
    const entry = { id: input.id || `mcp_${randomUUID()}`, name: input.name.slice(0, 100), endpoint: input.endpoint, transport: input.transport, enabled: input.enabled, description: String(input.description || '').slice(0, 1000), status: 'unchecked', check: 'connectivity-only', checkedAt: null };
    assertSafeId(entry.id); await store.update(d => { d.servers = d.servers.filter(s => s.id !== entry.id); d.servers.push(entry); }); await audit?.append({ category: 'capability', action: 'mcp-save', message: `Registered MCP ${entry.name}` }); return entry;
  }
  async function probe(id) {
    const entry = (await list()).find(s => s.id === id); if (!entry) throw new AppError(40401, 'MCP service missing');
    let ok = false, detail;
    if (!entry.enabled) detail = 'Disabled';
    else if (entry.transport === 'stdio') {
      const candidates = path.isAbsolute(entry.endpoint) ? [entry.endpoint] : (process.env.PATH || '').split(path.delimiter).map(p => path.join(p, entry.endpoint));
      for (const candidate of candidates) { try { await access(candidate, constants.X_OK); ok = true; break; } catch {} }
      detail = ok ? 'Executable is present; protocol handshake and tools not checked' : 'Executable not found';
    } else {
      try { const r = await axios.get(entry.endpoint, { timeout: 2500, maxRedirects: 0, maxContentLength: 65536, proxy: false, validateStatus: () => true }); ok = r.status >= 200 && r.status < 300; detail = `HTTP ${r.status}; connectivity only`; } catch { detail = 'Endpoint unreachable or timed out'; }
    }
    const result = { ...entry, status: ok ? 'reachable' : 'offline', checkedAt: new Date().toISOString(), detail };
    await store.update(d => { const i = d.servers.findIndex(s => s.id === id); d.servers[i] = result; }); await audit?.append({ category: 'capability', action: 'mcp-probe', message: `${entry.name}: ${detail}` }); return result;
  }
  return { list, save, probe };
}
