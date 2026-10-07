# Fridge category: build notes

The fridge category is built on the mobile template. The engine core (`src/`) did not change. All data is synthetic.

## Files

| Path | What |
|---|---|
| `config/fridge.json` | Category config `fridge` v1.0.0, alias `refrigerator`. It has 13 attributes (11 scored, plus `layout` and `series` for filters only), 22 slots, 4 checks, electricity running cost, no resale, `installCost` 0, White Friday season and 47 buying factors. |
| `data/generate-fridge.js` | Deterministic generator (mulberry32, seed `20261004`). It imports `DATA_NOW` and `TENANT` from `generate.js` and reads the shared `retailers.json` and `plans.json` without writing them. |
| `data/synthetic/fridge/` | `products.json` (34 fridges, 12 brands), `offers.json` (131 offers from all 7 shared retailers) and `manifest.json` (counts and edge cases) |
| `test/fridge.test.js` | 19 tests: validation, determinism, edge cases, option references, 10 personas, simulate and rank agreement, Layer 1 detection and sessions, eval phrases |
| `eval/phrases-fridge.jsonl` | 40 synthetic phrases (26 ar, 10 en, 4 mixed), ids `f001` to `f040` |

Run: `node data/generate-fridge.js` and `node --test test/fridge.test.js`.
Last run: fridge file 19/19 pass. Full `node --test test/` gave 190/190 pass, which includes the TV worker's file, present at the time of the run.

## Config in short

- **Attributes, scored:**
  - `capacity_l`, basis 120-700 L
  - `energy_kwh_year`, basis 150-700, lower is better
  - `cooling`, 1-10
  - `noise_db`, basis 32-46, lower is better
  - `build` (build and shelves), 1-10
  - `service`, 1-10
  - `warranty_months`, basis 12-120
  - `inverter`, `no_frost` and `dispenser` (booleans)
  - `width_cm`, basis 50-95, lower is better, base weight 0, used by the kitchen-width filter
- **Attributes, not scored:** `layout` (`single_door`, `top_freezer`, `bottom_freezer`, `side_by_side`, `french_door`) and `series` (`entry`, `mid`, `premium`).
- **Need slots:**
  - `household` (who group, always asked): `h2`, `h4`, `h6`, `h7`. Each answer sets a capacity must: none for h2, then 330, 430 and 520 L.
  - `use` (multi): `bulk`, `cooking`, `cold_drinks`, `basic`
  - `power`: `normal`, `bills`, `cuts`
  - `frost`: `any`, `no_frost` (must), `defrost_ok`
  - `space`: `any`, `w60`, `w70`, `w80`, `w95` (must on `width_cm <=`)
  - `layout`: `any` or one of the five layouts (must)
  - `placement`: `kitchen`, `open` (noise weight), `hot` (cooling and inverter weight)
  - `dispenser`: `no`, `nice`, `must`
  - `pain` (multi): `ice`, `bills`, `small`, `noisy`, `weak`, `broke`
- **Money, logistics and preference slots** follow the mobile pattern:
  - `pay`, `provider`, `down`, `acceptImports`, `city`, `cod`, `shops`, `brandAvoid` and `modelInMind` are as in mobile.
  - `budget` presets are 15k, 20k, 30k, 45k, 60k, 80k and 120k.
  - `monthlyCap` presets are 750, 1,000, 1,500, 2,500 and 4,000.
  - `down` presets are 0, 3k, 5k, 10k and 20k.
  - `urgentDays` has wording for "the old one broke".
  - `brand` (tiebreak only) covers 12 brands.
- **Ask flow:** only `household`, `pay` and the amount question are always asked. Every other need slot is asked only when its gain is high enough. The Layer 1 session test reaches a result in 4-5 questions. Those questions are household, pay, amount, and one or two of space, layout, down, provider or the brand tiebreak.
- **Settings that differ from mobile:**
  - `maxMonths` is 36, because appliances are financed for longer and `nile-sahla` offers 36 months.
  - The `derive` reference plans add a 36-month finance plan.
  - The `runningCost` is `{type: "attr", attr: "energy_kwh_year", factor: 1.8}`, so TCO adds kWh × 1.8 EGP × `tcoYears` (5).
  - `resale` is null, because fridges are kept 10+ years.
  - `installCost` is 0, because a fridge needs delivery only.

## Data and edge cases (all in `manifest.json`)

- **Missing spec:** `fridge-zanussi-zrt-300` has no `noise_db`.
- **All offers stale:** `fridge-fresh-fnt-260`, which is never ranked.
- **Out of stock:** `o-fridge-sharp-sj-ge45-lotus`.
- **Stale offer:** `o-fridge-toshiba-gr-ef46-pharos`.
- **Stale extras:** `o-fridge-lg-gc-b257-oasis`.
- **Imports:**
  - Every khan offer is `official: false`. Khan carries Samsung, LG and Bosch only.
  - The import is priced 8% below the shop's adjusted price.
  - `fridge-bosch-kad93` is import-only: it is sold only by khan and only in Greater Cairo.
