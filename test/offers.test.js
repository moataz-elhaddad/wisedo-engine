// M4 offer resolver: plan math, plan filtering, effective cost, best offer, offer drops.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { match } from '../src/layer2/index.js';
import { prepare } from '../src/layer2/snapshot.js';
import { buyerFromProfile, choosePlan, evaluateOffer } from '../src/layer2/m4-offers.js';
import { fixture, profile, NOW, SNAPSHOT, hoursAgo } from './helpers.js';

const NOW_MS = Date.parse(NOW);

// Technical Design v4 worked example: finance buyer, 1,500 EGP a month, no down payment, phone at 17,650.
function workedExample(extraPlans = []) {
  return fixture({
    products: [{ id: 'p1', ref_price_egp: 18000 }],
    offers: [{ product_id: 'p1', retailer_id: 'shopa', price_egp: 17650 }],
    plans: [
      { id: 'valu-promo', retailer_id: 'shopa', provider: 'valu', kind: 'finance', months: [6], promo: true, valid_until: '2026-10-31' },
      { id: 'valu', retailer_id: 'shopa', provider: 'valu', kind: 'finance', months: [12, 18], monthly_rate: 0.02 },
      { id: 'contact', retailer_id: 'shopa', provider: 'contact', kind: 'finance', months: [24], monthly_rate: 0.019, admin_share: 0.02 },
      ...extraPlans,
    ],
  });
}
function planFor(snap, prof) {
  const prep = prepare(snap, 'mobile');
  const buyer = buyerFromProfile(prof, prep);
  return choosePlan(prep, buyer, snap.offers[0], NOW_MS).plan;
}

test('worked example: lowest total whose monthly fits the cap (valU 18 months)', () => {
  const plan = planFor(workedExample(), profile({ pay: 'finance', monthlyCap: 1500 }));
  assert.equal(plan.planId, 'valu');
  assert.equal(plan.months, 18);
  assert.equal(plan.total, 24004);
  assert.equal(plan.monthly, 1334);
  assert.equal(plan.fitsCap, true);
});

test('worked example: every row of the table', () => {
  const snap = workedExample();
  const rows = [[3000, 'valu-promo', 6, 17650, 2942], [1900, 'valu', 12, 21886, 1824], [1500, 'valu', 18, 24004, 1334], [1100, 'contact', 24, 26051.4, 1086]];
  for (const [cap, id, n, total, monthly] of rows) {
    const plan = planFor(snap, profile({ pay: 'finance', monthlyCap: cap }));
    assert.deepEqual([plan.planId, plan.months, plan.total, plan.monthly], [id, n, total, monthly], `cap ${cap}`);
  }
});

test('no plan fits the cap: lowest monthly is kept and flagged', () => {
  const plan = planFor(workedExample(), profile({ pay: 'finance', monthlyCap: 900 }));
  assert.equal(plan.planId, 'contact');
  assert.equal(plan.fitsCap, false);
  const r = match(profile({ pay: 'finance', monthlyCap: 1000 }), workedExample(), NOW);
  // 1086 / 1000 = 1.086 -> stretch, so nothing eligible: nothing fits, extra monthly money reported
  assert.equal(r.status, 'nothing_fits');
  assert.deepEqual(r.nothingFits.extraNeeded, [{ kind: 'monthly', amount: 86, have: 1000, need: 1086 }]);
});

test('terms above maxMonths, expired promos and stale plans are skipped', () => {
  const snap = workedExample([
    { id: 'long', retailer_id: 'shopa', provider: 'valu', kind: 'finance', months: [36], monthly_rate: 0.001 },
    { id: 'expired', retailer_id: 'shopa', provider: 'valu', kind: 'finance', months: [24], promo: true, valid_until: '2026-09-30' },
    { id: 'stale', retailer_id: 'shopa', provider: 'valu', kind: 'finance', months: [24], checked_at: hoursAgo(24 * 40) },
  ]);
  const prep = prepare(snap, 'mobile');
  const buyer = buyerFromProfile(profile({ pay: 'finance', monthlyCap: 1500 }), prep);
  const res = choosePlan(prep, buyer, snap.offers[0], NOW_MS);
  assert.equal(res.plan.planId, 'valu');
  assert.equal(res.skipped.months_above_max, 1);
  assert.equal(res.skipped.expired, 1);
  assert.equal(res.skipped.stale_plan, 1);
});

