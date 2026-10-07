// The tenant's own catalog in D1, read and written in the engine's snapshot shape (docs/CONTRACTS.md).
import { bulkUpsert, runAll } from './sql.js';
import { CONFIGS, SEED, SEED_NOW } from './bundle.js';
import { validateProduct, validateOffer, validateRetailer, validatePlan } from '../src/contracts.js';

const parse = (rows) => rows.map((r) => JSON.parse(r.data));

export const PRODUCT_COLS = ['tenant_id', 'id', 'category', 'brand', 'name', 'ref_price_egp', 'data', 'updated_at'];
export const OFFER_COLS = ['tenant_id', 'id', 'product_id', 'retailer_id', 'price_egp', 'in_stock', 'data', 'updated_at'];

export const productRow = (p, at) => [p.tenant_id, p.id, p.category, p.brand, p.name, p.ref_price_egp ?? null, JSON.stringify(p), at];
export const offerRow = (o, at) => [o.tenant_id, o.id, o.product_id, o.retailer_id, o.price_egp, o.in_stock ? 1 : 0, JSON.stringify(o), at];

/** Zone ids every configured category accepts for offer delivery. */
export const ZONE_IDS = [...new Set(Object.values(CONFIGS).flatMap((c) => (c.zones && c.zones.ids) || []))];

/**
 * The engine's clock. The demo runs on a frozen clock (the sample data's own "now"), so the synthetic prices stay
 * inside the engine's freshness windows; edits are stamped with the same clock. CLOCK=real switches to wall time,
 * which is what real data needs.
 */
export async function dataNow(env, tenant) {
  if (env.CLOCK === 'real') return new Date().toISOString();
  const row = await env.DB.prepare('SELECT value FROM meta WHERE tenant_id = ? AND key = ?').bind(tenant, 'data_now').first();
  return (row && row.value) || SEED_NOW;
}

async function version(env, tenant) {
  const row = await env.DB.prepare('SELECT value FROM meta WHERE tenant_id = ? AND key = ?').bind(tenant, 'version').first();
  return row ? Number(row.value) : 0;
}

/** Statement that bumps the tenant's data version (part of every write batch). */
const bumpSql = (tenant) =>
  `INSERT INTO meta (tenant_id, key, value) VALUES ('${tenant.replace(/'/g, "''")}', 'version', '1') ` +
  `ON CONFLICT (tenant_id, key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)`;

/** Full snapshot of one tenant (rows from D1, category configs bundled with the Worker). */
export async function loadSnapshot(env, tenant) {
  const db = env.DB;
  const [p, o, r, pl, now, ver] = await Promise.all([
    db.prepare('SELECT data FROM products WHERE tenant_id = ? ORDER BY id').bind(tenant).all(),
    db.prepare('SELECT data FROM offers WHERE tenant_id = ? ORDER BY id').bind(tenant).all(),
    db.prepare('SELECT data FROM retailers WHERE tenant_id = ? ORDER BY id').bind(tenant).all(),
    db.prepare('SELECT data FROM plans WHERE tenant_id = ? ORDER BY id').bind(tenant).all(),
    dataNow(env, tenant),
    version(env, tenant),
  ]);
  return {
    snapshot_id: `${tenant}-v${ver}`,
    tenant_id: tenant,
    now,
    configs: CONFIGS,
    products: parse(p.results),
    offers: parse(o.results),
    retailers: parse(r.results),
    plans: parse(pl.results),
  };
}

