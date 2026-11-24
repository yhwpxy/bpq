import { settingsStore } from './settingsStore.js';
import { AppError, assertSafeId } from './errors.js';
export function createProviderService(root, legacy = {}) {
  const store = settingsStore(root, 'providers', { providers: [] });
  const seed = legacy.enabled ? [{ id: 'legacy-llm', name: 'Existing LLM', protocol: 'openai', baseUrl: legacy.endpoint.replace(/\/chat\/completions$/, ''), model: legacy.model, apiKey: legacy.apiKey, rates: null }] : [];
  async function all() { const value = await store.read(); if (!Array.isArray(value.providers)) throw new AppError(50000, 'Provider storage is damaged'); return [...seed.filter(p => !value.providers.some(x => x.id === p.id)), ...value.providers]; }
  const publicView = ({ apiKey, ...rest }) => ({ ...rest, hasApiKey: Boolean(apiKey), maskedKey: apiKey ? '••••••••' : '' });
  async function save(input) {
    if (!input || typeof input !== 'object') throw new AppError(40001, 'Provider object required');
    assertSafeId(input.id);
    let url;
    try { url = new URL(input.baseUrl); } catch { throw new AppError(40001, 'Invalid provider URL'); }
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) || url.username || url.password || url.search || url.hash) throw new AppError(40001, 'Provider URL must use HTTPS or loopback HTTP without credentials/query');
    if (!['openai', 'anthropic'].includes(input.protocol) || typeof input.model !== 'string' || !input.model.trim()) throw new AppError(40001, 'Protocol and model required');
    if (input.apiKey !== undefined && (typeof input.apiKey !== 'string' || /[\r\n]/.test(input.apiKey) || input.apiKey.length > 4096)) throw new AppError(40001, 'Invalid key');
    const rates = input.rates ?? null;
    if (rates && ['input', 'cached', 'output'].some(k => !Number.isFinite(rates[k]) || rates[k] < 0)) throw new AppError(40001, 'Nonnegative per-million rates required');
    if (input.proxyUrl) { let p; try { p = new URL(input.proxyUrl); } catch { throw new AppError(40001, 'Invalid proxy'); } if (!['http:', 'https:'].includes(p.protocol) || p.username || p.password) throw new AppError(40001, 'Invalid proxy'); }
    const previous = (await all()).find(p => p.id === input.id);
    const next = { id: input.id, name: String(input.name || input.id).slice(0, 100), protocol: input.protocol, baseUrl: url.toString().replace(/\/$/, ''), model: input.model.trim(), apiKey: input.apiKey === undefined ? previous?.apiKey || '' : input.apiKey.trim(), proxyUrl: input.proxyUrl || '', rates };
    return store.update(data => { data.providers = data.providers.filter(p => p.id !== next.id); data.providers.push(next); return publicView(next); });
  }
  async function resolve(id) { const p = (await all()).find(x => x.id === id); if (!p || !p.apiKey) throw new AppError(50301, 'Model provider is not configured'); return p; }
  async function redact(value) { let text = typeof value === 'string' ? value : JSON.stringify(value); for (const p of await all()) if (p.apiKey) text = text.split(p.apiKey).join('[REDACTED]'); return text.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]'); }
  return { list: async () => (await all()).map(publicView), save, resolve, redact };
}
