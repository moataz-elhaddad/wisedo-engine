// Fridge category: config + snapshot validation, deterministic data, scripted personas (Layer 2 rank and
// simulate), an end-to-end Layer 1 session, option references, and the fridge eval phrases.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateCategoryConfig, validateSnapshot } from '../src/contracts.js';
import { buildNeedProfile } from '../src/profile/build.js';
import { match } from '../src/layer2/index.js';
import { step, detectByRules } from '../src/layer1/index.js';
import { generate } from '../data/generate-fridge.js';
import { ROOT_DIR, NOW } from './helpers.js';

const readJson = (p) => JSON.parse(readFileSync(join(ROOT_DIR, p), 'utf8'));
const config = readJson('config/fridge.json');
const products = readJson('data/synthetic/fridge/products.json');
const offers = readJson('data/synthetic/fridge/offers.json');
const manifest = readJson('data/synthetic/fridge/manifest.json');

const SNAPSHOT = {
  snapshot_id: manifest.snapshot_id,
  tenant_id: 'wisedo',
  configs: { fridge: config },
  products,
  retailers: readJson('data/synthetic/retailers.json'),
  offers,
  plans: readJson('data/synthetic/plans.json'),
};
const byId = new Map(products.map((p) => [p.id, p]));
const prof = (answers) => buildNeedProfile(config, answers);
const rank = (answers) => match(prof(answers), SNAPSHOT, NOW, 'rank');
const top = (r) => byId.get(r.picks[0].product.id);

test('fridge config passes the publish check and matches the expected shape', () => {
  const v = validateCategoryConfig(config);
  assert.deepEqual(v.errors, []);
  assert.equal(config.id, 'fridge');
  assert.equal(config.version, '1.0.0');
  assert.deepEqual(config.aliases, ['refrigerator']);
  assert.equal(config.installCost, 0);
  assert.equal(config.resale, null);
  assert.deepEqual([config.runningCost.type, config.runningCost.attr], ['attr', 'energy_kwh_year']);
  assert.ok(config.slots.length >= 15 && config.slots.length <= 22, `slots: ${config.slots.length}`);
  assert.ok(config.factors.length >= 30 && config.factors.length <= 50, `factors: ${config.factors.length}`);
  for (const s of config.slots) {
    assert.ok(s.question.ar && s.question.en && s.label.ar && s.label.en, s.id);
    for (const o of s.options) assert.ok(o.label.ar && o.label.en, `${s.id}.${o.id}`);
  }
  // Zones are the shared ones (copied from mobile).
  assert.deepEqual(config.zones, readJson('config/mobile.json').zones);
});

test('fridge snapshot validates; every row is synthetic and references shared retailers and plans', () => {
  const v = validateSnapshot(SNAPSHOT);
  assert.deepEqual(v.errors, []);
  assert.ok(products.length >= 28 && products.length <= 36);
  assert.ok([...products, ...offers].every((r) => r.source === 'synthetic' && r.tenant_id === 'wisedo'));
  assert.ok(products.every((p) => p.id.startsWith('fridge-') && p.category === 'fridge'));
  const planIds = new Set(SNAPSHOT.plans.map((p) => p.id));
  for (const o of offers) for (const pl of o.plan_ids) assert.ok(planIds.has(pl), `${o.id}: ${pl}`);
  // Product ids do not collide with the mobile catalog.
  const mobileIds = new Set(readJson('data/synthetic/products.json').map((p) => p.id));
  assert.ok(products.every((p) => !mobileIds.has(p.id)));
  // Price range and tiers.
  const prices = products.map((p) => p.ref_price_egp);
  assert.ok(Math.min(...prices) >= 12000 && Math.max(...prices) <= 110000);
  assert.ok(prices.some((x) => x < 25000) && prices.some((x) => x >= 25000 && x < 50000) && prices.some((x) => x >= 50000));
  // Every offer of a product with 3-5 offers (except the import-only edge case).
  const per = new Map();
  for (const o of offers) per.set(o.product_id, (per.get(o.product_id) || 0) + 1);
  for (const p of products) if (p.id !== 'fridge-bosch-kad93') assert.ok(per.get(p.id) >= 3 && per.get(p.id) <= 5, p.id);
});

test('fridge data generator is deterministic and equals the committed files', () => {
  const a = generate();
  const b = generate();
  assert.deepEqual(a, b);
  assert.deepEqual(JSON.parse(JSON.stringify(a.products)), products);
  assert.deepEqual(JSON.parse(JSON.stringify(a.offers)), offers);
  assert.deepEqual(JSON.parse(JSON.stringify(a.manifest)), manifest);
});

