// Air-conditioner category (config/ac.json + data/synthetic/ac): config and snapshot validate, the generator is
// deterministic, scripted buyers get sensible top picks (capacity filter from room size and heat, inverter for bill
// worries, heating, low voltage, budget limits), running cost and installation reach the quote and TCO, simulate
// agrees with rank, and a Layer 1 session from the AC tile or from text reaches a result in 6 questions or fewer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateCategoryConfig, validateSnapshot } from '../src/contracts.js';
import { buildNeedProfile } from '../src/profile/build.js';
import { match } from '../src/layer2/index.js';
import { step, createMockLlm, recording } from '../src/layer1/index.js';
import { ROOT_DIR, NOW } from './helpers.js';
import { generate } from '../data/generate-ac.js';

const readJson = (p) => JSON.parse(readFileSync(join(ROOT_DIR, p), 'utf8'));
const acConfig = readJson('config/ac.json');

/** The AC snapshot: AC config and rows plus the shared retailers and plans. */
function acSnapshot() {
  return {
    snapshot_id: 'synthetic-ac-2026-10-03',
    tenant_id: 'wisedo',
    configs: { ac: structuredClone(acConfig) },
    products: readJson('data/synthetic/ac/products.json'),
    retailers: readJson('data/synthetic/retailers.json'),
    offers: readJson('data/synthetic/ac/offers.json'),
    plans: readJson('data/synthetic/plans.json'),
  };
}
const SNAP = acSnapshot();
const productById = new Map(SNAP.products.map((p) => [p.id, p]));
const rank = (answers) => match(buildNeedProfile(acConfig, answers), SNAP, NOW, 'rank');
const best = (r) => r.picks.find((p) => p.role === 'best_fit');
const attrsOf = (pick) => productById.get(pick.product.id).attrs;

// ---------------------------------------------------------------------------------------------
// Config, snapshot, data
// ---------------------------------------------------------------------------------------------

test('ac config: passes the publish check, id/aliases/version, 3-4 always-asked slots', () => {
  const v = validateCategoryConfig(acConfig);
  assert.deepEqual(v.errors, []);
  assert.equal(acConfig.id, 'ac');
  assert.equal(acConfig.version, '1.0.0');
  assert.deepEqual(acConfig.aliases, ['air_conditioner', 'aircon']);
  assert.ok(acConfig.slots.length >= 15 && acConfig.slots.length <= 22, `${acConfig.slots.length} slots`);
  assert.ok(acConfig.factors.length >= 30 && acConfig.factors.length <= 45, `${acConfig.factors.length} factors`);
  // room, pay, then budget or monthly cap: a typical buyer answers 3 always-questions.
  assert.deepEqual(acConfig.slots.filter((s) => s.always).map((s) => s.id), ['room', 'pay', 'budget', 'monthlyCap']);
  assert.deepEqual(acConfig.zones, readJson('config/mobile.json').zones, 'zones copied from mobile');
  assert.deepEqual(acConfig.runningCost.type, 'attr');
  assert.equal(acConfig.runningCost.attr, 'kwh_year');
  assert.equal(acConfig.resale, null);
  assert.ok(acConfig.installCost > 0);
});

test('ac config: every user-facing string has Arabic and English', () => {
  const bi = (x, where) => assert.ok(x && typeof x.ar === 'string' && x.ar && typeof x.en === 'string' && x.en, where);
  bi(acConfig.label, 'label');
  for (const a of acConfig.attributes) { bi(a.label, a.id); if (a.explain) bi(a.explain, a.id + '.explain'); }
  for (const s of acConfig.slots) {
    bi(s.label, s.id); bi(s.question, s.id + '.question');
    for (const o of s.options) {
      bi(o.label, `${s.id}.${o.id}`);
      const fx = o.effects || {};
      for (const f of [...(fx.must || []), ...(fx.prefer || [])]) bi(f.why, `${s.id}.${o.id}.why`);
    }
  }
  for (const c of acConfig.checks) bi(c.message, 'checks.' + c.id);
});

