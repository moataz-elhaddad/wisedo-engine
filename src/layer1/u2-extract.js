// U2 Text extractor (tech-spec 4, component U2). The only non-deterministic component of Layer 1.
//
// Builds the prompt and the JSON schema from the category config's slot schema, calls an injected
// `llm(request) -> Promise<LlmResponse>` function, and returns raw slot values with confidence and the quoted
// evidence, plus `unmapped` items (what the text says that no slot can hold). U3 then validates and maps
// everything to ids: the LLM only fills slots; it never produces weights, filters, prices or product picks.
//
// Every call is bounded by a timeout (3 s by default, tech-spec 4 "Failure handling"). A timeout, a thrown
// error, a refusal, a truncated answer or output that does not match the schema all return {ok: false} and
// the session falls back to the full question flow.

export const DEFAULT_TIMEOUT_MS = 3000;

/**
 * @typedef {Object} LlmRequest
 * @property {'extract'|'category'} kind
 * @property {string} text            the buyer's text (also used by the mock adapter to find a recording)
 * @property {string} [category]      category id (extract only)
 * @property {string} system          system prompt (stable per config version, so it can be cached)
 * @property {string} user            user message content
 * @property {object} schema          JSON schema for structured output (output_config.format)
 * @property {number} [maxTokens]
 */

/**
 * @typedef {Object} LlmResponse
 * @property {'end_turn'|'refusal'|'max_tokens'|string} stopReason
 * @property {any} [output]            parsed JSON object (or a raw string the adapter could not parse)
 * @property {string|null} [refusalCategory]
 * @property {string} [model]
 */

/**
 * Call the injected LLM with a timeout. Never throws.
 * @param {(req: LlmRequest) => Promise<LlmResponse>} llm
 * @param {LlmRequest} request
 * @param {number} [timeoutMs]
 * @returns {Promise<{ok: true, output: any, model?: string} | {ok: false, error: 'timeout'|'error'|'refusal'|'truncated'|'invalid', detail?: string}>}
 */
export async function callLlm(llm, request, timeoutMs = DEFAULT_TIMEOUT_MS) {
  /** @type {any} */
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve({ ok: false, error: 'timeout' }), timeoutMs); });
  const call = (async () => {
    try {
      const res = await llm(request);
      if (!res || typeof res !== 'object') return { ok: false, error: 'invalid', detail: 'empty response' };
      if (res.stopReason === 'refusal') return { ok: false, error: 'refusal', detail: res.refusalCategory || undefined };
      if (res.stopReason === 'max_tokens') return { ok: false, error: 'truncated' };
      let out = res.output;
      if (typeof out === 'string') {
        try { out = JSON.parse(out); } catch { return { ok: false, error: 'invalid', detail: 'not JSON' }; }
      }
      if (!out || typeof out !== 'object' || Array.isArray(out)) return { ok: false, error: 'invalid', detail: 'not an object' };
      return { ok: true, output: out, model: res.model };
    } catch (e) {
      return { ok: false, error: 'error', detail: e && e.message ? String(e.message).slice(0, 200) : 'error' };
    }
  })();
  try {
    return /** @type {any} */ (await Promise.race([call, timeout]));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * JSON schema of the extractor's answer, built from the config. Kept flat (one item shape for every slot) so
 * it stays within structured-output schema limits; U3 checks that each value belongs to its slot.
 * Every object has additionalProperties: false and lists every property as required (nullable where optional).
 * @param {any} config
 */
export function buildExtractionSchema(config) {
  const slotIds = config.slots.map((s) => s.id);
  return {
    type: 'object',
    additionalProperties: false,
    required: ['slots', 'unmapped'],
    properties: {
      slots: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['slot', 'values', 'amountText', 'confidence', 'evidence'],
          properties: {
            slot: { type: 'string', enum: slotIds },
            values: { type: 'array', items: { type: 'string' } },
            amountText: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            confidence: { type: 'number' },
            evidence: { type: 'string' },
          },
        },
      },
      unmapped: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['text', 'factor'],
          properties: {
            text: { type: 'string' },
            factor: { type: 'string', enum: unmappedFactorIds() },
          },
        },
      },
    },
  };
}

/** Factor ids an unmapped item may name (kept in sync with U3's UNMAPPED_FACTORS). */
function unmappedFactorIds() {
  return ['look_colour', 'trade_in', 'fakes_used', 'timing_launch_currency', 'family_opinion', 'reviews', 'known_defects', 'spare_parts', 'branch_pickup', 'other'];
}

/** One line per option: id = English label / Arabic label. */
function describeOptions(slot) {
  return slot.options.map((o) => `${o.id} = ${o.label.en} / ${o.label.ar}`).join('; ');
}

/**
 * The system prompt, built only from the config (plus shop names, which are identity data). It is stable for a
 * given config version and shop list, so the provider can cache it.
 * @param {any} config
 * @param {{retailers?: {id: string, name: string}[]}} [ctx]
 */
