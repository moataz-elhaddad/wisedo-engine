// Snapshot preparation: tenant scoping, indexes and per-category constants.
// Prepared data is cached per snapshot object (snapshots are immutable by contract), so repeated calls
// (simulate mode runs many per question) pay the indexing cost once.
import { cmpStr } from '../util.js';
import { UNKNOWN_NORM } from './constants.js';
import { paramsOf } from '../params.js';

/** @type {WeakMap<object, Map<string, any>>} */
const CACHE = new WeakMap();

/**
 * Find a category config by id or alias.
 * @param {any} snapshot
 * @param {string} category
 */
export function resolveConfig(snapshot, category) {
  const configs = snapshot.configs || {};
  if (configs[category]) return configs[category];
  for (const cfg of Object.values(configs)) if ((cfg.aliases || []).includes(category)) return cfg;
  return null;
}

/**
 * Tenant-scoped, indexed view of the snapshot for one category.
 * Rows whose tenant_id differs from snapshot.tenant_id are ignored here and never reach any later step,
 * so a B2B tenant ranks only on its own rows and the consumer app never sees a B2B catalog (BR-30, BR-36).
 * @param {import('../contracts.js').CatalogSnapshot} snapshot
 * @param {string} category
 */
export function prepare(snapshot, category) {
  let byCat = CACHE.get(snapshot);
  if (!byCat) { byCat = new Map(); CACHE.set(snapshot, byCat); }
  const hit = byCat.get(category);
  if (hit) return hit;

  const config = resolveConfig(snapshot, category);
  if (!config) throw new Error(`match: no config for category "${category}" in snapshot ${snapshot.snapshot_id}`);
  const tenant = snapshot.tenant_id;
  const mine = (r) => r && r.tenant_id === tenant;

  const products = (snapshot.products || [])
    .filter((p) => mine(p) && (p.category === config.id || (config.aliases || []).includes(p.category)))
    .slice()
    .sort((a, b) => cmpStr(a.id, b.id));
  const productById = new Map(products.map((p) => [p.id, p]));
  const retailerById = new Map((snapshot.retailers || []).filter(mine).map((r) => [r.id, r]));

  /** @type {Map<string, any[]>} */
  const offersByProduct = new Map(products.map((p) => [p.id, []]));
  for (const o of snapshot.offers || []) {
    if (!mine(o) || !offersByProduct.has(o.product_id)) continue;
    offersByProduct.get(o.product_id).push(o);
  }
  for (const list of offersByProduct.values()) list.sort((a, b) => cmpStr(a.id, b.id));

  const plans = (snapshot.plans || []).filter(mine).slice().sort((a, b) => cmpStr(a.id, b.id));
  const planById = new Map(plans.map((p) => [p.id, p]));
  /** @type {Map<string, any[]>} */
  const plansByRetailer = new Map();
  for (const pl of plans) {
    const key = pl.retailer_id || '*';
    if (!plansByRetailer.has(key)) plansByRetailer.set(key, []);
    plansByRetailer.get(key).push(pl);
  }

  const params = paramsOf(config);
  // Scored attributes (number or boolean) with their normalisation basis.
  const scored = config.attributes.filter((a) => a.type === 'number' || a.type === 'boolean').map((a) => {
    let min, max;
    if (a.basis === 'catalog') {
      const vals = products.map((p) => numeric(p.attrs[a.id])).filter((x) => x !== null);
      min = vals.length ? Math.min(...vals) : 0;
      max = vals.length ? Math.max(...vals) : 1;
    } else { min = a.basis.min; max = a.basis.max; }
    // Category median over every product in scope (not just survivors): used for "top half" (M9).
    const known = products.map((p) => numeric(p.attrs[a.id])).filter((x) => x !== null).sort((x, y) => x - y);
    const median = known.length ? (known.length % 2 ? known[(known.length - 1) / 2] : (known[known.length / 2 - 1] + known[known.length / 2]) / 2) : null;
    return { ...a, min, max, median, unknownNorm: params.unknownNorm };
  });
  const attrById = new Map(config.attributes.map((a) => [a.id, a]));
  const scoredById = new Map(scored.map((a) => [a.id, a]));

  const prepared = { snapshot, config, params, tenant, products, productById, retailerById, offersByProduct, plans, planById, plansByRetailer, scored, scoredById, attrById };
  byCat.set(category, prepared);
  return prepared;
}

/**
 * Attribute value as a number, or null when unknown. Booleans count as 1 / 0.
 * @param {any} v
 * @returns {number|null}
 */
export function numeric(v) {
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}

/**
 * Normalised 0..1 value of a product attribute (flipped when lower is better), or UNKNOWN_NORM when unknown.
 * @param {any} attr  prepared scored attribute
 * @param {any} product
 * @returns {{n: number, known: boolean}}
 */
export function norm(attr, product) {
  const v = numeric(product.attrs ? product.attrs[attr.id] : undefined);
  const un = typeof attr.unknownNorm === 'number' ? attr.unknownNorm : UNKNOWN_NORM;
  if (v === null) return { n: un, known: false };
  if (attr.max === attr.min) return { n: un, known: true };
  let x = (v - attr.min) / (attr.max - attr.min);
  x = Math.max(0, Math.min(1, x));
  return { n: attr.higherIsBetter === false ? 1 - x : x, known: true };
}

/**
 * Value of a product field used by filters and bonuses: brand and id are top-level, the rest are attrs.
 * @param {any} product
 * @param {string} attr
 */
export function fieldValue(product, attr) {
  if (attr === 'brand') return product.brand;
  if (attr === 'id') return product.id;
  return product.attrs ? product.attrs[attr] : undefined;
}
