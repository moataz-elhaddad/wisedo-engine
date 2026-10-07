# Laptop category: build notes

Second category of the Wisedo engine, built from the mobile template. No engine code changed: the laptop is a
config, a synthetic dataset and tests. **All data is synthetic** (every row `source: "synthetic"`); model-style
names are used so buyers can name a model, but every spec, score and price is invented.

## Files

| File | What |
|---|---|
| `config/laptop.json` | Category config: id `laptop`, alias `notebook`, version 1.0.0, 15 attributes, 23 slots, 4 checks, resale rule, 42 buying factors |
| `data/generate-laptop.js` | Seeded generator (seed 20261004, mulberry32). Writes `data/synthetic/laptop/{products,offers,manifest}.json` |
| `data/synthetic/laptop/` | 35 laptops (8 brands), 141 offers. Retailers and plans are the shared files in `data/synthetic/` |
| `test/laptop.test.js` | 25 tests: contracts, determinism, edge cases, 12 personas, simulate/rank agreement, imports, resale, Layer 1 sessions, eval phrases |
| `eval/phrases-laptop.jsonl` | 40 synthetic buyer phrases (ar 23, en 13, mixed 4), ids `lp001`-`lp040`, same line format as `eval/phrases.jsonl` with `category: "laptop"` and laptop slots |

