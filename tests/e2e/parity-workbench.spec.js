import { test, expect } from '@playwright/test';
async function open(page) { await page.goto('/#workbench'); await expect(page.getByRole('heading', { name: '将需求变成可执行计划' })).toBeVisible(); }
async function demo(page) { await page.getByRole('button',{name:'真实产物演示',exact:true}).click(); await expect(page.locator('.wb-tree')).toBeVisible(); await expect(page.locator('.wb-canvas .x6-node')).not.toHaveCount(0); }
async function publish(page) { await page.getByRole('button',{name:'隔离试运行',exact:true}).click(); await expect(page.getByTestId('trial-report')).toContainText('试运行通过'); await page.getByRole('button',{name:'发布版本',exact:true}).click(); await expect(page.locator('[aria-label="Execution version"]')).not.toHaveValue(''); }

test('双语入口与来源确认：规则提取到三级任务树、画布和节点编辑', async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await open(page);
  await page.getByRole('button',{name:'EN',exact:true}).click();await expect(page.getByRole('heading',{name:'Turn requirements into an executable plan'})).toBeVisible();
  await page.getByRole('button',{name:'中文',exact:true}).click();
  await page.getByLabel('Requirement source').fill('# 订单验收\n## 功能需求\nFR-01: 识别订单\nFR-02: 生成结果');
  await page.getByRole('button',{name:'提取需求契约',exact:true}).click();await expect(page.getByLabel('FR-01',{exact:true})).toHaveValue('识别订单');
  await page.getByRole('button',{name:'确认建议',exact:true}).first().click();await expect(page.locator('.provenance.user_confirmed')).toHaveCount(1);
  await page.getByRole('button',{name:'编译任务与双图',exact:true}).click();await expect(page.locator('.wb-tree')).toContainText('识别订单');
  await page.locator('.wb-tree button').filter({hasText:'识别订单'}).click();
  await page.getByLabel('Workflow node name').fill('订单校验步骤');await page.getByRole('button',{name:'应用节点修改',exact:true}).click();
  await expect(page.locator('.wb-tree')).toContainText('订单校验步骤');await expect(page.locator('.wb-canvas')).toContainText('订单校验步骤');
  await expect(page.getByTestId('impact-report')).toBeVisible();await expect(page.getByTestId('impact-report')).toContainText('FR-01');
  expect(errors).toEqual([]);
});

test('真实端到端：试运行、v1 发布、人工门禁、Ghost、自动返工与证据下载',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await open(page);await demo(page);await publish(page);
  await page.getByRole('button',{name:'运行选定版本',exact:true}).click();await expect(page.getByTestId('human-gate')).toBeVisible();
  await page.getByRole('button',{name:'＋ GhostNode',exact:true}).click();await page.getByLabel('Ghost title').fill('课堂补充说明');await page.getByLabel('Ghost reason').fill('验收现场增加一个补充任务');
  await page.getByRole('button',{name:'插入补充任务',exact:true}).click();await expect(page.locator('.wb-run .wb-tree')).toContainText('课堂补充说明');
  await page.getByLabel('Decision reason').fill('确认演示工作区与执行命令');await page.getByRole('button',{name:'批准',exact:true}).click();
  await expect(page.getByTestId('run-status')).toHaveText('成功',{timeout:30000});await expect(page.getByTestId('live-logs')).toContainText('有界返工 1');
  const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'导出证据',exact:true}).click();const download=await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^evidence-run_.*\.json$/);
  const fs=await import('node:fs/promises');const evidence=JSON.parse(await fs.readFile(await download.path(),'utf8'));
  expect(evidence.data.run.status).toBe('SUCCESS');expect(evidence.data.run.reworkCount).toBe(1);expect(evidence.data.version.plan.nodes.some(n=>n.props.control==='ghost')).toBe(false);
  expect(evidence.data.run.graph.nodes.some(n=>n.props.control==='ghost')).toBe(true);expect(evidence.data.run.checkpoints.some(c=>c.kind==='rescue')).toBe(true);
  expect(errors).toEqual([]);
});

