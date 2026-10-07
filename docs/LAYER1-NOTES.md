# Layer 1 notes: need understanding

Layer 1 turns a buyer's free text and answers into a confirmed Need Profile. It does this with as few questions as possible, then hands the profile to Layer 2 in rank mode.

It is written in plain JavaScript ES modules with JSDoc and has no dependencies (Node 22). All data is synthetic. Layer 1 talks to Layer 2 only through `match()`: simulate mode while it plans, rank mode for the result.

Nothing in `decision-engine/`, `src/layer2/`, `config/`, `eval/` or `test/eval-phrases.test.js` was changed.

## What was built

| Path | What |
|---|---|
| `src/layer1/u1-category.js` | **U1 category detector.** <br>• Rules first: Arabic and English keywords, plus model names from the snapshot's product aliases. <br>• Calls the LLM only when the rules are unclear. <br>• Detects all five categories. Only categories with a config in the snapshot count as configured (today, mobile). <br>• Laptop, TV, AC and fridge get an honest "not set up yet" answer. Washing machines and other uncovered products get "not covered". Both answers offer the configured categories as tiles. |
| `src/layer1/u2-extract.js` | **U2 extractor.** <br>• Builds the system prompt and JSON schema from the config's slots, then calls the injected `llm(request)`. <br>• `callLlm` enforces the 3 s timeout and turns refusal, truncation, invalid output and thrown errors into `{ok:false, error}`. It never throws. |
| `src/layer1/u3-normalize.js` | **U3 normaliser** (deterministic). <br>• Arabic-Indic digits and Arabic letter forms. <br>• Money in Egyptian Arabic and English: "15 ألف", "١٥٠٠٠", "15k", "حوالي ١٢ الف", "1500 في الشهر", "قسط 1500", "الف و خمسميه", "خمسة وعشرين ألف", "مقدم 5000". <br>• Storage ("نص تيرا") and screen size ("٦٥ بوصة"). <br>• Option ids from ids or labels. City keys, shop ids and product ids from names. <br>• Drops unknown slots and option ids. <br>• Gives every unmapped item its reason. |
| `src/layer1/u4-confirm.js` | **U4 confirmer.** <br>• Pre-fills a value only at confidence 0.7 or higher; anything lower becomes an open suggestion. <br>• Buyer answers and edits are locked for the session. <br>• Builds the chips: value chips with their source, "assumed" chips for defaults, "Nationwide (assumed)" when the city is unknown, and "Not used" chips with their reason. |
| `src/layer1/u5-derive.js` | **U5 deriver.** Applies the config's defaults and derive rules through `buildNeedProfile`, the same builder Layer 2's tests use. |
| `src/layer1/u6-consistency.js` | **U6 consistency checker.** <br>• Contradictions: a brand both liked and avoided, iOS together with an Apple-only need, Android together with an Apple Watch, a shop both preferred and avoided. <br>• Expectation gaps, found through simulate only: a budget gap (for example iPhone only on 8,000 EGP) and a model-in-mind gap. <br>• A blocking item becomes one clarifying question with actions: raise the amount, relax the need, or keep. <br>• Config `checks` become notes. |
| `src/layer1/u7-planner.js` | **U7 planner.** Gain from simulate, phase order and policy (see "Decisions"). |
| `src/layer1/u8-render.js` | **U8 renderer.** <br>• One question at a time, with Arabic and English labels. <br>• Tile counts come from simulate. Answers with zero matches are hidden; money answers never are. <br>• Skip means the slot's default. <br>• Also renders the clarifying question and "Add a detail" (every slot). |
| `src/layer1/u9-stop.js` | **U9 stop rule.** Stops on no gain, at 8 questions, or on "show results now". Sets the profile status: `complete` or `good_enough`. |
| `src/layer1/state.js` | The session state: plain JSON with a version number. |
| `src/layer1/sim.js` | The planner's only door to Layer 2. Calls `match(...,'simulate')`, memoised per snapshot object. |
| `src/layer1/session.js` | **The state machine.** `step(state, event, ctx) -> {state, ui}` and `replay(events, ctx)`. <br>• Events: `start {text}` or `start {tile}`, `answer`, `skip`, `edit`, `addText`, `addDetail`, `showNow`, `result`. |
| `src/layer1/index.js` | Public exports. |
| `src/layer1/llm/mock.js` | Recorded-response adapter used by the tests. It can also simulate timeout, error, refusal, truncation and raw text. |
| `src/layer1/llm/anthropic.js` | Live adapter. **Unverified: written but never run** (no key and no network here). See below. |
| `test/layer1-normalize.test.js` | Money, digits, units, option mapping, unknown ids dropped, evidence guard, unmapped reasons (10 tests). |
| `test/layer1-category.test.js` | U1 rules versus LLM; not-configured and unsupported answers; tiles. U2 schema strictness and failure mapping. Static check of the live adapter's settings (9 tests). |
| `test/layer1-session.test.js` | The 0.7 rule, locked edits, skip, Not used chips, Add a detail, city assumed, cod/shops never asked, U6 contradiction and gap, LLM failures, low-confidence tiles, show now, the cap, JSON round trip (15 tests). |
| `test/layer1-planner.test.js` | Need before money, payment way before amount, no degenerate question, an independent Layer 2 check of every gain question, city only when zones differ, brand near tie, renderer (8 tests). |
| `test/layer1-personas.test.js` | End to end on all 18 personas (Need Profile equality plus rank picks), question-count metrics, and the literal policy within the cap (21 tests). |
| `test/layer1-imports.test.js` | Grep checks: <br>• the only Layer 2 import is `{ match }` from `../layer2/index.js`; <br>• the only package import is the SDK, lazily, in the adapter; <br>• no `process.env` outside the adapter; <br>• no clock and no `fetch` (3 tests). |

