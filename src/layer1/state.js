// Layer 1 session state: plain JSON (no Maps, Dates or functions), so a session can be stored, sent over the
// wire and replayed. Every event handler in session.js works on a deep copy and returns a new state.

export const STATE_VERSION = 1;

/**
 * @typedef {Object} SlotValue
 * @property {any} value
 * @property {'text'|'answer'|'edit'|'skip_default'} source   skip_default: the value a skipped question assumes (pay -> cash)
 * @property {number} [confidence]
 * @property {string} [evidence]
 * @property {boolean} locked        the buyer's own word (answer or edit): a later extraction never overwrites it
 * @property {number} seq            when it was stated (order matters: later prefers are relaxed first)
 */

/**
 * @typedef {Object} AskedQuestion
 * @property {'slot'|'clarify'} kind
 * @property {string} id             slot id, or clarify id
 * @property {'answered'|'skipped'|'pending'|'superseded'} outcome
 * @property {number} [gain]         planner gain when it was asked (slot questions)
 * @property {string} [phase]        planner phase that chose it
 */

/**
 * @typedef {Object} SessionState
 * @property {number} v
 * @property {'new'|'tiles'|'unsupported'|'question'|'clarify'|'done'} phase
 * @property {string|null} category
 * @property {any} detection                  U1 result for the first text (or the tile)
 * @property {{text: string, status: string, detail?: string}[]} texts
 * @property {Record<string, SlotValue>} values
 * @property {{slot: string, value: any, confidence: number, evidence: string}[]} suggestions   low-confidence reads, shown as open
 * @property {{text: string, reason: 'not_supported'|'no_data', factor: string}[]} unmapped
 * @property {{slot: string, value?: any, why: string}[]} dropped
 * @property {AskedQuestion[]} asked
 * @property {string[]} skipped               slots the buyer skipped (default applies, shown as assumed)
 * @property {string[]} clarified             clarify ids already asked
 * @property {any|null} pending               the question on screen: {kind: 'slot', slot, options} | {kind: 'clarify', id, options}
 * @property {null|{reason: 'no_gain'|'cap'|'show_now'}} stop
 * @property {{fullFlow: boolean, llmFailed: string|null}} flags
 * @property {number} seq
 */

/** @returns {SessionState} */
export function emptyState() {
  return {
    v: STATE_VERSION,
    phase: 'new',
    category: null,
    detection: null,
    texts: [],
    values: {},
    suggestions: [],
    unmapped: [],
    dropped: [],
    asked: [],
    skipped: [],
    clarified: [],
    pending: null,
    stop: null,
    flags: { fullFlow: false, llmFailed: null },
    seq: 0,
  };
}

/** @param {SessionState} s @returns {SessionState} */
export function cloneState(s) {
  return JSON.parse(JSON.stringify(s));
}

/** Slot questions the buyer answered or skipped. Clarifying questions (U6) are outside the question cap. */
export function questionCount(s) {
  return s.asked.filter((q) => q.kind === 'slot' && (q.outcome === 'answered' || q.outcome === 'skipped')).length;
}

/** Plain {slot: value} of everything the buyer stated (text, answers, edits), without defaults. */
export function statedAnswers(s) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const [slot, v] of Object.entries(s.values).sort((a, b) => a[1].seq - b[1].seq)) if (v.value !== null && v.value !== undefined) out[slot] = v.value;
  return out;
}

/** Ordered answer entries for buildNeedProfile (order = when stated). */
export function answerEntries(s) {
  return Object.entries(s.values)
    .filter(([, v]) => v.value !== null && v.value !== undefined)
    .sort((a, b) => a[1].seq - b[1].seq)
    .map(([slot, v]) => {
      /** @type {any} */
      // A skipped question's assumed value (payment way -> cash) reaches the profile as a default.
      const e = { slot, value: v.value, source: v.source === 'skip_default' ? 'default' : v.source };
      if (v.confidence !== undefined) e.confidence = v.confidence;
      if (v.evidence) e.evidence = v.evidence;
      if (v.source !== 'text' && v.source !== 'skip_default') e.confirmed = true;
      return e;
    });
}

/** A slot is closed when it has a value, was skipped, or was cleared by the buyer. */
export function isClosed(s, slotId) {
  return Object.prototype.hasOwnProperty.call(s.values, slotId) || s.skipped.includes(slotId);
}
