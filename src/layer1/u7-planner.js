// U7 Question planner (tech-spec 4 "Question selection", technical-design-v4 "Question policy"). Deterministic.
//
// Lists the open slots whose conditions are met (always, alwaysIf, dependsOn, askIf), scores each by gain using
// Layer 2 simulate mode, and picks the next question:
//
//   gain(s) = (distinct top-1 picks - 1) + 0.3 x (distinct top-3 sets - 1)      top-1 = product AND shop
//
// Order of choice (phases; technical-design-v4 order, see docs/LAYER1-NOTES.md "Need before money"):
//   A. `always` / `alwaysIf` need questions (groups who, core, followup), in config order, while 2+ answers are
//      possible and the answers can give different #1 picks (judged across money scenarios, see below).
//   B. `always` money questions in config order: payment way, then budget or monthly cap (they depend on pay).
//   C. situational `alwaysIf` questions outside the need groups (urgentDays while White Friday is 1-10 weeks away),
//      when their gain reaches the policy's minimum.
//   D. every other open question by gain: need refinements (pain, keep, storageNeed...), money extras (down,
//      provider), logistics (city, only when offers differ by zone) and preferences. Highest gain first; ties go
//      to config order.
//   E. the brand question, only on a near tie (top 2 from different brands, under 3 points apart), once.
// Nothing is asked whose every answer gives the same #1 pick and shop.
// `manual` slots (cod, shops, compat, brandAvoid, modelInMind) are never asked: text or "Add a detail" only.
//
// While the money is still unknown, phase A judges a need question across money scenarios (each budget preset for
// a cash buyer, each monthly preset for an installment buyer): with no budget every phone is "affordable", so the
// #1 pick would be the same flagship for every need answer and no need question would ever look useful.
//
// Policy (DEFAULT_POLICY): the spec's literal rule is gain >= 1 with every change of #1 product counted
// (LITERAL_POLICY). On the 18 personas that asks a median of 5 questions, above the spec's target of 3, so the
// default adds two documented refinements: a change of the #1 product counts only when it is not a near tie
// (the old #1 trails by 3+ points, the same 3 points as the brand near-tie rule), and a gain question needs
// gain >= 1.3, i.e. a change of the #1 shop alone (same phones, gain exactly 1.0) is not worth a question.
// Both are flagged for the founder in docs/LAYER1-NOTES.md.
import { evalCondition } from '../conditions.js';
import { buildNeedProfile, dependsOnMet } from '../profile/build.js';
import { lastFridayOfNovember } from '../util.js';
import { simulate, outcomeKey, top3Key } from './sim.js';
import { withDefaults } from './u5-derive.js';
import { statedAnswers, answerEntries, isClosed } from './state.js';

export const NEED_GROUPS = new Set(['who', 'core', 'followup']);
export const MIN_GAIN = 1;
/** The spec's rule taken literally. */
export const LITERAL_POLICY = Object.freeze({ minGain: 1, materialPoints: 0 });
/** The default: the literal rule plus the near-tie and shop-only refinements described above. */
export const DEFAULT_POLICY = Object.freeze({ minGain: 1.3, materialPoints: 3 });
export const NEAR_TIE_POINTS = 3;
/** Points of the near-tie probe: just under 3, so a gap of exactly 3 is not a near tie. */
const NEAR_TIE_PROBE = 2.99;
const AMOUNT_SLOT_FOR_PAY = { cash: 'budget', card: 'monthlyCap', finance: 'monthlyCap' };

/**
 * @typedef {Object} OptionEval
 * @property {string} id
 * @property {number} matches        products that fit this answer under the current state (tile count)
 * @property {boolean} visible       zero-match answers are hidden (money answers never are)
 * @property {string[]} [cities]     city question: the city keys this zone option stands for
 */

/**
 * @typedef {Object} SlotEval
 * @property {string} slot
 * @property {OptionEval[]} options
 * @property {number} gain             best gain over scenarios
 * @property {number} distinctTop1     best number of distinct #1 pick@shop over scenarios
 * @property {number} scenarios
 */

