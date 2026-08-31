# U15 — Re-import and measure: the funnel's first real numbers

- **Date:** 2026-08-31 (plan `docs/plans/2026-08-30-001-feat-resolution-funnel-earned-autonomy-plan.md`, unit U15; closes Q2's evidence gap)
- **Corpus:** _The International Jewish Cook Book_ (1919, Project Gutenberg #12350, operator-downloaded per ADR-0023)
- **Stack:** the current branch head (recipe contract `c37215e3`, all migrations through recipe `0040` / food `0015`), booted locally against a seeded SR Legacy catalog of 7,793 RESOLVED foods
- **Verification:** the REAL gate (`processVerification`, Nova Micro via Bedrock) drained over the run's own queue

## Headline numbers

| Measure                                          | Before (2026-08-28 vintage) |                                                            After (2026-08-31) |
| ------------------------------------------------ | --------------------------: | ----------------------------------------------------------------------------: |
| Recipes imported                                 |                       1,170 |                                                   150 (of 154 candidates) [1] |
| Ingredient lines                                 |                       6,102 |                                                                           749 |
| Food-backed lines                                |                   85 (1.4%) |                                                            **749 (100%)** [2] |
| — resolved against the catalog                   |                           — |                                                                   707 (94.4%) |
| — pending async by-name resolution               |                           — |                                                                            23 |
| — freeform fallback                              |                       6,017 |                                                                         **0** |
| Resolution kinds                                 |                           — |                             local 633 · catalog 103 · by-name 13 · freeform 0 |
| Gate verdicts (identity+quantity, per judgement) |                           — | **verified 281 (50.2%) · contradicted 219 (39.1%) · inconclusive 60 (10.7%)** |
| Memos written (R21 tier-3 knowledge base)        |                           0 |                                                                       **289** |
| Parse spend (dual-engine, 731 lines)             |                           — |                                                                         $1.48 |
| Verification spend (720 calls, estimated) [3]    |                           — |                                                                        ~$0.02 |

- [1] The vintages are NOT the same recipe population: the current importer's stricter candidate gates
  (`no_body` 105, `too_few_ingredients` 349, `no_stated_duration` 97, `too_few_steps` 2) reduce 1,499
  headings to 154 candidates, where the 08-28 stack admitted 1,170 recipes. The line-level comparison below
  is therefore computed on the **intersection**: all 730 committed after-lines matched a before-line on
  `(title, sort_order)`.
- [2] "Food-backed" = the line references an ingredient entity carrying a `food_id` (RESOLVED or PENDING),
  `is_user_entered = false`. The honest bind number is the RESOLVED 94.4%.
- [3] `verification_spend` is empty by design off-prod (ADR-0024's ceiling and ledger are prod-only);
  the estimate is 720 calls × ~660 input + ~50 output tokens at Nova Micro's rate-table prices.

### The intersection diff (730 joined lines)

**Gained a bind: 725. Lost a bind: 0. Rebound to a different food: 1. Already bound: 4.**

## What the run actually measured — and the three runs it took to get an honest one

Three earlier attempts produced corrupted or no data, and each failure was a real defect worth the detour:

1. **The service throttled the measurement.** `/api/v1/ingredients/suggest` is a search-category route
   (`RATE_LIMIT_SEARCH`, default 60/min per user); the importer is one user. Nearly every suggest call
   answered 429, lines collapsed to freeform, and the early sample read 2/55 bound with zero resolution
   events. ⚠️ This also indicts the BEFORE number: the 08-28 import ran the same one-user shape against
   default limits, so **1.4% is "what the shipped stack produced", not a controlled parse-quality
   baseline** — part of the before/after swing is the repaired measurement harness, not the funnel.
2. **An unbounded Bedrock socket hung the parse pass for 49 minutes.** The SDK ships no request timeout,
   `maxAttempts` is pinned to 1, and one silently-dropped HTTPS flow parked the run on `epoll_wait`
   forever. Fixed at the source (`fix(bedrock)`, commit `eaa33487`): `createBedrockTransport` now defaults
   to a 60s per-request deadline that can be lengthened but not disabled — the production Lambdas carried
   the same latent hang, bounded only by their function timeout, with the refund-full
   `BedrockTimeoutError` settle path unable to ever fire.
3. **The linkage token expired mid-run** (1h TTL). Re-minted at 12h with the `recipes:import:public`
   grant; both services rebooted on the new key.

The measured run used a **clean recipe database** (the 08-28 corpus rows would otherwise satisfy suggest
as stale local rows and mask the funnel entirely; the before-state is preserved in the U15 scratch
captures), all five throttle knobs raised, and the bounded Bedrock transport.

## Finding 1 — the verdict store never worked, and a green unit suite hid it

The first drain lost its first twelve billed verdicts: `recordVerdict` interpolated its `aspects` array
directly into drizzle's `sql` template, which expands a bare array into a parameter **list** —
`($5, $6)`, a record — while the column is `text[]`. Every real INSERT ever attempted by this store had
failed; the handler meters and swallows verdict-write failures by design ("nothing after the money is
spent may fail the handler"), and the unit suite's fake store proved only that the method was called.
Fixed with the integration tier the store was owed (`fix(workers)`, commit `c1ef96b6`;
`verdictStore.integration.test.ts` pins multi/single-element arrays, the upsert, and the memo write
against real PostgreSQL). **Consequence for this dataset:** 12 of 732 judgements were consumed unverified;
they are exactly the shape the redrive sweep exists to re-drive.

## Finding 2 — first-mover capture: one early bind hijacks every later phrase sharing a token

The dominant resolution kind is `local_suggestion` (633 of 749), and it is frequently wrong in a
systematic way. The picker's blend ranks local ingredient rows above catalog rows, and local matching is
token-based — so the first line to bind a food creates a local entity whose tokens then outrank the exact
catalog match for every subsequent phrase sharing a token:

- `a pinch of salt` → **Lentils, mature seeds, cooked, boiled, without salt** — the "Lentils … without
  **salt**" entity captured 18 distinct phrases across 48 lines, including every plain `salt` line
- `one-half pint of milk` → **Beverages, almond milk, unsweetened, shelf stable** (20 phrases / 26 lines)
- `one cup of white wine` → **Rice, white, long-grain, regular, enriched, cooked** (token `white`)
- `two pounds of soup meat` → **Chicken, broiler or fryers, breast, skinless, boneless…**

115 distinct ingredient entities serve 730 lines; the top eight entities absorb ~40% of all lines. This is
a product-ranking defect in the suggest blend (local-over-catalog + token overlap), not an import
artifact — the app's own picker exhibits the same ordering. It is also precisely the error class the
verification gate exists to catch, and it did:

## Finding 3 — the gate works: 39% of auto-binds contradicted, at ~$0.00003 per judgement

Of 560 distinct judgements (identity+quantity, `high|medium|low` certainty):

| Verdict  | Band         | Count | Share |
| -------- | ------------ | ----: | ----: |
| agree    | verified     |   281 | 50.2% |
| disagree | contradicted |   219 | 39.1% |
| abstain  | inconclusive |    60 | 10.7% |

The contradicted set includes every capture-effect howler sampled by hand. ⚠️ One caution when reading the
39%: the verdict is joint over `{identity, quantity}`, so a correct identity with an unparseable quantity
("a small piece of butter" → Butter, salted) can also land `disagree` — the contradicted rate is an upper
bound on identity error. The 23 PENDING by-name lines behaved correctly too: `ammonia`, `Babbitt's lye`
(the corpus has soap recipes), `quantity`, `picked` await the food service's foodness judgement rather
than polluting the catalog.

## Finding 4 — the knowledge base's first population, and a grain problem

- **289 memos** now exist (R21, cascade tier 3) — the first rows ever written to
  `ingredient_resolution_memos`. But the memo key is the **whole normalized line**, measure included:
  `one quart of cold water` will never serve `two quarts of cold water`. At this grain the memo tier's
  hit rate across recipes will stay near zero; the match grain should be the ingredient phrase, not the
  line. Worth an owner decision before U16-era tuning.
- **0 band rows** — not a bug: band observations require RANKED evidence, which only the `addByName`
  cascade emits, and this corpus reached `addByName` 13 times (all misses against an empty knowledge
  base, correctly recorded as nothing). The band machinery has no substrate until the cascade path
  carries real traffic; a warm-pass import (memos populated, ingredients reset) or picker traffic is the
  first realistic source.
- **0 resolution events** for the same reason: the shipped event write sits inside the cascade's
  resolved path only. If the funnel is to observe suggest-path binds — which this run shows are both the
  common case and the error-prone one — the event write needs to move up, or the suggest path needs its
  own provenance event. This is the report's strongest calibration input.

## Parse observations (dual-engine, 731 lines)

- agree 96 · differ 631 · single-engine 4 · neither 0; corrected 0; cache hits 0; spend $1.48.
- Disagreements are dominated by `statedMeasure` fields — consistent with ADR-0026's known composite-
  quantity asymmetries, and the reason the merge's winner rules exist.
- 60 source clauses dropped as measureless residue (correct refusals: "rub to a smooth paste",
  "Let stand a few days before using").
- 3 historical-unit conversions engaged (gill, saltspoon, wineglass) over 7 lines.
- 4 recipe creations failed, one on a >120-char ingredient name from a mis-segmented line — a real
  segmentation residual, not a validation bug.

## Calibration proposals (from the data, for owner ruling)

1. **Fix the blend's local-over-catalog capture** before any threshold tuning: no bar/min-n setting can
   rescue a funnel fed 39% contradicted binds by ranking. Candidate shapes: rank catalog exact-token
   matches above local partial-token matches, or require the local row's full name (not one token) to
   match the query.
2. **Move bind provenance recording to the suggest path** so `ingredient_resolutions` observes the
   population that actually exists (finding 4). Bands stay unmeasurable until then.
3. **Re-grain the memo key** from line to ingredient phrase (finding 4).
4. **Feed contradicted verdicts back**: 219 contradictions currently change nothing user-visible. The
   cheapest loop is surfacing them into the ambiguity-review surface (U13) or auto-unbinding
   high-certainty contradictions; either needs an owner ruling on the wrong-DISAGREE direction first.
5. **Verification pricing is a non-issue**: ~$0.02 for 720 judgements. The binding constraint is the
   $100/month pool shared with the parse leg ($1.48/book), not the gate.

## Caveats and residuals

- One book, one cuisine, 1919 prose; every rate above is a single-corpus estimate.
- The vintages differ in candidate gates AND harness health (throttling), so the 1.4%→94.4% swing
  overstates what the funnel alone did; the defensible claim is "the current stack, measured honestly,
  binds 94.4% of lines with ~50% verified / ~39% contradicted".
- 12 verdicts were consumed unverified by the pre-fix drain (redrive-eligible).
- The drain ran the real gate code through an operator driver (RDS-IAM and SSM don't exist locally);
  stage `local` bypasses the prod-only ceiling by design.
- The 3-entry staple precision seed-set from the BEFORE capture (2/3; the flour miss was a
  proposed-label artifact) is superseded by the verdict distribution here, which judges the full
  population.
