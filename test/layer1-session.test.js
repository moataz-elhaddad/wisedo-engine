// Layer 1 session (state machine) with the recorded-response LLM: pre-fill threshold, locked edits, skip,
// "Not used" chips, "Add a detail", city assumed, manual slots never asked, consistency questions, LLM failure
// fallbacks, low-confidence tiles, show-now, the cap, and JSON round-trips of the state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { step, createMockLlm, recording, PREFILL_THRESHOLD, MAX_QUESTIONS, stopBeforePlanning, emptyState } from '../src/layer1/index.js';
import { mobileConfig, SNAPSHOT, NOW } from './helpers.js';

const MANUAL = mobileConfig.slots.filter((s) => s.manual).map((s) => s.id);

/** A scripted extraction item. */
const item = (slot, values, evidence, o = {}) => ({ slot, values, amountText: o.amountText ?? null, confidence: o.confidence ?? 0.9, evidence });

/** Context with a mock LLM holding one extraction for `text`. */
function ctxFor(text, slots, unmapped = [], extra = {}) {
  const recs = [recording(text, { slots, unmapped }), ...(extra.recordings || [])];
  return { snapshot: SNAPSHOT, now: NOW, llm: createMockLlm(recs), ...extra.ctx };
}

/** Answer from `answers` when the question's slot is there, skip otherwise; clarifying questions keep. */
async function runToResult(state, ui, ctx, answers = {}, log = []) {
  let guard = 0;
  while ((ui.screen === 'question' || ui.screen === 'clarify') && guard++ < 30) {
    if (ui.screen === 'clarify') { log.push('?' + ui.clarify.id); ({ state, ui } = await step(state, { type: 'answer', option: 'keep' }, ctx)); continue; }
    log.push(ui.question.slot);
    const ev = ui.question.slot in answers ? { type: 'answer', value: answers[ui.question.slot] } : { type: 'skip' };
    ({ state, ui } = await step(state, ev, ctx));
  }
  return { state, ui, log };
}

const BASE_TEXT = 'عايز موبايل للتصوير، ميزانيتي 15 ألف كاش';
const BASE_SLOTS = [
  item('use', ['photo'], 'للتصوير'),
  item('pay', ['cash'], 'كاش'),
  item('budget', [], 'ميزانيتي 15 ألف', { amountText: '15 ألف' }),
];

test('layer1 U4: confidence >= 0.7 becomes a chip, not a question; below 0.7 stays open and is asked', async () => {
  assert.equal(PREFILL_THRESHOLD, 0.7);
  const text = 'عايز موبايل للتصوير، يمكن كاش، ميزانيتي 15 ألف';
  const ctx = ctxFor(text, [
    item('use', ['photo'], 'للتصوير', { confidence: 0.7 }),
    item('pay', ['cash'], 'يمكن كاش', { confidence: 0.69 }),
    item('budget', [], 'ميزانيتي 15 ألف', { amountText: '15 ألف', confidence: 0.9 }),
  ]);
  const { state, ui } = await step(null, { type: 'start', text }, ctx);
  const chip = (slot) => ui.chips.find((c) => c.slot === slot && c.kind === 'value');
  assert.equal(chip('use').source, 'text');
  assert.equal(chip('use').evidence, 'للتصوير');
  assert.equal(chip('pay'), undefined);
  assert.deepEqual(ui.suggestions.map((x) => [x.slot, x.value]), [['pay', 'cash']]);
  const { log } = await runToResult(state, ui, ctx);
  assert.ok(!log.includes('use'), 'a pre-filled slot is not asked');
  assert.ok(log.includes('pay'), 'a low-confidence slot is asked');
});

test('layer1 U4: a buyer edit locks the value; a new extraction does not overwrite it', async () => {
  const more = 'لا خليها 10 آلاف وبحب الألعاب';
  const ctx = ctxFor(BASE_TEXT, BASE_SLOTS, [], {
    recordings: [recording(more, { slots: [item('budget', [], 'خليها 10 آلاف', { amountText: '10 آلاف', confidence: 0.99 }), item('use', ['gaming'], 'بحب الألعاب')], unmapped: [] })],
  });
  let { state } = await step(null, { type: 'start', text: BASE_TEXT }, ctx);
  ({ state } = await step(state, { type: 'edit', slot: 'budget', value: 20000 }, ctx));
  assert.deepEqual([state.values.budget.value, state.values.budget.locked, state.values.budget.source], [20000, true, 'edit']);
  let ui;
  ({ state, ui } = await step(state, { type: 'addText', text: more }, ctx));
  assert.equal(state.values.budget.value, 20000, 'the edit beats the LLM');
  assert.deepEqual(state.values.use.value, ['gaming'], 'an unlocked text value is updated by newer text');
  assert.equal(ui.chips.find((c) => c.slot === 'budget').valueLabel.en, '20,000 EGP');
  // Clearing a value (edit to null) also locks it: the LLM cannot refill it.
  ({ state } = await step(state, { type: 'edit', slot: 'use', value: null }, ctx));
  ({ state } = await step(state, { type: 'addText', text: more }, ctx));
  assert.equal(state.values.use.value, null);
});

