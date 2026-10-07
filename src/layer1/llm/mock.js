// Recorded-response LLM adapter. Used by the tests: no network, no key.
//
// Recording file format ("wisedo-llm-recordings/1"; see docs/LAYER1-NOTES.md):
//   {
//     "format": "wisedo-llm-recordings/1",
//     "model": "claude-sonnet-5-5" | "scripted",          // who produced the responses
//     "recordings": [
//       {"kind": "extract", "category": "mobile", "text": "<buyer text>",
//        "response": {"slots": [{"slot": "use", "values": ["photo"], "amountText": null, "confidence": 0.92, "evidence": "..."}],
//                     "unmapped": [{"text": "لونه أزرق", "factor": "look_colour"}]}},
//       {"kind": "category", "text": "<buyer text>", "response": {"category": "mobile", "confidence": 0.8}}
//     ]
//   }
// A recording is found by kind + category (extract only) + text (trimmed, whitespace collapsed).
// Special responses simulate failures:
//   {"$timeout": true}   never answers (the caller's 3 s timeout fires)
//   {"$error": "msg"}    the call throws
//   {"$refusal": "cyber"} stop_reason "refusal"
//   {"$truncated": true} stop_reason "max_tokens"
//   {"$raw": "text"}     the model returned text that is not the schema's JSON

/** @param {string} t */
const key = (t) => String(t ?? '').trim().replace(/\s+/g, ' ');

/**
 * @param {any[] | {recordings: any[]}} recordings
 * @param {{onMissing?: 'throw'|'empty', delayMs?: number}} [opts]
 *   onMissing: 'throw' (default) makes a missing recording an adapter error (the session then falls back);
 *   'empty' answers {slots: [], unmapped: []} or {category: 'unclear', confidence: 0}.
 * @returns {((req: any) => Promise<any>) & {calls: any[]}}
 */
export function createMockLlm(recordings, opts = {}) {
  const list = Array.isArray(recordings) ? recordings : (recordings && recordings.recordings) || [];
  /** @type {any[]} */
  const calls = [];
  const fn = async (req) => {
    calls.push({ kind: req.kind, category: req.category, text: req.text });
    const rec = list.find((r) => (r.kind || 'extract') === req.kind && (req.kind !== 'extract' || !r.category || r.category === req.category) && key(r.text) === key(req.text));
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    if (!rec) {
      if (opts.onMissing === 'empty') return { stopReason: 'end_turn', model: 'mock', output: req.kind === 'category' ? { category: 'unclear', confidence: 0 } : { slots: [], unmapped: [] } };
      throw new Error(`mock llm: no recording for ${req.kind} "${key(req.text).slice(0, 60)}"`);
    }
    const res = rec.response || {};
    if (res.$timeout) return new Promise(() => {}); // never settles; holds no timer, so the process can exit
    if (res.$error) throw new Error(String(res.$error));
    if (res.$refusal) return { stopReason: 'refusal', refusalCategory: typeof res.$refusal === 'string' ? res.$refusal : null, model: 'mock' };
    if (res.$truncated) return { stopReason: 'max_tokens', model: 'mock' };
    if (res.$raw !== undefined) return { stopReason: 'end_turn', output: String(res.$raw), model: 'mock' };
    return { stopReason: 'end_turn', output: structuredClone(res), model: 'mock' };
  };
  return Object.assign(fn, { calls });
}

/**
 * Build a recording entry (helper for tests and for the eval worker's scripted runs).
 * @param {string} text
 * @param {{slots?: any[], unmapped?: any[]} | Record<string, any>} response
 * @param {{kind?: 'extract'|'category', category?: string}} [o]
 */
export function recording(text, response, o = {}) {
  return { kind: o.kind || 'extract', ...(o.kind === 'category' ? {} : { category: o.category || 'mobile' }), text, response };
}