test('a promo valid until today is still valid today', () => {
  const snap = workedExample([{ id: 'today', retailer_id: 'shopa', provider: 'valu', kind: 'finance', months: [12], promo: true, valid_until: '2026-10-03' }]);
  assert.equal(planFor(snap, profile({ pay: 'finance', monthlyCap: 1500 })).planId, 'today');
});

test('minimum down payment: plan skipped unless the buyer puts enough down', () => {
  const snap = fixture({
    products: [{ id: 'p1' }],
    offers: [{ product_id: 'p1', retailer_id: 'shopc', price_egp: 10000 }],
    plans: [{ id: 'store', retailer_id: 'shopc', provider: 'store', kind: 'finance', months: [12], monthly_rate: 0.03, min_down_share: 0.3 }],
  });
  const none = match(profile({ pay: 'finance', monthlyCap: 2000 }), snap, NOW);
  assert.equal(none.status, 'no_match');
  const ok = match(profile({ pay: 'finance', monthlyCap: 2000, down: 3000 }), snap, NOW);
  assert.equal(ok.status, 'ok');
  const plan = ok.picks[0].quote.plan;
  // (10000 - 3000) * (1 + 0.03 * 12) + 3000 = 12520 ; monthly = ceil(9520 / 12) = 794
  assert.deepEqual([plan.down, plan.total, plan.monthly, plan.minDown], [3000, 12520, 794, 3000]);
});

test('down payment math (technical-design-v4 formula: admin applies to the financed amount)', () => {
  const snap = workedExample();
  const plan = planFor(snap, profile({ pay: 'finance', monthlyCap: 1500, down: 5000 }));
  // valU 12 months: (17650 - 5000) * 1.24 + 5000 = 20686 ; monthly ceil(15686 / 12) = 1308
  assert.deepEqual([plan.planId, plan.months, plan.total, plan.monthly], ['valu', 12, 20686, 1308]);
});

test('provider: plans from a provider the buyer cannot use are dropped', () => {
  const snap = workedExample();
  const contactOnly = planFor(snap, profile({ pay: 'finance', monthlyCap: 1500 }, { money: { provider: 'contact' } }));
  assert.equal(contactOnly.planId, 'contact');
  const r = match(profile({ pay: 'finance', monthlyCap: 1500 }, { money: { provider: 'nobank' } }), snap, NOW);
  assert.equal(r.status, 'no_match');
  assert.ok(r.trace.find((s) => s.step === 'M4').removed[0].offerReasons.includes('no_plan'));
});

test('provider filtering on the synthetic set: every quoted plan is from the buyer provider', () => {
  for (const provider of ['sahla', 'qest']) {
    const r = match(profile({ use: ['social'], pay: 'finance', monthlyCap: 2500 }, { money: { provider } }), SNAPSHOT, NOW);
    assert.equal(r.status, 'ok');
    for (const p of r.picks) assert.equal(p.quote.plan.provider, provider);
  }
  const card = match(profile({ use: ['social'], pay: 'card', monthlyCap: 3000 }, { money: { provider: 'horusbank' } }), SNAPSHOT, NOW);
  for (const p of card.picks) { assert.equal(p.quote.plan.provider, 'horusbank'); assert.equal(p.quote.plan.kind, 'card'); }
});

test('effective cost = paid + delivery + install - gifts; card-only cashback only for card buyers; trust premium', () => {
  const snap = fixture({
    products: [{ id: 'p1', ref_price_egp: 10000 }],
    offers: [{ product_id: 'p1', retailer_id: 'shopc', price_egp: 10000,
      delivery: { greater_cairo: { fee: 60, days: 1 } },
      extras: [{ type: 'gift', label: 'Earphones', value_egp: 400 }, { type: 'cashback', label: '5% card cashback', value_egp: 500, card_only: true }] }],
    plans: [{ id: 'card', retailer_id: 'shopc', provider: 'bank', kind: 'card', months: [6], admin_share: 0.05 }],
  });
  const cash = match(profile({ pay: 'cash', budget: 20000, city: 'cairo' }), snap, NOW).picks[0].quote;
  assert.equal(cash.effCost, 10000 + 60 - 400);
  assert.equal(cash.rankCost, Math.round((10000 + 60 - 400) * 1.04 * 100) / 100); // trust 5 -> (9 - 5)% premium
  assert.equal(cash.cashOut, 10060);
  const card = match(profile({ pay: 'card', monthlyCap: 5000, city: 'cairo' }), snap, NOW).picks[0].quote;
  assert.equal(card.paid, 10500); // 10000 * 1.05
  assert.equal(card.effCost, 10500 + 60 - 400 - 500);
});

