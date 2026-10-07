// Contracts shared by Layer 1, Layer 2, the data pipeline and the API.
// Shapes are JSDoc typedefs (easy to port to TypeScript interfaces); validators are plain functions that
// return {ok, errors[]} and never throw. See docs/CONTRACTS.md for the prose version and examples.
import { checkCondition } from './conditions.js';

export const CONTRACT_VERSION = '1.0.0';

/** Tenant id of the consumer app. A B2B company is its own tenant (tech-spec 2, BR-30, BR-36). */
export const CONSUMER_TENANT = 'wisedo';

export const PAY_WAYS = /** @type {const} */ (['cash', 'card', 'finance']);
export const PLAN_KINDS = /** @type {const} */ (['card', 'finance']);
export const COD_VALUES = /** @type {const} */ (['must', 'prefer']);
export const NEED_SOURCES = /** @type {const} */ (['text', 'answer', 'default', 'derived', 'edit']);
export const PROFILE_STATUS = /** @type {const} */ (['complete', 'good_enough', 'incomplete']);
export const RECORD_SOURCES = /** @type {const} */ (['synthetic', 'crawl', 'feed', 'manual', 'upload']);
export const FILTER_OPS = /** @type {const} */ (['>=', '<=', '>', '<', '==', '!=', 'in', 'not_in', 'between']);
export const EXTRA_TYPES = /** @type {const} */ (['install', 'warranty', 'cashback', 'gift', 'bundle']);
export const ROLES = /** @type {const} */ (['best_fit', 'best_value', 'premium', 'cheaper', 'alternative']);
export const MODES = /** @type {const} */ (['rank', 'simulate']);

// ---------------------------------------------------------------------------------------------
// Need Profile (Layer 1 -> Layer 2). tech-spec section 3.
// ---------------------------------------------------------------------------------------------

/**
 * @typedef {Object} Need            One slot value, with where it came from.
 * @property {string} slot            Slot id from the category config.
 * @property {any} value              Option id, option ids (multi), a number (numeric slot) or an object (shops).
 * @property {'text'|'answer'|'default'|'derived'|'edit'} source
 * @property {number} [confidence]    0..1, from the LLM extractor (text only).
 * @property {boolean} [confirmed]    The buyer confirmed or edited the chip.
 * @property {string} [evidence]      The buyer's words that produced it (text only).
 */

/**
 * @typedef {Object} Filter          A must or prefer filter on a product field.
 * @property {string} attr            Attribute id (product.attrs[attr]) or a top-level product field: brand, id.
 * @property {'>='|'<='|'>'|'<'|'=='|'!='|'in'|'not_in'|'between'} op
 * @property {any} value              Number, string, array (in, not_in) or [lo, hi] (between).
 * @property {{ar?: string, en?: string}} [why]  Shown in "what I removed" / "what I gave up".
 * @property {number} [order]         Prefer only: when it was stated. Higher = later = relaxed first.
 * @property {string} [from]          slot:option that produced it (traceability).
 */

/**
 * @typedef {Object} Bonus           Score bonus (brand preference). technical-design-v4: +5.
 * @property {string} attr
 * @property {string} op
 * @property {any} value
 * @property {number} points
 * @property {string} [from]
 */

/**
 * @typedef {Object} Money
 * @property {'cash'|'card'|'finance'|null} pay   null = not known yet; Layer 2 then quotes cash and says so.
 * @property {string|string[]|null} provider       Buyer's bank or finance company id(s); null = any provider.
 * @property {number|null} budget                  Cash budget in EGP.
 * @property {number|null} monthlyCap              Max monthly installment in EGP.
 * @property {number} down                         Down payment in EGP (default 0).
 */

/**
 * @typedef {Object} Logistics
 * @property {number|null} urgentDays      Max delivery days; a preference that M6 relaxes last.
 * @property {boolean} acceptImports       false (default) = grey imports excluded.
 * @property {string|null} city            City key from config.zones.cities; null = nationwide (assumed).
 * @property {'must'|'prefer'|null} cod    Cash on delivery: must = hard filter, prefer = relaxable.
 */

/**
 * @typedef {Object} Shops
 * @property {string[]} prefer   Retailer ids; a relaxable prefer-filter.
 * @property {string[]} avoid    Retailer ids; dropped (hard).
 */

/**
 * @typedef {Object} Unmapped     Something the buyer said that no slot can hold (BR-42).
 * @property {string} text         The buyer's quote.
 * @property {'not_supported'|'no_data'} reason
 * @property {string} [factor]     Factor id from config.factors, when known.
 */

