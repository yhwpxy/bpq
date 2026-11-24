import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { parseGoal } from '../backend/engine/goalParser.js';
import { compileWorkflow } from '../backend/engine/workflowCompiler.js';
import { changeImpact, graphDigest } from '../backend/engine/changeImpact.js';
import { runTrial } from '../backend/engine/trialRunner.js';
import { createPlanService } from '../backend/services/planService.js';
import { createVersionService } from '../backend/services/versionService.js';
import { atomicCreate } from '../backend/services/storage.js';
const capabilities = [{ id: 'simulated', enabled: true, kind: 'tool', circuit: 'closed' }];
const makePlan = () => compileWorkflow(parseGoal('# 发票\nFR-01: 核对\nFR-02: 导出'), {}, capabilities);
let dir, plans, versions;
beforeEach(async () => { dir = await mkdtemp(path.join(os.tmpdir(), 'versions-')); plans = createPlanService(dir); versions = createVersionService(dir, plans, { list: async () => capabilities }); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('Isolated trial and immutable publication', () => {
  it('simulates condition skips and human gates without filesystem writes or input mutation', async () => {
    const p = makePlan(); const original = structuredClone(p); const trial = runTrial(p, { capabilities });
    expect(trial.passed).toBe(true); expect(trial.steps.some(s => s.status === 'SKIPPED')).toBe(true); expect(p).toEqual(original); expect(await readdir(dir)).toEqual([]);
    const strict = compileWorkflow(parseGoal('workflow'), { permissionTier: 'strict' }, capabilities);
    expect(runTrial(strict, { capabilities }).steps.some(s => s.status === 'WAITING_HUMAN')).toBe(true);
  });
  it('simulates bounded recovery and stops when failure scenarios exceed the limit', () => {
    const p = makePlan(), gate = p.nodes.find(n => n.props.control === 'gate');
    const once = runTrial(p, { capabilities, failures: { [gate.id]: 1 } }); expect(once.passed).toBe(true); expect(once.reworkCount).toBe(1);
    const exhausted = runTrial(p, { capabilities, failures: { [gate.id]: 99 } }); expect(exhausted.passed).toBe(false); expect(exhausted.reworkCount).toBe(2); expect(exhausted.steps.at(-1).status).toBe('WAITING_HUMAN');
  });
  it('blocks invalid capabilities before simulating', () => { const p = makePlan(); expect(runTrial(p, { capabilities: [] }).steps).toHaveLength(0); });
  it('requires a passing current trial before publishing', async () => {
    const p = makePlan(); await plans.save(p); await expect(versions.confirm(p.id)).rejects.toMatchObject({ code: 40901 });
    await versions.trial(p.id); const v = await versions.confirm(p.id); expect(v.tag).toBe('v1.0'); expect(v.trial.passed).toBe(true);
  });
  it('rejects stale trial after semantics change and permits harmless layout edits', async () => {
    const p = makePlan(); await plans.save(p); await versions.trial(p.id);
    p.nodes[1].x += 20; await plans.save(p); expect((await versions.confirm(p.id)).tag).toBe('v1.0');
    p.nodes[1].props.planningRationale += 'changed'; await plans.save(p); await expect(versions.confirm(p.id)).rejects.toMatchObject({ code: 40901 });
  });
  it('rejects publication when capability health changed after trial', async () => {
    const p = makePlan(); await plans.save(p); await versions.trial(p.id);
    const closed = createVersionService(dir, plans, { list: async () => [] }); await expect(closed.confirm(p.id)).rejects.toMatchObject({ code: 40002 });
  });
  it('publishes isolated v1/v2 and persists after service recreation', async () => {
    const p = makePlan(); await plans.save(p); await versions.trial(p.id); const v1 = await versions.confirm(p.id);
    p.name = 'new'; await plans.save(p); await versions.trial(p.id); const v2 = await versions.confirm(p.id);
    expect(v2.tag).toBe('v2.0'); expect(v1.plan.name).not.toBe('new');
    v2.plan.name = 'client changed'; const reopened = createVersionService(dir, plans, { list: async () => capabilities });
    expect((await reopened.get(p.id, v2.id)).plan.name).toBe('new'); expect((await versions.forExecution(p.id, v1.id)).tag).toBe('v1.0');
  });
  it('serializes concurrent publication without duplicate numbers', async () => {
    const p = makePlan(); await plans.save(p); await versions.trial(p.id);
    const all = await Promise.all([versions.confirm(p.id), versions.confirm(p.id), versions.confirm(p.id)]); expect(all.map(v => v.number)).toEqual([1, 2, 3]);
  });
  it('enforces plan ownership and snapshot integrity', async () => {
    const p = makePlan(); await plans.save(p); await versions.trial(p.id); const v = await versions.confirm(p.id);
    await expect(versions.get('different', v.id)).rejects.toMatchObject({ code: 40401 });
    const file = path.join(dir, 'versions', p.id, `${v.id}.json`); const raw = JSON.parse(await readFile(file, 'utf8')); raw.plan.name = 'tampered'; await writeFile(file, JSON.stringify(raw));
    await expect(versions.get(p.id, v.id)).rejects.toMatchObject({ code: 50000 });
  });
  it('never overwrites an immutable destination', async () => {
    const file = path.join(dir, 'frozen.json'); await atomicCreate(file, { n: 1 }); await expect(atomicCreate(file, { n: 2 })).rejects.toMatchObject({ code: 'EEXIST' }); expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ n: 1 });
  });
  it('rejects a changed client digest', async () => {
    const p = makePlan(); await plans.save(p); await versions.trial(p.id); await expect(versions.confirm(p.id, 'outdated')).rejects.toMatchObject({ code: 40901 });
  });
  it('rejects starting an unpublished advanced workflow', async () => { const p = makePlan(); await plans.save(p); await expect(versions.forExecution(p.id)).rejects.toMatchObject({ code: 40901 }); });
});

