// M4 Offer resolver (tech-spec 5.1, formulas from technical-design-v4).
//
// quote(product, offers, plans, buyer) -> per offer: hard drops, soft (relaxable) flags and a priced Quote.
//   Hard drops: out of stock, stale, import when imports are not accepted, avoided shop, no delivery to the
//               buyer's zone, no cash on delivery when it is a must, no plan for the buyer's payment way.
//   Soft flags: slower than urgentDays, not a preferred shop, no COD when COD is preferred. M6 relaxes these.
//
// Plan math (flat rate, technical-design-v4):
//   total   = (P - down) * (1 + admin + rate * n) + down
//   monthly = ceil((total - down) / n)
// Effective cost and ranking cost:
//   effCost  = paid + deliveryFee + installIfNotIncluded - giftValue
//   rankCost = effCost * (1 + (9 - trust) * 1%)
import { toMs, round2, cmpNum, cmpStr, asArray, HOUR_MS, DAY_MS } from '../util.js';
import { offerFresh } from './m1-candidates.js';


const r4 = (x) => Math.round(x * 10000) / 10000;

/**
 * @typedef {Object} Buyer
 * @property {'cash'|'card'|'finance'} pay
 * @property {boolean} payAssumed       pay was null in the profile; quoted as cash
 * @property {string[]|null} providers
 * @property {number|null} budget
 * @property {number|null} monthlyCap
 * @property {number} down
 * @property {number|null} urgentDays
 * @property {boolean} acceptImports
 * @property {string|null} city
 * @property {string|null} zone
 * @property {boolean} zoneAssumed
 * @property {'must'|'prefer'|null} cod
 * @property {Set<string>} avoid
 * @property {Set<string>} prefer
 */

/**
 * The buyer as M4 sees it (tech-spec 5.1 interface), derived from the Need Profile.
 * @param {import('../contracts.js').NeedProfile} profile
 * @param {any} prep
 * @returns {Buyer}
 */
export function buyerFromProfile(profile, prep) {
  const m = profile.money || {};
  const l = profile.logistics || {};
  const s = profile.shops || {};
  const pay = m.pay === 'card' || m.pay === 'finance' || m.pay === 'cash' ? m.pay : 'cash';
  const city = l.city || null;
  const zone = city ? (prep.config.zones.cities[city] || 'other') : null;
  return {
    pay,
    payAssumed: !m.pay,
    providers: m.provider == null ? null : asArray(m.provider),
    budget: typeof m.budget === 'number' ? m.budget : null,
    monthlyCap: pay !== 'cash' && typeof m.monthlyCap === 'number' ? m.monthlyCap : null,
    down: pay !== 'cash' && typeof m.down === 'number' && m.down > 0 ? m.down : 0,
    urgentDays: typeof l.urgentDays === 'number' ? l.urgentDays : null,
    acceptImports: l.acceptImports === true,
    city,
    zone,
    zoneAssumed: !city,
    cod: l.cod === 'must' || l.cod === 'prefer' ? l.cod : null,
    avoid: new Set(s.avoid || []),
    prefer: new Set(s.prefer || []),
  };
}

/**
 * Delivery fee and days for the buyer's zone. Unknown city = nationwide: the offer is kept if it delivers
 * anywhere, and the highest fee and slowest days across its zones are quoted (shown as assumed).
 * @param {any} offer
 * @param {Buyer} buyer
 * @returns {{fee: number, days: number, zone: string|null}|null}
 */
export function deliveryFor(offer, buyer) {
  const d = offer.delivery || {};
  if (buyer.zone) {
    const z = d[buyer.zone];
    return z ? { fee: z.fee, days: z.days, zone: buyer.zone } : null;
  }
  const zones = Object.keys(d).sort();
  if (!zones.length) return null;
  let fee = 0, days = 0;
  for (const k of zones) { fee = Math.max(fee, d[k].fee); days = Math.max(days, d[k].days); }
  return { fee, days, zone: null };
}

/**
 * Plans that apply to an offer: its explicit plan_ids, else the retailer's plans plus retailer-less plans,
 * limited by product_override.
 * @param {any} prep
 * @param {any} offer
 */
export function plansForOffer(prep, offer) {
  let list;
  if (Array.isArray(offer.plan_ids)) list = offer.plan_ids.map((id) => prep.planById.get(id)).filter(Boolean);
  else list = [...(prep.plansByRetailer.get(offer.retailer_id) || []), ...(prep.plansByRetailer.get('*') || [])];
  return list.filter((pl) => !pl.product_override || pl.product_override.includes(offer.product_id));
}