/**
 * @typedef {Object} NeedProfile
 * @property {string} category                 Category config id (e.g. "mobile"); config aliases accepted.
 * @property {Need[]} needs
 * @property {Record<string, number>} weights  Final weights per attribute (base + answers). Empty = config base weights.
 * @property {Filter[]} must
 * @property {Filter[]} prefer
 * @property {Bonus[]} [bonus]
 * @property {Money} money
 * @property {Logistics} logistics
 * @property {Shops} shops
 * @property {Record<string, any>} derived
 * @property {string|null} modelInMind         Product id or model name.
 * @property {Unmapped[]} unmapped
 * @property {string[]} open                   Slots still open (for "questions I skipped").
 * @property {'complete'|'good_enough'|'incomplete'} status
 * @property {string} [profile_version]
 */

/**
 * A profile with every field present and nothing decided. Layer 1 starts from this.
 * @param {string} category
 * @returns {NeedProfile}
 */
export function emptyNeedProfile(category) {
  return {
    category,
    needs: [],
    weights: {},
    must: [],
    prefer: [],
    bonus: [],
    money: { pay: null, provider: null, budget: null, monthlyCap: null, down: 0 },
    logistics: { urgentDays: null, acceptImports: false, city: null, cod: null },
    shops: { prefer: [], avoid: [] },
    derived: {},
    modelInMind: null,
    unmapped: [],
    open: [],
    status: 'incomplete',
    profile_version: CONTRACT_VERSION,
  };
}

// ---------------------------------------------------------------------------------------------
// Market rows. tech-spec section 6. Every row carries tenant_id and source.
// ---------------------------------------------------------------------------------------------

/**
 * @typedef {Object} Product
 * @property {string} id
 * @property {string} tenant_id
 * @property {string} category
 * @property {string} brand
 * @property {string} name
 * @property {number|null} ref_price_egp      Reference price; used for the deal bonus.
 * @property {Record<string, number|boolean|string|null>} attrs   Missing or null = unknown ("not listed").
 * @property {boolean} [popular]
 * @property {string[]} [aliases]
 * @property {string} checked_at              ISO time specs and reference price were last checked (max age 60 days).
 * @property {string} source                  synthetic | crawl | feed | manual | upload
 */

/**
 * @typedef {Object} Retailer
 * @property {string} id
 * @property {string} tenant_id
 * @property {string} name
 * @property {number} trust                   1..10. Risk premium (9 - trust)% on ranking cost.
 * @property {number} return_days
 * @property {boolean} cod                    Offers cash on delivery.
 * @property {string} [base_url]
 * @property {string|null} [affiliate_tag]    Stored for links only. NEVER read by ranking code (BR-22).
 * @property {string} source
 */

/**
 * @typedef {Object} ZoneDelivery
 * @property {number} fee     EGP
 * @property {number} days    Business days; 0 = same day.
 */

/**
 * @typedef {Object} Extra     A gift or perk valued in EGP.
 * @property {'install'|'warranty'|'cashback'|'gift'|'bundle'} type
 * @property {string} label
 * @property {number} value_egp
 * @property {boolean} [card_only]   Counts only when the buyer pays by card (e.g. bank cashback).
 */

/**
 * @typedef {Object} Offer       One product at one retailer.
 * @property {string} id
 * @property {string} tenant_id
 * @property {string} product_id
 * @property {string} retailer_id
 * @property {string} url
 * @property {number} price_egp
 * @property {Record<string, ZoneDelivery>} delivery   By zone id (config.zones.ids). A missing zone = no delivery there.
 * @property {boolean} in_stock
 * @property {boolean} official        false = grey import, no agent warranty.
 * @property {Extra[]} extras
 * @property {boolean} [cod]           Overrides retailer.cod for this offer.
 * @property {string[]} [plan_ids]     Explicit plans; when absent, the retailer's plans apply.
 * @property {string} checked_at       Price and stock check time (max age 24 h).
 * @property {string} [extras_checked_at]  Delivery and gifts check time (max age 72 h); defaults to checked_at.
 * @property {string} source
 */

/**
 * @typedef {Object} Plan        An installment plan. Flat-rate math (technical-design-v4).
 * @property {string} id
 * @property {string} tenant_id
 * @property {string} provider          Provider id (bank or finance company).
 * @property {string} [provider_name]
 * @property {'card'|'finance'} kind
 * @property {number[]} months
 * @property {number} monthly_rate      Flat rate per month, e.g. 0.02.
 * @property {number} admin_share       One-off admin fee as a share of the financed amount.
 * @property {number} min_down_share    Minimum down payment as a share of price.
 * @property {boolean} promo
 * @property {string|null} valid_until  YYYY-MM-DD (end of day UTC) or ISO; null = open-ended.
 * @property {string|null} retailer_id
 * @property {string[]|null} product_override   When set, the plan applies only to these product ids.
 * @property {string} checked_at        Max age 35 days.
 * @property {string} source
 */

