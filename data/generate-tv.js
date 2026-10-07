// Deterministic synthetic dataset for the TV category.
//
//   node data/generate-tv.js     writes data/synthetic/tv/{products,offers,manifest}.json
//
// SAMPLE DATA ONLY. Every record carries source: "synthetic". Prices, scores, offers and gifts are invented for
// testing the engine and must never be presented as real (tech-spec 7). Model-style names are used so Layer 1
// phrases can name a model; their specs and prices here are made up.
//
// Retailers and plans are the shared ones in data/synthetic/{retailers,plans}.json (read, never written here).
// The same seed always produces byte-identical files. Edge cases are placed explicitly (see EDGE_CASES).
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_NOW, TENANT } from './generate.js';

export const SEED = 20261004;
export const SNAPSHOT_ID = 'synthetic-tv-2026-10-03';
const NOW_MS = Date.parse(DATA_NOW);
const SOURCE = 'synthetic';
const CATEGORY = 'tv';

/** mulberry32: small, fast, deterministic PRNG (same as data/generate.js). */
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
const round1 = (x) => Math.round(x * 10) / 10;

// --------------------------------------------------------------------------------------------
// Products: 36 TVs, 9 brands, 3 price tiers. Scores are editorial estimates (synthetic).
// cols: id, brand, name, ref, popular, series, panel, resolution, os, inches, picture, nits, hz, sound, smart,
//       gaming, hdmi21, service, warranty, kwh/year, ease, bracket, aliases
// --------------------------------------------------------------------------------------------
const PRODUCTS = [
  // entry (under 20,000)
  ['tv-tornado-32-hd', 'Tornado', 'Tornado 32" HD LED TV', 8000, true, 'entry', 'led', 'hd', 'other', 32, 3.5, 250, 60, 4, 3, 2, false, 9, 60, 45, 8, true, ['tornado 32']],
  ['tv-xiaomi-a-32', 'Xiaomi', 'Xiaomi TV A 32 2025', 8800, false, 'entry', 'led', 'hd', 'google_tv', 32, 4, 280, 60, 4, 7, 2, false, 5, 24, 40, 6, false, ['xiaomi a 32', 'tv a 32']],
  ['tv-sharp-32-smart', 'Sharp', 'Sharp 32" HD Smart TV', 9500, false, 'entry', 'led', 'hd', 'android', 32, 4, 250, 60, 4, 5, 2, false, 8, 60, 45, 7, true, ['sharp 32']],
  ['tv-samsung-32-t5300', 'Samsung', 'Samsung 32" T5300 Full HD Smart TV', 11000, false, 'entry', 'led', 'fhd', 'tizen', 32, 5, 300, 60, 5, 7, 3, false, 9, 24, 42, 7, false, ['t5300', 'samsung 32']],
  ['tv-lg-32-lq63', 'LG', 'LG 32" LQ63 Full HD Smart TV', 11500, false, 'entry', 'led', 'fhd', 'webos', 32, 5, 280, 60, 5, 7, 3, false, 9, 24, 40, 8, false, ['lq63', 'lg 32']],
  ['tv-tcl-40-s5400', 'TCL', 'TCL 40" S5400 Full HD Android TV', 11500, false, 'entry', 'led', 'fhd', 'android', 40, 4.5, 280, 60, 4.5, 6.5, 3, false, 6, 24, 60, 6, false, ['s5400', 'tcl 40']],
  ['tv-hisense-43-a6', 'Hisense', 'Hisense 43" A6 4K UHD TV', 13000, false, 'entry', 'led', '4k', 'other', 43, 5.5, 300, 60, 5, 6, 3.5, false, 6, 24, 70, 7, false, ['hisense a6 43']],
  ['tv-tornado-43-4k', 'Tornado', 'Tornado 43" 4K Smart Android TV', 13500, true, 'entry', 'led', '4k', 'android', 43, 5, 300, 60, 4.5, 5.5, 3, false, 9, 60, 70, 8, true, ['tornado 43']],
  ['tv-xiaomi-a-43', 'Xiaomi', 'Xiaomi TV A 43 4K 2025', 14000, true, 'entry', 'led', '4k', 'google_tv', 43, 5.5, 320, 60, 5, 7.5, 3.5, false, 5, 24, 68, 6, false, ['xiaomi a 43', 'tv a 43']],
  ['tv-lg-43-ur78', 'LG', 'LG 43" UR78 4K UHD Smart TV', 17000, false, 'entry', 'led', '4k', 'webos', 43, 6, 330, 60, 5, 8, 4, false, 9, 24, 72, 8, false, ['ur78', 'lg 43']],
  ['tv-samsung-43-cu7000', 'Samsung', 'Samsung 43" Crystal UHD CU7000', 17500, true, 'entry', 'led', '4k', 'tizen', 43, 6, 350, 60, 5, 7.5, 4, false, 9, 24, 75, 7, false, ['cu7000', 'samsung 43']],
  ['tv-toshiba-50-c350', 'Toshiba', 'Toshiba 50" C350 4K UHD TV', 18000, false, 'entry', 'led', '4k', 'other', 50, 5.5, 320, 60, 5.5, 6, 3.5, false, 8, 60, 90, 8, true, ['c350', 'toshiba 50']],
  ['tv-tcl-50-p755', 'TCL', 'TCL 50" P755 4K Google TV', 18500, false, 'entry', 'led', '4k', 'google_tv', 50, 6, 380, 60, 5.5, 7.5, 5, false, 6, 24, 88, 6, false, ['p755', 'tcl 50']],
  // mid (20,000 to 45,000)
  ['tv-hisense-55-a7', 'Hisense', 'Hisense 55" A7 4K UHD TV', 21000, false, 'mid', 'led', '4k', 'other', 55, 6, 380, 60, 5.5, 6, 4, false, 6, 24, 105, 7, false, ['hisense a7 55']],
  ['tv-samsung-50-du8000', 'Samsung', 'Samsung 50" Crystal UHD DU8000', 23000, false, 'mid', 'led', '4k', 'tizen', 50, 6.5, 400, 60, 5.5, 8, 5, false, 9, 24, 95, 7, false, ['du8000 50', 'samsung 50']],
  ['tv-tcl-55-c655', 'TCL', 'TCL 55" C655 QLED Google TV', 24000, true, 'mid', 'qled', '4k', 'google_tv', 55, 7, 450, 60, 6, 7.5, 5.5, false, 6, 24, 105, 6, false, ['c655', 'tcl c655']],
  ['tv-xiaomi-q2-55', 'Xiaomi', 'Xiaomi TV Q2 55 QLED', 24500, false, 'mid', 'qled', '4k', 'google_tv', 55, 7, null, 60, 6, 7.5, 5, false, 5, 24, 100, 6, false, ['q2 55', 'xiaomi q2']],
  ['tv-tornado-55-qled', 'Tornado', 'Tornado 55" QLED Google TV', 25000, false, 'mid', 'qled', '4k', 'google_tv', 55, 6.5, 420, 60, 5.5, 7, 4.5, false, 9, 60, 110, 7, true, ['tornado 55', 'tornado qled']],
  ['tv-lg-55-ut80', 'LG', 'LG 55" UT80 4K UHD Smart TV', 27000, true, 'mid', 'led', '4k', 'webos', 55, 6.5, 400, 60, 6, 8.5, 5, false, 9, 24, 110, 8, false, ['ut80', 'lg 55']],
  ['tv-xiaomi-a-pro-65', 'Xiaomi', 'Xiaomi TV A Pro 65 QLED', 29000, false, 'mid', 'qled', '4k', 'google_tv', 65, 6.5, 400, 60, 5.5, 7.5, 5, false, 5, 24, 140, 6, false, ['a pro 65', 'xiaomi a pro']],
  ['tv-hisense-65-a7', 'Hisense', 'Hisense 65" A7 4K UHD TV', 30000, false, 'mid', 'led', '4k', 'other', 65, 6, 380, 60, 5.5, 6, 4, false, 6, 24, 140, 7, false, ['hisense a7 65']],
  ['tv-samsung-55-q60d', 'Samsung', 'Samsung 55" QLED Q60D', 32000, true, 'mid', 'qled', '4k', 'tizen', 55, 7.5, 500, 60, 6, 8, 5.5, false, 9, 24, 105, 7, false, ['q60d', 'samsung q60d']],
  ['tv-tcl-55-c755', 'TCL', 'TCL 55" C755 QD-Mini LED 144 Hz', 33000, false, 'mid', 'mini_led', '4k', 'google_tv', 55, 8, 1000, 144, 7, 7.5, 8.5, true, 6, 24, 115, 6, false, ['c755', 'tcl c755']],
  ['tv-sony-55-x77l', 'Sony', 'Sony Bravia 55" X77L 4K Google TV', 36000, false, 'mid', 'led', '4k', 'google_tv', 55, 7.5, 450, 60, 6.5, 8.5, 5, false, 7, 24, 110, 7, false, ['x77l', 'bravia 55']],
  ['tv-samsung-65-du8000', 'Samsung', 'Samsung 65" Crystal UHD DU8000', 36000, false, 'mid', 'led', '4k', 'tizen', 65, 6.5, 400, 60, 5.5, 8, 5, false, 9, 24, 150, 7, false, ['du8000 65', 'samsung 65']],
  ['tv-lg-55-qned80', 'LG', 'LG 55" QNED80 120 Hz', 38000, false, 'mid', 'qled', '4k', 'webos', 55, 7.5, 550, 120, 6.5, 8.5, 7.5, true, 9, 24, 112, 8, false, ['qned80', 'lg qned 55']],
  ['tv-tcl-65-c755', 'TCL', 'TCL 65" C755 QD-Mini LED 144 Hz', 42000, false, 'mid', 'mini_led', '4k', 'google_tv', 65, 8, 1000, 144, 7, 7.5, 8.5, true, 6, 24, 150, 6, false, ['c755 65', 'tcl 65']],
  // premium (over 45,000)
  ['tv-samsung-75-du8000', 'Samsung', 'Samsung 75" Crystal UHD DU8000', 52000, false, 'premium', 'led', '4k', 'tizen', 75, 6.5, 400, 60, 5.5, 8, 5, false, 9, 24, 200, 7, false, ['du8000 75', 'samsung 75']],
  ['tv-lg-65-qned85', 'LG', 'LG 65" QNED85 Mini LED 120 Hz', 56000, false, 'premium', 'mini_led', '4k', 'webos', 65, 8, 800, 120, 7, 8.5, 8, true, 9, 24, 155, 8, false, ['qned85', 'lg qned 65']],
  ['tv-hisense-75-u7', 'Hisense', 'Hisense 75" U7 Mini LED 144 Hz', 60000, false, 'premium', 'mini_led', '4k', 'other', 75, 8, 1200, 144, 7, 6.5, 8.5, true, 6, 24, 220, 7, false, ['u7', 'hisense u7']],
  ['tv-samsung-55-qn90d', 'Samsung', 'Samsung 55" Neo QLED QN90D', 62000, false, 'premium', 'mini_led', '4k', 'tizen', 55, 9, 1500, 120, 7.5, 8.5, 9, true, 9, 24, 130, 7, false, ['qn90d', 'neo qled 55']],
  ['tv-lg-55-c4', 'LG', 'LG OLED evo C4 55"', 65000, true, 'premium', 'oled', '4k', 'webos', 55, 9.5, 800, 144, 7.5, 9, 10, true, 9, 24, 110, 8, false, ['c4', 'lg c4', 'oled c4']],
  ['tv-sony-65-x90l', 'Sony', 'Sony Bravia XR 65" X90L', 70000, false, 'premium', 'led', '4k', 'google_tv', 65, 8.5, 900, 120, 8, 8.5, 8, true, 7, 24, 160, 7, false, ['x90l', 'bravia 65']],
  ['tv-samsung-65-s90d', 'Samsung', 'Samsung 65" OLED S90D', 82000, false, 'premium', 'oled', '4k', 'tizen', 65, 9.5, 1000, 144, 7.5, 8.5, 9.5, true, 9, 24, 150, 7, false, ['s90d', 'samsung oled 65']],
  ['tv-tcl-85-c755', 'TCL', 'TCL 85" C755 QD-Mini LED 144 Hz', 88000, false, 'premium', 'mini_led', '4k', 'google_tv', 85, 8, 1000, 144, 7, 7.5, 8.5, true, 6, 24, 300, 6, false, ['c755 85', 'tcl 85']],
  ['tv-sony-75-x85l', 'Sony', 'Sony Bravia 75" X85L', 85000, false, 'premium', 'led', '4k', 'google_tv', 75, 8, 700, 120, 7.5, 8.5, 7.5, true, 7, 24, 210, 7, false, ['x85l', 'bravia 75']],
];