test('layer1 U8/U9: skip applies the slot default, shown as assumed', async () => {
  const ctx = ctxFor(BASE_TEXT, BASE_SLOTS);
  let { state, ui } = await step(null, { type: 'start', text: BASE_TEXT }, ctx);
  assert.equal(ui.screen, 'question');
  const slot = ui.question.slot;
  const def = mobileConfig.slots.find((s) => s.id === slot).default;
  assert.deepEqual(ui.question.skip.means, def ?? null);
  ({ state, ui } = await step(state, { type: 'skip' }, ctx));
  assert.ok(state.skipped.includes(slot));
  ({ ui } = await step(state, { type: 'showNow' }, ctx));
  const need = ui.profile.needs.find((n) => n.slot === slot);
  if (def !== undefined && def !== null) {
    assert.deepEqual(need.value, def);
    assert.equal(need.source, 'default');
    assert.ok(ui.chips.some((c) => c.slot === slot && c.kind === 'assumed' && c.assumed));
  }
});

test('layer1 U2/U4: unmapped items become "Not used" chips with their reason', async () => {
  const text = 'عايز موبايل لونه أزرق وهبدل القديم، مش عايز مستعمل، أخويا قالي خد سامسونج';
  const ctx = ctxFor(text, [], [
    { text: 'لونه أزرق', factor: 'look_colour' },
    { text: 'هبدل القديم', factor: 'trade_in' },
    { text: 'مش عايز مستعمل', factor: 'fakes_used' },
    { text: 'أخويا قالي خد سامسونج', factor: 'family_opinion' },
  ]);
  const { ui } = await step(null, { type: 'start', text }, ctx);
  assert.deepEqual(ui.notUsed.map((c) => [c.text, c.reason, c.reasonLabel.en]), [
    ['لونه أزرق', 'no_data', 'No data yet'],
    ['هبدل القديم', 'not_supported', 'Not supported yet'],
    ['مش عايز مستعمل', 'not_supported', 'Not supported yet'],
    ['أخويا قالي خد سامسونج', 'not_supported', 'Not supported yet'],
  ]);
  assert.ok(ui.notUsed.every((c) => c.kind === 'not_used' && c.editable === false));
  // They reach the Need Profile as unmapped, and never as needs.
  const { ui: res } = await step((await step(null, { type: 'start', text }, ctx)).state, { type: 'showNow' }, ctx);
  assert.equal(res.profile.unmapped.length, 4);
});

test('layer1 "Add a detail" lists every slot, including the never-asked ones', async () => {
  const ctx = ctxFor(BASE_TEXT, BASE_SLOTS);
  const { state } = await step(null, { type: 'start', text: BASE_TEXT }, ctx);
  const { ui } = await step(state, { type: 'addDetail' }, ctx);
  assert.equal(ui.screen, 'add_detail');
  assert.deepEqual(ui.addDetail.slots.map((s) => s.slot), mobileConfig.slots.map((s) => s.id));
  for (const id of MANUAL) assert.equal(ui.addDetail.slots.find((s) => s.slot === id).neverAsked, true, id);
  assert.ok(ui.addDetail.slots.find((s) => s.slot === 'shops').options.length === SNAPSHOT.retailers.length);
  assert.equal(ui.addDetail.slots.find((s) => s.slot === 'budget').value, 15000);
  // Setting a detail there is an edit: cash on delivery becomes a must.
  const { state: s2 } = await step(state, { type: 'edit', slot: 'cod', value: 'must' }, ctx);
  assert.equal(s2.values.cod.value, 'must');
  assert.equal(s2.values.cod.locked, true);
});

test('layer1 city: unknown city is shown as "Nationwide (assumed)"', async () => {
  const ctx = ctxFor(BASE_TEXT, BASE_SLOTS);
  const { ui } = await step(null, { type: 'start', text: BASE_TEXT }, ctx);
  const city = ui.chips.find((c) => c.slot === 'city');
  assert.deepEqual([city.kind, city.assumed, city.valueLabel.en], ['assumed', true, 'Nationwide (assumed)']);
});

