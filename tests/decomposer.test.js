import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decompose, keywordRules } from '../backend/engine/decomposer.js';

const example = readFileSync(new URL('../examples/login-spec.md', import.meta.url), 'utf8');
const expected = JSON.parse(readFileSync(new URL('../examples/appendix-task-spec.json', import.meta.url), 'utf8'));
const names = (spec) => spec.tasks.map((task) => task.name);

function parseError(text, message, format) {
  let captured;
  try { decompose(text, format); } catch (error) { captured = error; }
  expect(captured).toBeInstanceOf(Error);
  expect(captured.code).toBe(40003);
  expect(captured.message).toMatch(message);
}

describe('TC-01 / TC-02 — specification decomposition contract', () => {
  it('identifies appendix A and matches every §6.5 field exactly', () => {
    expect(decompose(example)).toEqual(expected);
  });

  it('preserves two initial parallel tasks, join, output, condition and branch chains', () => {
    const { tasks } = decompose(example);
    expect(tasks).toHaveLength(9);
    expect(tasks.filter((task) => task.parallelGroup === 1).map((task) => task.key)).toEqual(['1.1', '1.2']);
    expect(tasks[2].dependsOn).toEqual(['1.1', '1.2']);
    expect(tasks[3].output).toBe('passed');
    expect(tasks[4].expression).toBe('passed == true');
    expect(tasks[6].dependsOn).toEqual(['3.2']);
    expect(tasks[7].dependsOn).toEqual(['3.1']);
    expect(tasks[8].dependsOn).toEqual(['3.3', '3.4']);
  });

  it('accepts CRLF, BOM, blank lines and fullwidth punctuation', () => {
    expect(decompose(`\uFEFF\r\n${example.replaceAll('\n', '\r\n')}`)).toEqual(expected);
    const fullwidth = example.replace('## 1', '＃＃ １').replace('## 2', '＃＃ ２').replace('## 3', '＃＃ ３');
    expect(decompose(fullwidth)).toEqual(expected);
  });

  it('recognizes Chinese sections and locally numbered children', () => {
    const result = decompose('用户登录功能\n一、输入校验\n1. 并行：校验用户名格式\n2. 校验密码非空\n二、身份认证\n1. 查询用户信息\n2. 比对密码哈希\n三、结果处理\n1. 判断：认证是否通过\n2. 记录登录日志（通过时）\n3. 生成会话令牌（通过时）\n4. 返回错误提示（未通过时）\n5. 输出登录结果');
    expect(result).toEqual({ ...expected, detectedFormat: 'numbered' });
  });

  it('recognizes decimal numbered parent/child dependencies', () => {
    const { tasks } = decompose('1. 获取输入\n1.1 检查格式\n1.2 检查长度\n2. 保存数据');
    expect(tasks.map((task) => task.key)).toEqual(['1', '1.1', '1.2', '2']);
    expect(tasks[1].dependsOn).toEqual(['1']);
    expect(tasks[2].dependsOn).toEqual(['1.1']);
    expect(tasks[3].dependsOn).toEqual(['1.2']);
  });

  it('keeps local decimal descendants distinct from Chinese section prefixes', () => {
    const { tasks } = decompose('一、流程\n1. 第一项\n1.1 子项目\n1.2 另一子项\n2. 第二项\n二、收尾\n2.1 归档\n2.2 结束');
    expect(tasks.map((task) => task.key)).toEqual(['1.1', '1.1.1', '1.1.2', '1.2', '2.1', '2.2']);
    expect(tasks[1].dependsOn).toEqual(['1.1']);
    expect(tasks[3].dependsOn).toEqual(['1.1.2']);
    expect(tasks[4].dependsOn).toEqual(['1.2']);
  });

  it('accepts decimal numbering inside Markdown and retains hierarchy', () => {
    const { tasks } = decompose('# 混合规格\n## 操作\n1. 检查\n1.1 检查格式\n1.2 检查长度\n2. 处理\n## 完成\n- 结束');
    expect(tasks.map((task) => task.key)).toEqual(['1.1', '1.1.1', '1.1.2', '1.2', '2.1']);
    expect(tasks[1].dependsOn).toEqual(['1.1']);
    expect(tasks[3].dependsOn).toEqual(['1.1.2']);
  });

  it('supports English-only Markdown without requiring Chinese keywords', () => {
    const result = decompose('# Login flow\n## Validation\n- Check username\n- Check password\n## Authentication\n- Fetch user\n- Compare hash');
    expect(result.detectedFormat).toBe('markdown');
    expect(result.source).toBe('Login flow');
    expect(names(result)).toEqual(['Check username', 'Check password', 'Fetch user', 'Compare hash']);
    expect(result.tasks[2].dependsOn).toEqual(['1.2']);
  });

  it('treats descriptive headings as containers and nested list items as tasks', () => {
    const { tasks } = decompose('# 项目\n## 模块\n### 子模块\n- 创建记录\n  - 检查记录\n  - 归档记录\n#### 总结\n- 结束流程');
    expect(tasks.map((task) => task.key)).toEqual(['1.1.1', '1.1.1.1', '1.1.1.2', '1.1.2.1']);
    expect(tasks[1].dependsOn).toEqual(['1.1.1']);
    expect(tasks[2].dependsOn).toEqual(['1.1.1.1']);
    expect(tasks[3].dependsOn).toEqual(['1.1.1.2']);
  });

  it.each(['并行：', '同时', '分别'])('registers parallel rule %s and joins all siblings', (marker) => {
    const { tasks } = decompose(`# Demo\n## Work\n- ${marker}检查 A\n- 检查 B\n- 检查 C\n## Finish\n- 输出结果`);
    expect(tasks.slice(0, 3).map((task) => task.parallelGroup)).toEqual([1, 1, 1]);
    expect(tasks.slice(0, 3).every((task) => task.dependsOn.length === 0)).toBe(true);
    expect(tasks[3].dependsOn).toEqual(['1.1', '1.2', '1.3']);
  });

  it.each(['等待', '延时', '延迟'])('maps delay keyword %s without inventing TaskSpec fields', (keyword) => {
    const result = decompose(`# 测试\n- ${keyword} 200 毫秒\n- 结束`);
    expect(result.tasks[0].type).toBe('delay');
    expect(result.tasks[0]).not.toHaveProperty('wait');
  });

  it.each(['如果', '否则', '判断：', '是否'])('maps condition keyword %s', (keyword) => {
    const { tasks } = decompose(`# 示例\n- 检查输入\n- ${keyword}有效\n- 执行成功路径（通过时）\n- 执行失败路径（未通过时）\n- 提交`);
    expect(tasks[1].type).toBe('condition');
    expect(tasks[0].output).toBe('passed');
    expect(tasks[4].type).toBe('end');
  });

  it('keeps branch order independent from document order', () => {
    const { tasks } = decompose('# 规格\n- 检查输入\n- 判断：有效\n- 返回错误（未通过时）\n- 成功处理（通过时）\n- 记录结果（通过时）\n- 输出');
    expect(tasks[2].dependsOn).toEqual(['2']);
    expect(tasks[3].dependsOn).toEqual(['2']);
    expect(tasks[4].dependsOn).toEqual(['4']);
    expect(tasks[5].dependsOn).toEqual(['5', '3']);
  });

  it('supports action headings and condition children', () => {
    const { tasks } = decompose('# 规格\n## 准备\n- 检查\n## 判断：通过\n- 正确处理（通过时）\n- 错误处理（未通过时）\n## 输出结果');
    expect(tasks.map((task) => task.type)).toEqual(['task', 'condition', 'task', 'task', 'end']);
    expect(tasks[2].dependsOn).toEqual(['2']);
    expect(tasks[3].dependsOn).toEqual(['2']);
    expect(tasks[4].dependsOn).toEqual(['2.1', '2.2']);
  });

  it('binds suffixes across descriptive section boundaries to the nearest condition', () => {
    const { tasks } = decompose('# 规格\n## 检查阶段\n- 检查输入\n- 判断：有效\n## 结果处理\n- 正确处理（通过时）\n- 错误处理（未通过时）\n## 完成\n- 输出结果');
    expect(tasks[2].dependsOn).toEqual(['1.2']);
    expect(tasks[3].dependsOn).toEqual(['1.2']);
    expect(tasks[4].dependsOn).toEqual(['2.1', '2.2']);
  });

  it('uses different context output variables for sequential conditions', () => {
    const { tasks } = decompose('# 规格\n- 检查 A\n- 判断：A有效\n- A成功（通过时）\n- A失败（未通过时）\n- 检查 B\n- 判断：B有效\n- B成功（通过时）\n- B失败（未通过时）\n- 输出');
    expect(tasks[1].expression).toBe('passed == true');
    expect(tasks[5].expression).toBe('passed_2 == true');
    expect(tasks[4].output).toBe('passed_2');
  });

  it('initializes a following condition from whichever prior branch executes', () => {
    const { tasks } = decompose('# 规格\n- 检查 A\n- 判断：A有效\n- A成功（通过时）\n- A失败（未通过时）\n- 判断：再次检查\n- B成功（通过时）\n- B失败（未通过时）\n- 输出');
    expect(tasks[0].output).toBe('passed');
    expect(tasks[2].output).toBe('passed_2');
    expect(tasks[3].output).toBe('passed_2');
    expect(tasks[4].dependsOn).toEqual(['3', '4']);
  });

  it('ignores fenced code and narrative prose', () => {
    const { tasks } = decompose('# 文档\n说明段落不产生节点\n```md\n## 假标题\n- 假任务\n```\n## 真正任务\n- 检查');
    expect(tasks.map((task) => task.name)).toEqual(['检查']);
  });

  it('allows exactly 200KB and rejects oversized UTF-8 input', () => {
    const base = '# Example\n- Check\n';
    const input = base + 'a'.repeat(200 * 1024 - Buffer.byteLength(base));
    expect(decompose(input).tasks).toHaveLength(1);
    parseError(input + 'a', /200KB/);
    parseError('# 示例\n- 检查\n' + '中'.repeat(70_000), /200KB/);
  });

  it.each(['', ' \n\t', null, 123])('rejects empty or non-string input %#', (input) => {
    parseError(input, /不能为空/);
  });

  it('rejects unrecognized plain prose with a helpful message', () => {
    parseError('Build a login screen and authenticate the user.', /无法识别规格格式/);
  });

  it.each([
    '1. 检查\n1. 再检查',
    '# 规格\n## 1 输入\n- 检查\n## 1 认证\n- 比对',
    '一、输入\n1. 检查\n1. 比对',
    '# 规格\n1. 检查\n1. 比对',
  ])('rejects duplicate numbering %#', (input) => {
    parseError(input, /编号.*重复/);
  });

  it('rejects orphan branch suffixes', () => {
    parseError('# 规格\n- 记录日志（通过时）', /分支后缀未绑定/);
    parseError('# 规格\n- 返回错误（未通过时）', /分支后缀未绑定/);
  });

  it('rejects oversized names, duplicate ends and node limit violations', () => {
    parseError('# 规格\n- ' + '名'.repeat(51), /50/);
    parseError('# 规格\n- 输出日志\n- 提交结果', /唯一收敛点/);
    parseError('# 规格\n' + Array.from({ length: 99 }, (_, index) => `- 任务${index}`).join('\n'), /100 节点/);
  });

  it('accepts explicit formats and rejects unsupported or mismatched formats', () => {
    expect(decompose(example, 'markdown')).toEqual(expected);
    expect(decompose('1. 检查', 'numbered').detectedFormat).toBe('numbered');
    parseError(example, /不支持的格式/, 'html');
    parseError('plain text', /无法识别 Markdown/, 'markdown');
    parseError('plain text', /无法识别编号/, 'numbered');
  });

  it('exposes a stable rule registry for the four keyword families', () => {
    expect(keywordRules.map((rule) => rule.kind)).toEqual(['parallel', 'condition', 'delay', 'end']);
  });
});