test('ac config: every slot option referenced by effects, conditions, defaults and dependsOn exists', () => {
  const slots = new Map(acConfig.slots.map((s) => [s.id, s]));
  const attrIds = new Set(acConfig.attributes.map((a) => a.id));
  const optionExists = (slot, id) => slots.has(slot) && slots.get(slot).options.some((o) => o.id === id);
  const walk = (c, where) => {
    if (!c || typeof c !== 'object') return;
    if (c.slot) {
      assert.ok(slots.has(c.slot), `${where}: slot ${c.slot}`);
      for (const id of c.in || []) assert.ok(optionExists(c.slot, id), `${where}: ${c.slot}.${id}`);
    }
    for (const k of ['all', 'any']) (c[k] || []).forEach((x) => walk(x, where));
    if (c.not) walk(c.not, where);
  };
  for (const ch of acConfig.checks) walk(ch.when, 'checks.' + ch.id);
  for (const s of acConfig.slots) {
    walk(s.askIf, s.id + '.askIf'); walk(s.alwaysIf, s.id + '.alwaysIf');
    if (s.default != null && !s.numeric) assert.ok(optionExists(s.id, s.default), `${s.id}.default`);
    for (const [dep, vals] of Object.entries(s.dependsOn || {})) for (const v of vals) assert.ok(optionExists(dep, v), `${s.id}.dependsOn ${dep}.${v}`);
    for (const o of s.options) {
      const fx = o.effects || {};
      for (const k of Object.keys(fx.weights || {})) assert.ok(attrIds.has(k), `${s.id}.${o.id} weight ${k}`);
      for (const f of [...(fx.must || []), ...(fx.prefer || []), ...(fx.bonus || [])]) assert.ok(attrIds.has(f.attr) || f.attr === 'brand' || f.attr === 'id', `${s.id}.${o.id} filter ${f.attr}`);
    }
  }
  for (const f of acConfig.factors) for (const v of f.via || []) if (v.slot) assert.ok(slots.has(v.slot), `factor ${f.id} via ${v.slot}`);
  // Brand options cover every brand in the catalog.
  const brandSlot = slots.get('brand');
  for (const b of new Set(SNAP.products.map((p) => p.brand))) {
    assert.ok(brandSlot.options.some((o) => o.effects.bonus.some((x) => x.value.includes(b))), `brand option for ${b}`);
  }
});

test('ac snapshot validates; every row is synthetic, ids are prefixed, offers use shared shops and plans', () => {
  const v = validateSnapshot(SNAP);
  assert.deepEqual(v.errors, []);
  const rows = [...SNAP.products, ...SNAP.offers];
  assert.ok(rows.every((r) => r.source === 'synthetic' && r.tenant_id === 'wisedo'));
  assert.ok(SNAP.products.every((p) => p.id.startsWith('ac-') && p.category === 'ac'));
  assert.ok(SNAP.products.length >= 28 && SNAP.products.length <= 36);
  const mobileIds = new Set(readJson('data/synthetic/products.json').map((p) => p.id));
  assert.ok(SNAP.products.every((p) => !mobileIds.has(p.id)), 'product ids are globally unique');
  const shops = new Set(SNAP.retailers.map((r) => r.id));
  const perProduct = new Map();
  for (const o of SNAP.offers) {
    assert.ok(shops.has(o.retailer_id), o.id);
    assert.ok(o.url.includes('.example.invalid'), o.id);
    perProduct.set(o.product_id, (perProduct.get(o.product_id) || 0) + 1);
  }
  for (const p of SNAP.products) assert.ok(perProduct.get(p.id) >= 3 && perProduct.get(p.id) <= 5, `${p.id}: ${perProduct.get(p.id)} offers`);
  // Three price tiers between roughly 15,000 and 62,000 EGP, every capacity present.
  const prices = SNAP.products.map((p) => p.ref_price_egp);
  assert.ok(Math.min(...prices) >= 15000 && Math.max(...prices) <= 62000);
  assert.deepEqual([...new Set(SNAP.products.map((p) => p.attrs.cooling_hp))].sort((a, b) => a - b), [1.5, 2.25, 3, 4, 5]);
  assert.deepEqual([...new Set(SNAP.products.map((p) => p.attrs.series))].sort(), ['entry', 'mid', 'premium']);
});

