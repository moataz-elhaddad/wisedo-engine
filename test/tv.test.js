// TV category: config and synthetic data validate, the generator is deterministic, scripted buyers get sensible
// picks, simulate agrees with rank, a Layer 1 session from the TV tile reaches a result quickly, and the
// 40 synthetic TV phrases are well-formed against config/tv.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { match } from '../src/layer2/index.js';
import { buildNeedProfile } from '../src/profile/build.js';
import { validateCategoryConfig, validateSnapshot } from '../src/contracts.js';
import { step } from '../src/layer1/index.js';
import { checkPhraseSet, loadPhrases } from '../eval/coverage.js';
import { generate } from '../data/generate-tv.js';
import { DATA_NOW } from '../data/generate.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const NOW = DATA_NOW;

const tvConfig = readJson('config/tv.json');
const products = readJson('data/synthetic/tv/products.json');
const offers = readJson('data/synthetic/tv/offers.json');
const manifest = readJson('data/synthetic/tv/manifest.json');
const retailers = readJson('data/synthetic/retailers.json');
const plans = readJson('data/synthetic/plans.json');

/** Shared, never-mutated TV snapshot (shared retailers and plans). */
const SNAPSHOT = {
  snapshot_id: manifest.snapshot_id,
  tenant_id: 'wisedo',
  configs: { tv: tvConfig },
  products, offers, retailers, plans,
};
const byId = Object.fromEntries(products.map((p) => [p.id, p]));
const attr = (id, a) => byId[id].attrs[a];
const profile = (answers) => buildNeedProfile(tvConfig, answers);
const top = (answers) => match(profile(answers), SNAPSHOT, NOW);

// ---------------------------------------------------------------------------------------------------------------
// Config and data
// ---------------------------------------------------------------------------------------------------------------

test('tv config passes the publish check and has the expected identity', () => {
  assert.deepEqual(validateCategoryConfig(tvConfig).errors, []);
  assert.equal(tvConfig.id, 'tv');
  assert.equal(tvConfig.version, '1.0.0');
  assert.deepEqual(tvConfig.aliases, ['television', 'screen']);
  assert.ok(tvConfig.slots.length >= 15 && tvConfig.slots.length <= 22, `${tvConfig.slots.length} slots`);
  assert.ok(tvConfig.factors.length >= 30 && tvConfig.factors.length <= 40, `${tvConfig.factors.length} factors`);
  assert.equal(tvConfig.resale, null);
  assert.equal(tvConfig.installCost, 0);
  // Every user-facing string is bilingual.
  for (const s of tvConfig.slots) {
    for (const k of ['label', 'question']) assert.ok(s[k].ar && s[k].en, `${s.id}.${k}`);
    for (const o of s.options) assert.ok(o.label.ar && o.label.en, `${s.id}.${o.id}`);
  }
  for (const ch of tvConfig.checks) assert.ok(ch.message.ar && ch.message.en, ch.id);
});

