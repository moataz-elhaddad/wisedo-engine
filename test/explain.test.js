// M9 explainer: strengths rule, traceable numbers, verdicts, timing, TCO.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { match } from '../src/layer2/index.js';
import { prepare } from '../src/layer2/snapshot.js';
import { profile, NOW, SNAPSHOT, mobileConfig } from './helpers.js';
import { PERSONAS } from './personas.js';

const r2 = (x) => Math.round(x * 100) / 100;
const prep = prepare(SNAPSHOT, 'mobile');
const product = (id) => SNAPSHOT.products.find((p) => p.id === id);
const attr = (id) => prep.scoredById.get(id);
const normOf = (a, p) => {
  const v = p.attrs[a.id];
  if (typeof v !== 'number' && typeof v !== 'boolean') return 0.5;
  const x = Math.max(0, Math.min(1, ((typeof v === 'boolean' ? +v : v) - a.min) / (a.max - a.min)));
  return a.higherIsBetter === false ? 1 - x : x;
};

test('a strength is claimed only above the pool average and in the top half of the category', () => {
  let checked = 0;
  for (const [title, answers, over] of PERSONAS) {
    const r = match(profile(answers, over), SNAPSHOT, NOW, 'rank', { maxList: 100 });
    const pool = [...r.picks, ...r.others].filter((x) => x.affordability === 'eligible').map((x) => product(x.product.id));
    for (const pick of r.picks) {
      assert.ok(pick.reasons.length <= 2, title);
      for (const reason of pick.reasons) {
        const a = attr(reason.attr);
        const avg = pool.reduce((s, p) => s + normOf(a, p), 0) / pool.length;
        const me = product(pick.product.id);
        assert.ok(normOf(a, me) > avg, `${title}: ${pick.product.id} ${reason.attr} not above pool average`);
        const known = SNAPSHOT.products.map((p) => p.attrs[a.id]).filter((v) => typeof v === 'number' || typeof v === 'boolean').map(Number).sort((x, y) => x - y);
        const n = known.length;
        const median = n % 2 ? known[(n - 1) / 2] : (known[n / 2 - 1] + known[n / 2]) / 2;
        const v = Number(me.attrs[a.id]);
        assert.ok(a.higherIsBetter === false ? v <= median : v >= median, `${title}: ${pick.product.id} ${reason.attr} not in top half`);
        assert.equal(reason.value, me.attrs[a.id]);
        assert.equal(reason.source, `product.attrs.${a.id}`);
        checked++;
      }
    }
  }
  assert.ok(checked > 10, `checked ${checked} reasons`);
});

test('every number on a pick traces to an offer, plan or product field or a formula', () => {
  for (const [title, answers, over] of PERSONAS) {
    const p = profile(answers, over);
    const r = match(p, SNAPSHOT, NOW);
    for (const pick of r.picks) {
      const q = pick.quote;
      const offer = SNAPSHOT.offers.find((o) => o.id === q.offerId);
      const retailer = SNAPSHOT.retailers.find((x) => x.id === q.retailerId);
      const prod = product(pick.product.id);
      assert.equal(q.price, offer.price_egp, title);
      assert.equal(q.trust, retailer.trust, title);
      if (q.zone) assert.deepEqual([q.deliveryFee, q.deliveryDays], [offer.delivery[q.zone].fee, offer.delivery[q.zone].days], title);
      assert.equal(q.giftValue, r2(q.gifts.reduce((s, g) => s + g.value, 0)), title);
      for (const g of q.gifts) assert.ok(offer.extras.some((e) => e.label === g.label && e.value_egp === g.value), title);
      if (q.plan) {
        const plan = SNAPSHOT.plans.find((x) => x.id === q.plan.planId);
        assert.equal(q.plan.monthlyRate, plan.monthly_rate);
        assert.equal(q.plan.adminShare, plan.admin_share);
        assert.equal(q.plan.total, r2((q.price - q.plan.down) * (1 + plan.admin_share + plan.monthly_rate * q.plan.months) + q.plan.down), title);
        assert.equal(q.plan.monthly, Math.ceil(r2((q.plan.total - q.plan.down) / q.plan.months)), title);
        assert.equal(q.paid, q.plan.total);
      } else assert.equal(q.paid, q.price);
      assert.equal(q.effCost, r2(q.paid + q.deliveryFee + q.installCost - q.giftValue), title);
      assert.equal(q.rankCost, r2(q.effCost * (1 + (9 - retailer.trust) * 0.01)), title);
      const deal = Math.max(-5, Math.min(5, (50 * (prod.ref_price_egp - q.effCost)) / prod.ref_price_egp));
      assert.equal(pick.dealBonus, r2(deal), title);
      assert.equal(pick.score, r2(pick.fit + pick.dealBonus + pick.brandBonus), title);
      assert.equal(pick.tco.total, r2(q.effCost + pick.tco.yearlyRunningCost * pick.tco.years - pick.tco.resaleValue), title);
      for (const w of pick.warnings) assert.ok(w.source, `${title}: warning ${w.code} has no source`);
      for (const k of pick.perks) assert.ok(k.source, `${title}: perk ${k.code} has no source`);
    }
  }
});

test('brand bonus adds 5 points to the liked brand', () => {
  const r = match(profile({ use: ['social'], brand: ['samsung'], pay: 'cash', budget: 20000 }), SNAPSHOT, NOW, 'rank', { maxList: 40 });
  for (const p of r.picks) assert.equal(p.brandBonus, p.product.brand === 'Samsung' ? 5 : 0);
});

