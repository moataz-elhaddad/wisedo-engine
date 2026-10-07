# Wisedo engine contracts (v1.0.0)

These are the shapes and ids that Layer 1, Layer 2, the data pipeline and the API share. Treat every id in this file as **stable**: renaming one is a breaking change that needs a new config version and a note here.

Code: `src/contracts.js` (JSDoc typedefs, constants and validators). Every validator returns `{ok, errors[]}` and never throws.

| File | Holds |
|---|---|
| `src/contracts.js` | Typedefs, enums, `emptyNeedProfile()`, validators for every shape below |
| `src/conditions.js` | The JSON condition language used inside configs |
| `src/profile/build.js` | `buildNeedProfile(config, answers)`: applies config option effects to slot answers |
| `src/layer2/index.js` | `match(needProfile, catalogSnapshot, now, mode, options)` |
| `config/mobile.json` | The mobile category config |
| `data/synthetic/*.json` | Synthetic market rows (every row `source: "synthetic"`) |

---

## 1. Fixed ids

| Kind | Ids |
|---|---|
| Category | `mobile` (alias `phone` is accepted wherever a category id is read) |
| Consumer tenant | `wisedo`. A B2B company is its own tenant id. |
| Payment way (`money.pay`) | `cash`, `card`, `finance`, or `null` (unknown, quoted as cash and flagged) |
| Plan kind | `card`, `finance` |
| COD (`logistics.cod`) | `must`, `prefer`, `null` |
| Zones | `greater_cairo`, `alexandria`, `other` |
| Need sources | `text`, `answer`, `default`, `derived`, `edit` |
| Profile status | `complete`, `good_enough`, `incomplete` |
| Record sources | `synthetic`, `crawl`, `feed`, `manual`, `upload` |
| Filter ops | `>=` `<=` `>` `<` `==` `!=` `in` `not_in` `between` |
| Extra (gift) types | `install`, `warranty`, `cashback`, `gift`, `bundle` |
| Pick roles | `best_fit`, `best_value`, `premium`, `cheaper`, `alternative` |
| Modes | `rank`, `simulate` |

### Mobile attributes (`config.attributes[].id`)

Scored (number or boolean, normalised on a fixed basis): `perf` (1-10), `camera` (1-10), `battery_mah` (3000-7000), `screen` (1-10), `storage_gb` (64-512), `ram_gb` (3-16), `updates_years` (1-7), `service` (1-10), `ease` (1-10), `warranty_months` (12-24), `weight_g` (150-230, lower is better), `charging_w` (10-120), `has_5g` (boolean).
Not scored, used by filters only: `os` (`android` | `ios`), `series` (`entry` | `mid` | `flagship`).
Filters and bonuses may also use the top-level product fields `brand` and `id`.

### Mobile slots (`config.slots[].id`)

Slot ids are short camelCase; option ids are short lowercase snake_case. `factors` are ids from `config.factors` (the 40 buying factors of tech-spec 5.2).

