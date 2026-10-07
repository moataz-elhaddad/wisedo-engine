// M1 Candidate loader: the category's products in scope that have at least one fresh, in-stock offer.
// "Fresh" uses the price/stock limit from config.freshness (24 h for mobiles, tech-spec 7).
// Products whose specs and reference price are older than specsDays are not ranked either.
import { toMs, HOUR_MS, DAY_MS } from '../util.js';

/**
 * Is the offer's price and stock fresh at `nowMs`?
 * @param {any} offer
 * @param {any} config
 * @param {number} nowMs
 */
export function offerFresh(offer, config, nowMs) {
  const age = nowMs - toMs(offer.checked_at);
  return Number.isFinite(age) && age <= config.freshness.priceStockHours * HOUR_MS;
}

/**
 * @param {any} prep   prepared snapshot (snapshot.js)
 * @param {number} nowMs
 * @returns {{candidates: any[], removed: {productId: string, reason: string}[]}}
 */
export function loadCandidates(prep, nowMs) {
  const { config } = prep;
  const specsLimit = config.freshness.specsDays * DAY_MS;
  const candidates = [];
  const removed = [];
  for (const product of prep.products) {
    const specAge = nowMs - toMs(product.checked_at);
    if (!(specAge <= specsLimit)) { removed.push({ productId: product.id, reason: 'stale_specs' }); continue; }
    const offers = prep.offersByProduct.get(product.id) || [];
    const live = offers.filter((o) => o.in_stock && offerFresh(o, config, nowMs) && prep.retailerById.has(o.retailer_id));
    if (live.length === 0) {
      removed.push({ productId: product.id, reason: offers.length === 0 ? 'no_offer' : 'no_fresh_in_stock_offer' });
      continue;
    }
    candidates.push({ product, offers });
  }
  return { candidates, removed };
}
