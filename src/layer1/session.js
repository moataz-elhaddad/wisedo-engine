// Layer 1 session: a pure-ish state machine.
//
//   step(state, event, ctx) -> Promise<{state, ui}>
//
// State in, event in, new state and UI instructions out. The state is plain JSON (see state.js), so a session
// can be stored between requests and replayed. The only side effects are the injected `llm` call (bounded by a
// 3 s timeout) and Layer 2 calls through match() (simulate while planning, rank for the result).
//
// Events
//   {type: 'start', text}            free text first (tech-spec 4: "Free text always comes first")
//   {type: 'start', tile}            a category tile: the full question flow
//   {type: 'answer', value, slot?}   answer the question on screen (slot defaults to it); or {type:'answer', option} for a clarifying question
//   {type: 'skip', slot?}            "doesn't matter": the slot's default applies, shown as assumed
//   {type: 'edit', slot, value}      edit a chip or set a detail; locks the value for the session (value null clears it)
//   {type: 'addText', text}          more free text mid-flow; locked values are never overwritten
//   {type: 'addDetail'}              lists every slot of the category ("Add a detail")
//   {type: 'showNow'}                "show results now"
//   {type: 'result'}                 the result: the Need Profile goes to Layer 2 in rank mode
import { match } from '../layer2/index.js';
import { paramsOf } from '../params.js';
import { emptyState, cloneState, answerEntries, isClosed } from './state.js';
import { detectCategory, categoryMessage, CATEGORIES, CATEGORY_IDS } from './u1-category.js';
import { extract, DEFAULT_TIMEOUT_MS } from './u2-extract.js';
import { extractByRules } from './u2-rules.js';
import { normalizeExtraction, normalizeAnswer } from './u3-normalize.js';
import { applyExtraction, setBuyerValue, buildChips, PREFILL_THRESHOLD, valueLabel } from './u4-confirm.js';
import { buildProfile, withDefaults } from './u5-derive.js';
import { checkConsistency } from './u6-consistency.js';
import { planNext } from './u7-planner.js';
import { renderQuestion, renderClarify, renderAddDetail } from './u8-render.js';
import { stopBeforePlanning, statusFor, MAX_QUESTIONS } from './u9-stop.js';
import { simulate } from './sim.js';
import { dependsOnMet } from '../profile/build.js';
import { statedAnswers } from './state.js';

export const MAX_TEXT_LENGTH = 2000;

/**
 * @typedef {Object} SessionContext
 * @property {any} snapshot                    CatalogSnapshot; its `configs` decide which categories are configured
 * @property {string|number|Date} now          passed to Layer 2 (Layer 1 never reads the clock either)
 * @property {(req: any) => Promise<any>} [llm]  injected LLM adapter (llm/mock.js in tests, llm/anthropic.js live)
 * @property {number} [llmTimeoutMs]           default 3000
 * @property {number} [maxQuestions]           default 8
 * @property {import('./u7-planner.js').PlannerPolicy} [policy]  planner settings (see u7-planner.js)
 */

/** @returns {import('./state.js').SessionState} */
export function newSession() {
  return emptyState();
}

/**
 * Apply one event.
 * @param {import('./state.js').SessionState|null} state
 * @param {{type: string, [k: string]: any}} event
 * @param {SessionContext} ctx
 * @returns {Promise<{state: import('./state.js').SessionState, ui: any}>}
 */
export async function step(state, event, ctx) {
  const s = state ? cloneState(state) : emptyState();
  switch (event && event.type) {
    case 'start': return start(event, ctx);
    case 'answer': return answer(s, event, ctx);
    case 'skip': return skip(s, event, ctx);
    case 'edit': return edit(s, event, ctx);
    case 'addText': return addText(s, event, ctx);
    case 'addDetail': return addDetail(s, ctx);
    case 'showNow': return finish(s, ctx, 'show_now');
    case 'result': return finish(s, ctx, s.stop ? s.stop.reason : 'show_now');
    default: return { state: s, ui: { screen: 'error', error: `unknown event "${event && event.type}"` } };
  }
}

/**
 * Run a list of events from a fresh session (replay).
 * @param {{type: string}[]} events
 * @param {SessionContext} ctx
 */
