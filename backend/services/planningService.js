import { parseGoal, goalFromTasks, assertGoal } from '../engine/goalParser.js';
import { confirmSource } from '../../shared/goalSpecSchema.js';
import { AppError } from './errors.js';

export function createPlanningService(llm) {
  return {
    async parse({ text, mode = 'structured' } = {}, options = {}) {
      if (!['structured', 'natural'].includes(mode)) throw new AppError(40001, 'Unknown input mode');
      if (mode === 'natural') return goalFromTasks(text, await llm.decompose(text, options));
      return parseGoal(text);
    },
    validate: assertGoal,
    confirm(spec, id) {
      assertGoal(spec);
      try { return assertGoal(confirmSource(spec, id)); }
      catch (e) { if (e instanceof AppError) throw e; throw new AppError(40001, e.message); }
    },
  };
}