// --------------------------------------------------------------------------------------------
// Pricing and delivery per shared retailer (ids from data/synthetic/retailers.json). TVs are bulky, so the
// fees are higher than for phones. Zone coverage matches the shared retailers: delta has no Alexandria,
// khan is Greater Cairo only (imports), sphinx does not ship to other governorates.
// --------------------------------------------------------------------------------------------
const SHOPS = {
  nile: { adj: [-0.01, 0.03], zones: { greater_cairo: [0, 1, 2], alexandria: [0, 2, 3], other: [150, 3, 5] } },
  pharos: { adj: [-0.03, 0.01], zones: { greater_cairo: [0, 1, 2], alexandria: [100, 2, 3], other: [200, 3, 5] } },
  lotus: { adj: [-0.05, -0.01], zones: { greater_cairo: [0, 2, 3], alexandria: [0, 2, 4], other: [150, 3, 6] } },
  oasis: { adj: [-0.04, 0], zones: { greater_cairo: [0, 1, 3], alexandria: [0, 2, 3], other: [100, 3, 4] } },
  delta: { adj: [-0.04, -0.01], zones: { greater_cairo: [100, 2, 3], other: [150, 2, 4] } },
  khan: { adj: [-0.1, -0.06], imports: true, zones: { greater_cairo: [0, 0, 1] } },
  sphinx: { adj: [-0.02, 0.02], zones: { greater_cairo: [75, 1, 2], alexandria: [0, 1, 2] } },
};
const SHOP_IDS = Object.keys(SHOPS);
/** Brands with a grey-import market at the khan shop. */
const IMPORT_BRANDS = ['Samsung', 'LG', 'Sony', 'Xiaomi'];