test('暂停人工等待、刷新恢复、v1 与 v2 隔离',async({page})=>{
  await open(page);await demo(page);await publish(page);await page.getByRole('button',{name:'运行选定版本',exact:true}).click();await expect(page.getByTestId('human-gate')).toBeVisible();
  await page.getByRole('button',{name:'暂停',exact:true}).click();await expect(page.getByTestId('run-status')).toHaveText('已暂停');
  await page.getByRole('button',{name:'设计',exact:true}).click();await page.getByRole('button',{name:'需求契约',exact:true}).click();await page.getByLabel('Goal text').fill('新版本改变目标但不影响活动运行');await page.getByLabel('Goal title').click();
  await page.getByRole('button',{name:'隔离试运行',exact:true}).click();await expect(page.getByTestId('trial-report')).toContainText('试运行通过');await page.getByRole('button',{name:'发布版本',exact:true}).click();await expect(page.getByLabel('Execution version')).toContainText('v2.0');
  await page.reload();await page.getByRole('button',{name:'运行',exact:true}).click();await expect(page.getByTestId('run-status')).toHaveText('已暂停');await expect(page.locator('.wb-version')).toHaveText('v1.0');
  await page.getByRole('button',{name:'恢复',exact:true}).click();await page.getByLabel('Decision reason').fill('继续旧版本');await page.getByRole('button',{name:'批准',exact:true}).click();await expect(page.getByTestId('run-status')).toHaveText('成功',{timeout:30000});
});

test('能力管理的 DDD 与 MCP 登记、鉴权、审计检索和布局',async({page})=>{
  await open(page);await page.setViewportSize({width:1280,height:720});await page.getByRole('button',{name:'能力',exact:true}).click();
  await page.getByLabel('Canonical term').fill('InvoiceRecord');await page.getByLabel('Term aliases').fill('old_invoice');await page.getByRole('button',{name:'保存术语',exact:true}).click();await expect(page.locator('.wb-entry')).toContainText(['InvoiceRecord']);
  await page.getByLabel('MCP name').fill('离线连通检查');await page.getByLabel('MCP endpoint').fill('http://127.0.0.1:1');await page.getByRole('button',{name:'登记 MCP',exact:true}).click();
  const row=page.locator('.wb-entry').filter({hasText:'离线连通检查'});await row.getByRole('button',{name:'探测',exact:true}).click();await expect(row).toContainText('offline');
  await page.getByRole('button',{name:'审计',exact:true}).click();await page.getByLabel('Evidence query').fill('InvoiceRecord');await page.getByRole('button',{name:'搜索证据',exact:true}).click();await expect(page.locator('.wb-hit')).toContainText(['InvoiceRecord']);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  expect((await page.request.get('/api/providers')).status()).toBe(401);
});

test('校验定位、画布选中、显式失效报告与前向连线表单',async({page})=>{
  await open(page);await demo(page);
  const first=page.locator('.wb-canvas .x6-node').first();await first.click();await expect(page.getByLabel('Workflow node name')).not.toHaveValue('');
  await page.locator('.wb-tree button').filter({hasText:'生成第一份报告'}).click();await page.getByLabel('Node FR refs').fill('FR-999');await page.getByRole('button',{name:'应用节点修改',exact:true}).click();
  await page.getByRole('button',{name:'校验与版本',exact:true}).click();await page.getByRole('button',{name:'重新检查',exact:true}).click();
  await expect(page.locator('.wb-diagnostic').filter({hasText:'FR_REFERENCE'})).toBeVisible();await page.locator('.wb-diagnostic').filter({hasText:'FR_REFERENCE'}).click();await expect(page.getByLabel('Node FR refs')).toHaveValue('FR-999');
  await page.getByLabel('Node FR refs').fill('FR-01');await page.getByRole('button',{name:'应用节点修改',exact:true}).click();
  await page.getByText('表单编辑连线',{exact:true}).click();await page.getByLabel('Edge source').selectOption({label:'生成第一份报告'});await page.getByLabel('Edge target').selectOption({label:'生成第二份报告'});await page.getByRole('button',{name:'添加边',exact:true}).click();
  await expect(page.locator('.wb-edge-editor .wb-entry').filter({hasText:'生成第一份报告 → 生成第二份报告'})).toBeVisible();
  await publish(page);
});

