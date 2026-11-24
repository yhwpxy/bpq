import { mkdir, open, rename, readFile, unlink, link } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from './errors.js';

const locks = new Map();
export function withLock(key, operation) {
  const previous = locks.get(key) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  locks.set(key, current);
  current.finally(() => { if (locks.get(key) === current) locks.delete(key); }).catch(() => {});
  return current;
}

/** Each file is serialized, flushed, then atomically renamed within its directory. */
export function atomicWrite(file, value, hooks = {}) {
  return withLock(path.resolve(file), async () => {
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.tmp`;
    let handle;
    try {
      const serialized = JSON.stringify(value, null, 2);
      if (serialized === undefined) throw new Error('无法序列化空数据');
      handle = await open(temporary, 'w', 0o600);
      await handle.writeFile(serialized, 'utf8'); await handle.sync(); await handle.close(); handle = null;
      if (hooks.beforeRename) await hooks.beforeRename();
      await rename(temporary, file);
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      await unlink(temporary).catch(() => {}); throw error;
    }
  });
}

export async function readJson(file, { missingCode = 40401, fallback } = {}) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') {
      if (fallback !== undefined) return fallback;
      throw new AppError(missingCode, missingCode === 40402 ? '运行记录不存在' : '方案不存在');
    }
    if (error instanceof SyntaxError) throw new AppError(50000, '存储文件损坏，无法读取，请恢复备份');
    throw error;
  }
}

/** Publish once: hard-link promotion is atomic and fails if the destination exists. */
export async function atomicCreate(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.new`;
  const handle = await open(temp, 'wx', 0o600);
  try {
    try { await handle.writeFile(JSON.stringify(value, null, 2)); await handle.sync(); }
    finally { await handle.close(); }
    await link(temp, file);
  } finally { await unlink(temp).catch(() => {}); }
}
