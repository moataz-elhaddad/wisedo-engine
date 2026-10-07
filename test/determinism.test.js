// BR-11: same profile + same snapshot + same now => same result; ties by product id; values rounded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { match } from '../src/layer2/index.js';
import { fixture, profile, NOW, SNAPSHOT, syntheticSnapshot } from './helpers.js';
import { PERSONAS } from './personas.js';

test('same inputs give the same result, including from a fresh copy of the snapshot', () => {
  for (const [title, answers, over] of PERSONAS) {
    const p = profile(answers, over);
    const a = match(p, SNAPSHOT, NOW);
    const b = match(structuredClone(p), SNAPSHOT, NOW);
    const c = match(p, syntheticSnapshot(), NOW); // no shared cache
    assert.deepEqual(a, b, title);
    assert.deepEqual(a, c, title);
  }
});

test('row order in the snapshot does not change the result', () => {
  const rev = syntheticSnapshot();
  for (const k of ['products', 'offers', 'plans', 'retailers']) rev[k].reverse();
  for (const [title, answers, over] of PERSONAS) {
    const p = profile(answers, over);
    assert.deepEqual(match(p, rev, NOW), match(p, SNAPSHOT, NOW), title);
  }
});

test('now is an input: Date, ISO string and epoch ms agree', () => {
  const p = profile({ use: ['photo'], pay: 'cash', budget: 20000 });
  const a = match(p, SNAPSHOT, NOW);
  assert.deepEqual(match(p, SNAPSHOT, new Date(NOW)), a);
  assert.deepEqual(match(p, SNAPSHOT, Date.parse(NOW)), a);
});

test('ties break by product id', () => {
  const twins = fixture({
    products: [{ id: 'b-phone' }, { id: 'a-phone' }, { id: 'c-phone' }],
    offers: ['b-phone', 'a-phone', 'c-phone'].map((id) => ({ product_id: id, retailer_id: 'shopa', price_egp: 9000 })),
  });
  const r = match(profile({ pay: 'cash', budget: 20000 }), twins, NOW, 'rank', { maxPicks: 1 });
  assert.equal(r.picks[0].product.id, 'a-phone');
  assert.deepEqual(r.others.map((o) => o.product.id), ['b-phone', 'c-phone']);
  // and between shops with the same cost and trust: faster, then retailer id
  const shops = fixture({
    retailers: [{ id: 'zz', trust: 8, cod: true }, { id: 'aa', trust: 8, cod: true }],
    products: [{ id: 'p' }],
    offers: [{ product_id: 'p', retailer_id: 'zz', price_egp: 9000 }, { product_id: 'p', retailer_id: 'aa', price_egp: 9000 }],
  });
  const q = match(profile({ pay: 'cash', budget: 20000 }), shops, NOW).picks[0];
  assert.equal(q.quote.retailerId, 'aa');
  assert.deepEqual(q.otherOffers.find((o) => o.retailerId === 'zz').reasons, ['tie_break']);
});

test('money and scores are rounded to 2 decimals', () => {
  const twoDp = (x) => Math.abs(x * 100 - Math.round(x * 100)) < 1e-6;
  const KEYS = new Set(['fit', 'score', 'dealBonus', 'brandBonus', 'effCost', 'rankCost', 'paid', 'cashOut', 'giftValue', 'total', 'financingCost', 'price', 'deliveryFee']);
  const walk = (o, path) => {
    if (Array.isArray(o)) return o.forEach((x, i) => walk(x, `${path}[${i}]`));
    if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) {
      if (typeof v === 'number' && KEYS.has(k)) assert.ok(twoDp(v), `${path}.${k} = ${v}`);
      walk(v, `${path}.${k}`);
    }
  };
  for (const [title, answers, over] of PERSONAS) walk(match(profile(answers, over), SNAPSHOT, NOW), title);
});
