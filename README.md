# Wisedo engine (five categories: mobile, laptop, TV, AC, fridge)

Deterministic buying-decision engine in two layers, plain JavaScript (ES modules), Node 22, no npm dependencies.
All data is synthetic sample data (every record has `source: "synthetic"`); prices are not real.

## Run
- Tests: `node --test test/` (236 tests, Layer 2 + Layer 1 + parameters + eval-phrase checks)
- Eval phrase coverage: `node eval/coverage.js`
- Regenerate the synthetic dataset: `node data/generate.js`

## Layout
- Specs (BRD, Tech Spec, Technical Design v4) live as Claude Docs and are kept out of this repository while it is public.
- `config/<category>.json` one config per category (mobile, laptop, tv, ac, fridge); data per extra category in `data/synthetic/<category>/` (generators `data/generate-<category>.js`), notes in `docs/<category>-NOTES.md`, phrases in `eval/phrases-<category>.jsonl`. Retailers and installment plans are shared across categories.
- `config/mobile.json` the mobile category config (24 slots, 15 attributes, 40 buying factors tagged)
- `src/layer2/` matching (M1-M9, rank and simulate), entry: `match(needProfile, snapshot, now, mode, options)`
- `src/layer1/` need understanding (U1-U9) and `session.js`, a serialisable state machine
- `src/layer1/llm/mock.js` recorded-response adapter used by tests; `anthropic.js` live adapter, written but NOT yet run against the API
- `data/` synthetic dataset generator and output
- `eval/` 300 synthetic phrases tagged by factor, with a coverage checker
- `docs/` CONTRACTS.md, BUILD-NOTES.md (Layer 2 decisions), LAYER1-NOTES.md (Layer 1 decisions, how to run a live parser check)

- `web/` try-out page and admin panel (`sh web/build.sh <dir>` assembles it); `src/params.js` the tunable parameters; `src/store.js` published/draft/history of a configuration

## Not built yet
The HTTP API, the web UI, ingestion, the B2B Excel mapper.
