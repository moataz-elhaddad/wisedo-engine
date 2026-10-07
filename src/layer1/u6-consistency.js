// U6 Consistency checker (tech-spec 4, component U6). Deterministic.
//
// Flags contradictions ("I love Samsung" + "no Samsung") and expectation gaps ("iPhone only" with an 8,000 EGP
// budget) and turns a blocking one into ONE clarifying question with concrete ways out. Non-blocking ones
// (the config's `checks`, e.g. heavy gaming on a low budget) become notes.
//
// Layer 1 knows nothing about prices: an expectation gap is detected through Layer 2's simulate mode only
// ("does anything that meets this need fit this budget?"), never by reading prices.
import { evalCondition } from '../conditions.js';
import { simulate } from './sim.js';
import { answerEntries, statedAnswers } from './state.js';
import { valueLabel } from './u4-confirm.js';

/**
 * @typedef {Object} ClarifyOption
 * @property {string} id
 * @property {{en: string, ar: string}} label
 * @property {{type: 'edit', slot: string, value: any} | {type: 'reopen', slot: string} | {type: 'keep'}} action
 */

/**
 * @typedef {Object} Clarify
 * @property {string} id
 * @property {'contradiction'|'expectation_gap'} type
 * @property {{en: string, ar: string}} question
 * @property {ClarifyOption[]} options
 */

/**
 * @param {import('./sim.js').SimContext & {identity: {products: any[], retailers: any[]}}} ctx
 * @param {import('./state.js').SessionState} state
 * @param {import('../contracts.js').NeedProfile} profile  current profile (defaults applied)
 * @returns {{blocking: Clarify|null, notes: {id: string, message: {en: string, ar: string}}[]}}
 */
export function checkConsistency(ctx, state, profile) {
  const config = ctx.config;
  const notes = (config.checks || [])
    .filter((c) => evalCondition(c.when, { profile }))
    .map((c) => ({ id: `check:${c.id}`, message: c.message }));
  const all = [...contradictions(ctx, state), ...gaps(ctx, state, profile)];
  const blocking = all.find((c) => !state.clarified.includes(c.id)) || null;
  return { blocking, notes };
}

const slotOf = (config, id) => config.slots.find((s) => s.id === id);
const without = (list, x) => (Array.isArray(list) ? list.filter((v) => v !== x) : list);

/** @returns {Clarify[]} */
function contradictions(ctx, state) {
  const config = ctx.config;
  const a = statedAnswers(state);
  /** @type {Clarify[]} */
  const out = [];
  // Same brand liked and avoided.
  for (const b of Array.isArray(a.brand) ? a.brand : []) {
    if (!(Array.isArray(a.brandAvoid) && a.brandAvoid.includes(b))) continue;
    const name = valueLabel(slotOf(config, 'brand'), b);
    out.push({
      id: `brand_conflict:${b}`, type: 'contradiction',
      question: { en: `You said you like ${name.en} and also that you want to avoid it. Which one?`, ar: `قلت إنك بتحب ${name.ar} وكمان مش عايزه. أنهي فيهم؟` },
      options: [
        { id: 'like', label: { en: `I like ${name.en}`, ar: `بحب ${name.ar}` }, action: { type: 'edit', slot: 'brandAvoid', value: nullIfEmpty(without(a.brandAvoid, b)) } },
        { id: 'avoid', label: { en: `Avoid ${name.en}`, ar: `مش عايز ${name.ar}` }, action: { type: 'edit', slot: 'brand', value: nullIfEmpty(without(a.brand, b)) } },
      ],
    });
  }
  // iPhone only, but Apple avoided.
  if (a.os === 'ios' && Array.isArray(a.brandAvoid) && a.brandAvoid.includes('apple')) {
    out.push({
      id: 'ios_vs_apple', type: 'contradiction',
      question: { en: 'You asked for an iPhone but also said no Apple. Which one?', ar: 'طلبت آيفون وكمان قلت مش عايز أبل. أنهي فيهم؟' },
      options: [
        { id: 'iphone', label: { en: 'iPhone', ar: 'آيفون' }, action: { type: 'edit', slot: 'brandAvoid', value: nullIfEmpty(without(a.brandAvoid, 'apple')) } },
        { id: 'android', label: { en: 'Android', ar: 'أندرويد' }, action: { type: 'edit', slot: 'os', value: 'android' } },
      ],
    });
  }
  // Android only, but an Apple Watch that works only with an iPhone.
  if (a.os === 'android' && Array.isArray(a.compat) && a.compat.includes('apple_watch')) {
    out.push({
      id: 'android_vs_apple_watch', type: 'contradiction',
      question: { en: 'An Apple Watch works only with an iPhone, but you asked for Android. Which matters more?', ar: 'ساعة أبل بتشتغل مع آيفون بس، وإنت طالب أندرويد. أنهي أهم؟' },
      options: [
        { id: 'watch', label: { en: 'Keep my Apple Watch working (iPhone)', ar: 'الساعة تشتغل (آيفون)' }, action: { type: 'edit', slot: 'os', value: 'ios' } },
        { id: 'android', label: { en: 'Android anyway', ar: 'أندرويد برضه' }, action: { type: 'edit', slot: 'compat', value: nullIfEmpty(without(a.compat, 'apple_watch')) } },
      ],
    });
  }
  // A shop both preferred and avoided.
  const shops = a.shops || {};
  for (const id of (shops.prefer || []).filter((x) => (shops.avoid || []).includes(x))) {
    const name = ((ctx.identity.retailers || []).find((r) => r.id === id) || { name: id }).name;
    out.push({
      id: `shop_conflict:${id}`, type: 'contradiction',
      question: { en: `You said you prefer ${name} and also want to avoid it. Which one?`, ar: `قلت إنك بتفضّل ${name} وكمان مش عايز تشتري منه. أنهي فيهم؟` },
      options: [
        { id: 'prefer', label: { en: `Prefer ${name}`, ar: `أفضّل ${name}` }, action: { type: 'edit', slot: 'shops', value: { prefer: shops.prefer, avoid: without(shops.avoid, id) } } },
        { id: 'avoid', label: { en: `Avoid ${name}`, ar: `مش من ${name}` }, action: { type: 'edit', slot: 'shops', value: { prefer: without(shops.prefer, id), avoid: shops.avoid } } },
      ],
    });
  }
  return out;
}

