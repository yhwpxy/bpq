import { readLlmConfig } from '../config/llm.js';
import { validateTaskSpec } from '../../shared/taskSpecSchema.js';
import { taskSpecToPlan } from '../../shared/plan.js';
import { parseExpression } from '../engine/expression.js';
import { validatePlan } from '../engine/validator.js';
import { AppError } from './errors.js';
import { TASK_SPEC_PROMPT } from './llmPrompt.js';

const MAX_INPUT_BYTES = 200 * 1024;
const MAX_RESPONSE_BYTES = 512 * 1024;
const cancelled = () => new AppError(50201, 'AI 分解请求已取消');

function assertTaskSpecSemantics(taskSpec) {
  const issues = [];
  if (taskSpec.detectedFormat !== 'numbered') issues.push({ path: 'detectedFormat', message: 'AI 结果必须使用 numbered 编号任务结构' });
  const tasks = new Map(taskSpec.tasks.map(task => [task.key, task]));
  const ancestors = key => {
    const visited = new Set(), queue = [...tasks.get(key).dependsOn];
    while (queue.length) { const dependency = queue.pop(); if (visited.has(dependency)) continue; visited.add(dependency); queue.push(...tasks.get(dependency).dependsOn); }
    return visited;
  };
  const branchMemo = new Map();
  function nearestBranchLabels(task) {
    if (branchMemo.has(task.key)) return branchMemo.get(task.key);
    const labels = new Set();
    if (!task.dependsOn.length) labels.add(null);
    for (const key of task.dependsOn) {
      const parent = tasks.get(key);
      if (parent.type === 'condition') labels.add(task.branch ?? null);
      else for (const label of nearestBranchLabels(parent)) labels.add(label);
    }
    branchMemo.set(task.key, labels);
    return labels;
  }
  for (const [index, task] of taskSpec.tasks.entries()) {
    if (task.branch && (nearestBranchLabels(task).size !== 1 || !nearestBranchLabels(task).has(task.branch))) issues.push({ path: `tasks[${index}].branch`, message: '分支标记没有绑定到对应的上游条件分支' });
    if (task.parallelGroup != null && [...ancestors(task.key)].some(key => tasks.get(key).parallelGroup === task.parallelGroup)) issues.push({ path: `tasks[${index}].parallelGroup`, message: '同一并行组中的任务不能互相依赖' });
    if (task.type === 'start') issues.push({ path: `tasks[${index}].type`, message: 'AI 清单不应生成开始节点，开始节点由画布转换器添加' });
    if (task.type !== 'condition') continue;
    let ast;
    try { ast = parseExpression(task.expression); }
    catch { issues.push({ path: `tasks[${index}].expression`, message: '条件表达式不符合受限语法，禁止调用、赋值或属性访问' }); continue; }
    const variables = new Set();
    const visit = node => { if (node.type === 'identifier') variables.add(node.value); if (node.child) visit(node.child); if (node.left) visit(node.left); if (node.right) visit(node.right); };
    visit(ast);
    const outputs = new Set(); const visited = new Set(); const queue = [...task.dependsOn];
    while (queue.length) {
      const key = queue.pop(); if (visited.has(key)) continue; visited.add(key);
      const predecessor = tasks.get(key);
      if (predecessor.type === 'task' && predecessor.output) outputs.add(predecessor.output);
      queue.push(...predecessor.dependsOn);
    }
    for (const variable of variables) if (!outputs.has(variable)) issues.push({ path: `tasks[${index}].expression`, message: `条件变量 ${variable} 没有上游任务的 output 来源` });
  }
  if (issues.length) throw new AppError(40001, 'AI 返回的任务语义不符合要求', issues);
  let plan;
  try { plan = taskSpecToPlan(taskSpec); }
  catch (error) { throw new AppError(40001, 'AI 返回的任务无法生成有效画布', [{ path: 'tasks', message: error.message }]); }
  const errors = validatePlan(plan);
  if (errors.length) {
    const byId = new Map(plan.nodes.filter(node => node.type !== 'start').map(node => [node.id, node.props.name]));
    throw new AppError(40001, 'AI 返回的任务图未通过校验，请调整描述后重试', errors.map(error => ({ path: 'tasks', rule: error.rule, message: `${byId.get(error.nodeId) || '任务图'}：${error.message}` })));
  }
}

