# Layer 1 eval phrase set (SYNTHETIC)

**These 300 phrases are synthetic.** They were invented to exercise the Layer 1 extractor and to check that the
config can hold every buying factor of tech-spec 4.1. They are not collected from buyers, they are not a sample of
real traffic, and a score on them says nothing reliable about real-world accuracy. Every line carries
`"label": "synthetic"`. **They must be replaced by real beta phrases** (keep the same format, drop the
`synthetic` label only for phrases a real buyer typed, and keep personal data out). Until then the
"slot accuracy at least 90 percent on the 300-phrase eval set" metric of tech-spec section 4 is only a smoke test.

No real person's text and no real retailer content was used. Shops, banks and finance companies use the synthetic
names of `data/synthetic/` (Nile Electro, Pharos Digital, Lotus Market, Oasis Online, Delta Mobile, Khan Market
Shop, Sphinx Store; Nile Bank, Horus Bank, Sahla Finance, Qest Pay).

## Files

| File | What it is |
|---|---|
| `eval/phrases.jsonl` | 300 lines, one JSON object per line |
| `eval/coverage.js` | Dependency-free checker: validates the file against `config/mobile.json`, prints the tables, exits non-zero if an acceptance rule fails |
| `test/eval-phrases.test.js` | `node:test` wrapper that imports `checkPhraseSet` from `coverage.js` |

## Run

```
node eval/coverage.js     # report; exit code 1 if any acceptance rule fails
node --test               # the whole suite, including test/eval-phrases.test.js
```

## Line format

```json
{"id":"p001","label":"synthetic","lang":"ar","text":"...","category":"mobile",
 "expected":{"slots":{"use":["photo"],"budget":15000},
             "unmapped":[{"quote":"...","reason":"no data","topic":"colour"}]},
 "factors":["main_use_intensity","cash_price","budget_monthly_down"],
 "notes":"optional"}
```

| Field | Values |
|---|---|
| `id` | `p001` to `p300`, unique |
| `label` | always `synthetic` (checker fails otherwise) |
| `lang` | `ar` (Egyptian Arabic, including Arabizi), `en`, `mixed` (Arabic and English in one sentence) |
| `category` | `mobile`, `laptop`, `tv`, `ac`, `fridge`, `none` |
| `expected.slots` | `{slotId: value}`, mobile phrases only. Single-choice slot: option id string. Multi slot (`use`, `photoType`, `pain`, `compat`, `brand`, `brandAvoid`): array of option ids. Numeric slot (`budget`, `monthlyCap`, `down`): the number in EGP when the buyer stated one, or a preset option id (for example `d0` for "no down payment"). `shops`: `{prefer?: [retailerId], avoid?: [retailerId]}`. `modelInMind`: the model name as a normalized string. |
| `expected.unmapped` | `{quote, reason, topic}`; `quote` is a substring of `text`; `reason` is `not supported yet` or `no data`; `topic` is `colour`, `trade-in`, `condition`, `wait-for-sale` or `social` |
| `factors` | Buying-factor ids from `config.factors`. Derived from the expected slots through the `factors` tags in `config/mobile.json`, plus the factor of each unmapped topic (see below). The checker verifies each tag is backed by a slot or topic. |
| `notes` | Why the phrase is tricky (optional) |

Authoring conventions that scorers must know:

