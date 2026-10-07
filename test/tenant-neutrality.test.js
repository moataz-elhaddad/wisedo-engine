// Tenant scoping (BR-30, BR-36) and neutrality (BR-22, tech-spec 10).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { match } from '../src/layer2/index.js';
import { profile, NOW, SNAPSHOT, syntheticSnapshot, hoursAgo, ROOT_DIR } from './helpers.js';
import { PERSONAS } from './personas.js';

/** The synthetic Wisedo rows plus a B2B tenant "acme" with its own catalog in the same arrays. */
function mixedRows() {
  const s = syntheticSnapshot();
  const base = { tenant_id: 'acme', source: 'upload' };
  s.products.push(
    { ...base, id: 'acme-a', category: 'mobile', brand: 'Samsung', name: 'Acme listing A', ref_price_egp: 9000, aliases: [], checked_at: hoursAgo(48), attrs: { perf: 5, camera: 5, battery_mah: 5000, screen: 6, storage_gb: 128, os: 'android' } },
    { ...base, id: 'acme-b', category: 'mobile', brand: 'Xiaomi', name: 'Acme listing B', ref_price_egp: 12000, aliases: [], checked_at: hoursAgo(48), attrs: { perf: 6, camera: 6, battery_mah: 5500, screen: 7, storage_gb: 256, os: 'android' } },
  );
  s.retailers.push({ ...base, id: 'acme-store', name: 'Acme', trust: 8, return_days: 14, cod: true });
  s.plans.push({ ...base, id: 'acme-0', provider: 'acmefin', kind: 'finance', months: [6, 12], monthly_rate: 0, admin_share: 0.03, min_down_share: 0, promo: false, valid_until: null, retailer_id: 'acme-store', product_override: null, checked_at: hoursAgo(48) });
  s.plans.push({ ...base, id: 'acme-2', provider: 'acmefin', kind: 'finance', months: [18], monthly_rate: 0.02, admin_share: 0, min_down_share: 0, promo: false, valid_until: null, retailer_id: 'acme-store', product_override: null, checked_at: hoursAgo(48) });
  const off = (pid, price) => ({ ...base, id: `acme-o-${pid}`, product_id: pid, retailer_id: 'acme-store', url: `https://acme.example.invalid/${pid}`, price_egp: price, delivery: { greater_cairo: { fee: 0, days: 1 }, other: { fee: 0, days: 3 } }, in_stock: true, official: true, extras: [], checked_at: hoursAgo(1) });
  s.offers.push(off('acme-a', 8500), off('acme-b', 11000));
  // Cross-tenant rows that must be ignored: an acme offer on a Wisedo product, and a Wisedo offer on an acme product.
  s.offers.push(off('samsung-a36', 100));
  s.offers.push({ ...SNAPSHOT.offers[0], id: 'wisedo-on-acme', product_id: 'acme-a', price_egp: 50, tenant_id: 'wisedo' });
  return s;
}

const allIds = (r) => [...r.picks.map((p) => p.product.id), ...r.others.map((o) => o.product.id), r.nothingFits && r.nothingFits.product ? r.nothingFits.product.id : null].filter(Boolean);

test('consumer tenant never sees B2B rows', () => {
  const mixed = mixedRows();
  for (const [title, answers, over] of PERSONAS) {
    const p = profile(answers, over);
    const r = match(p, mixed, NOW, 'rank', { maxList: 50 });
    assert.ok(allIds(r).every((id) => !id.startsWith('acme')), title);
    for (const pick of r.picks) for (const o of pick.otherOffers) assert.ok(!o.offerId.startsWith('acme'), title);
    assert.equal(r.counts.inScope, 40);
    // identical to ranking without the B2B rows at all
    assert.deepEqual(r.picks, match(p, SNAPSHOT, NOW, 'rank', { maxList: 50 }).picks, title);
  }
});

test('a B2B tenant ranks only on its own catalog, offers and plans', () => {
  const acme = { ...mixedRows(), tenant_id: 'acme', snapshot_id: 'acme-1' };
  const r = match(profile({ use: ['social'], pay: 'finance', monthlyCap: 1000 }), acme, NOW, 'rank', { maxList: 50 });
  assert.equal(r.tenant_id, 'acme');
  assert.equal(r.counts.inScope, 2);
  assert.ok(allIds(r).length > 0);
  assert.ok(allIds(r).every((id) => id.startsWith('acme')));
  for (const p of r.picks) {
    assert.equal(p.quote.retailerId, 'acme-store');
    assert.ok(p.quote.plan.planId.startsWith('acme-'));
    assert.ok(p.otherOffers.every((o) => o.offerId.startsWith('acme-o-')));
  }
  // the Wisedo offer row pointing at an acme product is ignored (its price would be 50)
  assert.ok(r.picks.every((p) => p.quote.price > 1000));
  // best plan within the client's own offers: 8,500 at 3% admin over 12 months = 730/month fits 1,000
  const a = r.picks.find((p) => p.product.id === 'acme-a');
  if (a) assert.deepEqual([a.quote.plan.planId, a.quote.plan.months], ['acme-0', 12]);
  const s = match(profile({ use: ['social'], pay: 'cash', budget: 20000 }), acme, NOW, 'simulate');
  assert.ok(s.top3.every((id) => id.startsWith('acme')));
});

test('per-tenant maxPicks and maxList are honoured', () => {
  const acme = { ...mixedRows(), tenant_id: 'acme', snapshot_id: 'acme-1' };
  const r = match(profile({ pay: 'cash', budget: 20000 }), acme, NOW, 'rank', { maxPicks: 1, maxList: 1 });
  assert.equal(r.picks.length, 1);
  assert.equal(r.others.length, 0);
});

test('no commission, affiliate or client-status input exists in the scoring code', () => {
  const dirs = [join(ROOT_DIR, 'src', 'layer2')];
  for (const d of dirs) {
    for (const f of readdirSync(d).filter((x) => x.endsWith('.js'))) {
      const src = readFileSync(join(d, f), 'utf8');
      assert.doesNotMatch(src, /commission|affiliate|sponsor|partner_tier|client_status|paid_placement/i, `${f} mentions a commercial input`);
    }
  }
});

test('picks are unchanged when affiliate tags change', () => {
  const tagged = syntheticSnapshot();
  tagged.retailers.forEach((r, i) => { r.affiliate_tag = i % 2 ? 'wisedo-21' : 'partner-' + r.id; });
  for (const [title, answers, over] of PERSONAS) {
    const p = profile(answers, over);
    assert.deepEqual(match(p, tagged, NOW), match(p, SNAPSHOT, NOW), title);
  }
});