/**
 * @typedef {Object} CatalogSnapshot   Everything one match() call ranks against.
 * @property {string} snapshot_id
 * @property {string} tenant_id          Rows with another tenant_id are ignored (defence in depth).
 * @property {Record<string, any>} configs   Category configs by id.
 * @property {Product[]} products
 * @property {Retailer[]} retailers
 * @property {Offer[]} offers
 * @property {Plan[]} plans
 */

// ---------------------------------------------------------------------------------------------
// Match result (Layer 2 output). tech-spec section 5.
// ---------------------------------------------------------------------------------------------

/**
 * @typedef {Object} Quote   An offer priced for this buyer. Every number traces to an offer/plan field or a formula.
 * @property {string} offerId
 * @property {string} retailerId
 * @property {string} retailerName
 * @property {string} url
 * @property {number} price             offer.price_egp
 * @property {number} deliveryFee       offer.delivery[zone].fee
 * @property {number|null} deliveryDays
 * @property {string|null} zone
 * @property {boolean} zoneAssumed      true when the buyer's city is unknown (nationwide, worst zone quoted)
 * @property {boolean} official
 * @property {number} trust
 * @property {string} checkedAt
 * @property {number} ageHours
 * @property {string} source
 * @property {Object|null} plan         {planId, provider, providerName, kind, months, monthlyRate, adminShare, down, monthly, total, financingCost, financingShare, promo, validUntil, fitsCap}
 * @property {{type: string, label: string, value: number}[]} gifts
 * @property {number} giftValue
 * @property {number} installCost
 * @property {number} paid              cash price, or plan total (down included)
 * @property {number} cashOut           paid + delivery + install (money leaving the pocket; affordability for cash)
 * @property {number} effCost           paid + delivery + install - gifts
 * @property {number} rankCost          effCost * (1 + (9 - trust) * 1%)
 * @property {number} ratio             affordability ratio
 */

/**
 * @typedef {Object} Pick
 * @property {'best_fit'|'best_value'|'premium'|'cheaper'|'alternative'} role
 * @property {{id: string, name: string, brand: string}} product
 * @property {number} fit
 * @property {number} score
 * @property {number} dealBonus
 * @property {number} brandBonus
 * @property {'eligible'|'stretch'} affordability
 * @property {Quote} quote
 * @property {Object} tco
 * @property {Object[]} reasons
 * @property {string[]} notListed
 * @property {Object[]} warnings
 * @property {Object[]} otherOffers
 */

/**
 * @typedef {Object} MatchResult
 * @property {'rank'} mode
 * @property {'ok'|'nothing_fits'|'no_match'} status
 * @property {Pick[]} picks
 * @property {Object[]} others
 * @property {Object[]} warnings
 * @property {Object[]} gaveUp
 * @property {Object|null} nothingFits
 * @property {Object[]} trace
 */

/**
 * @typedef {Object} SimulateResult
 * @property {'simulate'} mode
 * @property {number} count          eligible products (ratio <= 1) after relaxing
 * @property {number} stretchCount
 * @property {string|null} top1
 * @property {string[]} top3
 * @property {string|null} closest  when nothing fits: the cheapest product that meets the need
 */

// ---------------------------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------------------------

/** @typedef {{ok: boolean, errors: string[]}} Validation */

function v() {
  /** @type {string[]} */
  const errors = [];
  return {
    errors,
    /** @param {boolean} cond @param {string} msg */
    req(cond, msg) { if (!cond) errors.push(msg); },
    done() { return { ok: errors.length === 0, errors }; },
  };
}
const isStr = (x) => typeof x === 'string' && x.length > 0;
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isDate = (x) => isStr(x) && !Number.isNaN(Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(x) ? x + 'T00:00:00Z' : x));
const isNumOrNull = (x) => x === null || x === undefined || (isNum(x) && x >= 0);

/**
 * @param {any} f
 * @param {string} where
 * @param {(m: string) => void} push
 */
function checkFilter(f, where, push) {
  if (!isObj(f)) return push(where + ': must be an object');
  if (!isStr(f.attr)) push(where + '.attr: required string');
  if (!FILTER_OPS.includes(f.op)) push(where + '.op: one of ' + FILTER_OPS.join(' '));
  if ((f.op === 'in' || f.op === 'not_in') && !Array.isArray(f.value)) push(where + '.value: array required for ' + f.op);
  if (f.op === 'between' && !(Array.isArray(f.value) && f.value.length === 2)) push(where + '.value: [lo, hi] required for between');
}

/**
 * Validate a Need Profile. When a config is given, slot ids and attribute ids are checked against it.
 * @param {any} p
 * @param {any} [config]
 * @returns {Validation}
 */
