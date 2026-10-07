// M7 Final scorer: score = fit + deal bonus + brand bonus, plus 5-year TCO for roles and display.
//   dealBonus = clamp(50 * (ref - effCost) / ref, -5, 5)
//   TCO       = effCost + yearly running cost * years - resale value
import { round2 } from '../util.js';
import { evalCondition } from '../conditions.js';
import { evalFilter } from './m2-constraints.js';
import { DEFAULT_PARAMS } from '../params.js';

/**
 * @param {any} product
 * @param {any} quote
 */
export function dealBonus(product, quote, params = DEFAULT_PARAMS) {
  const ref = product.ref_price_egp;
  if (!(typeof ref === 'number' && ref > 0)) return 0;
  const raw = (params.dealPoints * (ref - quote.effCost)) / ref;
  return round2(Math.max(-params.dealCap, Math.min(params.dealCap, raw)));
}

/**
 * Sum of bonus points whose filter holds (unknown never earns a bonus).
 * @param {any} product
 * @param {import('../contracts.js').Bonus[]} bonuses
 */
export function brandBonus(product, bonuses) {
  let pts = 0;
  for (const b of bonuses || []) if (evalFilter(product, b) === true) pts += b.points;
  return round2(pts);
}

/**
 * Resale value after config.resale.afterYears, when the resale condition holds (phones kept 1-2 years).
 * @param {any} config
 * @param {import('../contracts.js').NeedProfile} profile
 * @param {any} product
 * @returns {{value: number, share: number}|null}
 */
export function resaleValue(config, profile, product) {
  const r = config.resale;
  if (!r || !evalCondition(r.when, { profile })) return null;
  const ref = product.ref_price_egp;
  if (!(typeof ref === 'number' && ref > 0)) return null;
  for (const rule of r.rules || []) {
    const ok = Object.entries(rule.match || {}).every(([k, v]) => (k === 'brand' ? product.brand : product.attrs[k]) === v);
    if (ok) return { value: Math.round(ref * rule.share), share: rule.share };
  }
  return null;
}

/**
 * Yearly running cost in EGP. Supported types: none, fixed ({yearlyEgp}), attr ({attr, factor}: attr * factor).
 * @param {any} config
 * @param {any} product
 */
export function yearlyRunningCost(config, product) {
  const rc = config.runningCost || { type: 'none' };
  if (rc.type === 'fixed') return round2(rc.yearlyEgp || 0);
  if (rc.type === 'attr') {
    const v = product.attrs[rc.attr];
    return typeof v === 'number' ? round2(v * rc.factor) : 0;
  }
  return 0;
}

/**
 * @param {any} config
 * @param {import('../contracts.js').NeedProfile} profile
 * @param {any} product
 * @param {any} quote
 */
export function tco(config, profile, product, quote) {
  const years = config.tcoYears || 5;
  const yearly = yearlyRunningCost(config, product);
  const resale = resaleValue(config, profile, product);
  const total = round2(quote.effCost + yearly * years - (resale ? resale.value : 0));
  return {
    years,
    effCost: quote.effCost,
    yearlyRunningCost: yearly,
    resaleValue: resale ? resale.value : 0,
    resaleShare: resale ? resale.share : 0,
    total,
    relevant: yearly > 0 || !!resale,
  };
}
