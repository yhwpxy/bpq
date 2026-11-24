import { AppError } from './errors.js';
import { readLimitedResponse } from './llmDecomposeService.js';
import { assertGoal } from '../engine/goalParser.js';
const PROMPT = `Extract a GoalSpec from the user's confirmed requirements. Return JSON only with title, goal, requirements, acceptanceCriteria, inputs, outputs, constraints, assumptions, modules. All collections are arrays of objects with id and text. Requirements use FR-01 IDs; acceptanceCriteria use AC-01 IDs and requirementRefs:string[]. Inputs and outputs also have name (safe ASCII identifier), type (string/number/boolean/object/array/file/any), required:boolean. Other IDs use IN/OUT/CON/ASM/MOD prefixes. Include at least one requirement and one acceptance criterion. Keep documented facts verbatim where possible. Do not claim missing information is confirmed. Do not generate executable commands. The server records provenance and validation separately.`;
export function createGoalModelService({ config, fetchImpl = globalThis.fetch, timeoutMs = 45000, maxResponseBytes = 524288 }) {
  return async function extract(text, { signal } = {}) {
    if (!config?.enabled) throw new AppError(50301, '模型未配置 / Model not configured');
    if (typeof text !== 'string' || !text.trim() || Buffer.byteLength(text) > 204800) throw new AppError(40001, '需求须为非空文本，最多 200KB');
    if (signal?.aborted) throw new AppError(50201, '请求已取消');
    const controller = new AbortController();
    const cancel = () => controller.abort(new AppError(50201, '请求已取消'));
    signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => controller.abort(new AppError(50401, '模型契约提取超时')), timeoutMs);
    let rejectAbort;
    const aborted = new Promise((_, reject) => { rejectAbort = () => reject(controller.signal.reason); controller.signal.addEventListener('abort', rejectAbort, { once: true }); });
    try {
      const operation = async () => {
        const response = await fetchImpl(config.endpoint, { method: 'POST', redirect: 'error', signal: controller.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` }, body: JSON.stringify({ model: config.model, stream: false, messages: [{ role: 'system', content: PROMPT }, { role: 'user', content: text }] }) });
        if (!response.ok) { await response.body?.cancel?.(); throw new AppError(50201, `模型服务请求失败 HTTP ${response.status}`); }
        const raw = await readLimitedResponse(response, maxResponseBytes, controller.signal);
        let data;
        try { const envelope = JSON.parse(raw), choice = envelope.choices?.[0]; if (choice?.finish_reason && choice.finish_reason !== 'stop') throw new Error(); data = JSON.parse(choice.message.content); } catch { throw new AppError(40001, '模型未返回完整 GoalSpec JSON'); }
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new AppError(40001, 'GoalSpec must be an object');
        const spec = { title: data.title, goal: data.goal, rawText: text };
        const lines = text.split(/\r?\n/);
        for (const field of ['requirements','acceptanceCriteria','inputs','outputs','constraints','assumptions','modules']) {
          if (!Array.isArray(data[field])) throw new AppError(40001, `GoalSpec missing ${field}`);
          spec[field] = data[field].map(item => {
            if (!item || typeof item !== 'object' || typeof item.text !== 'string') throw new AppError(40001, `Invalid ${field} item`);
            const line = item.text.trim() ? lines.findIndex(l => l.includes(item.text)) : -1; const source = line >= 0 ? 'doc' : 'suggested';
            const entry = { id: item.id, text: item.text, source, origin: source, sourceLine: line >= 0 ? line + 1 : null };
            if (field === 'acceptanceCriteria') entry.requirementRefs = item.requirementRefs;
            if (field === 'inputs' || field === 'outputs') Object.assign(entry, { name: item.name, type: item.type, required: item.required });
            return entry;
          });
        }
        return assertGoal(spec);
      };
      return await Promise.race([operation(), aborted]);
    } catch (e) { if (controller.signal.aborted) throw controller.signal.reason; if (e instanceof AppError) throw e; throw new AppError(50201, '模型契约提取失败，请检查配置与网络'); }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); controller.signal.removeEventListener('abort', rejectAbort); }
  };
}
