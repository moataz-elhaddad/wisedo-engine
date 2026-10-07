// M2 Hard constraints: remove products failing a must-filter (including derived needs written as musts).
// Missing data rule (tech-spec 5, BR-37): a must on an UNKNOWN attribute keeps the product and labels it
// "not listed" instead of removing it. The same filter evaluator serves prefer-filters (M6) and bonuses (M7).
import { fieldValue } from './snapshot.js';
import { asArray } from '../util.js';

/**
 * Evaluate one filter on a product.
 * @param {any} product
 * @param {import('../contracts.js').Filter} f
 * @returns {true|false|'unknown'}
 */
export function evalFilter(product, f) {
  const v = fieldValue(product, f.attr);
  if (v === undefined || v === null) return 'unknown';
  const val = f.value;
  switch (f.op) {
    case '>=': return v >= val;
    case '<=': return v <= val;
    case '>': return v > val;
    case '<': return v < val;
    case '==': return v === val;
    case '!=': return v !== val;
    case 'in': return asArray(val).includes(v);
    case 'not_in': return !asArray(val).includes(v);
    case 'between': return v >= val[0] && v <= val[1];
    default: throw new Error('evalFilter: unknown op ' + f.op);
  }
}

/**
 * @param {any[]} candidates   from M1: {product, offers}
 * @param {import('../contracts.js').Filter[]} must
 * @returns {{kept: any[], removed: {productId: string, reason: string, filter: any}[]}}
 */
export function applyMust(candidates, must) {
  const kept = [];
  const removed = [];
  for (const c of candidates) {
    let failed = null;
    const unknownMust = [];
    for (const f of must) {
      const r = evalFilter(c.product, f);
      if (r === false) { failed = f; break; }
      if (r === 'unknown') unknownMust.push(f);
    }
    if (failed) {
      removed.push({ productId: c.product.id, reason: 'must', filter: failed });
      continue;
    }
    kept.push({ ...c, unknownMust });
  }
  return { kept, removed };
}
