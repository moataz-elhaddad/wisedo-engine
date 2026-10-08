// U4 Confirmer (tech-spec 4, component U4). Deterministic.
//
// - Pre-fills a slot from text only when confidence >= 0.7; lower-confidence reads are kept as open
//   suggestions ("Low-confidence answers shown as open, not as chips", tech-spec 9).
// - The buyer's word beats the LLM: a value the buyer answered or edited is locked for the session, and a later
//   extraction (more free text) never overwrites it.
// - Builds the chips: every value shows where it came from; every default is marked "assumed", never silent;
//   unknown city shows as "Greater Cairo (assumed)" (the config's assumedZone); unmapped items show as "Not used" chips with the reason.
import { REASON_LABELS } from './u3-normalize.js';
import { assumedZone } from '../util.js';

export const PREFILL_THRESHOLD = 0.7;

/**
 * Merge a normalised extraction into the state (in place on a state copy).
 * @param {import('./state.js').SessionState} state
 * @param {import('./u3-normalize.js').NormalizedExtraction} norm
 * @param {number} [threshold]  slot confidence needed to pre-fill (params.layer1.prefillThreshold)
 * @returns {{prefilled: string[], suggested: string[], ignoredLocked: string[]}}
 */
export function applyExtraction(state, norm, threshold = PREFILL_THRESHOLD) {
  const prefilled = [], suggested = [], ignoredLocked = [];
  for (const a of norm.answers) {
    const cur = state.values[a.slot];
    if (cur && cur.locked) { ignoredLocked.push(a.slot); continue; }
    if (a.confidence >= threshold) {
      /** @type {import('./state.js').SlotValue} */
      const v = { value: a.value, source: 'text', confidence: a.confidence, locked: false, seq: ++state.seq };
      if (a.evidence) v.evidence = a.evidence;
      state.values[a.slot] = v;
      state.suggestions = state.suggestions.filter((x) => x.slot !== a.slot);
      state.skipped = state.skipped.filter((x) => x !== a.slot);
      prefilled.push(a.slot);
    } else if (!cur) {
      state.suggestions = state.suggestions.filter((x) => x.slot !== a.slot);
      state.suggestions.push({ slot: a.slot, value: a.value, confidence: a.confidence, evidence: a.evidence });
      suggested.push(a.slot);
    }
  }
  for (const u of norm.unmapped) if (!state.unmapped.some((x) => x.text === u.text)) state.unmapped.push({ ...u });
  for (const d of norm.dropped) state.dropped.push({ ...d });
  return { prefilled, suggested, ignoredLocked };
}

/**
 * Record the buyer's own value for a slot (an answer to a question, or a chip edit). Locks it for the session.
 * A value of null clears the slot and still locks it, so the LLM cannot refill it.
 * @param {import('./state.js').SessionState} state
 * @param {string} slot
 * @param {any} value
 * @param {'answer'|'edit'} source
 */
export function setBuyerValue(state, slot, value, source) {
  state.values[slot] = { value, source, locked: true, seq: ++state.seq };
  state.suggestions = state.suggestions.filter((x) => x.slot !== slot);
  state.skipped = state.skipped.filter((x) => x !== slot);
}

/** "15,000 EGP" / "15,000 جنيه" */
function money(n, unit) {
  const s = Math.round(n).toLocaleString('en-US');
  const perMonth = unit && unit.includes('month');
  return { en: `${s} EGP${perMonth ? ' a month' : ''}`, ar: `${s} جنيه${perMonth ? ' في الشهر' : ''}` };
}

/**
 * Bilingual label for a slot value.
 * @param {any} slot
 * @param {any} value
 * @param {{products?: any[], retailers?: any[]}} [ctx]
 * @returns {{en: string, ar: string}}
 */
export function valueLabel(slot, value, ctx = {}) {
  if (value === null || value === undefined) return { en: '-', ar: '-' };
  if (slot.numeric && typeof value === 'number') return money(value, slot.numeric.unit);
  if (slot.valueShape === 'shops') {
    const name = (id) => ((ctx.retailers || []).find((r) => r.id === id) || { name: id }).name;
    const p = (value.prefer || []).map(name), a = (value.avoid || []).map(name);
    return {
      en: [p.length ? `prefer ${p.join(', ')}` : '', a.length ? `avoid ${a.join(', ')}` : ''].filter(Boolean).join('; '),
      ar: [p.length ? `يفضّل ${p.join('، ')}` : '', a.length ? `مش من ${a.join('، ')}` : ''].filter(Boolean).join('؛ '),
    };
  }
  if (slot.valueShape === 'product') {
    const p = (ctx.products || []).find((x) => x.id === value);
    const n = p ? p.name : String(value);
    return { en: n, ar: n };
  }
  const ids = Array.isArray(value) ? value : [value];
  const labels = ids.map((id) => (slot.options.find((o) => o.id === id) || { label: { en: id, ar: id } }).label);
  return { en: labels.map((l) => l.en).join(', '), ar: labels.map((l) => l.ar).join('، ') };
}