test('人工拒绝终止后续任务并可在审计历史重新打开',async({page})=>{
  await open(page);await demo(page);await publish(page);await page.getByRole('button',{name:'运行选定版本',exact:true}).click();await expect(page.getByTestId('human-gate')).toBeVisible();
  await page.getByLabel('Decision reason').fill('课堂验收拒绝分支');await page.getByRole('button',{name:'拒绝',exact:true}).click();await expect(page.getByTestId('run-status')).toHaveText('失败');
  await page.getByRole('button',{name:'审计',exact:true}).click();await page.getByLabel('Evidence query').fill('课堂验收拒绝分支');await page.getByRole('button',{name:'搜索证据',exact:true}).click();await expect(page.locator('.wb-hit')).toContainText(['课堂验收拒绝分支']);await page.locator('.wb-hit button').first().click();await expect(page.getByTestId('run-status')).toHaveText('失败');
});

test('完成运行后通过界面恢复检查点并保留恢复引用',async({page})=>{
  await open(page);await demo(page);await publish(page);await page.getByRole('button',{name:'运行选定版本',exact:true}).click();await expect(page.getByTestId('human-gate')).toBeVisible();
  await page.getByLabel('Decision reason').fill('允许验证恢复');await page.getByRole('button',{name:'批准',exact:true}).click();await expect(page.getByTestId('run-status')).toHaveText('成功',{timeout:30000});
  await page.getByRole('button',{name:'恢复此点',exact:true}).first().click();await page.getByRole('button',{name:'确定',exact:true}).click();
  await expect(page.getByTestId('live-logs')).toContainText('人工恢复检查点');await expect(page.getByTestId('run-status')).toHaveText('成功',{timeout:30000});
});

test('原创示例与 Markdown、Mermaid、JSON 计划导出',async({page})=>{
  await open(page);await page.getByLabel('Requirement preset').selectOption('booking');await page.getByRole('button',{name:'填入示例',exact:true}).click();await expect(page.getByLabel('Requirement source')).toHaveValue(/实验室预约/);
  await page.getByRole('button',{name:'提取需求契约',exact:true}).click();await page.getByRole('button',{name:'编译任务与双图',exact:true}).click();await page.getByRole('button',{name:'校验与版本',exact:true}).click();
  for(const [kind,extension] of [['markdown','md'],['mermaid','mmd'],['json','json']]){await page.getByLabel('Plan export format').selectOption(kind);const promise=page.waitForEvent('download');await page.getByRole('button',{name:'导出执行计划',exact:true}).click();expect((await promise).suggestedFilename()).toBe(`workflow-plan.${extension}`);}
});

test('自然语言契约入口通过完整 HTTP 替身提取输入输出和约束',async({page})=>{
  await open(page);await page.getByLabel('Requirement input mode').selectOption('natural');await page.getByLabel('Requirement source').fill('处理发票，输入发票数组，输出核对报告，不得修改原始文件');await page.getByRole('button',{name:'提取需求契约',exact:true}).click();
  await expect(page.getByLabel('FR-01',{exact:true})).toHaveValue('处理发票');
  await page.locator('.goal-editor summary').filter({hasText:'输入'}).click();await expect(page.getByLabel('IN-01',{exact:true})).toHaveValue('发票数组');
  await page.locator('.goal-editor summary').filter({hasText:'输出'}).click();await expect(page.getByLabel('OUT-01',{exact:true})).toHaveValue('核对报告');
  await page.locator('.goal-editor summary').filter({hasText:'约束'}).click();await expect(page.getByLabel('CON-01',{exact:true})).toHaveValue('不得修改原始文件');
});

test('快速连续修改两个节点时影响分析同时保留两项需求',async({page})=>{
  await open(page);await demo(page);
  let releaseImpact;const hold=new Promise(resolve=>{releaseImpact=resolve});
  await page.route('**/api/workflows/impact',async route=>{await hold;await route.continue();});
  await page.locator('.wb-tree button').filter({hasText:'生成第一份报告'}).click();await page.getByLabel('Planning rationale').fill('第一项修改');await page.getByRole('button',{name:'应用节点修改',exact:true}).click();
  await page.locator('.wb-tree button').filter({hasText:'生成第二份报告'}).click();await page.getByLabel('Planning rationale').fill('第二项修改');await page.getByRole('button',{name:'应用节点修改',exact:true}).click();
  releaseImpact();
  await expect(page.getByTestId('impact-report')).toContainText('FR-02');
  // The report is tied to the last successfully analyzed baseline, so a rapid batch retains both edits.
  await expect(page.getByTestId('impact-report')).toContainText('FR-01');
});
