// Deterministic synthetic dataset for the laptop category.
//
//   node data/generate-laptop.js     writes data/synthetic/laptop/{products,offers,manifest}.json
//
// SAMPLE DATA ONLY. Every record carries source: "synthetic". Prices, scores and specs are invented for testing the
// engine and must never be presented as real (tech-spec 7). Model-style names are used so Layer 1 phrases can
// name a model; their specs and prices here are made up.
//
// Retailers and plans are the shared ones in data/synthetic/{retailers,plans}.json (written by data/generate.js);
// this file only reads their ids. The retailer zone table below mirrors the one in data/generate.js (it is not
// exported there); if a retailer's zones change there, change them here too.
//
// The same seed always produces byte-identical files. Edge cases are placed explicitly (see EDGE_CASES).
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_NOW, TENANT } from './generate.js';

export const SEED = 20261004;
export const SNAPSHOT_ID = 'synthetic-laptop-2026-10-03';
export const CATEGORY = 'laptop';
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
// Products: 35 laptops, 8 brands, 3 price tiers. Scores are editorial estimates (synthetic).
// cols: id, brand, name, ref price, popular, series, os, dedicated gpu, cpu, gpu, ram, storage, screen quality,
//       screen inches, battery hours, weight kg, build, service, warranty months, keyboard, aliases
// --------------------------------------------------------------------------------------------
const PRODUCTS = [
  // entry (under 25,000)
  ['laptop-acer-chromebook-314', 'Acer', 'Acer Chromebook 314 4GB/128GB', 12500, false, 'entry', 'chromeos', false, 2, 1.5, 4, 128, 4, 14, 10, 1.5, 5, 6, 12, 6, ['chromebook 314']],
  ['laptop-lenovo-ideapad-1', 'Lenovo', 'Lenovo IdeaPad 1 15 Ryzen 3 8GB/256GB', 14000, true, 'entry', 'windows', false, 2.5, 1.5, 8, 256, 4, 15.6, 6, 1.6, 5, 8, 12, 6, ['ideapad 1']],
  ['laptop-hp-15-celeron', 'HP', 'HP 15 Celeron 8GB/256GB', 15000, false, 'entry', 'windows', false, 2.5, 1.5, 8, 256, 4, 15.6, 6.5, 1.69, 5, 8, 12, 6, ['hp 15']],
  ['laptop-asus-vivobook-go-15', 'Asus', 'Asus Vivobook Go 15 8GB/512GB', 16500, false, 'entry', 'windows', false, 3, 2, 8, 512, 5, 15.6, 7, 1.63, 5, 7, 12, 6, ['vivobook go 15', 'vivobook go']],
  ['laptop-acer-aspire-3', 'Acer', 'Acer Aspire 3 Core i3 8GB/512GB', 18000, false, 'entry', 'windows', false, 4, 2, 8, 512, 5, 15.6, 7, 1.7, 5, 6, 12, 6, ['aspire 3']],
  ['laptop-dell-inspiron-3520', 'Dell', 'Dell Inspiron 15 3520 Core i3 8GB/256GB', 19500, false, 'entry', 'windows', false, 4, 2, 8, 256, 5, 15.6, null, 1.65, 6, 8, 12, 7, ['inspiron 3520', 'inspiron 15']],
  ['laptop-lenovo-v15-g4', 'Lenovo', 'Lenovo V15 G4 Ryzen 5 8GB/512GB', 21000, false, 'entry', 'windows', false, 5, 2.5, 8, 512, 5, 15.6, 7, 1.7, 5, 8, 12, 6, ['v15 g4', 'lenovo v15']],
  ['laptop-asus-vivobook-15', 'Asus', 'Asus Vivobook 15 Core i5 16GB/512GB', 22000, false, 'mid', 'windows', false, 5.5, 3, 16, 512, 6, 15.6, 7.5, 1.7, 6, 7, 12, 6, ['vivobook 15']],
  ['laptop-lenovo-ideapad-slim-3', 'Lenovo', 'Lenovo IdeaPad Slim 3 Core i5 8GB/512GB', 23000, true, 'mid', 'windows', false, 5.5, 3, 8, 512, 6, 15.6, 9, 1.62, 6, 8, 12, 7, ['ideapad slim 3', 'slim 3']],
  ['laptop-hp-250-g10', 'HP', 'HP 250 G10 Core i5 8GB/512GB', 24000, false, 'mid', 'windows', false, 5.5, 2.5, 8, 512, 5, 15.6, 7, 1.75, 6, 8, 24, 7, ['hp 250 g10', '250 g10']],
  ['laptop-huawei-matebook-d15', 'Huawei', 'Huawei MateBook D 15 Core i5 8GB/512GB', 24500, false, 'mid', 'windows', false, 5.5, 3, 8, 512, 6, 15.6, 8, 1.56, 7, 6, 12, 7, ['matebook d15', 'matebook d 15']],
  // mid (25,000 to 50,000)
  ['laptop-msi-thin-gf63', 'MSI', 'MSI Thin GF63 Core i5 RTX 2050 8GB/512GB', 33000, false, 'mid', 'windows', true, 6, 4.5, 8, 512, 5, 15.6, 4, 1.86, 5, 5, 12, 6, ['gf63', 'msi thin']],
  ['laptop-lenovo-ideapad-slim-5', 'Lenovo', 'Lenovo IdeaPad Slim 5 14 Ryzen 7 16GB/512GB', 34000, false, 'mid', 'windows', false, 7, 4, 16, 512, 7.5, 14, 12, 1.46, 7, 8, 12, 8, ['ideapad slim 5', 'slim 5']],
  ['laptop-acer-swift-go-14', 'Acer', 'Acer Swift Go 14 OLED Core Ultra 5 16GB/512GB', 35000, false, 'mid', 'windows', false, 7, 4, 16, 512, 8, 14, 11, 1.32, 7, 6, 12, 7, ['swift go 14', 'swift go']],
  ['laptop-dell-inspiron-14-5440', 'Dell', 'Dell Inspiron 14 5440 Core 5 16GB/512GB', 36000, false, 'mid', 'windows', false, 6.5, 3.5, 16, 512, 7, 14, 10, 1.54, 7, 8, 12, 8, ['inspiron 14', 'inspiron 5440']],
  ['laptop-huawei-matebook-14', 'Huawei', 'Huawei MateBook 14 Core Ultra 5 16GB/1TB', 37000, false, 'mid', 'windows', false, 6.5, 4, 16, 1024, 8, 14.2, 11, 1.31, 8, 6, 12, 8, ['matebook 14']],
  ['laptop-hp-victus-15', 'HP', 'HP Victus 15 Core i5 RTX 3050 16GB/512GB', 38000, true, 'mid', 'windows', true, 6.5, 6, 16, 512, 6, 15.6, 5, 2.29, 6, 8, 12, 7, ['victus 15', 'hp victus']],
  ['laptop-asus-vivobook-s14-oled', 'Asus', 'Asus Vivobook S 14 OLED Core Ultra 7 16GB/1TB', 39000, false, 'mid', 'windows', false, 7, 4, 16, 1024, 8.5, 14, 12, 1.3, 7.5, 7, 12, 7.5, ['vivobook s14', 'vivobook s 14']],
  ['laptop-acer-nitro-v15', 'Acer', 'Acer Nitro V 15 Core i5 RTX 4050 16GB/512GB', 40000, false, 'mid', 'windows', true, 6.5, 7.5, 16, 512, 6, 15.6, 4.5, 2.1, 6, 6, 12, 6, ['nitro v15', 'nitro v 15', 'acer nitro']],
  ['laptop-hp-pavilion-plus-14', 'HP', 'HP Pavilion Plus 14 OLED Core i7 16GB/512GB', 42000, false, 'mid', 'windows', false, 7, 4, 16, 512, 8.5, 14, 9, 1.4, 7.5, 8, 12, 8, ['pavilion plus 14', 'pavilion plus']],
  ['laptop-lenovo-thinkpad-e14', 'Lenovo', 'Lenovo ThinkPad E14 Gen 5 Core i7 16GB/512GB', 44000, false, 'mid', 'windows', false, 7, 3.5, 16, 512, 6.5, 14, 9, 1.41, 8.5, 9, 24, 9.5, ['thinkpad e14']],
  ['laptop-lenovo-loq-15', 'Lenovo', 'Lenovo LOQ 15 Core i5 RTX 4050 16GB/512GB', 45000, false, 'mid', 'windows', true, 7, 7.5, 16, 512, 7, 15.6, 5, 2.4, 7, 8, 24, 7, ['loq 15', 'lenovo loq']],
  ['laptop-asus-tuf-a15', 'Asus', 'Asus TUF Gaming A15 Ryzen 7 RTX 4050 16GB/512GB', 47000, false, 'mid', 'windows', true, 7.5, 7.5, 16, 512, 6.5, 15.6, 6, 2.3, 7.5, 7, 12, 6.5, ['tuf a15', 'tuf gaming']],
  ['laptop-apple-macbook-air-m2', 'Apple', 'Apple MacBook Air 13 M2 8GB/256GB', 49000, true, 'mid', 'macos', false, 7.5, 5, 8, 256, 8.5, 13.6, 18, 1.24, 9.5, 7, 12, 8.5, ['macbook air m2', 'air m2']],
  // premium (over 50,000)
  ['laptop-asus-zenbook-14-oled', 'Asus', 'Asus Zenbook 14 OLED Core Ultra 7 16GB/1TB', 55000, false, 'flagship', 'windows', false, 8.5, 5.5, 16, 1024, 9.5, 14, 15, 1.2, 8.5, 7, 12, 8, ['zenbook 14']],
  ['laptop-msi-katana-15', 'MSI', 'MSI Katana 15 Core i7 RTX 4060 16GB/1TB', 58000, false, 'mid', 'windows', true, 8, 8, 16, 1024, 6.5, 15.6, 4, 2.25, 6, 5, 12, 6.5, ['katana 15', 'msi katana']],
  ['laptop-lenovo-yoga-slim-7', 'Lenovo', 'Lenovo Yoga Slim 7 14 Core Ultra 7 32GB/1TB', 62000, false, 'flagship', 'windows', false, 8.5, 5.5, 32, 1024, 9.5, 14, 15, 1.28, 8.5, 8, 12, 8.5, ['yoga slim 7']],
  ['laptop-hp-omen-16', 'HP', 'HP Omen 16 Core i7 RTX 4060 16GB/1TB', 70000, false, 'flagship', 'windows', true, 8.5, 8, 16, 1024, 8, 16.1, 6, 2.35, 8, 8, 12, 7.5, ['omen 16', 'hp omen']],
  ['laptop-apple-macbook-air-m3-15', 'Apple', 'Apple MacBook Air 15 M3 16GB/512GB', 72000, false, 'flagship', 'macos', false, 8.5, 6, 16, 512, 9, 15.3, 18, 1.51, 9.5, 7, 12, 8.5, ['macbook air 15', 'macbook air m3', 'air m3']],
  ['laptop-huawei-matebook-x-pro', 'Huawei', 'Huawei MateBook X Pro Core Ultra 7 32GB/1TB', 85000, false, 'flagship', 'windows', false, 8.5, 5.5, 32, 1024, 10, 14.2, 13, 0.98, 9.5, 6, 12, 8, ['matebook x pro']],
  ['laptop-lenovo-legion-pro-5', 'Lenovo', 'Lenovo Legion Pro 5 Core i7 RTX 4070 32GB/1TB', 88000, false, 'flagship', 'windows', true, 9, 9, 32, 1024, 8.5, 16, 6, 2.5, 8.5, 8, 24, 8, ['legion pro 5', 'legion 5']],
  ['laptop-apple-macbook-pro-14-m4', 'Apple', 'Apple MacBook Pro 14 M4 16GB/512GB', 95000, false, 'flagship', 'macos', false, 9.5, 8, 16, 512, 10, 14.2, 20, 1.55, 10, 7, 12, 9, ['macbook pro 14', 'macbook pro m4']],
  ['laptop-asus-rog-strix-g16', 'Asus', 'Asus ROG Strix G16 Core i9 RTX 4070 16GB/1TB', 95000, false, 'flagship', 'windows', true, 9.5, 9, 16, 1024, 8, 16, 5, 2.5, 8, 7, 12, 8, ['rog strix g16', 'strix g16']],
  ['laptop-dell-xps-14', 'Dell', 'Dell XPS 14 Core Ultra 7 RTX 4050 32GB/1TB', 105000, false, 'flagship', 'windows', true, 9, 6.5, 32, 1024, 9.5, 14.5, 12, 1.68, 9.5, 8, 24, 8, ['xps 14', 'dell xps']],
  ['laptop-lenovo-thinkpad-x1-carbon', 'Lenovo', 'Lenovo ThinkPad X1 Carbon Gen 12 32GB/1TB', 118000, false, 'flagship', 'windows', false, 9, 5, 32, 1024, 9, 14, 14, 1.09, 10, 9, 36, 10, ['x1 carbon', 'thinkpad x1']],
];

