// Deterministic synthetic dataset for the mobile category.
//
//   node data/generate.js        writes data/synthetic/{products,retailers,offers,plans,manifest}.json
//
// SAMPLE DATA ONLY. Every record carries source: "synthetic". Prices, scores, retailers, banks and finance
// companies are invented for testing the engine and must never be presented as real (tech-spec 7).
// Model names are used so Layer 1 phrases can name a model; their specs and prices here are made up.
//
// The same seed always produces byte-identical files. Edge cases are placed explicitly (see EDGE_CASES)
// so tests can rely on them.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SEED = 20261003;
/** The "now" the dataset is built around. Tests pass this same value to match(). */
export const DATA_NOW = '2026-10-03T12:00:00.000Z';
export const TENANT = 'wisedo';
export const SNAPSHOT_ID = 'synthetic-mobile-2026-10-03';
const NOW_MS = Date.parse(DATA_NOW);
const SOURCE = 'synthetic';

/** mulberry32: small, fast, deterministic PRNG. */
function prng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hoursAgo = (h) => new Date(NOW_MS - h * 3600 * 1000).toISOString();
const daysAgo = (d) => hoursAgo(d * 24);

// --------------------------------------------------------------------------------------------
// Products: 40 phones, 11 brands, 3 price tiers. Scores are editorial estimates (synthetic).
// cols: id, brand, name, ref price, popular, series, os, 5g, perf, camera, battery, screen, storage, ram,
//       updates, service, ease, warranty, weight, charging, aliases
// --------------------------------------------------------------------------------------------
const PRODUCTS = [
  // budget (under 12,000)
  ['samsung-a06', 'Samsung', 'Samsung Galaxy A06 64GB', 5500, false, 'entry', 'android', false, 2.5, 3.5, 5000, 5, 64, 4, 4, 9, 8, 24, 189, 25, ['a06', 'galaxy a06']],
  ['hmd-pulse-pro', 'HMD', 'HMD Pulse Pro 128GB', 6200, false, 'entry', 'android', false, 3, 4, 5000, 5, 128, 6, 3, 6, 8, 24, 200, 20, ['pulse pro']],
  ['xiaomi-redmi-14c', 'Xiaomi', 'Xiaomi Redmi 14C 128GB', 6500, true, 'entry', 'android', false, 3, 4, 5160, 5, 128, 4, 2, 6, 6, 12, 204, 18, ['redmi 14c']],
  ['tecno-spark-30', 'Tecno', 'Tecno Spark 30 128GB', 6800, false, 'entry', 'android', false, 3, 4.5, 5000, 5.5, 128, 8, 2, 5, 6, 12, 190, 18, ['spark 30']],
  ['honor-x6c', 'Honor', 'Honor X6c 128GB', 6900, false, 'entry', 'android', false, 3, 4, 5300, 5.5, 128, 6, 2, 6, 6, 12, 195, 35, ['x6c']],
  ['infinix-hot-50', 'Infinix', 'Infinix Hot 50 128GB', 7000, false, 'entry', 'android', false, 3.5, 4.5, 5000, 6, 128, 6, 2, 5, 6, 12, 190, 18, ['hot 50']],
  ['vivo-y19s', 'Vivo', 'Vivo Y19s 128GB', 7500, false, 'entry', 'android', false, 3, 4, 5500, 5.5, 128, 6, 2, 6, 7, 12, 198, 15, ['y19s']],
  ['motorola-g35', 'Motorola', 'Motorola Moto G35 5G 128GB', 8000, false, 'entry', 'android', true, 3.5, 4.5, 5000, 6.5, 128, 4, 2, 5, 7, 12, 185, 18, ['moto g35']],
  ['realme-c75', 'Realme', 'Realme C75 256GB', 8500, false, 'entry', 'android', false, 3.5, 4.5, 6000, 5.5, 256, 8, 2, 5, 6, 12, 196, 45, ['c75']],
  ['oppo-a3', 'Oppo', 'Oppo A3 128GB', 8800, false, 'entry', 'android', false, 3.5, 4.5, 5100, 6, 128, 6, 2, 7, 7, 12, 186, 45, ['oppo a3']],
  ['samsung-a16', 'Samsung', 'Samsung Galaxy A16 128GB', 9500, true, 'entry', 'android', false, 4, 5, 5000, 6, 128, 4, 6, 9, 7, 24, 200, 25, ['a16', 'galaxy a16']],
  ['infinix-note-40', 'Infinix', 'Infinix Note 40 256GB', 10000, false, 'mid', 'android', false, 5, 5.5, 5000, 7, 256, 8, 2, 5, 6, 12, 190, 45, ['note 40']],
  ['xiaomi-redmi-note-14', 'Xiaomi', 'Xiaomi Redmi Note 14 256GB', 10500, true, 'mid', 'android', false, 5, 6.5, 5500, 7.5, 256, 8, 4, 6, 7, 12, 190, 33, ['redmi note 14', 'note 14']],
  ['realme-12', 'Realme', 'Realme 12 256GB', 11500, false, 'mid', 'android', false, 5, 6, 5000, 7, 256, 8, 3, 5, 6, 12, 188, 67, ['realme 12']],
  // mid (12,000 to 25,000)
  ['tecno-camon-30', 'Tecno', 'Tecno Camon 30 256GB', 13000, false, 'mid', 'android', false, 5, null, 5000, 7.5, 256, 8, 3, 5, 6, 12, 190, 70, ['camon 30']],
  ['samsung-a26', 'Samsung', 'Samsung Galaxy A26 5G 256GB', 13500, false, 'mid', 'android', true, 5.5, 6, 5000, 7, 256, 8, 6, 9, 7, 24, 200, 25, ['a26', 'galaxy a26']],
  ['vivo-v40-lite', 'Vivo', 'Vivo V40 Lite 256GB', 14500, false, 'mid', 'android', false, 5, 6.5, 5000, 7.5, 256, 8, 3, 6, 7, 12, 186, 80, ['v40 lite']],
  ['infinix-gt-20-pro', 'Infinix', 'Infinix GT 20 Pro 256GB', 15500, false, 'mid', 'android', true, 7.5, 6, 5000, 8, 256, 12, 2, 5, 6, 12, 194, 45, ['gt 20 pro']],
  ['oppo-reno-13f', 'Oppo', 'Oppo Reno 13F 256GB', 16000, false, 'mid', 'android', false, 5.5, 7, 5800, 8, 256, 8, 4, 7, 7, 12, 192, 45, ['reno 13f']],
  ['xiaomi-redmi-note-14-pro', 'Xiaomi', 'Xiaomi Redmi Note 14 Pro 5G 256GB', 17000, false, 'mid', 'android', true, 6.5, 7.5, 5110, 8.5, 256, 8, 4, 6, 6, 12, 190, 45, ['redmi note 14 pro', 'note 14 pro']],
  ['samsung-a36', 'Samsung', 'Samsung Galaxy A36 5G 256GB', 18000, true, 'mid', 'android', true, 6.5, 7, 5000, 8, 256, 8, 6, 9, 7, 24, 195, 45, ['a36', 'galaxy a36']],
  ['honor-x9c', 'Honor', 'Honor X9c 256GB', 18500, false, 'mid', 'android', true, 6, 7, 6600, 8, 256, 12, 3, 6, 7, 12, 189, 66, ['x9c']],
  ['poco-x7-pro', 'Xiaomi', 'Poco X7 Pro 256GB', 19500, false, 'mid', 'android', true, 8.5, 6.5, 6000, 8, 256, 12, 4, 5, 6, 12, 195, 90, ['poco x7 pro', 'x7 pro']],
  ['realme-14-pro', 'Realme', 'Realme 14 Pro 5G 256GB', 20000, false, 'mid', 'android', true, 6.5, 7.5, 6000, 8.5, 256, 8, 3, 5, 6, 12, 194, 45, ['realme 14 pro']],
  ['motorola-edge-50-neo', 'Motorola', 'Motorola Edge 50 Neo 256GB', 21000, false, 'mid', 'android', true, 6.5, 7.5, 4310, 8.5, 256, 8, 5, 5, 7, 12, 171, 68, ['edge 50 neo']],
  ['oppo-reno-12', 'Oppo', 'Oppo Reno 12 5G 256GB', 22000, false, 'mid', 'android', true, 7, 7.5, 5000, 8, 256, 12, 4, 7, 7, 12, 177, 80, ['reno 12']],
  ['samsung-a56', 'Samsung', 'Samsung Galaxy A56 5G 256GB', 23000, false, 'mid', 'android', true, 7, 7.5, 5000, 8.5, 256, 8, 6, 9, 7, 24, 198, 45, ['a56', 'galaxy a56']],
  ['xiaomi-14t', 'Xiaomi', 'Xiaomi 14T 256GB', 24500, false, 'mid', 'android', true, 8, 8, 5000, 8.5, 256, 12, 5, 6, 6, 12, 193, 67, ['14t']],
  // premium (over 25,000)
  ['apple-iphone-13', 'Apple', 'Apple iPhone 13 128GB', 32000, false, 'flagship', 'ios', true, 8, 8, 3240, 8, 128, 4, 5, 8, 9, 12, 174, 20, ['iphone 13']],
  ['motorola-razr-50', 'Motorola', 'Motorola Razr 50 256GB', 33000, false, 'flagship', 'android', true, 7, 7, 4200, 8.5, 256, 8, 3, 5, 6, 12, 188, 30, ['razr 50']],
  ['samsung-s25-fe', 'Samsung', 'Samsung Galaxy S25 FE 256GB', 35000, false, 'flagship', 'android', true, 8.5, 8.5, 4900, 9, 256, 8, 7, 9, 7, 24, 190, 45, ['s25 fe', 'galaxy s25 fe']],
  ['oppo-reno-13-pro', 'Oppo', 'Oppo Reno 13 Pro 512GB', 36000, false, 'flagship', 'android', true, 8, 8.5, 5800, 9, 512, 12, 4, 7, 7, 12, 195, 80, ['reno 13 pro']],
  ['apple-iphone-15', 'Apple', 'Apple iPhone 15 128GB', 45000, true, 'flagship', 'ios', true, 9, 8.5, 3349, 8.5, 128, 6, 6, 8, 9, 12, 171, 20, ['iphone 15']],
  ['vivo-x200', 'Vivo', 'Vivo X200 512GB', 45000, false, 'flagship', 'android', true, 9, 9.5, 5800, 9, 512, 12, 4, 6, 6, 12, 202, 90, ['x200']],
  ['samsung-s25', 'Samsung', 'Samsung Galaxy S25 256GB', 48000, false, 'flagship', 'android', true, 9.5, 9, 4000, 9.5, 256, 12, 7, 9, 7, 24, 162, 25, ['s25', 'galaxy s25']],
  ['xiaomi-15', 'Xiaomi', 'Xiaomi 15 512GB', 52000, false, 'flagship', 'android', true, 9.5, 9, 5240, 9, 512, 12, 5, 6, 6, 12, 191, 90, ['xiaomi 15']],
  ['apple-iphone-16', 'Apple', 'Apple iPhone 16 128GB', 55000, false, 'flagship', 'ios', true, 9.5, 9, 3561, 8.5, 128, 8, 7, 8, 9, 12, 170, 25, ['iphone 16']],
  ['honor-magic-7-pro', 'Honor', 'Honor Magic 7 Pro 512GB', 58000, false, 'flagship', 'android', true, 9.5, 9.5, 5850, 9.5, 512, 12, 6, 6, 6, 12, 223, 100, ['magic 7 pro']],
  ['samsung-s25-ultra', 'Samsung', 'Samsung Galaxy S25 Ultra 512GB', 75000, false, 'flagship', 'android', true, 10, 10, 5000, 10, 512, 12, 7, 9, 6, 24, 218, 45, ['s25 ultra', 'galaxy s25 ultra']],
  ['apple-iphone-16-pro', 'Apple', 'Apple iPhone 16 Pro 256GB', 78000, false, 'flagship', 'ios', true, 10, 10, 3582, 9.5, 256, 8, 7, 8, 9, 12, 199, 30, ['iphone 16 pro']],
];