describe('Change impact', () => {
  it('reports downstream nodes, requirements and capability changes', () => {
    const a = makePlan(), b = structuredClone(a), worker = b.nodes.find(n => n.props.requirementRefs.length); worker.props.capabilityId = 'new';
    const impact = changeImpact(a, b); expect(impact.changedNodeIds).toContain(worker.id); expect(impact.requirementIds).toContain('FR-01'); expect(impact.capabilityIds).toContain('new'); expect(impact.affectedNodeIds).toContain(b.nodes.find(n => n.type === 'end').id); expect(impact.requiresRetrial).toBe(true);
  });
  it('detects edge-label and requirement-only edits', () => {
    const a = makePlan(), b = structuredClone(a); b.edges[0].label = 'changed'; expect(changeImpact(a, b).requiresRetrial).toBe(true);
    const c = structuredClone(a); c.workflow.goalSpec.acceptanceCriteria[0].text += ' revised'; expect(changeImpact(a, c).requiresRetrial).toBe(true);
  });
  it('ignores only display positions and save timestamps', () => {
    const a = makePlan(), b = structuredClone(a); b.nodes[0].x += 100; b.updatedAt = new Date().toISOString(); expect(graphDigest(a)).toBe(graphDigest(b)); expect(changeImpact(a, b).requiresRetrial).toBe(false);
  });
});
it('includes node type changes and both edits in one impact comparison', () => {
  const before=makePlan(),after=structuredClone(before),workers=after.nodes.filter(n=>n.props.requirementRefs.length);
  workers[0].type='delay';workers[0].props.wait=10;workers[1].props.planningRationale+=' adjusted';
  const impact=changeImpact(before,after);expect(impact.changedNodeIds).toEqual(expect.arrayContaining(workers.map(n=>n.id)));expect(impact.requirementIds).toEqual(expect.arrayContaining(['FR-01','FR-02']));expect(impact.requiresRetrial).toBe(true);
});
