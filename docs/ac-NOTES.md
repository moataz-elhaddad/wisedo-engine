# Air-conditioner category (`ac`): build notes

Split air conditioners for the Egyptian market, built on the category-agnostic engine. Core code (`src/`), the shared data (`data/synthetic/{products,offers,plans,retailers,manifest}.json`), `config/mobile.json` and `test/helpers.js` were not changed. **All data is synthetic** (every row `source: "synthetic"`); brand and model-style names are used, but every spec, kWh figure and price is invented.

## Files

| Path | What |
|---|---|
| `config/ac.json` | Category config: id `ac`, aliases `air_conditioner`, `aircon`, version 1.0.0, 13 attributes, 22 slots, 7 checks, 42 buying factors |
| `data/generate-ac.js` | Seeded generator (mulberry32, seed 20261104, `DATA_NOW`/`TENANT` from `data/generate.js`) |
| `data/synthetic/ac/` | `products.json` (33 ACs, 9 brands), `offers.json` (128 offers), `manifest.json` (counts, edge cases) |
| `test/ac.test.js` | 21 tests: config, snapshot, determinism, 11 scripted buyers, installation, imports, simulate vs rank, two Layer 1 sessions, the eval file |
| `eval/phrases-ac.jsonl` | 40 synthetic buyer phrases (29 Arabic, 7 English, 4 mixed incl. Arabizi), same format as `eval/phrases.jsonl`, ids `ac001`..`ac040` |