test('tv config: every slot and option id referenced by conditions, dependsOn and defaults exists', () => {
  const slots = Object.fromEntries(tvConfig.slots.map((s) => [s.id, s]));
  const refs = [];
  const walk = (c, where) => {
    if (!c || typeof c !== 'object') return;
    if (Array.isArray(c)) return c.forEach((x) => walk(x, where));
    if (typeof c.slot === 'string') refs.push([c.slot, c.in || [], where]);
    for (const k of ['all', 'any']) if (c[k]) walk(c[k], where);
    if (c.not) walk(c.not, where);
  };
  for (const s of tvConfig.slots) {
    for (const k of ['askIf', 'alwaysIf']) if (s[k]) walk(s[k], `${s.id}.${k}`);
    for (const [dep, vals] of Object.entries(s.dependsOn || {})) refs.push([dep, vals, `${s.id}.dependsOn`]);
    if (s.default !== undefined && !s.numeric) refs.push([s.id, [s.default], `${s.id}.default`]);
  }
  for (const ch of tvConfig.checks) walk(ch.when, `checks.${ch.id}`);
  assert.ok(refs.length > 10);
  for (const [slot, vals, where] of refs) {
    assert.ok(slots[slot], `${where}: unknown slot ${slot}`);
    for (const v of vals) assert.ok(slots[slot].options.some((o) => o.id === v), `${where}: unknown option ${slot}.${v}`);
  }
  // Effects only touch known attributes (the publish check covers this too; asserted here for clarity).
  const attrs = new Set(tvConfig.attributes.map((a) => a.id));
  for (const s of tvConfig.slots) for (const o of s.options) {
    const e = o.effects || {};
    for (const k of Object.keys(e.weights || {})) assert.ok(attrs.has(k), `${s.id}.${o.id} weight ${k}`);
    for (const f of [...(e.must || []), ...(e.prefer || [])]) assert.ok(attrs.has(f.attr) || f.attr === 'brand', `${s.id}.${o.id} filter ${f.attr}`);
  }
  // Every brand option names a brand that is in the catalog.
  const brands = new Set(products.map((p) => p.brand));
  for (const o of slots.brand.options) assert.ok(brands.has(o.effects.bonus[0].value[0]), o.id);
});

test('tv snapshot validates; rows are synthetic, ids prefixed and globally unique', () => {
  assert.deepEqual(validateSnapshot(SNAPSHOT).errors, []);
  assert.ok(products.length >= 28 && products.length <= 36, `${products.length} products`);
  assert.ok([...products, ...offers].every((r) => r.source === 'synthetic' && r.tenant_id === 'wisedo'));
  assert.ok(products.every((p) => p.id.startsWith('tv-') && p.category === 'tv'));
  const mobileIds = new Set(readJson('data/synthetic/products.json').map((p) => p.id));
  assert.ok(products.every((p) => !mobileIds.has(p.id)));
  assert.equal(new Set(offers.map((o) => o.id)).size, offers.length);
  // Three price tiers in the EGP 8,000-90,000 range, several brands.
  const prices = products.map((p) => p.ref_price_egp);
  assert.ok(Math.min(...prices) >= 8000 && Math.max(...prices) <= 90000);
  assert.deepEqual([...new Set(products.map((p) => p.attrs.series).filter(Boolean))].sort(), ['entry', 'mid', 'premium']);
  assert.ok(new Set(products.map((p) => p.brand)).size >= 8);
  // 3-5 offers per product, except the product kept without offers on purpose.
  for (const p of products) {
    const n = offers.filter((o) => o.product_id === p.id).length;
    if (p.id === manifest.edgeCases.noOffers) assert.equal(n, 0);
    else assert.ok(n >= 3 && n <= 5, `${p.id}: ${n} offers`);
  }
  // Shared retailers only; imports only from khan.
  const rIds = new Set(retailers.map((r) => r.id));
  assert.ok(offers.every((o) => rIds.has(o.retailer_id)));
  assert.ok(offers.every((o) => o.official === (o.retailer_id !== 'khan')));
});

test('tv generator is deterministic and matches the committed files', () => {
  const a = generate();
  const b = generate();
  assert.deepEqual(a, b);
  assert.deepEqual(JSON.parse(JSON.stringify(a.products)), products);
  assert.deepEqual(JSON.parse(JSON.stringify(a.offers)), offers);
  assert.deepEqual(JSON.parse(JSON.stringify(a.manifest)), manifest);
});

