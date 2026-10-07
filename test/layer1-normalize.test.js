// Layer 1, U3 normaliser: money and number parsing (Egyptian Arabic and English), digits, units, and the
// mapping of an extraction to option ids (unknown slots and options dropped, unmapped items with reasons).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMoney, parseStorageGb, parseSizeInches, toWesternDigits, normalizeExtraction, normalizeAnswer, resolveProductId, resolveRetailerId, REASON_LABELS } from '../src/layer1/index.js';
import { mobileConfig, SNAPSHOT } from './helpers.js';
import { identityFor } from '../src/layer1/session.js';

const ID = identityFor(SNAPSHOT, 'mobile');

test('layer1 money: thousands words, Arabic-Indic digits and shorthand', () => {
  const cases = [
    ['15 ألف', 15000], ['١٥٠٠٠', 15000], ['15k', 15000], ['15K', 15000], ['حوالي ١٢ الف', 12000],
    ['ألفين', 2000], ['15 الف ونص', 15500], ['الف و خمسميه', 1500], ['15.000', 15000], ['15,000 EGP', 15000],
    ['1.5k', 1500], ['خمسة وعشرين ألف', 25000], ['١٢ ألف و٥٠٠', 12500], ['twenty thousand', 20000],
    ['ميزانيتي 30 الف جنيه', 30000], ['من 10 لـ 15 ألف', 15000],
  ];
  for (const [text, amount] of cases) assert.equal(parseMoney(text)?.amount, amount, text);
});

test('layer1 money: per month, installment, approx and down payment flags', () => {
  assert.deepEqual(pick(parseMoney('1500 في الشهر')), { amount: 1500, perMonth: true });
  assert.deepEqual(pick(parseMoney('قسط 1500')), { amount: 1500, perMonth: true });
  assert.deepEqual(pick(parseMoney('2k a month')), { amount: 2000, perMonth: true });
  assert.equal(parseMoney('حوالي ١٢ الف').approx, true);
  assert.equal(parseMoney('15 ألف').approx, false);
  assert.equal(parseMoney('مقدم 5000').down, true);
  assert.equal(parseMoney('5k down payment').down, true);
});

test('layer1 money: durations and units are not money; a bare small number is assumed thousands', () => {
  assert.equal(parseMoney('12 شهر'), null);
  assert.equal(parseMoney('128 جيجا'), null);
  assert.equal(parseMoney('مفيش فلوس'), null);
  const bare = parseMoney('ميزانيتي 15');
  assert.equal(bare.amount, 15000);
  assert.equal(bare.assumedThousands, true);
});

test('layer1 digits and units: Arabic-Indic digits, storage and screen size', () => {
  assert.equal(toWesternDigits('١٢٣٤٥٦٧٨٩٠'), '1234567890');
  assert.equal(toWesternDigits('۱۲۸'), '128');
  assert.equal(parseStorageGb('256GB'), 256);
  assert.equal(parseStorageGb('١٢٨ جيجا'), 128);
  assert.equal(parseStorageGb('نص تيرا'), 512);
  assert.equal(parseStorageGb('1TB'), 1024);
  assert.equal(parseSizeInches('٦٥ بوصة'), 65);
  assert.equal(parseSizeInches('55 inch'), 55);
  assert.equal(parseSizeInches('6.7"'), 6.7);
});

test('layer1 normalise: values map to option ids; unknown slots and option ids are dropped', () => {
  const text = 'عايز موبايل للتصوير والألعاب، ميزانيتي 15 ألف كاش';
  const n = normalizeExtraction(mobileConfig, {
    slots: [
      { slot: 'use', values: ['photo', 'Gaming', 'flying'], amountText: null, confidence: 0.9, evidence: 'للتصوير والألعاب' },
      { slot: 'pay', values: ['كاش'], amountText: null, confidence: 0.95, evidence: 'كاش' },
      { slot: 'budget', values: [], amountText: '15 ألف', confidence: 0.9, evidence: 'ميزانيتي 15 ألف' },
      { slot: 'colour', values: ['blue'], amountText: null, confidence: 0.9, evidence: 'عايز موبايل' },
    ],
    unmapped: [],
  }, { text, ...ID });
  const by = Object.fromEntries(n.answers.map((a) => [a.slot, a.value]));
  assert.deepEqual(by, { use: ['photo', 'gaming'], pay: 'cash', budget: 15000 });
  assert.ok(n.dropped.some((d) => d.slot === 'colour' && d.why === 'unknown_slot'));
  assert.ok(n.dropped.some((d) => d.slot === 'use' && d.value === 'flying' && d.why === 'unknown_option'));
});