### Running

```bash
cd wisedo-engine
node --test test/        # whole suite through test/index.js (npm test)
node --test              # same suite, files discovered by the runner
```

**Last run** (Node 22):
- `node --test test/`: 148 tests, 148 pass, 0 fail. That is 77 Layer 2 tests, 5 eval-phrase tests and 66 Layer 1 tests.
- Plain `node --test`: 151 tests, 151 pass. It also counts `test/helpers.js`, `test/index.js` and `test/personas.js` as one test each.

### Using the session

```js
import { step } from './src/layer1/index.js';
import { createAnthropicLlm } from './src/layer1/llm/anthropic.js';   // or createMockLlm(recordings)
const ctx = { snapshot, now: '2026-10-03T12:00:00Z', llm: createAnthropicLlm() };
let { state, ui } = await step(null, { type: 'start', text: 'عايز موبايل للتصوير ميزانيتي 15 ألف كاش' }, ctx);
// ui.screen: question | clarify | result | tiles | not_configured | unsupported | add_detail | error
({ state, ui } = await step(state, { type: 'answer', value: 'me' }, ctx));     // or skip / edit / addText / showNow
```

- **State:** plain JSON, safe to store between HTTP requests. `ctx` holds the snapshot, `now`, the injected `llm`, and optionally `llmTimeoutMs`, `maxQuestions` and `policy`.
- **Fields on every UI response once the category is known:** `chips`, `notUsed`, `suggestions`, `questionsAsked` and `fallback`.
- **Question screen:** also carries `question` (options with `matches`, `skip`, `step`, `why`) and `live` (matching count and the current top 3).
- **Result screen:** also carries `profile`, the full Layer 2 `result` and `skippedQuestions`.

## Decisions where the spec was ambiguous

