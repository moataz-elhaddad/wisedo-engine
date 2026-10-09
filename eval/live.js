// Live LLM check: sends each phrase of a phrase file to a deployed demo Worker's /api/parse and scores the answers
// with the same U3 normaliser the session uses. Also scores the keyword rules on the same phrases as a baseline.
//
//   node eval/live.js <phrases.jsonl> <worker base URL> [--delay-ms 3500]
//
// Per phrase: one category call ("detect", or "category" on a Worker deployed before detect existed) and one
// extraction call for the phrase's own category. The Worker allows 20 LLM calls a minute per caller, so calls are
// spaced out. Prints a JSON summary, then one line per phrase. Reads the network; not part of the test suite.
import { readFileSync } from 'node:fs';
import { normalizeExtraction } from '../src/layer1/u3-normalize.js';
import { extractByRules } from '../src/layer1/u2-rules.js';
import { detectByRules } from '../src/layer1/u1-category.js';
import { CONFIGS } from '../worker/bundle.js';

const [file, base] = process.argv.slice(2);
const delayIdx = process.argv.indexOf('--delay-ms');
const DELAY = delayIdx > 0 ? Number(process.argv[delayIdx + 1]) : 3500;
if (!file || !base) { console.error('usage: node eval/live.js <phrases.jsonl> <worker base URL> [--delay-ms N]'); process.exit(2); }

const rows = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const same = (a, b) => JSON.stringify(Array.isArray(a) ? [...a].sort() : a) === JSON.stringify(Array.isArray(b) ? [...b].sort() : b);

async function parse(body) {
  const t0 = Date.now();
  try {
    const res = await fetch(new URL('api/parse', base.endsWith('/') ? base : base + '/'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
    const out = await res.json().catch(() => null);
    return { status: res.status, ok: res.ok && out && out.ok, out, ms: Date.now() - t0 };
  } catch (e) {
    return { status: 0, ok: false, out: { error: String(e && e.message) }, ms: Date.now() - t0 };
  }
}

function slotScore(config, extraction, text, expected) {
  const n = normalizeExtraction(config, extraction, { text });
  const got = Object.fromEntries(n.answers.map((a) => [a.slot, a.value]));
  let hits = 0;
  for (const [k, v] of Object.entries(expected)) if (k in got && same(got[k], v)) hits++;
  const extra = Object.keys(got).filter((k) => !(k in expected));
  return { got, hits, extra };
}

let detectKind = 'detect';
const per = [];
for (const r of rows) {
  const config = CONFIGS[r.category];
  const expected = (r.expected && r.expected.slots) || {};
  let cat = await parse({ kind: detectKind, categories: Object.keys(CONFIGS), text: r.text });
  if (cat.status === 400 && detectKind === 'detect') { detectKind = 'category'; await sleep(DELAY); cat = await parse({ kind: 'category', text: r.text }); }
  await sleep(DELAY);
  const ext = await parse({ kind: 'extract', category: r.category, text: r.text });
  await sleep(DELAY);
  const llmSlots = ext.ok ? slotScore(config, ext.out.output, r.text, expected) : null;
  const ruleSlots = slotScore(config, extractByRules(config, r.text), r.text, expected);
  per.push({
    id: r.id, label: r.label, need: r.need || null, expectedN: Object.keys(expected).length,
    llmCategory: cat.ok ? cat.out.output && cat.out.output.category : null, llmCatError: cat.ok ? null : (cat.out && (cat.out.error || cat.out.detail)) || cat.status,
    model: (ext.ok && ext.out.model) || (cat.ok && cat.out.model) || null,
    ruleCategory: detectByRules(r.text).category,
    llmSlots, ruleSlots, extError: ext.ok ? null : (ext.out && (ext.out.error || ext.out.detail)) || ext.status,
    ms: [cat.ms, ext.ms],
  });
}

const pct = (a, b) => (b ? `${a}/${b} (${Math.round((100 * a) / b)}%)` : '0/0');
const sum = (f) => per.reduce((s, p) => s + f(p), 0);
const groups = (key) => [...new Set(per.map((p) => p[key]))].map((g) => {
  const ps = per.filter((p) => p[key] === g);
  const n = ps.reduce((s, p) => s + p.expectedN, 0);
  return { [key]: g, phrases: ps.length, llmCategory: pct(ps.filter((p) => p.llmCategory === rows.find((r) => r.id === p.id).category).length, ps.length), llmSlots: pct(ps.reduce((s, p) => s + (p.llmSlots ? p.llmSlots.hits : 0), 0), n), ruleSlots: pct(ps.reduce((s, p) => s + p.ruleSlots.hits, 0), n) };
});
const allN = sum((p) => p.expectedN);
const times = per.flatMap((p) => p.ms).sort((a, b) => a - b);
console.log(JSON.stringify({
  file, worker: base, categoryCall: detectKind, phrases: per.length,
  models: [...new Set(per.map((p) => p.model).filter(Boolean))],
  llmCategory: pct(sum((p) => (p.llmCategory === rows.find((r) => r.id === p.id).category ? 1 : 0)), per.length),
  ruleCategory: pct(sum((p) => (p.ruleCategory === rows.find((r) => r.id === p.id).category ? 1 : 0)), per.length),
  llmSlots: pct(sum((p) => (p.llmSlots ? p.llmSlots.hits : 0)), allN),
  ruleSlots: pct(sum((p) => p.ruleSlots.hits), allN),
  llmExtraSlots: sum((p) => (p.llmSlots ? p.llmSlots.extra.length : 0)),
  failedCalls: sum((p) => (p.llmCatError ? 1 : 0) + (p.extError ? 1 : 0)),
  latencyMs: { median: times[times.length >> 1], max: times[times.length - 1] },
  byLabel: groups('label'), byNeed: groups('need'),
}, null, 1));
for (const p of per) console.log(JSON.stringify(p));