Run: `node data/generate-ac.js` (byte-identical output), `node --test test/ac.test.js` (21/21 pass), `node --test test/` (236/236 pass on the last run, which includes the other workers' files present at that time).

## How the category works

**Capacity (the key AC need).** One always-asked question, `room`, takes the room area and its heat together: 10 options, five area bands, each with or without heat (strong sun, top floor or kitchen). Each answer:
- writes `derived.requiredHp`, used by the checks;
- adds a **must** `cooling_hp >= required` (the capacity filter);
- for the smaller bands, adds a **prefer** `cooling_hp <= one size up`, so a big budget does not buy a 5 hp unit for a 14 m2 bedroom. Oversized units short-cycle and waste power. The prefer is relaxable.

| Area band | Normal | Hot (sun / top floor / kitchen) |
|---|---|---|
| up to 16 m2 (`r16`) | 1.5 hp | 2.25 hp |
| 17-24 m2 (`r24`) | 2.25 hp | 3 hp |
| 25-32 m2 (`r32`) | 3 hp | 4 hp |
| 33-42 m2 (`r42`) | 4 hp | 5 hp |
| 43-55 m2 (`r55`) | 5 hp | 5 hp + "consider two units" check (`requiredHp` 6) |

Area and heat share one question because the engine cannot yet turn two answers into one filter value (see "Core changes proposed", item 1).

**Running cost.** `runningCost: {type: "attr", attr: "kwh_year", factor: 2.1}`, so yearly electricity = kWh per year x 2.1 EGP/kWh x 1 unit. TCO = effective cost + 5 x yearly electricity. This makes TCO relevant for every pick. `kwh_year` is also a scored attribute (lower is better, basis 600-4500), with weight raised by `bill: big`, `usage: allday` and `pain: bill`.

**Installation.** `installCost: 700` is added to every quote unless the offer has an `install` extra (free installation). Pharos and Oasis always include installation, Nile does from a reference price of 25,000, and the other shops charge it. Imports from Khan never include it. Free installation is never counted a second time as a gift (m4-offers behaviour). The `install` slot (`shop` / `own`) is manual. `own` only raises the `own_installer` check, because the engine has no per-buyer install cost.

**Delivery.** Heavy-item delivery fees of 0 to 350 EGP by zone. `delivery.days` counts until the unit is **delivered and installed**. The `urgentDays` options are therefore "within two days" (2), "within a week" (7) and "no rush".

**Ask flow.** Always asked: `room`, `pay`, then `budget` or `monthlyCap`. Asked only by gain: `roomType` (bedroom raises the noise weight), `usage`, `bill`, `heatNeed` (cool+heat is a must on `heating`), `pain` (including weak voltage, a prefer on `low_voltage`), plus the money and logistics extras as in mobile. Never asked (text or "Add a detail" only): `inverterNeed`, `smart`, `install`, `cod`, `shops`, `brandAvoid`, `modelInMind`. `brand` is the near-tie question.

Measured flows from the AC tile:
- `room, pay, budget, heatNeed, brand` (5)
- `room, pay, budget, urgentDays, heatNeed` (5)
- `room, pay, monthlyCap, urgentDays, down, heatNeed` (6)
- `room, pay, monthlyCap, down, provider` (5)

The test asserts 6 questions or fewer. `urgentDays` is asked because White Friday is 8 weeks after `DATA_NOW`, the same rule as for mobiles. From text with room, pay and budget already given, at most 3 questions follow.

**Checks** (warnings `check:<id>`):
- `big_room_low_budget`: requiredHp >= 3 and maxPrice < 28,000.
- `very_big_room_two_units`: requiredHp > 5.
- `kitchen_size_up`: roomType is kitchen, but the room answer was not a hot one.
- `hot_city_t3`: Minya to Aswan, or the Red Sea. Advises a T3 compressor.
- `heat_low_budget` and `inverter_low_budget`: under 22,000.
- `own_installer`.

## Assumptions to review (every number is one)

- **Sizing table above**, including the "one size up when hot" rule and the 55 m2 ceiling for a single unit. An AC installer should confirm it, including how BTU maps to hp for Egyptian labels (about 9,000 BTU per hp is the common shop rule; it is not used in code).
- **Electricity rate 2.1 EGP/kWh** (flat; the real tariff is tiered by monthly consumption, and AC users often land in the upper tiers). `kwh_year` assumes about 8 h a day for 5 summer months.
  - With these synthetic numbers an inverter recovers only part of its price premium in 5 years, for example Sharp 1.5 hp inverter against standard. The test asserts that TCO narrows the gap, not that it closes it.
  - The rate or the kWh figures may be understating the savings.
- **Base weights:** kWh 1, service 0.9, inverter 0.8, cooling speed 0.8, warranty 0.6, noise 0.4, low voltage 0.3, T3 0.3, Wi-Fi 0.1, heating 0, cooling_hp 0 (capacity is a filter, not a score).
- **Answer effects:**
  - bedroom: noise +1.5;
  - bill big: kWh +1.5 and inverter +1;
  - all-day use: kWh +1;
  - and the rest as written in `config/ac.json`.
- **Bases:** noise 18-52 dB, warranty 12-120 months (compressor), kWh 600-4500.
- **Money presets:**
  - Budget: 18k, 25k, 32k, 40k, 50k, and "over 50k" (65k).
  - Monthly cap: 1k to 5k.
  - Down payment: 0, 3k, 6k, 12k.
  - The budget question says "including delivery and installation", because the core's affordability ratio uses cash out (price + delivery + installation).
- `maxMonths: 24`, same as mobile, although `nile-sahla` offers 36 months. 36 months at 2% a month is over 35% financing cost.
- `resale: null`. Installed ACs are rarely resold.
- `who_for` was dropped as a factor (the room sizes an AC, not the person). It is out of scope in spirit; it is not in the list.

## Synthetic data

- **Products:** 33 products across 5 capacities and 3 tiers (entry, mid, premium), 15,500 to 62,000 EGP. Brands: Carrier, Sharp, Tornado, Unionaire, LG, Samsung, Midea, Fresh, Gree. Three 5 hp units are floor-standing.
- **Offers:** 3 to 5 per product from the 7 shared retailers, with retailer-specific price spreads and heavy-item delivery. Plans are the shared rows in `data/synthetic/plans.json`; they are retailer-wide, so they apply to ACs as they are.
- **Edge cases** (listed in the manifest):
  - missing spec: `ac-gree-pular-15` has no `warranty_months`;
  - all offers stale: `ac-unionaire-artify-3`;
  - out of stock: `o-ac-sharp-inverter-15-lotus`;
  - stale offer: `o-ac-tornado-classic-15-nile`;
  - stale gifts: `o-ac-carrier-optimax-inv-15-sphinx`;
  - grey imports: every Khan offer (LG, Samsung, Gree and Midea only; Greater Cairo only; no free installation);
  - card-only cashback: every Lotus offer;
  - zone gaps inherited from the retailers;
  - free installation at some shops but not others.

## Unverified / open issues

1. **Oasis wins many best-offer slots.** It has free installation, free Cairo delivery and a slightly lower price band. This is a property of the synthetic data, not a rule. Real data will look different.
2. **The live LLM parser was not run on AC text.** The mock-recorded test proves only the flow. "20 متر عليها شمس" must be mapped by the extractor to `r24_hot`. Mapping a stated "3 حصان" to a room band, the convention used in the eval phrases, is a judgement call.
3. **`eval/coverage.js` and `test/eval-phrases.test.js` read only `eval/phrases.jsonl`.** `eval/phrases-ac.jsonl` is checked by `test/ac.test.js` (ids, options, factors), not by the coverage checker.
4. **Shared plan `pharos-horus-samsung` lists Samsung phone ids only.** The Samsung ACs never get that promo, which is fine, but the plan's product list is category-blind.
5. **Season advice.** AC prices and installation waits rise from May to August. `season.monthAdvice` is empty because the core has no month-advice rule yet.

## Core changes proposed (not made)

1. **Capacity derive plus filter-from-path.**
   - Add a derive type, for example `{type: "lookup", inputs: ["room", "heat"], table: ..., target: "derived.requiredHp"}`.
   - Let a filter take its value from a path, for example `{attr: "cooling_hp", op: ">=", valueFrom: "derived.requiredHp"}`, resolved in `buildNeedProfile` after derive.
   - Then area and heat can be two short questions, and a typed area ("22 m2") can be a numeric slot.
   - The same mechanism serves the TV (distance -> screen size) and fridge (family size -> litres) configs.
2. **Per-buyer installation cost.** For example a profile path `logistics.installCost`, or `installCost: {default, byAnswer}`, so "my own technician" can change the quote.
3. **Running cost scaled by usage.** For example `runningCost.multiplierPath: "derived.usageFactor"`, so all-day use costs more than a few evening hours. Today `kwh_year` is a fixed typical-use figure.
4. **Budget meaning for appliances.** The core compares the cash budget with cash out (unit + delivery + installation). The AC question says so explicitly. Confirm that buyers think of an AC budget that way rather than as the unit price alone.
5. `src/layer1/u1-category.js` comments say "today only mobile". With configs in the snapshot, `ac` is detected as configured (the text-start test confirms this); only the comment is stale.