export async function readLimitedResponse(response, maxBytes, signal) {
  if (!response.body?.getReader) throw new AppError(50201, '模型服务返回的响应协议不受支持');
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw signal.reason;
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new AppError(50201, '模型服务返回内容过大，请缩小需求后重试');
      chunks.push(Buffer.from(value));
    }
    if (signal.aborted) throw signal.reason;
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    signal.removeEventListener('abort', abort);
    if (size > maxBytes || signal.aborted) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Configuration and fetch injection make every automated test independent of real keys/services. */
export function createLlmDecomposeService({ config = readLlmConfig(), fetchImpl = globalThis.fetch, timeoutMs = 45000, maxResponseBytes = MAX_RESPONSE_BYTES } = {}) {
  const settings = Object.freeze({ ...config });
  function status() { return settings.enabled ? { enabled: true } : { enabled: false, code: 50301, message: settings.message || 'LLM 未配置，自然语言分解暂不可用' }; }
  async function decompose(text, { signal } = {}) {
    if (!settings.enabled) throw new AppError(50301, status().message);
    if (typeof text !== 'string' || !text.trim()) throw new AppError(40001, '自然语言需求不能为空');
    if (Buffer.byteLength(text, 'utf8') > MAX_INPUT_BYTES) throw new AppError(40001, '自然语言需求超过 200KB，请缩短内容后重试');
    if (signal?.aborted) throw cancelled();
    const controller = new AbortController();
    const cancel = () => controller.abort(cancelled());
    signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => controller.abort(new AppError(50401, 'AI 分解请求超时，请稍后重试')), timeoutMs);
    let rejectAborted;
    const aborted = new Promise((_resolve, reject) => { rejectAborted = () => reject(controller.signal.reason); controller.signal.addEventListener('abort', rejectAborted, { once: true }); });
    try {
      const operation = async () => {
        const response = await fetchImpl(settings.endpoint, {
          method: 'POST', redirect: 'error', signal: controller.signal,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey}` },
          body: JSON.stringify({ model: settings.model, stream: false, messages: [{ role: 'system', content: TASK_SPEC_PROMPT }, { role: 'user', content: text.trim() }] }),
        });
        if (!response.ok) {
          void response.body?.cancel?.().catch(() => {});
          const message = response.status === 401 || response.status === 403 ? '模型服务认证失败，请检查服务器上的 API Key 和访问权限'
            : response.status === 429 ? '模型服务请求受限，请稍后重试'
              : '模型服务请求失败，请检查模型配置或稍后重试';
          throw new AppError(50201, message);
        }
        const raw = await readLimitedResponse(response, maxResponseBytes, controller.signal);
        let envelope;
        try { envelope = JSON.parse(raw); } catch { throw new AppError(50201, '模型服务未返回合法的 JSON 响应'); }
        const choice = envelope?.choices?.[0];
        if (choice?.finish_reason && choice.finish_reason !== 'stop') throw new AppError(40001, 'AI 输出未完整结束或被拒绝，请缩小需求后重试');
        const content = choice?.message?.content;
        if (typeof content !== 'string' || !content.trim()) throw new AppError(40001, 'AI 未返回任务 JSON，请调整描述后重试');
        let taskSpec;
        try { taskSpec = JSON.parse(content); } catch { throw new AppError(40001, 'AI 返回的内容不是合法 JSON，不能包含 Markdown 代码块或解释文字'); }
        const details = validateTaskSpec(taskSpec);
        if (details.length) throw new AppError(40001, 'AI 返回的 TaskSpec 结构不符合要求', details);
        assertTaskSpecSemantics(taskSpec);
        return taskSpec;
      };
      return await Promise.race([operation(), aborted]);
    } catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason;
      if (error instanceof AppError) throw error;
      // Never echo upstream response bodies, URLs, headers or arbitrary transport error messages.
      throw new AppError(50201, '无法连接模型服务，请检查网络和服务器模型配置');
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', cancel);
      controller.signal.removeEventListener('abort', rejectAborted);
    }
  }
  return { status, decompose };
}