export function buildExtractionSystemPrompt(config, ctx = {}) {
  const lines = [];
  lines.push(`You read what an Egyptian shopper wrote about the ${config.label.en.toLowerCase()} they want to buy and fill slots of a fixed schema. The text may be Egyptian Arabic, English or a mix, with Arabic-Indic or Western digits.`);
  lines.push('');
  lines.push('Rules:');
  lines.push('- Fill a slot only when the text states it or clearly implies it. Leave out every slot the text does not touch. Never guess to be helpful.');
  lines.push('- values holds option ids from the slot list below, exactly as written there. For a multi slot give every option that applies.');
  lines.push('- confidence is 0 to 1: 0.9 or more when the text says it outright, 0.7 to 0.9 when it clearly implies it, below 0.7 when it is a weak hint.');
  lines.push('- evidence is the exact words from the text that support the value, copied character for character (a short quote, not a paraphrase).');
  lines.push('- Amounts of money: put the shopper\'s own words for the amount in amountText (for example "15 ألف", "١٥٠٠٠", "15k", "1500 في الشهر") and leave values empty. Do not convert or compute amounts. A monthly amount goes to monthlyCap, a total to budget, an amount paid up front to down.');
  lines.push('- Storage needs: an option id, or the shopper\'s words in amountText (for example "256 جيجا").');
  lines.push('- modelInMind: values holds the model name exactly as the shopper wrote it.');
  lines.push('- shops: values items are "prefer:<shop>" or "avoid:<shop>" using the shop names below.');
  lines.push('- Never invent products, prices or shops. Never rank or recommend.');
  lines.push('- Anything the shopper cares about that no slot can hold goes to unmapped with the exact quote and the closest factor: look_colour (colour or looks), trade_in (trading in the old device), fakes_used (new versus used or open box), timing_launch_currency (waiting for a sale, a launch or a price drop), family_opinion (what family or friends think), reviews, known_defects, spare_parts, branch_pickup, or other.');
  lines.push('');
  lines.push('Slots (id: meaning. Options):');
  for (const s of config.slots) {
    const flags = [s.multi ? 'multi' : null, s.numeric ? `amount in ${s.numeric.unit}` : null].filter(Boolean).join(', ');
    let opts;
    if (s.valueShape === 'shops') opts = 'shop names: ' + ((ctx.retailers || []).map((r) => r.name).join(', ') || '(none)');
    else if (s.valueShape === 'product') opts = 'free text: the model name as written';
    else if (s.numeric) opts = 'amountText, or a preset: ' + describeOptions(s);
    else opts = describeOptions(s);
    lines.push(`- ${s.id}${flags ? ` (${flags})` : ''}: ${s.label.en}. ${opts}`);
  }
  lines.push('');
  lines.push('Return only the JSON object the schema describes.');
  return lines.join('\n');
}

/**
 * Build the extraction request for one piece of buyer text.
 * @param {any} config
 * @param {string} text
 * @param {{retailers?: any[]}} [ctx]
 * @returns {LlmRequest}
 */
export function buildExtractionRequest(config, text, ctx = {}) {
  return {
    kind: 'extract',
    category: config.id,
    text,
    system: buildExtractionSystemPrompt(config, ctx),
    user: `<buyer_text>\n${text}\n</buyer_text>`,
    schema: buildExtractionSchema(config),
    maxTokens: 2048,
  };
}

/**
 * Light shape check of the extractor's output. Values are checked against the config later by U3.
 * @param {any} out
 * @returns {string|null}  error, or null when the shape is usable
 */
export function checkExtractionShape(out) {
  if (!out || typeof out !== 'object') return 'not an object';
  if (!Array.isArray(out.slots)) return 'slots must be an array';
  if (out.unmapped !== undefined && !Array.isArray(out.unmapped)) return 'unmapped must be an array';
  for (const [i, s] of out.slots.entries()) {
    if (!s || typeof s !== 'object' || typeof s.slot !== 'string') return `slots[${i}].slot must be a string`;
    if (s.values !== undefined && s.values !== null && !Array.isArray(s.values)) return `slots[${i}].values must be an array`;
    if (s.confidence !== undefined && typeof s.confidence !== 'number') return `slots[${i}].confidence must be a number`;
  }
  return null;
}

/**
 * Run the extractor on one piece of text.
 * @param {any} config
 * @param {string} text
 * @param {{llm: Function, timeoutMs?: number, retailers?: any[]}} opts
 * @returns {Promise<{ok: true, extraction: {slots: any[], unmapped: any[]}} | {ok: false, error: string, detail?: string}>}
 */
export async function extract(config, text, opts) {
  const res = await callLlm(/** @type {any} */ (opts.llm), buildExtractionRequest(config, text, opts), opts.timeoutMs);
  if (!res.ok) return res;
  const bad = checkExtractionShape(res.output);
  if (bad) return { ok: false, error: 'invalid', detail: bad };
  return { ok: true, extraction: { slots: res.output.slots, unmapped: res.output.unmapped || [] } };
}