test('fridge edge cases from the manifest are present', () => {
  const e = manifest.edgeCases;
  assert.equal(byId.get(e.missingSpec.product).attrs[e.missingSpec.attr], undefined);
  assert.ok(offers.filter((o) => o.product_id === e.allOffersStale).every((o) => Date.parse(NOW) - Date.parse(o.checked_at) > 24 * 3600e3));
  for (const id of e.outOfStock) assert.equal(offers.find((o) => o.id === id).in_stock, false);
  for (const id of e.staleOffers) assert.ok(Date.parse(NOW) - Date.parse(offers.find((o) => o.id === id).checked_at) > 24 * 3600e3);
  for (const id of e.staleExtras) assert.ok(offers.find((o) => o.id === id).extras_checked_at);
  assert.ok(offers.filter((o) => o.retailer_id === 'khan').every((o) => o.official === false));
  assert.ok(offers.filter((o) => o.retailer_id !== 'khan').every((o) => o.official === true));
  // The all-stale product is never ranked.
  const r = match(prof({}), SNAPSHOT, NOW, 'rank', { maxList: 50 });
  const listed = [...r.picks.map((p) => p.product.id), ...r.others.map((o) => o.product.id)];
  assert.ok(!listed.includes(e.allOffersStale));
});

test('every slot option id referenced by effects, defaults, dependsOn and checks exists', () => {
  const slotById = new Map(config.slots.map((s) => [s.id, s]));
  const attrIds = new Set(config.attributes.map((a) => a.id));
  for (const s of config.slots) {
    const ids = new Set(s.options.map((o) => o.id));
    if (s.default !== undefined && !s.numeric) assert.ok(ids.has(s.default), `${s.id}.default`);
    for (const [dep, vals] of Object.entries(s.dependsOn || {})) for (const v of vals) assert.ok(slotById.get(dep).options.some((o) => o.id === v), `${s.id}.dependsOn ${dep}:${v}`);
    for (const o of s.options) {
      const e = o.effects || {};
      for (const k of Object.keys(e.weights || {})) assert.ok(attrIds.has(k), `${s.id}.${o.id} weight ${k}`);
      for (const f of [...(e.must || []), ...(e.prefer || []), ...(e.bonus || [])]) assert.ok(attrIds.has(f.attr) || f.attr === 'brand' || f.attr === 'id', `${s.id}.${o.id} ${f.attr}`);
      // A category filter value must be one of the attribute's values.
      for (const f of [...(e.must || []), ...(e.prefer || [])]) {
        const a = config.attributes.find((x) => x.id === f.attr);
        if (a && a.type === 'category') for (const v of f.value) assert.ok(a.values.includes(v), `${s.id}.${o.id} ${v}`);
      }
      // Brand bonus / avoid values are real catalog brands.
      for (const f of [...(e.prefer || []), ...(e.bonus || [])]) if (f.attr === 'brand') for (const b of f.value) assert.ok(products.some((p) => p.brand === b), b);
    }
  }
  const walk = (c) => {
    if (!c || typeof c !== 'object') return;
    if (c.slot) { assert.ok(slotById.has(c.slot), c.slot); for (const v of c.in || []) assert.ok(slotById.get(c.slot).options.some((o) => o.id === v), `${c.slot}:${v}`); }
    for (const k of ['all', 'any']) (c[k] || []).forEach(walk);
    if (c.not) walk(c.not);
  };
  for (const ch of config.checks) walk(ch.when);
  for (const s of config.slots) { walk(s.askIf); walk(s.alwaysIf); }
  // Every brand in the catalog can be liked and avoided.
  const brands = new Set(products.map((p) => p.brand));
  for (const b of brands) {
    assert.ok(slotById.get('brand').options.some((o) => o.effects.bonus[0].value.includes(b)), b);
    assert.ok(slotById.get('brandAvoid').options.some((o) => o.effects.prefer[0].value.includes(b)), b);
  }
});

// ---- scripted personas ----

test('persona: a couple on 15,000 cash gets a small, cheap fridge', () => {
  const r = rank({ household: 'h2', pay: 'cash', budget: 15000 });
  assert.equal(r.status, 'ok');
  assert.ok(r.picks[0].quote.cashOut <= 15000);
  assert.ok(top(r).attrs.capacity_l <= 300);
});

test('persona: a family of four on 30,000 cash gets 330 L or more within budget', () => {
  const r = rank({ household: 'h4', pay: 'cash', budget: 30000 });
  assert.equal(r.status, 'ok');
  assert.ok(r.picks[0].quote.cashOut <= 30000);
  for (const p of r.picks) assert.ok(byId.get(p.product.id).attrs.capacity_l >= 330, p.product.id);
});

test('persona: a family of six that stocks up, 60,000 cash, gets a bigger fridge than a family of four', () => {
  const big = rank({ household: 'h6', use: ['bulk'], pay: 'cash', budget: 60000 });
  const four = rank({ household: 'h4', pay: 'cash', budget: 30000 });
  assert.equal(big.status, 'ok');
  assert.ok(top(big).attrs.capacity_l >= 430);
  assert.ok(top(big).attrs.capacity_l > top(four).attrs.capacity_l);
  assert.ok(big.picks[0].quote.cashOut <= 60000);
});

