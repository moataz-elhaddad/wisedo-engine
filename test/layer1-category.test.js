// Layer 1, U1 category detector and U2 extractor plumbing: rules first, the LLM only when unclear; honest answers
// for categories that are known but not configured, and for products Wisedo does not cover; the LLM call's
// timeout, refusal and invalid-output handling; the extraction schema built from the config.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectCategory, detectByRules, step, configuredCategories, buildExtractionSchema, buildExtractionRequest, callLlm, createMockLlm, recording, DEFAULT_TIMEOUT_MS } from '../src/layer1/index.js';
import { mobileConfig, SNAPSHOT, NOW, ROOT_DIR } from './helpers.js';
import { identityFor } from '../src/layer1/session.js';

const CONFIGURED = ['mobile'];
const products = { mobile: identityFor(SNAPSHOT, 'mobile').products };

test('layer1 U1: mobile is detected by rules from Arabic, English and model names', async () => {
  for (const text of ['عايز موبايل كويس', 'محتاج تليفون جديد', 'I need a new phone', 'عايز ايفون 15', 'Galaxy A56 ولا Redmi Note 14؟']) {
    const d = await detectCategory(text, { configured: CONFIGURED, productsByCategory: products });
    assert.equal(d.status, 'configured', text);
    assert.equal(d.category, 'mobile', text);
    assert.equal(d.by, 'rules', text);
  }
});

test('layer1 U1: laptop, TV, AC and fridge are detected and answered honestly as not configured yet', async () => {
  const cases = [
    ['عايز لابتوب للمذاكرة', 'laptop'], ['I want a laptop for work', 'laptop'],
    ['شاشة 55 بوصة', 'tv'], ['looking for a smart TV', 'tv'],
    ['تكييف 1.5 حصان', 'ac'], ['need an air conditioner', 'ac'],
    ['تلاجة نوفروست', 'fridge'], ['a new fridge', 'fridge'],
  ];
  for (const [text, cat] of cases) {
    const d = await detectCategory(text, { configured: CONFIGURED, productsByCategory: products });
    assert.equal(d.category, cat, text);
    assert.equal(d.status, 'not_configured', text);
    const { ui, state } = await step(null, { type: 'start', text }, { snapshot: SNAPSHOT, now: NOW });
    assert.equal(ui.screen, 'not_configured', text);
    assert.equal(state.phase, 'unsupported');
    assert.match(ui.message.en, /isn't set up/);
    assert.match(ui.message.en, /phones/);
    assert.ok(ui.message.ar.length > 0);
    assert.deepEqual(ui.tiles.filter((t) => t.configured).map((t) => t.id), ['mobile']);
    assert.equal(ui.tiles.length, 5);
  }
});

test('layer1 U1: a product outside the five categories gets an honest "not covered" answer', async () => {
  const { ui } = await step(null, { type: 'start', text: 'عايز غسالة اوتوماتيك' }, { snapshot: SNAPSHOT, now: NOW });
  assert.equal(ui.screen, 'unsupported');
  assert.match(ui.message.en, /doesn't cover washing machines/);
  assert.deepEqual(ui.tiles.filter((t) => t.configured).map((t) => t.id), ['mobile']);
});

test('layer1 U1: a category tile for an unconfigured category gets the same honest answer', async () => {
  const { ui } = await step(null, { type: 'start', tile: 'fridge' }, { snapshot: SNAPSHOT, now: NOW });
  assert.equal(ui.screen, 'not_configured');
  assert.match(ui.message.en, /fridges/);
});

test('layer1 U1: the LLM is called only when the rules are unclear', async () => {
  const llm = createMockLlm([recording('محتاج حاجة أكلم بيها ماما', { category: 'mobile', confidence: 0.8 }, { kind: 'category' })]);
  const clear = await detectCategory('عايز موبايل', { configured: CONFIGURED, productsByCategory: products, llm });
  assert.equal(clear.by, 'rules');
  assert.equal(llm.calls.length, 0);
  const unclear = await detectCategory('محتاج حاجة أكلم بيها ماما', { configured: CONFIGURED, productsByCategory: products, llm });
  assert.equal(llm.calls.length, 1);
  assert.equal(unclear.by, 'llm');
  assert.equal(unclear.category, 'mobile');
  const none = await detectCategory('ازيك', { configured: CONFIGURED, productsByCategory: products });
  assert.equal(none.status, 'unclear');
  assert.equal(detectByRules('موبايل ولابتوب').category, null, 'two categories at once is unclear');
});

test('layer1 U1: unclear text shows the category tiles', async () => {
  const { ui } = await step(null, { type: 'start', text: 'ازيك عامل ايه' }, { snapshot: SNAPSHOT, now: NOW });
  assert.equal(ui.screen, 'tiles');
  assert.equal(ui.tiles.length, 5);
  assert.deepEqual(configuredCategories(SNAPSHOT), ['mobile']);
});

test('layer1 U2: the schema is built from the config slots, strict and without numeric limits', () => {
  const schema = buildExtractionSchema(mobileConfig);
  assert.deepEqual(schema.properties.slots.items.properties.slot.enum, mobileConfig.slots.map((s) => s.id));
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'object') {
      assert.equal(node.additionalProperties, false);
      assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort());
    }
    for (const k of ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength']) assert.ok(!(k in node), k);
    for (const v of Object.values(node)) if (typeof v === 'object') walk(v);
  };
  walk(schema);
  const req = buildExtractionRequest(mobileConfig, 'عايز موبايل', { retailers: identityFor(SNAPSHOT, 'mobile').retailers });
  assert.equal(req.kind, 'extract');
  assert.equal(req.category, 'mobile');
  assert.ok(req.user.includes('عايز موبايل'));
  for (const s of mobileConfig.slots) assert.ok(req.system.includes(s.id), s.id);
});

