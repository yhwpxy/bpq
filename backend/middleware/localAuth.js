import { randomBytes, timingSafeEqual } from 'node:crypto';
export function createLocalAuth(token = randomBytes(32).toString('hex')) {
  const expected = Buffer.from(token);
  function authorized(req) {
    const raw = String(req.headers.authorization || '');
    const actual = Buffer.from(raw.startsWith('Bearer ') ? raw.slice(7) : '');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
  function requireAuth(req, res, next) {
    if (!authorized(req)) return res.status(401).json({ code: 40101, message: '需要本机会话授权 / Local session required' });
    next();
  }
  function session(req, res) {
    // Browsers may bootstrap only through a same-origin request. CLI clients use the host token.
    if (req.headers['sec-fetch-site'] !== 'same-origin') return res.status(403).json({ code: 40301, message: 'Same-origin browser session required' });
    res.set('Cache-Control', 'no-store').json({ token });
  }
  return { token, authorized, requireAuth, session };
}
