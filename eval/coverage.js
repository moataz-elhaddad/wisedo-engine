// Coverage and validity checker for the synthetic 300-phrase eval set (eval/phrases.jsonl).
//
//   node eval/coverage.js            prints the report, exits 1 if any acceptance rule fails
//
// Dependency-free ES module. The same checks are imported by test/eval-phrases.test.js through
// `checkPhraseSet`, so `node --test` fails if the set breaks the acceptance rule (tech-spec 4.1).
//
// The phrases are SYNTHETIC. Real beta phrases must replace them (see eval/README.md).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

export const EXPECTED_COUNT = 300;
export const MIN_PER_FACTOR = 5;
export const LANGS = ['ar', 'en', 'mixed'];
export const CATEGORIES = ['mobile', 'laptop', 'tv', 'ac', 'fridge', 'none'];
export const REASONS = ['not supported yet', 'no data'];

// The five "Not used yet" topics of tech-spec 4.1 and the (not yet captured) buying factor each one belongs to.
export const TOPIC_FACTOR = {
  colour: 'look_colour',
  'trade-in': 'trade_in',
  condition: 'fakes_used',
  'wait-for-sale': 'timing_launch_currency',
  social: 'family_opinion',
};
export const TOPICS = Object.keys(TOPIC_FACTOR);

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

/** Reads eval/phrases.jsonl. Returns {phrases, errors} where errors are lines that are not valid JSON objects. */
export function loadPhrases(path = join(HERE, 'phrases.jsonl')) {
  const text = readFileSync(path, 'utf8');
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  const phrases = [];
  const errors = [];
  lines.forEach((line, i) => {
    try {
      const obj = JSON.parse(line);
      if (!isObj(obj)) throw new Error('not an object');
      phrases.push(obj);
    } catch (e) {
      errors.push(`line ${i + 1}: not a JSON object (${e.message})`);
    }
  });
  return { phrases, errors, lineCount: lines.length };
}

/** Loads the config and the synthetic retailer / product ids that the `shops` and `modelInMind` slots refer to. */
export function loadContext() {
  const config = readJson(join(ROOT, 'config', 'mobile.json'));
  const retailers = readJson(join(ROOT, 'data', 'synthetic', 'retailers.json')).map((r) => r.id);
  const products = readJson(join(ROOT, 'data', 'synthetic', 'products.json'));
  return { config, retailers, products };
}

/** Captured factors: config factors that have at least one slot in `via` (a buyer can fill them by text or answer). */
export function capturedFactors(config) {
  return config.factors
    .filter((f) => (f.via || []).some((v) => v.slot))
    .map((f) => ({ id: f.id, name: f.name, slots: f.via.filter((v) => v.slot).map((v) => v.slot) }));
}

function validateSlotValue(slot, value, ctx, where, errors) {
  const label = `${where} slot "${slot.id}"`;
  if (slot.valueShape === 'shops') {
    if (!isObj(value)) return errors.push(`${label}: value must be {prefer?: [...], avoid?: [...]}`);
    const keys = Object.keys(value);
    if (!keys.length) errors.push(`${label}: empty shops value`);
    for (const k of keys) {
      if (k !== 'prefer' && k !== 'avoid') errors.push(`${label}: unknown key "${k}"`);
      else if (!Array.isArray(value[k]) || !value[k].length) errors.push(`${label}.${k}: must be a non-empty array`);
      else
        for (const id of value[k])
          if (!ctx.retailers.includes(id)) errors.push(`${label}.${k}: unknown retailer id "${id}"`);
    }
    if (isObj(value) && value.prefer && value.avoid) {
      for (const id of value.prefer) if (value.avoid.includes(id)) errors.push(`${label}: "${id}" is both preferred and avoided`);
    }
    return;
  }
  if (slot.valueShape === 'product') {
    if (typeof value !== 'string' || !value.trim()) errors.push(`${label}: value must be a non-empty model name or product id`);
    return;
  }
  const optionIds = (slot.options || []).map((o) => o.id);
  const numeric = slot.numeric;
  const checkOption = (v, what) => {
    if (typeof v !== 'string' || !optionIds.includes(v)) errors.push(`${label}: ${what} "${v}" is not an option id`);
  };
  if (numeric && typeof value === 'number') {
    if (!Number.isFinite(value)) errors.push(`${label}: number is not finite`);
    else if (value < numeric.min || value > numeric.max)
      errors.push(`${label}: ${value} is outside ${numeric.min}..${numeric.max} (${numeric.unit})`);
    return;
  }
  if (slot.multi) {
    if (!Array.isArray(value) || !value.length) return errors.push(`${label}: multi slot needs a non-empty array of option ids`);
    if (new Set(value).size !== value.length) errors.push(`${label}: duplicate option ids`);
    for (const v of value) checkOption(v, 'value');
    return;
  }
  if (Array.isArray(value)) return errors.push(`${label}: single-choice slot must not be an array`);
  if (numeric) {
    if (typeof value !== 'string') return errors.push(`${label}: numeric slot takes a number or an option id`);
    checkOption(value, 'value');
    return;
  }
  checkOption(value, 'value');
}

