// Small shared helpers. No I/O, no clock reads: every time value is passed in.

export const HOUR_MS = 3600 * 1000;
export const DAY_MS = 24 * HOUR_MS;

/**
 * Round to 2 decimals. Used on every number that is compared or shown, so ties are stable (tech-spec 5).
 * @param {number} x
 * @returns {number}
 */
export function round2(x) {
  if (typeof x !== 'number' || !Number.isFinite(x)) return x;
  const r = Math.round((x + Math.sign(x) * Number.EPSILON) * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
}

/**
 * Accepts a Date, an ISO string or epoch milliseconds and returns epoch milliseconds.
 * @param {Date|string|number} t
 * @returns {number}
 */
export function toMs(t) {
  if (t instanceof Date) return t.getTime();
  if (typeof t === 'number') return t;
  if (typeof t === 'string') {
    // A bare date (YYYY-MM-DD) means the END of that day in UTC: a promo "valid until 12 Oct" is valid all of 12 Oct.
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return Date.parse(t + 'T23:59:59.999Z');
    return Date.parse(t);
  }
  return NaN;
}

/** @param {number} a @param {number} b */
export function cmpNum(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** @param {string} a @param {string} b */
export function cmpStr(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Read a dotted path ("money.budget") from an object.
 * @param {any} obj
 * @param {string} path
 */
export function getPath(obj, path) {
  let cur = obj;
  for (const k of path.split('.')) {
    if (cur == null) return undefined;
    cur = cur[k];
  }
  return cur;
}

/**
 * Write a dotted path, creating objects on the way.
 * @param {any} obj
 * @param {string} path
 * @param {any} value
 */
export function setPath(obj, path, value) {
  const keys = path.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (cur[keys[i]] == null || typeof cur[keys[i]] !== 'object') cur[keys[i]] = {};
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
}

/** @template T @param {T|T[]|null|undefined} v @returns {T[]} */
export function asArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

/** Format an EGP amount with thousands separators and Western digits (tech-spec 9). */
export function fmtEgp(n) {
  return Math.round(n).toLocaleString('en-US') + ' EGP';
}

/** Last Friday of November of the given UTC year (White Friday, technical-design-v4 timing rules). */
export function lastFridayOfNovember(year) {
  const d = new Date(Date.UTC(year, 10, 30));
  while (d.getUTCDay() !== 5) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}
