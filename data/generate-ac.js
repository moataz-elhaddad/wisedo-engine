// Deterministic synthetic dataset for the air-conditioner (ac) category.
//
//   node data/generate-ac.js     writes data/synthetic/ac/{products,offers,manifest}.json
//
// SAMPLE DATA ONLY. Every record carries source: "synthetic". Prices, specs, kWh figures and offers are invented
// for testing the engine and must never be presented as real (tech-spec 7). Brand and model-style names are used
// so Layer 1 phrases can name a model; their specs and prices here are made up.
//
// Retailers and plans are the shared rows in data/synthetic/{retailers,plans}.json (not written here).
// Offer delivery days for ACs count until the unit is delivered AND installed.
// The same seed always produces byte-identical files. Edge cases are placed explicitly (see EDGE_CASES).
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_NOW, TENANT } from './generate.js';

export const SEED = 20261104;
export const SNAPSHOT_ID = 'synthetic-ac-2026-10-03';
export const CATEGORY = 'ac';
const NOW_MS = Date.parse(DATA_NOW);
const SOURCE = 'synthetic';

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

// --------------------------------------------------------------------------------------------
// Products: 33 split ACs, 9 brands, 5 capacities, 3 tiers. Scores are editorial estimates (synthetic).
// cols: id, brand, name, ref price, popular, series, type, hp, inverter, kwh_year, noise_db, cooling_speed,
//       service, warranty_months (compressor), wifi, heating, low_voltage, t3_rated, aliases
// kwh_year = a typical Egyptian summer (about 8 h a day for 5 months), invented.
// --------------------------------------------------------------------------------------------
const PRODUCTS = [
  // 1.5 hp
  ['ac-fresh-smart-15', 'Fresh', 'Fresh Smart 1.5 HP Cool Only', 15500, false, 'entry', 'wall_split', 1.5, false, 1520, 42, 5.5, 7, 36, false, false, false, false, ['fresh smart 1.5']],
  ['ac-unionaire-artify-15', 'Unionaire', 'Unionaire Artify 1.5 HP Cool Only', 15900, false, 'entry', 'wall_split', 1.5, false, 1550, 41, 6, 7, 60, false, false, true, false, ['artify 1.5']],
  ['ac-tornado-classic-15', 'Tornado', 'Tornado Classic 1.5 HP Cool Only', 16500, true, 'entry', 'wall_split', 1.5, false, 1500, 40, 6, 8, 60, false, false, true, true, ['tornado 1.5']],
  ['ac-midea-mission-15', 'Midea', 'Midea Mission 1.5 HP Cool/Heat', 17500, false, 'entry', 'wall_split', 1.5, false, 1480, 40, 6.5, 7, 60, false, true, false, false, ['mission 1.5']],
  ['ac-sharp-standard-15', 'Sharp', 'Sharp Standard 1.5 HP Cool Only', 17800, true, 'entry', 'wall_split', 1.5, false, 1450, 38, 6.5, 8, 60, false, false, true, true, ['sharp 1.5']],
  ['ac-carrier-optimax-15', 'Carrier', 'Carrier Optimax 1.5 HP Cool/Heat', 18900, false, 'entry', 'wall_split', 1.5, false, 1430, 38, 7, 9, 84, false, true, false, true, ['optimax 1.5']],
  ['ac-tornado-inverter-15', 'Tornado', 'Tornado Inverter 1.5 HP Cool Only', 22800, false, 'mid', 'wall_split', 1.5, true, 1000, 33, 7, 8, 72, false, false, true, true, ['tornado inverter 1.5']],
  ['ac-gree-pular-15', 'Gree', 'Gree Pular Inverter 1.5 HP Cool/Heat', 23500, false, 'mid', 'wall_split', 1.5, true, 990, 32, 7.5, 6, null, false, true, false, false, ['pular 1.5']],
  ['ac-sharp-inverter-15', 'Sharp', 'Sharp Inverter 1.5 HP Cool Only', 24500, true, 'mid', 'wall_split', 1.5, true, 960, 30, 7.5, 8, 84, false, false, true, true, ['sharp inverter 1.5']],
  ['ac-carrier-optimax-inv-15', 'Carrier', 'Carrier Optimax Inverter 1.5 HP Cool/Heat', 27500, false, 'mid', 'wall_split', 1.5, true, 920, 28, 8, 9, 120, true, true, false, true, ['optimax inverter 1.5']],
  ['ac-lg-dualcool-15', 'LG', 'LG DualCool Inverter 1.5 HP Cool/Heat', 30500, false, 'premium', 'wall_split', 1.5, true, 820, 22, 8.5, 8, 120, true, true, true, false, ['dualcool 1.5', 'dual cool 1.5']],
  ['ac-samsung-windfree-15', 'Samsung', 'Samsung WindFree Inverter 1.5 HP Cool/Heat', 33000, false, 'premium', 'wall_split', 1.5, true, 850, 19, 8, 8, 120, true, true, false, false, ['windfree 1.5', 'wind free 1.5']],
  // 2.25 hp
  ['ac-unionaire-artify-225', 'Unionaire', 'Unionaire Artify 2.25 HP Cool Only', 20900, false, 'entry', 'wall_split', 2.25, false, 2200, 43, 6, 7, 60, false, false, true, false, ['artify 2.25']],
  ['ac-tornado-classic-225', 'Tornado', 'Tornado Classic 2.25 HP Cool Only', 21500, true, 'entry', 'wall_split', 2.25, false, 2150, 42, 6.5, 8, 60, false, false, true, true, ['tornado 2.25']],
  ['ac-sharp-standard-225', 'Sharp', 'Sharp Standard 2.25 HP Cool Only', 23000, false, 'entry', 'wall_split', 2.25, false, 2100, 40, 7, 8, 60, false, false, true, true, ['sharp 2.25']],
  ['ac-carrier-optimax-225', 'Carrier', 'Carrier Optimax 2.25 HP Cool/Heat', 24800, false, 'entry', 'wall_split', 2.25, false, 2050, 40, 7.5, 9, 84, false, true, false, true, ['optimax 2.25']],
  ['ac-gree-pular-225', 'Gree', 'Gree Pular Inverter 2.25 HP Cool/Heat', 27000, false, 'mid', 'wall_split', 2.25, true, 1450, 34, 7.5, 6, 60, false, true, false, false, ['pular 2.25']],
  ['ac-midea-mission-inv-225', 'Midea', 'Midea Mission Inverter 2.25 HP Cool/Heat', 28500, false, 'mid', 'wall_split', 2.25, true, 1400, 33, 7.5, 7, 84, false, true, false, false, ['mission inverter 2.25']],
  ['ac-sharp-inverter-225', 'Sharp', 'Sharp Inverter 2.25 HP Cool Only', 31000, true, 'mid', 'wall_split', 2.25, true, 1350, 32, 8, 8, 84, false, false, true, true, ['sharp inverter 2.25']],
  ['ac-lg-dualcool-225', 'LG', 'LG DualCool Inverter 2.25 HP Cool/Heat', 38500, false, 'premium', 'wall_split', 2.25, true, 1200, 25, 8.5, 8, 120, true, true, true, false, ['dualcool 2.25', 'dual cool 2.25']],
  ['ac-samsung-windfree-225', 'Samsung', 'Samsung WindFree Inverter 2.25 HP Cool/Heat', 41000, false, 'premium', 'wall_split', 2.25, true, 1250, 21, 8.5, 8, 120, true, true, false, false, ['windfree 2.25', 'wind free 2.25']],
  // 3 hp
  ['ac-unionaire-artify-3', 'Unionaire', 'Unionaire Artify 3 HP Cool Only', 27000, false, 'entry', 'wall_split', 3, false, 2900, 45, 6.5, 7, 60, false, false, true, false, ['artify 3']],
  ['ac-tornado-classic-3', 'Tornado', 'Tornado Classic 3 HP Cool Only', 28000, true, 'entry', 'wall_split', 3, false, 2850, 45, 7, 8, 60, false, false, true, true, ['tornado 3']],
  ['ac-carrier-optimax-3', 'Carrier', 'Carrier Optimax 3 HP Cool/Heat', 31500, false, 'entry', 'wall_split', 3, false, 2750, 43, 7.5, 9, 84, false, true, false, true, ['optimax 3']],
  ['ac-sharp-inverter-3', 'Sharp', 'Sharp Inverter 3 HP Cool Only', 39000, false, 'mid', 'wall_split', 3, true, 1850, 35, 8, 8, 84, false, false, true, true, ['sharp inverter 3']],
  ['ac-carrier-optimax-inv-3', 'Carrier', 'Carrier Optimax Inverter 3 HP Cool/Heat', 43500, false, 'mid', 'wall_split', 3, true, 1800, 34, 8.5, 9, 120, true, true, false, true, ['optimax inverter 3']],
  ['ac-lg-dualcool-3', 'LG', 'LG DualCool Inverter 3 HP Cool/Heat', 49000, false, 'premium', 'wall_split', 3, true, 1650, 28, 9, 8, 120, true, true, true, false, ['dualcool 3', 'dual cool 3']],
  // 4 hp
  ['ac-tornado-classic-4', 'Tornado', 'Tornado Classic 4 HP Cool Only', 38000, false, 'entry', 'wall_split', 4, false, 3600, 46, 7, 8, 60, false, false, true, true, ['tornado 4']],
  ['ac-carrier-optimax-4', 'Carrier', 'Carrier Optimax 4 HP Cool/Heat', 45000, false, 'mid', 'wall_split', 4, false, 3500, 46, 7.5, 9, 84, false, true, false, true, ['optimax 4']],
  ['ac-sharp-inverter-4', 'Sharp', 'Sharp Inverter 4 HP Cool Only', 52000, false, 'premium', 'wall_split', 4, true, 2450, 38, 8.5, 8, 84, false, false, true, true, ['sharp inverter 4']],
  // 5 hp (floor standing)
  ['ac-tornado-floor-5', 'Tornado', 'Tornado Floor Standing 5 HP Cool Only', 49000, false, 'mid', 'floor_standing', 5, false, 4400, 52, 7.5, 8, 60, false, false, true, true, ['tornado 5']],
  ['ac-carrier-floor-5', 'Carrier', 'Carrier Floor Standing 5 HP Cool/Heat', 54000, false, 'mid', 'floor_standing', 5, false, 4300, 50, 8, 9, 84, false, true, false, true, ['carrier 5']],
  ['ac-lg-floor-inv-5', 'LG', 'LG Floor Standing Inverter 5 HP Cool/Heat', 62000, false, 'premium', 'floor_standing', 5, true, 3000, 42, 9, 8, 120, true, true, true, false, ['lg 5']],
];