export function validateNeedProfile(p, config) {
  const c = v();
  if (!isObj(p)) return { ok: false, errors: ['profile: must be an object'] };
  c.req(isStr(p.category), 'category: required string');
  c.req(Array.isArray(p.needs), 'needs: required array');
  for (const [i, n] of (Array.isArray(p.needs) ? p.needs : []).entries()) {
    c.req(isObj(n) && isStr(n.slot), `needs[${i}].slot: required string`);
    if (isObj(n)) c.req(NEED_SOURCES.includes(n.source), `needs[${i}].source: one of ${NEED_SOURCES.join(' ')}`);
    if (isObj(n) && n.confidence !== undefined) c.req(isNum(n.confidence) && n.confidence >= 0 && n.confidence <= 1, `needs[${i}].confidence: 0..1`);
  }
  c.req(isObj(p.weights), 'weights: required object');
  if (isObj(p.weights)) for (const [k, w] of Object.entries(p.weights)) c.req(isNum(w), `weights.${k}: number`);
  c.req(Array.isArray(p.must), 'must: required array');
  c.req(Array.isArray(p.prefer), 'prefer: required array');
  (Array.isArray(p.must) ? p.must : []).forEach((f, i) => checkFilter(f, `must[${i}]`, (m) => c.errors.push(m)));
  (Array.isArray(p.prefer) ? p.prefer : []).forEach((f, i) => checkFilter(f, `prefer[${i}]`, (m) => c.errors.push(m)));
  if (p.bonus !== undefined) {
    c.req(Array.isArray(p.bonus), 'bonus: array');
    (Array.isArray(p.bonus) ? p.bonus : []).forEach((b, i) => c.req(isObj(b) && isStr(b.attr) && isNum(b.points), `bonus[${i}]: {attr, op, value, points}`));
  }
  const m = p.money;
  c.req(isObj(m), 'money: required object');
  if (isObj(m)) {
    c.req(m.pay === null || m.pay === undefined || PAY_WAYS.includes(m.pay), 'money.pay: cash | card | finance | null');
    c.req(m.provider == null || isStr(m.provider) || (Array.isArray(m.provider) && m.provider.every(isStr)), 'money.provider: string, string[] or null');
    c.req(isNumOrNull(m.budget), 'money.budget: number >= 0 or null');
    c.req(isNumOrNull(m.monthlyCap), 'money.monthlyCap: number >= 0 or null');
    c.req(m.down === undefined || m.down === null || (isNum(m.down) && m.down >= 0), 'money.down: number >= 0');
  }
  const l = p.logistics;
  c.req(isObj(l), 'logistics: required object');
  if (isObj(l)) {
    c.req(l.urgentDays == null || (isNum(l.urgentDays) && l.urgentDays >= 0), 'logistics.urgentDays: number >= 0 or null');
    c.req(l.acceptImports === undefined || typeof l.acceptImports === 'boolean', 'logistics.acceptImports: boolean');
    c.req(l.city == null || isStr(l.city), 'logistics.city: string or null');
    c.req(l.cod == null || COD_VALUES.includes(l.cod), 'logistics.cod: must | prefer | null');
  }
  const s = p.shops;
  c.req(isObj(s), 'shops: required object');
  if (isObj(s)) {
    c.req(Array.isArray(s.prefer) && s.prefer.every(isStr), 'shops.prefer: string[]');
    c.req(Array.isArray(s.avoid) && s.avoid.every(isStr), 'shops.avoid: string[]');
  }
  c.req(p.derived === undefined || isObj(p.derived), 'derived: object');
  c.req(p.modelInMind == null || isStr(p.modelInMind), 'modelInMind: string or null');
  c.req(p.unmapped === undefined || (Array.isArray(p.unmapped) && p.unmapped.every((u) => isObj(u) && isStr(u.text))), 'unmapped: [{text, reason}]');
  c.req(p.open === undefined || (Array.isArray(p.open) && p.open.every(isStr)), 'open: string[]');
  c.req(p.status === undefined || PROFILE_STATUS.includes(p.status), 'status: complete | good_enough | incomplete');

  if (config && isObj(config)) {
    const slotIds = new Set((config.slots || []).map((x) => x.id));
    const attrIds = new Set((config.attributes || []).map((x) => x.id));
    for (const n of Array.isArray(p.needs) ? p.needs : []) if (isObj(n) && isStr(n.slot)) c.req(slotIds.has(n.slot), `needs: unknown slot "${n.slot}"`);
    if (isObj(p.weights)) for (const k of Object.keys(p.weights)) c.req(attrIds.has(k), `weights: unknown attribute "${k}"`);
    const fieldOk = (a) => attrIds.has(a) || a === 'brand' || a === 'id';
    for (const f of [...(p.must || []), ...(p.prefer || [])]) if (isObj(f) && isStr(f.attr)) c.req(fieldOk(f.attr), `filter: unknown attribute "${f.attr}"`);
    if (isObj(l) && isStr(l.city) && config.zones) c.req(l.city in config.zones.cities, `logistics.city: unknown city "${l.city}"`);
  }
  return c.done();
}

