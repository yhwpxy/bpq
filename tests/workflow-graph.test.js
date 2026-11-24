import { describe, it, expect } from 'vitest';
import { parseGoal } from '../backend/engine/goalParser.js';
import { compileWorkflow } from '../backend/engine/workflowCompiler.js';
import { validatePlan, topologicalLevels } from '../backend/engine/validator.js';
import { validatePlanSchema } from '../shared/schema.js';
import { autoLayout } from '../shared/plan.js';
const capabilities = [{ id: 'simulated', enabled: true, kind: 'tool', circuit: 'closed' }, { id: 'qa', enabled: true, kind: 'agent', circuit: 'closed' }];
const goal = () => parseGoal('# 发票\n## 目标\n核对发票\n## 需求\nFR-01: 校验编号\nFR-02: 导出结果\n## 验收\nAC-01: FR-01 去重\nAC-02: FR-02 生成报告');
const plan = options => compileWorkflow(goal(), options, capabilities);
const issues = p => validatePlan(p, { capabilities });
const errors = p => issues(p).filter(x => !x.severity || x.severity === 'error');
const role = (p, r) => p.nodes.find(n => n.props.control === r);

describe('WBS, Twin Graph and R1–R8', () => {
  it('compiles a valid three-level graph with rationale and FR/AC mappings', () => {
    const p = plan(); expect(validatePlanSchema(p)).toEqual([]); expect(errors(p)).toEqual([]);
    const worker = p.nodes.find(n => n.props.requirementRefs.includes('FR-01'));
    expect(worker.props.depth).toBe(2);
    const task = p.workflow.groups.find(g => g.id === worker.props.parentId); expect(task.kind).toBe('task');
    expect(p.workflow.groups.find(g => g.id === task.parentId).kind).toBe('phase');
    expect(p.nodes.every(n => n.props.planningRationale.length > 0)).toBe(true);
    expect(role(p, 'gate').props.acceptanceRefs).toEqual(['AC-01', 'AC-02']);
  });
  it('retains bounded loop edges without breaking forward topological layout', () => {
    const p = plan(); expect(p.edges.some(e => e.kind === 'loop')).toBe(true);
    expect(topologicalLevels(p).size).toBe(p.nodes.length); expect(autoLayout(p).edges).toEqual(p.edges);
  });
  it('strict policy inserts a human gate and disabling QA removes model dependency', () => {
    const p = plan({ permissionTier: 'strict' }); expect(role(p, 'human')).toBeTruthy(); expect(errors(p)).toEqual([]);
    expect(role(p, 'qa')).toBeUndefined();
  });
  it('full template includes independent QA and allows assigned healthy capability', () => {
    const p = plan({ template: 'fullstack', qaCapabilityId: 'qa' }); expect(role(p, 'qa')).toBeTruthy(); expect(errors(p)).toEqual([]);
  });
  it('rejects normal cycles even with workflow metadata', () => {
    const p = plan(), w = p.nodes.filter(n => n.props.requirementRefs.length);
    p.edges.push({ id: 'bad1', source: w[0].id, target: w[1].id }, { id: 'bad2', source: w[1].id, target: w[0].id });
    expect(errors(p).some(i => i.rule === 'R2')).toBe(true);
  });
  it('does not accept arbitrary loop-marked edges', () => {
    const p = plan(), w = p.nodes.filter(n => n.props.requirementRefs.length);
    p.edges.push({ id: 'fakeLoop', source: w[1].id, target: w[0].id, kind: 'loop' });
    expect(errors(p).some(i => i.code === 'ILLEGAL_LOOP')).toBe(true);
  });
  it('requires restore target and loop to agree', () => {
    const p = plan(); role(p, 'restore').props.restoreTarget = p.nodes[0].id;
    expect(errors(p).some(i => i.code === 'CHECKPOINT_REFERENCE')).toBe(true);
  });
  it.each([0, -1, 21, 1.5])('rejects unsafe rework limit %s', limit => {
    const p = plan(); p.workflow.maxReworkIterations = limit; expect(errors(p).some(i => i.rule === 'R6')).toBe(true);
  });
  it('reports both FR and AC gaps and locates foreign references', () => {
    const p = plan(); p.nodes.forEach(n => { n.props.requirementRefs = []; n.props.acceptanceRefs = []; });
    p.nodes[1].props.requirementRefs = ['FR-99']; const codes = issues(p).map(i => i.code);
    expect(codes).toEqual(expect.arrayContaining(['FR_UNCOVERED', 'AC_UNCOVERED', 'FR_REFERENCE']));
    expect(issues(p).find(i => i.code === 'FR_REFERENCE').nodeId).toBe(p.nodes[1].id);
  });
  it('checks typed handoff rather than just nonempty contracts', () => {
    const p = plan(), worker = p.nodes.find(n => n.props.requirementRefs.length);
    worker.props.inputContract = [{ name: 'missing', type: 'string', required: true }]; expect(issues(p).some(i => i.code === 'CONTRACT_MISSING')).toBe(true);
    worker.props.inputContract = [{ name: 'source', type: 'file', required: true }]; expect(issues(p).some(i => i.code === 'CONTRACT_TYPE')).toBe(true);
  });
  it('rejects unavailable and wrong-kind capabilities', () => {
    const p = plan(), worker = p.nodes.find(n => n.props.requirementRefs.length);
    worker.props.capabilityId = 'absent'; expect(issues(p).some(i => i.code === 'CAPABILITY_UNAVAILABLE')).toBe(true);
    worker.props.capabilityId = 'qa'; expect(issues(p).some(i => i.code === 'CAPABILITY_UNAVAILABLE')).toBe(true);
  });
  it('flags truly parallel write scopes, including branches with different immediate parents', () => {
    const p = plan(), workers = p.nodes.filter(n => n.props.requirementRefs.length); workers.forEach(n => n.props.fileScope = ['src/**']);
    expect(issues(p).some(i => i.code === 'PARALLEL_WRITES' && i.severity === 'warning')).toBe(true);
    p.edges.push({ id: 'serial', source: workers[0].id, target: workers[1].id });
    expect(issues(p).some(i => i.code === 'PARALLEL_WRITES')).toBe(false);
  });
  it('keeps suggestions and rationale diagnostics nonblocking', () => {
    const p = plan(); p.nodes[1].props.planningRationale = '';
    expect(errors(p)).toEqual([]); expect(issues(p).map(i => i.severity)).toEqual(expect.arrayContaining(['info', 'warning']));
  });
  it('validates hierarchy references and duplicate container IDs', () => {
    const p = plan(); p.workflow.groups.push({ ...p.workflow.groups[0] }); p.nodes[1].props.parentId = 'missing';
    expect(issues(p).map(i => i.code)).toEqual(expect.arrayContaining(['GROUP_ID', 'WBS_PARENT']));
  });
  it('requires an approval gate under strict policy', () => {
    const p = plan(); p.workflow.permissionTier = 'strict'; expect(issues(p).some(i => i.code === 'HUMAN_REQUIRED')).toBe(true);
  });
  it('retains start single-output rule for new workflows', () => {
    const p = plan(); p.edges.push({ id: 'extra', source: p.nodes[0].id, target: p.nodes[2].id }); expect(errors(p).some(i => i.rule === 'R1')).toBe(true);
  });
  it('rejects malformed new contracts before graph traversal', () => {
    const p = plan(); p.nodes[0].props.inputContract = null; expect(() => validatePlan(p)).not.toThrow(); expect(validatePlan(p).length).toBeGreaterThan(0);
  });
  it('retains the 100-node bound after compilation', () => {
    const g = goal(); g.requirements = Array.from({ length: 100 }, (_, i) => ({ ...g.requirements[0], id: `FR-${String(i + 1).padStart(2, '0')}` })); expect(() => compileWorkflow(g)).toThrow(/100 nodes/);
  });
});
