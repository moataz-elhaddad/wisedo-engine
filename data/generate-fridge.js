// Deterministic synthetic dataset for the fridge category.
//
//   node data/generate-fridge.js   writes data/synthetic/fridge/{products,offers,manifest}.json
//
// SAMPLE DATA ONLY. Every record carries source: "synthetic". Prices, specs and scores are invented for testing
// the engine and must never be presented as real (tech-spec 7). Brand and model-style names are used so Layer 1
// phrases can name a model; their specs and prices here are made up.
//
// Retailers and plans are the shared rows in data/synthetic/{retailers,plans}.json (read, never written here).
// Offers reference only those retailer ids and plan ids. The same seed always produces byte-identical files.
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_NOW, TENANT } from './generate.js';

export const SEED = 20261004;
export const CATEGORY = 'fridge';
export const SNAPSHOT_ID = 'synthetic-fridge-2026-10-03';
const NOW_MS = Date.parse(DATA_NOW);
const SOURCE = 'synthetic';
const HERE = dirname(fileURLToPath(import.meta.url));

/** mulberry32: small, fast, deterministic PRNG (same as generate.js). */
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
// Products: 34 fridges, 12 brands, 3 price tiers. Scores are editorial estimates (synthetic).
// cols: id, brand, name, ref price, popular, series, layout, capacity_l, energy_kwh_year, cooling, noise_db,
//       build, service, warranty_months, inverter, no_frost, dispenser, width_cm, aliases
// --------------------------------------------------------------------------------------------
const PRODUCTS = [
  // budget (under 25,000)
  ['fridge-white-whale-ws-150', 'White Whale', 'White Whale WS-150 Single Door 150L', 12000, false, 'entry', 'single_door', 150, 230, 5, 38, 4.5, 6, 24, false, false, false, 55, ['ws-150', 'white whale 150']],
  ['fridge-kiriazi-e230', 'Kiriazi', 'Kiriazi E230 Defrost 230L', 12800, false, 'entry', 'top_freezer', 230, 380, 5, 42, 5, 7, 60, false, false, false, 56, ['e230', 'kiriazi 230']],
  ['fridge-fresh-fnt-260', 'Fresh', 'Fresh FNT-260 Defrost 260L', 13800, false, 'entry', 'top_freezer', 260, 400, 5.5, 41, 5, 7, 60, false, false, false, 58, ['fnt-260', 'fresh 260']],
  ['fridge-white-whale-wr-280', 'White Whale', 'White Whale WR-280 No Frost 280L', 15500, false, 'entry', 'top_freezer', 280, 390, 5.5, 40, 5, 6, 36, false, true, false, 60, ['wr-280']],
  ['fridge-zanussi-zrt-300', 'Zanussi', 'Zanussi ZRT-300 Defrost 300L', 16200, false, 'entry', 'top_freezer', 300, 410, 5.5, null, 5.5, 6, 36, false, false, false, 60, ['zrt-300']],
  ['fridge-unionaire-ur-310', 'Unionaire', 'Unionaire UR-310 No Frost 310L', 17500, false, 'entry', 'top_freezer', 310, 380, 6, 40, 5.5, 6, 36, false, true, false, 62, ['ur-310']],
  ['fridge-sharp-sj-ge35', 'Sharp', 'Sharp SJ-GE35 No Frost 335L', 19500, true, 'entry', 'top_freezer', 335, 360, 6.5, 39, 6, 9, 60, false, true, false, 62, ['sj-ge35', 'sharp 335']],
  ['fridge-kiriazi-e400', 'Kiriazi', 'Kiriazi E400 No Frost 400L', 20500, false, 'entry', 'top_freezer', 400, 430, 6, 41, 5.5, 7, 60, false, true, false, 68, ['e400', 'kiriazi 400']],
  ['fridge-toshiba-gr-ef33', 'Toshiba', 'Toshiba GR-EF33 No Frost 340L', 21000, true, 'entry', 'top_freezer', 340, 350, 6.5, 39, 6, 9, 60, false, true, false, 63, ['gr-ef33', 'toshiba 340']],
  ['fridge-haier-hrf-320i', 'Haier', 'Haier HRF-320i Inverter No Frost 320L', 22000, false, 'mid', 'top_freezer', 320, 260, 6.5, 37, 6, 5, 24, true, true, false, 60, ['hrf-320i']],
  ['fridge-fresh-fnt-400', 'Fresh', 'Fresh FNT-400 No Frost 400L', 22500, false, 'entry', 'top_freezer', 400, 420, 6, 41, 5.5, 7, 60, false, true, false, 68, ['fnt-400', 'fresh 400']],
  ['fridge-beko-rdne-350', 'Beko', 'Beko RDNE-350 Inverter No Frost 350L', 23800, false, 'mid', 'top_freezer', 350, 270, 6.5, 38, 6.5, 6, 24, true, true, false, 60, ['rdne-350']],
  // mid (25,000 to 50,000)
  ['fridge-kiriazi-e560', 'Kiriazi', 'Kiriazi E560 No Frost 560L', 27500, false, 'mid', 'top_freezer', 560, 480, 6.5, 42, 5.5, 7, 60, false, true, false, 78, ['e560', 'kiriazi 560']],
  ['fridge-sharp-sj-ge45', 'Sharp', 'Sharp SJ-GE45 Inverter No Frost 450L', 29500, true, 'mid', 'top_freezer', 450, 300, 7, 38, 6.5, 9, 60, true, true, false, 70, ['sj-ge45', 'sharp 450']],
  ['fridge-samsung-rt38', 'Samsung', 'Samsung RT38 Digital Inverter 380L', 30500, false, 'mid', 'top_freezer', 380, 250, 7, 37, 7, 8, 24, true, true, false, 60, ['rt38']],
  ['fridge-unionaire-ur-530d', 'Unionaire', 'Unionaire UR-530D No Frost Dispenser 530L', 31000, false, 'mid', 'top_freezer', 530, 470, 6.5, 41, 6, 6, 36, false, true, true, 77, ['ur-530d']],
  ['fridge-toshiba-gr-ef46', 'Toshiba', 'Toshiba GR-EF46 Inverter No Frost 460L', 31500, true, 'mid', 'top_freezer', 460, 295, 7, 38, 6.5, 9, 60, true, true, false, 70, ['gr-ef46', 'toshiba 460']],
  ['fridge-lg-gn-b392', 'LG', 'LG GN-B392 Smart Inverter 393L', 33000, false, 'mid', 'top_freezer', 393, 240, 7.5, 36, 7, 8, 120, true, true, false, 60, ['gn-b392']],
  ['fridge-white-whale-wr-560d', 'White Whale', 'White Whale WR-560D No Frost Dispenser 560L', 33500, false, 'mid', 'top_freezer', 560, 490, 6.5, 42, 5.5, 6, 36, false, true, true, 80, ['wr-560d']],
  ['fridge-samsung-rb34', 'Samsung', 'Samsung RB34 Bottom Freezer 340L', 34500, false, 'mid', 'bottom_freezer', 340, 230, 7.5, 36, 7.5, 8, 24, true, true, false, 60, ['rb34']],
  ['fridge-haier-hrb-450', 'Haier', 'Haier HRB-450 Bottom Freezer 450L', 35000, false, 'mid', 'bottom_freezer', 450, 280, 7, 37, 6.5, 5, 24, true, true, false, 70, ['hrb-450']],
  ['fridge-beko-rcne-460', 'Beko', 'Beko RCNE-460 Bottom Freezer 460L', 36500, false, 'mid', 'bottom_freezer', 460, 290, 7, 37, 7, 6, 24, true, true, false, 70, ['rcne-460']],
  ['fridge-zanussi-zbb-450', 'Zanussi', 'Zanussi ZBB-450 Bottom Freezer 450L', 39000, false, 'mid', 'bottom_freezer', 450, 300, 7, 38, 6.5, 6, 36, true, true, false, 70, ['zbb-450']],
  ['fridge-lg-gn-h702', 'LG', 'LG GN-H702 Inverter Dispenser 506L', 44000, false, 'mid', 'top_freezer', 506, 300, 8, 37, 7.5, 8, 120, true, true, true, 78, ['gn-h702']],
  ['fridge-bosch-kgn56', 'Bosch', 'Bosch KGN56 Bottom Freezer 505L', 47000, false, 'premium', 'bottom_freezer', 505, 260, 8, 36, 8.5, 7, 24, true, true, false, 70, ['kgn56']],
  // premium (over 50,000)
  ['fridge-haier-hrf-520fd', 'Haier', 'Haier HRF-520FD French Door 520L', 55000, false, 'premium', 'french_door', 520, 330, 7.5, 38, 7, 5, 24, true, true, false, 83, ['hrf-520fd']],
  ['fridge-sharp-sj-sbs62', 'Sharp', 'Sharp SJ-SBS62 Side by Side 620L', 58000, false, 'premium', 'side_by_side', 620, 420, 7.5, 40, 7, 9, 60, true, true, true, 91, ['sj-sbs62']],
  ['fridge-beko-gne-560fd', 'Beko', 'Beko GNE-560 French Door 560L', 62000, false, 'premium', 'french_door', 560, 340, 8, 38, 7.5, 6, 24, true, true, false, 84, ['gne-560']],
  ['fridge-toshiba-gr-rf600', 'Toshiba', 'Toshiba GR-RF600 French Door 600L', 68000, false, 'premium', 'french_door', 600, 360, 8, 38, 7.5, 9, 60, true, true, false, 84, ['gr-rf600']],
  ['fridge-samsung-rs64', 'Samsung', 'Samsung RS64 Side by Side 635L', 72000, true, 'premium', 'side_by_side', 635, 390, 8.5, 37, 8, 8, 24, true, true, true, 91, ['rs64']],
  ['fridge-lg-gc-b257', 'LG', 'LG GC-B257 Side by Side 641L', 78000, false, 'premium', 'side_by_side', 641, 380, 8.5, 36, 8.5, 8, 120, true, true, true, 91, ['gc-b257']],
  ['fridge-lg-gr-x24', 'LG', 'LG GR-X24 InstaView French Door 616L', 92000, false, 'premium', 'french_door', 616, 350, 9, 35, 9, 8, 120, true, true, true, 91, ['gr-x24', 'instaview']],
  ['fridge-bosch-kad93', 'Bosch', 'Bosch KAD93 Side by Side 560L', 98000, false, 'premium', 'side_by_side', 560, 350, 9, 36, 9, 7, 24, true, true, true, 91, ['kad93']],
  ['fridge-samsung-rf65', 'Samsung', 'Samsung RF65 Family Hub French Door 650L', 108000, false, 'premium', 'french_door', 650, 400, 9.5, 36, 9.5, 8, 24, true, true, true, 91, ['rf65', 'family hub']],
];

