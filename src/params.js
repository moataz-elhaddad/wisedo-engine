// Every tunable number of the engine in one place, shared by Layer 1 and Layer 2 (neither imports the other's code).
// The constants in layer2/constants.js are the defaults; a category config may override any of them with
// `config.params` (the admin panel writes that block). Always read through paramsOf(config).
import {
  STRETCH, DEAL_POINTS, DEAL_CAP, TRUST_PIVOT, RISK_PER_TRUST_POINT, FINANCING_WARN_SHARE, PROMO_WARN_DAYS,
  VALUE_MIN_FIT_SHARE, VALUE_EXPONENT, PREMIUM_MIN_POINTS, CHEAPER_MAX_COST_SHARE, CHEAPER_MIN_FIT_SHARE,
  DEFAULT_MAX_PICKS, DEFAULT_MAX_LIST, POPULAR_MAX_RATIO, UNKNOWN_NORM,
} from './layer2/constants.js';

export const DEFAULT_PARAMS = Object.freeze({
  stretch: STRETCH,
  dealPoints: DEAL_POINTS,
  dealCap: DEAL_CAP,
  trustPivot: TRUST_PIVOT,
  riskPerTrustPoint: RISK_PER_TRUST_POINT,
  financingWarnShare: FINANCING_WARN_SHARE,
  promoWarnDays: PROMO_WARN_DAYS,
  valueMinFitShare: VALUE_MIN_FIT_SHARE,
  valueExponent: VALUE_EXPONENT,
  premiumMinPoints: PREMIUM_MIN_POINTS,
  cheaperMaxCostShare: CHEAPER_MAX_COST_SHARE,
  cheaperMinFitShare: CHEAPER_MIN_FIT_SHARE,
  maxPicks: DEFAULT_MAX_PICKS,
  maxList: DEFAULT_MAX_LIST,
  popularMaxRatio: POPULAR_MAX_RATIO,
  unknownNorm: UNKNOWN_NORM,
  layer1: Object.freeze({ maxQuestions: 8, minGain: 1.3, materialPoints: 3, prefillThreshold: 0.7 }),
});

/**
 * Defaults plus the config's own `params` (unknown keys ignored, non-finite numbers ignored).
 * @param {any} config
 */
