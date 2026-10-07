// M8 roles, maxPicks / maxList, and the missing-data rule for Best fit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { match } from '../src/layer2/index.js';
import { prepare } from '../src/layer2/snapshot.js';
import { effectiveWeights, fitScore } from '../src/layer2/m3-fit.js';
import { fixture, profile, NOW, SNAPSHOT } from './helpers.js';

// top: highest fit. cheap: brand B, much cheaper (best value). val: brand A, cheaper (cheaper role).
// prem: stretch, 3+ points above top (premium). alt: brand C (alternative).
const ROLES_SNAP = fixture({
  products: [
    { id: 'top', brand: 'A', ref_price_egp: 19000, attrs: { perf: 9, camera: 9 } },
    { id: 'val', brand: 'A', ref_price_egp: 12000, attrs: { perf: 8, camera: 8 } },
    { id: 'prem', brand: 'A', ref_price_egp: 22000, attrs: { perf: 10, camera: 10, screen: 10, battery_mah: 7000 } },
    { id: 'cheap', brand: 'B', ref_price_egp: 9000, attrs: { perf: 7.5, camera: 7.5 } },
    { id: 'alt', brand: 'C', ref_price_egp: 15000, attrs: { perf: 6, camera: 6 } },
  ],
  offers: [
    { product_id: 'top', retailer_id: 'shopa', price_egp: 19000 },
    { product_id: 'val', retailer_id: 'shopa', price_egp: 12000 },
    { product_id: 'prem', retailer_id: 'shopa', price_egp: 22000 },
    { product_id: 'cheap', retailer_id: 'shopa', price_egp: 9000 },
    { product_id: 'alt', retailer_id: 'shopa', price_egp: 15000 },
  ],
});
const BUYER = profile({ pay: 'cash', budget: 20000 });
const roles = (r) => r.picks.map((p) => `${p.role}:${p.product.id}`);

test('roles: best fit, best value, then premium (default maxPicks 3)', () => {
  const r = match(BUYER, ROLES_SNAP, NOW);
  assert.deepEqual(roles(r), ['best_fit:top', 'best_value:cheap', 'premium:prem']);
  assert.equal(r.picks[2].affordability, 'stretch');
  assert.ok(r.picks[2].score >= r.picks[0].score + 3);
});

test('roles fill in order with maxPicks; no role and no product twice', () => {
  assert.deepEqual(roles(match(BUYER, ROLES_SNAP, NOW, 'rank', { maxPicks: 5 })), ['best_fit:top', 'best_value:cheap', 'premium:prem', 'cheaper:val', 'alternative:alt']);
  assert.deepEqual(roles(match(BUYER, ROLES_SNAP, NOW, 'rank', { maxPicks: 1 })), ['best_fit:top']);
  assert.deepEqual(roles(match(BUYER, ROLES_SNAP, NOW, 'rank', { maxPicks: 2 })), ['best_fit:top', 'best_value:cheap']);
});

test('cheaper when there is no premium; alternative when neither', () => {
  const r = match(profile({ pay: 'cash', budget: 19000 }), ROLES_SNAP, NOW); // prem is now over 1.15
  assert.deepEqual(roles(r), ['best_fit:top', 'best_value:cheap', 'cheaper:val']);
  const twoBrands = fixture({
    products: [{ id: 'x1', brand: 'X', attrs: { perf: 9 } }, { id: 'y1', brand: 'Y', attrs: { perf: 8.9 } }],
    offers: [{ product_id: 'x1', retailer_id: 'shopa', price_egp: 10000 }, { product_id: 'y1', retailer_id: 'shopa', price_egp: 10000 }],
  });
  assert.deepEqual(roles(match(BUYER, twoBrands, NOW)), ['best_fit:x1', 'alternative:y1']);
});

test('fewer than 3 picks when fewer products fit', () => {
  const one = fixture({ products: [{ id: 'only' }], offers: [{ product_id: 'only', retailer_id: 'shopa', price_egp: 9000 }] });
  const r = match(BUYER, one, NOW);
  assert.deepEqual(roles(r), ['best_fit:only']);
  assert.deepEqual(r.others, []);
});

test('maxList bounds the whole ranked list (picks + others)', () => {
  const p = profile({ use: ['social'], pay: 'cash', budget: 40000 });
  const def = match(p, SNAPSHOT, NOW);
  assert.equal(def.picks.length, 3);
  assert.equal(def.picks.length + def.others.length, 10);
  const five = match(p, SNAPSHOT, NOW, 'rank', { maxList: 5 });
  assert.equal(five.others.length, 2);
  assert.deepEqual(five.others.map((o) => o.rank), [4, 5]);
  assert.equal(match(p, SNAPSHOT, NOW, 'rank', { maxList: 0 }).others.length, 0);
  const pickIds = new Set(def.picks.map((x) => x.product.id));
  for (const o of def.others) assert.ok(!pickIds.has(o.product.id));
  // others are in score order within each affordability band
  const elig = def.others.filter((o) => o.affordability === 'eligible').map((o) => o.score);
  assert.deepEqual(elig, [...elig].sort((a, b) => b - a));
});

test('missing data: unknown scores the category midpoint', () => {
  const snap = fixture({
    products: [{ id: 'unk', drop: ['battery_mah'] }, { id: 'mid', attrs: { battery_mah: 5000 } }],
    offers: [{ product_id: 'unk', retailer_id: 'shopa', price_egp: 9000 }, { product_id: 'mid', retailer_id: 'shopa', price_egp: 9000 }],
  });
  const prep = prepare(snap, 'mobile');
  const w = effectiveWeights(prep, BUYER.weights);
  const a = fitScore(snap.products[0], w);
  const b = fitScore(snap.products[1], w);
  assert.equal(a.fit, b.fit); // 5000 mAh is the midpoint of the 3000..7000 basis
  assert.deepEqual(a.unknown, ['battery_mah']);
});

test('missing data: an unverified product cannot take Best fit while a verified one fits', () => {
  const snap = fixture({
    products: [{ id: 'unk', drop: ['battery_mah'], attrs: { perf: 10, camera: 10 } }, { id: 'ver', attrs: { perf: 8, camera: 8 } }],
    offers: [{ product_id: 'unk', retailer_id: 'shopa', price_egp: 9000 }, { product_id: 'ver', retailer_id: 'shopa', price_egp: 10000 }],
  });
  const r = match(BUYER, snap, NOW);
  assert.ok(r.picks.find((p) => p.product.id === 'unk').score > r.picks.find((p) => p.product.id === 'ver').score);
  assert.equal(r.picks[0].product.id, 'ver');
  const unk = r.picks.find((p) => p.product.id === 'unk');
  assert.equal(unk.verified, false);
  assert.deepEqual(unk.notListed.map((x) => x.status.en), ['not listed']);
  // simulate follows the same rule
  assert.equal(match(BUYER, snap, NOW, 'simulate').top1, 'ver');
  // when nothing verified fits, the unverified product may take Best fit
  const alone = match(profile({ pay: 'cash', budget: 9500 }), snap, NOW);
  assert.equal(alone.picks[0].product.id, 'unk');
});

test('missing data on the synthetic set: the product without a camera score is labelled and never Best fit over verified ones', () => {
  const r = match(profile({ use: ['photo'], pay: 'cash', budget: 14000 }), SNAPSHOT, NOW, 'rank', { maxList: 40 });
  assert.notEqual(r.picks[0].product.id, 'tecno-camon-30');
  const row = [...r.picks, ...r.others].find((x) => x.product.id === 'tecno-camon-30');
  assert.ok(row, 'still in the results');
  assert.equal(row.verified, false);
});
