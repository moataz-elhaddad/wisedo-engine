// The shared M1..M7 pipeline used by both modes. rank adds M8 roles and M9 explanations on top;
// simulate reads the ranked lists directly. Pure: no clock, no I/O, no randomness, no logging.
import { cmpNum, cmpStr, round2 } from '../util.js';
import { loadCandidates } from './m1-candidates.js';
import { applyMust, evalFilter } from './m2-constraints.js';
import { effectiveWeights, fitScore } from './m3-fit.js';
import { buyerFromProfile, evaluateOffers, bestOffer } from './m4-offers.js';
import { affordability } from './m5-afford.js';
import { softConstraints, relax } from './m6-relax.js';
import { dealBonus, brandBonus, tco } from './m7-score.js';

/** Ranked order: higher score first, ties by product id (tech-spec 5). */
export function byScore(a, b) {
  return cmpNum(b.score, a.score) || cmpStr(a.product.id, b.product.id);
}

/**
 * Run M1..M7.
 * @param {any} prep                                  prepared snapshot
 * @param {import('../contracts.js').NeedProfile} profile
 * @param {number} nowMs
 */
export function runPipeline(prep, profile, nowMs) {
  const buyer = buyerFromProfile(profile, prep);
  const weights = effectiveWeights(prep, profile.weights);

  // M1
  const loaded = loadCandidates(prep, nowMs);
  // M2
  const must = applyMust(loaded.candidates, profile.must || []);
  // M3 + M4 (quotes do not depend on which soft constraints are active; M6 only selects among them)
  const items = must.kept.map((c) => {
    const { fit, unknown } = fitScore(c.product, weights);
    const evals = evaluateOffers(prep, buyer, c.product, c.offers, nowMs);
    return { product: c.product, offers: c.offers, evals, fit, unknown, unknownMust: c.unknownMust };
  });

  // M5 + M6
  const softs = softConstraints(profile, buyer);
  const evaluate = (active) => {
    const flags = {
      slow: active.some((s) => s.kind === 'urgent'),
      shop: active.some((s) => s.kind === 'shops'),
      cod: active.some((s) => s.kind === 'cod'),
    };
    const prefers = active.filter((s) => s.kind === 'prefer');
    const states = new Map();
    let eligibleCount = 0;
    for (const it of items) {
      const failed = prefers.find((s) => evalFilter(it.product, s.filter) === false);
      if (failed) { states.set(it, { excludedBy: failed.id, best: null, afford: null }); continue; }
      const best = bestOffer(it.evals, flags);
      if (!best) { states.set(it, { excludedBy: 'no_offer', best: null, afford: null }); continue; }
      const afford = affordability(best.quote.ratio, prep.params.stretch);
      if (afford === 'eligible') eligibleCount++;
      states.set(it, { excludedBy: null, best, afford });
    }
    return { states, eligibleCount, flags };
  };
  const { state, active, gaveUp } = relax(softs, evaluate);

  // M7
  const eligible = [], stretch = [], over = [], excluded = [];
  for (const it of items) {
    const st = state.states.get(it);
    it.excludedBy = st.excludedBy;
    it.best = st.best;
    it.afford = st.afford;
    it.unknownPrefer = active.filter((s) => s.kind === 'prefer' && evalFilter(it.product, s.filter) === 'unknown').map((s) => s.filter);
    it.verified = it.unknown.length === 0 && it.unknownMust.length === 0 && it.unknownPrefer.length === 0;
    if (!it.best) { excluded.push(it); continue; }
    it.quote = it.best.quote;
    it.dealBonus = dealBonus(it.product, it.quote, prep.params);
    it.brandBonus = brandBonus(it.product, profile.bonus);
    it.score = round2(it.fit + it.dealBonus + it.brandBonus);
    it.tco = tco(prep.config, profile, it.product, it.quote);
    if (it.afford === 'eligible') eligible.push(it);
    else if (it.afford === 'stretch') stretch.push(it);
    else over.push(it);
  }
  eligible.sort(byScore);
  stretch.sort(byScore);
  over.sort(byScore);

  return { buyer, weights, loaded, must, items, softs, active, gaveUp, flags: state.flags, eligible, stretch, over, excluded };
}

/**
 * Best fit under the missing-data rule: the highest-scoring eligible product with verified data;
 * only when none is verified may an unverified product take the role (BR-37).
 * @param {any[]} eligibleRanked
 */
export function bestFitOf(eligibleRanked) {
  return eligibleRanked.find((i) => i.verified) || eligibleRanked[0] || null;
}

/**
 * Nothing eligible: the cheapest product that meets the need (passes every must and has a usable offer).
 * "Cheapest" = lowest affordability ratio, then lowest effective cost, then product id.
 * @param {any} run
 */
export function closestOverBudget(run) {
  const pool = [...run.stretch, ...run.over];
  pool.sort((a, b) => cmpNum(a.quote.ratio, b.quote.ratio) || cmpNum(a.quote.effCost, b.quote.effCost) || cmpStr(a.product.id, b.product.id));
  return pool[0] || null;
}