// Explicit retailer sets for products the tests and edge cases rely on (first shop stays fresh and in stock).
const FORCED_RETAILERS = {
  'tv-samsung-55-q60d': ['nile', 'khan', 'pharos', 'lotus'],
  'tv-sharp-32-smart': ['nile', 'delta', 'lotus'],
  'tv-lg-55-ut80': ['pharos', 'lotus', 'sphinx'],
  'tv-samsung-43-cu7000': ['oasis', 'pharos', 'nile'],
  'tv-tornado-55-qled': ['nile', 'sphinx', 'pharos'],
  'tv-tcl-55-c755': ['oasis', 'nile', 'sphinx', 'delta'],
  'tv-tornado-32-hd': ['lotus', 'delta', 'nile'],
  'tv-lg-55-c4': ['pharos', 'nile', 'oasis', 'khan'],
  'tv-sony-75-x85l': [],
};

/** Edge cases, applied after generation so they are guaranteed. Documented in docs/tv-NOTES.md. */
const EDGE_CASES = {
  missingSpec: { product: 'tv-xiaomi-q2-55', attr: 'brightness_nits' },
  allOffersStale: 'tv-sharp-32-smart',
  noOffers: 'tv-sony-75-x85l',
  specsStale: 'tv-hisense-43-a6 (checked_at 70 days ago: not ranked)',
  outOfStock: ['o-tv-lg-55-ut80-lotus'],
  staleOffers: ['o-tv-samsung-43-cu7000-pharos'],
  staleExtras: ['o-tv-tornado-55-qled-sphinx'],
  importOffers: 'every offer from khan (official: false; Samsung, LG, Sony, Xiaomi only)',
  installExtras: 'nile offers on TVs of 25,000+ carry a free wall-mounting install extra',
  zoneGaps: ['delta: no alexandria', 'khan: greater_cairo only', 'sphinx: no other governorates'],
  sharedPlans: 'plans are the shared data/synthetic/plans.json rows (promo ending, expired promo, stale plan, min-down plans apply here too; pharos-horus-samsung is limited to Samsung phones, so it never applies to TVs)',
};