// --------------------------------------------------------------------------------------------
// Retailers: ids, zones and price adjustments mirror data/generate.js (not exported there).
// zones: {zone: [fee, minDays, maxDays]}; a missing zone means no delivery there.
// --------------------------------------------------------------------------------------------
const RETAILERS = [
  { id: 'nile', adj: [-0.01, 0.03], zones: { greater_cairo: [0, 1, 2], alexandria: [0, 2, 3], other: [50, 3, 5] } },
  { id: 'pharos', adj: [-0.03, 0.01], zones: { greater_cairo: [0, 1, 2], alexandria: [0, 1, 3], other: [0, 2, 4] } },
  { id: 'lotus', adj: [-0.05, -0.01], zones: { greater_cairo: [0, 2, 3], alexandria: [0, 2, 4], other: [30, 3, 6] } },
  { id: 'oasis', adj: [-0.04, 0], zones: { greater_cairo: [0, 1, 2], alexandria: [0, 1, 2], other: [0, 2, 3] } },
  { id: 'delta', adj: [-0.04, -0.01], zones: { greater_cairo: [40, 2, 3], other: [40, 2, 4] } },
  { id: 'khan', adj: [-0.07, -0.04], imports: true, zones: { greater_cairo: [0, 0, 0] } },
  { id: 'sphinx', adj: [-0.02, 0.02], zones: { greater_cairo: [25, 1, 2], alexandria: [0, 1, 1] } },
];
/** Brands with a grey (imported) laptop market in this synthetic world: only these appear at khan. */
const IMPORT_BRANDS = ['Apple', 'Dell', 'HP'];

