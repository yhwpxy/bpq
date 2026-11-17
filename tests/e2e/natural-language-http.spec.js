import { test, expect } from '@playwright/test';

test('完整HTTP链路：自然语言→模型协议替身→校验→同一确认表→依赖修改→执行', async({page})=>{
  const errors=[], external=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  page.on('request',request=>{if(!request.url().startsWith('http://127.0.0.1:4173/')&&!request.url().startsWith('data:'))external.push(request.url());});
  // No API interception: backend fetch really performs HTTP to the model fixture.
  await page.goto('/');
  await page.getByRole('button',{name:'导入规格',exact:true}).click();
  await page.getByRole('tab',{name:/自然语言/}).click();
  await expect(page.getByText('AI 已配置',{exact:true})).toBeVisible();
  await page.locator('#nl-text').fill('帮我做一个登录功能，用户能输入账号密码，后端要校验，成功跳转首页，失败提示错误，再记录审计日志。');
  const responsePromise=page.waitForResponse(response=>response.url().endsWith('/api/decompose-nl')&&response.request().method()==='POST');
  await page.getByRole('button',{name:'AI 分解',exact:true}).click();
  const response=await responsePromise;expect(response.status()).toBe(200);
  const body=await response.json();expect(Object.keys(body).sort()).toEqual(['ok','taskSpec']);expect(body.taskSpec.detectedFormat).toBe('numbered');
  await expect(page.getByText('AI 分解结果',{exact:true})).toBeVisible();
  await expect(page.locator('.task-table')).toHaveCount(1);
  await expect(page.locator('.task-table tbody tr')).toHaveCount(7);
  await page.getByRole('textbox',{name:'2 名称',exact:true}).fill('验证登录凭据');
  await page.getByRole('textbox',{name:'6 依赖',exact:true}).fill('2');
  await page.getByRole('textbox',{name:'6 依赖',exact:true}).press('Tab');
  await page.getByRole('button',{name:'确认并生成画布',exact:true}).click();
  await expect(page.locator('.x6-node')).toHaveCount(8);
  let savedId;
  try {
    await page.getByRole('button',{name:'执行编排',exact:true}).click();
    await expect(page.locator('.canvas-run-badge')).toContainText('执行成功',{timeout:15000});
    const draft=await page.evaluate(()=>JSON.parse(localStorage.getItem('vto.plan.draft.v1')));savedId=draft.plan.id;
    const from=draft.plan.nodes.find(n=>n.props.name==='验证登录凭据'),to=draft.plan.nodes.find(n=>n.props.name==='记录审计日志');
    expect(draft.plan.edges.some(e=>e.source===from.id&&e.target===to.id)).toBe(true);
    const remembered=await page.evaluate(()=>JSON.parse(localStorage.getItem('vto.run.v1')));
    const run=await(await page.request.get(`/api/runs/${remembered.runId}`)).json();
    expect(run.status).toBe('SUCCESS');expect(Object.values(run.nodeStates).filter(n=>n.status==='SKIPPED')).toHaveLength(1);
    await expect(page.locator('.log-panel')).toContainText('验证登录凭据');
    expect(errors).toEqual([]);expect(external).toEqual([]);
  } finally { if(savedId)await page.request.delete(`/api/plans/${savedId}`); }
});
