import path from 'node:path';
import { atomicWrite, readJson, withLock } from './storage.js';
import { AppError } from './errors.js';
export function settingsStore(root, name, initial) {
  const file = path.join(root, `${name}.json`);
  async function read() {
    const value = await readJson(file, { fallback: initial });
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError(50000, `${name} storage is damaged`);
    return structuredClone(value);
  }
  async function update(fn) { return withLock(`${file}:transaction`, async () => { const value = await read(); const result = await fn(value); await atomicWrite(file, value); return result; }); }
  return { read, update };
}
