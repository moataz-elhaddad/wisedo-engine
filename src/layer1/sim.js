// Layer 1's only door into Layer 2 for planning: match() in simulate mode (read-only; returns counts and the
// #1 pick per hypothetical answer). Results are memoised per snapshot object and `now`, because the planner asks
// the same "what if" many times across a session. The buyer never sees simulated picks as results.
import { match } from '../layer2/index.js';
import { buildNeedProfile } from '../profile/build.js';

/** @type {WeakMap<object, Map<string, any>>} */
const MEMO = new WeakMap();
const MEMO_LIMIT = 50000;

/**
 * @typedef {Object} SimContext
 * @property {any} config
 * @property {any} snapshot
 * @property {string|number|Date} now
 */

/**
 * Simulate a hypothetical answer set.
 * @param {SimContext} ctx
 * @param {{slot: string, value: any, source?: string}[]} entries  ordered answers (defaults are applied by the builder)
 * @param {{bonus?: any[], must?: any[]}} [extra]   extra profile terms for probes (near-tie brand bonus; model-in-mind must)
 * @returns {{count: number, stretchCount: number, top1: string|null, top1Shop: string|null, top3: string[], closest: string|null}}
 */
export function simulate(ctx, entries, extra) {
  let memo = MEMO.get(ctx.snapshot);
  if (!memo) { memo = new Map(); MEMO.set(ctx.snapshot, memo); }
  const key = String(ctx.now instanceof Date ? ctx.now.toISOString() : ctx.now) + '|' + ctx.config.id + '|' + JSON.stringify(entries.map((e) => [e.slot, e.value])) + (extra ? '|' + JSON.stringify(extra) : '');
  const hit = memo.get(key);
  if (hit) return hit;
  const profile = buildNeedProfile(ctx.config, entries.map((e) => ({ slot: e.slot, value: e.value, source: /** @type {any} */ (e.source || 'answer') })));
  if (extra && extra.bonus) profile.bonus = [...(profile.bonus || []), ...extra.bonus];
  if (extra && extra.must) profile.must = [...profile.must, ...extra.must];
  const r = match(profile, ctx.snapshot, ctx.now, 'simulate');
  if (memo.size >= MEMO_LIMIT) memo.clear();
  memo.set(key, r);
  return r;
}

/** Outcome of a simulation for the gain formula: the #1 pick AND its shop; "nothing fits" is its own outcome. */
export function outcomeKey(sim) {
  return sim.top1 ? `${sim.top1}@${sim.top1Shop}` : `none:${sim.closest || ''}`;
}

/** The top-3 set (order ignored). */
export function top3Key(sim) {
  return sim.top3.slice().sort().join(',');
}