/**
 * Runs every check. Pure: takes data, returns {ok, errors, warnings, report}.
 * `report` holds the per-factor table and the counts the CLI prints.
 */
export function checkPhraseSet({ phrases, config, retailers, products, expectedCount = EXPECTED_COUNT, minPerFactor = MIN_PER_FACTOR, parseErrors = [] }) {
  const errors = [...parseErrors];
  const warnings = [];
  const slotById = Object.fromEntries(config.slots.map((s) => [s.id, s]));
  const factorIds = new Set(config.factors.map((f) => f.id));
  const ctx = { retailers, products };

  if (phrases.length !== expectedCount) errors.push(`expected ${expectedCount} phrases, found ${phrases.length}`);

  const seen = new Set();
  const seenText = new Set();
  for (const p of phrases) {
    const where = `phrase ${p.id ?? '(no id)'}`;
    if (typeof p.id !== 'string' || !/^p\d{3}$/.test(p.id)) errors.push(`${where}: id must look like p001`);
    else if (seen.has(p.id)) errors.push(`${where}: duplicate id`);
    else seen.add(p.id);
    if (p.label !== 'synthetic') errors.push(`${where}: label must be "synthetic" (found ${JSON.stringify(p.label)})`);
    if (!LANGS.includes(p.lang)) errors.push(`${where}: lang must be one of ${LANGS.join('|')}`);
    if (typeof p.text !== 'string' || !p.text.trim()) errors.push(`${where}: text is empty`);
    else if (seenText.has(p.text)) errors.push(`${where}: duplicate text`);
    else seenText.add(p.text);
    if (!CATEGORIES.includes(p.category)) errors.push(`${where}: category must be one of ${CATEGORIES.join('|')}`);
    if (p.notes !== undefined && typeof p.notes !== 'string') errors.push(`${where}: notes must be a string`);

    const exp = p.expected;
    if (!isObj(exp) || !isObj(exp.slots) || !Array.isArray(exp.unmapped)) {
      errors.push(`${where}: expected must be {slots: {}, unmapped: []}`);
      continue;
    }
    const slotIds = Object.keys(exp.slots);
    for (const sid of slotIds) {
      const slot = slotById[sid];
      if (!slot) errors.push(`${where}: unknown slot id "${sid}"`);
      else validateSlotValue(slot, exp.slots[sid], ctx, where, errors);
    }
    const topicFactors = new Set();
    for (const u of exp.unmapped) {
      if (!isObj(u)) {
        errors.push(`${where}: unmapped item must be an object`);
        continue;
      }
      if (typeof u.quote !== 'string' || !u.quote.trim()) errors.push(`${where}: unmapped quote is empty`);
      else if (typeof p.text === 'string' && !p.text.includes(u.quote)) errors.push(`${where}: unmapped quote "${u.quote}" is not in the text`);
      if (!REASONS.includes(u.reason)) errors.push(`${where}: unmapped reason must be one of ${REASONS.join('|')}`);
      if (!TOPICS.includes(u.topic)) errors.push(`${where}: unmapped topic must be one of ${TOPICS.join('|')}`);
      else topicFactors.add(TOPIC_FACTOR[u.topic]);
    }

    // Acceptance rule: a phrase ends in a slot value or a "Not used" chip, or it is category detection only.
    if (p.category === 'mobile') {
      if (!slotIds.length && !exp.unmapped.length) errors.push(`${where}: mobile phrase has no expected slot and no unmapped item`);
    } else if (CATEGORIES.includes(p.category)) {
      if (slotIds.length || exp.unmapped.length) errors.push(`${where}: category "${p.category}" is detection only, so it must have no slots and no unmapped items`);
    }

    // Factor tags: known factor ids, each backed by an expected slot (via the config tags) or an unmapped topic.
    if (!Array.isArray(p.factors)) errors.push(`${where}: factors must be an array`);
    else {
      const backed = new Set(topicFactors);
      for (const sid of slotIds) for (const f of slotById[sid]?.factors || []) backed.add(f);
      for (const f of p.factors) {
        if (!factorIds.has(f)) errors.push(`${where}: unknown factor "${f}"`);
        else if (!backed.has(f)) errors.push(`${where}: factor "${f}" is not backed by an expected slot or unmapped topic`);
      }
      if (p.category === 'mobile' && !p.factors.length) errors.push(`${where}: mobile phrase has no factor tag`);
    }
  }

  // Per-factor counts for the captured factors.
  const captured = capturedFactors(config);
  const factorCounts = Object.fromEntries(captured.map((f) => [f.id, 0]));
  for (const p of phrases) for (const f of new Set(p.factors || [])) if (f in factorCounts) factorCounts[f]++;
  const factorTable = captured.map((f) => ({ ...f, count: factorCounts[f.id], ok: factorCounts[f.id] >= minPerFactor }));
  for (const f of factorTable) if (!f.ok) errors.push(`factor "${f.id}" has ${f.count} phrases, needs at least ${minPerFactor}`);

  // Counts.
  const tally = (arr) => arr.reduce((m, k) => ((m[k] = (m[k] || 0) + 1), m), {});
  const byLang = tally(phrases.map((p) => p.lang));
  const byCategory = tally(phrases.map((p) => p.category));
  const byTopic = tally(phrases.flatMap((p) => (p.expected?.unmapped || []).map((u) => u.topic)));
  const phrasesWithTopic = phrases.filter((p) => (p.expected?.unmapped || []).length).length;
  const bySlot = tally(phrases.flatMap((p) => Object.keys(p.expected?.slots || {})));

  // Soft checks against the brief (warnings only; the hard rules are above).
  const n = phrases.length || 1;
  const pct = (k) => ((byLang[k] || 0) / n) * 100;
  if (pct('ar') < 50 || pct('ar') > 70) warnings.push(`Arabic share is ${pct('ar').toFixed(0)} percent (target about 60)`);
  if (pct('en') < 15 || pct('en') > 35) warnings.push(`English share is ${pct('en').toFixed(0)} percent (target about 25)`);
  if (pct('mixed') < 8 || pct('mixed') > 22) warnings.push(`Mixed share is ${pct('mixed').toFixed(0)} percent (target about 15)`);
  const other = phrases.filter((p) => ['laptop', 'tv', 'ac', 'fridge'].includes(p.category)).length;
  if (other < 20) warnings.push(`only ${other} other-category phrases (target about 20)`);
  if ((byCategory.none || 0) < 5) warnings.push(`only ${byCategory.none || 0} no-category phrases (target 5)`);
  for (const t of TOPICS) if (!byTopic[t]) warnings.push(`no phrase for Not used topic "${t}"`);

  const minFactor = factorTable.length ? Math.min(...factorTable.map((f) => f.count)) : 0;
  const minFactorIds = factorTable.filter((f) => f.count === minFactor).map((f) => f.id);

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    report: { total: phrases.length, factorTable, minFactor, minFactorIds, byLang, byCategory, byTopic, phrasesWithTopic, bySlot },
  };
}