// Explicit retailer sets for products the tests and edge cases rely on.
const FORCED_RETAILERS = {
  'laptop-apple-macbook-air-m2': ['khan', 'nile', 'oasis', 'pharos'],
  'laptop-hp-victus-15': ['nile', 'lotus', 'delta', 'sphinx'],
  'laptop-lenovo-ideapad-slim-3': ['pharos', 'lotus', 'delta'],
  'laptop-asus-vivobook-s14-oled': ['sphinx', 'nile', 'oasis'],
  'laptop-hp-250-g10': ['nile', 'delta', 'lotus'],
  'laptop-dell-inspiron-3520': ['nile', 'delta', 'khan'],
};

/** Edge cases, applied after generation so they are guaranteed. Documented in docs/laptop-NOTES.md. */
export const EDGE_CASES = {
  missingSpec: { product: 'laptop-dell-inspiron-3520', attr: 'battery_hours' },
  staleSpecs: { product: 'laptop-lenovo-v15-g4', checkedDaysAgo: 75, note: 'specs older than freshness.specsDays (60): product excluded' },
  allOffersStale: 'laptop-hp-250-g10',
  outOfStock: ['o-laptop-hp-victus-15-lotus'],
  staleOffers: ['o-laptop-lenovo-ideapad-slim-3-pharos'],
  staleExtras: ['o-laptop-asus-vivobook-s14-oled-sphinx'],
  importOffers: 'every offer from khan (official: false); khan carries Apple, Dell and HP only',
  sharedPlans: 'offers carry no plan_ids: the shared retailer plans of data/synthetic/plans.json apply (nile-sahla-promo ends 2026-10-12, oasis-horus-promo-18 expired, sphinx-qest-18 stale, khan-store and delta-sahla need a down payment)',
  productOverridePlan: 'pharos-horus-samsung is limited to Samsung phones, so it never applies to a laptop',
  zoneGaps: ['delta: no alexandria', 'khan: greater_cairo only', 'sphinx: no other governorates'],
};

