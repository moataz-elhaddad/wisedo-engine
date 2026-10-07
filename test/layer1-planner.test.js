// Layer 1, U7 planner and U8 renderer: need before money, payment way before the amount, no question whose
// answers all give the same #1 pick and shop, city only when offers differ by zone, the brand question only on a
// near tie, tile counts from simulate, and zero-match answers hidden.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { step, planNext, emptyState, setBuyerValue, identityFor, DEFAULT_POLICY, LITERAL_POLICY, MIN_GAIN } from '../src/layer1/index.js';
import { match } from '../src/layer2/index.js';
import { buildNeedProfile } from '../src/profile/build.js';
import { mobileConfig, SNAPSHOT, NOW, fixture } from './helpers.js';

const NEED = new Set(['who', 'core', 'followup']);
const groupOf = (id) => mobileConfig.slots.find((s) => s.id === id).group;

/** Run a tile-started flow: answer from `answers`, skip the rest. Returns the asked slots with their phase. */
async function flow(snapshot, answers, extra = {}) {
  const ctx = { snapshot, now: NOW, ...extra };
  let { state, ui } = await step(null, { type: 'start', tile: 'mobile' }, ctx);
  const asked = [];
  let guard = 0;
  while ((ui.screen === 'question' || ui.screen === 'clarify') && guard++ < 30) {
    if (ui.screen === 'clarify') { ({ state, ui } = await step(state, { type: 'answer', option: 'keep' }, ctx)); continue; }
    asked.push({ slot: ui.question.slot, phase: state.pending.phase, options: ui.question.options });
    const ev = ui.question.slot in answers ? { type: 'answer', value: answers[ui.question.slot] } : { type: 'skip' };
    ({ state, ui } = await step(state, ev, ctx));
  }
  return { asked, state, ui };
}

test('layer1 U7: need questions come before money; the payment way before budget or monthly cap', async () => {
  for (const answers of [
    { who: 'me', use: ['photo'], photoType: ['night'], pay: 'cash', budget: 15000 },
    { who: 'me', use: ['gaming'], gameLevel: 'heavy', pay: 'finance', monthlyCap: 1500 },
    { who: 'parent', parentUse: 'more', pay: 'card', monthlyCap: 2000 },
  ]) {
    const { asked, ui } = await flow(SNAPSHOT, answers);
    const ids = asked.map((a) => a.slot);
    const firstMoney = ids.findIndex((id) => groupOf(id) === 'money');
    assert.equal(ids[firstMoney], 'pay', `${ids.join()}: the first money question is the payment way`);
    const amount = ids.findIndex((id) => id === 'budget' || id === 'monthlyCap');
    assert.ok(amount > firstMoney, `${ids.join()}: the amount comes after the payment way`);
    // Every always-asked need question comes before the first money question.
    for (const a of asked.filter((x) => x.phase === 'always')) assert.ok(ids.indexOf(a.slot) < firstMoney, `${a.slot} after money`);
    assert.equal(ui.screen, 'result');
  }
});

test('layer1 U7: the amount is never asked before the payment way, even when pay comes from text', async () => {
  const s = emptyState();
  s.category = 'mobile';
  const ctx = { config: mobileConfig, snapshot: SNAPSHOT, now: NOW, identity: identityFor(SNAPSHOT, 'mobile') };
  for (const [slot, value] of [['who', 'me'], ['use', ['social']]]) setBuyerValue(s, slot, value, 'answer');
  assert.equal(planNext(ctx, s).slot, 'pay');
  setBuyerValue(s, 'pay', 'finance', 'answer');
  assert.equal(planNext(ctx, s).slot, 'monthlyCap');
});

test('layer1 U7: nothing is asked when every answer gives the same #1 pick and shop', async () => {
  // One cheap phone at one shop that takes every payment way: no answer can change the pick.
  const snap = fixture({
    products: [{ id: 'p1', ref_price_egp: 3000 }],
    offers: [{ product_id: 'p1', retailer_id: 'shopa', price_egp: 3000 }],
    plans: [
      { id: 'fin', retailer_id: 'shopa', provider: 'valu', kind: 'finance', months: [12] },
      { id: 'card', retailer_id: 'shopa', provider: 'nbe', kind: 'card', months: [12] },
    ],
  });
  const { asked, ui } = await flow(snap, {});
  assert.deepEqual(asked.map((a) => a.slot), []);
  assert.equal(ui.screen, 'result');
  assert.equal(ui.stopReason, 'no_gain');
  assert.equal(ui.result.picks[0].product.id, 'p1');
  assert.equal(ui.profile.status, 'complete');
});

test('layer1 U7: every gain question asked on the personas really changes the #1 pick or shop', async () => {
  // Independent check with Layer 2: for each gain-phase question, simulate each visible answer on the state at
  // that moment; the #1 pick@shop must differ between at least two answers.
  const answers = { who: 'me', use: ['photo', 'social'], photoType: ['night'], pay: 'finance', monthlyCap: 1500 };
  const ctx = { snapshot: SNAPSHOT, now: NOW };
  let { state, ui } = await step(null, { type: 'start', tile: 'mobile' }, ctx);
  let checked = 0, guard = 0;
  while (ui.screen === 'question' && guard++ < 20) {
    const q = ui.question;
    if (!['always', 'money', 'tiebreak'].includes(state.pending.phase)) {
      const base = Object.values(state.values).length ? Object.entries(state.values).sort((a, b) => a[1].seq - b[1].seq).map(([slot, v]) => ({ slot, value: v.value, source: 'answer' })) : [];
      const tops = new Set(q.options.map((o) => {
        const value = q.multi ? [o.id] : o.id;
        const r = match(buildNeedProfile(mobileConfig, [...base, { slot: q.slot, value, source: 'answer' }]), SNAPSHOT, NOW, 'simulate');
        return `${r.top1}@${r.top1Shop}`;
      }));
      assert.ok(tops.size >= 2, `${q.slot}: every answer gives the same #1 pick and shop`);
      checked++;
    }
    ({ state, ui } = await step(state, q.slot in answers ? { type: 'answer', value: answers[q.slot] } : { type: 'skip' }, ctx));
  }
  assert.ok(checked >= 1, 'at least one gain question was checked');
});