/** @param {any} r @returns {Validation} */
export function validateProduct(r) {
  const c = v();
  if (!isObj(r)) return { ok: false, errors: ['product: must be an object'] };
  c.req(isStr(r.id), 'id: required');
  c.req(isStr(r.tenant_id), `${r.id}: tenant_id required`);
  c.req(isStr(r.category), `${r.id}: category required`);
  c.req(isStr(r.brand), `${r.id}: brand required`);
  c.req(isStr(r.name), `${r.id}: name required`);
  c.req(r.ref_price_egp === null || (isNum(r.ref_price_egp) && r.ref_price_egp > 0), `${r.id}: ref_price_egp > 0 or null`);
  c.req(isObj(r.attrs), `${r.id}: attrs object required`);
  c.req(r.aliases === undefined || (Array.isArray(r.aliases) && r.aliases.every(isStr)), `${r.id}: aliases string[]`);
  c.req(isDate(r.checked_at), `${r.id}: checked_at ISO time required`);
  c.req(RECORD_SOURCES.includes(r.source), `${r.id}: source one of ${RECORD_SOURCES.join(' ')}`);
  return c.done();
}

/** @param {any} r @returns {Validation} */
export function validateRetailer(r) {
  const c = v();
  if (!isObj(r)) return { ok: false, errors: ['retailer: must be an object'] };
  c.req(isStr(r.id), 'id: required');
  c.req(isStr(r.tenant_id), `${r.id}: tenant_id required`);
  c.req(isStr(r.name), `${r.id}: name required`);
  c.req(isNum(r.trust) && r.trust >= 1 && r.trust <= 10, `${r.id}: trust 1..10`);
  c.req(isNum(r.return_days) && r.return_days >= 0, `${r.id}: return_days >= 0`);
  c.req(typeof r.cod === 'boolean', `${r.id}: cod boolean`);
  c.req(RECORD_SOURCES.includes(r.source), `${r.id}: source one of ${RECORD_SOURCES.join(' ')}`);
  return c.done();
}

/**
 * @param {any} r
 * @param {string[]} [zoneIds]
 * @returns {Validation}
 */
export function validateOffer(r, zoneIds) {
  const c = v();
  if (!isObj(r)) return { ok: false, errors: ['offer: must be an object'] };
  const id = r.id || '(offer)';
  c.req(isStr(r.id), 'id: required');
  c.req(isStr(r.tenant_id), `${id}: tenant_id required`);
  c.req(isStr(r.product_id), `${id}: product_id required`);
  c.req(isStr(r.retailer_id), `${id}: retailer_id required`);
  c.req(isStr(r.url), `${id}: url required`);
  c.req(isNum(r.price_egp) && r.price_egp > 0, `${id}: price_egp > 0`);
  c.req(isObj(r.delivery), `${id}: delivery object by zone required`);
  if (isObj(r.delivery)) {
    for (const [z, d] of Object.entries(r.delivery)) {
      if (zoneIds) c.req(zoneIds.includes(z), `${id}: unknown zone "${z}"`);
      c.req(isObj(d) && isNum(d.fee) && d.fee >= 0 && isNum(d.days) && d.days >= 0, `${id}: delivery.${z} needs fee >= 0 and days >= 0`);
    }
  }
  c.req(typeof r.in_stock === 'boolean', `${id}: in_stock boolean`);
  c.req(typeof r.official === 'boolean', `${id}: official boolean`);
  c.req(Array.isArray(r.extras), `${id}: extras array`);
  for (const [i, e] of (Array.isArray(r.extras) ? r.extras : []).entries()) {
    c.req(isObj(e) && EXTRA_TYPES.includes(e.type) && isNum(e.value_egp) && e.value_egp >= 0, `${id}: extras[${i}] needs type and value_egp >= 0`);
  }
  c.req(r.plan_ids === undefined || (Array.isArray(r.plan_ids) && r.plan_ids.every(isStr)), `${id}: plan_ids string[]`);
  c.req(isDate(r.checked_at), `${id}: checked_at required`);
  c.req(r.extras_checked_at === undefined || isDate(r.extras_checked_at), `${id}: extras_checked_at ISO time`);
  c.req(RECORD_SOURCES.includes(r.source), `${id}: source one of ${RECORD_SOURCES.join(' ')}`);
  return c.done();
}

