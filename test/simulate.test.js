// Simulate mode: agrees with rank on top-1, is read-only and silent, and is fast.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { match } from '../src/layer2/index.js';
import { buildNeedProfile } from '../src/profile/build.js';
import { profile, NOW, SNAPSHOT, mobileConfig } from './helpers.js';
import { PERSONAS } from './personas.js';

test('simulate agrees with rank on the #1 pick and its shop', () => {
  for (const [title, answers, over] of PERSONAS) {
    const p = profile(answers, over);
    const r = match(p, SNAPSHOT, NOW);
    const s = match(p, SNAPSHOT, NOW, 'simulate');
    assert.equal(s.top1, r.picks[0] ? r.picks[0].product.id : null, title);
    assert.equal(s.top1Shop, r.picks[0] ? r.picks[0].quote.retailerId : null, title);
    assert.equal(s.count, r.counts.eligible, title);
    if (r.status === 'nothing_fits') assert.equal(s.closest, r.nothingFits.product.id, title);
    assert.ok(s.top3.length <= 3);
    if (s.top1) assert.equal(s.top3[0], s.top1);
  }
});

test('simulate returns only counts and ids, changes nothing and logs nothing', () => {
  const before = JSON.stringify(SNAPSHOT);
  const p = profile({ use: ['photo'], pay: 'finance', monthlyCap: 1500 });
  const pBefore = JSON.stringify(p);
  const calls = [];
  const orig = { log: console.log, warn: console.warn, error: console.error, info: console.info, debug: console.debug };
  for (const k of Object.keys(orig)) console[k] = (...a) => calls.push([k, a]);
  let s;
  try { s = match(p, SNAPSHOT, NOW, 'simulate'); } finally { Object.assign(console, orig); }
  assert.deepEqual(calls, []);
  assert.deepEqual(Object.keys(s).sort(), ['closest', 'count', 'mode', 'stretchCount', 'top1', 'top1Shop', 'top3']);
  assert.equal(JSON.stringify(SNAPSHOT), before);
  assert.equal(JSON.stringify(p), pBefore);
});

test('simulate is fast: average under 5 ms per call on the synthetic set', (t) => {
  // The hypothetical answers Layer 1 would simulate for one question, across many personas.
  const profiles = [];
  for (const [, answers] of PERSONAS) {
    for (const use of ['social', 'photo', 'gaming', 'work', 'basic']) {
      profiles.push(buildNeedProfile(mobileConfig, { ...answers, use: [use] }));
    }
  }
  for (const p of profiles) match(p, SNAPSHOT, NOW, 'simulate'); // warm-up (JIT, prepared snapshot cache)
  const rounds = 5;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < rounds; i++) for (const p of profiles) match(p, SNAPSHOT, NOW, 'simulate');
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const avg = ms / (rounds * profiles.length);
  t.diagnostic(`simulate average: ${avg.toFixed(3)} ms per call over ${rounds * profiles.length} calls (40 products, 134 offers, 20 plans)`);
  assert.ok(avg < 5, `average ${avg} ms`);
});
