/**
 * Deterministic specification decomposition (design contract §5.3 and §6.5).
 * Headings are containers; list items and numbered items are executable entries.
 * An action keyword makes a heading executable, so its children depend on it.
 * No network, UI, code execution, or login-specific name matching is involved.
 */
const MAX_BYTES = 200 * 1024;

export const keywordRules = Object.freeze([
  { kind: 'parallel', pattern: /并行\s*:|同时|分别/ },
  { kind: 'condition', pattern: /如果|否则|判断|是否/ },
  { kind: 'delay', pattern: /等待|延时|延迟/ },
  { kind: 'end', pattern: /结束|输出|提交/ },
]);

function fail(message, line) {
  const error = new Error(line ? `第 ${line} 行：${message}` : message);
  error.code = 40003;
  error.status = 400;
  throw error;
}

function classify(text) {
  const matched = keywordRules.filter((rule) => rule.pattern.test(text));
  const suffix = text.match(/\((未通过时|通过时)\)\s*$/);
  const branch = suffix ? (suffix[1] === '通过时' ? 'true' : 'false') : undefined;
  const type = matched.find((rule) => rule.kind !== 'parallel')?.kind || 'task';
  const name = text
    .replace(/\((?:未通过时|通过时)\)\s*$/, '')
    .replace(/^(?:并行|同时|分别)\s*:?\s*/, '')
    .replace(/^判断\s*:\s*/, '')
    .trim();
  return { type, name, branch, parallel: matched.some((rule) => rule.kind === 'parallel') };
}

function chineseNumber(value) {
  const digits = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 两: 2 };
  let total = 0;
  let digit = 0;
  for (const character of value) {
    if (character === '十' || character === '百') {
      total += (digit || 1) * (character === '十' ? 10 : 100);
      digit = 0;
    } else digit = digits[character] ?? 0;
  }
  return String(total + digit);
}

function numberPrefix(text) {
  const chinese = text.match(/^([一二三四五六七八九十百零两]+)、\s*(.+)$/);
  if (chinese) return { number: chineseNumber(chinese[1]), title: chinese[2], chinese: true };
  const decimal = text.match(/^(\d+(?:\.\d+)*)(?:[.)、]\s*|\s+)(.+)$/);
  if (decimal) return { number: decimal[1].split('.').map(Number).join('.'), title: decimal[2], chinese: false };
  return null;
}

function node(title, kind, line, number) {
  return { title, kind, line, number, children: [], key: '', ...classify(title) };
}