test('layer1 U2: timeout (default 3 s), refusal, truncation, thrown errors and invalid output never throw', async () => {
  assert.equal(DEFAULT_TIMEOUT_MS, 3000);
  const req = { kind: 'extract', category: 'mobile', text: 'x', system: '', user: 'x', schema: {} };
  const llm = createMockLlm([
    recording('t', { $timeout: true }), recording('r', { $refusal: 'cyber' }), recording('m', { $truncated: true }),
    recording('e', { $error: 'boom' }), recording('j', { $raw: 'not json' }), recording('ok', { slots: [], unmapped: [] }),
  ]);
  const call = (text, ms = 50) => callLlm(llm, { ...req, text }, ms);
  assert.deepEqual(await call('t'), { ok: false, error: 'timeout' });
  assert.equal((await call('r')).error, 'refusal');
  assert.equal((await call('m')).error, 'truncated');
  assert.equal((await call('e')).error, 'error');
  assert.equal((await call('j')).error, 'invalid');
  assert.equal((await call('missing')).error, 'error');
  assert.equal((await call('ok')).ok, true);
});

test('layer1 anthropic adapter: settings match the decision (static check; never run here)', () => {
  const src = readFileSync(join(ROOT_DIR, 'src/layer1/llm/anthropic.js'), 'utf8');
  const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.match(src, /UNVERIFIED/);
  assert.match(code, /'claude-sonnet-5-5'/);
  assert.match(code, /output_config: \{ effort, format: \{ type: 'json_schema', schema: request\.schema \} \}/);
  assert.match(code, /await import\('@anthropic-ai\/sdk'\)/);
  assert.match(code, /stop_reason === 'refusal'/);
  for (const banned of ['temperature', 'top_p', 'top_k', 'tool_choice', "role: 'assistant'", 'budget_tokens', 'console.']) assert.ok(!code.includes(banned), banned);
  // The key is read once, inside the returned call function (after `return async function`).
  const fnStart = code.indexOf('return async function');
  const envAt = code.indexOf('process.env');
  assert.ok(fnStart > 0 && envAt > fnStart, 'process.env is read only inside the call function');
  assert.equal(code.split('process.env').length, 2);
});
