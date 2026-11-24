import axios from 'axios';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { inside, writablePath } from '../sandbox/pathPolicy.js';
const definitions = [
  { name: 'read_file', description: 'Read a UTF-8 workspace file', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'list_dir', description: 'List workspace entries', parameters: { type: 'object', properties: { path: { type: 'string' } } } },
  { name: 'write_file', description: 'Write a scoped UTF-8 deliverable', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
];
export async function worktreeTool(name, args, request) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Invalid tool arguments');
  if (name === 'read_file') { const data = await readFile(await inside(request.cwd, args.path)); if (data.length > 200000) throw new Error('File exceeds read limit'); return data.toString('utf8'); }
  if (name === 'list_dir') return (await readdir(await inside(request.cwd, args.path || '.'))).filter(n => n !== '.git');
  if (name === 'write_file') {
    if (request.readOnly || (request.permissionTier === 'strict' && !request.approved)) throw new Error('Mutation requires approval');
    if (typeof args.content !== 'string' || Buffer.byteLength(args.content) > 200000) throw new Error('Invalid or oversized file content');
    const target = await writablePath(request.cwd, args.path, request.fileScope);
    await writeFile(target, args.content); return { written: args.path };
  }
  throw new Error('Unsupported workspace tool');
}
export async function invokeNative(provider, request, http = axios) {
  const controller = new AbortController();
  const abort = () => controller.abort(); request.signal?.addEventListener('abort', abort, { once: true });
  if (request.signal?.aborted) controller.abort();
  const timer = setTimeout(abort, request.timeoutMs ?? 60000);
  const anthropic = provider.protocol === 'anthropic';
  const messages = [{ role: 'user', content: request.prompt || request.title || 'Complete the assigned task.' }];
  const system = `${request.systemPrompt || ''}\nOnly use workspace tools for files. Scope: ${(request.fileScope || []).join(', ')}. ${request.readOnly ? 'Read-only review; never write files.' : 'Return a concise summary referencing actual produced files.'}`;
  const usage = { inputTokens: 0, cachedTokens: 0, outputTokens: 0, known: true };
  const files = [];
  let proxy = false;
  if (provider.proxyUrl) { const p = new URL(provider.proxyUrl); proxy = { protocol: p.protocol.slice(0, -1), host: p.hostname, port: Number(p.port || (p.protocol === 'https:' ? 443 : 80)) }; }
  try {
    for (let turn = 0; turn < 8; turn++) {
      const defs = request.readOnly ? definitions.slice(0, 2) : definitions;
      const body = anthropic ? { model: provider.model, max_tokens: 4096, system, messages, tools: defs.map(d => ({ name: d.name, description: d.description, input_schema: d.parameters })) }
        : { model: provider.model, messages: [{ role: 'system', content: system }, ...messages], tools: defs.map(d => ({ type: 'function', function: d })), stream: false };
      const response = await http.post(`${provider.baseUrl}/${anthropic ? 'messages' : 'chat/completions'}`, body, {
        headers: anthropic ? { 'x-api-key': provider.apiKey, 'anthropic-version': '2023-06-01' } : { Authorization: `Bearer ${provider.apiKey}` },
        signal: controller.signal, timeout: request.timeoutMs ?? 60000, maxRedirects: 0, maxContentLength: 1048576, maxBodyLength: 1048576, proxy, validateStatus: () => true,
      });
      if (response.status !== 200) return { outcome: response.status === 429 ? 'rate_limited' : 'task_failure', exitCode: 1, output: `Model service HTTP ${response.status}`, files, usage };
      const data = response.data;
      if (!data || typeof data !== 'object') throw new Error('Invalid provider envelope');
      const u = data.usage;
      const metrics = anthropic ? [u?.input_tokens, u?.cache_read_input_tokens ?? 0, u?.output_tokens] : [u?.prompt_tokens, u?.prompt_tokens_details?.cached_tokens ?? 0, u?.completion_tokens];
      if (metrics.some(x => !Number.isFinite(x) || x < 0)) usage.known = false;
      else { usage.inputTokens += metrics[0] + (anthropic ? metrics[1] : 0); usage.cachedTokens += metrics[1]; usage.outputTokens += metrics[2]; }
      const msg = data.choices?.[0]?.message;
      const text = anthropic ? (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n') : msg?.content;
      const calls = anthropic ? (data.content || []).filter(b => b.type === 'tool_use').map(b => ({ id: b.id, name: b.name, args: b.input })) : (msg?.tool_calls || []).map(c => ({ id: c.id, name: c.function?.name, args: JSON.parse(c.function?.arguments || '{}') }));
      if (typeof text === 'string' && text) await request.onChunk?.('assistant', text);
      if (!calls.length) {
        if (typeof text !== 'string' || !text.trim() || (anthropic ? data.stop_reason === 'max_tokens' : data.choices?.[0]?.finish_reason === 'length')) throw new Error('Incomplete provider output');
        return { outcome: 'completed', exitCode: 0, output: text, files, usage, mode: 'live' };
      }
      messages.push(anthropic ? { role: 'assistant', content: data.content } : { role: 'assistant', content: text || null, tool_calls: msg.tool_calls });
      const results = [];
      for (const call of calls) {
        controller.signal.throwIfAborted();
        const result = await worktreeTool(call.name, call.args, request);
        if (call.name === 'write_file' && !files.includes(call.args.path)) files.push(call.args.path);
        const content = JSON.stringify(result); await request.onChunk?.('tool', content);
        if (anthropic) results.push({ type: 'tool_result', tool_use_id: call.id, content });
        else messages.push({ role: 'tool', tool_call_id: call.id, content });
      }
      if (anthropic) messages.push({ role: 'user', content: results });
    }
    return { outcome: 'task_failure', exitCode: 1, output: 'Model tool-turn limit reached', files, usage };
  } catch {
    return { outcome: request.signal?.aborted ? 'aborted' : 'task_failure', exitCode: 1, output: controller.signal.aborted ? 'Model request cancelled or timed out' : 'Model response or workspace action failed', files, usage };
  } finally { clearTimeout(timer); request.signal?.removeEventListener('abort', abort); }
}
