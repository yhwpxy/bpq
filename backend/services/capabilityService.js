import { policyViolation } from '../engine/executionPolicy.js';
import { settingsStore } from './settingsStore.js';
import { AppError, assertSafeId } from './errors.js';
import { runProcess } from '../sandbox/processRunner.js';
import { invokeNative } from '../adapters/nativeApi.js';
import { invokeAcp } from '../adapters/acp.js';
import { parseCliOutput } from '../adapters/cliStream.js';
const kinds = { simulated: 'tool', local: 'tool', native: 'agent', cli: 'agent', acp: 'agent' };
const defaults = [
  { id: 'simulated', name: '模拟任务 / Simulation', transport: 'simulated', enabled: true },
  { id: 'local-tool', name: '本地命令 / Local tool', transport: 'local', enabled: true },
  { id: 'native-api', name: '模型 API / Model API', transport: 'native', enabled: false },
].map(c => ({ ...c, kind: kinds[c.transport], command: '', args: [], providerId: '', prompt: '', envAllowlist: [], failures: 0, circuit: 'closed', roles: ['worker', 'evaluator'] }));
export function createCapabilityService(root, providers, options = {}) {
  const store = settingsStore(root, 'capabilities', { capabilities: defaults });
  async function list() { const d = await store.read(); if (!Array.isArray(d.capabilities)) throw new AppError(50000, 'Capability storage damaged'); return d.capabilities; }
  async function get(id) { const c = (await list()).find(c => c.id === id); if (!c) throw new AppError(40401, 'Capability not found'); return c; }
  async function save(input) {
    if (!input || typeof input !== 'object') throw new AppError(40001, 'Capability required');
    assertSafeId(input.id);
    if (!Object.hasOwn(kinds, input.transport) || typeof input.enabled !== 'boolean' || typeof input.name !== 'string' || !input.name.trim()) throw new AppError(40001, 'Invalid capability manifest');
    for (const key of ['args', 'envAllowlist', 'roles']) if (input[key] !== undefined && (!Array.isArray(input[key]) || input[key].length > 64 || input[key].some(x => typeof x !== 'string' || /[\0\r\n]/.test(x)))) throw new AppError(40001, `Invalid ${key}`);
    const c = { id: input.id, name: input.name.slice(0, 100), transport: input.transport, kind: kinds[input.transport], enabled: input.enabled, command: String(input.command || ''), args: input.args || [], providerId: String(input.providerId || ''), prompt: String(input.prompt || '').slice(0, 20000), envAllowlist: input.envAllowlist || [], roles: input.roles || (kinds[input.transport] === 'agent' ? ['worker','evaluator'] : ['worker']), failures: 0, circuit: 'closed' };
    return store.update(d => { const prior = d.capabilities.find(x => x.id === c.id); if (prior) { c.failures = prior.failures; c.circuit = prior.circuit; } d.capabilities = d.capabilities.filter(x => x.id !== c.id); d.capabilities.push(c); return c; });
  }
  async function record(id, ok) { return store.update(d => { const c = d.capabilities.find(x => x.id === id); if (!c) return; c.failures = ok ? 0 : (c.failures || 0) + 1; c.circuit = c.failures >= 3 ? 'open' : c.failures >= 2 ? 'half_open' : 'closed'; }); }
  async function probe(id) {
    const c = await get(id); let ok = false, message = '', check = 'environment';
    if (c.transport === 'native') { check = 'configuration'; try { await providers.resolve(c.providerId); ok = true; message = 'Configuration present; live provider access not tested'; } catch { message = 'Provider configuration missing'; } }
    else if (['simulated', 'local'].includes(c.transport)) { ok = true; message = 'Built-in adapter ready; task commands checked at invocation'; }
    else { const r = await runProcess(c.command, ['--version'], { timeoutMs: 3000 }); ok = r.exitCode === 0; message = ok ? 'Executable probe passed' : 'Executable probe failed'; }
    if (ok) await record(id, true);
    return { ok, check, message };
  }
  async function invoke(id, request) {
    const c = await get(id);
    if (request.role && c.roles && !c.roles.includes(request.role)) throw new AppError(40002, 'Capability role mismatch');
    if (!c.enabled || c.circuit === 'open') throw new AppError(40002, 'Capability disabled or circuit open');
    if (c.transport !== 'simulated' && !request.readOnly && request.permissionTier === 'strict' && !request.approved) throw new AppError(40002, 'Human approval required before mutation');
    const governance = await options.governance?.get();
    const actualCommand = c.transport === 'local' ? request.command : c.command;
    const actualArgs = c.transport === 'local' ? request.args : c.args;
    if (['local', 'cli', 'acp'].includes(c.transport)) { const violation = policyViolation(actualCommand, actualArgs, governance?.policy, request.permissionTier, request.approved); if (violation) throw new AppError(40002, violation, [{ rule: 'R6', code: 'EXECUTION_POLICY', severity: 'error', message: violation }]); }
    let chunkChain = Promise.resolve(), chunkError;
    const cleanRequest = { ...request, envAllowlist: c.envAllowlist, systemPrompt: [c.prompt, governance?.policy.text, governance?.terms.map(t => `${t.context}: ${t.term} (${t.definition})`).join('\n')].filter(Boolean).join('\n'), onChunk: (role, text) => { chunkChain = chunkChain.then(async () => request.onChunk?.(role, await providers.redact(text))).catch(e => { chunkError = e; }); return chunkChain; } };
    let result;
    if (c.prompt) await request.onChunk?.('system', await providers.redact(c.prompt));
    await request.onChunk?.('user', await providers.redact(request.prompt || request.title || [request.command, ...(request.args || [])].filter(Boolean).join(' ')));
    try {
      if (c.transport === 'native') { const provider = await providers.resolve(c.providerId); result = { ...await invokeNative(provider, cleanRequest, options.http), providerId: provider.id, model: provider.model, rates: provider.rates }; }
      else if (c.transport === 'acp') result = await invokeAcp(c, cleanRequest);
      else if (c.transport === 'simulated') result = { outcome: 'completed', exitCode: 0, output: '模拟执行 / Simulated execution', mode: 'simulated', files: [] };
      else {
        const command = c.transport === 'local' ? request.command : c.command;
        const args = c.transport === 'local' ? request.args || [] : [...c.args, request.prompt || request.title || ''];
        if (request.readOnly) throw new AppError(40002, 'Read-only reviews require a read-only adapter; arbitrary processes are not confined');
        const r = await runProcess(command, args, cleanRequest);
        result = { ...r, output: r.stdout || r.stderr, mode: 'live', files: [], ...(c.transport === 'cli' ? parseCliOutput(r.stdout || r.stderr) : {}) };
        if (/rate.?limit|quota exceeded|\b429\b/i.test(result.output)) result.outcome = 'rate_limited';
      }
    } catch (e) { if (e instanceof AppError) throw e; result = { outcome: 'env_fault', exitCode: 1, output: 'Capability execution failed', files: [] }; }
    await chunkChain;
    if (chunkError) throw chunkError;
    result.output = await providers.redact(result.output || '');
    if (result.output.length > 24000) { result.output = result.output.slice(0, 24000); result.truncated = true; }
    delete result.stdout; delete result.stderr;
    if (result.outcome !== 'aborted') await record(id, result.outcome === 'completed');
    return result;
  }
  return { list, get, save, probe, invoke };
}