test('layer1 city: assumed nationwide when offers do not differ by zone; asked when they do', async () => {
  const products = [{ id: 'p1', ref_price_egp: 10000, attrs: { perf: 9, camera: 9, screen: 9 } }, { id: 'p2', ref_price_egp: 10000 }];
  const same = fixture({ products, offers: [{ product_id: 'p1', retailer_id: 'shopa', price_egp: 10000 }, { product_id: 'p2', retailer_id: 'shopb', price_egp: 10000 }] });
  const a = await flow(same, { pay: 'cash', budget: 25000 });
  assert.ok(!a.asked.some((x) => x.slot === 'city'), a.asked.map((x) => x.slot).join());
  const city = a.ui.chips.find((c) => c.slot === 'city');
  assert.deepEqual([city.assumed, city.valueLabel.en], [true, 'Nationwide (assumed)']);
  assert.equal(a.ui.profile.logistics.city ?? null, null);

  // p1 delivers to Greater Cairo only: the city now changes the #1 pick.
  const zoned = fixture({ products, offers: [
    { product_id: 'p1', retailer_id: 'shopa', price_egp: 10000, delivery: { greater_cairo: { fee: 0, days: 2 } } },
    { product_id: 'p2', retailer_id: 'shopb', price_egp: 10000 },
  ] });
  const b = await flow(zoned, { pay: 'cash', budget: 25000, city: 'alexandria' });
  const q = b.asked.find((x) => x.slot === 'city');
  assert.ok(q, b.asked.map((x) => x.slot).join());
  // Tiles carry the zone's count: Cairo-area cities see both phones, the rest see one.
  assert.equal(q.options.find((o) => o.id === 'cairo').matches, 2);
  assert.equal(q.options.find((o) => o.id === 'alexandria').matches, 1);
  assert.equal(b.ui.result.picks[0].product.id, 'p2');
});

test('layer1 U7: the brand question is asked only on a near tie, with just the two brands', async () => {
  const mk = (camera) => fixture({
    products: [{ id: 'p1', brand: 'Samsung', attrs: { camera: 8 } }, { id: 'p2', brand: 'Xiaomi', attrs: { camera } }],
    offers: [{ product_id: 'p1', retailer_id: 'shopa', price_egp: 10000 }, { product_id: 'p2', retailer_id: 'shopa', price_egp: 10000 }],
  });
  const near = await flow(mk(8), { pay: 'cash', budget: 25000 });
  const q = near.asked.find((x) => x.slot === 'brand');
  assert.ok(q, `near tie: ${near.asked.map((x) => x.slot).join()}`);
  assert.equal(q.phase, 'tiebreak');
  assert.deepEqual(q.options.map((o) => o.id).sort(), ['samsung', 'xiaomi']);
  const far = await flow(mk(1), { pay: 'cash', budget: 25000 });
  assert.ok(!far.asked.some((x) => x.slot === 'brand'), `clear winner: ${far.asked.map((x) => x.slot).join()}`);
});

test('layer1 U8: one question at a time, bilingual, tile counts from simulate, zero-match answers hidden', async () => {
  const ctx = { snapshot: SNAPSHOT, now: NOW };
  let { state, ui } = await step(null, { type: 'start', tile: 'mobile' }, ctx);
  assert.equal(ui.screen, 'question');
  assert.ok(ui.question.label.en && ui.question.label.ar);
  assert.ok(ui.question.options.every((o) => o.label.en && o.label.ar && Number.isInteger(o.matches)));
  assert.deepEqual(ui.question.step.index, 1);
  assert.equal(typeof ui.live.matching, 'number');
  // Storage 1 TB matches no synthetic phone at a modest budget: that tile is hidden.
  const s = emptyState();
  s.category = 'mobile';
  for (const [slot, value] of [['who', 'me'], ['use', ['photo']], ['photoType', ['night']], ['pay', 'cash'], ['budget', 8000], ['urgentDays', 'none']]) setBuyerValue(s, slot, value, 'answer');
  const plan = planNext({ config: mobileConfig, snapshot: SNAPSHOT, now: NOW, identity: identityFor(SNAPSHOT, 'mobile'), policy: LITERAL_POLICY }, s);
  if (plan.kind === 'question') {
    const ev = plan.evaluation;
    const hidden = ev.options.filter((o) => !o.visible);
    assert.ok(hidden.every((o) => o.matches === 0));
  }
  // Money answers are never hidden, so a too-low budget can still be chosen and answered honestly.
  const pay = await flow(SNAPSHOT, { who: 'me', use: ['social'] });
  const budgetQ = pay.asked.find((a) => a.slot === 'budget');
  if (budgetQ) assert.equal(budgetQ.options.length, mobileConfig.slots.find((x) => x.id === 'budget').options.length);
});

test('layer1 U7: policy constants are documented values', () => {
  assert.equal(MIN_GAIN, 1);
  assert.deepEqual({ ...LITERAL_POLICY }, { minGain: 1, materialPoints: 0 });
  assert.deepEqual({ ...DEFAULT_POLICY }, { minGain: 1.3, materialPoints: 3 });
});
