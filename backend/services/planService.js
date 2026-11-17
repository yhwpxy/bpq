import path from 'node:path';
import { mkdir, readdir, unlink } from 'node:fs/promises';
import { nanoid } from 'nanoid';
import { validatePlanSchema } from '../../shared/schema.js';
import { AppError, assertSafeId } from './errors.js';
import { atomicWrite, readJson, withLock } from './storage.js';

export function createPlanService(storageDir) {
  const directory = path.resolve(storageDir, 'plans'); const indexFile = path.join(directory, 'index.json');
  const indexLock = `${indexFile}:transaction`;
  const file = id => {
    assertSafeId(id);
    if (id.toLowerCase() === 'index') throw new AppError(40001, '方案 ID index 为存储索引保留名称');
    return path.join(directory, `${id}.json`);
  };
  const summary = p => ({ id: p.id, name: p.name, version: p.version, createdAt: p.createdAt, updatedAt: p.updatedAt });
  async function get(id) {
    const plan = await readJson(file(id));
    const details = validatePlanSchema(plan);
    if (details.length) throw new AppError(40001, '已保存方案结构非法', details);
    return plan;
  }
  // Rebuilding the derived index repairs an interrupted plan/index two-file transaction.
  async function rebuildIndex() {
    await mkdir(directory, { recursive: true }); const result = [];
    for (const name of await readdir(directory)) {
      if (name === 'index.json' || !name.endsWith('.json')) continue;
      const id = name.slice(0, -5);
      const plan = await get(id); result.push(summary(plan));
    }
    result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    await atomicWrite(indexFile, result); return result;
  }
  async function save(input) {
    const details = validatePlanSchema(input, { allowMissingId: true });
    if (details.length) throw new AppError(40001, '请求 JSON 结构非法', details);
    const plan = structuredClone(input);
    plan.id ||= `plan_${nanoid(10)}`; assertSafeId(plan.id);
    return withLock(indexLock, async () => {
      const existing = await readJson(file(plan.id), { fallback: null });
      const now = new Date().toISOString();
      plan.createdAt = existing?.createdAt ?? plan.createdAt ?? now; plan.updatedAt = now;
      const normalizedDetails = validatePlanSchema(plan);
      if (normalizedDetails.length) throw new AppError(40001, '请求 JSON 结构非法', normalizedDetails);
      // Validate any existing files before replacing valid data in a damaged directory.
      await rebuildIndex();
      await atomicWrite(file(plan.id), plan); await rebuildIndex();
      return { id: plan.id, updatedAt: plan.updatedAt };
    });
  }
  async function list() { return withLock(indexLock, rebuildIndex); }
  async function remove(id) {
    return withLock(indexLock, async () => {
      await get(id); await unlink(file(id)); await rebuildIndex(); return { ok: true };
    });
  }
  return { save, list, get, delete: remove };
}