// --------------------------------------------------------------------------------------------
// Heavy-item delivery per shop and zone: [fee, minDays, maxDays]. A missing zone means no delivery there.
// Price adjustment range per shop. Shop ids are the shared synthetic retailers.
// --------------------------------------------------------------------------------------------
const SHOPS = {
  nile: { adj: [-0.01, 0.03], zones: { greater_cairo: [0, 2, 3], alexandria: [150, 3, 4], other: [300, 4, 6] } },
  pharos: { adj: [-0.03, 0.01], zones: { greater_cairo: [0, 2, 3], alexandria: [0, 3, 4], other: [250, 4, 6] } },
  lotus: { adj: [-0.05, -0.01], zones: { greater_cairo: [100, 2, 4], alexandria: [150, 3, 5], other: [350, 5, 7] } },
  oasis: { adj: [-0.04, 0], zones: { greater_cairo: [0, 1, 3], alexandria: [0, 2, 3], other: [200, 3, 5] } },
  delta: { adj: [-0.04, -0.01], zones: { greater_cairo: [200, 2, 4], other: [300, 3, 5] } },
  khan: { adj: [-0.07, -0.04], imports: true, zones: { greater_cairo: [150, 1, 1] } },
  sphinx: { adj: [-0.02, 0.02], zones: { greater_cairo: [150, 2, 3], alexandria: [0, 1, 2] } },
};
/** Brands with a grey-import market that the import shop (khan) carries. */
const IMPORT_BRANDS = ['Samsung', 'LG', 'Bosch'];