| Slot | Group | Options | Numeric path | Default | Asking rules | Factors |
|---|---|---|---|---|---|---|
| `who` | who | `me` `parent` `kid` |  | me | always | who_for |
| `use` | core | `social` `photo` `gaming` `work` `basic` |  |  | always, dependsOn who in [me, kid], multi | main_use_intensity |
| `intensity` | core | `light` `normal` `heavy` |  | normal | askIf use answered | main_use_intensity |
| `gameLevel` | followup | `heavy` `light` |  |  | always, dependsOn use in [gaming] | main_use_intensity |
| `photoType` | followup | `people` `night` `video` |  |  | always, dependsOn use in [photo], multi | main_use_intensity |
| `parentUse` | followup | `basic` `more` |  |  | always, dependsOn who in [parent] | main_use_intensity |
| `pain` | followup | `battery` `slow` `storage` `camera` `broke` |  |  | dependsOn who in [me, kid], multi | current_device_problem |
| `storageNeed` | core | `any` `s128` `s256` `s512` |  | any | gain | main_use_intensity |
| `compat` | who | `none` `mac` `apple_watch` `galaxy_watch` |  | none | manual (from text), multi | compatibility |
| `keep` | core | `short` `long` |  |  | gain | resale_value, software_updates |
| `os` | preferences | `any` `ios` `android` |  | any | dependsOn who in [me], askIf derived.maxPrice >= 30000 | brand_status |
| `pay` | money | `cash` `card` `finance` |  |  | always | payment_way |
| `provider` | money | `nilebank` `horusbank` `sahla` `qest` (sample providers) |  |  | dependsOn pay in [card, finance], askIf signal providerMatters | payment_way, installment_cost |
| `budget` | money | `b8000` `b12000` `b18000` `b25000` `b40000` `b60000` `b90000` | `money.budget` | | always, dependsOn pay in [cash] | budget_monthly_down, cash_price |
| `monthlyCap` | money | `m500` `m1000` `m1500` `m2500` `m4000` | `money.monthlyCap` | | always, dependsOn pay in [card, finance] | budget_monthly_down |
| `down` | money | `d0` `d2000` `d5000` `d10000` | `money.down` | d0 | dependsOn pay in [card, finance], askIf signal downChangesPick | budget_monthly_down |
| `urgentDays` | logistics | `today` (1 day) `week` (7) `none` (null) |  | none | alwaysIf signal saleWeeks in 1..10, askIf signal urgencyMatters | urgency, delivery_time_fee, timing_sales |
| `acceptImports` | logistics | `no` `yes` `warranty` |  | no | askIf signal importCheaper | official_vs_import, warranty_length |
| `city` | logistics | one option per key of `config.zones.cities` (cairo, giza, qalyubia, alexandria, dakahlia, ...) |  |  | askIf signal zoneMatters | delivery_time_fee |
| `cod` | logistics | `must` `prefer` `no` |  | no | manual (never asked) | cod |
| `shops` | preferences | value `{prefer: [retailerId], avoid: [retailerId]}` |  |  | manual | retailer_trust_returns |
| `brand` | preferences | `apple` `samsung` `xiaomi` `oppo` `realme` `honor` `infinix` `tecno` `vivo` `motorola` `hmd` |  |  | tiebreak (near tie only), multi | brand_status, brand_reputation |
| `brandAvoid` | preferences | same brand ids |  |  | manual, multi | brand_status |
| `modelInMind` | preferences | value: a product id (preferred) or a model name |  |  | manual | model_in_mind |

"gain" means: not always asked; Layer 1 asks it only when its gain (simulate) is at least 1.
Numeric slots accept either a number (`{slot: "budget", value: 15000}`) or a preset option id (`"b18000"`).

**Signals** used in `askIf`/`alwaysIf` are facts Layer 1 computes (mostly by calling simulate): `providerMatters`, `downChangesPick`, `saleWeeks`, `urgencyMatters`, `importCheaper`, `zoneMatters`. An unknown signal is false.

### Synthetic market ids (sample only)

Retailers: `nile`, `pharos`, `lotus`, `oasis`, `delta`, `khan` (market shop, imports only, Greater Cairo only), `sphinx`.
Providers: `nilebank`, `horusbank` (card), `sahla`, `qest` (finance), `khanstore` (store finance, 30% down).
Product ids are kebab-case brand-model, e.g. `samsung-a56`, `apple-iphone-15` (see `data/synthetic/products.json`).

---

## 2. Need Profile (Layer 1 -> Layer 2)

The only thing Layer 1 hands to Layer 2. Stored with the session so any result can be replayed.