- `urgentDays` is an option id (`today`, `week`, `none`); the config gives it no numeric form, so "within 3 days" is `week`.
- "Official warranty only / no imports" is `acceptImports: no`; "I insist on an official warranty" is `warranty`.
- `pay` is set only when the buyer names the way (cash, card, a bank, a finance company). A bare "قسط 1000" gives `monthlyCap` and no `pay`. Phrases that state two ways at once leave `pay` out.
- "iPhone" gives `brand: [apple]` and `os: ios`.
- A bare number in the phone price range with no unit ("حوالي ١٥", "around 15") is read as thousands of EGP.
- "No Chinese brands" expands to the Chinese-owned brands in the config (xiaomi, oppo, realme, honor, infinix, tecno, vivo). This is a judgement call; a scorer may accept any non-empty subset.
- Not-used topics map to these (not yet captured) factors: colour and look to `look_colour` (reason `no data`, colour stock is not tracked), trade-in to `trade_in`, new versus used or open box to `fakes_used`, waiting for a better sale to `timing_launch_currency` (the closest uncovered factor; `timing_sales` is a covered factor), family and friends to `family_opinion`. All but colour use `not supported yet`.
- Phrases for `laptop`, `tv`, `ac`, `fridge` and `none` expect category detection only: empty `slots`, empty `unmapped`.
- The acceptance rule (tech-spec 4.1) means every mobile phrase has at least one slot or one unmapped item, so the set holds no bare "عايز موبايل". The "almost nothing" phrases carry exactly one slot (for example "عايز موبايل كاش").

## What the 300 phrases contain

- Language: Arabic 175 (58 percent), English 83 (28 percent), mixed 42 (14 percent). The Arabic lines include typos, Arabic-Indic digits, Arabizi, numbers spelled in words and Latin brand names.
- Category: 275 mobile, 5 each for laptop, TV, AC and fridge (20), and 5 with no clear category.
- Not used topics: 31 phrases carry an unmapped item (colour 7, trade-in 6, condition 6, wait-for-sale 6, social 6).
- Money formats: `15 ألف`, `١٥٠٠٠`, `15k`, `15,000`, `1500 في الشهر`, `قسط 1000`, `مقدم 5000`, spelled-out numbers.
- All 22 city options appear; shops (prefer and avoid), cash on delivery, card banks and finance providers are covered.
- 22 contradictory or tricky phrases (premium model with a very low budget, budget plus monthly cap, a model that does not exist, negation, ambiguous money) and 5 near-complete phrases (7 or more slots).

### Coverage table (output of `node eval/coverage.js`)

Captured factor = a config factor with at least one slot in `via`. Acceptance rule: at least 5 phrases each.
Factors that share one slot (`timing_sales`, `urgency`, `delivery_time_fee` on `urgentDays`; `cash_price` on `budget`) move together, so for those the count is evidence about the slot, not independent evidence per factor.

| Factor | Slots | Phrases |
|---|---|---|
| main_use_intensity | use, intensity, gameLevel, photoType, parentUse, storageNeed | 54 |
| who_for | who | 19 |
| current_device_problem | pain | 11 |
| compatibility | compat | 6 |
| cash_price | budget | 51 |
| payment_way | pay, provider | 32 |
| budget_monthly_down | budget, monthlyCap, down | 79 |
| installment_cost | provider | 14 |
| resale_value | keep | 8 |
| timing_sales | urgentDays | 21 |
| official_vs_import | acceptImports | 13 |
| retailer_trust_returns | shops | 15 |
| delivery_time_fee | urgentDays, city | 51 |
| cod | cod | 11 |
| software_updates | keep | 8 |
| brand_reputation | brand | 26 |
| brand_status | brand, brandAvoid, os | 41 |
| model_in_mind | modelInMind | 17 |
| urgency | urgentDays | 21 |

Lowest count: 6 (`compatibility`).

## How a future extractor run should be scored

Run the Layer 1 extractor (U2 plus the normalizer U3) on every `text`, and compare its normalized output with
`expected`. Use only values the extractor would pre-fill as chips (confidence at least 0.7, tech-spec U4); report
lower-confidence values separately. Never tune prompts on this file alone, and re-score on real phrases as soon
as they exist.

1. **Slot accuracy (the gate, at least 90 percent).** Over all expected `(slot, value)` pairs of mobile phrases:
   `correct pairs / expected pairs`. A pair is correct when:
   - single-choice slot: same option id;
   - multi slot: same set of option ids (no partial credit);
   - numeric slot: same number; a preset option id counts when it equals the expected id, or when its `value` equals the expected number;
   - `shops`: same `prefer` set and same `avoid` set;
   - `modelInMind`: equal after normalization (case, Arabic-Indic digits, Arabic-script brand names) or both resolve to the same product id through name or alias; for models that do not exist, equal after normalization.
   Report also: phrase-level exact match (all slots right, none extra), per-slot accuracy, and per-factor accuracy using the `factors` tags.