function markdownTree(lines) {
  const root = node('', 'root', 0);
  const headings = [];
  let bullets = [];
  let firstHeading;
  let fenced = false;
  for (const { text, line } of lines) {
    if (/^\s*(```|~~~)/.test(text)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const heading = text.match(/^\s{0,3}(#{1,4})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const title = heading[2].replace(/\s+#+\s*$/, '').trim();
      const numbered = numberPrefix(title);
      const item = node(numbered?.title ?? title, 'heading', line, numbered?.number);
      item.level = level;
      while (headings.length && headings.at(-1).level >= level) headings.pop();
      (headings.at(-1) ?? root).children.push(item);
      headings.push(item);
      firstHeading ??= item;
      bullets = [];
      continue;
    }
    const bullet = text.match(/^(\s*)[-*+]\s+(.+)$/);
    const numbered = bullet ? null : numberPrefix(text.trim());
    if (!bullet && !numbered) continue; // Narrative paragraphs are descriptions, not extra tasks.
    const indent = text.length - text.trimStart().length;
    const item = node(bullet ? bullet[2] : numbered.title, 'list', line, numbered?.number);
    item.indent = indent;
    const ancestor = numbered && [...bullets].reverse().find((entry) => entry.rawNumber && numbered.number.startsWith(`${entry.rawNumber}.`));
    if (ancestor) {
      while (bullets.at(-1) !== ancestor) bullets.pop();
      item.numberParent = ancestor;
      item.numberSuffix = numbered.number.slice(ancestor.rawNumber.length);
    } else {
      while (bullets.length && bullets.at(-1).indent >= indent) bullets.pop();
    }
    if (numbered) item.rawNumber = numbered.number;
    (bullets.at(-1) ?? headings.at(-1) ?? root).children.push(item);
    bullets.push(item);
  }
  if (!firstHeading) fail('无法识别 Markdown 标题，请使用 # 至 #### 标题。');
  // A single opening H1 is the document title, rather than a workflow task.
  if (root.children.length === 1 && firstHeading.level === 1 && firstHeading.children.length) {
    firstHeading.kind = 'root';
    firstHeading.number = undefined;
    return { root: firstHeading, source: firstHeading.title };
  }
  return { root, source: firstHeading.title };
}

function numberedTree(lines) {
  const root = node('', 'root', 0);
  const stack = [];
  let currentChinese;
  let source;
  let found = false;
  let bullets = [];
  for (const { text, line } of lines) {
    const prefix = numberPrefix(text.trim());
    if (prefix) {
      found = true;
      const parts = prefix.number.split('.');
      let number = prefix.number;
      let level = parts.length;
      if (prefix.chinese) {
        currentChinese = prefix.number;
        level = 1;
      } else if (currentChinese) {
        // Under Chinese sections, `1.` is local. A following `1.1` is
        // its child, rather than a duplicate of the generated section key.
        // A standalone `2.1` under `二、` remains a fully qualified key.
        const ancestor = [...stack].reverse().find((item) => item.rawNumber && prefix.number.startsWith(`${item.rawNumber}.`));
        if (ancestor) {
          number = ancestor.number + prefix.number.slice(ancestor.rawNumber.length);
          level = ancestor.level + parts.length - ancestor.rawNumber.split('.').length;
        } else {
          number = parts.length > 1 && parts[0] === currentChinese
            ? prefix.number : `${currentChinese}.${prefix.number}`;
          level = number.split('.').length;
        }
      }
      const item = node(prefix.title, prefix.chinese ? 'heading' : 'numbered', line, number);
      item.level = level;
      if (!prefix.chinese) item.rawNumber = prefix.number;
      while (stack.length && stack.at(-1).level >= level) stack.pop();
      (stack.at(-1) ?? root).children.push(item);
      stack.push(item);
      bullets = [];
      continue;
    }
    const bullet = text.match(/^(\s*)[-*+]\s+(.+)$/);
    if (bullet && stack.length) {
      const item = node(bullet[2], 'list', line);
      item.indent = bullet[1].length;
      while (bullets.length && bullets.at(-1).indent >= item.indent) bullets.pop();
      (bullets.at(-1) ?? stack.at(-1)).children.push(item);
      bullets.push(item);
    } else if (!found && !source) source = text.trim();
  }
  if (!found) fail('无法识别编号，请使用“一、”“1.”或“1.1”结构。');
  return { root, source: source || '编号规格' };
}

function assignKeys(root) {
  const occupied = new Map();
  function visit(parent, prefix = '') {
    parent.children.forEach((item, index) => {
      const raw = item.number ?? String(index + 1);
      item.key = item.numberParent ? `${item.numberParent.key}${item.numberSuffix}`
        : raw.includes('.') || !prefix ? raw : `${prefix}.${raw}`;
      if (occupied.has(item.key)) fail(`编号 ${item.key} 重复（首次位于第 ${occupied.get(item.key)} 行），请为条目使用唯一编号。`, item.line);
      occupied.set(item.key, item.line);
      visit(item, item.key);
    });
  }
  visit(root);
}

const unique = (values) => [...new Set(values)];
const isContainer = (item) => item.kind === 'root' || (item.kind === 'heading' && item.children.length > 0 && item.type === 'task' && !item.branch);

function compile(root) {
  const tasks = [];
  let groupNumber = 0;
  let conditionNumber = 0;

  function emit(item, dependencies, branch, group) {
    if (!item.name) fail('任务名不能为空。', item.line);
    if ([...item.name].length > 50) fail('任务名不能超过 50 个字符，请缩短标题。', item.line);
    const task = { key: item.key, name: item.name, type: item.type, dependsOn: unique(dependencies) };
    if (branch) task.branch = branch;
    else if (item.type === 'task' || item.type === 'delay') task.parallelGroup = group ?? null;
    if (group != null) task.parallelGroup = group;
    if (item.type === 'condition') {
      conditionNumber += 1;
      const variable = conditionNumber === 1 ? 'passed' : `passed_${conditionNumber}`;
      task.expression = `${variable} == true`;
      // Write the default result on each nearest upstream simulated task. At
      // a previous condition's join, either branch may be the active one.
      const visited = new Set();
      const provide = (key) => {
        if (visited.has(key)) return;
        visited.add(key);
        const predecessor = tasks.find((candidate) => candidate.key === key);
        if (!predecessor) return;
        if (predecessor.type === 'task') predecessor.output = variable;
        else predecessor.dependsOn.forEach(provide);
      };
      dependencies.forEach(provide);
    }
    tasks.push(task);
    return task;
  }

  function frameFor(task) {
    return { key: task.key, tails: { true: [task.key], false: [task.key] }, seen: new Set() };
  }

  function finish(frame) {
    if (!frame) return [];
    // Missing branches remain visible in the preview and are rejected by R4
    // before execution; the parser does not invent unnamed business tasks.
    return unique([...frame.tails.true, ...frame.tails.false]);
  }

  function processItem(item, dependencies, branch, group, inheritedFrame = null) {
    if (isContainer(item)) return processList(item.children, dependencies, inheritedFrame, item.parallel, branch);
    const task = emit(item, dependencies, branch, group);
    if (item.children.length) {
      return processList(item.children, [task.key], item.type === 'condition' ? frameFor(task) : null, item.parallel, branch);
    }
    return { frontier: [task.key], frame: item.type === 'condition' ? frameFor(task) : null };
  }

  function processList(items, dependencies, inheritedFrame = null, forceParallel = false, inheritedBranch) {
    let frontier = [...dependencies];
    let frame = inheritedFrame;
    for (let index = 0; index < items.length;) {
      const item = items[index];
      if (item.branch) {
        if (!frame) fail('分支后缀未绑定到条件节点，请在这些条目前添加“判断：…”条件。', item.line);
        const result = processItem(item, frame.tails[item.branch], item.branch);
        frame.tails[item.branch] = result.frame ? finish(result.frame) : result.frontier;
        frame.seen.add(item.branch);
        index += 1;
        continue;
      }
      // Container headings do not close the nearest open condition. A branch
      // may be written in the next section and must still bind to that node.
      if (isContainer(item)) {
        const result = processItem(item, frontier, inheritedBranch, undefined, frame);
        frontier = result.frontier;
        frame = result.frame;
        index += 1;
        continue;
      }
      if (frame) { frontier = finish(frame); frame = null; }
      // Parallel directives affect the contiguous sibling task block. A
      // condition, branch suffix, or end is a boundary, never a hidden gateway.
      const eligible = (candidate) => !isContainer(candidate) && !candidate.branch && !['condition', 'end'].includes(candidate.type);
      let end = index;
      while (end < items.length && eligible(items[end])) end += 1;
      const block = items.slice(index, end);
      if (block.length > 1 && (forceParallel || block.some((candidate) => candidate.parallel))) {
        const group = ++groupNumber;
        frontier = unique(block.flatMap((candidate) => {
          const result = processItem(candidate, frontier, inheritedBranch, group);
          return result.frame ? finish(result.frame) : result.frontier;
        }));
        index = end;
        continue;
      }
      const result = processItem(item, frontier, inheritedBranch);
      frontier = result.frontier;
      frame = result.frame;
      index += 1;
    }
    return { frontier, frame };
  }

  processList(root.children, [], null, root.parallel);
  if (!tasks.length) fail('未找到可分解的任务，请在标题下添加列表项或编号条目。');
  const ends = tasks.filter((task) => task.type === 'end');
  if (ends.length > 1) fail(`检测到 ${ends.length} 个结束条目，请将“结束 / 输出 / 提交”合并为唯一收敛点。`);
  if (tasks.length + 1 + (ends.length ? 0 : 1) > 100) fail('任务数量超过 100 节点上限，请拆分规格。');
  return tasks;
}

/** @returns {{source:string, detectedFormat:'markdown'|'numbered', tasks:Array}} */
export function decompose(text, format = 'auto') {
  if (typeof text !== 'string' || !text.trim()) fail('规格文本不能为空，请粘贴内容或上传 .md/.txt 文件。');
  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) fail('规格文件超过 200KB，请缩短内容后重试。');
  if (!['auto', 'markdown', 'numbered'].includes(format)) fail('不支持的格式，仅支持 auto、markdown、numbered。');
  const lines = text.replace(/^\uFEFF/, '').normalize('NFKC').replace(/\r\n?/g, '\n').replace(/\t/g, '    ')
    .split('\n').map((value, index) => ({ text: value.trimEnd(), line: index + 1 })).filter(({ text: value }) => value.trim());
  const markdown = lines.some(({ text: value }) => /^\s{0,3}#{1,4}\s+\S/.test(value));
  const numbered = lines.some(({ text: value }) => numberPrefix(value.trim()));
  const detectedFormat = format === 'auto' ? (markdown ? 'markdown' : numbered ? 'numbered' : null) : format;
  if (!detectedFormat) fail('无法识别规格格式，请使用 Markdown 标题（#～####）或编号（一、 / 1. / 1.1）。');
  const { root, source } = detectedFormat === 'markdown' ? markdownTree(lines) : numberedTree(lines);
  assignKeys(root);
  const sourceName = /[\u3400-\u9fff]/u.test(source) && !/规格$/.test(source) ? `${source}规格` : source;
  return { source: sourceName, detectedFormat, tasks: compile(root) };
}
