// M2 hard constraints, M5 affordability gate and M6 relaxer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { match } from '../src/layer2/index.js';
import { fixture, profile, NOW, SNAPSHOT } from './helpers.js';

const byId = (id) => SNAPSHOT.products.find((p) => p.id === id);

test('must-filters remove failing products (synthetic: 256 GB or more)', () => {
  const r = match(profile({ storageNeed: 's256', pay: 'cash', budget: 30000 }), SNAPSHOT, NOW, 'rank', { maxList: 40 });
  assert.equal(r.status, 'ok');
  for (const id of [...r.picks.map((p) => p.product.id), ...r.others.map((o) => o.product.id)]) assert.ok(byId(id).attrs.storage_gb >= 256, id);
  const m2 = r.trace.find((s) => s.step === 'M2');
  assert.ok(m2.removed.some((x) => x.productId === 'samsung-a16'));
});

test('derived needs as musts: heavy gaming needs 8 GB RAM', () => {
  const r = match(profile({ use: ['gaming'], gameLevel: 'heavy', pay: 'cash', budget: 12000 }), SNAPSHOT, NOW, 'rank', { maxList: 40 });
  for (const id of [...r.picks.map((p) => p.product.id), ...r.others.map((o) => o.product.id)]) assert.ok(byId(id).attrs.ram_gb >= 8, id);
  assert.ok(r.warnings.some((w) => w.code === 'check:heavy_gaming_low_budget'));
});

test('a must on an unknown attribute keeps the product with the "not listed" label', () => {
  const snap = fixture({
    products: [{ id: 'known-low', attrs: { ram_gb: 4 } }, { id: 'unknown', drop: ['ram_gb'] }, { id: 'known-ok', attrs: { ram_gb: 8 } }],
    offers: ['known-low', 'unknown', 'known-ok'].map((id) => ({ product_id: id, retailer_id: 'shopa', price_egp: id === 'unknown' ? 8000 : 9000 })),
  });
  const r = match(profile({ use: ['gaming'], gameLevel: 'heavy', pay: 'cash', budget: 20000 }), snap, NOW);
  const ids = [...r.picks.map((p) => p.product.id), ...r.others.map((o) => o.product.id)];
  assert.ok(!ids.includes('known-low'));
  assert.ok(ids.includes('unknown'));
  const u = r.picks.find((p) => p.product.id === 'unknown');
  assert.ok(u, 'unknown is picked in some role');
  assert.deepEqual(u.notListed.map((x) => [x.attr, x.status.en]), [['ram_gb', 'not listed']]);
  assert.ok(u.warnings.some((w) => w.code === 'unknown_must'));
  assert.equal(r.picks[0].product.id, 'known-ok'); // verified product takes Best fit
});

test('affordability gate: eligible <= 1, stretch <= 1.15, over beyond', () => {
  const snap = fixture({
    products: [{ id: 'at-budget' }, { id: 'stretch' }, { id: 'over' }],
    offers: [
      { product_id: 'at-budget', retailer_id: 'shopa', price_egp: 10000 },
      { product_id: 'stretch', retailer_id: 'shopa', price_egp: 11500 },
      { product_id: 'over', retailer_id: 'shopa', price_egp: 11550 },
    ],
  });
  const r = match(profile({ pay: 'cash', budget: 10000 }), snap, NOW);
  assert.deepEqual(r.counts, { inScope: 3, loaded: 3, meetNeed: 3, eligible: 1, stretch: 1, over: 1 });
  assert.equal(r.picks[0].product.id, 'at-budget');
  assert.equal(r.picks[0].quote.ratio, 1);
  // delivery fee counts toward cash out
  const fee = fixture({ products: [{ id: 'p' }], offers: [{ product_id: 'p', retailer_id: 'shopa', price_egp: 10000, delivery: { greater_cairo: { fee: 50, days: 1 } } }] });
  assert.equal(match(profile({ pay: 'cash', budget: 10000, city: 'cairo' }), fee, NOW).status, 'nothing_fits');
});

test('installment affordability uses monthly / cap', () => {
  const snap = fixture({
    products: [{ id: 'p' }],
    offers: [{ product_id: 'p', retailer_id: 'shopa', price_egp: 12000 }],
    plans: [{ id: 'z', retailer_id: 'shopa', provider: 'x', kind: 'card', months: [12] }],
  });
  assert.equal(match(profile({ pay: 'card', monthlyCap: 1000 }), snap, NOW).picks[0].affordability, 'eligible');
  const s = match(profile({ pay: 'card', monthlyCap: 900 }), snap, NOW); // 1000 / 900 = 1.11
  assert.equal(s.status, 'nothing_fits');
  assert.equal(s.counts.stretch, 1);
});

