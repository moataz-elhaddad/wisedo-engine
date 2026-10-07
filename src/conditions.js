// The JSON condition language used by category configs (askIf, alwaysIf, checks, derive, resale.when).
// Configs are data, so conditions are data too: no functions inside config files (tech-spec 6, BR-26).
//
// Grammar (documented in docs/CONTRACTS.md, "Conditions"):
//   {"all": [cond, ...]}            every sub-condition holds
//   {"any": [cond, ...]}            at least one holds
//   {"not": cond}                   negation
//   {"slot": "use", "in": ["photo"]}        the slot's answer (any value of a multi slot) is one of these
//   {"slot": "use", "answered": true}       the slot has a non-null answer
//   {"path": "derived.maxPrice", "lte": 12000}   compare a Need Profile field; ops: eq ne gt gte lt lte in exists between
//   {"signal": "importCheaper"}             a fact computed by the caller (Layer 1 via simulate); unknown signals are false
//   {"signal": "saleWeeks", "between": [1, 10]}
import { getPath, asArray } from './util.js';

/**
 * @typedef {Object} ConditionContext
 * @property {any} [profile]   Need Profile (needs[], money, logistics, derived, ...)
 * @property {Record<string, any>} [answers]  Plain slot answers {slotId: value}; used before a profile exists
 * @property {Record<string, any>} [signals]  Facts from Layer 1 (importCheaper, saleWeeks, zoneMatters, ...)
 */

/**
 * Value of a slot from answers or from profile.needs.
 * @param {ConditionContext} ctx
 * @param {string} slotId
 */
export function slotValue(ctx, slotId) {
  if (ctx.answers && slotId in ctx.answers) return ctx.answers[slotId];
  const needs = ctx.profile && Array.isArray(ctx.profile.needs) ? ctx.profile.needs : [];
  for (const n of needs) if (n.slot === slotId) return n.value;
  return undefined;
}

/**
 * Compare one value with the operators present on the condition node.
 * @param {any} v
 * @param {any} c
 */
function compare(v, c) {
  if ('exists' in c) return (v !== undefined && v !== null) === !!c.exists;
  if (v === undefined || v === null) return false;
  if ('eq' in c && !(v === c.eq)) return false;
  if ('ne' in c && !(v !== c.ne)) return false;
  if ('gt' in c && !(v > c.gt)) return false;
  if ('gte' in c && !(v >= c.gte)) return false;
  if ('lt' in c && !(v < c.lt)) return false;
  if ('lte' in c && !(v <= c.lte)) return false;
  if ('between' in c && !(v >= c.between[0] && v <= c.between[1])) return false;
  if ('in' in c && !asArray(v).some((x) => c.in.includes(x))) return false;
  return true;
}

/**
 * Evaluate a condition. A missing condition is true.
 * @param {any} cond
 * @param {ConditionContext} ctx
 * @returns {boolean}
 */
export function evalCondition(cond, ctx) {
  if (cond == null) return true;
  if (cond === true || cond === false) return cond;
  if (Array.isArray(cond.all)) return cond.all.every((c) => evalCondition(c, ctx));
  if (Array.isArray(cond.any)) return cond.any.some((c) => evalCondition(c, ctx));
  if (cond.not !== undefined) return !evalCondition(cond.not, ctx);
  if (typeof cond.slot === 'string') {
    const v = slotValue(ctx, cond.slot);
    if ('answered' in cond) {
      const answered = v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0);
      return answered === !!cond.answered;
    }
    return compare(v, cond);
  }
  if (typeof cond.path === 'string') return compare(getPath(ctx.profile || {}, cond.path), cond);
  if (typeof cond.signal === 'string') {
    const v = ctx.signals ? ctx.signals[cond.signal] : undefined;
    const hasOp = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'between', 'exists'].some((k) => k in cond);
    return hasOp ? compare(v, cond) : !!v;
  }
  throw new Error('Unknown condition shape: ' + JSON.stringify(cond));
}

/**
 * Structural check used by the config validator. Returns a list of problems (empty = valid).
 * @param {any} cond
 * @param {string} where
 * @returns {string[]}
 */
export function checkCondition(cond, where) {
  if (cond == null || cond === true || cond === false) return [];
  if (typeof cond !== 'object') return [where + ': condition must be an object'];
  if (Array.isArray(cond.all)) return cond.all.flatMap((c, i) => checkCondition(c, where + '.all[' + i + ']'));
  if (Array.isArray(cond.any)) return cond.any.flatMap((c, i) => checkCondition(c, where + '.any[' + i + ']'));
  if (cond.not !== undefined) return checkCondition(cond.not, where + '.not');
  if (typeof cond.slot === 'string' || typeof cond.path === 'string' || typeof cond.signal === 'string') return [];
  return [where + ': unknown condition shape'];
}
