export class AppError extends Error {
  constructor(code, message, details) { super(message); this.code = code; this.details = details; }
}
export const statusForCode = code => ({ 40101: 401, 40301: 403, 40001: 400, 40002: 400, 40003: 400, 40401: 404, 40402: 404, 40901: 409, 50000: 500, 50201: 502, 50301: 503, 50401: 504 }[code] ?? 500);
export function assertSafeId(id, code = 40001) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new AppError(code, '标识不合法');
  return id;
}
