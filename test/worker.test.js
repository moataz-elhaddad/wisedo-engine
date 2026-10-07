// The demo Worker (worker/index.js) end to end over a node:sqlite stand-in for D1: reset to the sample data,
// SKU reads and writes, admin token, CSV round trip, the session API, and that edits change the engine's picks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import { createD1 } from './helpers-d1.js';
import { parseCsv } from '../worker/csv.js';
import { bulkUpsert, lit } from '../worker/sql.js';
import { match } from '../src/layer2/index.js';
import { buildNeedProfile } from '../src/profile/build.js';

const TOKEN = 'test-admin-token-0123456789abcdef';

function setup() {
  const env = { DB: createD1(), WISEDO_ADMIN_TOKEN: TOKEN, ASSETS: { fetch: async () => new Response('asset') } };
  const call = async (method, path, body, { auth = true, raw = false } = {}) => {
    const headers = {};
    if (auth) headers.authorization = `Bearer ${TOKEN}`;
    let payload;
    if (body !== undefined) {
      payload = typeof body === 'string' ? body : JSON.stringify(body);
      headers['content-type'] = typeof body === 'string' ? 'text/csv' : 'application/json';
    }
    const res = await worker.fetch(new Request(`https://demo.test${path}`, { method, headers, body: payload }), env);
    return { status: res.status, body: raw ? await res.text() : await res.json() };
  };
  return { env, call };
}

async function seeded() {
  const s = setup();
  const r = await s.call('POST', '/api/admin/reset');
  assert.equal(r.status, 200);
  return s;
}

test('sql literals escape quotes and bulk statements stay under the size cap', () => {
  assert.equal(lit("O'Neil"), "'O''Neil'");
  assert.equal(lit(null), 'NULL');
  assert.equal(lit(true), '1');
  assert.throws(() => lit(NaN));
  const rows = Array.from({ length: 3000 }, (_, i) => [`id-${i}`, 'x'.repeat(100)]);
  const sqls = bulkUpsert('t', ['a', 'b'], rows);
  assert.ok(sqls.length > 1);
  for (const s of sqls) assert.ok(s.length <= 80_000);
});

test('reset loads the sample data within the free-plan query budget', async () => {
  const { env, call } = setup();
  env.DB.resetCount();
  const r = await call('POST', '/api/admin/reset');
  assert.deepEqual(r.body.loaded, { products: 178, offers: 670, retailers: 7, plans: 20 });
  assert.ok(env.DB.queries <= 50, `reset used ${env.DB.queries} queries`);
  const h = await call('GET', '/api/health', undefined, { auth: false });
  assert.equal(h.body.counts.products, 178);
  assert.equal(h.body.tenant, 'demo-b2b');
  assert.equal(h.body.clock, 'demo');
  assert.equal(h.body.writes, true);
});

test('writes need the admin token; reads do not', async () => {
  const { call, env } = await seeded();
  assert.equal((await call('GET', '/api/skus?category=laptop', undefined, { auth: false })).status, 200);
  assert.equal((await call('POST', '/api/admin/reset', undefined, { auth: false })).status, 401);
  assert.equal((await call('DELETE', '/api/skus/laptop-lenovo-ideapad-1', undefined, { auth: false })).status, 401);
  env.WISEDO_ADMIN_TOKEN = 'short';
  assert.equal((await call('POST', '/api/admin/reset')).status, 401, 'a short token disables writes');
});

test('SKU list, detail, update, validation and delete', async () => {
  const { call } = await seeded();
  const list = (await call('GET', '/api/skus?category=laptop')).body;
  assert.equal(list.length, 35);
  assert.ok(list.every((p) => p.tenant_id === 'demo-b2b' && p.category === 'laptop'));
  const one = list.find((p) => p.id === 'laptop-lenovo-ideapad-1');
  assert.ok(one.offer_count > 0 && one.min_price_egp > 0);

  const detail = (await call('GET', '/api/skus/laptop-lenovo-ideapad-1')).body;
  assert.equal(detail.product.id, 'laptop-lenovo-ideapad-1');
  assert.equal(detail.offers.length, one.offer_count);

  const up = await call('PUT', '/api/skus/laptop-lenovo-ideapad-1', { name: 'Lenovo IdeaPad 1 (edited)', attrs: { ...detail.product.attrs, ram_gb: 16 } });
  assert.equal(up.status, 200);
  assert.equal(up.body.name, 'Lenovo IdeaPad 1 (edited)');
  assert.equal(up.body.attrs.ram_gb, 16);
  assert.equal(up.body.category, 'laptop');

  const bad = await call('PUT', '/api/skus/laptop-lenovo-ideapad-1', { attrs: { ram_gb: 'lots', wings: 2 } });
  assert.equal(bad.status, 422);
  assert.ok(bad.body.details.some((e) => e.includes('ram_gb must be a number')));
  assert.ok(bad.body.details.some((e) => e.includes('unknown attribute "wings"')));

  const created = await call('POST', '/api/skus', { category: 'laptop', brand: 'Dell', name: 'Inspiron 15 Test', ref_price_egp: 25000, attrs: { ram_gb: 8 } });
  assert.equal(created.status, 201);
  assert.equal(created.body.id, 'laptop-dell-inspiron-15-test');
  assert.equal((await call('POST', '/api/skus', { category: 'laptop', brand: 'Dell', name: 'Inspiron 15 Test' })).status, 409);

  const offer = await call('POST', '/api/offers', { product_id: created.body.id, retailer_id: 'nile', price_egp: 24000, url: 'https://nile.example.invalid/p/x' });
  assert.equal(offer.status, 201);
  assert.equal(offer.body.id, 'o-laptop-dell-inspiron-15-test-nile');
  assert.deepEqual(Object.keys(offer.body.delivery).sort(), ['alexandria', 'greater_cairo', 'other']);
  assert.equal((await call('POST', '/api/offers', { product_id: created.body.id, retailer_id: 'nobody', price_egp: 1, url: 'x' })).status, 422);

  const del = await call('DELETE', `/api/skus/${created.body.id}`);
  assert.deepEqual(del.body.deleted, { offers: 1, products: 1 });
  assert.equal((await call('GET', `/api/skus/${created.body.id}`)).status, 404);
});