// --------------------------------------------------------------------------------------------
// Retailers (7, invented). Delivery by zone: a missing zone means the shop does not deliver there.
// --------------------------------------------------------------------------------------------
const RETAILERS = [
  { id: 'nile', name: 'Nile Electro', trust: 9, return_days: 14, cod: true, adj: [-0.01, 0.03],
    zones: { greater_cairo: [0, 1, 2], alexandria: [0, 2, 3], other: [50, 3, 5] } },
  { id: 'pharos', name: 'Pharos Digital', trust: 9, return_days: 14, cod: true, adj: [-0.03, 0.01],
    zones: { greater_cairo: [0, 1, 2], alexandria: [0, 1, 3], other: [0, 2, 4] } },
  { id: 'lotus', name: 'Lotus Market', trust: 8, return_days: 14, cod: true, adj: [-0.05, -0.01],
    zones: { greater_cairo: [0, 2, 3], alexandria: [0, 2, 4], other: [30, 3, 6] } },
  { id: 'oasis', name: 'Oasis Online', trust: 8, return_days: 7, cod: false, adj: [-0.04, 0],
    zones: { greater_cairo: [0, 1, 2], alexandria: [0, 1, 2], other: [0, 2, 3] } },
  { id: 'delta', name: 'Delta Mobile', trust: 7, return_days: 7, cod: true, adj: [-0.04, -0.01],
    zones: { greater_cairo: [40, 2, 3], other: [40, 2, 4] } },
  { id: 'khan', name: 'Khan Market Shop', trust: 5, return_days: 0, cod: true, adj: [-0.07, -0.04], imports: true,
    zones: { greater_cairo: [0, 0, 0] } },
  { id: 'sphinx', name: 'Sphinx Store', trust: 8, return_days: 14, cod: true, adj: [-0.02, 0.02],
    zones: { greater_cairo: [25, 1, 2], alexandria: [0, 1, 1] } },
];