/**
 * @typedef {Object} Chip
 * @property {'value'|'assumed'|'not_used'|'open'} kind
 * @property {string} [slot]
 * @property {{en: string, ar: string}} [label]   slot label
 * @property {any} [value]
 * @property {{en: string, ar: string}} [valueLabel]
 * @property {string} [source]                    text | answer | edit | default
 * @property {boolean} [locked]
 * @property {number} [confidence]
 * @property {string} [evidence]
 * @property {boolean} [assumed]
 * @property {string} [text]                      not_used: the buyer's quote
 * @property {string} [reason]                    not_used: not_supported | no_data
 * @property {{en: string, ar: string}} [reasonLabel]
 * @property {boolean} editable
 */

/**
 * The chips for the "Understood" screen and the result header.
 * @param {any} config
 * @param {import('./state.js').SessionState} state
 * @param {import('../contracts.js').NeedProfile} profile  built from the same state (defaults applied)
 * @param {{products?: any[], retailers?: any[]}} [ctx]
 * @returns {{chips: Chip[], notUsed: Chip[], open: Chip[]}}
 */
export function buildChips(config, state, profile, ctx = {}) {
  const slotById = new Map(config.slots.map((s) => [s.id, s]));
  /** @type {Chip[]} */
  const chips = [];
  const ordered = Object.entries(state.values).filter(([, v]) => v.value !== null && v.value !== undefined).sort((a, b) => a[1].seq - b[1].seq);
  for (const [slotId, v] of ordered) {
    const slot = slotById.get(slotId);
    /** @type {Chip} */
    const c = { kind: 'value', slot: slotId, label: slot.label, value: v.value, valueLabel: valueLabel(slot, v.value, ctx), source: v.source, locked: v.locked, editable: true };
    if (v.confidence !== undefined) c.confidence = v.confidence;
    if (v.evidence) c.evidence = v.evidence;
    chips.push(c);
  }
  // Defaults the builder applied: visible and marked "assumed".
  for (const n of profile.needs) {
    if (n.source !== 'default') continue;
    const slot = slotById.get(n.slot);
    if (slot.manual) continue; // never-asked slots (cod, compat) stay out of the way unless stated
    chips.push({ kind: 'assumed', slot: n.slot, label: slot.label, value: n.value, valueLabel: valueLabel(slot, n.value, ctx), source: 'default', assumed: true, editable: true });
  }
  // City: unknown means the config's assumed zone (Greater Cairo), else nationwide; shown as assumed (BR-43).
  if (slotById.has('city') && !profile.logistics.city) {
    const z = assumedZone(config);
    const zl = z && config.zones.labels && config.zones.labels[z];
    const vl = zl ? { en: `${zl.en} (assumed)`, ar: `${zl.ar} (افتراض)` } : { en: 'Nationwide (assumed)', ar: 'أي محافظة (افتراض)' };
    chips.push({ kind: 'assumed', slot: 'city', label: slotById.get('city').label, value: null, valueLabel: vl, source: 'default', assumed: true, editable: true });
  }
  // Payment way skipped: Layer 2 quotes cash and says so.
  if (slotById.has('pay') && state.skipped.includes('pay') && !profile.money.pay) {
    chips.push({ kind: 'assumed', slot: 'pay', label: slotById.get('pay').label, value: null, valueLabel: { en: 'Not given: priced as cash (assumed)', ar: 'مش محدد: محسوب كاش (افتراض)' }, source: 'default', assumed: true, editable: true });
  }
  const notUsed = state.unmapped.map((u) => ({ kind: /** @type {'not_used'} */ ('not_used'), text: u.text, reason: u.reason, reasonLabel: REASON_LABELS[u.reason], factor: u.factor, topic: u.topic, editable: false }));
  const open = state.suggestions
    .map((x) => ({ kind: /** @type {'open'} */ ('open'), slot: x.slot, label: slotById.get(x.slot).label, value: x.value, valueLabel: valueLabel(slotById.get(x.slot), x.value, ctx), confidence: x.confidence, evidence: x.evidence, editable: true }));
  return { chips, notUsed, open };
}