/** Gifts per retailer, valued in EGP (synthetic). */
function extrasFor(retailerId, ref, price) {
  if (retailerId === 'lotus') return [{ type: 'cashback', label: '5% cashback with Nile Bank cards', value_egp: Math.round(price * 0.05), card_only: true }];
  if (retailerId === 'nile' && ref >= 25000) return [{ type: 'install', label: 'Free wall mounting and installation', value_egp: 600 }];
  if (retailerId === 'pharos' && ref < 20000) return [{ type: 'bundle', label: 'HDMI cable and wall bracket', value_egp: 300 }];
  if (retailerId === 'oasis' && ref >= 40000) return [{ type: 'warranty', label: 'Extra year of warranty', value_egp: 1500 }];
  if (retailerId === 'sphinx' && ref >= 20000 && ref < 60000) return [{ type: 'gift', label: 'Soundbar', value_egp: 1500 }];
  return [];
}

/**
 * Build the TV dataset in memory (products, offers, manifest; retailers and plans are shared).
 * @returns {{products: any[], offers: any[], manifest: any}}
 */
export function generate() {
  const rnd = prng(SEED);
  const between = (lo, hi) => lo + (hi - lo) * rnd();
  const intBetween = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

  const products = PRODUCTS.map((r) => {
    const [id, brand, name, ref, popular, series, panel, resolution, os, inches, picture, nits, hz, sound, smart, gaming, hdmi21, svc, warr, kwh, ease, bracket, aliases] = r;
    /** @type {Record<string, any>} */
    const attrs = {
      picture, brightness_nits: nits, motion_hz: hz, sound, smart, gaming, hdmi21, screen_inches: inches, service: svc,
      warranty_months: warr, power_kwh_year: kwh, ease, bracket_included: bracket, panel, resolution, os, series,
    };
    for (const k of Object.keys(attrs)) if (attrs[k] === null) delete attrs[k]; // missing spec = key absent
    return { id, tenant_id: TENANT, category: CATEGORY, brand, name, ref_price_egp: ref, popular, aliases, attrs, checked_at: daysAgo(10), source: SOURCE };
  });
  products.find((p) => p.id === 'tv-hisense-43-a6').checked_at = daysAgo(70);

  const offers = [];
  for (const p of products) {
    let chosen = FORCED_RETAILERS[p.id];
    if (!chosen) {
      // Seeded shuffle, then take 3 to 5 shops; the import shop only carries brands with a grey market.
      const pool = SHOP_IDS.filter((id) => !SHOPS[id].imports || IMPORT_BRANDS.includes(p.brand));
      for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
      chosen = pool.slice(0, intBetween(3, 5));
    }
    chosen.forEach((rid, idx) => {
      const r = SHOPS[rid];
      const adj = between(r.adj[0], r.adj[1]);
      const price = Math.round((p.ref_price_egp * (1 + adj)) / 50) * 50;
      /** @type {Record<string, {fee: number, days: number}>} */
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

  const manifest = {
    snapshot_id: SNAPSHOT_ID,
    tenant_id: TENANT,
    category: CATEGORY,
    now: DATA_NOW,
    seed: SEED,
    source: SOURCE,
    note: 'SAMPLE DATA. Every record is synthetic: prices, specs, offers and gifts are invented and must not be presented as real. Retailers and plans are the shared data/synthetic/{retailers,plans}.json.',
    counts: { products: products.length, offers: offers.length, brands: new Set(products.map((p) => p.brand)).size },
    edgeCases: EDGE_CASES,
  };
  return { products, offers, manifest };
}

/** Write the dataset to a directory (default data/synthetic/tv). */
export function writeDataset(outDir) {
  const data = generate();
  mkdirSync(outDir, { recursive: true });
  for (const key of ['products', 'offers', 'manifest']) {
    writeFileSync(join(outDir, key + '.json'), JSON.stringify(data[key], null, 2) + '\n');
  }
  return data.manifest;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const out = join(dirname(fileURLToPath(import.meta.url)), 'synthetic', 'tv');
  const m = writeDataset(out);
  console.log(`wrote ${out}: ${JSON.stringify(m.counts)}`);
}
