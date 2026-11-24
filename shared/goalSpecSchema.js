export const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const nonempty = (value, max = 4000) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
export const SOURCES = ['doc', 'suggested', 'user_confirmed'];

/** A separate contract deliberately leaves the original TaskSpec wire format unchanged. */
export function validateGoalSpec(spec) {
  const issues = [];
  const add = (path, message, rule = 'R6') => issues.push({ rule, code: 'GOAL_SCHEMA', level: 2, severity: 'error', path, nodeId: '', message });
  if (!record(spec)) { add('goalSpec', 'GoalSpec must be an object'); return issues; }
  if (!nonempty(spec.title, 200)) add('title', 'A title of 1–200 characters is required');
  if (!nonempty(spec.goal, 20000)) add('goal', 'A concrete goal is required');
  if (typeof spec.rawText !== 'string' || new TextEncoder().encode(spec.rawText).length > 204800) add('rawText', 'Source text must fit within 200KB');
  const ids = new Set();
  for (const field of ['requirements', 'acceptanceCriteria', 'inputs', 'outputs', 'constraints', 'assumptions', 'modules']) {
    const items = spec[field];
    if (!Array.isArray(items) || items.length > 100) { add(field, 'Expected an array of at most 100 items'); continue; }
    items.forEach((item, index) => {
      const at = `${field}[${index}]`;
      if (!record(item)) { add(at, 'Expected an object'); return; }
      if (!nonempty(item.id, 128) || !/^[A-Za-z0-9_-]+$/.test(item.id)) add(`${at}.id`, 'Invalid item ID');
      if (ids.has(item.id)) add(`${at}.id`, 'Duplicate item ID', 'R7');
      ids.add(item.id);
      if (!nonempty(item.text)) add(`${at}.text`, 'Item text is required');
      if (!SOURCES.includes(item.source)) add(`${at}.source`, 'Unknown provenance');
      if (!['doc', 'suggested'].includes(item.origin)) add(`${at}.origin`, 'Original provenance must be retained');
      if (item.sourceLine !== null && (!Number.isInteger(item.sourceLine) || item.sourceLine < 1)) add(`${at}.sourceLine`, 'Invalid source line');
      if (field === 'requirements' && !/^FR-\d+$/.test(item.id)) add(`${at}.id`, 'Expected FR-nn');
      if (field === 'acceptanceCriteria') {
        if (!/^AC-\d+$/.test(item.id)) add(`${at}.id`, 'Expected AC-nn');
        if (!Array.isArray(item.requirementRefs) || item.requirementRefs.some(x => typeof x !== 'string')) add(`${at}.requirementRefs`, 'Requirement references must be strings');
      }
      if (field === 'inputs' || field === 'outputs') {
        if (!nonempty(item.name, 100) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(item.name) || ['__proto__', 'constructor', 'prototype'].includes(item.name)) add(`${at}.name`, 'Contract name must be a safe identifier');
        if (!['string', 'number', 'boolean', 'object', 'array', 'file', 'any'].includes(item.type)) add(`${at}.type`, 'Unknown contract type');
        if (typeof item.required !== 'boolean') add(`${at}.required`, 'required must be boolean');
      }
    });
  }
  if (!spec.requirements?.length) add('requirements', 'At least one requirement is required');
  if (!spec.acceptanceCriteria?.length) add('acceptanceCriteria', 'At least one acceptance criterion is required');
  if (Array.isArray(spec.acceptanceCriteria) && Array.isArray(spec.requirements)) {
    const refs = new Set(spec.requirements.map(r => r?.id));
    spec.acceptanceCriteria.forEach((ac, i) => {
      if (record(ac) && Array.isArray(ac.requirementRefs)) for (const ref of ac.requirementRefs) if (!refs.has(ref)) add(`acceptanceCriteria[${i}].requirementRefs`, `Unknown requirement ${ref}`, 'R8');
    });
  }
  return issues;
}

export function confirmSource(spec, id) {
  const next = structuredClone(spec);
  for (const field of ['requirements', 'acceptanceCriteria', 'inputs', 'outputs', 'constraints', 'assumptions', 'modules']) {
    const item = next[field]?.find(x => x.id === id);
    if (item) { item.source = 'user_confirmed'; return next; }
  }
  throw new Error(`Unknown item ${id}`);
}
