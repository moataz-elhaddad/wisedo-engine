// The rule-based extractor (src/layer1/u2-rules.js): what keywords catch in each category, read through U3.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractByRules } from '../src/layer1/u2-rules.js';
import { normalizeExtraction } from '../src/layer1/u3-normalize.js';
import { CONFIGS } from '../worker/bundle.js';

const read = (cat, text) => {
  const n = normalizeExtraction(CONFIGS[cat], extractByRules(CONFIGS[cat], text), { text });
  return Object.fromEntries(n.answers.map((a) => [a.slot, a.value]));
};

test('rules: laptop budget, pay, city, use (Arabic)', () => {
  assert.deepEqual(read('laptop', 'عايز لابتوب للبرمجة في حدود 40 ألف كاش في القاهرة'), { budget: 40000, city: 'cairo', pay: 'cash', use: ['programming'] });
});

test('rules: monthly cap and down payment in one sentence; a negated brand goes to brandAvoid', () => {
  const v = read('laptop', 'لابتوب لابني للجامعة، مش عايز لينوفو، تقسيط 1500 في الشهر ومقدم 5000');
  assert.equal(v.monthlyCap, 1500);
  assert.equal(v.down, 5000);
  assert.deepEqual(v.brandAvoid, ['lenovo']);
  assert.equal(v.brand, undefined);
  assert.equal(v.who, 'kid');
});

test('rules: English, sizes and thousands separators', () => {
  const v = read('laptop', 'gaming laptop under 60k, heavy games, 16 inch, 1TB, Alex, need it today');
  assert.deepEqual([v.budget, v.city, v.gameLevel, v.storageNeed, v.screenSize, v.urgentDays], [60000, 'alexandria', 'heavy', 's1tb', 'large', 'today']);
  assert.equal(read('laptop', 'office work, around 25,000 EGP, HP or Dell').budget, 25000);
});

test('rules: no money from spec numbers', () => {
  assert.deepEqual(read('laptop', 'لابتوب core i7 رام 16'), {});
});

test('rules: mobile, TV, AC and fridge specifics', () => {
  const m = read('mobile', 'iphone for photos and tiktok, 256gb, valu installments 2000 a month');
  assert.deepEqual([m.monthlyCap, m.pay, m.os, m.storageNeed], [2000, 'finance', 'ios', 's256']);
  assert.deepEqual(m.use.sort(), ['photo', 'social']);
  const tv = read('tv', 'شاشة للماتشات والبلايستيشن 5 بـ 30 الف على الحيطة');
  assert.deepEqual([tv.budget, tv.console, tv.wallMount], [30000, 'next_gen', 'wall']);
  const ac = read('ac', 'تكييف انفرتر لاوضة نوم 20 متر دور اخير بارد ساخن');
  assert.deepEqual([ac.inverterNeed, ac.heatNeed, ac.roomType, ac.room], ['inverter', 'cool_heat', 'bedroom', 'r24_hot']);
  assert.equal(read('ac', 'تكييف عادي مش انفرتر').inverterNeed, 'conventional');
  const f = read('fridge', 'تلاجة نو فروست احنا 5 افراد والكهربا بتقطع في حدود 35 الف');
  assert.deepEqual([f.budget, f.frost, f.power, f.household], [35000, 'no_frost', 'cuts', 'h6']);
});
