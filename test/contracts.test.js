import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateCategoryConfig, validateSnapshot, validateNeedProfile, validateOffer, validatePlan,
  validateMatchResult, emptyNeedProfile,
} from '../src/contracts.js';
import { buildNeedProfile } from '../src/profile/build.js';
import { evalCondition } from '../src/conditions.js';
import { mobileConfig, SNAPSHOT, profile } from './helpers.js';
import { match } from '../src/layer2/index.js';
import { NOW } from './helpers.js';

test('mobile config passes the publish check', () => {
  const v = validateCategoryConfig(mobileConfig);
  assert.deepEqual(v.errors, []);
});

test('config covers every slot named in tech-spec 4.1', () => {
  const ids = new Set(mobileConfig.slots.map((s) => s.id));
  for (const id of ['use', 'intensity', 'gameLevel', 'photoType', 'parentUse', 'who', 'compat', 'pay', 'provider', 'budget',
    'monthlyCap', 'down', 'urgentDays', 'acceptImports', 'city', 'cod', 'shops', 'brand', 'modelInMind']) {
    assert.ok(ids.has(id), `missing slot ${id}`);
  }
  for (const s of mobileConfig.slots) {
    assert.ok(s.factors.length > 0, `${s.id} carries no factor`);
    assert.ok(s.label.ar && s.label.en, `${s.id} needs ar and en labels`);
    for (const o of s.options) assert.match(o.id, /^[a-z0-9_]+$/, `${s.id}.${o.id} must be short lowercase`);
  }
});

test('every one of the 40 buying factors has a slot, a field or an out-of-scope reason', () => {
  assert.equal(mobileConfig.factors.length, 40);
  for (const f of mobileConfig.factors) {
    if (f.status === 'covered' || f.status === 'partial') assert.ok(f.via.length > 0, f.id);
    else assert.ok(f.reason, f.id);
  }
  // a config with a factor in none of the three fails the publish check
  const broken = structuredClone(mobileConfig);
  broken.factors.push({ id: 'mystery', group: 'need', name: 'Mystery', status: 'covered', via: [] });
  assert.equal(validateCategoryConfig(broken).ok, false);
});

test('config validator rejects broken references', () => {
  const bad = structuredClone(mobileConfig);
  bad.slots[0].options[1].effects.weights.nonsense = 1;
  bad.slots.find((s) => s.id === 'gameLevel').dependsOn = { use: ['juggling'] };
  const v = validateCategoryConfig(bad);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes('nonsense')));
  assert.ok(v.errors.some((e) => e.includes('juggling')));
});

test('synthetic snapshot validates and every row is synthetic and tenant-tagged', () => {
  const v = validateSnapshot(SNAPSHOT);
  assert.deepEqual(v.errors, []);
  for (const key of ['products', 'retailers', 'offers', 'plans']) {
    for (const r of SNAPSHOT[key]) {
      assert.equal(r.source, 'synthetic', `${key}/${r.id}`);
      assert.equal(r.tenant_id, 'wisedo', `${key}/${r.id}`);
    }
  }
});

test('need profile validator: built profiles pass, bad shapes fail', () => {
  assert.deepEqual(validateNeedProfile(emptyNeedProfile('mobile'), mobileConfig).errors, []);
  const p = profile({ use: ['photo'], pay: 'finance', monthlyCap: 1500, provider: 'sahla', city: 'giza', cod: 'prefer', shops: { prefer: ['nile'], avoid: ['khan'] } });
  assert.deepEqual(validateNeedProfile(p, mobileConfig).errors, []);
  const bad = structuredClone(p);
  bad.money.pay = 'bitcoin';
  bad.logistics.cod = 'always';
  bad.logistics.city = 'atlantis';
  bad.needs.push({ slot: 'horoscope', value: 'leo', source: 'text' });
  bad.must.push({ attr: 'ram_gb', op: '~', value: 8 });
  const v = validateNeedProfile(bad, mobileConfig);
  assert.equal(v.ok, false);
  for (const frag of ['money.pay', 'logistics.cod', 'atlantis', 'horoscope', 'op']) assert.ok(v.errors.some((e) => e.includes(frag)), frag);
});