/** @param {any} r @returns {Validation} */
export function validatePlan(r) {
  const c = v();
  if (!isObj(r)) return { ok: false, errors: ['plan: must be an object'] };
  const id = r.id || '(plan)';
  c.req(isStr(r.id), 'id: required');
  c.req(isStr(r.tenant_id), `${id}: tenant_id required`);
  c.req(isStr(r.provider), `${id}: provider required`);
  c.req(PLAN_KINDS.includes(r.kind), `${id}: kind card | finance`);
  c.req(Array.isArray(r.months) && r.months.length > 0 && r.months.every((n) => Number.isInteger(n) && n > 0), `${id}: months int[] > 0`);
  c.req(isNum(r.monthly_rate) && r.monthly_rate >= 0, `${id}: monthly_rate >= 0`);
  c.req(isNum(r.admin_share) && r.admin_share >= 0, `${id}: admin_share >= 0`);
  c.req(isNum(r.min_down_share) && r.min_down_share >= 0 && r.min_down_share <= 1, `${id}: min_down_share 0..1`);
  c.req(typeof r.promo === 'boolean', `${id}: promo boolean`);
  c.req(r.valid_until === null || isDate(r.valid_until), `${id}: valid_until date or null`);
  c.req(r.retailer_id === null || isStr(r.retailer_id), `${id}: retailer_id string or null`);
  c.req(r.product_override === null || r.product_override === undefined || (Array.isArray(r.product_override) && r.product_override.every(isStr)), `${id}: product_override string[] or null`);
  c.req(isDate(r.checked_at), `${id}: checked_at required`);
  c.req(RECORD_SOURCES.includes(r.source), `${id}: source one of ${RECORD_SOURCES.join(' ')}`);
  return c.done();
}

/**
 * Validate a category config: structure, references between slots/attributes, and factor coverage
 * (every factor has a slot, an attribute/field, or an out-of-scope reason: tech-spec 4.1, BR-26, BR-42).
 * @param {any} cfg
 * @returns {Validation}
 */
