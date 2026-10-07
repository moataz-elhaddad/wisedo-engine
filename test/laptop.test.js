// Laptop category: config and snapshot contracts, deterministic synthetic data, scripted buyer personas through
// Layer 2 (rank and simulate), a Layer 1 session from the tile and from text, and the laptop eval phrases.
// All data is synthetic (data/generate-laptop.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildNeedProfile } from '../src/profile/build.js';
import { match } from '../src/layer2/index.js';
import { validateCategoryConfig, validateSnapshot } from '../src/contracts.js';
import { step, createMockLlm, recording, detectByRules } from '../src/layer1/index.js';
import { DATA_NOW, TENANT } from '../data/generate.js';
import { generate, EDGE_CASES } from '../data/generate-laptop.js';
import { TOPIC_FACTOR, REASONS, LANGS } from '../eval/coverage.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const NOW = DATA_NOW;

const config = readJson('config/laptop.json');
const files = {
  products: readJson('data/synthetic/laptop/products.json'),
  offers: readJson('data/synthetic/laptop/offers.json'),
  manifest: readJson('data/synthetic/laptop/manifest.json'),
};

/** A fresh laptop snapshot: laptop config and rows plus the shared retailers and plans. */
function laptopSnapshot() {
  return {
    snapshot_id: 'synthetic-laptop-2026-10-03',
    tenant_id: TENANT,
    configs: { laptop: structuredClone(config) },
    products: structuredClone(files.products),
    retailers: readJson('data/synthetic/retailers.json'),
    offers: structuredClone(files.offers),
    plans: readJson('data/synthetic/plans.json'),
  };
}
const SNAP = laptopSnapshot();
const productById = new Map(SNAP.products.map((p) => [p.id, p]));
const attrs = (id) => productById.get(id).attrs;
const rank = (answers) => match(buildNeedProfile(config, answers), SNAP, NOW, 'rank');
const best = (r) => r.picks.find((p) => p.role === 'best_fit');

// ---------------------------------------------------------------------------------------------
// Config and data contracts
// ---------------------------------------------------------------------------------------------

test('laptop config passes the publish check; alias notebook; shared zones', () => {
  assert.deepEqual(validateCategoryConfig(config).errors, []);
  assert.equal(config.id, 'laptop');
  assert.equal(config.version, '1.0.0');
  assert.deepEqual(config.aliases, ['notebook']);
  assert.deepEqual(config.zones, readJson('config/mobile.json').zones);
  assert.ok(config.slots.length >= 15 && config.slots.length <= 24, `${config.slots.length} slots`);
  assert.ok(config.factors.length >= 30 && config.factors.length <= 45, `${config.factors.length} factors`);
  assert.equal(config.runningCost.type, 'none');
  assert.equal(config.installCost, 0);
});