// --------------------------------------------------------------------------------------------
// Heavy-item delivery by retailer and zone: [fee, minDays, maxDays] until delivered AND installed.
// The retailers themselves (trust, COD, returns) are the shared rows in data/synthetic/retailers.json.
// A missing zone means the shop does not deliver ACs there.
// --------------------------------------------------------------------------------------------
const SHOPS = {
  nile: { adj: [-0.01, 0.03], zones: { greater_cairo: [150, 2, 3], alexandria: [250, 3, 5], other: [350, 4, 7] } },
  pharos: { adj: [-0.03, 0.01], zones: { greater_cairo: [0, 2, 4], alexandria: [200, 3, 5], other: [300, 4, 6] } },
  lotus: { adj: [-0.05, -0.01], zones: { greater_cairo: [100, 3, 5], alexandria: [150, 3, 5], other: [300, 5, 8] } },
  oasis: { adj: [-0.04, 0], zones: { greater_cairo: [0, 1, 3], alexandria: [0, 2, 4], other: [250, 3, 6] } },
  delta: { adj: [-0.04, -0.01], zones: { greater_cairo: [200, 2, 4], other: [300, 3, 6] } },
  khan: { adj: [-0.09, -0.06], imports: true, zones: { greater_cairo: [300, 1, 2] } },
  sphinx: { adj: [-0.02, 0.02], zones: { greater_cairo: [150, 2, 3], alexandria: [100, 2, 3] } },
};
const SHOP_IDS = Object.keys(SHOPS);
/** Brands with a grey-import market (the only ones the import shop carries). */
const IMPORT_BRANDS = ['LG', 'Samsung', 'Gree', 'Midea'];