test('rank by effective cost, never by sticker price', () => {
  const snap = fixture({
    products: [{ id: 'p1' }],
    offers: [
      { product_id: 'p1', retailer_id: 'shopa', price_egp: 10000, extras: [{ type: 'warranty', label: 'Extra year', value_egp: 800 }] },
      { product_id: 'p1', retailer_id: 'shopb', price_egp: 9500 },
    ],
  });
  const q = match(profile({ pay: 'cash', budget: 20000 }), snap, NOW).picks[0];
  assert.equal(q.quote.retailerId, 'shopa');
  const lost = q.otherOffers.find((o) => o.retailerId === 'shopb');
  assert.deepEqual(lost.reasons, ['costs_more']);
  assert.equal(lost.costMoreBy, 300);
});

test('affordable offers come first even if another shop is cheaper overall', () => {
  // shopa: 0% plan, monthly 1667 > cap 1500. shopb: 2%/month 18 months fits the cap but costs more in total.
  const snap = fixture({
    products: [{ id: 'p1' }],
    offers: [{ product_id: 'p1', retailer_id: 'shopa', price_egp: 10000 }, { product_id: 'p1', retailer_id: 'shopb', price_egp: 10000 }],
    plans: [
      { id: 'a0', retailer_id: 'shopa', provider: 'x', kind: 'finance', months: [6] },
      { id: 'b2', retailer_id: 'shopb', provider: 'x', kind: 'finance', months: [18], monthly_rate: 0.02 },
    ],
  });
  const r = match(profile({ pay: 'finance', monthlyCap: 1000 }), snap, NOW);
  assert.equal(r.picks[0].quote.retailerId, 'shopb');
  assert.equal(r.picks[0].quote.plan.monthly, 756); // 13600 / 18
});

test('stale and out-of-stock offers cannot be picked', () => {
  const snap = fixture({
    products: [{ id: 'p1' }, { id: 'p2', attrs: { camera: 10, perf: 10 } }],
    offers: [
      { product_id: 'p1', retailer_id: 'shopa', price_egp: 9000 },
      { product_id: 'p2', retailer_id: 'shopa', price_egp: 9000, in_stock: false },
      { product_id: 'p2', retailer_id: 'shopb', price_egp: 9000, checked_at: hoursAgo(25) },
    ],
  });
  const r = match(profile({ pay: 'cash', budget: 20000 }), snap, NOW);
  assert.deepEqual(r.picks.map((p) => p.product.id), ['p1']);
  assert.ok(r.trace[0].removed.some((x) => x.productId === 'p2'));

  // synthetic set: the product whose offers are all stale never appears; a known out-of-stock offer never wins
  const s = match(profile({ pay: 'cash', budget: 100000 }), SNAPSHOT, NOW, 'rank', { maxList: 50 });
  const ids = [...s.picks.map((p) => p.product.id), ...s.others.map((o) => o.product.id)];
  assert.ok(!ids.includes('hmd-pulse-pro'));
  for (const p of s.picks) {
    const offer = SNAPSHOT.offers.find((o) => o.id === p.quote.offerId);
    assert.equal(offer.in_stock, true);
    assert.ok(NOW_MS - Date.parse(offer.checked_at) <= 24 * 3600 * 1000);
  }
});

test('imports are excluded by default and allowed when accepted', () => {
  const snap = fixture({
    products: [{ id: 'p1' }],
    offers: [{ product_id: 'p1', retailer_id: 'shopa', price_egp: 10000 }, { product_id: 'p1', retailer_id: 'shopc', price_egp: 8800, official: false }],
  });
  const def = match(profile({ pay: 'cash', budget: 20000 }), snap, NOW).picks[0];
  assert.equal(def.quote.retailerId, 'shopa');
  assert.ok(def.otherOffers.find((o) => o.retailerId === 'shopc').reasons.includes('import_not_accepted'));
  const acc = match(profile({ pay: 'cash', budget: 20000, acceptImports: 'yes' }), snap, NOW);
  assert.equal(acc.picks[0].quote.retailerId, 'shopc');
  assert.ok(acc.picks[0].warnings.some((w) => w.code === 'import_offer'));
  assert.ok(acc.warnings.some((w) => w.code === 'import_offer'));
  // synthetic: no pick is ever an import by default
  const s = match(profile({ pay: 'cash', budget: 60000 }), SNAPSHOT, NOW);
  for (const p of s.picks) assert.equal(p.quote.official, true);
});