test('layer1 cod and shops are never asked (any persona, any flow)', async () => {
  const ctx = { snapshot: SNAPSHOT, now: NOW };
  for (const policy of [undefined, { minGain: 1, materialPoints: 0 }]) {
    const c = { ...ctx, policy };
    const { state, ui } = await step(null, { type: 'start', tile: 'mobile' }, c);
    const { log } = await runToResult(state, ui, c, { who: 'me', use: ['social'], pay: 'cash', budget: 25000 });
    for (const id of MANUAL) assert.ok(!log.includes(id), `${id} was asked`);
    assert.ok(!log.includes('brandAvoid') && !log.includes('cod') && !log.includes('shops'));
  }
});

test('layer1 U6: a contradiction becomes one clarifying question with ways out', async () => {
  const text = 'عايز موبايل، بحب سامسونج بس مش عايز سامسونج، ميزانيتي 20 ألف كاش';
  const ctx = ctxFor(text, [
    item('brand', ['samsung'], 'بحب سامسونج'),
    item('brandAvoid', ['samsung'], 'مش عايز سامسونج'),
    item('pay', ['cash'], 'كاش'),
    item('budget', [], 'ميزانيتي 20 ألف', { amountText: '20 ألف' }),
  ]);
  let { state, ui } = await step(null, { type: 'start', text }, ctx);
  assert.equal(ui.screen, 'clarify');
  assert.equal(ui.clarify.id, 'brand_conflict:samsung');
  assert.equal(ui.clarify.type, 'contradiction');
  assert.ok(ui.clarify.options.length >= 2);
  const like = ui.clarify.options.find((o) => /like/i.test(o.label.en) || /keep/i.test(o.id));
  ({ state, ui } = await step(state, { type: 'answer', option: ui.clarify.options[0].id }, ctx));
  assert.notEqual(ui.screen, 'clarify', 'asked once');
  assert.ok(like);
});

test('layer1 U6: an expectation gap (iPhone only, 8,000 EGP) is a blocking clarifying question', async () => {
  const text = 'عايز ايفون بس، ميزانيتي 8 آلاف كاش';
  const ctx = ctxFor(text, [
    item('os', ['ios'], 'ايفون بس'),
    item('pay', ['cash'], 'كاش'),
    item('budget', [], 'ميزانيتي 8 آلاف', { amountText: '8 آلاف' }),
  ]);
  let { state, ui } = await step(null, { type: 'start', text }, ctx);
  assert.equal(ui.screen, 'clarify');
  assert.equal(ui.clarify.id, 'budget_gap');
  assert.equal(ui.clarify.type, 'expectation_gap');
  const ids = ui.clarify.options.map((o) => o.id);
  assert.ok(ids.includes('raise') && ids.includes('keep') && ids.some((x) => x.startsWith('relax:')), ids.join());
  // "Raise the budget" re-opens the budget question.
  ({ state, ui } = await step(state, { type: 'answer', option: 'raise' }, ctx));
  assert.equal(ui.screen, 'question');
  assert.equal(ui.question.slot, 'budget');
  // Relaxing instead drops the iPhone-only need.
  let r = await step(null, { type: 'start', text }, ctx);
  r = await step(r.state, { type: 'answer', option: r.ui.clarify.options.find((o) => o.id.startsWith('relax:')).id }, ctx);
  assert.notEqual(r.state.values.os.value, 'ios');
});

test('layer1 LLM failure (timeout, refusal, invalid output, error) falls back to the full question flow', async () => {
  for (const response of [{ $timeout: true }, { $refusal: 'other' }, { $raw: 'sorry, here is some prose' }, { $error: 'network down' }, { slots: 'nope' }]) {
    const ctx = { snapshot: SNAPSHOT, now: NOW, llm: createMockLlm([recording(BASE_TEXT, response)]), llmTimeoutMs: 30 };
    const { state, ui } = await step(null, { type: 'start', text: BASE_TEXT }, ctx);
    assert.equal(ui.screen, 'question', JSON.stringify(response));
    assert.equal(ui.question.slot, 'who', 'the full flow starts with the first always question');
    assert.equal(ui.fallback.fullFlow, true);
    assert.ok(ui.fallback.reason);
    assert.deepEqual(Object.keys(state.values), []);
    assert.equal(ui.category, 'mobile', 'the category still came from the rules');
  }
  // No adapter at all (e.g. no key in a dev environment) behaves the same way.
  const { ui } = await step(null, { type: 'start', text: BASE_TEXT }, { snapshot: SNAPSHOT, now: NOW });
  assert.deepEqual([ui.screen, ui.question.slot, ui.fallback.reason], ['question', 'who', 'no_llm']);
});