test('persona: a buyer worried about bills gets an inverter with low electricity use, and TCO counts electricity', () => {
  const r = rank({ household: 'h4', power: 'bills', pay: 'cash', budget: 35000 });
  const plain = rank({ household: 'h4', pay: 'cash', budget: 35000 });
  const t = top(r);
  assert.equal(t.attrs.inverter, true);
  assert.ok(t.attrs.energy_kwh_year <= top(plain).attrs.energy_kwh_year);
  assert.ok(t.attrs.energy_kwh_year <= 300);
  const tco = r.picks[0].tco;
  assert.equal(tco.yearlyRunningCost, Math.round(t.attrs.energy_kwh_year * config.runningCost.factor * 100) / 100);
  assert.equal(tco.relevant, true);
  assert.equal(tco.total, Math.round((r.picks[0].quote.effCost + tco.yearlyRunningCost * config.tcoYears) * 100) / 100);
});

test('persona: side-by-side on 90,000 cash gets only side-by-side fridges', () => {
  const r = rank({ household: 'h4', layout: 'side_by_side', pay: 'cash', budget: 90000 });
  assert.equal(r.status, 'ok');
  for (const p of r.picks) assert.equal(byId.get(p.product.id).attrs.layout, 'side_by_side');
});

test('persona: a 60 cm kitchen gets a fridge 60 cm wide or less', () => {
  const r = rank({ household: 'h4', space: 'w60', pay: 'cash', budget: 30000 });
  assert.equal(r.status, 'ok');
  for (const p of r.picks) assert.ok(byId.get(p.product.id).attrs.width_cm <= 60, p.product.id);
  // The narrow-space + side-by-side check fires.
  const c = rank({ household: 'h4', space: 'w60', layout: 'side_by_side', pay: 'cash', budget: 90000 });
  assert.ok(c.warnings.some((w) => w.code === 'check:wide_layout_narrow_space'));
});

test('persona: water dispenser required, 50,000 cash, gets a dispenser', () => {
  const r = rank({ household: 'h4', dispenser: 'must', pay: 'cash', budget: 50000 });
  assert.equal(r.status, 'ok');
  for (const p of r.picks) assert.equal(byId.get(p.product.id).attrs.dispenser, true);
});

test('persona: finance at 1,500 a month gets a plan within the cap', () => {
  const r = rank({ household: 'h4', pay: 'finance', monthlyCap: 1500 });
  assert.equal(r.status, 'ok');
  const q = r.picks[0].quote;
  assert.ok(q.plan && q.plan.kind === 'finance');
  assert.ok(q.plan.monthly <= 1500);
  assert.ok(q.plan.months <= config.maxMonths);
});

test('persona: seven people on 15,000 is nothing-fits, with the money a big enough fridge needs', () => {
  const r = rank({ household: 'h7', pay: 'cash', budget: 15000 });
  assert.equal(r.status, 'nothing_fits');
  assert.equal(r.picks.length, 0);
  assert.ok(byId.get(r.nothingFits.product.id).attrs.capacity_l >= 520);
  assert.ok(r.nothingFits.extraNeeded.some((x) => x.kind === 'budget' && x.amount > 0));
  assert.ok(r.warnings.some((w) => w.code === 'check:big_family_low_budget'));
});

test('persona: imports only when accepted; the import-only fridge needs it', () => {
  const ids = (r) => [...r.picks.map((p) => p.product.id), ...r.others.map((o) => o.product.id)];
  const base = { household: 'h6', layout: 'side_by_side', pay: 'cash', budget: 110000, city: 'cairo' };
  const no = match(prof(base), SNAPSHOT, NOW, 'rank', { maxList: 50 });
  assert.ok(!ids(no).includes('fridge-bosch-kad93'));
  assert.ok(no.picks.every((p) => p.quote.official));
  const yes = match(prof({ ...base, acceptImports: 'yes' }), SNAPSHOT, NOW, 'rank', { maxList: 50 });
  assert.ok(ids(yes).includes('fridge-bosch-kad93'));
});

test('simulate agrees with rank on top-1 for every persona, and an empty profile ranks', () => {
  const personas = [
    { household: 'h2', pay: 'cash', budget: 15000 },
    { household: 'h4', pay: 'cash', budget: 30000 },
    { household: 'h6', use: ['bulk'], pay: 'cash', budget: 60000 },
    { household: 'h4', power: 'bills', pay: 'cash', budget: 35000 },
    { household: 'h4', placement: 'open', pay: 'cash', budget: 45000 },
    { household: 'h4', pay: 'card', monthlyCap: 2500, provider: 'nilebank' },
    { household: 'h7', pay: 'cash', budget: 15000 },
    {},
  ];
  for (const a of personas) {
    const p = prof(a);
    const r = match(p, SNAPSHOT, NOW, 'rank');
    const s = match(p, SNAPSHOT, NOW, 'simulate');
    assert.equal(s.mode, 'simulate');
    assert.equal(s.top1, r.picks.length ? r.picks[0].product.id : null, JSON.stringify(a));
  }
});

