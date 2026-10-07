// U9 Stop rule (tech-spec 4, component U9). Deterministic.
// Stop when no open slot has gain >= 1 (the planner returns "stop"), at 8 questions, or when the buyer taps
// "show results now".

export const MAX_QUESTIONS = 8;

/**
 * Checked before planning the next question.
 * @param {import('./state.js').SessionState} state
 * @param {{maxQuestions?: number}} [opts]
 * @returns {null | {reason: 'cap'|'show_now'}}
 */
export function stopBeforePlanning(state, opts = {}) {
  if (state.stop && state.stop.reason === 'show_now') return { reason: 'show_now' };
  const cap = opts.maxQuestions ?? MAX_QUESTIONS;
  if (state.asked.filter((q) => q.outcome === 'answered' || q.outcome === 'skipped').length >= cap) return { reason: 'cap' };
  return null;
}

/**
 * Profile status for a stop reason: complete when nothing left could change the pick; good enough otherwise.
 * @param {'no_gain'|'cap'|'show_now'} reason
 * @param {boolean} questionsLeft  the planner still had a question worth asking
 */
export function statusFor(reason, questionsLeft) {
  if (reason === 'no_gain') return 'complete';
  return questionsLeft ? 'good_enough' : 'complete';
}
