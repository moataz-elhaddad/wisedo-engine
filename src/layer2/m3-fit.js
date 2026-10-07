// M3 Need-fit scorer: fit(p) = 100 * sum(w_a * norm_a(p)) / sum(w_a), 0..100.
// Normalisation uses the config basis (fixed min/max for the whole category), so a score means the same
// thing in every session. Unknown attributes score the midpoint and are reported (missing data rule).
import { norm } from './snapshot.js';
import { round2 } from '../util.js';

/**
 * Effective weights: the profile's weights, or the config base weights when the profile has none.
 * Only scored attributes with a positive weight count.
 * @param {any} prep
 * @param {Record<string, number>} profileWeights
 * @returns {{attr: any, w: number}[]}
 */
export function effectiveWeights(prep, profileWeights) {
  const src = profileWeights && Object.keys(profileWeights).length ? profileWeights : prep.config.baseWeights;
  const out = [];
  for (const attr of prep.scored) {
    const w = src[attr.id];
    if (typeof w === 'number' && w > 0) out.push({ attr, w });
  }
  return out;
}

/**
 * @param {any} product
 * @param {{attr: any, w: number}[]} weights
 * @returns {{fit: number, unknown: string[]}}
 */
export function fitScore(product, weights) {
  let s = 0;
  let wsum = 0;
  const unknown = [];
  for (const { attr, w } of weights) {
    const { n, known } = norm(attr, product);
    if (!known) unknown.push(attr.id);
    s += w * n;
    wsum += w;
  }
  return { fit: wsum ? round2((100 * s) / wsum) : 50, unknown };
}