/**
 * @typedef {Object} PlanResult
 * @property {'question'|'stop'} kind
 * @property {string} [slot]
 * @property {'always'|'need_gain'|'money'|'situational'|'gain'|'tiebreak'} [phase]
 * @property {SlotEval} [evaluation]
 * @property {string[]} [onlyOptions]   tiebreak: the two brands
 * @property {'no_gain'} [reason]
 * @property {Record<string, number>} [considered]   slot -> gain, for the "questions I skipped" list and logs
 */

/** Weeks until the next White Friday (last Friday of November), from `now`. */
export function saleWeeks(now) {
  const t = typeof now === 'number' ? now : Date.parse(now instanceof Date ? now.toISOString() : now);
  const y = new Date(t).getUTCFullYear();
  let wf = lastFridayOfNovember(y).getTime();
  if (wf < t) wf = lastFridayOfNovember(y + 1).getTime();
  return (wf - t) / (7 * 24 * 3600 * 1000);
}

/** Option ids of a numeric slot's presets, in order (used as money scenarios). */
function presets(config, slotId) {
  const s = config.slots.find((x) => x.id === slotId);
  return s ? s.options.map((o) => o.id) : [];
}

/**
 * Money scenarios while the money is unknown: extra answers to append before simulating a need answer.
 * Returns [[]] (one empty scenario) once the payment way and its amount are known, skipped or not askable.
 * @param {any} config
 * @param {import('./state.js').SessionState} state
 * @returns {{slot: string, value: any}[][]}
 */
export function moneyScenarios(config, state) {
  const has = (id) => config.slots.some((s) => s.id === id);
  if (!has('pay')) return [[]];
  const a = statedAnswers(state);
  const open = (id) => has(id) && !isClosed(state, id);
  const forPay = (pay) => {
    const amount = AMOUNT_SLOT_FOR_PAY[pay];
    if (!amount || !open(amount)) return [[]];
    return presets(config, amount).map((p) => [{ slot: amount, value: p }]);
  };
  if (a.pay) return forPay(a.pay);
  if (!open('pay')) return [[]]; // skipped: Layer 2 prices as cash with no limit
  // Payment way unknown: a cash buyer at each budget, and a finance buyer at each monthly cap.
  return [
    ...forPay('cash').map((sc) => [{ slot: 'pay', value: 'cash' }, ...sc]),
    ...forPay('finance').map((sc) => [{ slot: 'pay', value: 'finance' }, ...sc]),
  ];
}

/**
 * The answers to simulate for a slot: its options, except
 * - the city question, simulated once per delivery zone (offers differ by zone, not by city), and
 * - the provider question, which offers only providers of the buyer's payment way (a card bank to a card buyer).
 * @param {any} config
 * @param {any} slot
 * @param {Record<string, any>} answers   stated answers with defaults
 */
function answerChoices(config, slot, answers) {
  if (slot.id === 'city' && config.zones) {
    /** @type {Map<string, string[]>} */
    const byZone = new Map();
    for (const o of slot.options) {
      const z = config.zones.cities[o.id] || 'other';
      if (!byZone.has(z)) byZone.set(z, []);
      byZone.get(z).push(o.id);
    }
    return [...byZone.values()].map((cities) => ({ id: cities[0], value: cities[0], cities }));
  }
  const pay = answers.pay;
  return slot.options
    .filter((o) => !o.kind || !pay || o.kind === pay)
    .map((o) => ({ id: o.id, value: slot.multi ? [o.id] : o.id }));
}

/**
 * @typedef {Object} EvalOptions
 * @property {Record<string, any>} [answers]   stated answers with defaults (filters provider options by pay)
 * @property {number} [materialPoints]         0 = literal rule. > 0: a change of the #1 product counts only when the
 *                                             old #1 trails the new one by at least this many points (near ties
 *                                             are left to the brand question). Shop changes always count.
 */