// Explicit retailer sets for products the tests and edge cases rely on.
const FORCED_RETAILERS = {
  'apple-iphone-15': ['khan', 'nile', 'oasis', 'pharos'],
  'samsung-a36': ['nile', 'lotus', 'delta', 'sphinx'],
  'xiaomi-redmi-note-14': ['pharos', 'lotus', 'delta'],
  'oppo-reno-13f': ['sphinx', 'nile', 'oasis'],
  'hmd-pulse-pro': ['nile', 'delta'],
  'samsung-a16': ['nile', 'delta', 'khan'],
};

/** Edge cases, applied after generation so they are guaranteed. Documented in docs/BUILD-NOTES.md. */
const EDGE_CASES = {
  missingSpec: { product: 'tecno-camon-30', attr: 'camera' },
  allOffersStale: 'hmd-pulse-pro',
  outOfStock: ['o-samsung-a36-lotus'],
  staleOffers: ['o-xiaomi-redmi-note-14-pharos'],
  staleExtras: ['o-oppo-reno-13f-sphinx'],
  importOffers: 'every offer from khan (official: false)',
  promoEndingSoon: 'nile-sahla-promo (valid_until 2026-10-12)',
  expiredPromo: 'oasis-horus-promo-18 (valid_until 2026-09-30)',
  stalePlan: 'sphinx-qest-18 (checked 40 days ago)',
  minDownPlans: ['khan-store (30%)', 'delta-sahla (20%)'],
  zoneGaps: ['delta: no alexandria', 'khan: greater_cairo only', 'sphinx: no other governorates'],
  productOverridePlan: 'pharos-horus-samsung (Samsung products only)',
};

