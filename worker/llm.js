// Free LLM adapters for the Layer 1 parser, chained: Google Gemini (free API key, optional) then Cloudflare Workers
// AI (the `AI` binding, no key). The first answer that parses as the requested JSON wins; when every provider fails
// the chain throws, and Layer 1 reads the text with its keyword rules instead (src/layer1/u2-rules.js).
//
// *** UNVERIFIED AGAINST THE LIVE SERVICES. *** Written from the Gemini REST and Workers AI JSON-mode docs; neither
// can be reached from the build environment. Check /api/health ("llm") and try a free-text start after deploying.
//
// Settings (vars in wrangler.jsonc, all optional):
//   LLM_ORDER          "gemini,workers-ai" (default); drop a name to turn that provider off
//   GEMINI_MODEL       "gemini-2.5-flash" (default)
//   WORKERS_AI_MODEL   "@cf/meta/llama-3.3-70b-instruct-fp8-fast" (default; supports JSON mode)
// Secret: GEMINI_API_KEY (free from Google AI Studio). Without it the chain is Workers AI only.
// Note: Gemini's free tier may use prompts to improve Google's products; the demo sends only what the buyer types.

import { checkExtractionShape } from '../src/layer1/u2-extract.js';

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
export const DEFAULT_WORKERS_AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const PER_PROVIDER_TIMEOUT_MS = 6000;

/** Instruction appended to the user message, so models without schema enforcement still answer in shape. */
function schemaNote(req) {
  return `\n\nReply with ONLY one JSON object that matches this JSON schema. No prose, no code fence.\n${JSON.stringify(req.schema)}`;
}

/** Parse a model's text answer as a JSON object (tolerates a code fence or text around the object). */
export function parseJsonObject(text) {
  if (text && typeof text === 'object') return text;
  const s = String(text ?? '').trim();
  try { return JSON.parse(s); } catch { /* try the outermost braces */ }
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch { /* fall through */ } }
  return null;
}

/** Is this output usable for the request? Category answers need a category; extractions need the slot shape. */
function usable(req, out) {
  if (!out || typeof out !== 'object' || Array.isArray(out)) return false;
  if (req.kind === 'category') return typeof out.category === 'string';
  return checkExtractionShape(out) === null;
}

