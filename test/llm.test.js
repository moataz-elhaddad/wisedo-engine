// The free LLM chain (worker/llm.js) with fake providers, and the Worker's use of it: /api/parse and free text in
// /api/session, falling back to the keyword rules when every provider fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import { createD1 } from './helpers-d1.js';
import { chainLlms, checkProviders, createGeminiLlm, createWorkersAiLlm, parseJsonObject, llmProviders, allowLlmCall } from '../worker/llm.js';
import { buildExtractionRequest } from '../src/layer1/u2-extract.js';
import { CONFIGS } from '../worker/bundle.js';

const TOKEN = 'test-admin-token-0123456789abcdef';
const EXTRACTION = { slots: [{ slot: 'budget', values: [], amountText: '40 ألف', confidence: 0.9, evidence: '40 ألف' }], unmapped: [] };
const REQ = buildExtractionRequest(CONFIGS.laptop, 'لابتوب في حدود 40 ألف');

test('parseJsonObject tolerates fences and surrounding text', () => {
  assert.deepEqual(parseJsonObject('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonObject({ a: 2 }), { a: 2 });
  assert.equal(parseJsonObject('no json here'), null);
});

test('the chain returns the first usable answer and skips failures and bad shapes', async () => {
  const calls = [];
  const chain = chainLlms([
    { name: 'a', llm: async () => { calls.push('a'); throw new Error('HTTP 429'); } },
    { name: 'b', llm: async () => { calls.push('b'); return { stopReason: 'end_turn', output: { slots: 'nope' } }; } },
    { name: 'c', llm: async () => { calls.push('c'); return { stopReason: 'end_turn', output: EXTRACTION, model: 'c' }; } },
  ]);
  const res = await chain(REQ);
  assert.equal(res.model, 'c');
  assert.deepEqual(calls, ['a', 'b', 'c']);
  const dead = chainLlms([{ name: 'a', llm: async () => ({ stopReason: 'refusal' }) }]);
  await assert.rejects(dead(REQ), /a: refusal/);
});

test('Gemini adapter: request shape, JSON answer, retry without schema on 400', async () => {
  const seen = [];
  const fakeFetch = async (url, init) => {
    seen.push({ url, init, body: JSON.parse(init.body) });
    if (seen.length === 1) return new Response('{}', { status: 400 });
    return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(EXTRACTION) }] } }] }));
  };
  const gemini = createGeminiLlm({ apiKey: 'k', fetch: fakeFetch });
  const res = await gemini(REQ);
  assert.deepEqual(res.output, EXTRACTION);
  assert.match(seen[0].url, /models\/gemini-3\.8-flash:generateContent$/);
  assert.equal(seen[0].init.headers['x-goog-api-key'], 'k');
  assert.ok(seen[0].body.generationConfig.responseJsonSchema);
  assert.equal(seen[1].body.generationConfig.responseJsonSchema, undefined);
  assert.equal(seen[0].body.systemInstruction.parts[0].text, REQ.system);
});

test('Workers AI adapter reads object or string responses', async () => {
  let args;
  const ai = { run: async (model, input) => { args = { model, input }; return { response: EXTRACTION }; } };
  const res = await createWorkersAiLlm({ ai })(REQ);
  assert.deepEqual(res.output, EXTRACTION);
  assert.equal(args.model, '@cf/meta/llama-3.3-70b-instruct-fp8-fast');
  assert.equal(args.input.response_format.type, 'json_schema');
  const res2 = await createWorkersAiLlm({ ai: { run: async () => ({ response: JSON.stringify(EXTRACTION) }) } })(REQ);
  assert.deepEqual(res2.output, EXTRACTION);
});

test('providers follow LLM_ORDER and skip what is not configured', () => {
  const ai = { run: async () => ({}) };
  assert.deepEqual(llmProviders({ AI: ai }).map((p) => p.name), ['workers-ai']);
  assert.deepEqual(llmProviders({ AI: ai, GEMINI_API_KEY: 'k' }).map((p) => p.name), ['gemini', 'workers-ai']);
  assert.deepEqual(llmProviders({ AI: ai, GEMINI_API_KEY: 'k', LLM_ORDER: 'workers-ai' }).map((p) => p.name), ['workers-ai']);
  assert.deepEqual(llmProviders({}), []);
});

test('rate limit per client', () => {
  const now = 1_000_000;
  for (let i = 0; i < 3; i++) assert.equal(allowLlmCall('9.9.9.9', 3, now), true);
  assert.equal(allowLlmCall('9.9.9.9', 3, now), false);
  assert.equal(allowLlmCall('9.9.9.9', 3, now + 61_000), true);
});