/**
 * Quote every applicable plan term for this buyer and choose one:
 * the lowest total whose monthly fits the cap; if none fits, the lowest monthly (flagged fitsCap: false).
 * @param {any} prep
 * @param {Buyer} buyer
 * @param {any} offer
 * @param {number} nowMs
 * @returns {{plan: any|null, skipped: Record<string, number>}}
 */
export function choosePlan(prep, buyer, offer, nowMs) {
  const cfg = prep.config;
  const P = offer.price_egp;
  const skipped = {};
  const skip = (k) => { skipped[k] = (skipped[k] || 0) + 1; };
  const terms = [];
  for (const pl of plansForOffer(prep, offer)) {
    if (pl.kind !== buyer.pay) { skip('other_payment_way'); continue; }
    if (buyer.providers && !buyer.providers.includes(pl.provider)) { skip('provider_not_usable'); continue; }
    if (pl.valid_until && nowMs > toMs(pl.valid_until)) { skip('expired'); continue; }
    if (!(nowMs - toMs(pl.checked_at) <= cfg.freshness.plansDays * DAY_MS)) { skip('stale_plan'); continue; }
    const minDown = round2(P * (pl.min_down_share || 0));
    if (minDown > buyer.down) { skip('min_down_above_buyer'); continue; }
    const down = Math.min(buyer.down, P);
    for (const n of pl.months) {
      if (n > cfg.maxMonths) { skip('months_above_max'); continue; }
      const total = round2((P - down) * (1 + pl.admin_share + pl.monthly_rate * n) + down);
      const monthly = Math.ceil(round2((total - down) / n));
      terms.push({
        planId: pl.id, provider: pl.provider, providerName: pl.provider_name || pl.provider, kind: pl.kind,
        months: n, monthlyRate: pl.monthly_rate, adminShare: pl.admin_share, minDown, down,
        monthly, total, financingCost: round2(total - P), financingShare: r4((total - P) / P),
        promo: !!pl.promo, validUntil: pl.valid_until || null,
        fitsCap: buyer.monthlyCap == null || monthly <= buyer.monthlyCap,
      });
    }
  }
  if (!terms.length) return { plan: null, skipped };
  const tie = (a, b) => cmpNum(a.months, b.months) || cmpStr(a.planId, b.planId);
  const fits = terms.filter((t) => t.fitsCap);
  if (fits.length) {
    fits.sort((a, b) => cmpNum(a.total, b.total) || cmpNum(a.monthly, b.monthly) || tie(a, b));
    return { plan: fits[0], skipped };
  }
  terms.sort((a, b) => cmpNum(a.monthly, b.monthly) || cmpNum(a.total, b.total) || tie(a, b));
  return { plan: terms[0], skipped };
}

/**
 * Evaluate one offer for this buyer.
 * @param {any} prep
 * @param {Buyer} buyer
 * @param {any} product
 * @param {any} offer
 * @param {number} nowMs
 */