2. **Spurious slots.** Slots the extractor fills that are not in `expected.slots`, as a share of its filled slots. Proposed ceiling: 5 percent. Spurious slots are the "chip edit rate" risk.
3. **Unmapped recall.** For every expected unmapped item, the extractor must return an `unmapped` item whose `topic` (or the factor it maps to) matches; the quote may differ in length but must overlap the expected quote. `recall = found / expected`, over the 31 phrases that carry one. Proposed target: at least 90 percent (tech-spec states none; confirm it with the product owner). Also report per topic and **unmapped precision**: unmapped items returned on phrases that expect none, as a share of returned items (proposed ceiling 5 percent).
4. **Category detection.** `category` accuracy over all 300 phrases (U1), including the `none` phrases and the 20 other-category phrases, which must come back with no slots. Proposed target: at least 95 percent.
5. **Never in nothing.** Every mobile phrase must end in a slot value or a Not used chip (the Acceptance rule); count phrases where the extractor returns neither.
6. **Contradictions.** The tricky phrases (see `notes`) should be scored on slots as above; whether the consistency checker (U6) then raises a flag is tested in the Layer 1 tests, not here.
7. Break results down by `lang` (ar, en, mixed) and by the Arabic variants named in `notes`.

A live run should write its results next to this file (for example `eval/results-<date>.json`) and never overwrite
`phrases.jsonl`. `loadPhrases()`, `loadContext()` and `checkPhraseSet()` are exported from `eval/coverage.js` for reuse.

## Config gaps found

`config/mobile.json` was not changed. These are things the phrases show that the config cannot hold or that need a decision:

1. **Provider `khanstore`.** `data/synthetic/plans.json` has a fifth provider ("Khan store installments", `khanstore`) that is not an option of the `provider` slot (`nilebank`, `horusbank`, `sahla`, `qest`; `optionsSource` is `plans.provider`). A buyer naming it cannot be expressed. No phrase uses it.
2. **Installment length.** Buyers say "24 شهر", "على سنة", "6 months interest free". No slot holds the tenor. Phrases that mention it keep it out of `expected` (see `notes`); there is also no Not used topic for it.
3. **Phone specifications.** Buyers ask for 5G, fast charging, screen size, RAM, light weight or a big battery by number. There is no slot and none of the five Not used topics fits, so the schema of `unmapped` cannot label them. The phrases avoid them. Real phrases will contain them: decide whether to add an unmapped topic (for example `spec`) or slots.
4. **`urgentDays` has no numeric form.** The slot is options only (`today`, `week`, `none`), although the brief treats it as numeric. "Within 3 days" is expressed as `week`.
5. **Brands outside the option list.** Only 11 brand ids exist. Poco maps to xiaomi (products.json does the same). Others (Nokia, Huawei, Lenovo, Google) have no id; "no Chinese brands" has to be expanded into several ids.
6. **Factors with no slot for phones.** `environment` and `install_quality`/`install_wait` are out of scope for phones; `physical_fit` has no slot; bundles and gifts ("with a case"), `branch_pickup`, `time_limited_offer` and `timing_launch_currency` have no slot. The last one is the closest home for the "wait for a better sale" topic, but `timing_sales` is a covered factor.
7. **`shops` and `modelInMind` have no option ids.** They are validated against `data/synthetic/retailers.json` and by non-empty string; their `valueShape` is checked by `coverage.js`, not by the config.
8. **Pay way inference.** "قسط" alone does not say card or finance, and `pay` has no "unknown installment" value, so the phrases leave `pay` unset. Layer 1 will have to ask.
9. **Brand versus OS.** "iPhone" is stated in the set as both `brand: [apple]` and `os: ios`. The two slots overlap; decide whether Layer 1 fills both.