export function validateCategoryConfig(cfg) {
  const c = v();
  if (!isObj(cfg)) return { ok: false, errors: ['config: must be an object'] };
  c.req(isStr(cfg.id), 'id: required');
  c.req(isStr(cfg.version), 'version: required');
  c.req(Number.isInteger(cfg.maxMonths) && cfg.maxMonths > 0, 'maxMonths: positive integer');
  c.req(isObj(cfg.freshness) && ['priceStockHours', 'deliveryGiftsHours', 'plansDays', 'specsDays'].every((k) => isNum(cfg.freshness[k])), 'freshness: priceStockHours, deliveryGiftsHours, plansDays, specsDays');
  c.req(isObj(cfg.zones) && Array.isArray(cfg.zones.ids) && isObj(cfg.zones.cities), 'zones: {ids[], cities{}}');
  if (isObj(cfg.zones) && isObj(cfg.zones.cities) && Array.isArray(cfg.zones.ids)) {
    for (const [city, z] of Object.entries(cfg.zones.cities)) c.req(cfg.zones.ids.includes(z), `zones.cities.${city}: unknown zone "${z}"`);
  }
  c.req(Array.isArray(cfg.attributes) && cfg.attributes.length > 0, 'attributes: non-empty array');
  const attrIds = new Set();
  for (const a of cfg.attributes || []) {
    c.req(isStr(a.id) && !attrIds.has(a.id), `attributes: id missing or duplicate (${a.id})`);
    attrIds.add(a.id);
    c.req(isObj(a.label) && isStr(a.label.ar) && isStr(a.label.en), `attributes.${a.id}: label {ar, en}`);
    c.req(['number', 'boolean', 'category'].includes(a.type), `attributes.${a.id}: type number | boolean | category`);
    if (a.type !== 'category') {
      c.req(typeof a.higherIsBetter === 'boolean', `attributes.${a.id}: higherIsBetter boolean`);
      c.req(a.basis === 'catalog' || (isObj(a.basis) && isNum(a.basis.min) && isNum(a.basis.max) && a.basis.max > a.basis.min), `attributes.${a.id}: basis {min < max} or "catalog"`);
      c.req(isObj(a.explain) && isStr(a.explain.en) && isStr(a.explain.ar), `attributes.${a.id}: explain {ar, en}`);
    }
  }
  c.req(isObj(cfg.baseWeights), 'baseWeights: object');
  for (const [k, w] of Object.entries(cfg.baseWeights || {})) {
    c.req(attrIds.has(k), `baseWeights.${k}: unknown attribute`);
    c.req(isNum(w) && w >= 0, `baseWeights.${k}: number >= 0`);
  }
  const fieldOk = (a) => attrIds.has(a) || a === 'brand' || a === 'id';
  c.req(Array.isArray(cfg.slots), 'slots: array');
  const slotIds = new Set();
  const factorIds = new Set((cfg.factors || []).map((f) => f.id));
  for (const s of cfg.slots || []) {
    const w = `slots.${s.id}`;
    c.req(isStr(s.id) && /^[a-z][a-zA-Z0-9]*$/.test(s.id) && !slotIds.has(s.id), `${w}: id missing, duplicate or not short camelCase`);
    slotIds.add(s.id);
    c.req(isObj(s.label) && isStr(s.label.ar) && isStr(s.label.en), `${w}: label {ar, en}`);
    c.req(isObj(s.question) && isStr(s.question.ar) && isStr(s.question.en), `${w}: question {ar, en}`);
    c.req(Array.isArray(s.factors) && s.factors.length > 0, `${w}: factors[] required`);
    for (const f of s.factors || []) c.req(factorIds.has(f), `${w}: unknown factor "${f}"`);
    c.req(Array.isArray(s.options), `${w}: options array`);
    const optIds = new Set();
    for (const o of s.options || []) {
      c.req(isStr(o.id) && /^[a-z0-9_]+$/.test(o.id) && !optIds.has(o.id), `${w}: option id "${o.id}" missing, duplicate or not lowercase`);
      optIds.add(o.id);
      c.req(isObj(o.label) && isStr(o.label.ar) && isStr(o.label.en), `${w}.${o.id}: label {ar, en}`);
      const e = o.effects || {};
      for (const k of Object.keys(e.weights || {})) c.req(attrIds.has(k), `${w}.${o.id}: weight on unknown attribute "${k}"`);
      for (const f of [...(e.must || []), ...(e.prefer || [])]) {
        checkFilter(f, `${w}.${o.id}.filter`, (m) => c.errors.push(m));
        if (isObj(f) && isStr(f.attr)) c.req(fieldOk(f.attr), `${w}.${o.id}: filter on unknown attribute "${f.attr}"`);
      }
      for (const b of e.bonus || []) c.req(isObj(b) && fieldOk(b.attr) && isNum(b.points), `${w}.${o.id}: bonus {attr, op, value, points}`);
      for (const k of Object.keys(e.set || {})) c.req(/^(money|logistics|derived|shops)\./.test(k), `${w}.${o.id}: set path "${k}" must start with money., logistics., derived. or shops.`);
    }
    if (s.numeric) c.req(isStr(s.numeric.path), `${w}: numeric.path required`);
    for (const k of ['askIf', 'alwaysIf']) if (s[k]) checkCondition(s[k], `${w}.${k}`).forEach((m) => c.errors.push(m));
    if (s.default !== undefined && s.default !== null && !s.numeric) c.req(optIds.has(s.default), `${w}: default "${s.default}" is not an option`);
  }
  // The city slot's options and zones.cities must be the same set (a city Layer 1 reads must be answerable).
  const citySlot = (cfg.slots || []).find((s) => s.id === 'city');
  if (citySlot && isObj(cfg.zones) && isObj(cfg.zones.cities)) {
    const opts = new Set(citySlot.options.map((o) => o.id));
    for (const k of Object.keys(cfg.zones.cities)) c.req(opts.has(k), `slots.city: missing option for zones.cities.${k}`);
    for (const k of opts) c.req(k in cfg.zones.cities, `slots.city: option "${k}" has no zone in zones.cities`);
  }
  // dependsOn references
  for (const s of cfg.slots || []) {
    for (const [dep, vals] of Object.entries(s.dependsOn || {})) {
      const t = (cfg.slots || []).find((x) => x.id === dep);
      c.req(!!t, `slots.${s.id}.dependsOn: unknown slot "${dep}"`);
      if (t) for (const val of vals) c.req(t.options.some((o) => o.id === val), `slots.${s.id}.dependsOn.${dep}: unknown option "${val}"`);
    }
  }
  for (const ch of cfg.checks || []) {
    c.req(isStr(ch.id) && isObj(ch.message) && isStr(ch.message.en), `checks: {id, when, message{ar,en}}`);
    checkCondition(ch.when, `checks.${ch.id}.when`).forEach((m) => c.errors.push(m));
  }
  // Factor coverage (tech-spec 4.1: a factor in none of slot / attribute / out-of-scope fails the publish check)
  c.req(Array.isArray(cfg.factors) && cfg.factors.length > 0, 'factors: non-empty array');
  for (const f of cfg.factors || []) {
    const w = `factors.${f.id}`;
    c.req(['covered', 'partial', 'not_yet', 'out_of_scope'].includes(f.status), `${w}: status covered | partial | not_yet | out_of_scope`);
    const via = Array.isArray(f.via) ? f.via : [];
    if (f.status === 'covered' || f.status === 'partial') c.req(via.length > 0, `${w}: covered/partial factor needs via[]`);
    else c.req(isStr(f.reason), `${w}: not_yet/out_of_scope factor needs a reason`);
    for (const x of via) {
      if (x.slot) c.req(slotIds.has(x.slot), `${w}: via unknown slot "${x.slot}"`);
      if (x.attribute) c.req(attrIds.has(x.attribute), `${w}: via unknown attribute "${x.attribute}"`);
    }
  }
  c.req(isObj(cfg.runningCost) && isStr(cfg.runningCost.type), 'runningCost: {type}');
  c.req(cfg.resale === null || isObj(cfg.resale), 'resale: object or null');
  c.req(isNum(cfg.installCost) && cfg.installCost >= 0, 'installCost: number >= 0');
  c.req(isObj(cfg.season), 'season: object');
  return c.done();
}