test('tv edge cases from the manifest are present and handled', () => {
  const ec = manifest.edgeCases;
  assert.equal(attr(ec.missingSpec.product, ec.missingSpec.attr), undefined);
  const hoursOld = (t) => (Date.parse(NOW) - Date.parse(t)) / 3600000;
  assert.ok(offers.filter((o) => o.product_id === ec.allOffersStale).every((o) => hoursOld(o.checked_at) > 24));
  for (const id of ec.outOfStock) assert.equal(offers.find((o) => o.id === id).in_stock, false);
  for (const id of ec.staleOffers) assert.ok(hoursOld(offers.find((o) => o.id === id).checked_at) > 24);
  for (const id of ec.staleExtras) assert.ok(hoursOld(offers.find((o) => o.id === id).extras_checked_at) > 72);
  assert.ok(offers.some((o) => o.extras.some((e) => e.type === 'install')), 'some offers carry free wall mounting');
  // Stale-spec, all-stale and no-offer products never reach the ranked list, whatever the need.
  const r = top({ pay: 'cash', budget: 90000 });
  const listed = [...r.picks.map((p) => p.product.id), ...r.others.map((o) => o.product.id)];
  for (const id of [ec.allOffersStale, ec.noOffers, 'tv-hisense-43-a6']) assert.ok(!listed.includes(id), id);
  const sharp = match(profile({ room: 'small', pay: 'cash', budget: 9600, modelInMind: ec.allOffersStale }), SNAPSHOT, NOW);
  assert.ok(sharp.modelVerdict && sharp.modelVerdict.productId === ec.allOffersStale);
  assert.notEqual(sharp.modelVerdict.type, 'picked');
});

// ---------------------------------------------------------------------------------------------------------------
// Scripted buyers
// ---------------------------------------------------------------------------------------------------------------

const PERSONAS = [
  ['tight bedroom, 10k cash', { room: 'small', use: ['series'], pay: 'cash', budget: 10000 }],
  ['bedroom, 15k cash', { room: 'small', use: ['series'], pay: 'cash', budget: 15000 }],
  ['living-room football, 40k cash', { room: 'medium', use: ['sports'], pay: 'cash', budget: 40000 }],
  ['PS5 at 120 fps, 45k cash', { room: 'medium', use: ['gaming'], console: 'next_gen', pay: 'cash', budget: 45000 }],
  ['PS5 at 120 fps, 25k cash', { room: 'medium', use: ['gaming'], console: 'next_gen', pay: 'cash', budget: 25000 }],
  ['big hall, 90k cash', { room: 'xlarge', use: ['series', 'sports'], pay: 'cash', budget: 90000 }],
  ['OLED only, 90k', { room: 'medium', use: ['series'], panel: 'oled', pay: 'cash', budget: 90000 }],
  ['older parent, channels, 20k', { who: 'parent', room: 'medium', use: ['general'], pay: 'cash', budget: 20000 }],
  ['sunny room, 60k', { room: 'large', use: ['series'], light: 'bright', pay: 'cash', budget: 60000 }],
  ['finance 1,000 a month', { room: 'medium', use: ['series'], pay: 'finance', monthlyCap: 1000 }],
];
const P = Object.fromEntries(PERSONAS);

test('tv personas: every persona builds a valid profile and ranks; simulate agrees with rank', () => {
  for (const [title, answers] of PERSONAS) {
    const p = profile(answers);
    const r = match(p, SNAPSHOT, NOW);
    const s = match(p, SNAPSHOT, NOW, 'simulate');
    assert.equal(r.mode, 'rank', title);
    assert.equal(s.top1, r.picks[0] ? r.picks[0].product.id : null, title);
    assert.equal(s.top1Shop, r.picks[0] ? r.picks[0].quote.retailerId : null, title);
    assert.equal(s.count, r.counts.eligible, title);
    assert.deepEqual(match(structuredClone(p), SNAPSHOT, NOW), r, `${title}: deterministic`);
  }
});

test('tv persona: a tight bedroom budget gets a small, cheap set; more money buys a better one', () => {
  const tight = top(P['tight bedroom, 10k cash']).picks[0];
  const more = top(P['bedroom, 15k cash']).picks[0];
  assert.ok(tight.quote.cashOut <= 10000);
  assert.ok(attr(tight.product.id, 'screen_inches') <= 43);
  assert.ok(attr(more.product.id, 'screen_inches') <= 43);
  assert.ok(more.fit > tight.fit);
  assert.ok(attr(more.product.id, 'picture') > attr(tight.product.id, 'picture'));
});

