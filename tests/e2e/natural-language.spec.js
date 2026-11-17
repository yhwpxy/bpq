import { test, expect } from '@playwright/test';
import { LOGIN_SPEC } from '../../shared/example.js';

// UI tests substitute the decomposition response only. Plan saving, validation,
// execution and logging still use the actual backend. Provider HTTP coverage is
// separate so these tests never need a personal API key or a billable request.
const text = '帮我做一个登录功能，用户输入账号密码，后端校验，成功跳转首页，失败提示错误，并记录审计日志。';
const taskSpec = {
  source: '登录流程', detectedFormat: 'numbered', tasks: [
    { key: '1', name: '输入账号密码', type: 'task', dependsOn: [], parallelGroup: null },
    { key: '2', name: '校验账号密码', type: 'task', dependsOn: ['1'], output: 'passed' },
    { key: '3', name: '校验是否通过', type: 'condition', dependsOn: ['2'], expression: 'passed == true' },
    { key: '4', name: '跳转首页', type: 'task', dependsOn: ['3'], branch: 'true' },
    { key: '5', name: '提示错误', type: 'task', dependsOn: ['3'], branch: 'false' },
    { key: '6', name: '记录审计日志', type: 'task', dependsOn: ['1'] },
    { key: '7', name: '结束登录流程', type: 'end', dependsOn: ['4', '5', '6'] },
  ],
};
const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
async function availability(page, status = { enabled: true }) {
  await page.route('**/api/decompose-nl/status', route => route.fulfill(json(status)));
}
async function openNatural(page) {
  await page.goto('/');
  await page.getByRole('button', { name: '导入规格', exact: true }).click();
  await page.getByRole('tab', { name: /自然语言/ }).click();
}
async function cleanup(page) {
  const draft = await page.evaluate(() => JSON.parse(localStorage.getItem('vto.plan.draft.v1') || 'null'));
  const run = await page.evaluate(() => JSON.parse(localStorage.getItem('vto.run.v1') || 'null'));
  if (run?.runId) await page.request.post(`/api/runs/${run.runId}/cancel`);
  if (draft?.plan?.id) await page.request.delete(`/api/plans/${draft.plan.id}`);
}

test('自然语言复用确认表：编辑名称与依赖、生成画布、执行并显示日志', async ({ page }) => {
  const errors = []; const requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await availability(page);
  await page.route('**/api/decompose-nl', async route => { requests.push(route.request().postDataJSON()); await route.fulfill(json({ ok: true, taskSpec })); });
  await openNatural(page);
  try {
    await expect(page.getByText('AI 已配置', { exact: true })).toBeVisible();
    await page.locator('#nl-text').fill(text);
    await page.getByRole('button', { name: 'AI 分解', exact: true }).click();
    await expect(page.getByText('AI 分解结果', { exact: true })).toBeVisible();
    await expect(page.locator('.task-table')).toHaveCount(1);
    await expect(page.locator('.task-table tbody tr')).toHaveCount(7);
    await page.locator('.preview-name input').fill(`AI E2E ${Date.now()}`);
    await page.getByRole('textbox', { name: '2 名称', exact: true }).fill('验证用户凭据');
    await page.getByRole('textbox', { name: '6 依赖', exact: true }).fill('2');
    await page.getByRole('textbox', { name: '6 依赖', exact: true }).press('Tab');
    await page.getByRole('button', { name: '确认并生成画布', exact: true }).click();
    await expect(page.locator('.x6-node')).toHaveCount(8);
    await expect(page.locator('.x6-node').filter({ hasText: '验证用户凭据' })).toHaveCount(1);
    await page.getByRole('button', { name: '执行编排', exact: true }).click();
    await expect(page.locator('.canvas-run-badge')).toContainText('执行成功', { timeout: 15000 });
    const draft = await page.evaluate(() => JSON.parse(localStorage.getItem('vto.plan.draft.v1')));
    const savedRun = await page.evaluate(() => JSON.parse(localStorage.getItem('vto.run.v1')));
    const run = await (await page.request.get(`/api/runs/${savedRun.runId}`)).json();
    const validation = draft.plan.nodes.find(n => n.props.name === '验证用户凭据');
    const audit = draft.plan.nodes.find(n => n.props.name === '记录审计日志');
    expect(draft.plan.edges.some(e => e.source === validation.id && e.target === audit.id)).toBe(true);
    expect(run.status).toBe('SUCCESS');
    expect(Object.values(run.nodeStates).filter(state => state.status === 'SKIPPED')).toHaveLength(1);
    await expect(page.locator('.log-panel')).toContainText('执行成功');
    expect(requests).toEqual([{ text }]);
    expect(errors).toEqual([]);
  } finally { await cleanup(page); }
});