function printTable(rows, header) {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (r) => r.map((c, i) => String(c).padEnd(widths[i])).join('  ');
  console.log(line(header));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const r of rows) console.log(line(r));
}

function printCounts(title, obj) {
  console.log(`\n${title}`);
  for (const [k, v] of Object.entries(obj).sort((a, b) => b[1] - a[1])) console.log(`  ${String(k).padEnd(16)} ${v}`);
}

export function main() {
  const { phrases, errors: parseErrors } = loadPhrases();
  const ctx = loadContext();
  const result = checkPhraseSet({ phrases, parseErrors, ...ctx });
  const r = result.report;

  console.log('Wisedo eval phrase set (SYNTHETIC: replace with real beta phrases)');
  console.log(`phrases: ${r.total} (expected ${EXPECTED_COUNT})\n`);
  console.log(`Phrases per captured buying factor (acceptance: at least ${MIN_PER_FACTOR})`);
  printTable(
    r.factorTable.map((f) => [f.id, f.slots.join(','), f.count, f.ok ? 'ok' : 'FAIL']),
    ['factor', 'slots', 'phrases', 'rule'],
  );
  console.log(`\nlowest factor count: ${r.minFactor} (${r.minFactorIds.join(', ')})`);
  printCounts('Phrases per language', r.byLang);
  printCounts('Phrases per category', r.byCategory);
  printCounts(`Unmapped items per Not used topic (${r.phrasesWithTopic} phrases carry one)`, r.byTopic);
  printCounts('Expected slot occurrences per slot', r.bySlot);

  if (result.warnings.length) {
    console.log('\nWarnings');
    for (const w of result.warnings) console.log(`  ${w}`);
  }
  if (result.errors.length) {
    console.log(`\nFAILED: ${result.errors.length} problem(s)`);
    for (const e of result.errors.slice(0, 100)) console.log(`  ${e}`);
    if (result.errors.length > 100) console.log(`  ... and ${result.errors.length - 100} more`);
    process.exitCode = 1;
  } else {
    console.log('\nOK: every acceptance rule passes');
  }
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