export async function replay(events, ctx) {
  let state = null, ui = null;
  for (const e of events) ({ state, ui } = await step(state, e, ctx));
  return { state, ui };
}

// ---------------------------------------------------------------------------------------------
// Context helpers
// ---------------------------------------------------------------------------------------------

/** Config by id or alias from the snapshot (the snapshot's configs decide what is configured). */
export function configFor(snapshot, category) {
  const configs = (snapshot && snapshot.configs) || {};
  if (configs[category]) return configs[category];
  for (const c of Object.values(configs)) if ((/** @type {any} */ (c).aliases || []).includes(category)) return c;
  return null;
}

export function configuredCategories(snapshot) {
  return CATEGORY_IDS.filter((id) => !!configFor(snapshot, id));
}

/** @type {WeakMap<object, Map<string, any>>} */
const IDENTITY = new WeakMap();

/**
 * Identity of catalog rows (ids and names only, never prices or attributes) used to map the buyer's words to ids.
 * @param {any} snapshot
 * @param {string} category
 * @returns {{products: {id: string, brand: string, name: string, aliases: string[]}[], retailers: {id: string, name: string}[]}}
 */
export function identityFor(snapshot, category) {
  let m = IDENTITY.get(snapshot);
  if (!m) { m = new Map(); IDENTITY.set(snapshot, m); }
  if (m.has(category)) return m.get(category);
  const cfg = configFor(snapshot, category);
  const cats = cfg ? [cfg.id, ...(cfg.aliases || [])] : [category];
  const mine = (r) => r && r.tenant_id === snapshot.tenant_id;
  const id = {
    products: (snapshot.products || []).filter((p) => mine(p) && cats.includes(p.category)).map((p) => ({ id: p.id, brand: p.brand, name: p.name, aliases: p.aliases || [] })),
    retailers: (snapshot.retailers || []).filter(mine).map((r) => ({ id: r.id, name: r.name })),
  };
  m.set(category, id);
  return id;
}

/** Layer 1 tunables: the category config's `params.layer1` (admin panel), overridden by what the caller passes in ctx. */
function layer1Params(config, ctx) {
  const p = paramsOf(config).layer1;
  return {
    maxQuestions: ctx.maxQuestions ?? p.maxQuestions,
    policy: { minGain: p.minGain, materialPoints: p.materialPoints, ...(ctx.policy || {}) },
    prefillThreshold: p.prefillThreshold,
  };
}

function simCtx(s, ctx) {
  const config = configFor(ctx.snapshot, s.category);
  return { config, snapshot: ctx.snapshot, now: ctx.now, identity: identityFor(ctx.snapshot, s.category), policy: layer1Params(config, ctx).policy };
}

// ---------------------------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------------------------

async function start(event, ctx) {
  const s = emptyState();
  const configured = configuredCategories(ctx.snapshot);
  if (event.tile !== undefined) {
    const tile = String(event.tile);
    const known = CATEGORY_IDS.includes(tile) || !!configFor(ctx.snapshot, tile);
    const cfg = configFor(ctx.snapshot, tile);
    const det = { status: cfg ? 'configured' : known ? 'not_configured' : 'unsupported', category: cfg ? cfg.id : known ? tile : null, by: 'tile', confidence: 1, matched: [] };
    s.detection = det;
    if (!cfg) return closedCategory(s, det, configured);
    s.category = cfg.id;
    s.flags.fullFlow = true; // a buyer who skips the text gets the full flow
    return advance(s, ctx);
  }

  const text = String(event.text ?? '').slice(0, MAX_TEXT_LENGTH);
  const productsByCategory = Object.fromEntries(configured.map((c) => [c, identityFor(ctx.snapshot, c).products]));
  const det = await detectCategory(text, { configured, productsByCategory, llm: ctx.llm, timeoutMs: ctx.llmTimeoutMs ?? DEFAULT_TIMEOUT_MS });
  s.detection = det;
  if (det.status === 'not_configured' || det.status === 'unsupported') return closedCategory(s, det, configured);
  if (det.status === 'unclear' || det.confidence < PREFILL_THRESHOLD) return tiles(s, det, configured, det.llmError ? 'llm_' + det.llmError : 'unclear_category');

  s.category = /** @type {string} */ (det.category);
  const read = await readText(s, text, ctx);
  // Low confidence on everything: the text was read, but nothing in it reached confidence 0.7. Show the
  // category tiles (tech-spec failure handling) instead of building on guesses; a tile starts the full flow.
  if (read.ok && read.prefilled === 0 && read.suggested > 0) {
    const t = emptyState();
    t.detection = det;
    return tiles(t, det, configured, 'low_confidence');
  }
  return advance(s, ctx);
}