- **Heavy-item delivery:** fees run 0-350 EGP and 1-7 days by shop and zone. The zone gaps are the same as mobile: delta does not deliver to Alexandria, khan delivers to Greater Cairo only, and sphinx does not deliver to other governorates.
- **Plans:** each offer lists all its retailer's shared plans in `plan_ids`, except plans with a `product_override`. So the plan edge cases apply here too: promo ending soon, expired promo, stale plan, and minimum-down plans.
- **Gifts:**

  | Shop | Gift | Value |
  |---|---|---|
  | lotus | 5% card-only cashback | 5% of price |
  | pharos | voltage stabiliser, when ref < 40k | 600 EGP |
  | oasis | extra year of warranty, when ref ≥ 50k | 1,500 EGP |
  | sphinx | stand and water filter jug, when ref is 20k-60k | 450 EGP |

## Assumptions to review (every number is one)

1. **Capacity by household:** none for 1-2 people, 330 L for 3-4, 430 L for 5-6, 520 L for 7+. These are **must** filters, not prefer. A fridge too small for the household is treated as a real fit failure, so a big family on a small budget gets "nothing fits" plus the extra money needed. This could be softened to a prefer.
2. **Electricity price:** 1.8 EGP/kWh, a blended household tariff. Real Egyptian tariffs are tiered by monthly consumption, so the real cost depends on the whole home's use. TCO uses 5 years even though fridges last longer.
3. **Base weights:**

   | Attribute | Weight |
   |---|---|
   | cooling | 1 |
   | capacity_l | 0.8 |
   | energy_kwh_year | 0.8 |
   | service | 0.8 |
   | build | 0.6 |
   | no_frost | 0.6 |
   | warranty_months | 0.4 |
   | inverter | 0.4 |
   | noise_db | 0.3 |
   | dispenser | 0 |
   | width_cm | 0 |

   Every answer effect is a guess. For example, `power: bills` adds 1.5 to energy and 0.8 to inverter.
4. **Score bases:**
   - Warranty runs to 120 months, because some brands give long compressor warranties. As a result, LG's synthetic 120 months scores well.
   - Noise is 32-46 dB.
   - Width is 50-95 cm.
5. **Widths:** side-by-side and French-door models are set at about 91 cm, and top-freezer models at 55-80 cm. The `wide_layout_narrow_space` check fires when someone wants a side-by-side or French door but the space is 80 cm or less.
6. **Check thresholds:**
   - `big_family_low_budget`: 5+ people with a max price under 25k
   - `wide_layout_low_budget`: under 55k
   - `dispenser_low_budget`: under 30k
7. **White Friday saving:** 8-15% for large appliances, an assumption.
8. **`who_for`** is mapped to `household`, because a fridge serves a household, not one person.
9. **Product specs, prices and scores are invented.** The brand and model-style names are not presented as real.

## Unverified / open issues

- **No live LLM run:** the Layer 1 extractor was not run on `eval/phrases-fridge.jsonl`. The phrases are checked only for structure: slot and option ids exist, factor tags are backed by slots, and category detection by rules works on at least 36 of 40.
- **`eval/coverage.js` reads only `eval/phrases.jsonl`:** it does not know about per-category phrase files. My test does an equivalent check for the fridge file.
- **Fridge brand names in Arabic are not mapped by the normaliser.** `u3-normalize.js` has an Arabic-to-Latin brand map for phones only, so "شارب", "توشيبا", "كريازي" and the like may not resolve when the LLM returns Arabic.
- **Units Layer 1 does not parse:** capacity in feet ("14 قدم") and in litres has no slot. It is common Egyptian wording, and the closest home is `household` or `pain: small`. Phrase f009 leaves it out.
- **Things the catalog does not hold:** freezer size, height and depth, colour or finish, and fees for carrying a fridge up stairs to a floor with no lift. These are `not_yet` or partial factors.
- **`detectByRules` with "انفرتر":** "انفرتر" is a weak AC keyword. A phrase like "تلاجة انفرتر" still resolves to fridge because "تلاجة" is a strong keyword. A text with only "inverter" and "freezer" would be ambiguous.

## Core changes suggested (not made)

1. `eval/coverage.js` and `test/eval-phrases.test.js` should load `eval/phrases-<category>.jsonl` files and validate them against `config/<category>.json`.
2. `u3-normalize.js` should take the Arabic brand spellings from each config's `brand` slot option labels (the `ar` label) instead of a phone-only list.
3. **Optional:** let `runningCost` carry a tariff table (tiers) instead of one EGP/kWh factor.
4. **Optional:** a per-category `tcoYears` exists already. If the product owner agrees, consider 8-10 years for fridges.
