// Layer 2 public entry point.
//
//   match(needProfile, catalogSnapshot, now, mode = 'rank', options = {})
//
// A pure, deterministic function: same profile + same snapshot + same `now` => same result. It never reads
// free text, never asks a question, never reads the clock (time comes in as `now`), never logs.
// The snapshot is treated as immutable (prepared indexes are cached per snapshot object).
//
// Modes
//   rank      full pipeline M1..M9: picks with roles, others, warnings, gaveUp, trace.
//   simulate  M1..M7 only: {count, stretchCount, top1, top3, closest}. Read-only, no explanation, no trace.
//             Layer 1 calls it per hypothetical answer (question gain, tile counts).
import { toMs } from '../util.js';
import { validateNeedProfile } from '../contracts.js';
import { prepare } from './snapshot.js';
import { runPipeline, bestFitOf, closestOverBudget } from './pipeline.js';
import { pickRoles } from './m8-roles.js';
import { extraNeeded } from './m5-afford.js';
import { buildPick, listRow, modelVerdict, whyNotPopular, timingAdvice, globalWarnings, buildTrace, findModel } from './m9-explain.js';
import { ENGINE_VERSION } from './constants.js';

export { ENGINE_VERSION };

/**
 * @typedef {Object} MatchOptions
 * @property {number} [maxPicks=3]   Picks with roles (per tenant for B2B).
 * @property {number} [maxList=10]   Length of the full ranked list ("show the rest"), picks included.
 * @property {boolean} [validate=true]  Validate the profile in rank mode (simulate never validates, for speed).
 */

/**
 * @param {import('../contracts.js').NeedProfile} needProfile
 * @param {import('../contracts.js').CatalogSnapshot} catalogSnapshot
 * @param {Date|string|number} now
 * @param {'rank'|'simulate'} [mode='rank']
 * @param {MatchOptions} [options]
 */
export function match(needProfile, catalogSnapshot, now, mode = 'rank', options = {}) {
  const nowMs = toMs(now);
  if (!Number.isFinite(nowMs)) throw new TypeError('match: `now` must be a Date, ISO string or epoch ms');
  if (mode !== 'rank' && mode !== 'simulate') throw new TypeError('match: mode must be "rank" or "simulate"');
  if (!catalogSnapshot || typeof catalogSnapshot !== 'object' || !catalogSnapshot.tenant_id) throw new TypeError('match: catalogSnapshot with tenant_id required');
  const prep = prepare(catalogSnapshot, needProfile && needProfile.category);
  if (mode === 'rank' && options.validate !== false) {
    const v = validateNeedProfile(needProfile, prep.config);
    if (!v.ok) throw new TypeError('match: invalid NeedProfile: ' + v.errors.join('; '));
  }
  const run = runPipeline(prep, needProfile, nowMs);
  return mode === 'simulate' ? simulateResult(run) : rankResult(prep, run, needProfile, nowMs, options);
}

/** simulate: counts and ids only. */
function simulateResult(run) {
  const best = bestFitOf(run.eligible);
  const top3 = best ? [best, ...run.eligible.filter((i) => i !== best)].slice(0, 3).map((i) => i.product.id) : [];
  const closest = best ? null : closestOverBudget(run);
  return {
    mode: 'simulate',
    count: run.eligible.length,
    stretchCount: run.stretch.length,
    top1: best ? best.product.id : null,
    top1Shop: best ? best.quote.retailerId : null,
    top3,
    closest: closest ? closest.product.id : null,
  };
}

/** rank: the full result. */
function rankResult(prep, run, profile, nowMs, options) {
  const maxPicks = Number.isInteger(options.maxPicks) && options.maxPicks >= 0 ? options.maxPicks : prep.params.maxPicks;
  const maxList = Number.isInteger(options.maxList) && options.maxList >= 0 ? options.maxList : prep.params.maxList;
  const internalPicks = pickRoles(run.eligible, run.stretch, maxPicks, prep.params);
  const picks = internalPicks.map((p) => buildPick(prep, run, p, nowMs));

  // "Show the rest": the full ranked list is at most maxList long, picks included (decision D-list).
  const picked = new Set(internalPicks.map((p) => p.item));
  const rest = [...run.eligible, ...run.stretch].filter((i) => !picked.has(i));
  const others = rest.slice(0, Math.max(0, maxList - picks.length)).map((it, idx) => listRow(it, picks.length + idx + 1));

  let status = 'ok';
  let nothingFits = null;
  if (!picks.length) {
    const closest = closestOverBudget(run);
    if (closest) {
      status = 'nothing_fits';
      nothingFits = {
        product: { id: closest.product.id, name: closest.product.name, brand: closest.product.brand },
        fit: closest.fit,
        quote: closest.quote,
        extraNeeded: extraNeeded(closest.quote, run.buyer),
        text: { en: 'Nothing that meets your need fits this budget. This is the cheapest product that meets it, and how much more it needs.', ar: 'مفيش حاجة تناسب احتياجك في الميزانية دي. ده أرخص اختيار يناسب احتياجك، والفرق اللي محتاجه.' },
      };
    } else {
      status = 'no_match';
      nothingFits = {
        product: null, extraNeeded: [],
        text: { en: 'No product in the catalog meets this need with an available offer.', ar: 'مفيش منتج في الكتالوج يناسب الاحتياج ده بعرض متاح.' },
      };
    }
  }

  const modelProduct = profile.modelInMind ? findModel(prep, profile.modelInMind) : null;
  const best = internalPicks[0] ? internalPicks[0].item : null;
  return {
    mode: 'rank',
    engine_version: ENGINE_VERSION,
    snapshot_id: prep.snapshot.snapshot_id,
    tenant_id: prep.tenant,
    category: prep.config.id,
    config_version: prep.config.version,
    now: new Date(nowMs).toISOString(),
    status,
    picks,
    others,
    warnings: globalWarnings(prep, run, profile, picks[0] || null),
    gaveUp: run.gaveUp.map((s) => ({ id: s.id, kind: s.kind, why: s.why, ...(s.filter ? { filter: s.filter } : {}), ...(s.value !== undefined ? { value: s.value } : {}) })),
    nothingFits,
    modelVerdict: modelVerdict(prep, run, internalPicks, profile.modelInMind),
    whyNotPopular: whyNotPopular(prep, run, internalPicks, modelProduct ? modelProduct.id : null),
    timing: timingAdvice(prep, run, best, nowMs),
    assumptions: {
      pay: run.buyer.payAssumed ? 'cash' : null,
      city: run.buyer.zoneAssumed ? 'nationwide' : null,
    },
    counts: {
      inScope: prep.products.length,
      loaded: run.loaded.candidates.length,
      meetNeed: run.must.kept.length,
      eligible: run.eligible.length,
      stretch: run.stretch.length,
      over: run.over.length,
    },
    trace: buildTrace(prep, run, internalPicks, profile),
  };
}