test('offer and plan validators catch missing fields', () => {
  const o = structuredClone(SNAPSHOT.offers[0]);
  delete o.delivery;
  o.source = 'scraped-by-magic';
  assert.equal(validateOffer(o).ok, false);
  const pl = structuredClone(SNAPSHOT.plans[0]);
  pl.kind = 'bnpl';
  pl.min_down_share = 2;
  assert.equal(validatePlan(pl).ok, false);
});

test('match results satisfy the result contract', () => {
  const r = match(profile({ use: ['photo'], pay: 'cash', budget: 20000 }), SNAPSHOT, NOW);
  assert.deepEqual(validateMatchResult(r).errors, []);
  const s = match(profile({ use: ['photo'], pay: 'cash', budget: 20000 }), SNAPSHOT, NOW, 'simulate');
  assert.deepEqual(validateMatchResult(s).errors, []);
  const none = match(profile({ pay: 'cash', budget: 1000 }), SNAPSHOT, NOW);
  assert.deepEqual(validateMatchResult(none).errors, []);
});

test('rank mode rejects an invalid profile', () => {
  const p = profile({ pay: 'cash', budget: 20000 });
  p.money.pay = 'barter';
  assert.throws(() => match(p, SNAPSHOT, NOW), /invalid NeedProfile/);
});

test('profile builder: weights, musts, prefers in stated order, set paths, derive', () => {
  const p = buildNeedProfile(mobileConfig, [
    { slot: 'who', value: 'parent', source: 'text', confidence: 0.9 },
    { slot: 'compat', value: ['galaxy_watch'], source: 'text' },
    { slot: 'brandAvoid', value: ['xiaomi'], source: 'text' },
    { slot: 'pay', value: 'finance', source: 'answer' },
    { slot: 'monthlyCap', value: 'm1500', source: 'answer' },
  ]);
  assert.equal(p.weights.perf, 0.4); // 1 - 0.6
  assert.equal(p.weights.camera, 0.6);
  assert.equal(p.weights.ease, 1.5);
  assert.equal(p.money.pay, 'finance');
  assert.equal(p.money.monthlyCap, 1500);
  assert.equal(p.money.down, 0); // slot default, source "default"
  assert.equal(p.needs.find((n) => n.slot === 'down').source, 'default');
  assert.deepEqual(p.prefer.map((f) => [f.from, f.order]), [['compat:galaxy_watch', 1], ['brandAvoid:xiaomi', 2]]);
  // 1500/month over 18 or 24 months at 2% flat: the best reference plan gives the max price
  assert.equal(p.derived.maxPrice, Math.round((1500 * 24) / 1.48 * 100) / 100);
  // negative weights clamp to 0
  const q = buildNeedProfile(mobileConfig, { who: 'parent', use: ['basic'], intensity: 'light' });
  assert.equal(q.weights.perf, 0);
  assert.throws(() => buildNeedProfile(mobileConfig, { use: ['knitting'] }), /no option "knitting"/);
  assert.throws(() => buildNeedProfile(mobileConfig, { colour: 'red' }), /unknown slot/);
});

test('conditions: slot, path, signal, combinators', () => {
  const p = profile({ use: ['gaming'], gameLevel: 'heavy', pay: 'cash', budget: 10000 });
  assert.equal(evalCondition({ slot: 'use', in: ['gaming'] }, { profile: p }), true);
  assert.equal(evalCondition({ path: 'derived.maxPrice', lte: 12000 }, { profile: p }), true);
  assert.equal(evalCondition({ all: [{ slot: 'gameLevel', in: ['heavy'] }, { not: { path: 'money.pay', eq: 'card' } }] }, { profile: p }), true);
  assert.equal(evalCondition({ signal: 'importCheaper' }, { profile: p }), false);
  assert.equal(evalCondition({ signal: 'saleWeeks', between: [1, 10] }, { profile: p, signals: { saleWeeks: 8 } }), true);
  assert.equal(evalCondition({ slot: 'keep', answered: true }, { profile: p }), false);
});