async function answer(s, event, ctx) {
  if (!s.category) return { state: s, ui: { screen: 'error', error: 'no category yet' } };
  const config = configFor(ctx.snapshot, s.category);
  const pending = s.pending;
  if (pending && pending.kind === 'clarify') {
    const optId = event.option ?? event.value;
    const opt = pending.options.find((o) => o.id === optId);
    if (!opt) return errorUi(s, ctx, `"${optId}" is not an option of this question`);
    applyClarifyAction(s, opt.action);
    markAsked(s, 'answered');
    return advance(s, ctx);
  }
  const slot = event.slot ?? (pending && pending.slot);
  if (!slot) return errorUi(s, ctx, 'no question to answer');
  const n = normalizeAnswer(config, slot, event.value, identityFor(ctx.snapshot, s.category));
  if (!n.ok) return errorUi(s, ctx, n.error);
  setBuyerValue(s, slot, n.value, 'answer');
  if (pending && pending.slot === slot) markAsked(s, 'answered');
  return advance(s, ctx);
}

async function skip(s, event, ctx) {
  if (!s.category) return { state: s, ui: { screen: 'error', error: 'no category yet' } };
  const pending = s.pending;
  if (pending && pending.kind === 'clarify') {
    const keep = pending.options.find((o) => o.action.type === 'keep');
    if (keep) applyClarifyAction(s, keep.action);
    markAsked(s, 'skipped');
    return advance(s, ctx);
  }
  const slot = event.slot ?? (pending && pending.slot);
  if (!slot) return errorUi(s, ctx, 'no question to skip');
  if (!s.values[slot] && !s.skipped.includes(slot)) s.skipped.push(slot);
  s.suggestions = s.suggestions.filter((x) => x.slot !== slot);
  if (pending && pending.slot === slot) markAsked(s, 'skipped');
  return advance(s, ctx);
}

async function edit(s, event, ctx) {
  if (!s.category) return { state: s, ui: { screen: 'error', error: 'no category yet' } };
  const config = configFor(ctx.snapshot, s.category);
  const n = normalizeAnswer(config, event.slot, event.value, identityFor(ctx.snapshot, s.category));
  if (!n.ok) return errorUi(s, ctx, n.error);
  setBuyerValue(s, event.slot, n.value, 'edit');
  if (s.pending && s.pending.kind === 'slot' && s.pending.slot === event.slot) markAsked(s, 'answered');
  if (s.phase === 'done') s.stop = null; // a profile change re-runs everything (tech-spec 3)
  return advance(s, ctx);
}

async function addText(s, event, ctx) {
  if (!s.category) return start({ text: event.text }, ctx);
  const read = await readText(s, String(event.text ?? '').slice(0, MAX_TEXT_LENGTH), ctx);
  if (s.phase === 'done') s.stop = null;
  const out = await advance(s, ctx);
  if (!read.ok) out.ui.textNotRead = { reason: read.error, message: { en: "I couldn't read that text; nothing was changed. You can keep answering or edit the chips.", ar: 'ماقدرتش أقرا الكلام ده؛ مفيش حاجة اتغيرت. كمّل الإجابة أو عدّل الاختيارات.' } };
  return out;
}

async function addDetail(s, ctx) {
  if (!s.category) return { state: s, ui: { screen: 'error', error: 'no category yet' } };
  const config = configFor(ctx.snapshot, s.category);
  return { state: s, ui: { ...common(s, ctx), screen: 'add_detail', addDetail: renderAddDetail(config, s, identityFor(ctx.snapshot, s.category)) } };
}

// ---------------------------------------------------------------------------------------------
// Core loop
// ---------------------------------------------------------------------------------------------

/**
 * Read one piece of free text: U2 extract -> U3 normalise -> U4 merge (locked values win).
 * Without an LLM, or when the LLM fails, the rule-based extractor reads the text instead. Only when the rules find
 * nothing either is the state left unchanged (except the record); the first text then falls back to the full flow.
 */