test('ac generator is deterministic and matches the committed files; edge cases are in place', () => {
  const a = generate();
  const b = generate();
  assert.deepEqual(a, b);
  assert.deepEqual(a.products, SNAP.products);
  assert.deepEqual(a.offers, SNAP.offers);
  assert.deepEqual(a.manifest, readJson('data/synthetic/ac/manifest.json'));
  const m = a.manifest;
  assert.equal(m.category, 'ac');
  assert.equal(m.counts.products, a.products.length);
  const off = (id) => a.offers.find((o) => o.id === id);
  assert.ok(!('warranty_months' in productById.get(m.edgeCases.missingSpec.product).attrs));
  assert.ok(a.offers.filter((o) => o.product_id === m.edgeCases.allOffersStale).every((o) => Date.parse(NOW) - Date.parse(o.checked_at) > 24 * 3600e3));
  for (const id of m.edgeCases.outOfStock) assert.equal(off(id).in_stock, false);
  for (const id of m.edgeCases.staleOffers) assert.ok(Date.parse(NOW) - Date.parse(off(id).checked_at) > 24 * 3600e3);
  for (const id of m.edgeCases.staleExtras) assert.ok(off(id).extras_checked_at);
  const khan = a.offers.filter((o) => o.retailer_id === 'khan');
  assert.ok(khan.length > 0 && khan.every((o) => o.official === false && Object.keys(o.delivery).join() === 'greater_cairo'));
  assert.ok(a.offers.some((o) => o.extras.some((e) => e.type === 'install')), 'some offers include free installation');
  assert.ok(a.offers.some((o) => !o.extras.some((e) => e.type === 'install')), 'some do not');
});

// ---------------------------------------------------------------------------------------------
// Scripted buyers
// ---------------------------------------------------------------------------------------------

test('ac persona: small room, tight cash budget -> a cheap 1.5 hp within budget', () => {
  const r = rank({ room: 'r16', pay: 'cash', budget: 18000 });
  assert.equal(r.status, 'ok');
  const b = best(r);
  assert.equal(attrsOf(b).cooling_hp, 1.5);
  assert.ok(b.quote.cashOut <= 18000);
  assert.equal(attrsOf(b).series, 'entry');
});

test('ac persona: hot 17-24 m2 room -> the capacity filter asks for 3 hp, never less', () => {
  const p = buildNeedProfile(acConfig, { room: 'r24_hot', pay: 'cash', budget: 45000 });
  assert.equal(p.derived.requiredHp, 3);
  assert.deepEqual(p.must.map((f) => [f.attr, f.op, f.value]), [['cooling_hp', '>=', 3]]);
  const r = match(p, SNAP, NOW, 'rank');
  assert.ok(r.picks.length > 0);
  for (const pick of [...r.picks, ...r.others]) assert.ok(attrsOf(pick).cooling_hp >= 3, pick.product.id);
  // The same room without heat only needs 2.25 hp: the best fit is a 2.25 hp unit.
  const cool = best(rank({ room: 'r24', pay: 'cash', budget: 45000 }));
  assert.equal(attrsOf(cool).cooling_hp, 2.25);
});

test('ac persona: big budget for a small room -> no oversized unit (prefer <= one size up)', () => {
  const r = rank({ room: 'r16', pay: 'cash', budget: 65000 });
  for (const pick of r.picks) assert.ok(attrsOf(pick).cooling_hp <= 2.25, pick.product.id);
});

