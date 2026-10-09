// Layer 1 end to end on the 18 synthetic personas: a scripted mock extraction of each persona's words, plus
// answers to whatever the planner asks, must reach the persona's expected Need Profile; rank mode must return
// picks; and the number of questions must stay within the cap (8) with a median of 3 or fewer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { step, createMockLlm, recording, resolveProductId, identityFor, LITERAL_POLICY, MAX_QUESTIONS } from '../src/layer1/index.js';
import { mobileConfig, SNAPSHOT, NOW, profile } from './helpers.js';
import { PERSONAS } from './personas.js';

const slotById = new Map(mobileConfig.slots.map((s) => [s.id, s]));
const retailerName = Object.fromEntries(SNAPSHOT.retailers.map((r) => [r.id, r.name]));
const PRODUCTS = identityFor(SNAPSHOT, 'mobile').products;

/** The buyer's words for one answer, and the extraction item a parser should return for them. */
function phrase(slot, v) {
  if (slot === 'budget') return { text: `ميزانيتي ${v / 1000} ألف`, amountText: `${v / 1000} ألف` };
  if (slot === 'monthlyCap') return { text: `أقدر ${v} في الشهر`, amountText: `${v} في الشهر` };
  if (slot === 'down') return { text: `ومعايا مقدم ${v}`, amountText: `مقدم ${v}` };
  if (slot === 'shops') {
    const values = [...(v.prefer || []).map((x) => `prefer:${retailerName[x]}`), ...(v.avoid || []).map((x) => `avoid:${retailerName[x]}`)];
    return { text: values.join(' و '), values };
  }
  if (slot === 'modelInMind') return { text: `في بالي ${v}`, values: [v] };
  const ids = Array.isArray(v) ? v : [v];
  return { text: ids.map((id) => slotById.get(slot).options.find((o) => o.id === id).label.ar).join(' و '), values: ids };
}

/** The persona's free text and the recorded extraction for it (confidence 0.9, evidence quoted). */
function scripted(answers, over) {
  const all = { ...answers, ...(over.modelInMind ? { modelInMind: over.modelInMind } : {}) };
  const parts = ['عايز موبايل'];
  const slots = [];
  for (const [slot, v] of Object.entries(all)) {
    const p = phrase(slot, v);
    parts.push(p.text);
    slots.push({ slot, values: p.values || [], amountText: p.amountText ?? null, confidence: 0.9, evidence: p.text });
  }
  return { text: parts.join('، '), slots, all };
}

/** Run one persona; returns the final UI, the number of questions and the asked slots. */
async function runPersona(answers, over, policy) {
  const { text, slots, all } = scripted(answers, over);
  const ctx = { snapshot: SNAPSHOT, now: NOW, llm: createMockLlm([recording(text, { slots, unmapped: [] })]), policy };
  let { state, ui } = await step(null, { type: 'start', text }, ctx);
  const asked = [];
  let guard = 0;
  while ((ui.screen === 'question' || ui.screen === 'clarify') && guard++ < 30) {
    if (ui.screen === 'clarify') { asked.push('?' + ui.clarify.id); ({ state, ui } = await step(state, { type: 'answer', option: 'keep' }, ctx)); continue; }
    asked.push(ui.question.slot);
    const slot = ui.question.slot;
    ({ state, ui } = await step(state, slot in all ? { type: 'answer', value: all[slot] } : { type: 'skip' }, ctx));
  }
  return { ui, state, asked, questions: ui.questionsAsked };
}

/** The parts of a Need Profile that decide the result. */
function core(p) {
  const needs = Object.fromEntries(p.needs.map((n) => [n.slot, n.value]).sort((a, b) => (a[0] < b[0] ? -1 : 1)));
  const prefer = [...p.prefer].map(({ order, ...rest }) => rest).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const sortJ = (list) => [...list].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return { needs, weights: p.weights, must: sortJ(p.must), prefer, bonus: sortJ(p.bonus), money: p.money, logistics: p.logistics, shops: p.shops, derived: p.derived, modelInMind: p.modelInMind ?? null };
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

const counts = [];

for (const [title, answers, over] of PERSONAS) {
  test(`layer1 e2e persona: ${title}`, async () => {
    const { ui, questions, asked } = await runPersona(answers, over);
    counts.push(questions);
    assert.equal(ui.screen, 'result', `${title}: ${ui.error || ''}`);
    // The persona's expected profile; a model name in mind is matched to its catalog id when there is one.
    const model = over.modelInMind ? (resolveProductId(over.modelInMind, PRODUCTS) || over.modelInMind) : undefined;
    // The persona file sets it on the profile directly; Layer 1 sets it through the modelInMind slot (same field).
    const { modelInMind: _raw, ...rest } = over;
    // A skipped payment way is taken as cash (and the budget is still asked).
    const stated = !('pay' in answers) && asked.includes('pay') ? { ...answers, pay: 'cash' } : answers;
    const expected = profile(model ? { ...stated, modelInMind: model } : stated, rest);
    assert.equal(expected.modelInMind ?? null, model ?? null);
    assert.deepEqual(core(ui.profile), core(expected), `${title}: asked ${asked.join(', ')}`);
    assert.ok(questions <= MAX_QUESTIONS);
    // Rank mode returns picks (or, for the persona built to fit nothing, says so with the closest phones).
    assert.equal(ui.result.mode, 'rank');
    if (ui.result.status === 'ok') assert.ok(ui.result.picks.length > 0, title);
    else assert.ok(ui.result.nothingFits, `${title}: ${ui.result.status}`);
  });
}

test('layer1 personas: model names in mind resolve to catalog ids', () => {
  assert.equal(resolveProductId('Galaxy A56', PRODUCTS), 'samsung-a56');
  assert.equal(resolveProductId('iphone 15', PRODUCTS), 'apple-iphone-15');
  assert.equal(resolveProductId('samsung-a16', PRODUCTS), 'samsung-a16');
});

test('layer1 personas: at most 8 questions and a median of 3 or fewer (default policy)', (t) => {
  assert.equal(counts.length, PERSONAS.length, 'every persona ran');
  const sorted = [...counts].sort((a, b) => a - b);
  t.diagnostic(`questions per persona (sorted): ${sorted.join(',')}; median ${median(counts)}; max ${sorted.at(-1)}`);
  assert.ok(sorted.at(-1) <= 8, `max ${sorted.at(-1)}`);
  assert.ok(median(counts) <= 3, `median ${median(counts)}`);
});

test('layer1 personas: the literal spec policy also stays within the cap of 8 (median reported)', async (t) => {
  const lit = [];
  for (const [, answers, over] of PERSONAS) lit.push((await runPersona(answers, over, LITERAL_POLICY)).questions);
  const sorted = [...lit].sort((a, b) => a - b);
  t.diagnostic(`literal policy (gain >= 1, every flip counts): ${sorted.join(',')}; median ${median(lit)}; max ${sorted.at(-1)}`);
  assert.ok(sorted.at(-1) <= 8);
});