export function paramsOf(config) {
  const own = (config && config.params) || {};
  const out = { ...DEFAULT_PARAMS, layer1: { ...DEFAULT_PARAMS.layer1 } };
  for (const k of Object.keys(DEFAULT_PARAMS)) {
    if (k === 'layer1') continue;
    if (typeof own[k] === 'number' && Number.isFinite(own[k])) out[k] = own[k];
  }
  const l1 = own.layer1 || {};
  for (const k of Object.keys(DEFAULT_PARAMS.layer1)) {
    if (typeof l1[k] === 'number' && Number.isFinite(l1[k])) out.layer1[k] = l1[k];
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Admin panel support: what can be tuned, how a set of changes ("overrides") is validated and applied to a config.
// Overrides are a small JSON object, so a change is easy to review, version, publish and roll back:
//   { params: {stretch, layer1: {minGain}}, baseWeights: {perf: 1.2}, effects: {use: {gaming: {perf: 1.5}}},
//     freshness: {priceStockHours: 12}, maxMonths: 18, tcoYears: 4,
//     season: {white_friday: {savingShare: [0.1, 0.2], windowWeeks: [1, 10]}} }
// ---------------------------------------------------------------------------------------------------------------

/**
 * @typedef {Object} ParamSpec
 * @property {string} path     dot path inside the overrides object
 * @property {string} group
 * @property {string} label
 * @property {string} help     what it does, in the buyer's or merchant's terms
 * @property {number} min
 * @property {number} max
 * @property {number} step
 * @property {'number'|'share'|'int'|'hours'|'days'|'points'} kind  share = shown as a percent
 */

/** @type {ParamSpec[]} */
export const PARAM_SPECS = [
  // Budget gate
  { path: 'params.stretch', group: 'budget', label: 'Stretch ceiling', kind: 'share', min: 1, max: 1.5, step: 0.01,
    help: 'How far over the budget (or monthly cap) an offer may be and still show as a "stretch" option. 15% means up to 1.15 times the budget.' },
  // Ranking
  { path: 'params.dealPoints', group: 'ranking', label: 'Deal bonus strength', kind: 'points', min: 0, max: 100, step: 1,
    help: 'Points added to the fit score per 100% saved against the reference price. Higher means good deals matter more than spec fit.' },
  { path: 'params.dealCap', group: 'ranking', label: 'Deal bonus cap', kind: 'points', min: 0, max: 20, step: 0.5,
    help: 'The most points a deal can add or remove. Keeps a very cheap offer from beating a clearly better phone.' },
  { path: 'params.trustPivot', group: 'ranking', label: 'Shop trust: neutral level', kind: 'number', min: 1, max: 10, step: 0.5,
    help: 'Shop trust score (1 to 10) that carries no penalty. Shops below it are treated as costlier for ranking.' },
  { path: 'params.riskPerTrustPoint', group: 'ranking', label: 'Shop trust: penalty per point', kind: 'share', min: 0, max: 0.05, step: 0.005,
    help: 'Extra cost share added for each trust point below the neutral level, when comparing offers.' },
  { path: 'params.unknownNorm', group: 'ranking', label: 'Unknown spec counts as', kind: 'share', min: 0, max: 1, step: 0.05,
    help: 'Where a spec we do not know sits between worst (0%) and best (100%). 50% means neutral.' },
  // Pick roles
  { path: 'params.maxPicks', group: 'roles', label: 'Picks shown', kind: 'int', min: 1, max: 5, step: 1,
    help: 'How many recommended phones the buyer sees (best match, best value, premium, cheaper, alternative, in that order).' },
  { path: 'params.maxList', group: 'roles', label: 'Longest list ("show the rest")', kind: 'int', min: 3, max: 20, step: 1,
    help: 'Most phones listed after the picks.' },
  { path: 'params.valueMinFitShare', group: 'roles', label: 'Best value: minimum fit', kind: 'share', min: 0.5, max: 1, step: 0.01,
    help: 'A best-value phone must reach this share of the best match\'s fit score.' },
  { path: 'params.valueExponent', group: 'roles', label: 'Best value: price sensitivity', kind: 'number', min: 0, max: 1.5, step: 0.05,
    help: 'Higher favours cheaper phones when choosing best value. 0 ignores price, 1 is fit per unit of cost.' },
  { path: 'params.premiumMinPoints', group: 'roles', label: 'Premium: minimum lead', kind: 'points', min: 0, max: 15, step: 0.5,
    help: 'A premium option must score at least this many points above the best match.' },
  { path: 'params.cheaperMaxCostShare', group: 'roles', label: 'Cheaper: at most this share of cost', kind: 'share', min: 0.4, max: 1, step: 0.01,
    help: 'A cheaper option must cost no more than this share of the best match\'s total cost.' },
  { path: 'params.cheaperMinFitShare', group: 'roles', label: 'Cheaper: minimum fit', kind: 'share', min: 0.4, max: 1, step: 0.01,
    help: 'A cheaper option must keep at least this share of the best match\'s fit score.' },
  { path: 'params.popularMaxRatio', group: 'roles', label: 'Popular phone: reach limit', kind: 'share', min: 1, max: 3, step: 0.05,
    help: 'A popular phone is explained ("why not the popular model") only if it costs up to this multiple of the budget.' },
  // Warnings and offers
  { path: 'params.financingWarnShare', group: 'offers', label: 'Installment warning above', kind: 'share', min: 0, max: 1, step: 0.01,
    help: 'Warn when installments add more than this share to the cash price.' },
  { path: 'params.promoWarnDays', group: 'offers', label: 'Promo-ending warning (days)', kind: 'days', min: 0, max: 60, step: 1,
    help: 'Warn when an installment promotion ends within this many days.' },
  { path: 'maxMonths', group: 'offers', label: 'Longest installment plan (months)', kind: 'int', min: 3, max: 60, step: 1,
    help: 'Plans longer than this are ignored.' },
  { path: 'tcoYears', group: 'offers', label: 'Total cost horizon (years)', kind: 'int', min: 1, max: 10, step: 1,
    help: 'How many years of ownership the "total cost" used by Best value looks at.' },
  // Freshness
  { path: 'freshness.priceStockHours', group: 'freshness', label: 'Price and stock freshness (hours)', kind: 'hours', min: 1, max: 240, step: 1,
    help: 'An offer older than this is not used for ranking.' },
  { path: 'freshness.deliveryGiftsHours', group: 'freshness', label: 'Delivery and gifts freshness (hours)', kind: 'hours', min: 1, max: 720, step: 1,
    help: 'Gifts older than this are not counted in the cost.' },
  { path: 'freshness.plansDays', group: 'freshness', label: 'Installment plans freshness (days)', kind: 'days', min: 1, max: 120, step: 1,
    help: 'A plan not re-checked within this many days is skipped.' },
  { path: 'freshness.specsDays', group: 'freshness', label: 'Specs freshness (days)', kind: 'days', min: 1, max: 365, step: 1,
    help: 'A product whose specs were checked longer ago than this is left out.' },
  // Questions (Layer 1)
  { path: 'params.layer1.maxQuestions', group: 'questions', label: 'Most questions asked', kind: 'int', min: 1, max: 12, step: 1,
    help: 'Hard cap on questions per session. After it the result is shown.' },
  { path: 'params.layer1.minGain', group: 'questions', label: 'A question must be worth', kind: 'number', min: 1, max: 3, step: 0.1,
    help: 'Minimum "gain" (how much the answer changes the best pick and shop) before a non-core question is asked. Higher means fewer questions.' },
  { path: 'params.layer1.materialPoints', group: 'questions', label: 'A change of #1 counts when', kind: 'points', min: 0, max: 10, step: 0.5,
    help: 'The old best match must trail the new one by at least this many points; closer than that is a near tie and does not justify a question.' },
  { path: 'params.layer1.prefillThreshold', group: 'questions', label: 'Pre-fill confidence', kind: 'share', min: 0.3, max: 1, step: 0.05,
    help: 'Confidence needed before a detail read from free text becomes a chip. Lower reads are shown only as suggestions.' },
  // Season (white friday)
  { path: 'season.white_friday.savingShare.0', group: 'season', label: 'White Friday saving: low', kind: 'share', min: 0, max: 0.5, step: 0.01,
    help: 'Low end of the expected saving shown in the "wait for White Friday" tip.' },
  { path: 'season.white_friday.savingShare.1', group: 'season', label: 'White Friday saving: high', kind: 'share', min: 0, max: 0.5, step: 0.01,
    help: 'High end of the expected saving shown in the tip.' },
  { path: 'season.white_friday.windowWeeks.0', group: 'season', label: 'White Friday tip: from (weeks before)', kind: 'int', min: 0, max: 26, step: 1,
    help: 'The tip starts showing this many weeks before the sale.' },
  { path: 'season.white_friday.windowWeeks.1', group: 'season', label: 'White Friday tip: until (weeks before)', kind: 'int', min: 0, max: 26, step: 1,
    help: 'The tip stops showing when the sale is further than this many weeks away.' },
];

export const PARAM_GROUPS = [
  { id: 'ranking', label: 'Ranking', help: 'How offers and phones are scored against each other.' },
  { id: 'budget', label: 'Budget gate', help: 'What counts as affordable.' },
  { id: 'roles', label: 'Picks and roles', help: 'How many phones are shown and what makes each role.' },
  { id: 'offers', label: 'Offers and warnings', help: 'Installments, total cost and the warnings shown on cards.' },
  { id: 'freshness', label: 'Data freshness', help: 'How old a price, plan or spec may be before it is ignored.' },
  { id: 'questions', label: 'Questions', help: 'When the assistant asks and when it stops.' },
  { id: 'season', label: 'Season tips', help: 'The "wait for the sale" advice.' },
];

/** Read a dot path (array indexes allowed) from an object, or undefined. */
export function getPath(obj, path) {
  let cur = obj;
  for (const k of path.split('.')) {
    if (cur == null) return undefined;
    cur = cur[k];
  }
  return cur;
}

/** Set a dot path, creating objects (or arrays for numeric keys) on the way. Mutates and returns obj. */
export function setPath(obj, path, value) {
  const keys = path.split('.');
  let cur = obj;
  keys.forEach((k, i) => {
    if (i === keys.length - 1) { cur[k] = value; return; }
    if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = /^\d+$/.test(keys[i + 1]) ? [] : {};
    cur = cur[k];
  });
  return obj;
}

/** Delete a dot path and tidy empty parents. */
export function unsetPath(obj, path) {
  const keys = path.split('.');
  const parents = [obj];
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) { cur = cur && cur[keys[i]]; parents.push(cur); if (cur == null) return obj; }
  delete cur[keys[keys.length - 1]];
  if (Array.isArray(cur)) { /* keep sparse arrays out of the saved JSON */ if (cur.every((x) => x === undefined || x === null)) delete parents[parents.length - 2][keys[keys.length - 2]]; }
  for (let i = keys.length - 2; i >= 0; i--) {
    const o = parents[i + 1];
    if (o && !Array.isArray(o) && Object.keys(o).length === 0) delete parents[i][keys[i]];
  }
  return obj;
}

/** The value a spec has in the base config (before any override). */
export function baseValue(spec, baseConfig) {
  const p = spec.path;
  if (p.startsWith('params.layer1.')) return DEFAULT_PARAMS.layer1[p.slice('params.layer1.'.length)];
  if (p.startsWith('params.')) return DEFAULT_PARAMS[p.slice('params.'.length)];
  if (p.startsWith('season.')) {
    const [, id, field, idx] = p.split('.');
    const ev = ((baseConfig.season && baseConfig.season.saleEvents) || []).find((e) => e.id === id);
    return ev && ev[field] ? ev[field][Number(idx)] : undefined;
  }
  return getPath(baseConfig, p);
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Check a set of overrides against the specs and the base config. Returns a cleaned copy (only valid, clamped,
 * actually-different values) and a list of problems.
 * @param {any} overrides
 * @param {any} baseConfig
 */
export function cleanOverrides(overrides, baseConfig) {
  const out = {};
  const problems = [];
  const ov = overrides || {};
  for (const spec of PARAM_SPECS) {
    const v = getPath(ov, spec.path);
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isFinite(v)) { problems.push(`${spec.label}: not a number`); continue; }
    let x = clamp(v, spec.min, spec.max);
    if (spec.kind === 'int') x = Math.round(x);
    if (x !== v) problems.push(`${spec.label}: ${v} is outside ${spec.min} to ${spec.max}, using ${x}`);
    if (x !== baseValue(spec, baseConfig)) setPath(out, spec.path, x);
  }
  // Priorities
  const attrs = new Set((baseConfig.attributes || []).map((a) => a.id));
  for (const [k, v] of Object.entries(ov.baseWeights || {})) {
    if (!attrs.has(k) || !(k in baseConfig.baseWeights)) { problems.push(`weight "${k}": unknown attribute`); continue; }
    if (typeof v !== 'number' || !Number.isFinite(v)) { problems.push(`weight "${k}": not a number`); continue; }
    const x = clamp(Math.round(v * 100) / 100, 0, 3);
    if (x !== baseConfig.baseWeights[k]) setPath(out, `baseWeights.${k}`, x);
  }
  for (const [slotId, opts] of Object.entries(ov.effects || {})) {
    const slot = (baseConfig.slots || []).find((s) => s.id === slotId);
    if (!slot) { problems.push(`effects: unknown question "${slotId}"`); continue; }
    for (const [optId, w] of Object.entries(opts || {})) {
      const opt = (slot.options || []).find((o) => o.id === optId);
      if (!opt) { problems.push(`effects: unknown answer "${slotId}/${optId}"`); continue; }
      const baseW = (opt.effects && opt.effects.weights) || {};
      const next = {};
      for (const [attr, v] of Object.entries(w || {})) {
        if (!attrs.has(attr) || typeof v !== 'number' || !Number.isFinite(v)) { problems.push(`effects ${slotId}/${optId}/${attr}: invalid`); continue; }
        next[attr] = clamp(Math.round(v * 100) / 100, -3, 3);
      }
      const same = Object.keys({ ...baseW, ...next }).every((a) => (baseW[a] || 0) === (next[a] || 0));
      if (!same) setPath(out, `effects.${slotId}.${optId}`, next);
    }
  }
  if (out.season && out.season.white_friday) {
    // the low end may never pass the high end
    const sw = out.season.white_friday;
    const base = ((baseConfig.season && baseConfig.season.saleEvents) || []).find((e) => e.id === 'white_friday') || {};
    for (const field of ['savingShare', 'windowWeeks']) {
      if (!sw[field]) continue;
      const lo = sw[field][0] ?? base[field][0], hi = sw[field][1] ?? base[field][1];
      if (lo > hi) { problems.push(`${field}: low is above high, swapped`); sw[field] = [hi, lo]; }
      else sw[field] = [lo, hi];
    }
  }
  return { overrides: out, problems };
}

/**
 * A copy of the base config with the overrides applied. The result is a normal category config: the engine needs
 * no other change. `config.params` holds the numeric tunables for paramsOf().
 * @param {any} baseConfig
 * @param {any} overrides
 * @returns {{config: any, overrides: any, problems: string[]}}
 */
export function applyOverrides(baseConfig, overrides) {
  const { overrides: ov, problems } = cleanOverrides(overrides, baseConfig);
  const config = structuredClone(baseConfig);
  if (ov.params) config.params = structuredClone(ov.params);
  if (ov.baseWeights) Object.assign(config.baseWeights, ov.baseWeights);
  for (const [slotId, opts] of Object.entries(ov.effects || {})) {
    const slot = config.slots.find((s) => s.id === slotId);
    for (const [optId, w] of Object.entries(opts)) {
      const opt = slot.options.find((o) => o.id === optId);
      const weights = Object.fromEntries(Object.entries(w).filter(([, v]) => v !== 0));
      opt.effects = { ...(opt.effects || {}), weights };
      if (!Object.keys(weights).length) delete opt.effects.weights;
      if (!Object.keys(opt.effects).length) delete opt.effects;
    }
  }
  if (ov.freshness) Object.assign(config.freshness, ov.freshness);
  if (ov.maxMonths !== undefined) config.maxMonths = ov.maxMonths;
  if (ov.tcoYears !== undefined) config.tcoYears = ov.tcoYears;
  if (ov.season && ov.season.white_friday) {
    const ev = (config.season.saleEvents || []).find((e) => e.id === 'white_friday');
    if (ev) for (const f of ['savingShare', 'windowWeeks']) if (ov.season.white_friday[f]) ev[f] = ov.season.white_friday[f];
  }
  config.version = `${baseConfig.version}+custom`;
  return { config, overrides: ov, problems };
}

/** Flat list of every override as {key, label, from, to} for review screens and the change log. */
export function listChanges(overrides, baseConfig) {
  const ov = overrides || {};
  const rows = [];
  for (const spec of PARAM_SPECS) {
    const v = getPath(ov, spec.path);
    if (v !== undefined) rows.push({ key: spec.path, label: spec.label, from: baseValue(spec, baseConfig), to: v });
  }
  for (const [k, v] of Object.entries(ov.baseWeights || {})) rows.push({ key: `baseWeights.${k}`, label: `Priority: ${k}`, from: baseConfig.baseWeights[k], to: v });
  for (const [slotId, opts] of Object.entries(ov.effects || {})) {
    const slot = baseConfig.slots.find((s) => s.id === slotId);
    for (const [optId, w] of Object.entries(opts)) {
      const opt = slot && slot.options.find((o) => o.id === optId);
      const baseW = (opt && opt.effects && opt.effects.weights) || {};
      for (const a of new Set([...Object.keys(baseW), ...Object.keys(w)])) {
        if ((baseW[a] || 0) !== (w[a] || 0)) rows.push({ key: `effects.${slotId}.${optId}.${a}`, label: `${slotId} / ${optId}: ${a}`, from: baseW[a] || 0, to: w[a] || 0 });
      }
    }
  }
  return rows;
}
