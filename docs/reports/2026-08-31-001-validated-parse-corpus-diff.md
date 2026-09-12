# The validator loop's corpus diff — first attempt vs validated final (plan U7's verification)

**Date:** 2026-08-31 · **Corpus:** the full 1919 cookbook (2,490 clause lines) · **Runner:**
`packages/tools/cookbook-import/scripts/validatorCorpusDiff.ts` · **Models:** Nova 2 Lite (parse + retry +
measurement judge), Nova Micro (foodness judge) · **Spend:** $6.47 (full diff) + $1.12 (two 72-line
attribution probes) — ADR-0024 §4a's operator path.

This is the report the U7 commit promised ("its report lands with the next commit"), and it is the check
the runner's own docstring says any future change to the loop owes — ADR-0026's lesson that a unit suite
cannot verify this class of change held again, twice, below.

## 1. Census (as shipped by U7, before the amendment this report motivated)

| kind            | count | share | meaning                                                            |
| --------------- | ----: | ----: | ------------------------------------------------------------------ |
| unchanged       | 2,133 | 85.7% | first attempt validated; `llmAttempts: 1`                          |
| retried-changed |    98 |  3.9% | a validator objected, a retry changed the answer, the loop passed  |
| food-loss       |    44 |  1.8% | final foods empty without `not_a_food` (see §3)                    |
| not-a-food      |   192 |  7.7% | exhaustion's terminal refusal (see §4 — **the defect lived here**) |
| unavailable     |    23 |  0.9% | transient (throttle/outage); absence, correctly not exhaustion     |

Attempts histogram: 1 × 2,133 · 2 × 121 · 3 × 15 · 4 (exhaustion) × 198.

## 2. `retried-changed` (98) — the loop earning its keep

Sampled throughout: the retry's changes are the intended ones. `'onion'` → `'chopped onion'` is KTD-11b's
identity discipline arriving via the not-a-food nudge; `['skins','onion','onion']` → `['onion']` removes a
hallucinated food and a duplicate; `['carcass','cold']` → `['carcass']` drops a truncation artifact;
`[] → ['butter']` on `'1 Heat a spoon of butter in a spider'` RECOVERS a food the first attempt missed.
No sampled retry replaced a correct answer with a worse one.

## 3. `food-loss` (44) — almost entirely the loop working

All 44 were reviewed by hand. The overwhelming pattern is a first attempt that hallucinated a "food" out
of instruction residue (`'colander'`, `'preserving kettle'`, `'cloth'`, `'pudding-mold'`, `'foolscap
paper'`, `'slice'`, `'mixture'`, `'them'`, `'above'`) which the foodness judge refused and a retry
correctly emptied — exactly the U6/U7 target class. A handful are real food words on instruction-shaped
lines (`'beans'` in "Half an hour before beans are to be served") whose removal is correct for an
ingredient parse. ONE case is structural and already has a name: `'a wine glass sherry'` lost real sherry
because the vessel rode inside the food name — ADR-0026 §7a's vessel-as-unit segmentation gap, not a
validator defect.

## 4. `not-a-food` (192) — a real defect, found only by this diff

72 of the 192 refused lines are measure-leading, ingredient-shaped lines — and they included
`'one-fourth teaspoon of salt'`, `'two teaspoons of sugar'`, `'three cups of cranberries'`,
`'one cup of white wine'`. Foods no validator could plausibly refuse were landing `foods: []`.

An instrumented re-run of those 72 lines attributed each round's objection:

| driver of the exhaustion      | lines | example                               |
| ----------------------------- | ----: | ------------------------------------- |
| measurement judge ONLY        |    38 | `'two teaspoons of sugar'`            |
| foodness judge only           |    24 | `'four quarts cold water'`            |
| both                          |     7 | `'two tablespoons of this mixture …'` |
| neither (run-to-run variance) |     3 |                                       |

The measurement judge answered `disagree` in 164 of 275 judgments on this population (60%) — on lines
whose parses were plainly right. **U7's exhaustion collapsed every failure kind into one terminal state
(`foods: []` + `not_a_food`), so a false measurement DISAGREE became a food deletion** — the direction
U11 explicitly ranks unacceptable ("a wrong DISAGREE is the unacceptable direction").

### The amendment (shipped with this report)

`validatedEngine.ts`'s exhaustion now decides by WHICH validator was still objecting:

- **measurement-only** → the attempt survives WHOLE (foods and parsed measure kept), flagged with the new
  `measurement_unverified` review reason — a suspicion for a human, deliberately NOT value-corrupting
  (membership in `corruptsStatedValue` would make `cookbook-import` discard every line the judge wrongly
  disputes — the same false-DISAGREE-becomes-loss conversion, one layer up);
- **some foods disputed** → the PASSED foods survive, disputed ones drop, `not_a_food` records the drop;
- **every food disputed** → `foods: []` + `not_a_food`, exactly as before (R6's equipment/heading case).

`recipe-workers`' `landingOf` moved with it: `unparseable` now requires `not_a_food` AND empty foods, so
a mixed-exhaustion line with kept foods lands `parsed`.

Re-measured over the same 72 lines on the amended engine: **48 now keep their foods** (45 flagged for
review, 3 clean) and 24 remain refused — every one of them the foodness judge's known residual, below.

## 5. Residuals (recorded, not hidden)

1. **The foodness `<state> water/fat` false-negative class is real at corpus scale.** The 24 still-refused
   lines are `cold/hot/boiling/ice-water`, `drippings`, `hot fat`, plus `mace`, `pie plant` (rhubarb),
   `kitchen bouquet`, `meal`, and context-dependent nouns (`liquid`, `mixture`). The prompt is the pinned
   measured champion (owner ruling: changing a byte is a new experiment), so these are accepted for now —
   and the failure mode is bounded: the line is SAVED with `foods: []` under a review reason, surfaced to
   a human, never silently dropped.
2. **The measurement judge disagrees far too often on this leg** (60% on the probed population, against a
   gate-side bake-off that measured nothing like it). The amendment converts that from deletions into
   review flags; WHY the same machinery is this disagree-prone when judging the parse's own attempt
   (candidate name = the attempt's first food, vs the gate's catalog candidate) is a U15 question — if the
   flag rate stays this high on re-import, the judge's prompt framing for this leg needs its own
   experiment.
3. `'a wine glass sherry'` — vessel-in-name (ADR-0026 §7a's segmentation layer, already on record).
4. Run-to-run variance at temperature 0 flipped 5 of 72 outcomes across probes; per-line verdicts near the
   threshold are not stable facts.
