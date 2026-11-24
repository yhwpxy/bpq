import { it, expect } from 'vitest';
import { createApp } from '../backend/server.js';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

it('GoalSpec HTTP parse → confirm → validate preserves provenance and rejects dangling references', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'goal-http-'));
  const app = createApp({ storageDir: dir });
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const request = async (route, body) => { const r = await fetch(`http://127.0.0.1:${server.address().port}/api/goals/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, data: await r.json() }; };
  try {
    const parsed = await request('parse', { text: '# Orders\nFR-01: Check orders' });
    expect(parsed.status).toBe(200);
    const confirmed = await request('confirm', { goalSpec: parsed.data.goalSpec, id: 'AC-01' });
    expect(confirmed.data.goalSpec.acceptanceCriteria[0]).toMatchObject({ source: 'user_confirmed', origin: 'suggested' });
    expect((await request('validate', confirmed.data.goalSpec)).status).toBe(200);
    confirmed.data.goalSpec.acceptanceCriteria[0].requirementRefs = ['FR-999'];
    const invalid = await request('validate', confirmed.data.goalSpec);
    expect(invalid.status).toBe(400); expect(invalid.data.details[0].rule).toBe('R8');
    expect((await request('parse', { text: '' })).status).toBe(400);
  } finally { await app.locals.services.runService.close(); await new Promise(r => server.close(r)); await rm(dir, { recursive: true, force: true }); }
});
