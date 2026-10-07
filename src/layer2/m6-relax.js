// M6 Relaxer. If nothing is eligible, drop soft constraints one at a time and record each in "what I gave up".
//
// Relax order (decision D-relax in docs/BUILD-NOTES.md):
//   1. cash on delivery "prefer"      (never asked; set from text)
//   2. preferred shops                (never asked; set from text)
//   3. product prefer-filters, latest stated first (highest `order`)
//   4. urgent delivery, always last   (tech-spec 5 M6, technical-design-v4)

const CODE_TEXT = {
  cod: { en: 'Cash on delivery (preferred)', ar: 'الدفع عند الاستلام (مفضّل)' },
  shops: { en: 'Your preferred shops', ar: 'المحلات اللي بتفضّلها' },
  urgent: { en: 'Fast delivery', ar: 'التوصيل السريع' },
};

/**
 * Soft constraints of a profile, in the order M6 drops them.
 * @param {import('../contracts.js').NeedProfile} profile
 * @param {import('./m4-offers.js').Buyer} buyer
 * @returns {{id: string, kind: 'cod'|'shops'|'prefer'|'urgent', filter?: any, value?: any, why: {en: string, ar: string}}[]}
 */
export function softConstraints(profile, buyer) {
  const out = [];
  if (buyer.cod === 'prefer') out.push({ id: 'cod', kind: 'cod', why: CODE_TEXT.cod });
  if (buyer.prefer.size) out.push({ id: 'shops', kind: 'shops', value: [...buyer.prefer].sort(), why: CODE_TEXT.shops });
  const prefs = (profile.prefer || []).map((f, i) => ({
    id: 'prefer:' + i, kind: /** @type {'prefer'} */ ('prefer'), filter: f, idx: i,
    order: typeof f.order === 'number' ? f.order : i + 1,
    why: { en: (f.why && f.why.en) || `${f.attr} ${f.op} ${JSON.stringify(f.value)}`, ar: (f.why && f.why.ar) || (f.why && f.why.en) || f.attr },
  }));
  prefs.sort((a, b) => b.order - a.order || b.idx - a.idx);
  for (const p of prefs) { delete p.idx; out.push(p); }
  if (buyer.urgentDays != null) out.push({ id: 'urgent', kind: 'urgent', value: buyer.urgentDays, why: CODE_TEXT.urgent });
  return out;
}

/**
 * Run the relax loop.
 * @template S
 * @param {any[]} softs                 in relax order
 * @param {(active: any[]) => S & {eligibleCount: number}} evaluate
 * @returns {{state: S, active: any[], gaveUp: any[]}}
 */
export function relax(softs, evaluate) {
  let active = softs.slice();
  let state = evaluate(active);
  const gaveUp = [];
  while (state.eligibleCount === 0 && active.length) {
    gaveUp.push(active[0]);
    active = active.slice(1);
    state = evaluate(active);
  }
  return { state, active, gaveUp };
}