async function readText(s, text, ctx) {
  const config = configFor(ctx.snapshot, s.category);
  const identity = identityFor(ctx.snapshot, s.category);
  const normCtx = { text, products: identity.products, retailers: identity.retailers };
  const threshold = layer1Params(config, ctx).prefillThreshold;
  /** @type {{error: string, detail?: string}} */
  let failure = { error: 'no_llm' };
  if (ctx.llm) {
    const res = await extract(config, text, { llm: ctx.llm, timeoutMs: ctx.llmTimeoutMs ?? DEFAULT_TIMEOUT_MS, retailers: identity.retailers });
    if (res.ok) {
      const norm = normalizeExtraction(config, res.extraction, normCtx);
      const applied = applyExtraction(s, norm, threshold);
      s.texts.push({ text, status: 'ok' });
      return { ok: true, prefilled: applied.prefilled.length, suggested: applied.suggested.length };
    }
    failure = { error: res.error, ...(res.detail ? { detail: res.detail } : {}) };
  }
  const norm = normalizeExtraction(config, extractByRules(config, text, { retailers: identity.retailers }), normCtx);
  if (norm.answers.length) {
    const applied = applyExtraction(s, norm, threshold);
    s.texts.push({ text, status: 'rules', llm: failure.error, ...(failure.detail ? { detail: failure.detail } : {}) });
    return { ok: true, reader: 'rules', prefilled: applied.prefilled.length, suggested: applied.suggested.length };
  }
  s.texts.push({ text, status: failure.error, ...(failure.detail ? { detail: failure.detail } : {}) });
  s.flags.llmFailed = failure.error;
  if (s.texts.length === 1) s.flags.fullFlow = true;
  return { ok: false, error: failure.error, prefilled: 0, suggested: 0 };
}

/** After any change: consistency check, then stop rule, then the next question (or the result). */
async function advance(s, ctx) {
  const c = simCtx(s, ctx);
  if (s.pending) {
    const p = s.asked.find((q) => q.outcome === 'pending');
    if (p) p.outcome = 'superseded';
    s.pending = null;
  }
  const preStop = stopBeforePlanning(s, { maxQuestions: layer1Params(c.config, ctx).maxQuestions });
  if (preStop) return finish(s, ctx, preStop.reason);

  const profile = buildProfile(c.config, s);
  const cons = checkConsistency(c, s, profile);
  if (cons.blocking) {
    const cl = cons.blocking;
    s.clarified.push(cl.id);
    s.asked.push({ kind: 'clarify', id: cl.id, outcome: 'pending' });
    s.pending = { kind: 'clarify', id: cl.id, options: cl.options.map((o) => ({ id: o.id, action: o.action })) };
    s.phase = 'clarify';
    return { state: s, ui: { ...common(s, ctx), screen: 'clarify', clarify: renderClarify(cl, stepInfo(s, c.config, layer1Params(c.config, ctx).maxQuestions)), notes: cons.notes } };
  }

  const plan = planNext(c, s);
  if (plan.kind === 'stop') return finish(s, ctx, 'no_gain', plan);
  const ev = /** @type {any} */ (plan.evaluation);
  s.asked.push({ kind: 'slot', id: /** @type {string} */ (plan.slot), outcome: 'pending', phase: plan.phase, gain: ev.gain, distinctTop1: ev.distinctTop1 });
  s.pending = { kind: 'slot', slot: plan.slot, phase: plan.phase, options: ev.options.filter((o) => o.visible).map((o) => o.id) };
  s.phase = 'question';
  const live = simulate(c, answerEntries(s).map((e) => ({ slot: e.slot, value: e.value })));
  return {
    state: s,
    ui: {
      ...common(s, ctx, profile),
      screen: 'question',
      question: renderQuestion(c.config, plan, stepInfo(s, c.config, layer1Params(c.config, ctx).maxQuestions)),
      live: { matching: live.count, top: live.top3 },
      notes: cons.notes,
    },
  };
}