```json
{
  "category": "mobile",
  "needs": [
    {"slot": "use", "value": ["photo"], "source": "text", "confidence": 0.92, "confirmed": true, "evidence": "عايز كاميرا حلوة"},
    {"slot": "photoType", "value": ["night"], "source": "answer"},
    {"slot": "who", "value": "me", "source": "default"}
  ],
  "weights": {"perf": 1, "camera": 3.7, "battery_mah": 1, "screen": 0.6, "storage_gb": 0.4, "ram_gb": 0.3, "updates_years": 0.5, "service": 0.6, "ease": 0, "warranty_months": 0.2, "weight_g": 0, "charging_w": 0.2, "has_5g": 0},
  "must": [{"attr": "storage_gb", "op": ">=", "value": 128, "why": {"ar": "...", "en": "You asked for 128 GB or more"}, "from": "storageNeed:s128"}],
  "prefer": [{"attr": "brand", "op": "in", "value": ["Samsung"], "order": 1, "why": {"ar": "...", "en": "..."}, "from": "compat:galaxy_watch"}],
  "bonus": [{"attr": "brand", "op": "in", "value": ["Samsung"], "points": 5, "from": "brand:samsung"}],
  "money": {"pay": "finance", "provider": null, "budget": null, "monthlyCap": 1500, "down": 0},
  "logistics": {"urgentDays": null, "acceptImports": false, "city": null, "cod": null},
  "shops": {"prefer": [], "avoid": []},
  "derived": {"maxPrice": 24324.32},
  "modelInMind": "Galaxy A56",
  "unmapped": [{"text": "لونه أزرق", "reason": "not_supported", "factor": "look_colour"}],
  "open": ["keep"],
  "status": "complete"
}
```

| Field | Type | Meaning |
|---|---|---|
| `category` | string | Config id (`mobile`) or alias. |
| `needs[]` | `{slot, value, source, confidence?, confirmed?, evidence?}` | Every slot value with its source, so explanations can say "you said" vs "I assumed". Layer 2 reads needs only through config conditions (checks, resale), never as free text. |
| `weights` | `{attrId: number}` | Final weights (base + answer effects, negatives clamped to 0). `{}` means "use `config.baseWeights`". |
| `must[]` | Filter | Hard filters (M2). An unknown attribute keeps the product, labelled "not listed". |
| `prefer[]` | Filter + `order` | Soft filters (M6). Higher `order` = stated later = relaxed first. |
| `bonus[]` | `{attr, op, value, points}` | Score bonus (brand +5). **Addition** to the tech-spec example. |
| `money.pay` | `cash`/`card`/`finance`/null | Selects plans. null is quoted as cash with a `pay_assumed` warning. |
| `money.provider` | string, string[] or null | **New.** Buyer's bank or finance company id(s). When set, plans of other providers are dropped. |
| `money.budget` | number or null | Cash budget, EGP. Also applies to installment buyers if given (total paid / budget). |
| `money.monthlyCap` | number or null | Max monthly installment, EGP. Ignored for cash. |
| `money.down` | number | Down payment, EGP (default 0). Ignored for cash. |
| `logistics.urgentDays` | number or null | Max delivery days. A preference, relaxed last. |
| `logistics.acceptImports` | boolean | false (default) excludes grey imports. |
| `logistics.city` | string or null | **New.** A key of `config.zones.cities`. null = nationwide (assumed, warned). |
| `logistics.cod` | `must`/`prefer`/null | **New.** Cash on delivery. must = hard, prefer = relaxable. |
| `shops.prefer[]`, `shops.avoid[]` | retailer ids | **New.** Avoided shops are dropped (hard); preferred shops are relaxable. |
| `derived` | object | Derived facts (`maxPrice`, `keepShort`, ...). Used by conditions. |
| `modelInMind` | string or null | Product id, name or alias; Layer 2 returns a verdict. |
| `unmapped[]` | `{text, reason: not_supported|no_data, factor?}` | **New.** What the buyer said that no slot can hold ("Not used" chips). Layer 2 ignores it. |
| `open[]` | slot ids | Slots not asked (for "questions I skipped"). Layer 2 ignores it. |
| `status` | enum | Layer 2 ranks any status; only Layer 1 decides when to stop. |

### Filters, bonuses