test('tv persona: football fans get a high refresh rate; next-gen gamers get HDMI 2.1', () => {
  const foot = top(P['living-room football, 40k cash']).picks[0];
  assert.ok(attr(foot.product.id, 'motion_hz') >= 120, foot.product.id);
  const sz = attr(foot.product.id, 'screen_inches');
  assert.ok(sz >= 43 && sz <= 55);
  const gamer = top(P['PS5 at 120 fps, 45k cash']).picks[0];
  assert.equal(attr(gamer.product.id, 'hdmi21'), true);
  // Below the HDMI 2.1 price floor nothing fits, and the config check explains why.
  const low = top(P['PS5 at 120 fps, 25k cash']);
  assert.equal(low.status, 'nothing_fits');
  assert.ok(low.warnings.some((w) => w.code === 'check:next_gen_gaming_low_budget'));
  assert.equal(attr(low.nothingFits.product.id, 'hdmi21'), true);
});

test('tv persona: a big hall gets 65 inches or more; OLED-only gets an OLED; a sunny room gets a bright panel', () => {
  const hall = top(P['big hall, 90k cash']);
  for (const p of hall.picks) assert.ok(attr(p.product.id, 'screen_inches') >= 65, p.product.id);
  const oled = top(P['OLED only, 90k']);
  assert.ok(oled.picks.length >= 1);
  for (const p of oled.picks) assert.equal(attr(p.product.id, 'panel'), 'oled');
  const sunny = top(P['sunny room, 60k']).picks[0];
  assert.ok(attr(sunny.product.id, 'brightness_nits') >= 800, sunny.product.id);
  const sz = attr(sunny.product.id, 'screen_inches');
  assert.ok(sz >= 55 && sz <= 75);
});

test('tv persona: an older parent gets an easy set with strong local service', () => {
  const pick = top(P['older parent, channels, 20k']).picks[0];
  assert.ok(attr(pick.product.id, 'ease') >= 7, pick.product.id);
  assert.ok(attr(pick.product.id, 'service') >= 8, pick.product.id);
  assert.ok(pick.quote.cashOut <= 20000);
});

test('tv persona: a finance buyer stays under the monthly cap; electricity counts in the 5-year cost', () => {
  const r = top(P['finance 1,000 a month']);
  assert.equal(r.status, 'ok');
  assert.equal(r.picks[0].affordability, 'eligible');
  for (const p of r.picks) {
    // Eligible picks fit the cap; a Premium pick may be a labelled stretch (decision 20 of BUILD-NOTES).
    const cap = p.affordability === 'eligible' ? 1000 : 1150;
    assert.ok(p.quote.plan && p.quote.plan.monthly <= cap, p.product.id);
    if (p.affordability === 'stretch') assert.ok(p.warnings.some((w) => w.code === 'stretch'));
    assert.equal(p.tco.yearlyRunningCost, attr(p.product.id, 'power_kwh_year') * tvConfig.runningCost.factor);
    assert.equal(p.tco.relevant, true);
    assert.equal(p.tco.resaleValue, 0);
  }
});

test('tv persona: official only by default; accepting imports can pick the cheaper khan unit', () => {
  const base = { room: 'medium', use: ['series'], pay: 'cash', budget: 35000, modelInMind: 'tv-samsung-55-q60d', brand: ['samsung'] };
  const off = top(base);
  for (const p of off.picks) assert.equal(p.quote.official, true);
  const imp = top({ ...base, acceptImports: 'yes' });
  const q60 = imp.picks.find((p) => p.product.id === 'tv-samsung-55-q60d');
  assert.ok(q60, 'the model in mind is picked');
  assert.equal(q60.quote.retailerId, 'khan');
  assert.equal(q60.quote.official, false);
  const officialPrices = offers.filter((o) => o.product_id === 'tv-samsung-55-q60d' && o.official).map((o) => o.price_egp);
  assert.ok(q60.quote.price < Math.min(...officialPrices));
});

// ---------------------------------------------------------------------------------------------------------------
// Layer 1
// ---------------------------------------------------------------------------------------------------------------