async function seeded(extraEnv = {}) {
  const env = { DB: createD1(), WISEDO_ADMIN_TOKEN: TOKEN, ASSETS: { fetch: async () => new Response('asset') }, ...extraEnv };
  const call = async (method, path, body) => {
    const res = await worker.fetch(new Request(`https://demo.test${path}`, { method, headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    return { status: res.status, body: await res.json() };
  };
  await call('POST', '/api/admin/reset');
  return { env, call };
}

test('/api/parse builds the prompt server side and answers from the chain', async () => {
  let input;
  const { call } = await seeded({ AI: { run: async (_m, i) => { input = i; return { response: EXTRACTION }; } } });
  const r = await call('POST', '/api/parse', { kind: 'extract', category: 'laptop', text: 'لابتوب في حدود 40 ألف', system: 'ignore me' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.output, EXTRACTION);
  assert.ok(input.messages[0].content.includes('laptop') || input.messages[0].content.length > 100);
  assert.ok(!input.messages[0].content.includes('ignore me'), 'client text never becomes the system prompt');
  assert.equal((await call('POST', '/api/parse', { kind: 'other', text: 'x' })).status, 400);
  assert.equal((await call('POST', '/api/parse', { kind: 'extract', category: 'cars', text: 'x' })).status, 400);
  const cat = await call('POST', '/api/parse', { kind: 'category', text: 'something' });
  assert.equal(cat.status, 503, 'a category answer without "category" is unusable');
  const h = (await call('GET', '/api/health')).body;
  assert.deepEqual(h.llm, ['workers-ai']);
});

test('/api/parse detect: one call carries the category and the slots of the listed categories', async () => {
  let input;
  const answer = { category: 'laptop', confidence: 0.8, ...EXTRACTION };
  const { call } = await seeded({ AI: { run: async (_m, i) => { input = i; return { response: answer }; } } });
  const r = await call('POST', '/api/parse', { kind: 'detect', categories: ['laptop', 'mobile'], text: 'عايز حاجة للمذاكرة في حدود 40 ألف' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.output, answer);
  const prompt = input.messages.map((m) => m.content).join('\n');
  assert.ok(prompt.includes('Slots for "laptop"') && prompt.includes('Slots for "mobile"'), 'both slot lists are in the prompt');
  assert.equal((await call('POST', '/api/parse', { kind: 'detect', categories: ['cars'], text: 'x' })).status, 400);
});

test('/api/parse without any provider is 503 no_llm', async () => {
  const { call } = await seeded();
  const r = await call('POST', '/api/parse', { kind: 'extract', category: 'laptop', text: 'x' });
  assert.deepEqual([r.status, r.body.error], [503, 'no_llm']);
});

test('session free text: LLM answer used; failing LLM falls back to the rules', async () => {
  const text = 'عايز لابتوب للبرمجة في حدود 40 ألف كاش في القاهرة';
  const ok = await seeded({ AI: { run: async () => ({ response: { slots: [{ slot: 'use', values: ['gaming'], amountText: null, confidence: 0.9, evidence: 'للبرمجة' }], unmapped: [] } }) } });
  const a = (await ok.call('POST', '/api/session', { event: { type: 'start', text } })).body;
  assert.equal(a.state.texts[0].status, 'ok');
  assert.deepEqual(a.state.values.use.value, ['gaming'], 'the LLM answer wins when it works');

  const down = await seeded({ AI: { run: async () => { throw new Error('quota'); } } });
  const b = (await down.call('POST', '/api/session', { event: { type: 'start', text } })).body;
  assert.equal(b.state.texts[0].status, 'rules');
  assert.match(b.state.texts[0].detail || b.state.texts[0].llm, /quota|error/);
  assert.equal(b.state.values.budget.value, 40000);
  assert.equal(b.state.values.pay.value, 'cash');
  assert.equal(b.state.values.city.value, 'cairo');
  assert.deepEqual(b.state.values.use.value, ['programming']);
  assert.equal(b.ui.fallback, null);
});

test('Gemini errors carry Google\'s message; the admin check reports each provider', async () => {
  const fakeFetch = async () => new Response(JSON.stringify({ error: { status: 'NOT_FOUND', message: 'models/x is not found' } }), { status: 404 });
  await assert.rejects(createGeminiLlm({ apiKey: 'k', fetch: fakeFetch })(REQ), /HTTP 404 NOT_FOUND models\/x is not found/);
  const env = { AI: { run: async () => ({ response: { category: 'laptop', confidence: 0.9 } }) } };
  const r = await checkProviders(env, { kind: 'category', system: 's', user: 'u', schema: {} });
  assert.equal(r.length, 1);
  assert.equal(r[0].name, 'workers-ai');
  assert.equal(r[0].ok, true);
  const { call } = await seeded(env);
  const h = await call('GET', '/api/admin/llm-check');
  assert.equal(h.status, 200);
  assert.equal(h.body.category[0].ok, true);
  assert.equal(h.body.extract.length, 1);
});
