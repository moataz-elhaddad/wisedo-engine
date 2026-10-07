// M5 Affordability gate. Ratio = cash out / budget, or monthly / cap (computed in M4).
// eligible <= 1, stretch <= 1.15, otherwise over budget.
import { STRETCH } from './constants.js';

/**
 * @param {number} ratio
 * @param {number} [stretch]  the stretch ceiling (params.stretch)
 * @returns {'eligible'|'stretch'|'over'}
 */
export function affordability(ratio, stretch = STRETCH) {
  if (ratio <= 1) return 'eligible';
  if (ratio <= stretch) return 'stretch';
  return 'over';
}

/**
 * Extra money the buyer would need for a quote (BR-12): over the cash budget, or over the monthly cap.
 * Values trace to: quote.cashOut - money.budget, quote.plan.monthly - money.monthlyCap.
 * @param {any} quote
 * @param {import('./m4-offers.js').Buyer} buyer
 * @returns {{kind: 'budget'|'monthly', amount: number, have: number, need: number}[]}
 */
export function extraNeeded(quote, buyer) {
  const out = [];
  if (quote.plan && buyer.monthlyCap != null && quote.plan.monthly > buyer.monthlyCap) {
    out.push({ kind: 'monthly', amount: quote.plan.monthly - buyer.monthlyCap, have: buyer.monthlyCap, need: quote.plan.monthly });
  }
  if (buyer.budget != null && quote.cashOut > buyer.budget) {
    out.push({ kind: 'budget', amount: Math.round((quote.cashOut - buyer.budget) * 100) / 100, have: buyer.budget, need: quote.cashOut });
  }
  return out;
}