test('ac persona: bedroom and a worried bill payer -> a quiet inverter; 5-year TCO counts the electricity', () => {
  const r = rank({ room: 'r16', roomType: 'bedroom', bill: 'big', pay: 'cash', budget: 35000 });
  const b = best(r);
  assert.equal(attrsOf(b).inverter, true);
  assert.ok(attrsOf(b).noise_db <= 30);
  assert.equal(b.tco.relevant, true);
  assert.equal(b.tco.yearlyRunningCost, Math.round(attrsOf(b).kwh_year * acConfig.runningCost.factor * 100) / 100);
  // TCO counts electricity: the inverter's price gap over a conventional unit shrinks over 5 years.
  const conv = best(rank({ room: 'r16', inverterNeed: 'conventional', pay: 'cash', budget: 35000 }));
  assert.equal(attrsOf(conv).inverter, false);
  assert.ok(conv.quote.effCost < b.quote.effCost);
  assert.ok(b.tco.total - conv.tco.total < b.quote.effCost - conv.quote.effCost);
  assert.equal(conv.tco.total, Math.round((conv.quote.effCost + conv.tco.yearlyRunningCost * acConfig.tcoYears) * 100) / 100);
  const tight = best(rank({ room: 'r16', bill: 'big', pay: 'cash', budget: 25000 }));
  assert.equal(attrsOf(tight).inverter, true, 'a bill worrier gets an inverter when one fits the budget');
});

test('ac persona: cool and heat -> a unit with heating', () => {
  const b = best(rank({ room: 'r16', heatNeed: 'cool_heat', pay: 'cash', budget: 25000 }));
  assert.equal(attrsOf(b).heating, true);
});

test('ac persona: 25-32 m2 on finance at 2,500 a month -> 3 hp and a monthly within the cap', () => {
  const r = rank({ room: 'r32', pay: 'finance', monthlyCap: 2500 });
  const b = best(r);
  assert.ok(attrsOf(b).cooling_hp >= 3);
  assert.ok(b.quote.plan && b.quote.plan.monthly <= 2500);
});

test('ac persona: 33-42 m2 living room -> 4 hp or more', () => {
  const b = best(rank({ room: 'r42', roomType: 'living', pay: 'cash', budget: 65000 }));
  assert.ok(attrsOf(b).cooling_hp >= 4);
});

test('ac persona: a huge hot hall -> 5 hp and the two-units advice', () => {
  const r = rank({ room: 'r55_hot', pay: 'cash', budget: 70000 });
  assert.equal(attrsOf(best(r)).cooling_hp, 5);
  assert.ok(r.warnings.some((w) => w.code === 'check:very_big_room_two_units'));
});

test('ac persona: 3 hp room on a 25,000 budget -> nothing fits, with the big-room check', () => {
  const r = rank({ room: 'r32', pay: 'cash', budget: 25000 });
  assert.equal(r.status, 'nothing_fits');
  assert.ok(r.warnings.some((w) => w.code === 'check:big_room_low_budget'));
  assert.ok(productById.get(r.nothingFits.product.id).attrs.cooling_hp >= 3);
});

test('ac persona: weak voltage at home -> a unit that works on low voltage', () => {
  const b = best(rank({ room: 'r16', pain: ['power'], pay: 'cash', budget: 25000 }));
  assert.equal(attrsOf(b).low_voltage, true);
});

test('ac persona: Upper Egypt city raises the T3 check', () => {
  const r = rank({ room: 'r16', pay: 'cash', budget: 25000, city: 'aswan' });
  assert.ok(r.warnings.some((w) => w.code === 'check:hot_city_t3'));
});

// ---------------------------------------------------------------------------------------------
// Installation, imports, simulate
// ---------------------------------------------------------------------------------------------

