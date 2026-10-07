// Claude API adapter for the Layer 1 parser (U1 category fallback and U2 extraction).
//
// *** UNVERIFIED AGAINST THE LIVE API. ***
// Written from the Anthropic TypeScript/JavaScript SDK documentation but never run: this environment has no
// API key and no network. Run the live parser check in docs/LAYER1-NOTES.md before relying on it.
//
// Settings (decided for this product, tech-spec 10 and 12):
// - model claude-sonnet-5-5, effort "low" via output_config.effort
// - structured output via output_config.format = {type: "json_schema", schema} built from the slot schema
// - no sampling parameters (temperature/top_p/top_k), no assistant prefill, no tool_choice
// - 3 second timeout, no SDK retries (the session falls back to the question flow instead of waiting)
// - stop_reason "refusal" is returned as {stopReason: 'refusal'}; Layer 1 then falls back to the question flow
// - optional server-side refusal fallback (`fallbacks: "default"`, beta header server-side-fallback-2026-07-01,
//   Claude API only); on by default, turn off with {serverFallback: false}
//
// The SDK is loaded with a lazy dynamic import, so the repository has no hard dependency on it
// (`npm install @anthropic-ai/sdk` is needed only where this adapter runs).
// The API key is read only inside the call function, from ANTHROPIC_API_KEY, and is never logged.

export const PARSER_MODEL = 'claude-sonnet-5-5';

/**
 * @param {{model?: string, timeoutMs?: number, effort?: 'low'|'medium'|'high', serverFallback?: boolean, maxTokens?: number}} [opts]
 * @returns {(req: import('../u2-extract.js').LlmRequest) => Promise<import('../u2-extract.js').LlmResponse>}
 */
export function createAnthropicLlm(opts = {}) {
  const model = opts.model || PARSER_MODEL;
  const timeoutMs = opts.timeoutMs ?? 3000;
  const effort = opts.effort || 'low';
  const serverFallback = opts.serverFallback !== false;

  return async function llm(request) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
    const client = new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 0 });

    const params = {
      model,
      max_tokens: request.maxTokens || opts.maxTokens || 2048,
      system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: request.user }],
      output_config: { effort, format: { type: 'json_schema', schema: request.schema } },
    };

    const res = serverFallback
      ? await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
      : await client.messages.create(params);

    if (res.stop_reason === 'refusal') {
      return { stopReason: 'refusal', refusalCategory: (res.stop_details && res.stop_details.category) || null, model: res.model };
    }
    if (res.stop_reason === 'max_tokens') return { stopReason: 'max_tokens', model: res.model };

    // Read blocks by type: with adaptive thinking a response can start with a (possibly empty) thinking block.
    const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    let output;
    try { output = JSON.parse(text); } catch { output = text; }
    return { stopReason: res.stop_reason, output, model: res.model };
  };
}