// Explicit retailer sets for products the tests and edge cases rely on (first shop = always fresh and in stock).
const FORCED_RETAILERS = {
  'ac-sharp-inverter-15': ['pharos', 'nile', 'lotus', 'sphinx'],
  'ac-tornado-classic-15': ['oasis', 'nile', 'delta'],
  'ac-fresh-smart-15': ['delta', 'lotus', 'nile'],
  'ac-lg-dualcool-15': ['khan', 'nile', 'oasis', 'pharos'],
  'ac-unionaire-artify-3': ['nile', 'delta', 'lotus'],
  'ac-carrier-optimax-inv-15': ['oasis', 'pharos', 'sphinx'],
};

/** Edge cases, applied after generation so they are guaranteed. */
const EDGE_CASES = {
  missingSpec: { product: 'ac-gree-pular-15', attr: 'warranty_months' },
  allOffersStale: 'ac-unionaire-artify-3',
  outOfStock: ['o-ac-sharp-inverter-15-lotus'],
  staleOffers: ['o-ac-tornado-classic-15-nile'],
  staleExtras: ['o-ac-carrier-optimax-inv-15-sphinx'],
  importOffers: 'every offer from khan (official: false, no free installation); khan carries LG, Samsung, Gree and Midea only',
  freeInstall: 'pharos and oasis always include installation; nile includes it from a reference price of 25,000; the others charge config.installCost (700)',
  cardOnlyCashback: 'lotus: 5% cashback with Nile Bank cards (card buyers only)',
  zoneGaps: ['delta: no alexandria', 'khan: greater_cairo only', 'sphinx: no other governorates'],
  sharedPlans: 'plans are the shared rows of data/synthetic/plans.json (retailer-wide); pharos-horus-samsung is limited to Samsung phones, so it never applies to ACs',
};