export async function counts(env, tenant) {
  const q = (t) => env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE tenant_id = ?`).bind(tenant).first('n');
  const [products, offers, retailers, plans] = await Promise.all(['products', 'offers', 'retailers', 'plans'].map(q));
  return { products, offers, retailers, plans };
}

/** Replace the tenant's catalog with the bundled synthetic sample data. */
export async function resetToSample(env, tenant) {
  const at = new Date().toISOString();
  const t = (x) => ({ ...x, tenant_id: tenant });
  const products = SEED.products.map(t), offers = SEED.offers.map(t), retailers = SEED.retailers.map(t), plans = SEED.plans.map(t);
  const esc = tenant.replace(/'/g, "''");
  const sqls = [
    ...['products', 'offers', 'retailers', 'plans'].map((tb) => `DELETE FROM ${tb} WHERE tenant_id = '${esc}'`),
    ...bulkUpsert('retailers', ['tenant_id', 'id', 'name', 'data'], retailers.map((r) => [r.tenant_id, r.id, r.name, JSON.stringify(r)])),
    ...bulkUpsert('plans', ['tenant_id', 'id', 'data'], plans.map((r) => [r.tenant_id, r.id, JSON.stringify(r)])),
    ...bulkUpsert('products', PRODUCT_COLS, products.map((p) => productRow(p, at))),
    ...bulkUpsert('offers', OFFER_COLS, offers.map((o) => offerRow(o, at))),
    ...bulkUpsert('meta', ['tenant_id', 'key', 'value'], [[tenant, 'data_now', SEED_NOW]]),
    bumpSql(tenant),
  ];
  await runAll(env.DB, sqls);
  return { products: products.length, offers: offers.length, retailers: retailers.length, plans: plans.length };
}

// ---------------------------------------------------------------------------------------------
// SKU reads
// ---------------------------------------------------------------------------------------------

export async function listSkus(env, tenant, category) {
  const sql =
    'SELECT p.data AS data, COUNT(o.id) AS offers, MIN(o.price_egp) AS min_price, COALESCE(SUM(o.in_stock), 0) AS in_stock ' +
    'FROM products p LEFT JOIN offers o ON o.tenant_id = p.tenant_id AND o.product_id = p.id ' +
    'WHERE p.tenant_id = ?' + (category ? ' AND p.category = ?' : '') + ' GROUP BY p.id ORDER BY p.brand, p.name';
  const stmt = env.DB.prepare(sql);
  const res = await (category ? stmt.bind(tenant, category) : stmt.bind(tenant)).all();
  return res.results.map((r) => ({ ...JSON.parse(r.data), offer_count: r.offers, min_price_egp: r.min_price, in_stock_offers: r.in_stock }));
}

export async function getProduct(env, tenant, id) {
  const row = await env.DB.prepare('SELECT data FROM products WHERE tenant_id = ? AND id = ?').bind(tenant, id).first();
  return row ? JSON.parse(row.data) : null;
}

export async function getOffer(env, tenant, id) {
  const row = await env.DB.prepare('SELECT data FROM offers WHERE tenant_id = ? AND id = ?').bind(tenant, id).first();
  return row ? JSON.parse(row.data) : null;
}

export async function offersOf(env, tenant, productId) {
  const res = await env.DB.prepare('SELECT data FROM offers WHERE tenant_id = ? AND product_id = ? ORDER BY price_egp, id').bind(tenant, productId).all();
  return parse(res.results);
}

export async function listRetailers(env, tenant) {
  return parse((await env.DB.prepare('SELECT data FROM retailers WHERE tenant_id = ? ORDER BY name').bind(tenant).all()).results);
}

export async function listPlans(env, tenant) {
  return parse((await env.DB.prepare('SELECT data FROM plans WHERE tenant_id = ? ORDER BY id').bind(tenant).all()).results);
}

// ---------------------------------------------------------------------------------------------
// Validation and writes
// ---------------------------------------------------------------------------------------------

/** Contract check plus the category rules: known category, known attributes, attribute types. */
export function checkProduct(p) {
  const errors = [...validateProduct(p).errors];
  const cfg = CONFIGS[p && p.category];
  if (!cfg) errors.push(`${p && p.id}: unknown category "${p && p.category}" (one of ${Object.keys(CONFIGS).join(', ')})`);
  else if (p.attrs && typeof p.attrs === 'object') {
    const defs = new Map(cfg.attributes.map((a) => [a.id, a]));
    for (const [k, v] of Object.entries(p.attrs)) {
      const d = defs.get(k);
      if (!d) { errors.push(`${p.id}: unknown attribute "${k}" for ${cfg.id}`); continue; }
      if (v === null) continue;
      if (d.type === 'number' && !(typeof v === 'number' && Number.isFinite(v))) errors.push(`${p.id}: ${k} must be a number`);
      if (d.type === 'boolean' && typeof v !== 'boolean') errors.push(`${p.id}: ${k} must be true or false`);
      if (d.type === 'category' && typeof v !== 'string') errors.push(`${p.id}: ${k} must be text`);
    }
  }
  return errors;
}

export function checkOffer(o, { productIds, retailerIds, planIds }) {
  const errors = [...validateOffer(o, ZONE_IDS).errors];
  if (o && o.product_id && !productIds.has(o.product_id)) errors.push(`${o.id}: unknown product ${o.product_id}`);
  if (o && o.retailer_id && !retailerIds.has(o.retailer_id)) errors.push(`${o.id}: unknown retailer ${o.retailer_id}`);
  for (const pl of (o && o.plan_ids) || []) if (!planIds.has(pl)) errors.push(`${o.id}: unknown plan ${pl}`);
  return errors;
}

export { validateRetailer, validatePlan };

export async function idSets(env, tenant) {
  const ids = async (t) => new Set((await env.DB.prepare(`SELECT id FROM ${t} WHERE tenant_id = ?`).bind(tenant).all()).results.map((r) => r.id));
  const [productIds, retailerIds, planIds] = await Promise.all([ids('products'), ids('retailers'), ids('plans')]);
  return { productIds, retailerIds, planIds };
}

/** Write products and offers in one batch (one transaction) and bump the data version. */
export async function writeRows(env, tenant, { products = [], offers = [] }) {
  const at = new Date().toISOString();
  await runAll(env.DB, [
    ...bulkUpsert('products', PRODUCT_COLS, products.map((p) => productRow(p, at))),
    ...bulkUpsert('offers', OFFER_COLS, offers.map((o) => offerRow(o, at))),
    bumpSql(tenant),
  ]);
}

export async function deleteProduct(env, tenant, id) {
  const db = env.DB;
  const res = await db.batch([
    db.prepare('DELETE FROM offers WHERE tenant_id = ? AND product_id = ?').bind(tenant, id),
    db.prepare('DELETE FROM products WHERE tenant_id = ? AND id = ?').bind(tenant, id),
    db.prepare(bumpSql(tenant)),
  ]);
  return { offers: res[0].meta.changes, products: res[1].meta.changes };
}

export async function deleteOffer(env, tenant, id) {
  const db = env.DB;
  const res = await db.batch([db.prepare('DELETE FROM offers WHERE tenant_id = ? AND id = ?').bind(tenant, id), db.prepare(bumpSql(tenant))]);
  return { offers: res[0].meta.changes };
}
