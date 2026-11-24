import { spawnManaged, stopProcess } from '../sandbox/processRunner.js';
/** Stateful JSON-RPC: wait for initialize, then use the server's session ID. */
export function invokeAcp(capability, request) {
  return new Promise(resolve => {
    if (request.signal?.aborted) { resolve({ outcome: 'aborted', exitCode: 1, output: 'Cancelled' }); return; }
    const child = spawnManaged(capability.command, capability.args, request);
    let buffer = '', output = '', bytes = 0, finished = false, sessionId;
    const send = frame => { if (!child.stdin.destroyed) child.stdin.write(JSON.stringify(frame) + '\n'); };
    const timer = setTimeout(() => finish('task_failure', 'ACP timeout'), request.timeoutMs ?? 60000);
    const abort = () => finish('aborted', 'ACP cancelled');
    request.signal?.addEventListener('abort', abort, { once: true });
    function finish(outcome, message) { if (finished) return; finished = true; clearTimeout(timer); request.signal?.removeEventListener('abort', abort); child.stdin.end(); stopProcess(child); resolve({ outcome, exitCode: outcome === 'completed' ? 0 : 1, output: message || output, mode: 'live', files: [] }); }
    child.stdin.on('error', () => {});
    child.on('error', () => finish('env_fault', 'ACP executable unavailable'));
    child.on('close', () => { if (!finished) finish('task_failure', 'ACP exited before prompt completion'); });
    child.stderr.on('data', c => { bytes += c.length; if (bytes > 1048576) finish('task_failure', 'ACP output limit'); });
    child.stdout.on('data', chunk => {
      bytes += chunk.length; if (bytes > 1048576) { finish('task_failure', 'ACP output limit'); return; }
      buffer += chunk.toString();
      for (;;) {
        const index = buffer.indexOf('\n'); if (index < 0) break;
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        if (!line.trim()) continue;
        let frame;
        try { frame = JSON.parse(line); } catch { finish('task_failure', 'Invalid ACP JSON-RPC frame'); return; }
        if (frame.error) { finish('task_failure', 'ACP returned a protocol error'); return; }
        if (frame.id === 1 && frame.result && frame.result.protocolVersion !== 1) { finish('task_failure', 'Unsupported ACP protocol version'); return; }
        if (frame.id === 1 && frame.result) send({ jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd: request.cwd, mcpServers: [] } });
        else if (frame.id === 2 && frame.result) {
          sessionId = frame.result.sessionId;
          if (typeof sessionId !== 'string' || !sessionId) { finish('task_failure', 'ACP session ID missing'); return; }
          send({ jsonrpc: '2.0', id: 3, method: 'session/prompt', params: { sessionId, prompt: [{ type: 'text', text: request.prompt || request.title || '' }] } });
        } else if (frame.id === 3 && frame.result) {
          finish(frame.result.stopReason === 'end_turn' ? 'completed' : 'task_failure', output || 'ACP prompt completed');
        } else if (frame.method === 'session/update') {
          const text = frame.params?.update?.content?.text;
          if (typeof text === 'string' && frame.params?.update?.sessionUpdate === 'agent_message_chunk') { output += text; request.onChunk?.('assistant', text); }
        } else if (frame.method === 'session/request_permission' && frame.id !== undefined) {
          const allowed = !request.readOnly && (request.permissionTier !== 'strict' || request.approved);
          const once = frame.params?.options?.find(o => o.kind === 'allow_once');
          send({ jsonrpc: '2.0', id: frame.id, result: { outcome: allowed && once ? { outcome: 'selected', optionId: once.optionId } : { outcome: 'cancelled' } } });
        } else if (frame.method && frame.id !== undefined) send({ jsonrpc: '2.0', id: frame.id, error: { code: -32601, message: 'Method unavailable' } });
      }
    });
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'VTO', version: '1.0' } } });
  });
}