test('resale value enters the 5-year TCO for phones kept 1-2 years', () => {
  const r = match(profile({ os: 'ios', keep: 'short', pay: 'cash', budget: 60000 }), SNAPSHOT, NOW);
  const p = r.picks[0];
  assert.equal(p.product.brand, 'Apple');
  assert.equal(p.tco.relevant, true);
  assert.equal(p.tco.resaleShare, 0.6);
  assert.equal(p.tco.resaleValue, Math.round(product(p.product.id).ref_price_egp * 0.6));
  const long = match(profile({ os: 'ios', keep: 'long', pay: 'cash', budget: 60000 }), SNAPSHOT, NOW);
  assert.equal(long.picks[0].tco.relevant, false);
  assert.equal(long.picks[0].tco.total, long.picks[0].quote.effCost);
});

test('verdict on the model in mind', () => {
  const base = { use: ['photo'], pay: 'cash', budget: 20000 };
  const top = match(profile(base), SNAPSHOT, NOW).picks[0].product.id;
  assert.equal(match(profile(base, { modelInMind: top }), SNAPSHOT, NOW).modelVerdict.type, 'picked');
  assert.equal(match(profile(base, { modelInMind: 'Nokia 3310' }), SNAPSHOT, NOW).modelVerdict.type, 'not_in_catalog');
  assert.equal(match(profile(base, { modelInMind: 'Pulse Pro' }), SNAPSHOT, NOW).modelVerdict.type, 'unavailable');
  const over = match(profile(base, { modelInMind: 'iPhone 16 Pro' }), SNAPSHOT, NOW).modelVerdict;
  assert.equal(over.type, 'over_budget');
  assert.equal(over.productId, 'apple-iphone-16-pro');
  assert.ok(over.extra[0].amount > 0);
  const need = match(profile({ ...base, os: 'android' }, { modelInMind: 'iphone 15' }), SNAPSHOT, NOW).modelVerdict;
  assert.equal(need.type, 'fails_need');
  const weaker = match(profile(base, { modelInMind: 'galaxy a06' }), SNAPSHOT, NOW).modelVerdict;
  assert.ok(['weaker', 'close'].includes(weaker.type));
});

test('why not the popular model', () => {
  const r = match(profile({ use: ['gaming'], gameLevel: 'heavy', pay: 'cash', budget: 25000 }), SNAPSHOT, NOW);
  assert.ok(r.whyNotPopular);
  assert.ok(product(r.whyNotPopular.productId).popular);
  assert.ok(!r.picks.some((p) => p.product.id === r.whyNotPopular.productId));
  assert.ok(r.whyNotPopular.text.en && r.whyNotPopular.text.ar);
});

test('timing: White Friday advice when not in a hurry, none when urgent', () => {
  const calm = match(profile({ use: ['social'], pay: 'cash', budget: 20000 }), SNAPSHOT, NOW);
  const wf = calm.timing.find((t) => t.code === 'white_friday');
  assert.equal(wf.date, '2026-11-27');
  assert.equal(wf.weeks, 8);
  assert.equal(wf.savingLow, Math.round(calm.picks[0].quote.effCost * 0.1));
  const urgent = match(profile({ use: ['social'], pay: 'cash', budget: 20000, urgentDays: 'today' }), SNAPSHOT, NOW);
  assert.deepEqual(urgent.timing, []);
  assert.deepEqual(match(profile({ use: ['social'], pay: 'cash', budget: 20000 }), SNAPSHOT, '2026-12-15T10:00:00Z').timing, []);
});

test('other offers per pick explain why each lost', () => {
  const r = match(profile({ use: ['photo'], pay: 'cash', budget: 50000 }, { modelInMind: 'iphone 15' }), SNAPSHOT, NOW, 'rank', { maxPicks: 5 });
  for (const p of r.picks) {
    assert.equal(p.otherOffers.filter((o) => o.status === 'chosen').length, 1);
    assert.equal(p.otherOffers[0].status, 'chosen');
    for (const o of p.otherOffers.filter((x) => x.status === 'lost')) {
      assert.ok(o.reasons.length > 0, `${p.product.id}/${o.retailerId}`);
      assert.equal(o.reasonText.length, o.reasons.length);
    }
  }
  // the iPhone 15 import at the market shop shows up as a lost offer with the right reason
  const iphone = match(profile({ os: 'ios', pay: 'cash', budget: 50000 }), SNAPSHOT, NOW, 'rank', { maxPicks: 5 });
  const ip15 = iphone.picks.find((p) => p.product.id === 'apple-iphone-15');
  assert.ok(ip15.otherOffers.find((o) => o.retailerId === 'khan').reasons.includes('import_not_accepted'));
});

test('bilingual text on reasons, warnings and nothing-fits', () => {
  const r = match(profile({ use: ['gaming'], gameLevel: 'heavy', pay: 'cash', budget: 9000 }), SNAPSHOT, NOW);
  for (const w of r.warnings) assert.ok(w.text.en && w.text.ar, w.code);
  for (const p of r.picks) for (const x of p.reasons) assert.ok(x.text.en && x.text.ar);
  const none = match(profile({ pay: 'cash', budget: 1000 }), SNAPSHOT, NOW);
  assert.ok(none.nothingFits.text.en && none.nothingFits.text.ar);
  assert.ok(mobileConfig.checks.every((c) => c.message.ar && c.message.en));
});

test('trace lists every step with counts', () => {
  const r = match(profile({ storageNeed: 's256', use: ['photo'], pay: 'finance', monthlyCap: 1500, cod: 'must' }), SNAPSHOT, NOW);
  const steps = r.trace.map((s) => s.step);
  for (const s of ['M1', 'M2', 'M4', 'M6', 'M5', 'M7', 'M8']) assert.ok(steps.includes(s), s);
  assert.equal(r.trace[0].removed[0].productId, 'hmd-pulse-pro');
});
