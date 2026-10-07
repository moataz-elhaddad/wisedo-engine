// M8 Role picker. Roles fill the pick slots in ROLE_ORDER, each role and each product at most once:
//   best_fit     highest score (verified data first, BR-37)
//   best_value   fit >= 80% of best fit's and lower 5-year TCO; ranked by fit / (TCO / minTCO)^0.6
//   premium      a stretch option scoring 3+ points above best fit
//   cheaper      effective cost <= 80% of best fit's and fit >= 70% of best fit's
//   alternative  next highest score from a different brand than best fit
// With maxPicks = 3 and a best-value pick present this is exactly "premium, else cheaper, else alternative".
import { cmpNum, cmpStr } from '../util.js';
import { bestFitOf } from './pipeline.js';
import { ROLE_ORDER } from './constants.js';
import { DEFAULT_PARAMS } from '../params.js';

/**
 * @param {any[]} eligible   ranked (score desc, id asc)
 * @param {any[]} stretch    ranked
 * @param {number} maxPicks
 * @param {typeof DEFAULT_PARAMS} [params]
 * @returns {{role: string, item: any}[]}
 */
export function pickRoles(eligible, stretch, maxPicks, params = DEFAULT_PARAMS) {
  const picks = [];
  const best = bestFitOf(eligible);
  if (!best || maxPicks < 1) return picks;
  const used = new Set([best]);
  picks.push({ role: 'best_fit', item: best });

  const tcos = eligible.map((i) => i.tco.total).filter((t) => t > 0);
  const minTco = tcos.length ? Math.min(...tcos) : 1;
  const valueIndex = (i) => i.fit / Math.pow(Math.max(i.tco.total, minTco) / minTco, params.valueExponent);

  const finders = {
    best_value: () => eligible
      .filter((i) => !used.has(i) && i.fit >= best.fit * params.valueMinFitShare && i.tco.total < best.tco.total)
      .sort((a, b) => cmpNum(valueIndex(b), valueIndex(a)) || cmpStr(a.product.id, b.product.id))[0],
    premium: () => stretch.find((i) => !used.has(i) && i.score >= best.score + params.premiumMinPoints),
    cheaper: () => eligible.find((i) => !used.has(i) && i.quote.effCost <= best.quote.effCost * params.cheaperMaxCostShare && i.fit >= best.fit * params.cheaperMinFitShare),
    alternative: () => eligible.find((i) => !used.has(i) && i.product.brand !== best.product.brand),
  };
  for (const role of ROLE_ORDER.slice(1)) {
    if (picks.length >= maxPicks) break;
    const item = finders[role]();
    if (item) { used.add(item); picks.push({ role, item }); }
  }
  return picks;
}