test('ac quotes: standard installation is charged unless the offer includes it; imports only when accepted', () => {
  const offerById = new Map(SNAP.offers.map((o) => [o.id, o]));
  const r = rank({ room: 'r16', pay: 'cash', budget: 40000 });
  // Without the shops that include installation, every quote carries the standard charge.
  const paid = rank({ room: 'r16', pay: 'cash', budget: 40000, shops: { prefer: [], avoid: ['oasis', 'pharos', 'nile'] } });
  const quotes = [...r.picks, ...paid.picks].map((x) => x.quote);
  const free = (q) => offerById.get(q.offerId).extras.some((e) => e.type === 'install');
  for (const q of quotes) {
    assert.equal(q.installCost, free(q) ? 0 : acConfig.installCost, q.offerId);
    assert.equal(q.cashOut, Math.round((q.paid + q.deliveryFee + q.installCost) * 100) / 100, q.offerId);
    assert.ok(!q.gifts.some((g) => g.type === 'install'), 'free installation is never counted again as a gift');
  }
  assert.ok(quotes.some(free), 'some chosen offers include free installation');
  assert.ok(paid.picks.length > 0 && paid.picks.every((x) => x.quote.installCost === acConfig.installCost));
  // Grey imports (khan) are dropped by default and quoted only when the buyer accepts them.
  for (const pick of r.picks) for (const o of pick.otherOffers) if (o.retailerId === 'khan') assert.equal(o.status, 'lost');
  assert.ok(quotes.every((q) => q.official));
  const imp = rank({ room: 'r16', pay: 'cash', budget: 40000, acceptImports: 'yes', city: 'cairo' });
  const khanSeen = imp.picks.some((p) => p.otherOffers.some((o) => o.retailerId === 'khan' && !o.reasons.includes('import_not_accepted')));
  assert.ok(khanSeen, 'an accepted import offer competes');
});

test('ac simulate: runs, and its top-1 agrees with rank for every persona', () => {
  const personas = [
    { room: 'r16', pay: 'cash', budget: 18000 },
    { room: 'r24_hot', pay: 'cash', budget: 45000 },
    { room: 'r16', roomType: 'bedroom', bill: 'big', pay: 'cash', budget: 35000 },
    { room: 'r32', pay: 'finance', monthlyCap: 2500 },
    { room: 'r42', pay: 'card', monthlyCap: 5000 },
    { room: 'r16', heatNeed: 'cool_heat', pay: 'cash', budget: 25000 },
  ];
  for (const a of personas) {
    const p = buildNeedProfile(acConfig, a);
    const sim = match(p, SNAP, NOW, 'simulate');
    const r = match(p, SNAP, NOW, 'rank');
    assert.equal(sim.mode, 'simulate');
    assert.ok(sim.count >= 1, JSON.stringify(a));
    assert.equal(sim.top1, best(r).product.id, JSON.stringify(a));
  }
});

// ---------------------------------------------------------------------------------------------
// Layer 1 end to end
// ---------------------------------------------------------------------------------------------

/** Answer whatever is asked from `answers` (skip otherwise) until a result; returns the asked slots. */
async function runToResult(state, ui, ctx, answers) {
  const asked = [];
  let guard = 0;
  while ((ui.screen === 'question' || ui.screen === 'clarify') && guard++ < 30) {
    if (ui.screen === 'clarify') { asked.push('?' + ui.clarify.id); ({ state, ui } = await step(state, { type: 'answer', option: 'keep' }, ctx)); continue; }
    const slot = ui.question.slot;
    asked.push(slot);
    ({ state, ui } = await step(state, slot in answers ? { type: 'answer', value: answers[slot] } : { type: 'skip' }, ctx));
  }
  return { state, ui, asked };
}

