// The synthetic 300-phrase eval set must keep passing the acceptance rule of tech-spec 4.1.
// Runs the same checks as `node eval/coverage.js` (it imports the checking function).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkPhraseSet, loadContext, loadPhrases, EXPECTED_COUNT, MIN_PER_FACTOR } from '../eval/coverage.js';

const { phrases, errors: parseErrors } = loadPhrases();
const ctx = loadContext();
const result = checkPhraseSet({ phrases, parseErrors, ...ctx });

test('eval phrases: file parses and passes every acceptance rule', () => {
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
});

test('eval phrases: exactly 300 lines, unique ids, all labelled synthetic', () => {
  assert.equal(phrases.length, EXPECTED_COUNT);
  assert.equal(new Set(phrases.map((p) => p.id)).size, EXPECTED_COUNT);
  assert.ok(phrases.every((p) => p.label === 'synthetic'));
});

test('eval phrases: every captured factor has at least 5 phrases', () => {
  assert.ok(result.report.factorTable.length > 0);
  for (const f of result.report.factorTable) assert.ok(f.count >= MIN_PER_FACTOR, `${f.id} has ${f.count}`);
});

test('eval phrases: every Not used topic appears', () => {
  for (const t of ['colour', 'trade-in', 'condition', 'wait-for-sale', 'social']) {
    assert.ok(result.report.byTopic[t] > 0, `no phrase for ${t}`);
  }
});

test('eval phrases: the checker rejects a broken set', () => {
  const bad = structuredClone(phrases);
  bad[0].expected.slots = { nope: 'x' };
  bad[1].label = 'real';
  bad[2].expected = { slots: {}, unmapped: [] };
  bad.pop();
  const r = checkPhraseSet({ phrases: bad, ...ctx });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('unknown slot id')));
  assert.ok(r.errors.some((e) => e.includes('synthetic')));
  assert.ok(r.errors.some((e) => e.includes('expected 300')));
});