/**
 * Evaluate one slot: tile counts under the current state, then gain per scenario.
 * @param {import('./sim.js').SimContext} ctx
 * @param {any} slot
 * @param {{slot: string, value: any}[]} entries     current answers (ordered)
 * @param {{slot: string, value: any}[][]} scenarios
 * @param {EvalOptions} [opts]
 * @returns {SlotEval}
 */
export function evaluateSlot(ctx, slot, entries, scenarios, opts = {}) {
  const choices = answerChoices(ctx.config, slot, opts.answers || {});
  const neverHide = slot.group === 'money';
  const material = opts.materialPoints || 0;
  /** @type {OptionEval[]} */
  const options = choices.map((c) => {
    const s = simulate(ctx, [...entries, { slot: slot.id, value: c.value }]);
    const o = { id: c.id, matches: s.count, visible: neverHide || s.count > 0 };
    if (c.cities) o.cities = c.cities;
    return o;
  });
  const visible = choices.filter((c, i) => options[i].visible);
  let gain = 0, distinctTop1 = visible.length ? 1 : 0;
  for (const sc of scenarios) {
    const sims = visible.map((c) => simulate(ctx, [...entries, ...sc, { slot: slot.id, value: c.value }]));
    let keys = sims.map(outcomeKey);
    if (material > 0) {
      // Compare each answer with what we would show without asking (the defaults): a new #1 product that beats the
      // old one by less than `material` points is a near tie, not a changed pick.
      const base = simulate(ctx, [...entries, ...sc]);
      keys = sims.map((r, i) => {
        if (!base.top1 || !r.top1 || r.top1 === base.top1) return outcomeKey(r);
        const probe = simulate(ctx, [...entries, ...sc, { slot: slot.id, value: visible[i].value }], { bonus: [{ attr: 'id', op: 'in', value: [base.top1], points: material - 0.01 }] });
        return probe.top1 === base.top1 ? outcomeKey(base) : outcomeKey(r);
      });
    }
    const d1 = new Set(keys).size;
    const d3 = new Set(sims.map(top3Key)).size;
    const g = Math.round(((d1 - 1) + 0.3 * (d3 - 1)) * 100) / 100;
    if (g > gain) gain = g;
    if (d1 > distinctTop1) distinctTop1 = d1;
  }
  return { slot: slot.id, options, gain, distinctTop1, scenarios: scenarios.length };
}

/**
 * Evaluate an always-asked money slot (payment way, budget, monthly cap). Its answers are never hidden. It is
 * asked unless every answer, at every amount preset, gives the same #1 pick and shop (a degenerate catalog).
 * @param {import('./sim.js').SimContext} ctx
 * @param {any} slot
 * @param {{slot: string, value: any}[]} entries
 * @param {import('./state.js').SessionState} state
 * @returns {SlotEval}
 */
function evaluateMoneySlot(ctx, slot, entries, state) {
  const config = ctx.config;
  const outcomes = new Set();
  const tops = new Set();
  const options = slot.options.map((o) => {
    const base = simulate(ctx, [...entries, { slot: slot.id, value: o.id }]);
    let runs = [base];
    if (slot.id === 'pay') {
      const amount = AMOUNT_SLOT_FOR_PAY[o.id];
      if (amount && config.slots.some((s) => s.id === amount) && !isClosed(state, amount)) {
        runs = presets(config, amount).map((p) => simulate(ctx, [...entries, { slot: 'pay', value: o.id }, { slot: amount, value: p }]));
      }
    }
    for (const r of runs) { outcomes.add(outcomeKey(r)); tops.add(top3Key(r)); }
    return { id: o.id, matches: base.count, visible: true };
  });
  const d1 = outcomes.size, d3 = tops.size;
  return { slot: slot.id, options, gain: Math.round(((d1 - 1) + 0.3 * (d3 - 1)) * 100) / 100, distinctTop1: d1, scenarios: 1 };
}