export function evaluateOffer(prep, buyer, product, offer, nowMs) {
  const cfg = prep.config;
  const retailer = prep.retailerById.get(offer.retailer_id);
  /** @type {string[]} */
  const hard = [];
  const soft = { slow: false, notPreferredShop: false, noCodPrefer: false };
  const ev = { offerId: offer.id, retailerId: offer.retailer_id, offer, retailer, hard, soft, quote: null, planSkipped: null };
  if (!retailer) { hard.push('unknown_retailer'); return ev; }

  if (!offer.in_stock) hard.push('out_of_stock');
  const fresh = offerFresh(offer, cfg, nowMs);
  if (!fresh) hard.push('stale');
  if (!offer.official && !buyer.acceptImports) hard.push('import_not_accepted');
  if (buyer.avoid.has(retailer.id)) hard.push('avoided_shop');
  const delivery = deliveryFor(offer, buyer);
  if (!delivery) hard.push('no_delivery_zone');
  const codAvailable = typeof offer.cod === 'boolean' ? offer.cod : !!retailer.cod;
  if (buyer.cod === 'must' && !codAvailable) hard.push('no_cod');

  soft.slow = buyer.urgentDays != null && (!delivery || delivery.days > buyer.urgentDays);
  soft.notPreferredShop = buyer.prefer.size > 0 && !buyer.prefer.has(retailer.id);
  soft.noCodPrefer = buyer.cod === 'prefer' && !codAvailable;

  // Price values of an out-of-stock or stale offer are not trustworthy: no quote.
  if (!offer.in_stock || !fresh || !delivery) return ev;

  const P = offer.price_egp;
  let plan = null;
  if (buyer.pay !== 'cash') {
    const res = choosePlan(prep, buyer, offer, nowMs);
    ev.planSkipped = res.skipped;
    if (!res.plan) { hard.push('no_plan'); return ev; }
    plan = res.plan;
  }

  const extrasAge = nowMs - toMs(offer.extras_checked_at || offer.checked_at);
  const giftsStale = !(extrasAge <= cfg.freshness.deliveryGiftsHours * HOUR_MS);
  const extras = offer.extras || [];
  const installIncluded = extras.some((e) => e.type === 'install');
  const installCost = installIncluded ? 0 : (cfg.installCost || 0);
  // Free installation counts once, as the missing install charge, never again as a gift (technical-design-v4).
  const gifts = giftsStale ? [] : extras
    .filter((e) => e.type !== 'install' && (!e.card_only || buyer.pay === 'card'))
    .map((e) => ({ type: e.type, label: e.label, value: e.value_egp }));
  const giftValue = round2(gifts.reduce((s, g) => s + g.value, 0));

  const paid = plan ? plan.total : P;
  const cashOut = round2(paid + delivery.fee + installCost);
  const effCost = round2(paid + delivery.fee + installCost - giftValue);
  const trustPremiumShare = r4((prep.params.trustPivot - retailer.trust) * prep.params.riskPerTrustPoint);
  const rankCost = round2(effCost * (1 + trustPremiumShare));

  // M5 inputs: cash out / budget, or monthly / cap (and total / budget when both are given).
  const ratios = [];
  if (plan && buyer.monthlyCap) ratios.push(plan.monthly / buyer.monthlyCap);
  if (buyer.budget) ratios.push(cashOut / buyer.budget);
  const ratio = ratios.length ? r4(Math.max(...ratios)) : 0;

  ev.quote = {
    offerId: offer.id, retailerId: retailer.id, retailerName: retailer.name, url: offer.url,
    price: P, deliveryFee: delivery.fee, deliveryDays: delivery.days, zone: delivery.zone, zoneAssumed: !buyer.zone,
    official: offer.official, trust: retailer.trust, returnDays: retailer.return_days, cod: codAvailable,
    checkedAt: offer.checked_at, ageHours: round2((nowMs - toMs(offer.checked_at)) / HOUR_MS), source: offer.source,
    plan, gifts, giftValue, giftsStale, installCost, paid, cashOut, effCost, trustPremiumShare, rankCost, ratio,
  };
  return ev;
}

/**
 * Evaluate every offer of a product.
 * @param {any} prep @param {Buyer} buyer @param {any} product @param {any[]} offers @param {number} nowMs
 */
export function evaluateOffers(prep, buyer, product, offers, nowMs) {
  return offers.map((o) => evaluateOffer(prep, buyer, product, o, nowMs));
}

/**
 * Is an evaluated offer usable under the active soft constraints?
 * @param {any} ev
 * @param {{slow: boolean, shop: boolean, cod: boolean}} active
 */
export function usable(ev, active) {
  if (!ev.quote || ev.hard.length) return false;
  if (active.slow && ev.soft.slow) return false;
  if (active.shop && ev.soft.notPreferredShop) return false;
  if (active.cod && ev.soft.noCodPrefer) return false;
  return true;
}

/**
 * Order offers: affordable first (ratio <= 1), then lowest ranking cost, higher trust, faster delivery,
 * retailer id. Offers that are not affordable sort by ratio first (closest to affordable).
 * @param {any} a @param {any} b
 */
export function compareQuotes(a, b) {
  const qa = a.quote, qb = b.quote;
  const affA = qa.ratio <= 1, affB = qb.ratio <= 1;
  if (affA !== affB) return affA ? -1 : 1;
  if (!affA) { const c = cmpNum(qa.ratio, qb.ratio); if (c) return c; }
  return cmpNum(qa.rankCost, qb.rankCost) || cmpNum(qb.trust, qa.trust) || cmpNum(qa.deliveryDays, qb.deliveryDays) || cmpStr(qa.retailerId, qb.retailerId);
}

/**
 * Best offer for this buyer under the active soft constraints, or null.
 * @param {any[]} evals
 * @param {{slow: boolean, shop: boolean, cod: boolean}} active
 */
export function bestOffer(evals, active) {
  let best = null;
  for (const ev of evals) {
    if (!usable(ev, active)) continue;
    if (!best || compareQuotes(ev, best) < 0) best = ev;
  }
  return best;
}