// ---- Layer 1 ----

test('layer1: fridge text is detected as the fridge category', () => {
  assert.equal(detectByRules('عايز تلاجة نوفروست لأسرة 4 أفراد').category, 'fridge');
  assert.equal(detectByRules('looking for a refrigerator for a family of five').category, 'fridge');
});

test('layer1: a fridge session from the tile reaches a result in at most 6 questions', async () => {
  const ctx = { snapshot: SNAPSHOT, now: NOW };
  const flows = [
    { household: 'h4', pay: 'cash', budget: 30000 },
    { household: 'h6', pay: 'finance', monthlyCap: 1500 },
    { household: 'h2', pay: 'cash', budget: 15000 },
  ];
  const manual = config.slots.filter((s) => s.manual).map((s) => s.id);
  for (const answers of flows) {
    let { state, ui } = await step(null, { type: 'start', tile: 'fridge' }, ctx);
    assert.equal(ui.category, 'fridge');
    const log = [];
    let guard = 0;
    while ((ui.screen === 'question' || ui.screen === 'clarify') && guard++ < 30) {
      if (ui.screen === 'clarify') { ({ state, ui } = await step(state, { type: 'answer', option: 'keep' }, ctx)); continue; }
      log.push(ui.question.slot);
      const ev = ui.question.slot in answers ? { type: 'answer', value: answers[ui.question.slot] } : { type: 'skip' };
      ({ state, ui } = await step(state, ev, ctx));
    }
    assert.equal(ui.screen, 'result', JSON.stringify(answers));
    assert.ok(log.length <= 6, `${log.length} questions: ${log.join(',')}`);
    assert.equal(log[0], 'household');
    for (const id of manual) assert.ok(!log.includes(id), `${id} asked`);
    assert.ok(ui.result.picks.length > 0);
    assert.equal(ui.result.category, 'fridge');
  }
});

// ---- eval phrases ----

test('fridge eval phrases: 40 synthetic lines whose slots, options and factors exist in the config', () => {
  const lines = readFileSync(join(ROOT_DIR, 'eval/phrases-fridge.jsonl'), 'utf8').split('\n').filter((l) => l.trim());
  assert.equal(lines.length, 40);
  const phrases = lines.map((l) => JSON.parse(l));
  assert.equal(new Set(phrases.map((p) => p.id)).size, 40);
  const slotById = new Map(config.slots.map((s) => [s.id, s]));
  const factorIds = new Set(config.factors.map((f) => f.id));
  const retailers = new Set(SNAPSHOT.retailers.map((r) => r.id));
  for (const p of phrases) {
    assert.equal(p.label, 'synthetic', p.id);
    assert.equal(p.category, 'fridge', p.id);
    assert.ok(['ar', 'en', 'mixed'].includes(p.lang), p.id);
    assert.ok(p.factors.length > 0, p.id);
    for (const f of p.factors) assert.ok(factorIds.has(f), `${p.id}: factor ${f}`);
    const slots = p.expected.slots;
    assert.ok(Object.keys(slots).length + p.expected.unmapped.length > 0, p.id);
    for (const [sid, v] of Object.entries(slots)) {
      const s = slotById.get(sid);
      assert.ok(s, `${p.id}: slot ${sid}`);
      if (sid === 'shops') { for (const r of [...(v.prefer || []), ...(v.avoid || [])]) assert.ok(retailers.has(r), `${p.id}: ${r}`); continue; }
      if (sid === 'modelInMind') { assert.equal(typeof v, 'string'); continue; }
      if (s.numeric && typeof v === 'number') continue;
      for (const x of Array.isArray(v) ? v : [v]) assert.ok(s.options.some((o) => o.id === x), `${p.id}: ${sid}=${x}`);
      if (s.multi) assert.ok(Array.isArray(v), `${p.id}: ${sid} multi`);
      // Each slot's factors are tagged on the phrase.
      assert.ok(s.factors.some((f) => p.factors.includes(f)), `${p.id}: ${sid} factor tag`);
    }
    for (const u of p.expected.unmapped) assert.ok(p.text.includes(u.quote), `${p.id}: unmapped quote`);
  }
  // The set is detected as fridge by the rules (category keyword in every phrase).
  const detected = phrases.filter((p) => detectByRules(p.text).category === 'fridge').length;
  assert.ok(detected >= 36, `detected ${detected}/40`);
});