/** Answer from `answers` when the question's slot is there, skip otherwise; clarifying questions keep. */
async function runToResult(state, ui, ctx, answers) {
  const log = [];
  let guard = 0;
  while ((ui.screen === 'question' || ui.screen === 'clarify') && guard++ < 30) {
    if (ui.screen === 'clarify') { log.push('?' + ui.clarify.id); ({ state, ui } = await step(state, { type: 'answer', option: 'keep' }, ctx)); continue; }
    log.push(ui.question.slot);
    const ev = ui.question.slot in answers ? { type: 'answer', value: answers[ui.question.slot] } : { type: 'skip' };
    ({ state, ui } = await step(state, ev, ctx));
  }
  return { state, ui, log };
}

test('tv Layer 1: a session from the TV tile reaches a result in at most 6 questions', async () => {
  const ctx = { snapshot: SNAPSHOT, now: NOW };
  const flows = [
    { room: 'medium', use: ['sports'], pay: 'cash', budget: 30000 },
    { room: 'small', use: ['series'], pay: 'cash', budget: 'b15000' },
    { room: 'large', use: ['gaming'], console: 'next_gen', pay: 'finance', monthlyCap: 2500 },
  ];
  for (const answers of flows) {
    const start = await step(null, { type: 'start', tile: 'tv' }, ctx);
    assert.equal(start.ui.screen, 'question');
    assert.equal(start.ui.question.slot, 'room', 'viewing distance comes first');
    const { ui, log } = await runToResult(start.state, start.ui, ctx, answers);
    assert.equal(ui.screen, 'result', log.join());
    assert.ok(log.length <= 6, `asked ${log.length}: ${log.join()}`);
    for (const s of ['room', 'use', 'pay']) assert.ok(log.includes(s), `${s} asked`);
    for (const s of tvConfig.slots.filter((x) => x.manual).map((x) => x.id)) assert.ok(!log.includes(s), `${s} is never asked`);
    assert.equal(ui.result.category, 'tv');
    assert.ok(ui.result.picks.length > 0);
    // The result is what Layer 2 gives for the final profile.
    const again = match(ui.profile, SNAPSHOT, NOW);
    assert.deepEqual(again.picks.map((p) => p.product.id), ui.result.picks.map((p) => p.product.id));
  }
});

test('tv Layer 1: free text naming a TV is routed to the tv config by the rules', async () => {
  const { ui } = await step(null, { type: 'start', text: 'عايز تلفزيون للماتشات' }, { snapshot: SNAPSHOT, now: NOW });
  assert.equal(ui.category, 'tv');
  assert.equal(ui.screen, 'question');
});

// ---------------------------------------------------------------------------------------------------------------
// Eval phrases
// ---------------------------------------------------------------------------------------------------------------

test('tv eval phrases: 40 synthetic lines, valid against config/tv.json, every line has a slot or a Not used item', () => {
  const { phrases, errors } = loadPhrases(join(ROOT, 'eval', 'phrases-tv.jsonl'));
  assert.deepEqual(errors, []);
  assert.equal(phrases.length, 40);
  assert.ok(phrases.every((p) => p.category === 'tv' && p.label === 'synthetic'));
  // checkPhraseSet applies its slot-or-unmapped acceptance rule to `mobile` lines only (detection-only for the
  // other categories), so the TV lines are checked under that rule by relabelling them for the call.
  const asCategory = phrases.map((p) => ({ ...p, category: 'mobile' }));
  const r = checkPhraseSet({ phrases: asCategory, config: tvConfig, retailers: retailers.map((x) => x.id), products, expectedCount: 40, minPerFactor: 0 });
  assert.deepEqual(r.errors, []);
  const ids = new Set(phrases.map((p) => p.id));
  assert.equal(ids.size, 40);
  // The core TV needs each appear in at least 3 phrases.
  for (const f of ['viewing_distance', 'main_use_intensity', 'environment', 'gaming_features', 'budget_monthly_down']) {
    assert.ok(phrases.filter((p) => p.factors.includes(f)).length >= 3, f);
  }
  const langs = new Set(phrases.map((p) => p.lang));
  assert.deepEqual([...langs].sort(), ['ar', 'en', 'mixed']);
});
