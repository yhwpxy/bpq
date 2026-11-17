import { test, expect } from '@playwright/test';

const now = () => new Date().toISOString();
function makePlan(name, props = {}) {
  const id = `plan_browser_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return { id, name, version: '1.0', createdAt: now(), updatedAt: now(), meta: { maxConcurrency: 3, continueOnError: false }, nodes: [
    { id: 'start', type: 'start', x: 240, y: 60, props: {} },
    { id: 'work', type: 'task', x: 240, y: 180, props: { name: '演示任务', duration: 100, retry: 0, failRate: 0, ...props } },
    { id: 'downstream', type: 'task', x: 240, y: 300, props: { name: '后续处理', duration: 50, retry: 0, failRate: 0 } },
    { id: 'end', type: 'end', x: 240, y: 420, props: {} },
  ], edges: [
    { id: 'e1', source: 'start', target: 'work' },
    { id: 'e2', source: 'work', target: 'downstream' },
    { id: 'e3', source: 'downstream', target: 'end' },
  ] };
}
async function importViaUi(page, plan) {
  await page.getByRole('button', { name: '方案', exact: true }).click();
  await page.locator('input[type="file"][accept=".json,application/json"]').setInputFiles({ name: 'plan.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(plan)) });
  await expect(page.getByText('方案已导入并保存', { exact: true })).toBeVisible();
  await page.locator('.plans-dialog .el-dialog__headerbtn').click();
  await expect(page.locator('.x6-node')).toHaveCount(plan.nodes.length);
}
async function runSnapshot(page) {
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('vto.run.v1')));
  return (await page.request.get(`/api/runs/${saved.runId}`)).json();
}
async function cleanup(page, id) {
  const run = await page.evaluate(() => JSON.parse(localStorage.getItem('vto.run.v1') || 'null'));
  if (run?.planId === id) await page.request.post(`/api/runs/${run.runId}/cancel`);
  await page.request.delete(`/api/plans/${id}`);
}
function captureErrors(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

test('AC-07 浏览器注入失败、重试与下游跳过，日志红色高亮', async ({ page }) => {
  const errors = captureErrors(page); const plan = makePlan('浏览器重试验收', { retry: 2, failRate: 1 });
  await page.goto('/');
  try {
    await importViaUi(page, plan);
    await page.getByRole('button', { name: '执行编排', exact: true }).click();
    await expect(page.locator('.canvas-run-badge')).toContainText('执行失败', { timeout: 15000 });
    await expect(page.locator('.log-row.event-retry')).toHaveCount(2);
    await expect(page.locator('.log-row.event-fail')).toHaveCount(1);
    await expect(page.locator('.log-row.event-fail')).toContainText('共尝试 3 次');
    await expect(page.locator('.log-row.event-skip')).toHaveCount(2);
    const color = await page.locator('.log-row.event-fail').evaluate(element => getComputedStyle(element).color);
    const [red, green, blue] = color.match(/\d+/g).map(Number);
    expect(red).toBeGreaterThan(green + 40); expect(red).toBeGreaterThan(blue + 40);
    await expect(page.locator('.log-row.event-fail')).toHaveCSS('background-color', 'rgb(255, 241, 242)');
    const run = await runSnapshot(page);
    expect(run.status).toBe('FAILED'); expect(run.nodeStates.work.attempt).toBe(3);
    expect(run.nodeStates.work.status).toBe('FAILED'); expect(run.nodeStates.downstream.status).toBe('SKIPPED'); expect(run.nodeStates.end.status).toBe('SKIPPED');
    expect(errors).toEqual([]);
  } finally { await cleanup(page, plan.id); }
});

test('停止执行使未完成节点 CANCELED，刷新后状态仍然保留', async ({ page }) => {
  const errors = captureErrors(page); const plan = makePlan('浏览器停止验收', { duration: 60000 });
  await page.goto('/');
  try {
    await importViaUi(page, plan);
    await page.getByRole('button', { name: '执行编排', exact: true }).click();
    await expect(page.locator('.canvas-run-badge')).toContainText('运行中');
    await expect(page.locator('.log-row.event-start').filter({ hasText: '演示任务' })).toHaveCount(1);
    await page.getByRole('button', { name: '停止执行', exact: true }).click();
    await expect(page.locator('.canvas-run-badge')).toContainText('已停止');
    const run = await runSnapshot(page); expect(run.status).toBe('CANCELED');
    expect(run.nodeStates.work.status).toBe('CANCELED'); expect(run.nodeStates.downstream.status).toBe('CANCELED');
    expect(run.logs.some(log => log.nodeId === 'work' && log.event === 'success')).toBe(false);
    await page.reload(); await expect(page.locator('.canvas-run-badge')).toContainText('已停止'); expect((await runSnapshot(page)).nodeStates).toEqual(run.nodeStates);
    expect(errors).toEqual([]);
  } finally { await cleanup(page, plan.id); }
});

test('AC-09 导出 JSON 再导入保留图与属性，损坏文件友好拒绝', async ({ page }) => {
  const errors = captureErrors(page); const plan = makePlan('浏览器导入导出验收', { output: 'passed', retry: 1 });
  await page.goto('/');
  try {
    await importViaUi(page, plan);
    await page.getByRole('button', { name: '方案', exact: true }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出当前方案', exact: true }).click();
    const download = await downloadPromise; expect(download.suggestedFilename()).toBe(`${plan.name}.json`);
    const stream = await download.createReadStream(); const chunks = []; for await (const chunk of stream) chunks.push(chunk);
    const exported = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    expect(exported.nodes).toEqual(plan.nodes); expect(exported.edges).toEqual(plan.edges);
    const fileInput = page.locator('input[type="file"][accept=".json,application/json"]');
    await fileInput.setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{not valid json') });
    await expect(page.getByText('JSON 文件无法解析，请检查文件是否损坏', { exact: true })).toBeVisible();
    await fileInput.setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
    await expect(page.getByText(/^方案格式错误：/)).toBeVisible();
    const unchanged = await page.evaluate(() => JSON.parse(localStorage.getItem('vto.plan.draft.v1')).plan);
    expect(unchanged.nodes).toEqual(plan.nodes);
    await fileInput.setInputFiles({ name: 'roundtrip.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) });
    await expect(page.getByText('方案已导入并保存', { exact: true })).toBeVisible();
    await page.locator('.plans-dialog .el-dialog__headerbtn').click(); await page.reload();
    await expect(page.locator('.x6-node')).toHaveCount(4);
    const restored = await page.evaluate(() => JSON.parse(localStorage.getItem('vto.plan.draft.v1')).plan);
    expect(restored.nodes).toEqual(exported.nodes); expect(restored.edges).toEqual(exported.edges); expect(restored.meta).toEqual(exported.meta);
    expect(errors).toEqual([]);
  } finally { await cleanup(page, plan.id); }
});
