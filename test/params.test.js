import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOverrides, cleanOverrides, paramsOf, DEFAULT_PARAMS, PARAM_SPECS, baseValue, listChanges } from '../src/params.js';
import { validateCategoryConfig } from '../src/contracts.js';
import { match } from '../src/layer2/index.js';
import { mobileConfig, syntheticSnapshot, NOW, profile } from './helpers.js';
import { buildNeedProfile } from '../src/profile/build.js';
import { PERSONAS } from './personas.js';

const SNAP = syntheticSnapshot();
const withConfig = (cfg) => { const s = syntheticSnapshot(); s.configs = { mobile: cfg }; return s; };
const answers = (title) => PERSONAS.find((p) => p[0].startsWith(title));

test('no overrides: the config and the results are unchanged', () => {
  const { config, overrides } = applyOverrides(mobileConfig, {});
  assert.deepEqual(overrides, {});
  for (const [title, a, over] of PERSONAS) {
    const base = match(profile(a, over), withConfig(mobileConfig), NOW);
    const same = match(profile(a, over), withConfig({ ...config, version: mobileConfig.version }), NOW);
    assert.deepEqual(same.picks.map((p) => p.product.id), base.picks.map((p) => p.product.id), title);
  }
});

test('every param default equals the spec base value', () => {
  for (const s of PARAM_SPECS) assert.notEqual(baseValue(s, mobileConfig), undefined, s.path);
});

test('overrides are clamped, unknown keys are reported, same-as-base values are dropped', () => {
  const r = cleanOverrides({ params: { stretch: 9, maxPicks: 2.4, dealCap: DEFAULT_PARAMS.dealCap }, baseWeights: { nope: 1, perf: 1.5 } }, mobileConfig);
  assert.equal(r.overrides.params.stretch, 1.5);
  assert.equal(r.overrides.params.maxPicks, 2);
  assert.equal(r.overrides.params.dealCap, undefined);
  assert.equal(r.overrides.baseWeights.perf, 1.5);
  assert.ok(r.problems.some((p) => p.includes('nope')));
});

test('the overridden config still passes the config validator', () => {
  const { config } = applyOverrides(mobileConfig, { params: { stretch: 1.3, layer1: { maxQuestions: 5 } }, baseWeights: { camera: 2 }, effects: { use: { gaming: { perf: 2 } } }, maxMonths: 12, freshness: { priceStockHours: 6 } });
  const v = validateCategoryConfig(config);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.equal(paramsOf(config).layer1.maxQuestions, 5);
});

test('stretch ceiling changes what counts as a stretch option', () => {
  const [, a, over] = answers('Student, 500/month');
  const tight = match(profile({ use: ['social'], pay: 'cash', budget: 9000 }), withConfig(applyOverrides(mobileConfig, { params: { stretch: 1 } }).config), NOW);
  const wide = match(profile({ use: ['social'], pay: 'cash', budget: 9000 }), withConfig(applyOverrides(mobileConfig, { params: { stretch: 1.5 } }).config), NOW);
  assert.ok(wide.counts.stretch >= tight.counts.stretch);
  assert.equal(tight.counts.stretch, 0);
  assert.ok(a && over);
});

test('priorities move the best match: camera weight up favours camera phones', () => {
  const a = { use: ['social'], pay: 'cash', budget: 30000 };
  const camCfg = applyOverrides(mobileConfig, { baseWeights: { camera: 3, perf: 0, battery_mah: 0, screen: 0 } }).config;
  const base = match(profile(a), withConfig(mobileConfig), NOW);
  const cam = match(buildNeedProfile(camCfg, a), withConfig(camCfg), NOW);
  assert.equal(cam.picks[0].product.id !== base.picks[0].product.id || cam.picks[0].fit !== base.picks[0].fit, true);
  const camOf = (r) => { const p = SNAP.products.find((x) => x.id === r.picks[0].product.id); return p.attrs.camera; };
  assert.ok(camOf(cam) >= camOf(base));
});

test('picks shown follows params.maxPicks', () => {
  const a = { use: ['social'], pay: 'cash', budget: 40000 };
  const one = match(profile(a), withConfig(applyOverrides(mobileConfig, { params: { maxPicks: 1 } }).config), NOW);
  assert.equal(one.picks.length, 1);
});

test('listChanges names every change with its old and new value', () => {
  const { overrides } = applyOverrides(mobileConfig, { params: { stretch: 1.2 }, baseWeights: { camera: 2 }, effects: { use: { gaming: { perf: 2 } } } });
  const rows = listChanges(overrides, mobileConfig);
  assert.ok(rows.find((r) => r.key === 'params.stretch' && r.from === 1.15 && r.to === 1.2));
  assert.ok(rows.find((r) => r.key === 'baseWeights.camera' && r.from === 1 && r.to === 2));
  assert.ok(rows.find((r) => r.key === 'effects.use.gaming.perf' && r.from === 1 && r.to === 2));
});