test('ac layer1: the AC tile reaches a result in 6 questions or fewer, room first', async () => {
  const buyers = [
    { answers: { room: 'r16', pay: 'cash', budget: 'b18000' }, hp: 1.5 },
    { answers: { room: 'r24_hot', roomType: 'bedroom', bill: 'big', pay: 'cash', budget: 'b40000' }, hp: 3 },
    { answers: { room: 'r32', heatNeed: 'cool_heat', pay: 'finance', monthlyCap: 'm2500', urgentDays: 'week' }, hp: 3 },
    { answers: { room: 'r16', pay: 'card', monthlyCap: 'm1500' }, hp: 1.5 },
  ];
  for (const b of buyers) {
    const ctx = { snapshot: SNAP, now: NOW };
    const start = await step(null, { type: 'start', tile: 'ac' }, ctx);
    assert.equal(start.ui.screen, 'question');
    assert.equal(start.ui.question.slot, 'room');
    const { ui, asked } = await runToResult(start.state, start.ui, ctx, b.answers);
    assert.equal(ui.screen, 'result', asked.join(','));
    assert.ok(asked.length <= 6, `${asked.length} questions: ${asked.join(',')}`);
    for (const id of ['cod', 'shops', 'inverterNeed', 'smart', 'install', 'brandAvoid', 'modelInMind']) assert.ok(!asked.includes(id), id + ' is never asked');
    assert.equal(ui.result.status, 'ok');
    const top = ui.result.picks[0];
    assert.ok(productById.get(top.product.id).attrs.cooling_hp >= b.hp, `${top.product.id} for ${JSON.stringify(b.answers)}`);
  }
});

test('ac layer1: free text with room, heat and money pre-fills chips and reaches a result', async () => {
  const text = 'عايز تكييف لأوضة 20 متر عليها شمس، كاش وميزانيتي 40 ألف';
  const slots = [
    { slot: 'room', values: ['r24_hot'], amountText: null, confidence: 0.9, evidence: 'أوضة 20 متر عليها شمس' },
    { slot: 'pay', values: ['cash'], amountText: null, confidence: 0.9, evidence: 'كاش' },
    { slot: 'budget', values: [], amountText: '40 ألف', confidence: 0.9, evidence: 'ميزانيتي 40 ألف' },
  ];
  const ctx = { snapshot: SNAP, now: NOW, llm: createMockLlm([recording(text, { slots, unmapped: [] }, { category: 'ac' })]) };
  const start = await step(null, { type: 'start', text }, ctx);
  assert.equal(start.ui.category && (start.ui.category.id || start.ui.category), 'ac');
  const { ui, asked } = await runToResult(start.state, start.ui, ctx, { roomType: 'bedroom', heatNeed: 'cool', bill: 'big', urgentDays: 'none' });
  assert.equal(ui.screen, 'result');
  assert.ok(!asked.includes('room') && !asked.includes('pay') && !asked.includes('budget'), asked.join(','));
  assert.ok(asked.length <= 3, asked.join(','));
  assert.equal(ui.profile.money.budget, 40000);
  assert.ok(productById.get(ui.result.picks[0].product.id).attrs.cooling_hp >= 3);
});

test('ac eval phrases: 40 synthetic lines whose slots, options and factors exist in the config', () => {
  const lines = readFileSync(join(ROOT_DIR, 'eval/phrases-ac.jsonl'), 'utf8').split('\n').filter((l) => l.trim());
  assert.equal(lines.length, 40);
  const phrases = lines.map((l) => JSON.parse(l));
  assert.equal(new Set(phrases.map((p) => p.id)).size, 40);
  const slots = new Map(acConfig.slots.map((s) => [s.id, s]));
  const factorIds = new Set(acConfig.factors.map((f) => f.id));
  for (const p of phrases) {
    assert.equal(p.label, 'synthetic');
    assert.equal(p.category, 'ac');
    assert.ok(['ar', 'en', 'mixed'].includes(p.lang));
    assert.ok(Object.keys(p.expected.slots).length + p.expected.unmapped.length > 0, p.id + ' holds something');
    for (const [id, v] of Object.entries(p.expected.slots)) {
      const s = slots.get(id);
      assert.ok(s, `${p.id}: slot ${id}`);
      if (s.numeric || s.valueShape) continue;
      for (const o of [].concat(v)) assert.ok(s.options.some((x) => x.id === o), `${p.id}: ${id}.${o}`);
    }
    for (const u of p.expected.unmapped) assert.ok(p.text.includes(u.quote), p.id);
    for (const f of p.factors) assert.ok(factorIds.has(f), `${p.id}: factor ${f}`);
  }
  assert.ok(new Set(phrases.map((p) => p.lang)).size === 3);
});
