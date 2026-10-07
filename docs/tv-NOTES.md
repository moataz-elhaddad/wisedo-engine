# TV category: build notes

The second category on the category-agnostic engine. It is made only of config, synthetic data, tests and eval phrases. No engine code was changed. **All data is synthetic**: the specs, scores, prices, offers and gifts are invented. The model-style names are there only so Layer 1 can match a model name.

## Files

| Path | What |
|---|---|
| `config/tv.json` | Category config: id `tv`, aliases `television` and `screen`, version 1.0.0. It has 17 attributes (13 scored, 4 filter-only), 22 slots, 4 checks and 40 buying factors. Zones are copied from mobile. |
| `data/generate-tv.js` | Deterministic generator (mulberry32, seed `20261004`, `DATA_NOW` and `TENANT` imported from `generate.js`). It writes `data/synthetic/tv/{products,offers,manifest}.json`. |
| `data/synthetic/tv/` | 36 TVs from 9 brands across 3 tiers, with 136 offers. Retailers and plans are the shared `data/synthetic/{retailers,plans}.json`, which were read but not modified. |
| `test/tv.test.js` | 15 `node:test` tests (see below). |
| `eval/phrases-tv.jsonl` | 40 synthetic TV phrases: 26 Arabic, 10 English, 4 mixed. Ids are `p601` to `p640` so they cannot collide with the mobile `p001` to `p300`. |

Regenerate the data with `node data/generate-tv.js`. Run the tests with `node --test test/tv.test.js`.

## Attributes

**Scored:**

| Attribute | Range or type | Note |
|---|---|---|
| `picture` | 1-10 | |
| `brightness_nits` | 200-1500 | |
| `motion_hz` | 50-144 | |
| `sound` | 1-10 | |
| `smart` | 1-10 | Smart platform and apps |
| `gaming` | 1-10 | |
| `hdmi21` | boolean | Stands for HDMI 2.1 plus VRR |
| `screen_inches` | 32-85 | Bigger is better, within the fit set by the room filter |
| `service` | 1-10 | |
| `warranty_months` | 12-60 | |
| `power_kwh_year` | 40-300 | Lower is better |
| `ease` | 1-10 | Simple remote and interface; for older buyers |
| `bracket_included` | boolean | |

**Filter-only:**

- `panel`: led, qled, oled, mini_led
- `resolution`: hd, fhd, 4k, 8k
- `os`: google_tv, android, webos, tizen, other
- `series`: entry, mid, premium

## Slots and ask flow

**Need slots:**

| Slot | Asked | What it does |
|---|---|---|
| `room` | always | Viewing distance becomes a hard size filter on `screen_inches`: small = 24-43, medium = 43-55, large = 55-75, xlarge = 65 or more. |
| `use` | always, multi-choice | series, sports, gaming, kids, general |
| `console` | when use = gaming | `next_gen` makes HDMI 2.1 a must. |
| `light` | by gain | dark, normal, bright |
| `who` | by gain, default `family` | |
| `wallMount` | by gain, default `stand` | |
| `pain` | never (manual) | |
| `panel` | when maxPrice is 40,000 or more | Same pattern as `os` for mobile. |
| `os` | never (manual) | |

**Money and logistics slots** follow the mobile pattern: `pay`, `provider`, `budget`, `monthlyCap`, `down`, `urgentDays`, `acceptImports`, `city`, `cod`, `shops`.

- Budget presets: 10k, 15k, 20k, 30k, 45k, 60k, 90k.
- Monthly cap presets: 750, 1,000, 1,500, 2,500, 4,000.
- Down payment presets: 0, 3k, 5k, 10k.

**Preference slots:** `brand` (tie-break only, 9 brands), `brandAvoid` and `modelInMind`.

**Typical flow from the tile:** room, use, pay, budget. That is 4 questions, plus `urgentDays` while White Friday is 1 to 10 weeks away (it is about 8 weeks away at `DATA_NOW`). The test checks 3 flows and each one reaches a result in at most 6 questions.

## Tests (15, all pass)

- **Config:** passes the publish check; it is fully bilingual; every slot and option id that a condition, a `dependsOn` or a default refers to exists; effects touch only known attributes; brand options match catalog brands.
- **Snapshot:**
  - It validates.
  - Every row is synthetic, product ids start with `tv-` and no id is shared with a mobile product.
  - It has 3 tiers and at least 8 brands.
  - Each product has 3 to 5 offers, except the one kept without offers on purpose.
  - Only `khan` sells imports.
- **Generator:** deterministic, and its output equals the committed files.
- **Edge cases** (all listed in the manifest):
  - missing spec: `tv-xiaomi-q2-55` brightness
  - all offers stale: `tv-sharp-32-smart`
  - no offers: `tv-sony-75-x85l`
  - specs older than 60 days: `tv-hisense-43-a6`
  - one offer out of stock, one stale offer, one offer with stale gifts
  - khan imports
  - free wall-mounting install extras at nile
  - zone gaps