test('city: shops that do not deliver to the zone are dropped; zone sets fee and days; unknown city is assumed', () => {
  const snap = fixture({
    products: [{ id: 'p1' }],
    offers: [
      { product_id: 'p1', retailer_id: 'shopa', price_egp: 9000, delivery: { greater_cairo: { fee: 0, days: 1 } } },
      { product_id: 'p1', retailer_id: 'shopb', price_egp: 9400, delivery: { greater_cairo: { fee: 30, days: 1 }, alexandria: { fee: 50, days: 3 } } },
    ],
  });
  const alex = match(profile({ pay: 'cash', budget: 20000, city: 'alexandria' }), snap, NOW).picks[0];
  assert.equal(alex.quote.retailerId, 'shopb');
  assert.equal(alex.quote.deliveryFee, 50);
  assert.equal(alex.quote.zone, 'alexandria');
  assert.ok(alex.otherOffers.find((o) => o.retailerId === 'shopa').reasons.includes('no_delivery_zone'));
  const giza = match(profile({ pay: 'cash', budget: 20000, city: 'giza' }), snap, NOW).picks[0];
  assert.equal(giza.quote.retailerId, 'shopa');
  const unknown = match(profile({ pay: 'cash', budget: 20000 }), snap, NOW);
  assert.equal(unknown.picks[0].quote.zoneAssumed, true);
  assert.equal(unknown.picks[0].otherOffers.length, 2);
  assert.ok(unknown.warnings.some((w) => w.code === 'city_assumed'));
  // synthetic: an Alexandria buyer never gets a shop without Alexandria delivery
  const s = match(profile({ pay: 'cash', budget: 40000, city: 'alexandria' }), SNAPSHOT, NOW, 'rank', { maxList: 40 });
  for (const p of s.picks) assert.ok('alexandria' in SNAPSHOT.offers.find((o) => o.id === p.quote.offerId).delivery);
});

test('avoided shops are dropped', () => {
  const snap = fixture({
    products: [{ id: 'p1' }],
    offers: [{ product_id: 'p1', retailer_id: 'shopa', price_egp: 9000 }, { product_id: 'p1', retailer_id: 'shopb', price_egp: 9500 }],
  });
  const r = match(profile({ pay: 'cash', budget: 20000, shops: { prefer: [], avoid: ['shopa'] } }), snap, NOW).picks[0];
  assert.equal(r.quote.retailerId, 'shopb');
  assert.deepEqual(r.otherOffers.find((o) => o.retailerId === 'shopa').reasons, ['avoided_shop']);
  const s = match(profile({ pay: 'cash', budget: 40000, shops: { prefer: [], avoid: ['nile', 'pharos'] } }), SNAPSHOT, NOW);
  for (const p of s.picks) assert.ok(!['nile', 'pharos'].includes(p.quote.retailerId));
});

test('cash on delivery: must drops shops without it; prefer is relaxable', () => {
  const snap = fixture({
    products: [{ id: 'p1' }],
    offers: [{ product_id: 'p1', retailer_id: 'shopb', price_egp: 9000 }, { product_id: 'p1', retailer_id: 'shopa', price_egp: 9500 }],
  });
  const must = match(profile({ pay: 'cash', budget: 20000, cod: 'must' }), snap, NOW).picks[0];
  assert.equal(must.quote.retailerId, 'shopa');
  assert.ok(must.otherOffers.find((o) => o.retailerId === 'shopb').reasons.includes('no_cod'));
  const pref = match(profile({ pay: 'cash', budget: 20000, cod: 'prefer' }), snap, NOW);
  assert.equal(pref.picks[0].quote.retailerId, 'shopa');
  assert.deepEqual(pref.gaveUp, []);
  // prefer relaxes when the only affordable offer has no COD
  const tight = match(profile({ pay: 'cash', budget: 9200, cod: 'prefer' }), snap, NOW);
  assert.equal(tight.picks[0].quote.retailerId, 'shopb');
  assert.deepEqual(tight.gaveUp.map((g) => g.id), ['cod']);
  // must never relaxes
  const tightMust = match(profile({ pay: 'cash', budget: 9200, cod: 'must' }), snap, NOW);
  assert.equal(tightMust.status, 'nothing_fits');
});