/**
 * Brand near tie: the top 2 are from different brands and less than 3 points apart. Layer 1 sees no scores, so it
 * probes with simulate: give the #2's brand a 2.99-point bonus; if a product of that brand becomes #1, the gap was
 * under 3 points. Returns the two brand option ids to offer, or null.
 * @param {import('./sim.js').SimContext} ctx
 * @param {{slot: string, value: any}[]} entries
 * @param {{products: {id: string, brand: string}[]}} identity
 * @returns {string[]|null}
 */
export function nearTieBrands(ctx, entries, identity) {
  const brandSlot = ctx.config.slots.find((s) => s.id === 'brand');
  if (!brandSlot) return null;
  const base = simulate(ctx, entries);
  if (!base.top1 || base.top3.length < 2) return null;
  const brandOf = (id) => (identity.products.find((p) => p.id === id) || {}).brand;
  const b1 = brandOf(base.top1), b2 = brandOf(base.top3[1]);
  if (!b1 || !b2 || b1 === b2) return null;
  const probe = simulate(ctx, entries, { bonus: [{ attr: 'brand', op: 'in', value: [b2], points: NEAR_TIE_PROBE }] });
  if (!probe.top1 || brandOf(probe.top1) !== b2) return null;
  const optFor = (brand) => (brandSlot.options.find((o) => ((o.effects && o.effects.bonus) || []).some((b) => b.attr === 'brand' && b.value.includes(brand))) || {}).id;
  const ids = [optFor(b1), optFor(b2)];
  return ids.every(Boolean) ? /** @type {string[]} */ (ids) : null;
}

/**
 * @typedef {Object} PlannerPolicy
 * @property {number} [minGain]          ask a gain question only at or above this gain (tech-spec: 1; default 1.3)
 * @property {number} [materialPoints]   see EvalOptions; 0 = the literal rule of the spec (default 3)
 */

/**
 * Pick the next question.
 * @param {import('./sim.js').SimContext & {identity: {products: any[]}, policy?: PlannerPolicy}} ctx
 * @param {import('./state.js').SessionState} state
 * @returns {PlanResult}
 */
