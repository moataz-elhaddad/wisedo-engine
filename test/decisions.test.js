// Founder decisions of 2026-10-08 (docs/BUILD-NOTES.md, "Founder decisions"): one test per behaviour change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { step, configFor, createMockLlm, recording, stopBeforePlanning, emptyState } from '../src/layer1/index.js';
import { evalCondition } from '../src/conditions.js';
import { match } from '../src/layer2/index.js';
import { mobileConfig, SNAPSHOT, NOW, fixture, profile } from './helpers.js';

const cairoOnly = (assumedZone) => {
  const snap = fixture({
    products: [{ id: 'p1', attrs: { perf: 9, camera: 9, screen: 9 } }, { id: 'p2' }],
    offers: [
      { product_id: 'p1', retailer_id: 'shopa', price_egp: 10000, delivery: { greater_cairo: { fee: 50, days: 2 } } },
      { product_id: 'p2', retailer_id: 'shopb', price_egp: 10000 },
    ],
  });
  const cfg = structuredClone(mobileConfig);
  if (assumedZone === undefined) delete cfg.zones.assumedZone;
  snap.configs = { mobile: cfg };
  return snap;
};

test('decision 5: an unknown city is quoted as Greater Cairo and says so', () => {
  const r = match(profile({ pay: 'cash', budget: 20000 }), cairoOnly('greater_cairo'), NOW, 'rank');
  assert.equal(r.assumptions.city, 'greater_cairo');
  assert.equal(r.picks[0].product.id, 'p1', 'the Cairo-only offer is kept');
  assert.deepEqual([r.picks[0].quote.deliveryFee, r.picks[0].quote.zone], [50, 'greater_cairo']);
  const w = r.warnings.find((x) => x.code === 'city_assumed');
  assert.match(w.text.en, /Greater Cairo/);
  // A config without assumedZone keeps the old rule: nationwide, so a Cairo-only offer is quoted at its only zone.
  const old = match(profile({ pay: 'cash', budget: 20000 }), cairoOnly(), NOW, 'rank');
  assert.equal(old.assumptions.city, 'nationwide');
});

test('decision 3: "when do you need it?" is situational only while White Friday is under 4 weeks away', () => {
  for (const id of ['mobile']) {
    const slot = configFor(SNAPSHOT, id).slots.find((s) => s.id === 'urgentDays');
    assert.equal(evalCondition(slot.alwaysIf, { signals: { saleWeeks: 7.9 } }), false);
    assert.equal(evalCondition(slot.alwaysIf, { signals: { saleWeeks: 3.5 } }), true);
    // Outside the window it is not asked at all, even when the answer would change the pick.
    assert.equal(evalCondition(slot.askIf, { signals: { saleWeeks: 7.9, urgencyMatters: true } }), false);
    assert.equal(evalCondition(slot.askIf, { signals: { saleWeeks: 2, urgencyMatters: true } }), true);
  }
});

test('decision 3: urgency stated in the text is still used outside the window', async () => {
  const text = 'عايز موبايل للتصوير كاش، محتاجه بكرة';
  const llm = createMockLlm([recording(text, { slots: [
    { slot: 'use', values: ['photo'], amountText: null, confidence: 0.9, evidence: 'للتصوير' },
    { slot: 'pay', values: ['cash'], amountText: null, confidence: 0.9, evidence: 'كاش' },
    { slot: 'urgentDays', values: ['today'], amountText: null, confidence: 0.9, evidence: 'محتاجه بكرة' },
  ], unmapped: [] })]);
  const { state } = await step(null, { type: 'start', text }, { snapshot: SNAPSHOT, now: NOW, llm });
  assert.equal(state.values.urgentDays.value, 'today');
});

test('decision 4: skipping the payment way assumes cash and still asks the budget', async () => {
  const ctx = { snapshot: SNAPSHOT, now: NOW };
  let { state, ui } = await step(null, { type: 'start', tile: 'mobile' }, ctx);
  let guard = 0;
  while (ui.screen === 'question' && ui.question.slot !== 'pay' && guard++ < 10) ({ state, ui } = await step(state, { type: 'skip' }, ctx));
  assert.equal(ui.question.slot, 'pay');
  ({ state, ui } = await step(state, { type: 'skip' }, ctx));
  assert.equal(ui.screen, 'question');
  assert.equal(ui.question.slot, 'budget');
  const chip = ui.chips.find((c) => c.slot === 'pay');
  assert.deepEqual([chip.kind, chip.assumed, chip.value], ['assumed', true, 'cash']);
  // The assumption is not locked: the buyer can still change it.
  ({ state, ui } = await step(state, { type: 'edit', slot: 'pay', value: 'finance' }, ctx));
  assert.equal(state.values.pay.value, 'finance');
});

test('decision 19: clarifying questions do not count toward the question cap', () => {
  const s = emptyState();
  s.asked = [{ kind: 'clarify', id: 'x', outcome: 'answered' }, { kind: 'slot', id: 'use', outcome: 'answered' }];
  assert.equal(stopBeforePlanning(s, { maxQuestions: 2 }), null);
  s.asked.push({ kind: 'slot', id: 'pay', outcome: 'skipped' });
  assert.deepEqual(stopBeforePlanning(s, { maxQuestions: 2 }), { reason: 'cap' });
});

test("decision 10: provider options come from the tenant's plans", () => {
  const opts = configFor(SNAPSHOT, 'mobile').slots.find((s) => s.id === 'provider').options;
  const ids = opts.map((o) => o.id);
  const providers = [...new Set(SNAPSHOT.plans.map((p) => p.provider))].sort();
  assert.deepEqual([...ids].sort(), providers);
  // A config option keeps its label; a provider only the plans know is labelled with its provider_name.
  assert.equal(opts.find((o) => o.id === 'nilebank').label.en, 'Nile Bank (sample)');
  const khan = opts.find((o) => o.id === 'khanstore');
  assert.equal(khan.kind, 'finance');
  assert.equal(khan.label.en, SNAPSHOT.plans.find((p) => p.provider === 'khanstore').provider_name);
  // No plans in the snapshot: the config's own options stay.
  const bare = { ...SNAPSHOT, plans: [] };
  assert.deepEqual(configFor(bare, 'mobile').slots.find((s) => s.id === 'provider').options.map((o) => o.id), mobileConfig.slots.find((s) => s.id === 'provider').options.map((o) => o.id));
});

test('decision 18: an unclear opener makes one LLM call for the category and the slots', async () => {
  const text = 'محتاج حاجة أكلم بيها ماما وأصور بيها';
  const llm = createMockLlm([recording(text, {
    category: 'mobile', confidence: 0.85,
    slots: [{ slot: 'use', values: ['photo'], amountText: null, confidence: 0.85, evidence: 'أصور بيها' }],
    unmapped: [],
  }, { kind: 'detect' })]);
  const { state, ui } = await step(null, { type: 'start', text }, { snapshot: SNAPSHOT, now: NOW, llm });
  assert.equal(ui.category, 'mobile');
  assert.deepEqual(llm.calls.map((c) => c.kind), ['detect']);
  assert.deepEqual(state.values.use.value, ['photo']);
});