// Explicit retailer sets for products the tests and edge cases rely on.
const FORCED_RETAILERS = {
  'fridge-bosch-kad93': ['khan'],
  'fridge-samsung-rs64': ['khan', 'nile', 'oasis', 'pharos'],
  'fridge-sharp-sj-ge45': ['nile', 'lotus', 'pharos', 'sphinx'],
  'fridge-toshiba-gr-ef46': ['nile', 'pharos', 'delta', 'oasis'],
  'fridge-lg-gc-b257': ['nile', 'oasis', 'sphinx'],
  'fridge-fresh-fnt-260': ['nile', 'delta', 'lotus'],
  'fridge-white-whale-ws-150': ['nile', 'pharos', 'oasis'],
};

/** Edge cases, applied after generation so they are guaranteed. */
const EDGE_CASES = {
  missingSpec: { product: 'fridge-zanussi-zrt-300', attr: 'noise_db' },
  allOffersStale: 'fridge-fresh-fnt-260',
  outOfStock: ['o-fridge-sharp-sj-ge45-lotus'],
  staleOffers: ['o-fridge-toshiba-gr-ef46-pharos'],
  staleExtras: ['o-fridge-lg-gc-b257-oasis'],
  importOffers: 'every offer from khan (official: false); khan carries Samsung, LG and Bosch only',
  importOnlyProduct: 'fridge-bosch-kad93 (sold only by khan, Greater Cairo only)',
  sharedPlans: 'offers list their retailer\'s plans from data/synthetic/plans.json in plan_ids (promo ending nile-sahla-promo, expired oasis-horus-promo-18, stale sphinx-qest-18, min-down khan-store and delta-sahla all apply)',
  zoneGaps: ['delta: no alexandria', 'khan: greater_cairo only', 'sphinx: no other governorates'],
  heavyDelivery: 'delivery fees 0-350 EGP and 1-7 days by shop and zone',
};