`{"attr": "ram_gb", "op": ">=", "value": 8, "why": {"ar": "...", "en": "..."}}`. `attr` is an attribute id, `brand` or `id`. For `in`/`not_in` the value is an array; for `between` it is `[lo, hi]`. Evaluating on a missing or null attribute returns **unknown** (kept by must and prefer, never earns a bonus).

### Building a profile from answers

`buildNeedProfile(config, answers, {applyDefaults, status, open, unmapped})` in `src/profile/build.js`:

- `answers` is an ordered array `[{slot, value, source, confidence}]` or a plain object `{slot: value}` (insertion order = order stated).
- A later entry for the same slot replaces the earlier one (an edit).
- Unanswered slots with a `default` whose `dependsOn` holds are filled with source `default`.
- Each chosen option applies its `effects`: `weights` add up, `must`/`prefer`/`bonus` append (prefers get increasing `order`), `set` writes dotted paths under `money.`, `logistics.`, `derived.` or `shops.`.
- `dependsOn` controls **asking** and defaults only; a stated answer always applies its effects.
- Negative weights clamp to 0. Then `derive` rules run (`max_price` -> `derived.maxPrice`).
- Unknown slot or option ids throw: Layer 1's normaliser (U3) must drop them first.

---

## 3. Conditions (inside configs)

```text
{"all": [c, ...]}  {"any": [c, ...]}  {"not": c}
{"slot": "use", "in": ["photo"]}         any value of the slot is in the list
{"slot": "keep", "answered": true}
{"path": "derived.maxPrice", "lte": 12000}   ops: eq ne gt gte lt lte in between exists
{"signal": "importCheaper"}               truthy signal; or with an op: {"signal": "saleWeeks", "between": [1, 10]}
```
`evalCondition(cond, {profile?, answers?, signals?})` in `src/conditions.js`.

---

## 4. Market rows

Every row carries `tenant_id` and `source`. Layer 2 ignores any row whose `tenant_id` differs from the snapshot's `tenant_id`, at load time, before any step runs.

### Product
`{id, tenant_id, category, brand, name, ref_price_egp, attrs{}, popular?, aliases[]?, checked_at, source}`
A missing or null attribute is unknown ("not listed"). `checked_at` older than `config.freshness.specsDays` (60) excludes the product.

### Retailer
`{id, tenant_id, name, trust (1-10), return_days, cod, base_url?, affiliate_tag?, source}`
`affiliate_tag` exists for links only and is never read by Layer 2.

### Offer
```json
{"id": "o-samsung-a56-nile", "tenant_id": "wisedo", "product_id": "samsung-a56", "retailer_id": "nile",
 "url": "https://nile.example.invalid/p/samsung-a56", "price_egp": 23250,
 "delivery": {"greater_cairo": {"fee": 0, "days": 1}, "alexandria": {"fee": 0, "days": 3}, "other": {"fee": 50, "days": 4}},
 "in_stock": true, "official": true,
 "extras": [{"type": "gift", "label": "Wireless earphones", "value_egp": 400, "card_only": false}],
 "cod": true, "plan_ids": ["nile-sahla"],
 "checked_at": "2026-10-03T07:00:00.000Z", "extras_checked_at": "2026-10-02T12:00:00.000Z", "source": "synthetic"}
```
- `delivery` is keyed by zone id; **a missing zone means no delivery there**.
- `cod` (optional) overrides `retailer.cod`; `plan_ids` (optional) overrides the retailer's plans.
- Freshness: `checked_at` (price, stock) max 24 h; `extras_checked_at` (gifts) max 72 h, defaults to `checked_at`. A stale offer is never quoted or picked; stale gifts are not counted.

### Plan
`{id, tenant_id, provider, provider_name?, kind, months[], monthly_rate, admin_share, min_down_share, promo, valid_until, retailer_id, product_override, checked_at, source}`
- `valid_until` is `YYYY-MM-DD` (valid through the end of that day, UTC) or null.
- `retailer_id: null` = a plan usable at any retailer of the tenant.
- `product_override`: null, or the product ids this plan is limited to.
- `checked_at` older than 35 days: plan skipped.

