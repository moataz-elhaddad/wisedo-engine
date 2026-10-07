// Engine rules from Technical Design v4 (source of truth for formulas). Category-specific values
// (maxMonths, freshness, zones, resale, season) live in the category config instead.
export const ENGINE_VERSION = 'layer2-0.1.0';

/** M5: ratio <= 1 is eligible, <= STRETCH is a stretch option. */
export const STRETCH = 1.15;

/** M7 deal bonus: clamp(DEAL_POINTS * (ref - effCost) / ref, -DEAL_CAP, DEAL_CAP). */
export const DEAL_POINTS = 50;
export const DEAL_CAP = 5;

/** M4 ranking cost: effCost * (1 + (TRUST_PIVOT - trust) * RISK_PER_TRUST_POINT). */
export const TRUST_PIVOT = 9;
export const RISK_PER_TRUST_POINT = 0.01;

/** M4 warnings. */
export const FINANCING_WARN_SHARE = 0.35;
export const PROMO_WARN_DAYS = 14;

/** M8 roles. */
export const VALUE_MIN_FIT_SHARE = 0.8;
export const VALUE_EXPONENT = 0.6;
export const PREMIUM_MIN_POINTS = 3;
export const CHEAPER_MAX_COST_SHARE = 0.8;
export const CHEAPER_MIN_FIT_SHARE = 0.7;
/** Order in which roles fill the pick slots (see docs/BUILD-NOTES.md, decision D-roles). */
export const ROLE_ORDER = ['best_fit', 'best_value', 'premium', 'cheaper', 'alternative'];

/** tech-spec 5 "Number of picks": defaults, overridable per tenant through options. */
export const DEFAULT_MAX_PICKS = 3;
export const DEFAULT_MAX_LIST = 10;

/** M9: a popular model is discussed in "why not the popular model" only if it is within reach. */
export const POPULAR_MAX_RATIO = 1.4;

/** M3: score an unknown attribute at the category midpoint. */
export const UNKNOWN_NORM = 0.5;

/** Label shown on a card for an unknown attribute (BR-37). */
export const NOT_LISTED = { ar: 'غير مذكور', en: 'not listed' };