/** Extras per retailer, valued in EGP (synthetic). `install` = free installation (removes config.installCost). */
function extrasFor(retailerId, ref, price, hp) {
  const out = [];
  if (retailerId === 'pharos') out.push({ type: 'install', label: 'Free standard installation', value_egp: 700 });
  if (retailerId === 'oasis') {
    out.push({ type: 'install', label: 'Free standard installation', value_egp: 700 });
    if (ref >= 30000) out.push({ type: 'warranty', label: 'Extra year of full warranty', value_egp: 900 });
  }
  if (retailerId === 'nile' && ref >= 25000) out.push({ type: 'install', label: 'Free installation', value_egp: 700 });
  if (retailerId === 'lotus') out.push({ type: 'cashback', label: '5% cashback with Nile Bank cards', value_egp: Math.round(price * 0.05), card_only: true });
  if (retailerId === 'sphinx' && hp <= 2.25) out.push({ type: 'gift', label: 'Voltage stabiliser', value_egp: 600 });
  if (retailerId === 'delta' && hp >= 3) out.push({ type: 'bundle', label: 'Extra 2 m of copper pipe', value_egp: 450 });
  return out;
}

/**
 * Build the AC dataset in memory.
 * @returns {{products: any[], offers: any[], manifest: any}}
 */
export function generate() {
  const rnd = prng(SEED);
  const between = (lo, hi) => lo + (hi - lo) * rnd();
  const intBetween = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

  const products = PRODUCTS.map((r) => {
    const [id, brand, name, ref, popular, series, type, hp, inverter, kwh, noise, speed, svc, warr, wifi, heating, lowV, t3, aliases] = r;
    /** @type {Record<string, any>} */
    const attrs = { cooling_hp: hp, inverter, kwh_year: kwh, noise_db: noise, cooling_speed: speed, service: svc, warranty_months: warr, wifi, heating, low_voltage: lowV, t3_rated: t3, type, series };
    for (const k of Object.keys(attrs)) if (attrs[k] === null) delete attrs[k]; // missing spec = key absent
    return { id, tenant_id: TENANT, category: CATEGORY, brand, name, ref_price_egp: ref, popular, aliases, attrs, checked_at: daysAgo(12), source: SOURCE };
  });

  const offers = [];
  for (const p of products) {
    let chosen = FORCED_RETAILERS[p.id];
    if (!chosen) {
      // Seeded shuffle, then take 3 to 5 shops; the import shop only carries brands with a grey market.
      const pool = SHOP_IDS.filter((id) => id !== 'khan' || IMPORT_BRANDS.includes(p.brand));
      for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
      chosen = pool.slice(0, intBetween(3, 5));
    }
    chosen.forEach((rid, idx) => {
      const r = SHOPS[rid];
      const adj = between(r.adj[0], r.adj[1]);
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
        extras: r.imports ? [] : extrasFor(rid, p.ref_price_egp, price, p.attrs.cooling_hp),
        checked_at: idx > 0 && staleRoll < 0.06 ? hoursAgo(30 + Math.floor(staleRoll * 500)) : hoursAgo(ageH),
        source: SOURCE,
      });
    });
  }

  // ---- explicit edge cases ----
  const byId = (id) => {
    const o = offers.find((x) => x.id === id);
    if (!o) throw new Error('generate-ac: edge-case offer missing ' + id);
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
    note: 'SAMPLE DATA. Every record is synthetic: prices, specs, kWh figures and offers are invented and must not be presented as real. Retailers and plans are the shared synthetic rows in data/synthetic/.',
    counts: { products: products.length, offers: offers.length, brands: new Set(products.map((p) => p.brand)).size },
    edgeCases: EDGE_CASES,
  };
  return { products, offers, manifest };
}

function round1(x) { return Math.round(x * 10) / 10; }

/** Write the dataset to a directory (default data/synthetic/ac). */
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
  const out = join(dirname(fileURLToPath(import.meta.url)), 'synthetic', 'ac');
  const m = writeDataset(out);
  console.log(`wrote ${out}: ${JSON.stringify(m.counts)}`);
}