### Catalog snapshot
`{snapshot_id, tenant_id, configs: {mobile: CategoryConfig}, products[], retailers[], offers[], plans[]}`. Immutable by contract: Layer 2 caches indexes per snapshot object.

---

## 5. Category config (`config/mobile.json`)

| Key | Holds |
|---|---|
| `id`, `version`, `aliases`, `label{ar,en}` | identity |
| `maxMonths` | longest installment term quoted (24 for mobiles) |
| `tcoYears` | 5 |
| `freshness` | `{priceStockHours: 24, deliveryGiftsHours: 72, plansDays: 35, specsDays: 60}` |
| `zones` | `{ids[], labels{}, cities{cityKey: zoneId}}` |
| `attributes[]` | `{id, label{ar,en}, unit, type: number|boolean|category, higherIsBetter, basis: {min,max} | "catalog", explain{ar,en} with {value}}` |
| `baseWeights` | `{attrId: weight}` |
| `slots[]` | `{id, group, label{ar,en}, question{ar,en}, factors[], options[], always?, alwaysIf?, dependsOn?, askIf?, multi?, numeric?: {path, unit, min, max}, default?, manual?, tiebreak?, valueShape?, optionsSource?, note?}` |
| option | `{id, label{ar,en}, value? (numeric preset), kind? (provider), effects?: {weights, must[], prefer[], bonus[], set{}}}` |
| `derive[]` | `{id, type: "max_price", target, refPlans[]}` |
| `checks[]` | `{id, when: Condition, message{ar,en}}` -> warnings `check:<id>` |
| `runningCost` | `{type: none | fixed {yearlyEgp} | attr {attr, factor}}` |
| `resale` | `{when: Condition, afterYears, rules: [{match: {brand?, <attr>?}, share}]}`; first matching rule wins |
| `installCost` | EGP added when an offer has no `install` extra (0 for phones) |
| `season` | `{saleEvents: [{id, rule: "last_friday_of_november", windowWeeks, savingShare, label}]}` |
| `factors[]` | the 40 buying factors: `{id, group, name, status: covered|partial|not_yet|out_of_scope, via: [{slot}|{attribute}|{offerField}|{planField}|{retailerField}|{configKey}], reason?}` |

`validateCategoryConfig` is the publish check: unknown attributes in effects, broken `dependsOn`, bad conditions, a factor with neither `via` nor `reason`, a slot without `factors`, or a city option without a zone all fail it.

---

## 6. Layer 2 API

```js
import { match } from './src/layer2/index.js';
const result = match(needProfile, catalogSnapshot, now, 'rank', { maxPicks: 3, maxList: 10 });
const sim    = match(needProfile, catalogSnapshot, now, 'simulate');
```
- `now`: Date, ISO string or epoch ms. Layer 2 never reads the clock.
- `options.maxPicks` (default 3), `options.maxList` (default 10, the whole ranked list including picks), `options.validate` (default true; rank only).
- rank throws `TypeError` on an invalid profile, unknown category, or a snapshot without `tenant_id`.

### Rank result
```text
{
  mode: "rank", engine_version, snapshot_id, tenant_id, category, config_version, now,
  status: "ok" | "nothing_fits" | "no_match",
  picks: Pick[],                 // roles unique, best_fit first
  others: ListRow[],             // the rest of the ranked list: eligible first, then stretch
  warnings: Warning[],           // global: pay_assumed, city_assumed, check:<id>, best fit's financing_over_35 / import_offer
  gaveUp: [{id, kind: cod|shops|prefer|urgent, why{en,ar}, filter?, value?}],
  nothingFits: null | {product|null, fit?, quote?, extraNeeded: [{kind: budget|monthly, amount, have, need}], text},
  modelVerdict: null | {query, productId, type, role?, text, ...},
  whyNotPopular: null | {productId, name, type, text, ...},
  timing: [{code: "white_friday", date, weeks, savingLow?, savingHigh?, text, source?}],
  assumptions: {pay: "cash"|null, city: "nationwide"|null},
  counts: {inScope, loaded, meetNeed, eligible, stretch, over},
  trace: [{step: M1|M2|M4|M5|M6|M7|M8|meta, text, count?, removed?, kept?}]
}
```

