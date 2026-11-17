import { describe, it, expect } from 'vitest';
import { tokenize, parseExpression, evaluateExpression } from '../backend/engine/expression.js';

describe('白名单表达式解析与求值', () => {
  it.each([
    ['passed == true && count >= 3', { passed: true, count: 3 }, true],
    ['passed == true && count >= 3', { passed: true, count: 2 }, false],
    ['!passed || (count > 2 && count <= 5)', { passed: false, count: 6 }, true],
    ['name == "Alice" && name != \'Bob\'', { name: 'Alice' }, true],
    ['-1.5 < count && count <= 0', { count: 0 }, true],
    ['true || false && false', {}, true],
    ['missing == true', {}, false],
    ['x == 3', { x: '3' }, false],
    ['text == "a\\nb"', { text: 'a\nb' }, true],
  ])('%s', (expression, variables, expected) => expect(evaluateExpression(expression, { variables })).toBe(expected));
  it('支持 AST 复用且不读取原型链', () => {
    const ast = parseExpression('passed == true');
    expect(evaluateExpression(ast, Object.create({ passed: true }))).toBe(false);
    expect(evaluateExpression(ast, { passed: true })).toBe(true);
  });
  it.each(['', ' ', 'foo()', 'process.exit()', 'x = true', 'x === 1', '[1]', 'a + b', 'constructor', '__proto__', 'new Function("x")', 'true;false', '(true', '"open', 'true false', '"\\u0061"'])('拒绝非法或危险表达式 %s', source => expect(() => parseExpression(source)).toThrow());
  it('限制输入长度与递归深度', () => {
    expect(() => tokenize('a'.repeat(2049))).toThrow('2048');
    expect(() => parseExpression('('.repeat(65) + 'true' + ')'.repeat(65))).toThrow('嵌套过深');
  });
});
