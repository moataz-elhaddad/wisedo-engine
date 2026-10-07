import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, DATA_NOW } from '../data/generate.js';
import { SNAPSHOT, mobileConfig } from './helpers.js';

const NOW_MS = Date.parse(DATA_NOW);
const H = 3600 * 1000;

test('generator is deterministic and matches the committed files', () => {
  const a = generate();
  const b = generate();
  assert.deepEqual(a, b);
  for (const key of ['products', 'retailers', 'offers', 'plans']) assert.deepEqual(a[key], SNAPSHOT[key], `${key} differ: run node data/generate.js`);
});

test('dataset size and spread', () => {
  const { products, retailers, offers, plans } = SNAPSHOT;
  assert.ok(products.length >= 38 && products.length <= 45, `~40 products, got ${products.length}`);
  assert.ok(new Set(products.map((p) => p.brand)).size >= 8);
  const tiers = { budget: 0, mid: 0, premium: 0 };
  for (const p of products) tiers[p.ref_price_egp < 12000 ? 'budget' : p.ref_price_egp <= 25000 ? 'mid' : 'premium']++;
  for (const [k, n] of Object.entries(tiers)) assert.ok(n >= 8, `tier ${k} has ${n}`);
  assert.equal(retailers.length, 7);
  const per = {};
  for (const o of offers) per[o.product_id] = (per[o.product_id] || 0) + 1;
  for (const p of products) assert.ok(per[p.id] >= 2 && per[p.id] <= 5, `${p.id} has ${per[p.id]} offers`);
  const kinds = new Set(plans.map((p) => p.kind));
  assert.ok(kinds.has('card') && kinds.has('finance'));
  assert.ok(new Set(plans.filter((p) => p.kind === 'card').map((p) => p.provider)).size >= 2);
  assert.ok(new Set(plans.filter((p) => p.kind === 'finance').map((p) => p.provider)).size >= 2);
  for (const r of retailers) assert.ok(r.trust >= 1 && r.trust <= 10 && typeof r.cod === 'boolean' && r.return_days >= 0);
});

test('deliberate edge cases are present', () => {
  const { products, offers, plans } = SNAPSHOT;
  // missing spec
  assert.ok(products.some((p) => mobileConfig.attributes.some((a) => a.type === 'number' && !(a.id in p.attrs))), 'a product with a missing spec');
  // import offer
  assert.ok(offers.some((o) => !o.official));
  // out of stock
  assert.ok(offers.some((o) => !o.in_stock));
  // stale beyond the 24 h limit
  assert.ok(offers.some((o) => NOW_MS - Date.parse(o.checked_at) > 24 * H));
  // a product whose every offer is stale (cannot be loaded)
  const byProduct = Object.groupBy(offers, (o) => o.product_id);
  assert.ok(Object.values(byProduct).some((os) => os.every((o) => NOW_MS - Date.parse(o.checked_at) > 24 * H)));
  // promo ending within 14 days
  assert.ok(plans.some((p) => p.promo && p.valid_until && (Date.parse(p.valid_until + 'T23:59:59Z') - NOW_MS) / (24 * H) <= 14 && Date.parse(p.valid_until + 'T23:59:59Z') > NOW_MS));
  // an expired promo
  assert.ok(plans.some((p) => p.promo && p.valid_until && Date.parse(p.valid_until + 'T23:59:59Z') < NOW_MS));
  // an offer that does not deliver to some zone
  assert.ok(offers.some((o) => mobileConfig.zones.ids.some((z) => !(z in o.delivery))));
  // plans that need a minimum down payment
  assert.ok(plans.some((p) => p.min_down_share > 0));
});