1. **Question policy. This is the main decision for the founder.**
   - **The conflict.** Taken literally, the spec rules (ask when gain ≥ 1, where any change of the #1 product or shop counts) ask a **median of 5** questions on the 18 personas (max 8). The spec also targets a median of 3 or fewer.
   - **The default (`DEFAULT_POLICY = {minGain: 1.3, materialPoints: 3}`)** adds two refinements:
     - A change of the #1 product counts only when it is **not a near tie**: the old #1 must trail the new one by at least 3 points. This is the same 3 points as the brand near-tie rule. Layer 1 sees no scores, so it checks this with a bonus probe through simulate.
     - A gain question needs **gain ≥ 1.3**. In practice, a question that only moves the #1 to another shop (same phones, gain exactly 1.0) is not asked.
   - **Measured result** (`test/layer1-personas.test.js`): median **3**, max **7**.
   - **The literal rule is still available** as `LITERAL_POLICY`, passed through `ctx.policy`. Measured with it: counts 0,0,1,2,2,3,4,4,5,5,5,5,5,6,6,7,7,8; median 5; max 8.
   - The brand tie-break question is exempt from `minGain` (spec: asked on a near tie).
2. **"Need before money" means this order** (technical-design v4):
   - (A) always-asked need questions (who, use and their follow-ups), in config order;
   - (B) always-asked money questions: payment way, then budget or monthly cap;
   - (C) situational `alwaysIf` questions (urgentDays while White Friday is 1–10 weeks away), only if their gain reaches the minimum;
   - (D) every other open question by gain: need refinements such as pain, keep and storage; money extras such as down payment and provider; city; preferences;
   - (E) the brand tie-break.

   Gain-based need refinements are judged after the money is known, because before that every phone looks affordable. An earlier "all need questions by gain before money" variant hit the 8-question cap before reaching the money questions.
3. **Always questions while the money is unknown are judged across money scenarios.** These are every budget preset for a cash buyer and every monthly preset for a finance buyer. An always question is asked when 2 or more answers are possible and, in some scenario, the answers give different #1 picks. Otherwise "who" and "use" would look useless, since with no budget the flagship wins for everyone.
4. **The payment way's gain is the union of outcomes over its amount presets.** It is asked unless the catalog is degenerate. A finance buyer is offered only finance providers, and a card buyer only card banks (provider options carry `kind`).
5. **Gain signals in `askIf`** (`providerMatters`, `zoneMatters`, `urgencyMatters`, `downChangesPick`, `importCheaper`) are treated as true. The slot's own gain check then decides, as BUILD-NOTES suggests.
6. **City** is simulated once per delivery zone, because offers differ by zone and not by city. Every city tile shows its zone's count. When the city is unknown, the chip reads "Nationwide (assumed)" and Layer 2 quotes the worst fee and days across zones.
7. **Pre-fill guards:**
   - Evidence that is not a quote of the buyer's text caps confidence at 0.5; missing evidence caps it at 0.6. Neither becomes a chip.
   - A bare small number ("ميزانيتي 15") is read as thousands, with confidence capped at 0.6. It is shown as an open suggestion and asked.
   - A per-month amount given for the budget is moved to the monthly cap; a down-payment amount is moved to `down`.
8. **Locked values:**
   - Answers and edits are locked, and a later extraction never overwrites them.
   - An edit to `null` clears the value and keeps it locked.
   - Unlocked text values are updated by newer text.
   - After the result, an edit or new text re-runs the flow.
9. **Low confidence on everything.** If the text was read but nothing reached 0.7 (and at least one item was suggested), the session shows the category tiles and drops those guesses. Picking a tile starts the full flow. A category guessed by the LLM below 0.7 also shows the tiles.
10. **LLM failure:**
    - On the first text (timeout, error, refusal, truncation, invalid JSON or wrong shape, or no adapter at all), the session keeps the rules-detected category and runs the full question flow from the first question. `ui.fallback = {reason, fullFlow: true}`.
    - On later text, nothing changes and `ui.textNotRead` explains why.
11. **Clarifying questions** (U6) count toward the cap of 8. Each is asked at most once per session. A skip means "keep".
12. **"Questions I skipped".** The result lists the open askable slots, with their last gain when known.
13. **The model in mind** is resolved to a catalog id when it matches an alias (for example "Galaxy A56" becomes `samsung-a56`). Otherwise it is kept as the buyer's string, flagged `not_in_catalog`. The persona file sets the raw name; the end-to-end test expects the resolved id.
14. **Unmapped reasons are decided in U3 from the factor, never by the LLM:**
    - colour, reviews, defects, spare parts and branch pickup: `no_data`, "No data yet";
    - trade-in, condition (used or open box), wait-for-sale and family or social opinion: `not_supported`, "Not supported yet";
    - anything else: `not_supported`.

    Each item carries `topic`, using the eval set's names (`colour`, `trade-in`, `condition`, `wait-for-sale`, `social`).
15. **Category rules:** a strong keyword must give a unique maximum score, otherwise the result is "unclear". "شاشة 55 بوصة" (a screen of 24 inches or more) counts as a TV.
    - Rules alone were measured on `eval/phrases.jsonl` (not a test; the set is synthetic):
      - laptop, TV, AC and fridge: 20 of 20 correct;
      - "none": 1 of 5 (the other 4 are unclear and go to the tiles or the LLM);
      - mobile: 103 of 275 decided by rules, 171 unclear (mostly fragments such as "budget 15k" with no product word), 1 wrong ("I own an iPad and a MacBook" → laptop).
    - Inside a session, later text never re-detects the category.

## Deviations from the spec

- **Planner refinements.** The default planner adds the near-tie and shop-only refinements above (decision 1). The literal rule is one setting away (`ctx.policy = LITERAL_POLICY`).
- **Low-confidence tiles drop the guesses** (decision 9). They are not carried into the full flow.
- **The live adapter turns on server-side refusal fallback by default** (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`, Claude API only). Turn it off with `createAnthropicLlm({serverFallback: false})`. This follows current Claude API guidance; the spec did not mention it.

## Open questions for the founder (most important first)

1. **Planner policy:** the default (median 3, max 7) or the literal rule (median 5, max 8)? See decision 1.
   - With the default, when the buyer's first text gives neither the money nor the use, the personas still need a median of 6 questions (max 8). This was measured with a scratch driver, not in the suite.
2. **"When do you need it?" (urgentDays)** is the most frequent question. Its `alwaysIf saleWeeks between 1 and 10` holds for most of October and November (White Friday is 7.9 weeks after `NOW`).
   - It is asked in 12 of the 18 persona flows (default policy), because "today" penalises slow-delivery offers and changes the pick.
   - Should the window be narrower, or should urgency come from text only?
3. **Skipping the payment way blocks the budget question.** `budget` and `monthlyCap` have `dependsOn pay`, so the buyer gets no amount question and Layer 2 prices as cash with no limit (the chip says so). Should a skipped payment way default to cash and still ask the budget?
4. **Latency budget.** An unclear opener can make two LLM calls in a row (category, then extraction), so the worst case is 2 × 3 s. Is a single combined call preferred?
5. **Clarifying questions count toward the 8.** Should they be outside the cap?
6. **Eval accuracy.** The phrase set is synthetic, and the live parser has never run. The "90 percent slot accuracy" metric is untested until the live check below is run on real beta phrases.

## The live adapter (`src/layer1/llm/anthropic.js`): UNVERIFIED

This adapter was written from the Anthropic JS SDK documentation and **never run**: this environment has no API key and no network. Its settings:

- **Model and output:** model `claude-sonnet-5-5`, `output_config: {effort: 'low', format: {type: 'json_schema', schema}}` with the slot schema. Every object has `additionalProperties: false` and no numeric limits.
- **What it leaves out:** no temperature, top_p or top_k; no assistant prefill; no `tool_choice`.
- **Timeout:** 3 s, with `maxRetries: 0`.
- **Stop reasons:** `stop_reason: "refusal"` is returned as `{stopReason: 'refusal', refusalCategory}`, and `max_tokens` as truncated. Layer 1 then falls back to the question flow. Text blocks are read by type.
- **SDK:** loaded with a lazy `await import('@anthropic-ai/sdk')`, so the repository has no dependency on it. `npm install @anthropic-ai/sdk` is needed only where the adapter runs.
- **Key:** `ANTHROPIC_API_KEY` is read only inside the returned call function and is never logged.

## Recorded-response format (for the eval-phrases worker)

The mock adapter (`src/layer1/llm/mock.js`) replays recordings. A recordings file:

```json
{
  "format": "wisedo-llm-recordings/1",
  "model": "claude-sonnet-5-5",
  "recordings": [
    {"kind": "extract", "category": "mobile", "text": "عايز موبايل لونه أزرق، ميزانيتي 15 ألف",
     "response": {"slots": [{"slot": "budget", "values": [], "amountText": "15 ألف", "confidence": 0.92, "evidence": "ميزانيتي 15 ألف"}],
                  "unmapped": [{"text": "لونه أزرق", "factor": "look_colour"}]}},
    {"kind": "category", "text": "محتاج حاجة أكلم بيها ماما", "response": {"category": "mobile", "confidence": 0.8}}
  ]
}
```

- **Matching:** a recording is found by `kind`, by `category` (extract only) and by `text`, with whitespace trimmed and collapsed.
- **`response`** is the model's raw structured output, exactly in the schema of `buildExtractionSchema(config)`:
  - `slots[]`: `{slot, values: string[], amountText: string|null, confidence, evidence}`. Option ids or labels go in `values`. Money goes in `amountText`, in the buyer's words; U3 parses it, never the LLM. Shops are written `"prefer:<shop name>"` or `"avoid:<shop name>"`, and the model in mind as the buyer's raw name.
  - `unmapped[]`: `{text, factor}`. `factor` is one of `look_colour, trade_in, fakes_used, timing_launch_currency, family_opinion, reviews, known_defects, spare_parts, branch_pickup, other`.
- **Simulated failures:** use `{"$timeout": true}`, `{"$error": "msg"}`, `{"$refusal": "category"}`, `{"$truncated": true}` or `{"$raw": "text"}` as the response.
- **Comparing with `eval/phrases.jsonl`:**
  - Run `normalizeExtraction(config, response, {text, ...identityFor(snapshot, 'mobile')})`.
  - Keep the answers with `confidence >= 0.7` and compare `{slot: value}` with `expected.slots`. Sort multi-value arrays first. For `modelInMind`, compare the answer's `raw` field, because `value` is the catalog id.
  - Compare `unmapped[].topic` with `expected.unmapped[].topic`. Map the reasons this way: `not_supported` is "not supported yet", and `no_data` is "no data".
- **Helper:** `recording(text, response, {kind, category})` builds one entry.

## How to run a live parser check (not run here)

Run this on a machine that has network access and a key. It spends real money: about 275 short calls for the mobile phrases.

1. In a scratch copy of the repository: `npm install --no-save @anthropic-ai/sdk`.
2. `export ANTHROPIC_API_KEY=...` (never commit it, never print it).
3. Save this as `live-parser-check.mjs` in the repository root and run `node live-parser-check.mjs`:

```js
import { readFileSync, writeFileSync } from 'node:fs';
import { createAnthropicLlm } from './src/layer1/llm/anthropic.js';
import { extract, normalizeExtraction, identityFor, configFor } from './src/layer1/index.js';
import { SNAPSHOT } from './test/helpers.js';

const TIMEOUT = 10000; // generous for a batch check; production keeps 3000
const llm = createAnthropicLlm({ timeoutMs: TIMEOUT });
const config = configFor(SNAPSHOT, 'mobile');
const id = identityFor(SNAPSHOT, 'mobile');
const norm = (v) => JSON.stringify(Array.isArray(v) ? [...v].sort() : v);
const phrases = readFileSync('eval/phrases.jsonl', 'utf8').trim().split('\n').map(JSON.parse).filter((p) => p.category === 'mobile');
const recordings = [];
let right = 0, total = 0, failures = 0;
for (const p of phrases) {
  const r = await extract(config, p.text, { llm, timeoutMs: TIMEOUT, retailers: id.retailers });
  if (!r.ok) { failures++; recordings.push({ kind: 'extract', category: 'mobile', text: p.text, response: { $error: r.error } }); continue; }
  recordings.push({ kind: 'extract', category: 'mobile', text: p.text, response: r.extraction });
  const n = normalizeExtraction(config, r.extraction, { text: p.text, ...id });
  const got = Object.fromEntries(n.answers.filter((a) => a.confidence >= 0.7).map((a) => [a.slot, a.slot === 'modelInMind' ? a.raw : a.value]));
  for (const [slot, want] of Object.entries(p.expected.slots)) { total++; if (norm(got[slot]) === norm(want)) right++; }
}
writeFileSync('live-recordings.json', JSON.stringify({ format: 'wisedo-llm-recordings/1', model: 'claude-sonnet-5-5', recordings }, null, 1));
console.log({ phrases: phrases.length, failures, slotAccuracy: total ? right / total : null });
```

4. **What to check:**
   - The call succeeds at all; parameter names and the beta flag are the unverified part.
   - The failure count.
   - Slot accuracy against the 90 percent target.
   - Latency at `timeoutMs: 3000`: rerun with 3000 and count timeouts.
5. If the API rejects `fallbacks`, retry with `createAnthropicLlm({serverFallback: false})` and note it here.
6. `live-recordings.json` can then feed `createMockLlm(...)` to replay real outputs in tests. Keep it out of the repository unless the phrases are synthetic.

## Needs a change in Layer 2 or config

Nothing here was patched. Layer 1 works around both items.

1. **The config's `provider` options lack the finance provider `khanstore`, which exists in the synthetic plans.** A buyer cannot pick "Khan Market Shop installments" as their provider, and an extraction naming it is dropped as `unknown_option`. Workaround: none needed for ranking, since a missing provider means any provider. Repro:

   ```js
   import { SNAPSHOT, mobileConfig } from './test/helpers.js';
   new Set(SNAPSHOT.plans.map((p) => p.provider));                               // horusbank, khanstore, nilebank, qest, sahla
   mobileConfig.slots.find((s) => s.id === 'provider').options.map((o) => o.id); // nilebank, horusbank, sahla, qest
   ```

   Suggested fix: add `{ "id": "khanstore", "kind": "finance", ... }` to the provider options, or have the generator use only configured providers.

2. **Simulate mode returns no scores**, so Layer 1 cannot see a near tie directly. This is a request, not a bug. The brand near-tie rule and the near-tie refinement each cost one extra simulate call with a temporary `bonus` term: a 2.99-point brand bonus, or a 2.99-point bonus on the old #1. Repro of the probe:

   ```js
   match({ ...profile, bonus: [...profile.bonus, { attr: 'brand', op: 'in', value: ['Xiaomi'], points: 2.99 }] }, snapshot, now, 'simulate').top1
   ```

   Suggested change: return `top2Gap` (the score gap between #1 and #2) and the #2 brand in the simulate output, then drop the probes. Simulate calls are memoised, so the current cost is small: about 10 to 200 ms per persona session.