- **10 scripted buyers:**

  | Buyer | Expected result |
  |---|---|
  | Bedroom, 10k cash | Pick is 43 inches or smaller and within budget. |
  | Bedroom, 15k cash | Better fit and better picture than the 10k pick. |
  | Football, 40k cash | 120 Hz or faster, 43 to 55 inches. |
  | Next-gen gaming (PS5 at 120 fps), 45k cash | HDMI 2.1. |
  | Next-gen gaming, 25k cash | `nothing_fits`, plus the check warning. |
  | Big hall, 90k cash | 65 inches or larger. |
  | OLED only | Only OLED picks. |
  | Sunny room | 800 nits or more. |
  | Older parent | Ease 7 or more and service 8 or more. |
  | Finance buyer at 1,000 a month | Eligible picks stay under the cap; the TCO includes electricity. |

  Simulate agrees with rank for every buyer. A separate import test checks that a buyer who accepts imports gets the cheaper khan unit.
- **Layer 1:** three sessions from the tile reach a result in at most 6 questions, and the first question is `room`. Free text "عايز تلفزيون للماتشات" is routed to `tv` by the rules.
- **Eval phrases:** 40 valid lines, and every line has a slot or a Not used item.

**Full suite** (`node --test test/`) at the time of writing: 190 tests, 189 pass. The one failure is `fridge eval phrases`, which belongs to another worker's in-progress category, not to the TV files.

## Assumptions to review (every number is a starting assumption, BRD section 8)

1. **Size ranges by distance.** Under 2 m: up to 43 inches. 2-3 m: 43-55. 3-4 m: 55-75. Over 4 m: 65 or more. These are rules of thumb for 4K at a comfortable viewing angle. The ranges are hard `between` filters, and adjacent ranges share a boundary size (43, 55).
2. **Base weights:**
   - picture 1.2
   - screen_inches 0.8
   - smart 0.6
   - service 0.6
   - brightness 0.4
   - sound 0.4
   - motion 0.3
   - warranty 0.3
   - power 0.2
   - gaming, hdmi21, ease and bracket 0

   Use effects add weight on top of these. For example, sports adds +1.2 motion, and gaming adds +1.5 gaming.
3. **Bracket weight.** A wall-mount buyer gets only +0.3 weight on `bracket_included`. At 0.8 it swung picks for an item worth about 300 EGP.
4. **Electricity.** `runningCost = power_kwh_year x 2 EGP/kWh`. This is an assumed average tariff and should be checked against the current EEHC tiers. The kWh/year figures are invented.
5. **Resale and install cost.** `resale = null`, because TVs are rarely resold and there is no reliable share. `installCost = 0`.
6. **`maxMonths = 36`.** The mobile config uses 24. TV tickets are larger, and nile's `nile-sahla` plan already offers 36 months. Long terms make the financing cost large (the `financing_over_35` warnings), so check whether 24 is preferred.
7. **Check thresholds:**
   - big room with a budget under 25k
   - next-gen gaming under 30k (HDMI 2.1 starts at about 33k in this catalog)
   - OLED in a bright room
   - sports with a budget of 15k or less
8. **`pain` and `os` are manual.** Buyers volunteer them in text. Asking `pain` by gain pushed a flow to the 8-question cap.
9. **`who` is not always asked** (default `family`). Most TVs are household purchases.
10. **The khan import discount is 6-10%**, and khan carries only Samsung, LG, Sony and Xiaomi.
11. **Scores are editorial estimates.** Service is high for brands with an Elaraby-style local network (Tornado, Sharp, Toshiba) and for Samsung and LG. Warranty is 60 months for the locally assembled brands. All of these are invented.

## Unverified

- No live LLM extraction was run on the TV phrases. Their `expected` values are hand-authored.
- `p627` reads "PS5" as `next_gen`. `p638` names valU, which has no sample provider id, so `provider` is left unset.
- Prices and specs are not compared with any real market data.

## Core changes I think are needed (not made)

1. **A numeric size slot that creates a filter.** Buyers often name a size ("عايز 55 بوصة"). Today a numeric slot can only `set` money, logistics, derived or shops paths; it cannot add a `must`. A stated size therefore has no home: it has to be mapped approximately onto a `room` option, or dropped. The eval phrases keep stated sizes out of `expected`.

   Proposal: `numeric.filter: {attr, op}` (for example `screen_inches`, `between` with a ±tolerance), applied by `buildNeedProfile`.
2. **Install cost per buyer.** `installCost` is a single number per category. For TVs, the wall-mount charge applies only to buyers who mount on the wall.

   Proposal: let `installCost` be `{amount, when: Condition}` so that `wallMount = wall` adds, for example, 500 EGP unless the offer has an `install` extra. As built, an `install` extra on a TV is only informational because `installCost` is 0.
3. **`eval/coverage.js` hard-codes the mobile acceptance rule.** The rule "a line must carry a slot or an unmapped item" applies only to `category === 'mobile'`, and `loadContext()` reads `config/mobile.json`.

   The TV test works around this by relabelling its lines to `mobile` before calling `checkPhraseSet` with `config/tv.json`. Proposal: add a `category` parameter to `checkPhraseSet` and to `loadContext`.

   The phrase id regex `^p\d{3}$` also limits all categories to 999 ids in total. The TV set uses `p601` to `p640`.
4. **Category-specific not-used topics.** The five topics (colour, trade-in, condition, wait-for-sale, social) are phone-oriented. TV buyers also say things like "soundbar" (I already have one) or "has a receiver built in" (a built-in satellite receiver), and nothing can hold these. A per-config `unmappedTopics` list would help.
5. **The shared plan `pharos-horus-samsung`** is limited to Samsung phones through `product_override`, so Samsung TVs never get its 0% promo. That is correct for this data. A per-category promo needs either new plan rows or a `category` field on plans.