/**
 * Validate a whole snapshot (every row, plus references between rows).
 * @param {any} snap
 * @returns {Validation}
 */
export function validateSnapshot(snap) {
  const c = v();
  if (!isObj(snap)) return { ok: false, errors: ['snapshot: must be an object'] };
  c.req(isStr(snap.snapshot_id), 'snapshot_id: required');
  c.req(isStr(snap.tenant_id), 'tenant_id: required');
  c.req(isObj(snap.configs), 'configs: object by category id');
  for (const [k, cfg] of Object.entries(snap.configs || {})) for (const e of validateCategoryConfig(cfg).errors) c.errors.push(`configs.${k}.${e}`);
  const zoneIds = [...new Set(Object.values(snap.configs || {}).flatMap((cfg) => (cfg.zones && cfg.zones.ids) || []))];
  for (const key of ['products', 'retailers', 'offers', 'plans']) c.req(Array.isArray(snap[key]), `${key}: array`);
  const pIds = new Set(), rIds = new Set(), plIds = new Set();
  for (const r of snap.products || []) { validateProduct(r).errors.forEach((e) => c.errors.push('products: ' + e)); pIds.add(r.id); }
  for (const r of snap.retailers || []) { validateRetailer(r).errors.forEach((e) => c.errors.push('retailers: ' + e)); rIds.add(r.id); }
  for (const r of snap.plans || []) { validatePlan(r).errors.forEach((e) => c.errors.push('plans: ' + e)); plIds.add(r.id); }
  for (const r of snap.offers || []) {
    validateOffer(r, zoneIds.length ? zoneIds : undefined).errors.forEach((e) => c.errors.push('offers: ' + e));
    c.req(pIds.has(r.product_id), `offers: ${r.id} references unknown product ${r.product_id}`);
    c.req(rIds.has(r.retailer_id), `offers: ${r.id} references unknown retailer ${r.retailer_id}`);
    for (const pl of r.plan_ids || []) c.req(plIds.has(pl), `offers: ${r.id} references unknown plan ${pl}`);
  }
  for (const r of snap.plans || []) if (r.retailer_id) c.req(rIds.has(r.retailer_id), `plans: ${r.id} references unknown retailer ${r.retailer_id}`);
  return c.done();
}

/**
 * Light structural check of a match() result.
 * @param {any} r
 * @returns {Validation}
 */
export function validateMatchResult(r) {
  const c = v();
  if (!isObj(r)) return { ok: false, errors: ['result: must be an object'] };
  c.req(MODES.includes(r.mode), 'mode: rank | simulate');
  if (r.mode === 'simulate') {
    c.req(isNum(r.count), 'count: number');
    c.req(r.top1 === null || isStr(r.top1), 'top1: string or null');
    c.req(Array.isArray(r.top3) && r.top3.length <= 3, 'top3: up to 3 ids');
    return c.done();
  }
  c.req(['ok', 'nothing_fits', 'no_match'].includes(r.status), 'status: ok | nothing_fits | no_match');
  for (const key of ['picks', 'others', 'warnings', 'gaveUp', 'trace']) c.req(Array.isArray(r[key]), `${key}: array`);
  const roles = new Set();
  for (const p of r.picks || []) {
    c.req(ROLES.includes(p.role), `picks: unknown role ${p.role}`);
    c.req(!roles.has(p.role), `picks: duplicate role ${p.role}`);
    roles.add(p.role);
    c.req(isObj(p.quote) && isNum(p.quote.effCost), `picks.${p.role}: quote with effCost`);
  }
  if (r.status !== 'ok') c.req(r.picks.length === 0 && isObj(r.nothingFits), 'nothing_fits/no_match: no picks and a nothingFits block');
  return c.done();
}