test('laptop config: every user-facing string has ar and en', () => {
  const bad = [];
  const walk = (v, path) => {
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${path}[${i}]`));
    if (!v || typeof v !== 'object') return;
    for (const [k, x] of Object.entries(v)) {
      if (['label', 'question', 'message', 'why', 'explain', 'reason'].includes(k) && x && typeof x === 'object' && !Array.isArray(x)) {
        if (typeof x.ar !== 'string' || !x.ar || typeof x.en !== 'string' || !x.en) bad.push(`${path}.${k}`);
      } else walk(x, `${path}.${k}`);
    }
  };
  walk({ attributes: config.attributes, slots: config.slots, checks: config.checks, runningCost: config.runningCost }, 'config');
  assert.deepEqual(bad, []);
});

test('laptop config: every option id, slot and attribute referenced anywhere exists', () => {
  const slotById = new Map(config.slots.map((s) => [s.id, s]));
  const attrIds = new Set(config.attributes.map((a) => a.id));
  const optionIds = (slotId) => new Set(slotById.get(slotId).options.map((o) => o.id));
  const errors = [];
  // Slot conditions inside askIf, alwaysIf and checks: {slot, in: [optionIds]}.
  const walk = (c, where) => {
    if (!c || typeof c !== 'object') return;
    for (const k of ['all', 'any']) if (Array.isArray(c[k])) c[k].forEach((x) => walk(x, where));
    if (c.not) walk(c.not, where);
    if (c.slot) {
      if (!slotById.has(c.slot)) errors.push(`${where}: unknown slot ${c.slot}`);
      else for (const v of c.in || []) if (!optionIds(c.slot).has(v)) errors.push(`${where}: ${c.slot} has no option ${v}`);
    }
  };
  for (const s of config.slots) {
    for (const k of ['askIf', 'alwaysIf']) walk(s[k], `slots.${s.id}.${k}`);
    for (const [dep, vals] of Object.entries(s.dependsOn || {})) for (const v of vals) if (!optionIds(dep).has(v)) errors.push(`slots.${s.id}.dependsOn: ${dep}.${v}`);
    if (s.default !== undefined && !optionIds(s.id).has(s.default)) errors.push(`slots.${s.id}.default ${s.default}`);
    for (const o of s.options) {
      const e = o.effects || {};
      for (const k of Object.keys(e.weights || {})) if (!attrIds.has(k)) errors.push(`${s.id}.${o.id}: weight ${k}`);
      for (const f of [...(e.must || []), ...(e.prefer || []), ...(e.bonus || [])]) if (!attrIds.has(f.attr) && f.attr !== 'brand' && f.attr !== 'id') errors.push(`${s.id}.${o.id}: filter ${f.attr}`);
    }
  }
  for (const c of config.checks) walk(c.when, `checks.${c.id}`);
  for (const k of Object.keys(config.baseWeights)) if (!attrIds.has(k)) errors.push(`baseWeights.${k}`);
  // Brand options name brands that exist in the catalog.
  const brands = new Set(SNAP.products.map((p) => p.brand));
  for (const o of slotById.get('brand').options) for (const b of o.effects.bonus[0].value) if (!brands.has(b)) errors.push(`brand.${o.id}: ${b} not in catalog`);
  // City options are exactly the zone cities.
  assert.deepEqual([...optionIds('city')].sort(), Object.keys(config.zones.cities).sort());
  assert.deepEqual(errors, []);
});

test('laptop snapshot validates; ids are prefixed and globally unique; every row is synthetic', () => {
  assert.deepEqual(validateSnapshot(SNAP).errors, []);
  const mobileIds = new Set(readJson('data/synthetic/products.json').map((p) => p.id));
  const mobileOfferIds = new Set(readJson('data/synthetic/offers.json').map((o) => o.id));
  assert.ok(SNAP.products.length >= 28 && SNAP.products.length <= 36);
  for (const p of SNAP.products) {
    assert.ok(p.id.startsWith('laptop-'), p.id);
    assert.ok(!mobileIds.has(p.id), p.id);
    assert.equal(p.category, 'laptop');
    assert.equal(p.source, 'synthetic');
    assert.ok(p.ref_price_egp >= 12000 && p.ref_price_egp <= 120000, p.id);
  }
  for (const o of SNAP.offers) {
    assert.ok(!mobileOfferIds.has(o.id), o.id);
    assert.equal(o.source, 'synthetic');
    assert.equal(o.plan_ids, undefined, 'laptop offers use the shared retailer plans');
  }
  const perProduct = new Map();
  for (const o of SNAP.offers) perProduct.set(o.product_id, (perProduct.get(o.product_id) || 0) + 1);
  for (const [id, n] of perProduct) assert.ok(n >= 3 && n <= 5, `${id}: ${n} offers`);
  // Three price tiers and several brands.
  const tiers = [0, 0, 0];
  for (const p of SNAP.products) tiers[p.ref_price_egp < 25000 ? 0 : p.ref_price_egp <= 50000 ? 1 : 2]++;
  assert.ok(tiers.every((n) => n >= 8), tiers.join());
  assert.ok(new Set(SNAP.products.map((p) => p.brand)).size >= 6);
  // A combined snapshot (mobile + laptop) still validates: categories can share one snapshot.
  const combined = { ...SNAP, configs: { mobile: readJson('config/mobile.json'), laptop: config }, products: [...readJson('data/synthetic/products.json'), ...SNAP.products], offers: [...readJson('data/synthetic/offers.json'), ...SNAP.offers] };
  assert.deepEqual(validateSnapshot(combined).errors, []);
  const p = buildNeedProfile(config, { use: ['office'], pay: 'cash', budget: 30000 });
  assert.deepEqual(match(p, combined, NOW).picks.map((x) => x.product.id), match(p, SNAP, NOW).picks.map((x) => x.product.id));
});

test('laptop generator is deterministic and matches the committed files', () => {
  const a = JSON.parse(JSON.stringify(generate()));
  const b = JSON.parse(JSON.stringify(generate()));
  assert.deepEqual(a, b);
  assert.deepEqual(a.products, files.products);
  assert.deepEqual(a.offers, files.offers);
  assert.deepEqual(a.manifest, files.manifest);
  assert.deepEqual(files.manifest.edgeCases, JSON.parse(JSON.stringify(EDGE_CASES)));
});

test('laptop edge cases are present and handled', () => {
  const offer = (id) => SNAP.offers.find((o) => o.id === id);
  assert.equal(attrs(EDGE_CASES.missingSpec.product)[EDGE_CASES.missingSpec.attr], undefined);
  assert.ok(Date.parse(NOW) - Date.parse(productById.get(EDGE_CASES.staleSpecs.product).checked_at) > 60 * 864e5);
  for (const o of SNAP.offers.filter((x) => x.product_id === EDGE_CASES.allOffersStale)) assert.ok(Date.parse(NOW) - Date.parse(o.checked_at) > 24 * 36e5);
  for (const id of EDGE_CASES.outOfStock) assert.equal(offer(id).in_stock, false);
  for (const id of EDGE_CASES.staleOffers) assert.ok(Date.parse(NOW) - Date.parse(offer(id).checked_at) > 24 * 36e5);
  for (const id of EDGE_CASES.staleExtras) assert.ok(offer(id).extras_checked_at);
  const khan = SNAP.offers.filter((o) => o.retailer_id === 'khan');
  assert.ok(khan.length >= 3 && khan.every((o) => !o.official));
  assert.ok(khan.every((o) => ['Apple', 'Dell', 'HP'].includes(productById.get(o.product_id).brand)));

  // A broad profile: the stale-spec and all-stale products never appear; the missing spec is reported, not guessed.
  const r = match(buildNeedProfile(config, { pay: 'cash', budget: 400000 }), SNAP, NOW, 'rank', { maxList: 40 });
  const listed = [...r.picks, ...r.others].map((x) => x.product.id);
  assert.equal(listed.length, SNAP.products.length - 2);
  assert.ok(listed.includes(EDGE_CASES.missingSpec.product));
  assert.ok(!listed.includes(EDGE_CASES.staleSpecs.product));
  assert.ok(!listed.includes(EDGE_CASES.allOffersStale));
  assert.equal(r.counts.loaded, SNAP.products.length - 2);
  const inspiron = match(buildNeedProfile(config, { pay: 'cash', budget: 21000, modelInMind: EDGE_CASES.missingSpec.product }), SNAP, NOW);
  assert.ok(inspiron.modelVerdict && inspiron.modelVerdict.productId === EDGE_CASES.missingSpec.product);
});

// ---------------------------------------------------------------------------------------------
// Personas (Layer 2): the top pick must make sense for the buyer
// ---------------------------------------------------------------------------------------------

const PERSONAS = {
  student20: { who: 'kid', use: ['study'], pay: 'cash', budget: 20000 },
  parent15: { who: 'parent', pay: 'cash', budget: 15000 },
  office30: { use: ['office'], pay: 'cash', budget: 30000 },
  coder45: { use: ['programming'], pay: 'cash', budget: 45000 },
  gamer50: { use: ['gaming'], gameLevel: 'heavy', pay: 'cash', budget: 50000 },
  gamer100: { use: ['gaming'], gameLevel: 'heavy', pay: 'cash', budget: 100000 },
  video75: { use: ['video'], pay: 'cash', budget: 75000 },
  macDesigner80: { use: ['design'], os: 'macos', pay: 'cash', budget: 80000 },
  carrier40: { use: ['study'], portability: 'daily', pay: 'cash', budget: 40000 },
  winSmall60: { use: ['office'], compat: ['windows_apps'], screenSize: 'small', pay: 'cash', budget: 60000 },
  finance2500: { use: ['office'], pay: 'finance', monthlyCap: 2500 },
  gamer25: { use: ['gaming'], gameLevel: 'heavy', pay: 'cash', budget: 25000 },
};
const R = Object.fromEntries(Object.entries(PERSONAS).map(([k, a]) => [k, rank(a)]));

test('persona: a student on 20,000 cash gets an entry laptop within budget', () => {
  const b = best(R.student20);
  assert.equal(R.student20.status, 'ok');
  assert.ok(b.quote.cashOut <= 20000, String(b.quote.cashOut));
  assert.ok(productById.get(b.product.id).ref_price_egp < 25000);
});

test('persona: an older relative on 15,000 gets a cheap, well-serviced laptop', () => {
  const b = best(R.parent15);
  assert.ok(b.quote.cashOut <= 15000);
  assert.ok(attrs(b.product.id).service >= 7, b.product.id);
});

test('persona: tight budgets get cheaper laptops than heavy needs', () => {
  const price = (k) => best(R[k]).quote.price;
  assert.ok(price('student20') < price('coder45'));
  assert.ok(price('parent15') < price('office30'));
  assert.ok(price('gamer50') < price('gamer100'));
  assert.ok(attrs(best(R.gamer100).product.id).gpu > attrs(best(R.gamer50).product.id).gpu, 'more money buys a stronger GPU');
});

test('persona: a programmer gets 16 GB RAM and a strong processor', () => {
  const a = attrs(best(R.coder45).product.id);
  assert.ok(a.ram_gb >= 16 && a.cpu >= 6.5, JSON.stringify(a));
});

test('persona: heavy gamers get dedicated graphics in every pick', () => {
  for (const k of ['gamer50', 'gamer100']) {
    assert.equal(R[k].status, 'ok');
    for (const p of R[k].picks) assert.equal(attrs(p.product.id).has_dedicated_gpu, true, `${k}: ${p.product.id}`);
  }
  assert.ok(attrs(best(R.gamer100).product.id).gpu >= 8.5);
});

test('persona: heavy gaming on 25,000 finds nothing and says why', () => {
  assert.equal(R.gamer25.status, 'nothing_fits');
  assert.ok(R.gamer25.warnings.some((w) => w.code === 'check:heavy_gaming_low_budget'));
  assert.ok(R.gamer25.nothingFits && R.gamer25.nothingFits.product);
  assert.equal(attrs(R.gamer25.nothingFits.product.id || R.gamer25.nothingFits.product).has_dedicated_gpu, true);
});

test('persona: a video editor gets 16 GB+ RAM and a fast processor', () => {
  for (const p of R.video75.picks) assert.ok(attrs(p.product.id).ram_gb >= 16, p.product.id);
  assert.ok(attrs(best(R.video75).product.id).cpu >= 8);
});

test('persona: a Mac-only designer gets MacBooks only', () => {
  assert.ok(R.macDesigner80.picks.length >= 1);
  for (const p of R.macDesigner80.picks) assert.equal(attrs(p.product.id).os, 'macos');
  assert.ok(attrs(best(R.macDesigner80).product.id).screen >= 9);
});

test('persona: daily carrying favours a light laptop with long battery', () => {
  const a = attrs(best(R.carrier40).product.id);
  assert.ok(a.weight_kg <= 1.5 && a.battery_hours >= 10, JSON.stringify(a));
});

test('persona: Windows-only programs and a compact screen are hard filters', () => {
  for (const p of R.winSmall60.picks) {
    assert.equal(attrs(p.product.id).os, 'windows');
    assert.ok(attrs(p.product.id).screen_inches <= 14.5);
  }
});

test('persona: a finance buyer at 2,500 a month gets a plan within the cap', () => {
  const b = best(R.finance2500);
  assert.ok(b.quote.plan, 'quoted on a plan');
  assert.ok(b.quote.plan.monthly <= 2500, String(b.quote.plan.monthly));
  assert.equal(b.quote.plan.kind, 'finance');
});

test('imports: khan offers are never quoted unless the buyer accepts imports', () => {
  for (const r of Object.values(R)) for (const p of r.picks) assert.notEqual(p.quote.retailerId, 'khan');
  // The MacBook Air M2 costs about 48,000 officially; the grey import at khan is under 45,000.
  const mac = 'laptop-apple-macbook-air-m2';
  const strict = rank({ modelInMind: mac, pay: 'cash', budget: 45000, city: 'cairo' });
  const loose = rank({ modelInMind: mac, pay: 'cash', budget: 45000, city: 'cairo', acceptImports: 'yes' });
  assert.equal(strict.modelVerdict.type, 'over_budget');
  assert.ok(!strict.picks.some((p) => p.product.id === mac));
  assert.equal(loose.modelVerdict.type, 'picked');
  const pick = loose.picks.find((p) => p.product.id === mac);
  assert.equal(pick.quote.retailerId, 'khan');
  assert.equal(pick.quote.official, false);
  assert.ok(pick.warnings.some((w) => w.code === 'import_offer'));
});

test('simulate and rank agree on the top pick for every persona', () => {
  for (const [k, a] of Object.entries(PERSONAS)) {
    const p = buildNeedProfile(config, a);
    const s = match(p, SNAP, NOW, 'simulate');
    assert.equal(s.mode, 'simulate');
    const b = best(R[k]);
    assert.equal(s.top1, b ? b.product.id : null, k);
    if (b) assert.equal(s.top3[0], b.product.id);
  }
});

test('resale: a MacBook kept two years keeps more value than a Windows laptop', () => {
  const r = rank({ use: ['design'], keep: 'short', pay: 'cash', budget: 80000 });
  const mac = r.picks.find((p) => attrs(p.product.id).os === 'macos');
  const win = r.picks.find((p) => attrs(p.product.id).os === 'windows');
  assert.ok(mac && win, 'a design buyer at 80,000 sees both a MacBook and a Windows laptop');
  assert.equal(mac.tco.resaleShare, 0.55);
  assert.ok(win.tco.resaleShare <= 0.35);
  // Without "keep short" no resale is counted.
  const noKeep = rank({ use: ['design'], pay: 'cash', budget: 80000 });
  assert.ok(noKeep.picks.every((p) => !p.tco.resaleShare));
});

// ---------------------------------------------------------------------------------------------
// Layer 1
// ---------------------------------------------------------------------------------------------

/** Answer from `answers` when the question's slot is there, skip otherwise; clarifying questions keep. */
async function runToResult(state, ui, ctx, answers = {}) {
  const log = [];
  let guard = 0;
  while ((ui.screen === 'question' || ui.screen === 'clarify') && guard++ < 30) {
    if (ui.screen === 'clarify') { log.push('?' + ui.clarify.id); ({ state, ui } = await step(state, { type: 'answer', option: 'keep' }, ctx)); continue; }
    log.push(ui.question.slot);
    const ev = ui.question.slot in answers ? { type: 'answer', value: answers[ui.question.slot] } : { type: 'skip' };
    ({ state, ui } = await step(state, ev, ctx));
  }
  return { state, ui, log };
}

test('layer1: laptop words and the notebook alias reach the laptop config', async () => {
  for (const t of ['عايز لابتوب', 'I need a new laptop', 'محتاج ماك بوك']) assert.equal(detectByRules(t).category, 'laptop', t);
  const ctx = { snapshot: SNAP, now: NOW };
  for (const tile of ['laptop', 'notebook']) {
    const { ui } = await step(null, { type: 'start', tile }, ctx);
    assert.equal(ui.screen, 'question', tile);
    assert.equal(ui.category, 'laptop');
    assert.equal(ui.question.slot, 'who');
  }
});

test('layer1 session from the tile: a student reaches a result in 6 questions or fewer', async () => {
  const ctx = { snapshot: SNAP, now: NOW };
  const answers = { who: 'kid', use: ['study'], pay: 'cash', budget: 20000, urgentDays: 'none', pain: ['battery'], screenSize: 'any', portability: 'daily', acceptImports: 'no' };
  const { state, ui } = await step(null, { type: 'start', tile: 'laptop' }, ctx);
  const r = await runToResult(state, ui, ctx, answers);
  assert.equal(r.ui.screen, 'result', r.log.join());
  assert.ok(r.ui.questionsAsked <= 6, `${r.ui.questionsAsked} questions: ${r.log.join()}`);
  assert.deepEqual(r.log.slice(0, 2), ['who', 'use']);
  for (const id of config.slots.filter((s) => s.manual).map((s) => s.id)) assert.ok(!r.log.includes(id), `${id} was asked`);
  const b = r.ui.result.picks.find((p) => p.role === 'best_fit');
  assert.ok(b && b.quote.cashOut <= 20000);
  assert.equal(r.ui.profile.category, 'laptop');
});

test('layer1 session from text: a programmer with money stated reaches a result in 6 questions or fewer', async () => {
  const text = 'عايز لابتوب للبرمجة، ميزانيتي 45 ألف كاش';
  const item = (slot, values, evidence, amountText = null) => ({ slot, values, amountText, confidence: 0.9, evidence });
  const ctx = {
    snapshot: SNAP, now: NOW,
    llm: createMockLlm([recording(text, { slots: [item('use', ['programming'], 'للبرمجة'), item('pay', ['cash'], 'كاش'), item('budget', [], 'ميزانيتي 45 ألف', '45 ألف')], unmapped: [] }, { category: 'laptop' })]),
  };
  const { state, ui } = await step(null, { type: 'start', text }, ctx);
  assert.equal(ui.category, 'laptop');
  assert.ok(ui.chips.some((c) => c.slot === 'budget' && c.kind === 'value'));
  const r = await runToResult(state, ui, ctx, { who: 'me', urgentDays: 'none', pain: ['slow'], screenSize: 'any', portability: 'sometimes' });
  assert.equal(r.ui.screen, 'result', r.log.join());
  assert.ok(r.ui.questionsAsked <= 6, `${r.ui.questionsAsked} questions: ${r.log.join()}`);
  assert.ok(!r.log.includes('use') && !r.log.includes('budget') && !r.log.includes('pay'), 'pre-filled slots are not asked');
  const b = r.ui.result.picks.find((p) => p.role === 'best_fit');
  assert.ok(attrs(b.product.id).ram_gb >= 16 && b.quote.cashOut <= 45000);
});

test('layer1 U6: Mac only on 20,000 is a blocking expectation gap', async () => {
  const text = 'عايز ماك بوك بس، ميزانيتي 20 ألف كاش';
  const item = (slot, values, evidence, amountText = null) => ({ slot, values, amountText, confidence: 0.9, evidence });
  const ctx = {
    snapshot: SNAP, now: NOW,
    llm: createMockLlm([recording(text, { slots: [item('os', ['macos'], 'ماك بوك بس'), item('pay', ['cash'], 'كاش'), item('budget', [], 'ميزانيتي 20 ألف', '20 ألف')], unmapped: [] }, { category: 'laptop' })]),
  };
  const { ui } = await step(null, { type: 'start', text }, ctx);
  assert.equal(ui.screen, 'clarify');
  assert.equal(ui.clarify.id, 'budget_gap');
  assert.ok(ui.clarify.options.some((o) => o.id === 'relax:os'));
});

// ---------------------------------------------------------------------------------------------
// Eval phrases (eval/phrases-laptop.jsonl). The shared checker in eval/coverage.js treats every non-mobile phrase
// as detection-only, so the laptop file is checked here against config/laptop.json with the same rules.
// ---------------------------------------------------------------------------------------------

test('laptop eval phrases: 40 valid synthetic lines whose slots, values and factor tags match the config', () => {
  const lines = readFileSync(join(ROOT, 'eval/phrases-laptop.jsonl'), 'utf8').split('\n').filter((l) => l.trim());
  const phrases = lines.map((l) => JSON.parse(l));
  assert.equal(phrases.length, 40);
  assert.equal(new Set(phrases.map((p) => p.id)).size, 40);
  assert.equal(new Set(phrases.map((p) => p.text)).size, 40);
  const slotById = new Map(config.slots.map((s) => [s.id, s]));
  const factorIds = new Set(config.factors.map((f) => f.id));
  const retailers = new Set(SNAP.retailers.map((r) => r.id));
  const errors = [];
  const counts = {};
  for (const p of phrases) {
    const w = p.id;
    if (!/^lp\d{3}$/.test(p.id)) errors.push(`${w}: id`);
    if (p.label !== 'synthetic') errors.push(`${w}: label`);
    if (!LANGS.includes(p.lang)) errors.push(`${w}: lang`);
    if (p.category !== 'laptop') errors.push(`${w}: category`);
    const slots = p.expected.slots;
    if (!Object.keys(slots).length && !p.expected.unmapped.length) errors.push(`${w}: no slot and no unmapped item`);
    const backed = new Set();
    for (const [sid, v] of Object.entries(slots)) {
      const s = slotById.get(sid);
      if (!s) { errors.push(`${w}: unknown slot ${sid}`); continue; }
      s.factors.forEach((f) => backed.add(f));
      const opts = new Set(s.options.map((o) => o.id));
      if (s.valueShape === 'shops') { for (const id of [...(v.prefer || []), ...(v.avoid || [])]) if (!retailers.has(id)) errors.push(`${w}: shop ${id}`); }
      else if (s.valueShape === 'product') { if (typeof v !== 'string' || !v) errors.push(`${w}: model`); }
      else if (s.numeric && typeof v === 'number') { if (v < s.numeric.min || v > s.numeric.max) errors.push(`${w}: ${sid} ${v} out of range`); }
      else if (s.multi) { if (!Array.isArray(v) || !v.every((x) => opts.has(x))) errors.push(`${w}: ${sid} ${v}`); }
      else if (!opts.has(v)) errors.push(`${w}: ${sid} ${v}`);
    }
    for (const u of p.expected.unmapped) {
      if (!p.text.includes(u.quote)) errors.push(`${w}: quote not in text`);
      if (!REASONS.includes(u.reason)) errors.push(`${w}: reason`);
      if (!(u.topic in TOPIC_FACTOR)) errors.push(`${w}: topic`);
      else backed.add(TOPIC_FACTOR[u.topic]);
    }
    if (!p.factors.length) errors.push(`${w}: no factor tag`);
    for (const f of p.factors) {
      if (!factorIds.has(f)) errors.push(`${w}: unknown factor ${f}`);
      else if (!backed.has(f)) errors.push(`${w}: factor ${f} not backed`);
      counts[f] = (counts[f] || 0) + 1;
    }
  }
  assert.deepEqual(errors, []);
  // Every captured factor (one with a slot in via) has at least one phrase; every Not used topic appears.
  for (const f of config.factors.filter((x) => (x.via || []).some((v) => v.slot))) assert.ok(counts[f.id] >= 1, `no phrase for ${f.id}`);
  for (const t of Object.keys(TOPIC_FACTOR)) assert.ok(phrases.some((p) => p.expected.unmapped.some((u) => u.topic === t)), t);
  for (const l of ['ar', 'en', 'mixed']) assert.ok(phrases.some((p) => p.lang === l), l);
});