test('layer1 normalise: a monthly amount read as budget moves to the monthly cap; a down payment to down', () => {
  const text = 'أقدر 1500 في الشهر ومعايا مقدم 5000';
  const n = normalizeExtraction(mobileConfig, {
    slots: [
      { slot: 'budget', values: [], amountText: '1500 في الشهر', confidence: 0.9, evidence: 'أقدر 1500 في الشهر' },
      { slot: 'budget', values: [], amountText: 'مقدم 5000', confidence: 0.9, evidence: 'مقدم 5000' },
    ],
  }, { text, ...ID });
  const by = Object.fromEntries(n.answers.map((a) => [a.slot, a.value]));
  assert.deepEqual(by, { monthlyCap: 1500, down: 5000 });
});

test('layer1 normalise: evidence that is not in the text, or missing, caps the confidence below 0.7', () => {
  const text = 'عايز موبايل كويس';
  const n = normalizeExtraction(mobileConfig, {
    slots: [
      { slot: 'use', values: ['photo'], amountText: null, confidence: 0.95, evidence: 'بحب التصوير' },
      { slot: 'pay', values: ['cash'], amountText: null, confidence: 0.95, evidence: '' },
    ],
  }, { text, ...ID });
  assert.ok(n.answers.every((a) => a.confidence < 0.7));
});

test('layer1 normalise: models, shops and cities resolve to catalog ids', () => {
  assert.equal(resolveProductId('Galaxy A56', ID.products), 'samsung-a56');
  assert.equal(resolveProductId('iphone 15', ID.products), 'apple-iphone-15');
  assert.equal(resolveProductId('ايفون 15', ID.products), 'apple-iphone-15');
  assert.equal(resolveProductId('Nokia 3310', ID.products), null);
  const lotus = SNAPSHOT.retailers.find((r) => r.id === 'lotus');
  assert.equal(resolveRetailerId(lotus.name, ID.retailers), 'lotus');
  const text = `عايز Galaxy A56 من ${lotus.name} في اسكندرية`;
  const n = normalizeExtraction(mobileConfig, {
    slots: [
      { slot: 'modelInMind', values: ['Galaxy A56'], amountText: null, confidence: 0.9, evidence: 'Galaxy A56' },
      { slot: 'shops', values: [`prefer:${lotus.name}`], amountText: null, confidence: 0.9, evidence: lotus.name },
      { slot: 'city', values: ['اسكندرية'], amountText: null, confidence: 0.9, evidence: 'اسكندرية' },
    ],
  }, { text, ...ID });
  const by = Object.fromEntries(n.answers.map((a) => [a.slot, a.value]));
  assert.equal(by.modelInMind, 'samsung-a56');
  assert.deepEqual(by.shops, { prefer: ['lotus'], avoid: [] });
  assert.equal(by.city, 'alexandria');
});

test('layer1 normalise: unmapped items keep the quote and get a reason (not supported yet / no data)', () => {
  const n = normalizeExtraction(mobileConfig, {
    slots: [],
    unmapped: [
      { text: 'لونه أزرق', factor: 'look_colour' },
      { text: 'هبدل موبايلي القديم', factor: 'trade_in' },
      { text: 'مش عايز مستعمل ولا open box', factor: 'fakes_used' },
      { text: 'هستنى البلاك فرايداي', factor: 'timing_launch_currency' },
      { text: 'أخويا قالي خد ايفون', factor: 'family_opinion' },
      { text: 'something odd', factor: 'made_up' },
    ],
  }, {});
  const reasons = Object.fromEntries(n.unmapped.map((u) => [u.factor, u.reason]));
  assert.deepEqual(reasons, { look_colour: 'no_data', trade_in: 'not_supported', fakes_used: 'not_supported', timing_launch_currency: 'not_supported', family_opinion: 'not_supported', other: 'not_supported' });
  assert.equal(n.unmapped[0].text, 'لونه أزرق');
  assert.equal(REASON_LABELS.not_supported.en, 'Not supported yet');
  assert.equal(REASON_LABELS.no_data.en, 'No data yet');
});

test('layer1 normalise: answers from tiles, typed amounts and edits are validated', () => {
  assert.deepEqual(normalizeAnswer(mobileConfig, 'budget', '15 ألف'), { ok: true, value: 15000 });
  assert.deepEqual(normalizeAnswer(mobileConfig, 'use', 'photo'), { ok: true, value: ['photo'] });
  assert.deepEqual(normalizeAnswer(mobileConfig, 'pay', 'Cash'), { ok: true, value: 'cash' });
  assert.equal(normalizeAnswer(mobileConfig, 'pay', 'bitcoin').ok, false);
  assert.equal(normalizeAnswer(mobileConfig, 'nope', 'x').ok, false);
  assert.deepEqual(normalizeAnswer(mobileConfig, 'budget', null), { ok: true, value: null });
});

function pick(m) {
  return { amount: m.amount, perMonth: m.perMonth };
}