**Pick**: `{role, product{id,name,brand,source}, fit, score, dealBonus, brandBonus, affordability: eligible|stretch, verified, quote: Quote, tco, reasons[], perks[], notListed[], warnings[], otherOffers[]}`

**Quote** (every number traces to a field or formula):

| Field | Source |
|---|---|
| `price` | `offer.price_egp` |
| `deliveryFee`, `deliveryDays`, `zone`, `zoneAssumed` | `offer.delivery[zone]`; unknown city = highest fee and slowest days across zones |
| `plan` | `{planId, provider, providerName, kind, months, monthlyRate, adminShare, minDown, down, monthly, total, financingCost, financingShare, promo, validUntil, fitsCap}`; `total = (P - down)(1 + admin + rate*n) + down`, `monthly = ceil((total - down)/n)` |
| `gifts[]`, `giftValue`, `giftsStale` | `offer.extras` (card-only extras only for card buyers; install never counted as a gift) |
| `installCost` | `config.installCost` unless an `install` extra exists |
| `paid` | cash price, or plan total |
| `cashOut` | `paid + deliveryFee + installCost` |
| `effCost` | `paid + deliveryFee + installCost - giftValue` |
| `trustPremiumShare`, `rankCost` | `(9 - trust) * 1%`; `effCost * (1 + share)` |
| `ratio` | `cashOut / budget` (cash), `monthly / monthlyCap` (installments), max of both if both given; 0 when no limit |
| `trust`, `returnDays`, `cod`, `official`, `checkedAt`, `ageHours`, `source`, `url` | retailer and offer fields |

**tco**: `{years, effCost, yearlyRunningCost, resaleValue, resaleShare, total, relevant}`; `total = effCost + yearly*years - resale`.

**reasons[]** (top 2 strengths): `{attr, label, value, unit, text{en,ar}, source: "product.attrs.<attr>"}`.
**notListed[]**: `{attr, label, status: {en: "not listed", ar: "غير مذكور"}}`.
**warning codes** (per pick): `financing_over_35`, `import_offer`, `promo_ending`, `over_monthly_cap`, `stretch`, `not_listed`, `unknown_must`, `gifts_not_counted`. Each has `text{en,ar}`, optional `values`, and `source`.
**otherOffers[]**: `{offerId, retailerId, retailerName, status: chosen|lost, reasons[], reasonText[], price, effCost, monthly, planId, deliveryDays, official, checkedAt, url, costMoreBy?}`; loss reason codes: `out_of_stock`, `stale`, `import_not_accepted`, `avoided_shop`, `no_delivery_zone`, `no_cod`, `no_plan`, `unknown_retailer`, `slow`, `not_preferred_shop`, `no_cod_prefer`, `over_budget`, `costs_more`, `trust_premium`, `tie_break`.
**modelVerdict.type**: `not_in_catalog`, `picked`, `unavailable`, `fails_need`, `no_offer`, `excluded_by_preference`, `over_budget`, `weaker`, `close`.

### Simulate result
```json
{"mode": "simulate", "count": 27, "stretchCount": 0, "top1": "honor-x9c", "top1Shop": "oasis", "top3": ["honor-x9c", "samsung-a56", "xiaomi-14t"], "closest": null}
```
`count` = eligible products (within budget) after relaxing; `top1` follows the same Best-fit rule as rank (so they always agree); `top3` = top1 then the next two by score; `closest` = the nothing-fits product when `top1` is null. No explanation, no trace, no profile validation, no logging.