/** Expectation gaps, detected with simulate once the buyer's money limit is known. @returns {Clarify[]} */
function gaps(ctx, state, profile) {
  const config = ctx.config;
  const a = statedAnswers(state);
  const amountSlot = typeof a.budget !== 'undefined' ? 'budget' : typeof a.monthlyCap !== 'undefined' ? 'monthlyCap' : null;
  if (!amountSlot) return [];
  const entries = answerEntries(state).map((e) => ({ slot: e.slot, value: e.value }));
  const base = simulate(ctx, entries);
  /** @type {Clarify[]} */
  const out = [];
  const raise = { id: 'raise', label: { en: 'I can pay more', ar: 'أقدر أدفع أكتر' }, action: /** @type {const} */ ({ type: 'reopen', slot: amountSlot }) };
  const keep = { id: 'keep', label: { en: 'Keep my budget and show me the closest', ar: 'خليك على ميزانيتي ووريني الأقرب' }, action: /** @type {const} */ ({ type: 'keep' }) };

  // A hard need (from a slot answer) leaves nothing within the money limit, e.g. "iPhone only" with 8,000 EGP.
  const mustSlots = [...new Set(profile.must.map((m) => String(m.from || '').split(':')[0]).filter((x) => x && x in a))];
  if (!base.top1 && mustSlots.length) {
    const relax = mustSlots.map((slotId) => {
      const slot = slotOf(config, slotId);
      const lbl = valueLabel(slot, a[slotId]);
      return {
        id: `relax:${slotId}`,
        label: { en: `Drop "${lbl.en}"`, ar: `مش لازم "${lbl.ar}"` },
        action: /** @type {const} */ ({ type: 'edit', slot: slotId, value: slot.default !== undefined && slot.default !== null ? slot.default : null }),
      };
    });
    const needs = mustSlots.map((s) => valueLabel(slotOf(config, s), a[s]));
    out.push({
      id: 'budget_gap', type: 'expectation_gap',
      question: {
        en: `Nothing that meets "${needs.map((n) => n.en).join('", "')}" fits this budget. What should I do?`,
        ar: `مفيش حاجة فيها "${needs.map((n) => n.ar).join('"، "')}" في الميزانية دي. أعمل إيه؟`,
      },
      options: [raise, ...relax, keep],
    });
  }

  // The model in mind is out of reach even as a stretch (more than 15% over).
  const model = typeof a.modelInMind === 'string' ? (ctx.identity.products || []).find((p) => p.id === a.modelInMind) : null;
  if (model) {
    const s = simulate(ctx, entries, { must: [{ attr: 'id', op: 'in', value: [model.id] }] });
    if (s.count === 0 && s.stretchCount === 0 && s.closest === model.id) {
      out.push({
        id: 'model_gap', type: 'expectation_gap',
        question: { en: `The ${model.name} is well above this budget. What should I do?`, ar: `الـ ${model.name} أغلى بكتير من الميزانية دي. أعمل إيه؟` },
        options: [raise, { ...keep, label: { en: 'Keep my budget and show what fits', ar: 'خليك على ميزانيتي ووريني اللي يناسب' } }],
      });
    }
  }
  return out;
}

function nullIfEmpty(list) {
  return Array.isArray(list) && list.length ? list : null;
}