test('layer1 LLM failure on later text keeps the session and says the text was not read', async () => {
  const ctx = ctxFor(BASE_TEXT, BASE_SLOTS, [], { recordings: [recording('وكمان عايزه خفيف', { $timeout: true })], ctx: { llmTimeoutMs: 30 } });
  const { state } = await step(null, { type: 'start', text: BASE_TEXT }, ctx);
  const r = await step(state, { type: 'addText', text: 'وكمان عايزه خفيف' }, ctx);
  assert.equal(r.ui.textNotRead.reason, 'timeout');
  assert.equal(r.state.values.budget.value, 15000);
  assert.notEqual(r.ui.screen, 'error');
});

test('layer1 low confidence on everything shows the category tiles', async () => {
  const text = 'عايز موبايل يمكن للتصوير يمكن كاش';
  const ctx = ctxFor(text, [item('use', ['photo'], 'يمكن للتصوير', { confidence: 0.4 }), item('pay', ['cash'], 'يمكن كاش', { confidence: 0.5 })]);
  const { ui } = await step(null, { type: 'start', text }, ctx);
  assert.equal(ui.screen, 'tiles');
  assert.equal(ui.reason, 'low_confidence');
  assert.ok(ui.tiles.some((t) => t.id === 'mobile' && t.configured));
  // An unclear category guessed by the LLM below 0.7 shows the tiles too.
  const guess = 'عايز حاجة جديدة';
  const ctx2 = { snapshot: SNAPSHOT, now: NOW, llm: createMockLlm([recording(guess, { category: 'mobile', confidence: 0.5 }, { kind: 'category' })]) };
  assert.equal((await step(null, { type: 'start', text: guess }, ctx2)).ui.screen, 'tiles');
});

test('layer1 "show results now" stops and ranks; the profile says what was left open', async () => {
  const ctx = ctxFor(BASE_TEXT, BASE_SLOTS);
  const { state } = await step(null, { type: 'start', text: BASE_TEXT }, ctx);
  const { ui, state: s2 } = await step(state, { type: 'showNow' }, ctx);
  assert.equal(ui.screen, 'result');
  assert.equal(ui.stopReason, 'show_now');
  assert.equal(ui.result.mode, 'rank');
  assert.ok(ui.result.picks.length > 0);
  assert.equal(ui.profile.status, 'good_enough');
  assert.ok(ui.profile.open.length > 0);
  assert.equal(s2.phase, 'done');
  // The `result` event on a finished session gives the same result again.
  const again = await step(s2, { type: 'result' }, ctx);
  assert.deepEqual(again.ui.result.picks.map((p) => p.product.id), ui.result.picks.map((p) => p.product.id));
});

test('layer1 U9: the question cap stops the flow and ranks', async () => {
  assert.equal(MAX_QUESTIONS, 8);
  const ctx = { snapshot: SNAPSHOT, now: NOW, maxQuestions: 2 };
  let { state, ui } = await step(null, { type: 'start', tile: 'mobile' }, ctx);
  ({ state, ui } = await step(state, { type: 'skip' }, ctx));
  ({ state, ui } = await step(state, { type: 'skip' }, ctx));
  assert.equal(ui.screen, 'result');
  assert.equal(ui.stopReason, 'cap');
  assert.equal(ui.questionsAsked, 2);
  const s = emptyState();
  s.asked = Array.from({ length: 8 }, (_, i) => ({ kind: 'slot', id: 'x' + i, outcome: i % 2 ? 'answered' : 'skipped' }));
  assert.deepEqual(stopBeforePlanning(s), { reason: 'cap' });
  s.asked[0].outcome = 'superseded';
  assert.equal(stopBeforePlanning(s), null, 'superseded questions were never answered and do not count');
});

test('layer1 session state round-trips through JSON at every step and gives the same result', async () => {
  const ctx = ctxFor(BASE_TEXT, BASE_SLOTS, [{ text: 'لونه أزرق', factor: 'look_colour' }]);
  const answers = { who: 'me', photoType: ['night'] };
  const events = [];
  let a = await step(null, { type: 'start', text: BASE_TEXT }, ctx);
  let b = { state: JSON.parse(JSON.stringify(a.state)), ui: a.ui };
  let guard = 0;
  while (a.ui.screen === 'question' && guard++ < 20) {
    const ev = a.ui.question.slot in answers ? { type: 'answer', value: answers[a.ui.question.slot] } : { type: 'skip' };
    events.push(ev);
    a = await step(a.state, ev, ctx);
    b = await step(JSON.parse(JSON.stringify(b.state)), ev, ctx);
    assert.deepEqual(JSON.parse(JSON.stringify(a.state)), a.state, 'state is plain JSON');
    assert.deepEqual(b.state, a.state);
  }
  assert.equal(a.ui.screen, 'result');
  assert.deepEqual(b.ui.result.picks.map((p) => p.product.id), a.ui.result.picks.map((p) => p.product.id));
  assert.deepEqual(b.ui.profile, a.ui.profile);
});