export function planNext(ctx, state) {
  const config = ctx.config;
  const policy = { ...DEFAULT_POLICY, ...(ctx.policy || {}) };
  const entries = answerEntries(state).map((e) => ({ slot: e.slot, value: e.value }));
  const stated = statedAnswers(state);
  const eff = withDefaults(config, stated);
  const profile = currentProfile(ctx, entries);
  /** @type {Record<string, any>} */
  const signals = { saleWeeks: saleWeeks(ctx.now) };
  // Gain signals (providerMatters, downChangesPick, urgencyMatters, importCheaper, zoneMatters) mean "this slot's
  // own gain is at least 1": treated as true here, then the gain check decides.
  for (const name of signalNames(config)) if (!(name in signals)) signals[name] = true;
  const condCtx = { profile, signals };

  // Open = not answered, not skipped, not manual (never asked), and its dependsOn holds (defaults count).
  const open = config.slots.filter((s) => !s.manual && !s.tiebreak && !isClosed(state, s.id) && dependsOnMet(s, eff));
  const isAlways = (s) => !!s.always || (!!s.alwaysIf && evalCondition(s.alwaysIf, condCtx));
  const askIfOk = (s) => !s.askIf || evalCondition(s.askIf, condCtx);
  /** @type {Record<string, number>} */
  const considered = {};
  const visibleCount = (e) => e.options.filter((o) => o.visible).length;
  const evalOpts = { answers: eff, materialPoints: policy.materialPoints };

  // A. always need questions in config order, while 2+ answers remain possible and not every answer gives the
  //    same #1 pick and shop (judged across money scenarios while the money is unknown).
  const scenarios = moneyScenarios(config, state);
  for (const s of open.filter((x) => NEED_GROUPS.has(x.group) && isAlways(x) && askIfOk(x))) {
    const e = evaluateSlot(ctx, s, entries, scenarios, { answers: eff });
    considered[s.id] = e.gain;
    if (visibleCount(e) >= 2 && e.distinctTop1 >= 2) return { kind: 'question', slot: s.id, phase: 'always', evaluation: e, considered };
  }
  // B. always money questions in config order: payment way, then budget or monthly cap (they depend on pay).
  for (const s of open.filter((x) => x.group === 'money' && isAlways(x) && askIfOk(x))) {
    const e = evaluateMoneySlot(ctx, s, entries, state);
    considered[s.id] = e.gain;
    if (e.distinctTop1 >= 2) return { kind: 'question', slot: s.id, phase: 'money', evaluation: e, considered };
  }
  // From here the money is known (or was skipped): one scenario, the buyer's own.
  const rest = open.filter((x) => !(NEED_GROUPS.has(x.group) && isAlways(x)) && !(x.group === 'money' && isAlways(x)) && askIfOk(x));
  // C. situational questions (alwaysIf), e.g. "when do you need it?" while White Friday is 1-10 weeks away.
  for (const s of rest.filter(isAlways)) {
    const e = evaluateSlot(ctx, s, entries, [[]], evalOpts);
    considered[s.id] = e.gain;
    if (visibleCount(e) >= 2 && e.gain >= policy.minGain) return { kind: 'question', slot: s.id, phase: 'situational', evaluation: e, considered };
  }
  // D. every other open question by gain (need refinements, money extras, logistics, preferences).
  const evals = rest.filter((x) => !isAlways(x)).map((s) => {
    const e = evaluateSlot(ctx, s, entries, [[]], evalOpts);
    considered[s.id] = e.gain;
    return e;
  });
  const best = bestByGain(evals, visibleCount, policy.minGain);
  if (best) return { kind: 'question', slot: best.slot, phase: NEED_GROUPS.has(groupOf(config, best.slot)) ? 'need_gain' : 'gain', evaluation: best, considered };

  // E. brand question on a near tie, once.
  const brand = config.slots.find((s) => s.id === 'brand');
  if (brand && !isClosed(state, 'brand') && !state.asked.some((q) => q.kind === 'slot' && q.id === 'brand' && q.outcome !== 'superseded')) {
    const two = nearTieBrands(ctx, entries, ctx.identity);
    if (two) {
      const e = evaluateSlot(ctx, { ...brand, options: brand.options.filter((o) => two.includes(o.id)) }, entries, [[]]);
      considered.brand = e.gain;
      return { kind: 'question', slot: 'brand', phase: 'tiebreak', evaluation: e, onlyOptions: two, considered };
    }
  }
  return { kind: 'stop', reason: 'no_gain', considered };
}

/** Highest gain >= minGain with 2+ visible answers; ties go to config order (the input order). */
function bestByGain(evals, visibleCount, minGain) {
  let best = null;
  for (const e of evals) {
    if (e.gain < minGain || e.distinctTop1 < 2 || visibleCount(e) < 2) continue;
    if (!best || e.gain > best.gain) best = e;
  }
  return best;
}

/** Every signal name used in the config's askIf / alwaysIf conditions. */
function signalNames(config) {
  const names = new Set();
  const walk = (c) => {
    if (!c || typeof c !== 'object') return;
    if (typeof c.signal === 'string') names.add(c.signal);
    for (const k of ['all', 'any']) if (Array.isArray(c[k])) c[k].forEach(walk);
    if (c.not) walk(c.not);
  };
  for (const s of config.slots) { walk(s.askIf); walk(s.alwaysIf); }
  return names;
}

function groupOf(config, slotId) {
  const s = config.slots.find((x) => x.id === slotId);
  return s ? s.group : null;
}

/** The current profile (defaults applied) for condition checks such as askIf derived.maxPrice >= 30000. */
function currentProfile(ctx, entries) {
  return buildNeedProfile(ctx.config, entries.map((e) => ({ slot: e.slot, value: e.value, source: /** @type {'answer'} */ ('answer') })));
}