// --------------------------------------------------------------------------------------------
// Plans. Providers: nilebank and horusbank (card), sahla and qest (finance), khanstore (store finance).
// --------------------------------------------------------------------------------------------
function buildPlans(productIds) {
  const samsung = productIds.filter((id) => id.startsWith('samsung-'));
  const P = (id, retailer_id, provider, provider_name, kind, months, monthly_rate, admin_share, extra = {}) => ({
    id, tenant_id: TENANT, provider, provider_name, kind, months, monthly_rate, admin_share,
    min_down_share: 0, promo: false, valid_until: null, retailer_id, product_override: null,
    checked_at: daysAgo(5), source: SOURCE, ...extra,
  });
  return [
    P('nile-nilebank-card', 'nile', 'nilebank', 'Nile Bank', 'card', [6, 12], 0, 0.05),
    P('nile-sahla-promo', 'nile', 'sahla', 'Sahla Finance', 'finance', [6], 0, 0, { promo: true, valid_until: '2026-10-12' }),
    P('nile-sahla', 'nile', 'sahla', 'Sahla Finance', 'finance', [12, 18, 24, 36], 0.02, 0),
    P('nile-qest', 'nile', 'qest', 'Qest Pay', 'finance', [12, 24], 0.019, 0.02),
    P('pharos-horus-card-6', 'pharos', 'horusbank', 'Horus Bank', 'card', [6], 0, 0.07),
    P('pharos-horus-card-12', 'pharos', 'horusbank', 'Horus Bank', 'card', [12], 0, 0.12),
    P('pharos-horus-samsung', 'pharos', 'horusbank', 'Horus Bank', 'card', [12], 0, 0, { promo: true, valid_until: '2026-11-30', product_override: samsung }),
    P('pharos-qest', 'pharos', 'qest', 'Qest Pay', 'finance', [12, 18, 24], 0.022, 0),
    P('lotus-nilebank-card', 'lotus', 'nilebank', 'Nile Bank', 'card', [6, 12], 0, 0.06),
    P('lotus-sahla', 'lotus', 'sahla', 'Sahla Finance', 'finance', [12, 24], 0.022, 0),
    P('oasis-horus-card', 'oasis', 'horusbank', 'Horus Bank', 'card', [12], 0, 0.05),
    P('oasis-sahla-promo', 'oasis', 'sahla', 'Sahla Finance', 'finance', [12], 0, 0, { promo: true, valid_until: '2026-12-31' }),
    P('oasis-horus-promo-18', 'oasis', 'horusbank', 'Horus Bank', 'card', [18], 0, 0, { promo: true, valid_until: '2026-09-30' }),
    P('oasis-sahla', 'oasis', 'sahla', 'Sahla Finance', 'finance', [24], 0.02, 0),
    P('delta-qest', 'delta', 'qest', 'Qest Pay', 'finance', [12, 24], 0.023, 0),
    P('delta-sahla', 'delta', 'sahla', 'Sahla Finance', 'finance', [12, 24], 0.02, 0, { min_down_share: 0.2 }),
    P('khan-store', 'khan', 'khanstore', 'Khan store installments', 'finance', [6, 12], 0.03, 0, { min_down_share: 0.3 }),
    P('sphinx-nilebank', 'sphinx', 'nilebank', 'Nile Bank', 'card', [12], 0, 0.05),
    P('sphinx-qest', 'sphinx', 'qest', 'Qest Pay', 'finance', [12, 24], 0.02, 0),
    P('sphinx-qest-18', 'sphinx', 'qest', 'Qest Pay', 'finance', [18], 0.018, 0, { checked_at: daysAgo(40) }),
  ];
}