test('CSV export and import round trip; bad rows apply nothing', async () => {
  const { call } = await seeded();
  const csv = (await call('GET', '/api/export.csv?category=laptop', undefined, { raw: true })).body;
  const rows = parseCsv(csv);
  assert.ok(rows[0].includes('attr:cpu'));
  const same = await call('POST', '/api/import?category=laptop', csv);
  assert.equal(same.status, 200, JSON.stringify(same.body));
  assert.equal(same.body.products.created, 0);
  assert.equal(same.body.products.updated, 35);

  const head = rows[0];
  const blank = head.map(() => '');
  const set = (r, k, v) => { r[head.indexOf(k)] = v; return r; };
  const add = [...blank];
  set(add, 'brand', 'HP'); set(add, 'name', 'Victus 15 Upload'); set(add, 'ref_price_egp', '"42,000"'); set(add, 'attr:ram_gb', '16');
  set(add, 'attr:has_dedicated_gpu', 'yes'); set(add, 'retailer_id', 'lotus'); set(add, 'price_egp', '41000'); set(add, 'url', 'https://lotus.example.invalid/p/v');
  const ok = await call('POST', '/api/import?category=laptop', [head, add].map((r) => r.join(',')).join('\n'));
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual(ok.body.products, { created: 1, updated: 0 });
  const p = (await call('GET', '/api/skus/laptop-hp-victus-15-upload')).body;
  assert.equal(p.product.ref_price_egp, 42000);
  assert.equal(p.product.attrs.has_dedicated_gpu, true);
  assert.equal(p.offers[0].delivery.greater_cairo.days, 3);

  const bad = [...blank];
  set(bad, 'brand', 'Acer'); set(bad, 'name', 'Broken'); set(bad, 'attr:ram_gb', 'many'); set(bad, 'retailer_id', 'lotus');
  const before = (await call('GET', '/api/health')).body.counts;
  const r = await call('POST', '/api/import?category=laptop', [head, add, bad].map((x) => x.join(',')).join('\n'));
  assert.equal(r.status, 422);
  assert.equal(r.body.applied, false);
  assert.ok(r.body.errors.some((e) => e.startsWith('row 3')));
  assert.deepEqual((await call('GET', '/api/health')).body.counts, before);
});

test('session API runs Layer 1 + Layer 2 on the stored catalog', async () => {
  const { call } = await seeded();
  let out = (await call('POST', '/api/session', { event: { type: 'start', tile: 'laptop' } }, { auth: false })).body;
  assert.ok(out.state && out.ui, JSON.stringify(out).slice(0, 300));
  assert.notEqual(out.ui.screen, 'error');
  out = (await call('POST', '/api/session', { state: out.state, event: { type: 'showNow' } }, { auth: false })).body;
  assert.equal(out.ui.screen, 'result', JSON.stringify(out.ui).slice(0, 300));
  const text = (await call('POST', '/api/session', { event: { type: 'start', text: 'عايز لابتوب للبرمجة في حدود 40 ألف' } }, { auth: false })).body;
  assert.notEqual(text.ui.screen, 'error');
  assert.equal(text.state.category, 'laptop');
});

test('an edit in the SKU store changes the engine result', async () => {
  const { call } = await seeded();
  const snap = (await call('GET', '/api/snapshot?configs=1')).body;
  const cfg = snap.configs.laptop;
  const profile = buildNeedProfile(cfg, { use: ['programming'], pay: 'cash', budget: 45000 });
  const top = (s) => { const r = match(profile, s, s.now, 'rank'); return r.picks[0] && r.picks[0].product.id; };
  const first = top(snap);
  assert.ok(first);
  const offers = (await call('GET', `/api/skus/${first}`)).body.offers;
  for (const o of offers) assert.equal((await call('PUT', `/api/offers/${o.id}`, { in_stock: false })).status, 200);
  const after = (await call('GET', '/api/snapshot?configs=1')).body;
  assert.notEqual(after.snapshot_id, snap.snapshot_id);
  assert.notEqual(top(after), first);
});