test('urgent delivery is a preference: dropped last, only when nothing fits', () => {
  const snap = fixture({
    products: [{ id: 'p1' }],
    offers: [
      { product_id: 'p1', retailer_id: 'shopa', price_egp: 9000, delivery: { greater_cairo: { fee: 0, days: 4 } } },
      { product_id: 'p1', retailer_id: 'shopb', price_egp: 9600, delivery: { greater_cairo: { fee: 0, days: 1 } } },
    ],
  });
  const urgent = match(profile({ pay: 'cash', budget: 20000, city: 'cairo', urgentDays: 'today' }), snap, NOW).picks[0];
  assert.equal(urgent.quote.retailerId, 'shopb');
  assert.ok(urgent.otherOffers.find((o) => o.retailerId === 'shopa').reasons.includes('slow'));
  const relaxed = match(profile({ pay: 'cash', budget: 9300, city: 'cairo', urgentDays: 'today' }), snap, NOW);
  assert.equal(relaxed.picks[0].quote.retailerId, 'shopa');
  assert.deepEqual(relaxed.gaveUp.map((g) => g.kind), ['urgent']);
});

test('warnings: financing over 35% and promo ending within 14 days', () => {
  const snap = fixture({
    products: [{ id: 'p1' }],
    offers: [{ product_id: 'p1', retailer_id: 'shopa', price_egp: 10000 }],
    plans: [
      { id: 'steep', retailer_id: 'shopa', provider: 'x', kind: 'finance', months: [24], monthly_rate: 0.02 },
      { id: 'promo', retailer_id: 'shopa', provider: 'y', kind: 'card', months: [12], promo: true, valid_until: '2026-10-12' },
    ],
  });
  const fin = match(profile({ pay: 'finance', monthlyCap: 700 }), snap, NOW);
  assert.ok(fin.picks[0].warnings.some((w) => w.code === 'financing_over_35' && w.values.share === 0.48));
  assert.ok(fin.warnings.some((w) => w.code === 'financing_over_35'));
  const card = match(profile({ pay: 'card', monthlyCap: 1000 }), snap, NOW).picks[0];
  const promo = card.warnings.find((w) => w.code === 'promo_ending');
  assert.equal(promo.values.validUntil, '2026-10-12');
  assert.ok(card.perks.some((p) => p.code === 'zero_interest' && p.validUntil === '2026-10-12'));
});

test('stale gifts are not counted', () => {
  const snap = fixture({
    products: [{ id: 'p1' }],
    offers: [{ product_id: 'p1', retailer_id: 'shopa', price_egp: 9000, extras_checked_at: hoursAgo(80), extras: [{ type: 'gift', label: 'Case', value_egp: 300 }] }],
  });
  const q = match(profile({ pay: 'cash', budget: 20000 }), snap, NOW).picks[0];
  assert.equal(q.quote.effCost, 9000);
  assert.ok(q.warnings.some((w) => w.code === 'gifts_not_counted'));
});

test('evaluateOffer exposes hard and soft reasons for a single offer', () => {
  const snap = fixture({ products: [{ id: 'p1' }], offers: [{ product_id: 'p1', retailer_id: 'shopb', price_egp: 9000, official: false, in_stock: false }] });
  const prep = prepare(snap, 'mobile');
  const buyer = buyerFromProfile(profile({ pay: 'cash', cod: 'must', shops: { prefer: ['shopa'], avoid: ['shopb'] } }), prep);
  const ev = evaluateOffer(prep, buyer, snap.products[0], snap.offers[0], NOW_MS);
  assert.deepEqual(ev.hard, ['out_of_stock', 'import_not_accepted', 'avoided_shop', 'no_cod']);
  assert.equal(ev.soft.notPreferredShop, true);
  assert.equal(ev.quote, null);
});
