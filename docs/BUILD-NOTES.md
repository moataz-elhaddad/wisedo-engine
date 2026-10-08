# Build notes: contracts, mobile config, synthetic data, Layer 2

First slice of the Wisedo decision engine. Plain JavaScript ES modules with JSDoc types, zero dependencies, Node 22. Nothing here reads the network, the clock or environment variables.

## What was built

| Path | What |
|---|---|
| `src/contracts.js` | Typedefs, enums and validators for NeedProfile, Product, Retailer, Offer, Plan, CategoryConfig (including the factor-coverage publish check), CatalogSnapshot, MatchResult |
| `src/conditions.js` | JSON condition language for configs (no functions in config files) |
| `src/profile/build.js` | `buildNeedProfile(config, answers)`: config option effects -> weights, must, prefer, bonus, money, logistics, shops, derived |
| `src/util.js` | Rounding, time parsing, dotted paths, White Friday date |
| `src/layer2/` | `index.js` (`match`), `snapshot.js` (tenant scoping, indexes, cache), `pipeline.js` (M1-M7 shared by both modes), `m1-candidates.js` ... `m9-explain.js`, `constants.js` |
| `config/mobile.json` | Mobile category config: 15 attributes, base weights, 24 slots, derive, checks, resale, season, zones, freshness, the 40 buying factors |
| `data/generate.js` | Seeded generator; writes `data/synthetic/{products,retailers,offers,plans,manifest}.json` |
| `data/synthetic/` | 40 phones, 11 brands, 7 retailers, 134 offers, 20 plans, all `source: "synthetic"` |
| `docs/CONTRACTS.md` | The contract: ids, shapes, API |
| `test/` | 9 test files (77 tests) plus `helpers.js`, `personas.js` (18 scripted buyers) and `index.js` (see "Running") |

## Running

```bash
cd wisedo-engine
node --test test/          # the whole suite
node data/generate.js      # regenerate data/synthetic (byte-identical for the same seed)
```

