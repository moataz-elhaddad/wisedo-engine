// U5 Deriver (tech-spec 4, component U5). Applies the category config's rules to the buyer's answers:
// option effects (weights, must, prefer, bonus, set) and the config's derive rules (mobile: monthly cap x months +
// down -> derived.maxPrice; other categories: room m2 -> BTU, distance -> screen size, family size -> litres).
//
// It reuses src/profile/build.js (buildNeedProfile + applyDerive), which owns the config semantics, so Layer 1
// and the persona tests build profiles the same way. Nothing here comes from the LLM.
import { buildNeedProfile, dependsOnMet } from '../profile/build.js';
import { answerEntries } from './state.js';

/**
 * Answers plus the defaults buildNeedProfile would apply (a default applies only where its dependsOn holds).
 * Used to evaluate dependsOn when planning ("who" unanswered means "me" for the "use" question).
 * @param {any} config
 * @param {Record<string, any>} answers
 * @returns {Record<string, any>}
 */
export function withDefaults(config, answers) {
  const out = { ...answers };
  for (const s of config.slots) {
    if (s.id in out || s.default === undefined || s.default === null) continue;
    if (!dependsOnMet(s, out)) continue;
    out[s.id] = s.default;
  }
  return out;
}

/**
 * Build the Need Profile from the session state.
 * @param {any} config
 * @param {import('./state.js').SessionState} state
 * @param {{status?: 'complete'|'good_enough'|'incomplete', open?: string[]}} [opts]
 * @returns {import('../contracts.js').NeedProfile}
 */
export function buildProfile(config, state, opts = {}) {
  const profile = buildNeedProfile(config, answerEntries(state), {
    status: opts.status || 'incomplete',
    open: opts.open || [],
    unmapped: state.unmapped,
  });
  return profile;
}

/**
 * Build a hypothetical profile from plain ordered answers (planner and simulate). Defaults apply.
 * @param {any} config
 * @param {{slot: string, value: any, source?: string}[]} entries
 */
export function buildHypothetical(config, entries) {
  return buildNeedProfile(config, entries);
}
