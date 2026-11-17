import { test, expect } from '@playwright/test';

async function connect(page, source, sourcePort, target, targetPort = 'in') {
 const from = await page.locator(`[data-cell-id="${source}"] circle[port="${sourcePort}"]`).boundingBox();
 const to = await page.locator(`[data-cell-id="${target}"] circle[port="${targetPort}"]`).boundingBox();
 expect(from).toBeTruthy(); expect(to).toBeTruthy();
 await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
 await page.mouse.down();
 await page.mouse.move(from.x + from.width / 2 + 18, from.y + from.height / 2, { steps: 3 });
 await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 15 });
 await page.mouse.up();
}
function fixture() {
 const now = new Date().toISOString();
 return { id: `canvas_${Date.now()}`, name: '画布交互验收', version: '1.0', meta: { maxConcurrency: 3 }, createdAt: now, updatedAt: now, nodes: [
  { id: 's', type: 'start', x: 60, y: 80, props: {} },
  { id: 'a', type: 'task', x: 280, y: 80, props: { name: '编辑目标', duration: 300, retry: 0, failRate: 0 } },
  { id: 'b', type: 'task', x: 500, y: 80, props: { name: '后续任务', duration: 300, retry: 0, failRate: 0 } },
  { id: 'c', type: 'condition', x: 60, y: 240, props: { expression: 'true' } },
  { id: 'd', type: 'task', x: 280, y: 240, props: { name: '通过分支', duration: 300, retry: 0, failRate: 0 } },
  { id: 'e', type: 'task', x: 500, y: 240, props: { name: '拒绝分支', duration: 300, retry: 0, failRate: 0 } },
 ], edges: [] };
}
async function importFixture(page) {
 const plan = fixture();
 await page.goto('/');
 await page.getByRole('button', { name: '方案', exact: true }).click();
 await page.locator('input[type="file"][accept=".json,application/json"]').setInputFiles({ name: 'canvas.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(plan)) });
 await expect(page.getByText('方案已导入并保存')).toBeVisible();
 await page.locator('.plans-dialog .el-dialog__headerbtn').click();
 await expect(page.locator('.plans-dialog')).not.toBeVisible();
 await expect(page.locator('.x6-node')).toHaveCount(plan.nodes.length);
 return plan;
}

test('AC-03 五类节点真实拖拽创建并吸附网格', async ({ page }) => {
 const errors = []; page.on('pageerror', e => errors.push(e.message));
 await page.goto('/');
 const canvas = page.locator('.canvas-area');
 const types = [['开始',100,100],['任务',290,100],['条件分支',480,100],['延时',100,270],['结束',290,270]];
 for (let i=0;i<types.length;i++) {
  const [type,x,y]=types[i];
  await page.getByTitle(`拖拽或双击添加${type}`).dragTo(canvas,{targetPosition:{x,y}});
  await expect(page.locator('.x6-node')).toHaveCount(i+1);
 }
 await expect(page.locator('.node-count')).toHaveText('5 节点 · 0 连线');
 await page.waitForTimeout(350);
 const plan = await page.evaluate(() => JSON.parse(localStorage.getItem('vto.plan.draft.v1')).plan);
 expect(plan.nodes.map(n=>n.type)).toEqual(['start','task','condition','delay','end']);
 for(const n of plan.nodes) { expect(n.x%20).toBe(0); expect(n.y%20).toBe(0); }
 expect(errors).toEqual([]);
});

test('AC-04 端口真实连线与自环、重复、开始二出、条件第三出拒绝', async ({ page }) => {
 const plan = await importFixture(page);
 try {
  await connect(page,'a','out','a');
  await expect(page.getByText('不能连接节点自身',{exact:true})).toBeVisible();
  await expect(page.locator('.node-count')).toHaveText('6 节点 · 0 连线');
  await connect(page,'s','out','a');
  await expect(page.locator('.node-count')).toHaveText('6 节点 · 1 连线');
  await connect(page,'s','out','a');
  await expect(page.getByText('这两个节点之间已经存在连线',{exact:true})).toBeVisible();
  await connect(page,'s','out','b');
  await expect(page.getByText('开始节点只能有一条出边',{exact:true})).toBeVisible();
  await expect(page.locator('.node-count')).toHaveText('6 节点 · 1 连线');
  await connect(page,'c','true','d');
  await connect(page,'c','false','e');
  await expect(page.locator('.node-count')).toHaveText('6 节点 · 3 连线');
  await connect(page,'c','true','b');
  await expect(page.getByText('条件节点最多两条出边',{exact:true})).toBeVisible();
  await expect(page.locator('.node-count')).toHaveText('6 节点 · 3 连线');
 } finally { await page.request.delete(`/api/plans/${plan.id}`); }
});

test('AC-03 选中、属性修改、复制粘贴、删除与撤销重做', async ({ page }) => {
 const plan = await importFixture(page);
 try {
  const node = page.locator('[data-cell-id="a"]');
  await node.click({position:{x:65,y:24}});
  await expect(page.locator('.property-panel')).toContainText('任务名称');
  await page.locator('.property-panel .el-input__inner').first().fill('修改后的任务');
  await expect(page.locator('[data-cell-id="a"]')).toContainText('修改后的任务');
  await page.locator('[data-cell-id="a"]').click({position:{x:65,y:24}});
  await page.keyboard.press('Meta+c');
  await page.keyboard.press('Meta+v');
  await expect(page.locator('.x6-node')).toHaveCount(7);
  await expect(page.locator('.x6-node').filter({hasText:'修改后的任务'})).toHaveCount(2);
  await page.keyboard.press('Meta+z');
  await expect(page.locator('.x6-node')).toHaveCount(6);
  await page.keyboard.press('Meta+Shift+z');
  await expect(page.locator('.x6-node')).toHaveCount(7);
  await page.locator('[data-cell-id="a"]').click({position:{x:65,y:24}});
  await page.keyboard.press('Delete');
  await expect(page.locator('.x6-node')).toHaveCount(6);
  await expect(page.locator('[data-cell-id="a"]')).toHaveCount(0);
  await page.getByTitle('撤销 ⌘/Ctrl Z').click();
  await expect(page.locator('[data-cell-id="a"]')).toHaveCount(1);
  await expect(page.locator('.x6-node')).toHaveCount(7);
 } finally { await page.request.delete(`/api/plans/${plan.id}`); }
});

test('1280×720 五区布局、侧栏折叠与日志折叠无页面溢出',async({page})=>{
 await page.setViewportSize({width:1280,height:720});await page.goto('/');
 await expect(page.getByRole('heading',{name:'把想法，编排成行动。'})).toBeVisible();
 const check=async()=>expect(await page.evaluate(()=>({w:document.documentElement.scrollWidth,h:document.documentElement.scrollHeight}))).toEqual({w:1280,h:720});
 await check();
 await page.getByTitle('收起节点库').click();await expect(page.locator('.node-library')).toHaveCount(0);
 await page.getByTitle('收起属性面板').click();await expect(page.locator('.property-panel')).toHaveCount(0);
 await page.getByTitle('收起日志').click();await expect(page.locator('.log-panel')).toHaveClass(/collapsed/);
 await check();
 await page.getByTitle('展开节点库').click();await page.getByTitle('展开属性面板').click();await page.getByTitle('展开日志').click();
 await expect(page.locator('.node-library')).toBeVisible();await expect(page.locator('.property-panel')).toBeVisible();await check();
});
