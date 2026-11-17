import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPlanService } from '../backend/services/planService.js';
import { atomicWrite, withLock } from '../backend/services/storage.js';
const plan = id => ({ ...(id ? { id } : {}), name: id ?? '新方案', version: '1.0', createdAt: '2026-11-17T00:00:00Z', updatedAt: '2026-11-17T00:00:00Z', nodes: [], edges: [] });
let dir;
beforeEach(async () => { dir = await mkdtemp(path.join(os.tmpdir(), 'vto-storage-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('原子存储和方案服务', () => {
  it('保存/列表/加载/删除，跨服务实例可恢复', async () => {
    const service = createPlanService(dir); const { id } = await service.save(plan());
    expect(id).toMatch(/^plan_/); const saved = await createPlanService(dir).get(id); expect(saved.name).toBe('新方案');
    expect(await service.list()).toEqual([{ id, name: '新方案', version: '1.0', createdAt: saved.createdAt, updatedAt: saved.updatedAt }]);
    await service.delete(id); expect(await service.list()).toEqual([]); await expect(service.get(id)).rejects.toMatchObject({ code: 40401 });
  });
  it('并发保存多个方案不丢索引，按文件互斥', async () => {
    const service = createPlanService(dir); await Promise.all(Array.from({ length: 20 }, (_, i) => service.save(plan(`p${i}`))));
    expect(await service.list()).toHaveLength(20); expect(JSON.parse(await readFile(path.join(dir, 'plans/index.json'), 'utf8'))).toHaveLength(20);
    expect((await readdir(path.join(dir, 'plans'))).some(f => f.endsWith('.tmp'))).toBe(false);
  });
  it('相同方案并发更新保持有效 JSON，创建时间不变', async () => {
    const service = createPlanService(dir); await service.save(plan('p'));
    await Promise.all(Array.from({ length: 10 }, (_, i) => service.save({ ...plan('p'), name: `修改${i}`, createdAt: '2020-01-01T00:00:00Z' })));
    const saved = await service.get('p'); expect(saved.name).toBe('修改9'); expect(saved.createdAt).toBe('2026-11-17T00:00:00Z');
  });
  it('rename 前异常保留旧文件并清理临时文件', async () => {
    const file = path.join(dir, 'data.json'); await atomicWrite(file, { version: 1 });
    await expect(atomicWrite(file, { version: 2 }, { beforeRename: () => { throw new Error('模拟中断'); } })).rejects.toThrow('模拟中断');
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ version: 1 }); expect(await readdir(dir)).toEqual(['data.json']);
    await atomicWrite(file, { version: 3 }); expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ version: 3 });
  });
  it('索引损坏可从有效方案原子重建', async () => {
    const service = createPlanService(dir); await service.save(plan('p')); await writeFile(path.join(dir, 'plans/index.json'), '{broken');
    expect(await service.list()).toHaveLength(1);
  });
  it('JSON 损坏友好报错；结构损坏也拒绝加载', async () => {
    const service = createPlanService(dir); await service.save(plan('p')); const file = path.join(dir, 'plans/p.json');
    await writeFile(file, '{broken'); await expect(service.get('p')).rejects.toMatchObject({ code: 50000 });
    await writeFile(file, '{}'); await expect(service.get('p')).rejects.toMatchObject({ code: 40001 });
  });
  it('不合法输入不得覆盖有效文件', async () => {
    const service = createPlanService(dir); await service.save(plan('p')); await expect(service.save({ ...plan('p'), name: '' })).rejects.toMatchObject({ code: 40001 }); expect((await service.get('p')).name).toBe('p');
  });
  it.each(['../escape', '/tmp/escape', 'a/b', 'index/../p'])('阻止路径穿越 %s', async id => { const service = createPlanService(dir); await expect(service.get(id)).rejects.toMatchObject({ code: 40001 }); await expect(service.save(plan(id))).rejects.toMatchObject({ code: 40001 }); });
  it('保留索引名称不可用作方案 ID', async () => {
    const service = createPlanService(dir); await service.save(plan('valid'));
    await expect(service.save(plan('index'))).rejects.toMatchObject({ code: 40001 });
    await expect(service.save(plan('INDEX'))).rejects.toMatchObject({ code: 40001 });
    expect(await service.list()).toHaveLength(1);
  });
  it('单个互斥操作失败不阻塞后续操作', async () => {
    await expect(withLock('failure-test', () => { throw new Error('fail'); })).rejects.toThrow('fail'); expect(await withLock('failure-test', () => 42)).toBe(42);
  });
});