test('relaxer drops prefer-filters latest first and records what was given up', () => {
  const snap = fixture({
    products: [{ id: 'sam', brand: 'Samsung' }, { id: 'opp', brand: 'Oppo' }, { id: 'xia', brand: 'Xiaomi' }],
    offers: [
      { product_id: 'sam', retailer_id: 'shopa', price_egp: 15000 },
      { product_id: 'opp', retailer_id: 'shopa', price_egp: 9500 },
      { product_id: 'xia', retailer_id: 'shopa', price_egp: 9000 },
    ],
  });
  const A = { attr: 'brand', op: 'in', value: ['Samsung', 'Oppo'], order: 1, why: { en: 'Samsung or Oppo', ar: 'سامسونج أو أوبو' } };
  const B = { attr: 'brand', op: 'not_in', value: ['Oppo'], order: 2, why: { en: 'Not Oppo', ar: 'مش أوبو' } };
  const r = match(profile({ pay: 'cash', budget: 10000 }, { prefer: [A, B] }), snap, NOW);
  assert.equal(r.picks[0].product.id, 'opp');
  assert.deepEqual(r.gaveUp.map((g) => g.why.en), ['Not Oppo']);
  assert.ok(r.trace.some((s) => s.step === 'M6' && s.text.includes('Not Oppo')));
});

test('prefer-filters hold while something eligible is left (no relaxing)', () => {
  const r = match(profile({ compat: ['galaxy_watch'], pay: 'cash', budget: 25000 }), SNAPSHOT, NOW);
  assert.equal(r.status, 'ok');
  for (const p of r.picks) assert.equal(p.product.brand, 'Samsung');
  assert.deepEqual(r.gaveUp, []);
});

test('urgent delivery is relaxed after every prefer-filter', () => {
  const snap = fixture({
    products: [{ id: 'sam', brand: 'Samsung' }, { id: 'opp', brand: 'Oppo' }],
    offers: [
      { product_id: 'sam', retailer_id: 'shopa', price_egp: 9000, delivery: { greater_cairo: { fee: 0, days: 4 } } },
      { product_id: 'opp', retailer_id: 'shopa', price_egp: 9000, delivery: { greater_cairo: { fee: 0, days: 1 } } },
    ],
  });
  const r = match(profile({ compat: ['galaxy_watch'], urgentDays: 'today', city: 'cairo', pay: 'cash', budget: 20000 }), snap, NOW);
  assert.equal(r.picks[0].product.id, 'opp');
  assert.deepEqual(r.gaveUp.map((g) => g.kind), ['prefer']);
});

test('preferred shops: kept while affordable, relaxed when not', () => {
  const snap = fixture({
    products: [{ id: 'p' }],
    offers: [{ product_id: 'p', retailer_id: 'shopa', price_egp: 10500 }, { product_id: 'p', retailer_id: 'shopb', price_egp: 9000 }],
  });
  const keep = match(profile({ pay: 'cash', budget: 11000, shops: { prefer: ['shopa'], avoid: [] } }), snap, NOW);
  assert.equal(keep.picks[0].quote.retailerId, 'shopa');
  assert.deepEqual(keep.gaveUp, []);
  const relax = match(profile({ pay: 'cash', budget: 10000, shops: { prefer: ['shopa'], avoid: [] } }), snap, NOW);
  assert.equal(relax.picks[0].quote.retailerId, 'shopb');
  assert.deepEqual(relax.gaveUp.map((g) => g.kind), ['shops']);
});

test('nothing fits: cheapest product that meets the need and the extra money, never below the need', () => {
  const snap = fixture({
    products: [{ id: 'small', attrs: { storage_gb: 128 } }, { id: 'big', attrs: { storage_gb: 256 } }, { id: 'bigger', attrs: { storage_gb: 512 } }],
    offers: [
      { product_id: 'small', retailer_id: 'shopa', price_egp: 8000 },
      { product_id: 'big', retailer_id: 'shopa', price_egp: 15000 },
      { product_id: 'bigger', retailer_id: 'shopa', price_egp: 21000 },
    ],
  });
  const r = match(profile({ storageNeed: 's256', pay: 'cash', budget: 10000 }), snap, NOW);
  assert.equal(r.status, 'nothing_fits');
  assert.deepEqual(r.picks, []);
  assert.equal(r.nothingFits.product.id, 'big');
  assert.deepEqual(r.nothingFits.extraNeeded, [{ kind: 'budget', amount: 5000, have: 10000, need: 15000 }]);
  // synthetic: a 3,000 EGP budget for a heavy gamer
  const s = match(profile({ use: ['gaming'], gameLevel: 'heavy', pay: 'cash', budget: 3000 }), SNAPSHOT, NOW);
  assert.equal(s.status, 'nothing_fits');
  assert.ok(byId(s.nothingFits.product.id).attrs.ram_gb >= 8);
  assert.ok(s.nothingFits.extraNeeded[0].amount > 0);
});

test('no match: nothing in the catalog meets the need', () => {
  const snap = fixture({ products: [{ id: 'a' }], offers: [{ product_id: 'a', retailer_id: 'shopa', price_egp: 9000 }] });
  const r = match(profile({ compat: ['apple_watch'], pay: 'cash', budget: 50000 }), snap, NOW);
  assert.equal(r.status, 'no_match');
  assert.equal(r.nothingFits.product, null);
});