/** Gifts per retailer, valued in EGP (synthetic). */
function extrasFor(retailerId, ref, price) {
  if (retailerId === 'lotus') return [{ type: 'cashback', label: '5% cashback with Nile Bank cards', value_egp: Math.round(price * 0.05), card_only: true }];
  if (retailerId === 'pharos' && ref < 30000) return [{ type: 'bundle', label: 'Laptop bag and wireless mouse', value_egp: 600 }];
  if (retailerId === 'oasis' && ref >= 50000) return [{ type: 'warranty', label: 'Extra year of warranty', value_egp: 1500 }];
  if (retailerId === 'sphinx' && ref >= 25000 && ref < 60000) return [{ type: 'gift', label: 'Headset and mouse pad', value_egp: 800 }];
  return [];
}

function round1(x) { return Math.round(x * 10) / 10; }

/**
 * Build the laptop dataset in memory.
 * @returns {{products: any[], offers: any[], manifest: any}}
 */
export function generate() {
  const rnd = prng(SEED);
  const between = (lo, hi) => lo + (hi - lo) * rnd();
  const intBetween = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

  const products = PRODUCTS.map((r) => {
    const [id, brand, name, ref, popular, series, os, dgpu, cpu, gpu, ram, storage, screen, inches, battery, weight, build, svc, warr, kb, aliases] = r;
    /** @type {Record<string, any>} */
    const attrs = { cpu, gpu, ram_gb: ram, storage_gb: storage, screen, battery_hours: battery, weight_kg: weight, build, service: svc, warranty_months: warr, keyboard: kb, screen_inches: inches, os, series, has_dedicated_gpu: dgpu };
    for (const k of Object.keys(attrs)) if (attrs[k] === null) delete attrs[k]; // missing spec = key absent
    return { id, tenant_id: TENANT, category: CATEGORY, brand, name, ref_price_egp: ref, popular, aliases, attrs, checked_at: daysAgo(10), source: SOURCE };
  });

  const rById = Object.fromEntries(RETAILERS.map((r) => [r.id, r]));
  const offers = [];
  for (const p of products) {
    let chosen = FORCED_RETAILERS[p.id];
    if (!chosen) {
      // Seeded shuffle, then take 3 to 5 shops; the import shop only carries brands with a grey market.
      const pool = RETAILERS.map((r) => r.id).filter((id) => id !== 'khan' || IMPORT_BRANDS.includes(p.brand));
      for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
      chosen = pool.slice(0, intBetween(3, 5));
    }
    chosen.forEach((rid, idx) => {
      const r = rById[rid];
      let adj = between(r.adj[0], r.adj[1]);
      if (r.imports) adj -= p.brand === 'Apple' ? 0.12 : 0.07; // grey imports are cheaper
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
  const byId = (id) => {
    const o = offers.find((x) => x.id === id);
    if (!o) throw new Error(`edge case names a missing offer ${id}`);
    return o;
  };
  products.find((p) => p.id === EDGE_CASES.staleSpecs.product).checked_at = daysAgo(EDGE_CASES.staleSpecs.checkedDaysAgo);
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
    note: 'SAMPLE DATA. Every record is synthetic: prices, specs, retailers, banks and finance companies are invented and must not be presented as real. Retailers and plans are shared with the mobile dataset (data/synthetic/retailers.json, plans.json).',
    counts: { products: products.length, offers: offers.length, brands: new Set(products.map((p) => p.brand)).size },
    edgeCases: EDGE_CASES,
  };
  return { products, offers, manifest };
}

/** Write the dataset to a directory (default data/synthetic/laptop). */
export function writeDataset(outDir) {
  const data = generate();
  mkdirSync(outDir, { recursive: true });
  for (const key of ['products', 'offers', 'manifest']) writeFileSync(join(outDir, key + '.json'), JSON.stringify(data[key], null, 2) + '\n');
  return data.manifest;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const out = join(dirname(fileURLToPath(import.meta.url)), 'synthetic', CATEGORY);
  const m = writeDataset(out);
  console.log(`wrote ${out}: ${JSON.stringify(m.counts)}`);
}