/** Gifts per retailer, valued in EGP (synthetic). */
function extrasFor(retailerId, ref, price) {
  if (retailerId === 'lotus') return [{ type: 'cashback', label: '5% cashback with Nile Bank cards', value_egp: Math.round(price * 0.05), card_only: true }];
  if (retailerId === 'pharos' && ref < 40000) return [{ type: 'gift', label: 'Voltage stabiliser', value_egp: 600 }];
  if (retailerId === 'oasis' && ref >= 50000) return [{ type: 'warranty', label: 'Extra year of warranty', value_egp: 1500 }];
  if (retailerId === 'sphinx' && ref >= 20000 && ref < 60000) return [{ type: 'bundle', label: 'Fridge stand and water filter jug', value_egp: 450 }];
  return [];
}

function readShared(name) {
  return JSON.parse(readFileSync(join(HERE, 'synthetic', name + '.json'), 'utf8'));
}

/**
 * Build the fridge dataset in memory.
 * @returns {{products: any[], offers: any[], manifest: any}}
 */
export function generate() {
  const rnd = prng(SEED);
  const between = (lo, hi) => lo + (hi - lo) * rnd();
  const intBetween = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
  const retailers = readShared('retailers');
  const plans = readShared('plans');
  const retailerIds = new Set(retailers.map((r) => r.id));
  for (const id of Object.keys(SHOPS)) if (!retailerIds.has(id)) throw new Error(`generate-fridge: unknown retailer ${id}`);
  const plansOf = (rid) => plans.filter((p) => p.retailer_id === rid && !p.product_override).map((p) => p.id).sort();

  const products = PRODUCTS.map((r) => {
    const [id, brand, name, ref, popular, series, layout, cap, kwh, cooling, noise, build, svc, warr, inverter, noFrost, dispenser, width, aliases] = r;
    /** @type {Record<string, any>} */
    const attrs = { capacity_l: cap, energy_kwh_year: kwh, cooling, noise_db: noise, build, service: svc, warranty_months: warr, inverter, no_frost: noFrost, dispenser, width_cm: width, layout, series };
    for (const k of Object.keys(attrs)) if (attrs[k] === null) delete attrs[k]; // missing spec = key absent
    return { id, tenant_id: TENANT, category: CATEGORY, brand, name, ref_price_egp: ref, popular, aliases, attrs, checked_at: daysAgo(10), source: SOURCE };
  });

  const offers = [];
  for (const p of products) {
    let chosen = FORCED_RETAILERS[p.id];
    if (!chosen) {
      const pool = Object.keys(SHOPS).filter((id) => id !== 'khan' || IMPORT_BRANDS.includes(p.brand));
      for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
      chosen = pool.slice(0, intBetween(3, 5));
    }
    chosen.forEach((rid, idx) => {
      const s = SHOPS[rid];
      let adj = between(s.adj[0], s.adj[1]);
      if (s.imports) adj -= 0.08; // grey imports are cheaper
      const price = Math.round((p.ref_price_egp * (1 + adj)) / 100) * 100;
      const delivery = {};
      for (const [zone, [fee, dLo, dHi]] of Object.entries(s.zones)) delivery[zone] = { fee, days: intBetween(dLo, dHi) };
      const stockRoll = rnd();
      const staleRoll = rnd();
      const ageH = Math.round(between(1, 20) * 10) / 10;
      offers.push({
        id: `o-${p.id}-${rid}`, tenant_id: TENANT, product_id: p.id, retailer_id: rid,
        url: `https://${rid}.example.invalid/p/${p.id}`,
        price_egp: price, delivery,
        in_stock: idx === 0 ? true : stockRoll > 0.1,
        official: !s.imports,
        extras: extrasFor(rid, p.ref_price_egp, price),
        plan_ids: plansOf(rid),
        checked_at: idx > 0 && staleRoll < 0.06 ? hoursAgo(30 + Math.floor(staleRoll * 500)) : hoursAgo(ageH),
        source: SOURCE,
      });
    });
  }

  // ---- explicit edge cases ----
  const byId = (id) => {
    const o = offers.find((x) => x.id === id);
    if (!o) throw new Error(`generate-fridge: edge case offer ${id} missing`);
    return o;
  };
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
    note: 'SAMPLE DATA. Every record is synthetic: prices, specs and scores are invented and must not be presented as real. Retailers and plans are the shared rows in data/synthetic/.',
    counts: { products: products.length, offers: offers.length, brands: new Set(products.map((p) => p.brand)).size, retailersUsed: new Set(offers.map((o) => o.retailer_id)).size },
    edgeCases: EDGE_CASES,
  };
  return { products, offers, manifest };
}

/** Write the dataset to a directory (default data/synthetic/fridge). */
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
  const out = join(HERE, 'synthetic', CATEGORY);
  const m = writeDataset(out);
  console.log(`wrote ${out}: ${JSON.stringify(m.counts)}`);
}
