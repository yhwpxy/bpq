import path from 'node:path';
import { realpath, lstat, mkdir } from 'node:fs/promises';
export async function inside(root, candidate = '.') {
  if (typeof candidate !== 'string' || candidate.includes('\0')) throw new Error('Invalid workspace path');
  const base = await realpath(root), target = path.resolve(base, candidate);
  const relative = path.relative(base, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || relative.split(path.sep).includes('.git')) throw new Error('Workspace path escape or protected .git path');
  let cursor = target;
  for (;;) {
    try {
      const stat = await lstat(cursor);
      let actual;
      try { actual = await realpath(cursor); } catch (e) { if (stat.isSymbolicLink()) throw new Error('Broken symlink is not a writable workspace path'); throw e; }
      const rel = path.relative(base, actual);
      if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel) || rel.split(path.sep).includes('.git')) throw new Error('Symlink escapes workspace');
      break;
    } catch (e) { if (e.code !== 'ENOENT') throw e; const parent = path.dirname(cursor); if (parent === cursor) throw e; cursor = parent; }
  }
  return target;
}
export function matchesScope(file, scopes = []) {
  const normalized = file.replaceAll('\\', '/').replace(/^\.\//, '');
  if (!scopes.length) return false;
  return scopes.some(scope => {
    const pattern = scope.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\0').replace(/\*/g, '[^/]*').replace(/\0/g, '.*');
    return new RegExp(`^${pattern}$`).test(normalized);
  });
}
export async function writablePath(root, file, scopes) {
  if (!matchesScope(file, scopes)) throw new Error('Write is outside the assigned file scope');
  const target = await inside(root, file); await mkdir(path.dirname(target), { recursive: true });
  await inside(root, file); return target;
}