/** Stop and produce the result: the confirmed Need Profile goes to Layer 2 in rank mode. */
function finish(s, ctx, reason, plan) {
  if (!s.category) return { state: s, ui: { screen: 'error', error: 'no category yet' } };
  const c = simCtx(s, ctx);
  if (s.pending) {
    const p = s.asked.find((q) => q.outcome === 'pending');
    if (p) p.outcome = 'superseded';
    s.pending = null;
  }
  s.stop = { reason: /** @type {any} */ (reason) };
  s.phase = 'done';
  const open = openSlots(c.config, s);
  // Questions still worth asking when we stop early (cap or "show results now").
  let questionsLeft = false;
  if (reason !== 'no_gain') {
    const probe = cloneState(s);
    probe.stop = null;
    questionsLeft = planNext(c, probe).kind === 'question';
  }
  const profile = buildProfile(c.config, s, { status: statusFor(reason, questionsLeft), open });
  let result;
  try {
    result = match(profile, ctx.snapshot, ctx.now, 'rank');
  } catch (e) {
    return { state: s, ui: { ...common(s, ctx, profile), screen: 'error', error: String(e && e.message) } };
  }
  const considered = (plan && plan.considered) || {};
  return {
    state: s,
    ui: {
      ...common(s, ctx, profile),
      screen: 'result',
      stopReason: reason,
      profile,
      result,
      skippedQuestions: open.map((id) => {
        const slot = c.config.slots.find((x) => x.id === id);
        return { slot: id, label: slot.label, gain: considered[id] ?? null, why: { en: "I didn't ask about this because it wouldn't change the pick.", ar: 'ماسألتش عن ده لأنه مش هيغيّر الترشيح.' } };
      }),
    },
  };
}

/** Askable slots the buyer never answered or skipped ("questions I skipped"); defaults still apply to them. */
function openSlots(config, s) {
  const eff = withDefaults(config, statedAnswers(s));
  return config.slots.filter((x) => !x.manual && !x.tiebreak && !isClosed(s, x.id) && dependsOnMet(x, eff)).map((x) => x.id);
}

function applyClarifyAction(s, action) {
  if (!action || action.type === 'keep') return;
  if (action.type === 'edit') setBuyerValue(s, action.slot, action.value, 'edit');
  if (action.type === 'reopen') {
    delete s.values[action.slot];
    s.skipped = s.skipped.filter((x) => x !== action.slot);
  }
}

function markAsked(s, outcome) {
  const p = s.asked.find((q) => q.outcome === 'pending');
  if (p) p.outcome = outcome;
  s.pending = null;
}

function stepInfo(s, config, cap = MAX_QUESTIONS) {
  const done = s.asked.filter((q) => q.outcome === 'answered' || q.outcome === 'skipped').length;
  // "of" is an estimate: questions so far, this one, and the always questions still open.
  const eff = withDefaults(config, statedAnswers(s));
  const alwaysOpen = config.slots.filter((x) => x.always && !isClosed(s, x.id) && dependsOnMet(x, eff)).length;
  return { index: done + 1, of: Math.min(cap, Math.max(done + 1, done + alwaysOpen)) };
}

/** Fields every UI response carries once a category is known. */
function common(s, ctx, profile) {
  const config = configFor(ctx.snapshot, s.category);
  const p = profile || buildProfile(config, s);
  const { chips, notUsed, open } = buildChips(config, s, p, identityFor(ctx.snapshot, s.category));
  return {
    category: s.category,
    chips,
    notUsed,
    suggestions: open,
    questionsAsked: s.asked.filter((q) => q.outcome === 'answered' || q.outcome === 'skipped').length,
    fallback: s.flags.llmFailed ? { reason: s.flags.llmFailed, fullFlow: s.flags.fullFlow } : null,
  };
}

function closedCategory(s, det, configured) {
  s.phase = 'unsupported';
  const m = categoryMessage(det, configured);
  return { state: s, ui: { screen: det.status === 'not_configured' ? 'not_configured' : 'unsupported', category: det.category, message: m.message, tiles: m.tiles } };
}

function tiles(s, det, configured, reason) {
  s.phase = 'tiles';
  const m = categoryMessage({ ...det, status: 'unclear' }, configured);
  return { state: s, ui: { screen: 'tiles', reason, message: m.message, tiles: m.tiles } };
}

function errorUi(s, ctx, error) {
  return { state: s, ui: { ...(s.category ? common(s, ctx) : {}), screen: 'error', error, pending: s.pending } };
}

export { CATEGORIES, valueLabel };
