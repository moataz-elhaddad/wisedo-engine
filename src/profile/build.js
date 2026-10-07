// Need Profile builder: applies a category config's option effects to slot answers.
//
// This is the deterministic part of Layer 1 (U3 normalised ids in, U5 deriver out). It lives here because
// its semantics are defined by the config schema this slice owns. Layer 1 may call it or replace it, as long
// as it produces the same NeedProfile. Weights, must, prefer and bonus come ONLY from config effects, never
// from the LLM (tech-spec 3, boundary rules).
import { emptyNeedProfile } from '../contracts.js';
import { evalCondition } from '../conditions.js';
import { asArray, setPath, round2 } from '../util.js';

/**
 * @typedef {Object} AnswerEntry
 * @property {string} slot
 * @property {any} value
 * @property {'text'|'answer'|'default'|'derived'|'edit'} [source]
 * @property {number} [confidence]
 * @property {boolean} [confirmed]
 * @property {string} [evidence]
 */

/**
 * @typedef {Object} BuildOptions
 * @property {boolean} [applyDefaults=true]  Fill unanswered slots that have a default (source "default").
 * @property {Record<string, any>} [signals] Facts for conditions (Layer 1 knows them; Layer 2 does not need them).
 * @property {'complete'|'good_enough'|'incomplete'} [status='complete']
 * @property {string[]} [open]
 * @property {import('../contracts.js').Unmapped[]} [unmapped]
 */

/**
 * Build a Need Profile from answers.
 * `answers` is either an ordered array of {slot, value, source} or a plain object {slotId: value}
 * (insertion order is the order the buyer stated things; later prefers are relaxed first).
 * Unknown slot or option ids throw: Layer 1's normaliser (U3) must drop them before calling this.
 *
 * @param {any} config  Category config
 * @param {AnswerEntry[]|Record<string, any>} answers
 * @param {BuildOptions} [opts]
 * @returns {import('../contracts.js').NeedProfile}
 */
export function buildNeedProfile(config, answers, opts = {}) {
  const applyDefaults = opts.applyDefaults !== false;
  /** @type {AnswerEntry[]} */
  const entries = Array.isArray(answers)
    ? answers.map((a) => ({ ...a }))
    : Object.entries(answers || {}).map(([slot, value]) => ({ slot, value, source: 'answer' }));

  const slotById = new Map(config.slots.map((s) => [s.id, s]));
  const errors = [];
  for (const e of entries) if (!slotById.has(e.slot)) errors.push(`unknown slot "${e.slot}"`);
  if (errors.length) throw new Error('buildNeedProfile: ' + errors.join('; '));

  // A later entry for the same slot replaces an earlier one (an edit), keeping the later position.
  const lastIndex = new Map();
  entries.forEach((e, i) => lastIndex.set(e.slot, i));
  const ordered = entries.filter((e, i) => lastIndex.get(e.slot) === i);

  if (applyDefaults) {
    const answered = Object.fromEntries(ordered.map((e) => [e.slot, e.value]));
    for (const s of config.slots) {
      if (s.id in answered || s.default === undefined || s.default === null) continue;
      if (!dependsOnMet(s, answered)) continue;
      answered[s.id] = s.default;
      ordered.push({ slot: s.id, value: s.default, source: 'default' });
    }
  }

  const profile = emptyNeedProfile(config.id);
  profile.weights = { ...config.baseWeights };
  let preferOrder = 0;

  for (const e of ordered) {
    const slot = slotById.get(e.slot);
    const need = { slot: e.slot, value: e.value, source: e.source || 'answer' };
    if (e.confidence !== undefined) need.confidence = e.confidence;
    if (e.confirmed !== undefined) need.confirmed = e.confirmed;
    if (e.evidence !== undefined) need.evidence = e.evidence;
    profile.needs.push(need);

    if (slot.valueShape === 'shops') {
      const v = e.value || {};
      profile.shops = { prefer: asArray(v.prefer).slice(), avoid: asArray(v.avoid).slice() };
      continue;
    }
    if (slot.valueShape === 'product') {
      profile.modelInMind = e.value == null ? null : String(e.value);
      continue;
    }
    if (slot.numeric && typeof e.value === 'number') {
      setPath(profile, slot.numeric.path, e.value);
      continue;
    }
    for (const val of asArray(e.value)) {
      const opt = slot.options.find((o) => o.id === val);
      if (!opt) { errors.push(`slot "${slot.id}" has no option "${val}"`); continue; }
      if (slot.numeric && typeof opt.value === 'number') setPath(profile, slot.numeric.path, opt.value);
      const fx = opt.effects || {};
      for (const [k, w] of Object.entries(fx.weights || {})) profile.weights[k] = (profile.weights[k] || 0) + w;
      for (const f of fx.must || []) profile.must.push({ ...f, from: `${slot.id}:${opt.id}` });
      for (const f of fx.prefer || []) profile.prefer.push({ ...f, order: ++preferOrder, from: `${slot.id}:${opt.id}` });
      for (const b of fx.bonus || []) profile.bonus.push({ ...b, from: `${slot.id}:${opt.id}` });
      for (const [path, value] of Object.entries(fx.set || {})) setPath(profile, path, value);
    }
  }
  if (errors.length) throw new Error('buildNeedProfile: ' + errors.join('; '));

  // Negative weights clamp to 0 (technical-design-v4, "Build context"); round for stable output.
  for (const k of Object.keys(profile.weights)) profile.weights[k] = round2(Math.max(0, profile.weights[k]));

  applyDerive(config, profile);
  profile.status = opts.status || 'complete';
  profile.open = opts.open ? opts.open.slice() : [];
  profile.unmapped = opts.unmapped ? opts.unmapped.map((u) => ({ ...u })) : [];
  return profile;
}

/**
 * @param {any} slot
 * @param {Record<string, any>} answered
 */
export function dependsOnMet(slot, answered) {
  if (!slot.dependsOn) return true;
  return Object.entries(slot.dependsOn).every(([dep, vals]) => asArray(answered[dep]).some((x) => vals.includes(x)));
}

/**
 * Run the config's derive rules on a profile (in place).
 * @param {any} config
 * @param {import('../contracts.js').NeedProfile} profile
 */
export function applyDerive(config, profile) {
  for (const rule of config.derive || []) {
    if (rule.when && !evalCondition(rule.when, { profile })) continue;
    if (rule.type === 'max_price') setPath(profile, rule.target, maxPrice(config, rule, profile.money));
  }
}

/**
 * Rough max price: cash budget, or down + the most the monthly cap can finance under the reference plans.
 * Used for checks and askIf only; Layer 2 always quotes real plans.
 * @param {any} config
 * @param {any} rule
 * @param {import('../contracts.js').Money} money
 * @returns {number|null}
 */
export function maxPrice(config, rule, money) {
  const pay = money.pay;
  if (pay === 'card' || pay === 'finance') {
    if (money.monthlyCap == null) return money.budget != null ? money.budget : null;
    const down = money.down || 0;
    const plans = rule.refPlans.filter((p) => p.months <= config.maxMonths);
    const sameKind = plans.filter((p) => p.kind === pay);
    let best = 0;
    for (const p of sameKind.length ? sameKind : plans) {
      best = Math.max(best, down + (money.monthlyCap * p.months) / (1 + p.adminShare + p.monthlyRate * p.months));
    }
    const fromCap = round2(best);
    return money.budget != null ? Math.min(fromCap, money.budget) : fromCap;
  }
  return money.budget != null ? money.budget : null;
}
