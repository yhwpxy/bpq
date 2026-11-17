import { MAX_NODES, MAX_EDGES, NODE_TYPES } from './constants.js';
import { isSafeVariable } from './schema.js';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && [...value].length <= max;
const fields = new Set(['key', 'name', 'type', 'dependsOn', 'parallelGroup', 'branch', 'expression', 'output']);
/** Validate untrusted API TaskSpec data before any graph traversal or conversion.
 * UI-only selected/removed flags and Plan fields deliberately aren't accepted.
 * Expression parsing and full executable-graph validation remain server concerns.
 */
export function validateTaskSpec(value) {
  const errors = [];
  const add = (path, message) => errors.push({ path, message });
  if (!object(value)) return [{ path: 'taskSpec', message: 'TaskSpec 必须是 JSON 对象' }];
  for (const key of Object.keys(value)) if (!['source', 'detectedFormat', 'tasks'].includes(key)) add(key, `不支持的 TaskSpec 字段：${key}`);
  if (!text(value.source, 50)) add('source', '方案名称须为 1～50 字符');
  if (!['markdown', 'numbered'].includes(value.detectedFormat)) add('detectedFormat', '格式必须是 markdown 或 numbered');
  if (!Array.isArray(value.tasks) || !value.tasks.length || value.tasks.length > MAX_NODES) {
    add('tasks', '任务清单须包含 1～100 个任务');
    return errors;
  }
  const tasks = new Map();
  let references = 0;
  for (let index = 0; index < value.tasks.length; index++) {
    const task = value.tasks[index]; const path = `tasks[${index}]`;
    if (!object(task)) { add(path, '每个任务必须是对象'); continue; }
    for (const key of Object.keys(task)) if (!fields.has(key)) add(`${path}.${key}`, `不支持的任务字段：${key}`);
    if (!text(task.key, 128) || /[\s,，]/u.test(task.key)) add(`${path}.key`, 'key 须为不含空白或逗号的唯一字符串，最长 128 字符');
    else if (tasks.has(task.key)) add(`${path}.key`, `任务编号重复：${task.key}`);
    else tasks.set(task.key, { task, index });
    if (!text(task.name, 50)) add(`${path}.name`, '任务名称须为 1～50 字符');
    if (!NODE_TYPES.includes(task.type)) add(`${path}.type`, '节点类型必须是 start、task、condition、delay 或 end');
    if (!Array.isArray(task.dependsOn) || task.dependsOn.length > MAX_NODES) add(`${path}.dependsOn`, 'dependsOn 必须是任务编号字符串数组，最多 100 项');
    else {
      references += task.dependsOn.length;
      const seen = new Set();
      task.dependsOn.forEach((dependency, position) => {
        if (!text(dependency, 128)) add(`${path}.dependsOn[${position}]`, '依赖必须是非空任务编号字符串');
        else if (seen.has(dependency)) add(`${path}.dependsOn[${position}]`, `依赖编号重复：${dependency}`);
        else if (dependency === task.key) add(`${path}.dependsOn[${position}]`, '任务不能依赖自身');
        seen.add(dependency);
      });
    }
    if (task.parallelGroup !== undefined && task.parallelGroup !== null && (!Number.isSafeInteger(task.parallelGroup) || task.parallelGroup < 1)) add(`${path}.parallelGroup`, 'parallelGroup 必须是正整数或 null');
    if (task.branch !== undefined && task.branch !== null && !['true', 'false'].includes(task.branch)) add(`${path}.branch`, 'branch 必须是字符串 true、false 或 null');
    if (task.type === 'condition' && !text(task.expression, 1000)) add(`${path}.expression`, '条件节点必须提供 1～1000 字符的 expression');
    if (task.expression !== undefined && (task.type !== 'condition' || !text(task.expression, 1000))) add(`${path}.expression`, 'expression 仅允许条件节点的非空字符串');
    if (task.output !== undefined && (task.type !== 'task' || !isSafeVariable(task.output))) add(`${path}.output`, 'output 仅允许普通任务的安全变量名');
    if (task.type === 'start' && Array.isArray(task.dependsOn) && task.dependsOn.length) add(`${path}.dependsOn`, '开始任务不能有前置依赖');
  }
  if (references > MAX_EDGES) add('tasks', '依赖数量超过 200 条边上限');
  // Invalid primitive shapes must never reach the graph walkers below.
  if (errors.length) return errors;
  for (const { task, index } of tasks.values()) {
    task.dependsOn.forEach((dependency, position) => {
      if (!tasks.has(dependency)) add(`tasks[${index}].dependsOn[${position}]`, `引用的任务不存在：${dependency}`);
    });
  }
  if (errors.length) return errors;
  const colors = new Map(); const stack = []; const reported = new Set();
  function visit(key) {
    colors.set(key, 1); stack.push(key);
    for (const dependency of tasks.get(key).task.dependsOn) {
      if (colors.get(dependency) === 1) {
        const cycle = stack.slice(stack.indexOf(dependency));
        for (const member of cycle) if (!reported.has(member)) {
          reported.add(member);
          add(`tasks[${tasks.get(member).index}].dependsOn`, `存在循环依赖：${[...cycle, dependency].join(' → ')}`);
        }
      } else if (!colors.get(dependency)) visit(dependency);
    }
    stack.pop(); colors.set(key, 2);
  }
  for (const key of tasks.keys()) if (!colors.get(key)) visit(key);
  return errors;
}