test('未配置 API Key 时禁用 AI，结构化规格仍可正常分解', async ({ page }) => {
  let requests = 0;
  await availability(page, { enabled: false, code: 50301, message: '未配置 LLM_API_KEY' });
  await page.route('**/api/decompose-nl', route => { requests++; return route.fulfill(json({ code: 50301, message: '未配置 LLM_API_KEY' }, 503)); });
  await openNatural(page);
  await expect(page.getByRole('button', { name: 'AI 分解', exact: true })).toBeDisabled();
  await expect(page.locator('.ai-availability')).toContainText('未配置 LLM_API_KEY');
  await page.getByRole('tab', { name: /结构化规格/ }).click();
  await page.locator('#spec-text').fill(LOGIN_SPEC);
  await page.getByRole('button', { name: '开始分解', exact: true }).click();
  await expect(page.getByText('Markdown 已识别', { exact: true })).toBeVisible();
  await expect(page.locator('.task-table tbody tr')).toHaveCount(9);
  expect(requests).toBe(0);
});

for (const error of [
  { code: 40001, status: 400, message: 'AI 返回的 JSON 无法解析，请重试。' },
  { code: 50201, status: 502, message: '模型服务暂时不可用，请稍后重试。' },
  { code: 50301, status: 503, message: '未配置 LLM_API_KEY' },
]) {
  test(`AI 失败显示可读信息并保持输入：${error.code}`, async ({ page }) => {
    await availability(page);
    await page.route('**/api/decompose-nl', route => route.fulfill(json(error, error.status)));
    await openNatural(page);
    await page.locator('#nl-text').fill(text);
    await page.getByRole('button', { name: 'AI 分解', exact: true }).click();
    await expect(page.locator('.parse-error')).toContainText(error.message);
    await expect(page.locator('#nl-text')).toHaveValue(text);
    await expect(page.locator('.task-table')).toHaveCount(0);
    if (error.code === 50301) await expect(page.getByRole('button', { name: 'AI 分解', exact: true })).toBeDisabled();
    else await expect(page.getByRole('button', { name: 'AI 分解', exact: true })).toBeEnabled();
  });
}

test('切换模式取消 AI 等待，迟到结果不覆盖规则输入', async ({ page }) => {
  let received; const requested = new Promise(resolve => { received = resolve; });
  let release; const gate = new Promise(resolve => { release = resolve; });
  await availability(page);
  await page.route('**/api/decompose-nl', async route => {
    received(); await gate;
    await route.fulfill(json({ ok: true, taskSpec })).catch(() => {});
  });
  await openNatural(page);
  await page.locator('#nl-text').fill(text);
  await page.getByRole('button', { name: 'AI 分解', exact: true }).click();
  await requested;
  await expect(page.getByRole('button', { name: 'AI 分解中…', exact: true })).toBeDisabled();
  await page.getByRole('tab', { name: /结构化规格/ }).click();
  release();
  await page.locator('#spec-text').fill(LOGIN_SPEC);
  await page.getByRole('button', { name: '开始分解', exact: true }).click();
  await expect(page.getByText('Markdown 已识别', { exact: true })).toBeVisible();
  await expect(page.getByText('AI 分解结果', { exact: true })).toHaveCount(0);
  await expect(page.locator('.task-table tbody tr')).toHaveCount(9);
});

test('重新检查配置可启用 AI，空需求不发请求', async ({ page }) => {
  let checks = 0, requests = 0;
  await page.route('**/api/decompose-nl/status', route => route.fulfill(json(++checks === 1 ? { enabled: false, code: 50301, message: '未配置 LLM_MODEL' } : { enabled: true })));
  await page.route('**/api/decompose-nl', route => { requests++; return route.fulfill(json({ ok: true, taskSpec })); });
  await openNatural(page);
  await expect(page.getByRole('button', { name: 'AI 分解', exact: true })).toBeDisabled();
  await expect(page.locator('.ai-availability')).toContainText('未配置 LLM_MODEL');
  await page.getByRole('button', { name: '重新检查', exact: true }).click();
  await expect(page.getByRole('button', { name: 'AI 分解', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'AI 分解', exact: true }).click();
  await expect(page.locator('.parse-error')).toContainText('请描述你希望完成的需求');
  expect(requests).toBe(0);
});