/** Gifts per retailer, valued in EGP (synthetic). */
function extrasFor(retailerId, ref, price) {
  if (retailerId === 'lotus') return [{ type: 'cashback', label: '5% cashback with Nile Bank cards', value_egp: Math.round(price * 0.05), card_only: true }];
  if (retailerId === 'pharos' && ref < 25000) return [{ type: 'bundle', label: 'Case and screen protector', value_egp: 250 }];
  if (retailerId === 'oasis' && ref >= 25000) return [{ type: 'warranty', label: 'Extra year of warranty', value_egp: 700 }];
  if (retailerId === 'sphinx' && ref >= 12000 && ref < 25000) return [{ type: 'gift', label: 'Wireless earphones', value_egp: 400 }];
  return [];
}

/**
 * Build the whole dataset in memory.
 * @returns {{products: any[], retailers: any[], offers: any[], plans: any[], manifest: any}}
 */
export function generate() {
  const rnd = prng(SEED);
  const between = (lo, hi) => lo + (hi - lo) * rnd();
  const intBetween = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

  const products = PRODUCTS.map((r) => {
    const [id, brand, name, ref, popular, series, os, has5g, perf, camera, bat, screen, storage, ram, upd, svc, ease, warr, weight, charge, aliases] = r;
    /** @type {Record<string, any>} */
    const attrs = { perf, camera, battery_mah: bat, screen, storage_gb: storage, ram_gb: ram, updates_years: upd, service: svc, ease, warranty_months: warr, weight_g: weight, charging_w: charge, os, has_5g: has5g, series };
    for (const k of Object.keys(attrs)) if (attrs[k] === null) delete attrs[k]; // missing spec = key absent
    return { id, tenant_id: TENANT, category: 'mobile', brand, name, ref_price_egp: ref, popular, aliases, attrs, checked_at: daysAgo(10), source: SOURCE };
  });

  const retailers = RETAILERS.map((r) => ({
    id: r.id, tenant_id: TENANT, name: r.name, trust: r.trust, return_days: r.return_days, cod: r.cod,
    base_url: `https://${r.id}.example.invalid`, affiliate_tag: null, source: SOURCE,
  }));
  const rById = Object.fromEntries(RETAILERS.map((r) => [r.id, r]));

  const offers = [];
  for (const p of products) {
    let chosen = FORCED_RETAILERS[p.id];
    if (!chosen) {
      // Seeded shuffle, then take 2 to 5 shops; the import shop only carries brands with a grey market.
      const pool = RETAILERS.map((r) => r.id).filter((id) => id !== 'khan' || ['Apple', 'Samsung', 'Xiaomi'].includes(p.brand));
      for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
      chosen = pool.slice(0, intBetween(2, 5));
    }
    chosen.forEach((rid, idx) => {
      const r = rById[rid];
      let adj = between(r.adj[0], r.adj[1]);
      if (r.imports) adj -= p.brand === 'Apple' ? 0.12 : 0.06; // grey imports are cheaper
      const price = Math.round((p.ref_price_egp * (1 + adj)) / 50) * 50;
      const delivery = {};
      for (const [zone, [fee, dLo, dHi]] of Object.entries(r.zones)) delivery[zone] = { fee, days: intBetween(dLo, dHi) };
      const stockRoll = rnd();
      const staleRoll = rnd();
      const ageH = round1(between(1, 20));
      offers.push({
        id: `o-${p.id}-${rid}`, tenant_id: TENANT, product_id: p.id, retailer_id: rid,
        url: `https://${rid}.example.invalid/p/${p.id}`,
        price_egp: price, delivery,
        in_stock: idx === 0 ? true : stockRoll > 0.1,
        official: !r.imports,
        extras: extrasFor(rid, p.ref_price_egp, price),
        checked_at: idx > 0 && staleRoll < 0.06 ? hoursAgo(30 + Math.floor(staleRoll * 500)) : hoursAgo(ageH),
        source: SOURCE,
      });
    });
  }

  // ---- explicit edge cases ----
  const byId = (id) => offers.find((o) => o.id === id);
  for (const o of offers) if (o.product_id === EDGE_CASES.allOffersStale) o.checked_at = hoursAgo(50);
  for (const id of EDGE_CASES.outOfStock) byId(id).in_stock = false;
  for (const id of EDGE_CASES.staleOffers) byId(id).checked_at = hoursAgo(30);
  for (const id of EDGE_CASES.staleExtras) byId(id).extras_checked_at = hoursAgo(100);
  // The first offer of the forced sets must stay fresh and in stock unless named above.
  const plans = buildPlans(products.map((p) => p.id));

  const manifest = {
    snapshot_id: SNAPSHOT_ID,
    tenant_id: TENANT,
    category: 'mobile',
    now: DATA_NOW,
    seed: SEED,
    source: SOURCE,
    note: 'SAMPLE DATA. Every record is synthetic: prices, specs, retailers, banks and finance companies are invented and must not be presented as real.',
    counts: { products: products.length, retailers: retailers.length, offers: offers.length, plans: plans.length, brands: new Set(products.map((p) => p.brand)).size },
    edgeCases: EDGE_CASES,
  };
  return { products, retailers, offers, plans, manifest };
}

function round1(x) { return Math.round(x * 10) / 10; }

/** Write the dataset to a directory (default data/synthetic). */
export function writeDataset(outDir) {
  const data = generate();
  mkdirSync(outDir, { recursive: true });
  for (const key of ['products', 'retailers', 'offers', 'plans', 'manifest']) {
    writeFileSync(join(outDir, key + '.json'), JSON.stringify(data[key], null, 2) + '\n');
  }
  return data.manifest;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const out = join(dirname(fileURLToPath(import.meta.url)), 'synthetic');
  const m = writeDataset(out);
  console.log(`wrote ${out}: ${JSON.stringify(m.counts)}`);
}