function withTimeout(promise, ms, label) {
  let timer;
  const t = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label}: timeout`)), ms); });
  return Promise.race([promise, t]).finally(() => clearTimeout(timer));
}

/**
 * Google Gemini (generateContent REST). Free tier with an AI Studio key.
 * @param {{apiKey: string, model?: string, fetch?: typeof fetch, timeoutMs?: number}} opts
 */
export function createGeminiLlm(opts) {
  const model = opts.model || DEFAULT_GEMINI_MODEL;
  const doFetch = opts.fetch || fetch;
  const timeoutMs = opts.timeoutMs ?? PER_PROVIDER_TIMEOUT_MS;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  return async function gemini(req) {
    const body = (strict) => ({
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: 'user', parts: [{ text: req.user + schemaNote(req) }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        ...(strict ? { responseJsonSchema: req.schema } : {}),
        maxOutputTokens: req.maxTokens || 2048,
        temperature: 0,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
    const call = (strict) => withTimeout(doFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': opts.apiKey },
      body: JSON.stringify(body(strict)),
    }), timeoutMs, 'gemini');
    let res = await call(true);
    // Some models reject parts of a JSON schema: retry once with the schema in the prompt only.
    if (res.status === 400) res = await call(false);
    if (!res.ok) {
      // Google's error message names the problem (bad key, unknown model, quota) and never echoes the key.
      let msg = '';
      try { const e = await res.json(); msg = (e && e.error && (e.error.status || '') + ' ' + (e.error.message || '')) || ''; } catch { /* no body */ }
      throw new Error(`gemini: HTTP ${res.status} ${msg.trim().slice(0, 160)}`.trim());
    }
    const data = await res.json();
    const cand = data && data.candidates && data.candidates[0];
    if (!cand) {
      if (data && data.promptFeedback && data.promptFeedback.blockReason) return { stopReason: 'refusal', refusalCategory: data.promptFeedback.blockReason, model };
      throw new Error('gemini: no candidates');
    }
    if (cand.finishReason === 'MAX_TOKENS') return { stopReason: 'max_tokens', model };
    if (cand.finishReason === 'SAFETY' || cand.finishReason === 'PROHIBITED_CONTENT') return { stopReason: 'refusal', refusalCategory: cand.finishReason, model };
    const text = ((cand.content && cand.content.parts) || []).map((p) => p.text || '').join('');
    return { stopReason: 'end_turn', output: parseJsonObject(text) ?? text, model: `gemini:${model}` };
  };
}

/**
 * Cloudflare Workers AI through the `AI` binding, with JSON mode. Free daily allocation; no key.
 * @param {{ai: {run: Function}, model?: string, timeoutMs?: number}} opts
 */
export function createWorkersAiLlm(opts) {
  const model = opts.model || DEFAULT_WORKERS_AI_MODEL;
  const timeoutMs = opts.timeoutMs ?? PER_PROVIDER_TIMEOUT_MS;
  return async function workersAi(req) {
    const res = await withTimeout(opts.ai.run(model, {
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user + schemaNote(req) },
      ],
      response_format: { type: 'json_schema', json_schema: req.schema },
      max_tokens: req.maxTokens || 2048,
      temperature: 0,
    }), timeoutMs, 'workers-ai');
    const raw = res && typeof res === 'object' && 'response' in res ? res.response : res;
    return { stopReason: 'end_turn', output: parseJsonObject(raw) ?? raw, model: `workers-ai:${model}` };
  };
}

/**
 * Try each adapter in order; return the first usable answer. Refusals and truncations move on to the next one.
 * Throws when all fail, with each provider's reason (no secrets in messages).
 * @param {{name: string, llm: Function}[]} adapters
 */
export function chainLlms(adapters) {
  return async function chain(req) {
    const errors = [];
    for (const { name, llm } of adapters) {
      try {
        const res = await llm(req);
        if (res && res.stopReason === 'end_turn' && usable(req, res.output)) return res;
        errors.push(`${name}: ${res ? (res.stopReason !== 'end_turn' ? res.stopReason : 'unusable output') : 'empty'}`);
      } catch (e) {
        errors.push(`${name}: ${e && e.message ? String(e.message).slice(0, 120) : 'error'}`);
      }
    }
    throw new Error(errors.length ? errors.join('; ') : 'no llm configured');
  };
}

/** The providers this environment can use, in order. */
export function llmProviders(env) {
  const order = String(env.LLM_ORDER || 'gemini,workers-ai').split(',').map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const name of order) {
    if (name === 'gemini' && String(env.GEMINI_API_KEY || '').trim()) {
      out.push({ name, llm: createGeminiLlm({ apiKey: String(env.GEMINI_API_KEY).trim(), model: env.GEMINI_MODEL }) });
    }
    if (name === 'workers-ai' && env.AI && typeof env.AI.run === 'function') {
      out.push({ name, llm: createWorkersAiLlm({ ai: env.AI, model: env.WORKERS_AI_MODEL }) });
    }
  }
  return out;
}

/**
 * Try each configured provider on its own with a tiny category request: which ones answer, how fast, and why
 * not. For the admin check after a deploy; error texts never contain keys.
 */
export async function checkProviders(env, request) {
  const out = [];
  for (const { name, llm } of llmProviders(env)) {
    const t0 = Date.now();
    try {
      const res = await llm(request);
      const ok = res && res.stopReason === 'end_turn' && usable(request, res.output);
      out.push({ name, ok, ms: Date.now() - t0, ...(ok ? { model: res.model } : { error: res ? res.stopReason : 'empty' }) });
    } catch (e) {
      out.push({ name, ok: false, ms: Date.now() - t0, error: e && e.message ? String(e.message).slice(0, 200) : 'error' });
    }
  }
  return out;
}

/** The chained adapter for this environment, or null when no provider is configured. */
export function llmFor(env) {
  const providers = llmProviders(env);
  return providers.length ? chainLlms(providers) : null;
}

// Best-effort per-isolate limit on LLM calls per client IP (the free quotas are shared by every visitor).
const WINDOW_MS = 60_000;
/** @type {Map<string, {n: number, until: number}>} */
const hits = new Map();
export function allowLlmCall(ip, limit = 20, now = Date.now()) {
  if (hits.size > 5000) for (const [k, v] of hits) if (v.until < now) hits.delete(k);
  const h = hits.get(ip);
  if (!h || h.until < now) { hits.set(ip, { n: 1, until: now + WINDOW_MS }); return true; }
  h.n += 1;
  return h.n <= limit;
}