Node 22's runner treats a directory argument as a module path rather than a folder to glob, so `node --test test/` on its own would fail with "Cannot find module .../test". `test/index.js` handles that: when it is loaded as the directory entry, it imports every `*.test.js` in sorted order. When the runner finds files itself (plain `node --test`, or a glob such as `node --test 'test/*.test.js'`), it does nothing, so no test runs twice.

**Last run** (`node --test test/`, Node v22.22.0): 77 tests, 77 pass, 0 fail, about 1.5 s.
**Simulate speed:** 0.37 to 0.54 ms average per call across runs (0.387 ms on the last run) over 450 calls (18 personas x 5 hypothetical `use` answers x 5 rounds, after warm-up) on the synthetic set. The target is under 5 ms. The test prints the measured number as a diagnostic line.

## How Layer 2 works (one paragraph)

`match()` prepares a tenant-scoped, indexed view of the snapshot (cached per snapshot object), then runs:
- **M1** loads products that have a fresh, in-stock offer.
- **M2** applies must-filters. An unknown attribute keeps the product, labelled.
- **M3** computes need fit on the config's fixed basis.
- **M4** evaluates every offer for this buyer, recording hard drops, soft flags and a priced quote with the plan chosen.
- **M5** classifies each best quote as eligible, stretch or over.
- **M6** drops soft constraints one at a time while nothing is eligible.
- **M7** scores fit + deal + brand and computes TCO.

Rank mode then adds **M8** roles and **M9** explanations. Simulate returns ids and counts only. There is no randomness: every sort has an explicit final tie-break (product id or retailer id).

---

## Decisions where the spec was ambiguous or silent

Ids in brackets are referenced from code comments.

**Data and contracts**
1. **Category id is `mobile`** (the task names `config/mobile.json`; the tech-spec example uses `phone`). `phone` is accepted as an alias everywhere a category is read.
2. **Offer delivery is a map by zone**, `delivery: {zoneId: {fee, days}}`, instead of the single `delivery_fee` and `delivery_days` columns in the tech-spec table, which says "by zone" without giving a shape. A missing zone means the shop does not deliver there. Zones are `greater_cairo`, `alexandria` and `other`; `config.zones.cities` maps city keys to zones.
3. **Extra optional offer fields:** `cod` (overrides `retailer.cod`), `plan_ids` (explicit plans, as in the B2B `PUT /v1/catalog/offers`), and `extras_checked_at` (the 72-hour gifts freshness limit; defaults to `checked_at`).
4. **`plans.product_override` is read as a list of product ids** that the plan is limited to (null = all products). `retailer_id: null` means "any retailer of this tenant". A plan past `valid_until` is skipped whether or not it is a promo. A bare date means the end of that day, UTC.
5. **The NeedProfile gained `bonus[]`** (brand +5 needs a home; the spec example has none). `money.provider` accepts a string or an array. `derived.maxPrice` is computed by the builder.
6. **`dependsOn` only governs asking and defaults.** An answer the buyer states always applies its effects. For example, "it's for my mum, she loves photos" still raises the camera weight.
7. **`keep` has no default.** A default that adds weights would be an invisible assumption, and the spec requires every default to be visible.
8. **Slot ids are short camelCase** (`monthlyCap`, `urgentDays`, `gameLevel`), matching the names the task and spec already use; option ids are lowercase snake_case. Slots beyond the tech-spec 4.1 list: `pain` (problem with the current device), `storageNeed`, `keep` (resale, updates), `os`, `brandAvoid`, `parentUse`.
9. **Brand avoid is a prefer** (relaxable). A liked brand is a +5 bonus, as in technical-design-v4.

**Offer resolution (M4)**

10. **[D-plan] Plan formula follows technical-design-v4.** The formula is `total = (P - down)(1 + admin + r*n) + down`, so the admin fee is charged on the financed amount. Tech-spec 5.1 writes `+ admin * P`, charging it on the full price. The two agree when down = 0, which covers the worked example (all four rows reproduced exactly in `test/offers.test.js`). The task names v4 as the formula source. `monthly = ceil((total - down)/n)` in whole EGP; `total` is rounded to 2 decimals.
11. **Unknown payment way** (`money.pay: null`) is quoted as cash, with a `pay_assumed` warning. `monthlyCap` and `down` are ignored for cash buyers. When the buyer skips the payment question, Layer 1 sets `pay = cash` itself (founder decision 4), so the budget is still asked.
12. **[D-city] Unknown city means Greater Cairo** (founder decision, 2026-10-08). The zone comes from the config's `zones.assumedZone` and is shown as assumed, with a `city_assumed` warning; `assumptions.city` names the zone. A config without `assumedZone` falls back to nationwide: an offer is kept if it delivers anywhere, quoted at its highest delivery fee and slowest days across its zones. A city key not in the config maps to zone `other` in the engine; the profile validator rejects it in rank mode.
13. **Affordability ratio.** Cash buyers: `(price + delivery + install) / budget`. Installment buyers: `monthly / cap`. If an installment buyer also gave a budget, the larger of the two ratios applies. With no limit the ratio is 0.
14. **Ratios are rounded to 4 decimals, not 2.** With 2 decimals, an offer 0.4% over budget would count as within budget. Money, fit and score are rounded to 2 decimals.
15. **Best offer when nothing is affordable:** lowest ratio first (closest to affordable), then ranking cost, trust, delivery days, retailer id.
16. **Out-of-stock and stale offers are never quoted** (their numbers are not trustworthy). Offers dropped for being an import, from an avoided shop, or without COD are still quoted, so the "other shops" table can show their price and reason.
17. **Gifts.** Card-only extras (bank cashback) count only when `pay = card`. An `install` extra is never counted as a gift; it only removes the install charge. Stale gifts (over 72 h) count as 0 and raise a warning.
18. **COD rules apply whatever the payment way** (an installment buyer may still want COD for the down payment).

**Relaxing, roles and output (M5-M9)**

19. **[D-relax] Relax order:** COD "prefer" first, then preferred shops, then product prefer-filters latest stated first, then urgent delivery last. The spec says only "latest first, urgent last". Shops and COD carry no stated order because they are never asked, so they go first as the lowest-stakes preferences.
20. **The relaxer runs only while zero products are eligible (ratio <= 1).** If, after relaxing everything, only stretch products remain, the status is `nothing_fits`: no picks, the cheapest product that meets the need, and the extra money it needs. A stretch product can still appear as the Premium pick when something is eligible.
21. **[D-roles] Roles fill the pick slots in the order** best_fit, best_value, premium, cheaper, alternative, each role and each product at most once. With `maxPicks = 3` and a Best value present, this is exactly the spec's "premium, else cheaper, else alternative". When there is no Best value, the third slot goes to the next available role, so a buyer can get Best fit + Premium + Cheaper (BR-10 asks for 3 picks). `maxPicks > 5` is capped at 5.
22. **Alternative** = the highest-scoring unused eligible product whose brand differs from the Best fit's.
23. **Cheaper** compares effective cost. **Best value** compares 5-year TCO (equal to effective cost for phones unless resale applies).
24. **[D-list] `maxList` bounds the whole ranked list, picks included.** With the defaults, 3 picks + 7 others = 10. `others` lists eligible products first, then stretch ones, each in score order.
25. **"Verified" for the Best-fit rule** means no unknown value among the attributes that carry weight in this run, or among the attributes used by its must or prefer filters. An unknown attribute with zero weight does not block Best fit.
26. **Normalisation uses fixed min/max per attribute from the config** (`basis`), clamped to 0..1. This keeps a score meaning the same thing in every session and for every tenant catalog. `basis: "catalog"` (min/max over the tenant's category products) is also supported. An unknown value scores the midpoint, 0.5.
27. **[D-strength] Strengths:**
    - The pool is this run's eligible products.
    - "Top half of the category" means at or above the median for higher-is-better attributes (at or below for lower-is-better), over every product of the category in the tenant's scope.
    - The top 2 are ranked by `weight * (norm - pool average)`.
    - A pool of one product claims no strengths.
28. **Freshness enforcement:**
    - Price and stock: `offer.checked_at`, 24 h; the offer is unusable after that.
    - Gifts: `extras_checked_at`, 72 h; gifts count as 0 after that.
    - Plans: `plan.checked_at`, 35 days; the plan is skipped after that.
    - Specs: `product.checked_at`, 60 days; the product is not ranked after that.
    - Delivery days have no separate timestamp, so they follow the offer's `checked_at`.
29. **TCO** is always computed. It is marked `relevant` only when running cost or resale is non-zero. For phones, resale applies only when `keep = short` (`derived.keepShort`). Resale = `round(ref_price * share)`, using the first matching brand/series rule.
30. **White Friday advice** appears when it is 1 to 10 weeks away and `urgentDays` is null or at least the days left. The saving shown is 10% to 20% of the #1 pick's effective cost, labelled as an estimate.
31. **Why not the popular model:** the best-fitting popular product that was not picked and is not the model in mind, within 1.4x of budget.
32. **Model in mind** matches the product id, name, alias, or brand + alias (case and punctuation ignored). There is no fuzzy matching. Layer 1 should normalise to a product id when it can.
33. **Config `checks` are evaluated by Layer 2** and returned as global warnings `check:<id>`. Layer 1 (U6) can evaluate the same conditions earlier with `evalCondition`.
34. **Trace text is English only.** Its structured fields (`step`, `count`, `removed`) let the UI render Arabic. Reasons, warnings, perks, verdicts and nothing-fits text are bilingual.

**Modes, tenants and synthetic data**

35. **Simulate skips profile validation** for speed. Rank validates and throws a `TypeError` on an invalid profile.
36. **Tenant scoping happens once, when the snapshot is prepared.** Rows whose `tenant_id` differs from `snapshot.tenant_id` are ignored, including cross-tenant offers that point at the other tenant's products. A B2B snapshot therefore cannot leak into the consumer app or the reverse, even if a caller mixes rows.
37. **The synthetic data uses real brand and model names with invented specs and prices.** Layer 1 phrases need model names like "Galaxy A56". Retailers, banks and finance companies are invented. URLs use the reserved `.example.invalid` domain. Every record carries `source: "synthetic"`, and the manifest says so.
38. **The dataset is pinned to `now = 2026-10-03T12:00:00Z`** (`DATA_NOW` in `data/generate.js`). Tests pass that value to `match()`, so freshness and promo-end behaviour is reproducible.

## Deviations from the spec

| Spec says | Built | Why |
|---|---|---|
| Simulate runs M1-M5 and M7 | Simulate also runs M6 (relaxer) and applies the missing-data Best-fit rule | Otherwise simulate's top-1 can differ from rank's when a preference must be relaxed. The relaxer is cheap: 0.4-0.5 ms per call. |
| Tech-spec 5.1 plan math `+ admin * P` | technical-design-v4 `(P - down)(1 + admin + r*n) + down` | v4 is named as the formula source; the two differ only with a down payment (decision 10). |
| Roles: "premium, else cheaper, else alternative" | Ordered fill, each role at most once | Gives 3 picks when there is no Best value (decision 21). |
| Offer `delivery_fee` and `delivery_days` columns | `delivery` map by zone | The spec says "by zone" without a shape (decision 2). |
| Values round to 2 decimals before comparing | Ratios round to 4 decimals | Avoids calling an over-budget offer affordable (decision 14). |
| Spec 5.2 counts (25 covered, 6 partial, 9 not yet) | The mobile config marks environment, running cost, install wait, install quality and family opinion as `out_of_scope` for phones | Those factors belong to other categories, or are out of scope for every category. Every factor still has a slot, a field or a reason. |

No test is skipped or known to fail.

## Founder decisions (2026-10-08)

The open questions below (and those in `docs/LAYER1-NOTES.md`) were answered. "Kept" means the built behaviour was confirmed; "Changed" lists what the code now does.

| # | Topic | Decision | Code |
|---|---|---|---|
| 1 | Nothing within budget, something within 15% | No stretch picks: "nothing fits, you need X more", with the closest products | Kept (decision 20) |
| 2 | Planner policy | Default policy (median 3, max 7 on the personas) | Kept |
| 3 | "When do you need it?" | Taken from the text first; asked only while White Friday is under 4 weeks away, and only when it changes the pick | Changed: `urgentDays.alwaysIf` is `saleWeeks lt 4` and its `askIf` also requires it |
| 4 | Payment way skipped | Assume cash and still ask the budget | Changed: a skipped `pay` is set to cash (`source: skip_default`, not locked, shown as an assumed chip) |
| 5 | Unknown city | Assume Greater Cairo, shown as an assumed chip | Changed: `zones.assumedZone` in every config (decision 12) |
| 6 | Installment math and admin fee | Keep the math on as built; use each shop's published terms; checking each provider's rules is out of scope for now | Kept (decision 10) |
| 7 | Third pick without a Best value | Show 3 picks (Premium and Cheaper together) | Kept (decision 21) |
| 8 | Relax order | Shop and COD preferences before brand and need preferences | Kept (decision 19) |
| 9 | `maxList` | 10 in total, picks included | Kept (decision 24) |
| 10 | Provider options | From the tenant's plans at question time | Changed: `optionsSource: "plans.provider"` is resolved in `configFor` |
| 11 | What to ask an installment buyer | Still ask the monthly cap | Kept |
| 12 | Special installment offers (0%, no fees) | Count in the ranking | Kept: they lower the effective cost, which drives the deal bonus |
| 13 | Buyer has only one provider (for example valU) | Exclude shops without that provider on the product | Kept (`no_plan` hard drop) |
| 14 | B2B uploads without dates | Upload time counts as `checked_at` | Kept: `worker/csv.js` and the SKU API already stamp `checked_at` at write time |
| 15 | Laptop specs to scores | CPU and GPU lookup tables from public benchmarks give the 1-10 scores | To build with the catalog contract |
| 16 | Real model names in sample data | Keep them (sample data, labelled) | Kept (decision 37) |
| 17 | Rules of thumb | Review with an expert now | Open: the list to review is in "Rules of thumb that need an expert" below |
| 18 | Two LLM calls on an unclear opener | One combined call | Changed: kind `detect` returns the category and the slots |
| 19 | Clarifying questions and the cap | They do not count toward the cap | Changed: `questionCount` counts slot questions only |
| 20 | Next build step | Measure how well the LLM reads real Egyptian Arabic phrases | Next |

Each change has a test in `test/decisions.test.js`.

### Rules of thumb that need an expert (decision 17)

- The fixed attribute ranges (`basis`).
- The check thresholds (12,000 for heavy gaming or night photos; 30,000 for iPhones).
- The resale shares (Apple 60%, Samsung flagship 45%, Samsung 40%, Xiaomi 30%, others 25%).
- The White Friday 10-20% saving.
- The deal bonus for financed buyers (up to 5 points off for interest; a trust-10 shop gets a 1% discount).

## Notes for the Layer 1 worker

- Build profiles with `buildNeedProfile(config, answers)`, or produce the same shape yourself. Ids are listed in `docs/CONTRACTS.md` section 1.
- `match(profile, snapshot, now, 'simulate')` returns `{count, stretchCount, top1, top1Shop, top3, closest}`.
  - The spec's gain formula is: distinct `top1 + '@' + top1Shop` values minus 1, plus 0.3 x (distinct `top3` sets minus 1).
  - Tile counts use `count`.
  - The slot signals in `askIf` (`importCheaper`, `zoneMatters`, `providerMatters`, `downChangesPick`, `urgencyMatters`) can all be computed as "gain of that slot >= 1" by simulating its options.
  - `saleWeeks` is a date computation (`lastFridayOfNovember` in `src/util.js`).
- Simulate calls are cheap because the snapshot's indexes are cached per snapshot object. Reuse the same snapshot object across calls and never mutate it.

## Tunable parameters and the admin panel (added 2026-10-03)
- `src/params.js` is the single list of tunable numbers: `DEFAULT_PARAMS` (the old constants), `paramsOf(config)` (defaults plus `config.params`), `PARAM_SPECS` (label, help, range per control), `applyOverrides(baseConfig, overrides)` (validates, clamps, returns a normal config) and `listChanges`.
- Layer 2 reads them through `prep.params`; Layer 1 through `config.params.layer1` (an explicit `ctx.maxQuestions` / `ctx.policy` still wins). With no overrides every result is identical to before (test: "no overrides: the config and the results are unchanged").
- Also tunable through overrides: base priorities (`baseWeights`), what each answer adds (`slots[].options[].effects.weights`), `maxMonths`, `tcoYears`, `freshness.*`, the White Friday saving and window.
- `src/store.js` keeps the published version, draft and history (artifact `db`, else localStorage). `web/` holds the try-out page and the admin panel; `sh web/build.sh <dir>` assembles a folder to serve or publish.
- Not tunable yet (still code): the near-tie probe (2.99), role order, the trust-risk formula shape, per-slot question wording and order, per-category config structure, resale and running-cost rules.