Run: `node data/generate-laptop.js`, `node --test test/laptop.test.js` (25/25 pass), `node --test test/`
(215/215 at the time of writing, including other categories' files in progress).

## The config

**Scored attributes** (fixed basis, so a score means the same thing in every session): `cpu` 1-10, `gpu` 1-10,
`ram_gb` 4-32, `storage_gb` 128-1024, `screen` (quality) 1-10, `battery_hours` 4-20, `weight_kg` 1.0-2.6 (lower is
better), `build` 1-10, `service` 1-10, `warranty_months` 12-36, `keyboard` 1-10.
**Filter-only:** `os` (windows, macos, chromeos), `series` (entry, mid, flagship), and two attributes typed as
scored but with base weight 0 so they act only through filters: `screen_inches` (11-18) and `has_dedicated_gpu`
(boolean, like mobile's `has_5g`).

**Base weights:** cpu 1, ram 0.6, screen 0.6, battery 0.6, service 0.6, storage 0.4, build 0.4, gpu 0.3,
weight 0.3, keyboard 0.3, warranty 0.2.

**Slots (23).** Need: `who` (me, kid, parent), `use` (study, office, programming, gaming, design, video, basic;
multi), `gameLevel` (heavy = must have a dedicated GPU), `pain` (slow, battery, heavy, broke, screen),
`portability` (daily, sometimes, desk; default sometimes, which adds nothing), `screenSize` (small <= 14.5 in,
medium 15-16.2 in, large >= 16 in), `storageNeed` (512 GB, 1 TB), `compat` (manual: iPhone owner prefers macOS,
Windows-only programs must be Windows), `keep` (short sets resale, long adds durability weights), `os` (asked only
when `derived.maxPrice >= 45000`, where MacBooks enter the catalog). Money and logistics follow mobile exactly
(`pay`, `provider`, `budget`, `monthlyCap`, `down`, `urgentDays`, `acceptImports`, `city`, `cod`, `shops`), with
presets rescaled: budget 15k/20k/30k/40k/55k/75k/120k ("over 75,000"), monthly 1,000/1,500/2,500/4,000/6,000,
down 0/5k/10k/20k. Preferences: `brand` (tie-break only, +5), `brandAvoid`, `modelInMind`.
Dropped versus mobile: `intensity` (gameLevel and use carry the load for laptops), `photoType`, `parentUse`.

**Checks** (non-blocking notes): heavy gaming under 35,000; video editing under 25,000; Mac only under 45,000;
heavy gaming plus daily carrying.
**runningCost** none. **installCost** 0. **resale** (only when `keep = short`, after 2 years): Apple 0.55,
any flagship 0.35, everything else 0.25. **season**: White Friday copied from mobile. **maxMonths** 24.

**Factors (42).** Mobile's phone-specific ones were rewritten for laptops. New: `portability`, `storage_ram`,
`screen_quality`, `keyboard_typing`, `build_quality`, `upgradeability` (not yet), `software_cost`
(Windows/Office licence, not yet), `arabic_keyboard` (imports often ship English-only keyboards, not yet).
Dropped as irrelevant: AC/TV ones (`install_wait`, `install_quality`, `environment`), `branch_pickup`,
`time_limited_offer` (folded into `timing_sales` via `valid_until`), `software_updates`. The five eval "Not used"
topic factors (`look_colour`, `trade_in`, `fakes_used`, `timing_launch_currency`, `family_opinion`) keep their ids so
the Layer 1 unmapped reasons still work.

## Data

35 products: 11 entry (12,500-24,500), 13 mid (33,000-49,000), 11 premium (55,000-118,000); brands Lenovo, HP,
Dell, Asus, Acer, Apple, MSI, Huawei; 4 popular models (IdeaPad 1, IdeaPad Slim 3, Victus 15, MacBook Air M2); 3 macOS, 1 ChromeOS, 10 with a
dedicated GPU. Each product has 3-5 offers from the existing seven retailers; offers carry no `plan_ids`, so the
shared retailer plans apply. Gifts: lotus 5% card cashback, pharos bag and mouse (< 30k), sphinx headset (25-60k),
oasis extra warranty year (>= 50k).

**Edge cases** (listed in the manifest): missing `battery_hours` on the Dell Inspiron 3520; stale specs (75 days)
on the Lenovo V15 G4 (excluded by `specsDays` 60, new versus mobile); every offer stale for the HP 250 G10; one
out-of-stock, one stale-price and one stale-gifts offer; khan grey imports for Apple, Dell and HP only (the
MacBook Air M2 import is forced in stock so the import test is stable); the shared plan edge cases (promo ending
2026-10-12, expired promo, stale plan, down-payment plans, a Samsung-only plan that never applies to laptops).

## Assumptions to review (every number is one)

- All attribute scores (cpu, gpu, screen, build, keyboard, service) are editorial guesses, not benchmarks.
- Bases: RAM 4-32 GB, storage 128-1024 GB (2 TB scores the same as 1 TB), battery 4-20 h, weight 1.0-2.6 kg,
  warranty 12-36 months. Products outside a basis are clamped.
- Weights and every option effect (for example gaming +2 gpu, video +1.2 cpu, daily carrying +1.5 lightness).
- Hard filters chosen: video editing requires 16 GB RAM (must); heavy gaming requires a dedicated GPU (must);
  programming only prefers 16 GB (relaxable); daily carrying only prefers <= 1.7 kg.
- Screen size bands (<= 14.5, 15-16.2, >= 16) and the 45,000 threshold for asking Windows-or-Mac.
- Service scores by brand in Egypt (Lenovo/HP/Dell 8, Asus 7, Apple/Acer/Huawei 6-7, MSI 5).
- Resale shares (Apple 0.55, flagship 0.35, other 0.25) and the grey-import discount (Apple 12%, others 7%).
- maxMonths kept at 24 like mobile, although some shared plans offer 36 months.
- Check thresholds (35,000 for real gaming GPUs, 25,000 for video) match this synthetic catalog only.

## Layer 1 behaviour observed (unverified against real buyers)

- From text that states use and money, the session asks `who` plus 2-4 gain questions (test: programmer, <= 6).
- From the tile, with every non-scripted question skipped, it asks 5-8 questions
  (student 5, parent 5, office 7, programmer 8 = cap, heavy gamer 7). Mobile behaves the same way in the same
  check (7-8). The four "always" questions (who, use, pay, budget) are already four; `urgentDays` is added because
  White Friday is about 8 weeks after `DATA_NOW`; `screenSize` and `pain` are asked by gain.
  The brief's target of 3-4 questions holds only for text starts.
- Category detection already knew laptops (u1-category.js keywords include laptop, notebook, macbook, ...).

## Open issues and core changes suggested (not made)

1. **`eval/coverage.js` treats every non-mobile phrase as detection-only** and loads only `config/mobile.json`, so
   it cannot check `phrases-laptop.jsonl`. The laptop test re-implements the same rules. Suggested change: let
   `checkPhraseSet` take a category, and load `eval/phrases-<cat>.jsonl` with `config/<cat>.json`.
2. **Retailer zones and price adjustments live only inside `data/generate.js`** (not exported), so
   `generate-laptop.js` mirrors them. Suggested: export `RETAILERS` (or put zones in `retailers.json`).
3. **Shared plans and `pharos-horus-samsung`'s `product_override`** are written by the mobile generator. A laptop
   promo plan would need a plan row there; none was added (shared files are off limits for this build).
4. **Season**: only `last_friday_of_november` exists; a back-to-school season (August/September) matters for
   laptops in Egypt and would need a new rule type.
5. **Question count from the tile** (see above) is above the 3-4 target for both categories; the planner policy
   (urgentDays as a situational always-if) is the lever, not the config.
6. `screen_inches` and `has_dedicated_gpu` are declared as `number`/`boolean` attributes (with a basis and an
   explain text) and weight 0, the same trick mobile uses for `has_5g`. A `filterOnly` attribute flag would be clearer.
