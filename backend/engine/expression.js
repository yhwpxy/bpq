/** A deliberately small expression language. AST evaluation never executes JavaScript. */
export function tokenize(source) {
  if (typeof source !== 'string' || !source.trim()) throw new Error('条件表达式不能为空');
  if (source.length > 2048) throw new Error('条件表达式不能超过 2048 字符');
  const tokens = []; let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (/\s/.test(ch)) { i++; continue; }
    const op = source.slice(i).match(/^(==|!=|>=|<=|&&|\|\||[!><()])/);
    if (op) { tokens.push({ type: 'operator', value: op[0], at: i }); i += op[0].length; continue; }
    if (ch === '"' || ch === "'") {
      const quote = ch; let value = ''; const at = i++;
      let closed = false;
      while (i < source.length) {
        const c = source[i++];
        if (c === quote) { closed = true; break; }
        if (c === '\\') {
          const escaped = source[i++];
          const escapes = { n: '\n', r: '\r', t: '\t', '\\': '\\', '"': '"', "'": "'" };
          if (!Object.hasOwn(escapes, escaped)) throw new Error(`位置 ${i} 的转义字符不受支持`);
          value += escapes[escaped];
        } else value += c;
      }
      if (!closed) throw new Error(`位置 ${at} 的字符串未闭合`);
      tokens.push({ type: 'literal', value, at }); continue;
    }
    const number = source.slice(i).match(/^-?(?:\d+(?:\.\d+)?|\.\d+)/);
    if (number) { const value = Number(number[0]); if (!Number.isFinite(value)) throw new Error('数字超出范围'); tokens.push({ type: 'literal', value, at: i }); i += number[0].length; continue; }
    const identifier = source.slice(i).match(/^[A-Za-z_$][A-Za-z0-9_$]*/);
    if (identifier) {
      const value = identifier[0];
      if (['__proto__', 'prototype', 'constructor'].includes(value)) throw new Error('表达式包含禁止的变量名');
      tokens.push({ type: ['true', 'false'].includes(value) ? 'literal' : 'identifier', value: value === 'true' ? true : value === 'false' ? false : value, at: i });
      i += value.length; continue;
    }
    throw new Error(`位置 ${i + 1} 的字符“${ch}”不受支持；禁止函数调用、赋值和属性访问`);
  }
  tokens.push({ type: 'eof', value: '', at: i }); return tokens;
}

export function parseExpression(source) {
  const tokens = tokenize(source); let cursor = 0; let depth = 0;
  const peek = () => tokens[cursor];
  const consume = (op) => { if (peek().value === op && peek().type === 'operator') { cursor++; return true; } return false; };
  function primary() {
    if (++depth > 64) throw new Error('表达式嵌套过深');
    let result;
    if (consume('!')) result = { type: 'not', child: primary() };
    else if (consume('(')) { result = or(); if (!consume(')')) throw new Error('缺少右括号'); }
    else {
      const token = peek();
      if (!['literal', 'identifier'].includes(token.type)) throw new Error(`位置 ${token.at + 1} 缺少变量或字面量`);
      cursor++; result = { type: token.type, value: token.value };
    }
    depth--; return result;
  }
  function binary(next, operators) {
    let left = next();
    while (peek().type === 'operator' && operators.includes(peek().value)) {
      const operator = tokens[cursor++].value;
      left = { type: 'binary', operator, left, right: next() };
    }
    return left;
  }
  const comparison = () => binary(primary, ['>', '<', '>=', '<=']);
  const equality = () => binary(comparison, ['==', '!=']);
  const and = () => binary(equality, ['&&']);
  const or = () => binary(and, ['||']);
  const ast = or();
  if (peek().type !== 'eof') throw new Error(`位置 ${peek().at + 1} 存在多余内容；禁止函数调用或赋值`);
  return ast;
}

export function evaluateExpression(expression, context = {}) {
  const ast = typeof expression === 'string' ? parseExpression(expression) : expression;
  const variables = context.variables ?? context;
  function visit(node) {
    if (node.type === 'literal') return node.value;
    if (node.type === 'identifier') return Object.hasOwn(variables, node.value) ? variables[node.value] : undefined;
    if (node.type === 'not') return !visit(node.child);
    if (node.type !== 'binary') throw new Error('无效的表达式语法树');
    const left = visit(node.left);
    if (node.operator === '&&') return Boolean(left) && Boolean(visit(node.right));
    if (node.operator === '||') return Boolean(left) || Boolean(visit(node.right));
    const right = visit(node.right);
    switch (node.operator) {
      case '==': return left === right;
      case '!=': return left !== right;
      case '>': return left > right;
      case '<': return left < right;
      case '>=': return left >= right;
      case '<=': return left <= right;
      default: throw new Error('不支持的运算符');
    }
  }
  return Boolean(visit(ast));
}
