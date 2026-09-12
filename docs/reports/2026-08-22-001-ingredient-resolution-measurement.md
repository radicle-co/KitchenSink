# 001 — ingredient resolution, measured

**Plan:** [`docs/plans/2026-08-20-001-fix-ingredient-resolution-quality-plan.md`](../plans/2026-08-20-001-fix-ingredient-resolution-quality-plan.md) (U15)
**Measured:** 2026-08-22, against a real USDA FoodData Central catalog seeded through U12's clear + reseed.
**Engine:** PostgreSQL 16 (local). ⚠️ U13 moves prod to 18, and U1 measured that **99.7% of `name ASC`
tiebreak positions move with collation** — so these figures must be re-measured on the sandbox soak after
the upgrade, and the post-upgrade numbers are the ones that stand.

---

## 1. The catalog these numbers were measured against

The two-service reset ran in the plan's ordered sequence, and the ordering held **mechanically** rather than
by convention: with 360 recipe ingredients still linked, the food-side clear refused and deleted nothing.

|                                             |                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------- |
| Candidates read                             | 8,262 — SR Legacy `2018-04` (7,793) + Foundation `2026-04-30` (469) |
| `food` rows after reseed                    | **8,094**                                                           |
| seeded / refreshed / unchanged / **failed** | 8,094 / 168 / 0 / **0**                                             |
| Foods carrying nutrients                    | 8,094 / 8,094 (**100%**)                                            |
| Foods carrying portions                     | 7,563 / 8,094 (93.4%)                                               |
| `nutrient` dictionary                       | 20 → 261                                                            |
| `foodsWithAliases`                          | **0**                                                               |

⚠️ **`refreshed: 168` on a run that began with an empty catalog is not a re-import.** The two CSVs hold 8,262
descriptions but only 8,094 distinct lower-cased ones; 139 names appear more than once. Each surplus `fdc_id`
gets its own crosswalk row and re-merges onto the existing `food`. Nothing was lost and nothing was
double-created. An operator reading `refreshed` as "the clear did not work" would be wrong.

**Zero aliases is the correct outcome, not a defect.** USDA publishes curated additional descriptions only for
Survey (FNDDS) foods; the shipped roster enables Foundation + SR Legacy, which publish none, and the run
declares `aliasesExpected: false`. Whether to enable FNDDS is an open owner decision.

---

## 2. The headline figures

`headlineFigures` derives these from a run's counters; the resolution measurement below is a separate,
hand-adjudicated probe of the catalog, because the corpus import has not run (see §4).

34 real queries — the 23 ingredient names in the recipe seed plus the 11 non-empty representative typed
inputs — driven through the **real** `FoodSearchDao.search`, not a reimplementation.

|                               | seed (23) | typed (11) | **combined (34)** |
| ----------------------------- | --------- | ---------- | ----------------- |
| Retrieved anything            | 91.3%     | 72.7%      | **85.3%**         |
| Defensible referent at rank 1 | 60.9%     | 54.5%      | **58.8%**         |
| Defensible referent in top 5  | 78.3%     | 63.6%      | **73.5%**         |

Rung of the rank-1 hit: `exact` 1 · `tokenSet` 1 · `head` 22 · `covered` 2 · `base` 3 · no hit 5.

**Adjudicated accuracy: WITHHELD.** One annotator adjudicated these 34, and one annotator is not a
measurement — the same reason `observedAgreementRate` returns `undefined` for the judgement set rather than a
flattering 1.0. The figures above are retrieval and ranking positions, which are objective; "is this the food
the cook meant" is not, and needs a second independent annotator.

---

## 3. What the numbers say — the dominant cause is retrieval, on the catalog side

**22 of 29 rank-1 hits land on the `head` rung.** On this catalog the rung mostly does not discriminate, so
the length-penalised base similarity decides — which is how `Flour` puts `Flour, 00` first and leaves
`Flour, wheat, all-purpose, enriched, bleached` at **rank 26 of 134 matched rows**, off the page entirely.
Every one of the 20 returned rows is `Flour, <something-else>`.

**Four queries retrieve nothing at all**, and each fails before ranking is consulted:

| query                                | cause                                                                                                                                                                                                                            |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `jalapeño`                           | the diacritic. `similarity('Peppers, jalapeno, raw','jalapeño') = 0.250` against the 0.3 `pg_trgm` threshold; **unaccented it is 0.429** and FTS returns 3 rows. `unaccent` is available in the container and **not installed**. |
| `Kerrygold butter`                   | `plainto_tsquery` is a conjunction requiring `kerrygold`, which no row carries; `similarity('Butter, salted', …) = 0.292` — misses the threshold by **0.008**.                                                                   |
| `chikcen`                            | trigram similarity to the chicken rows is 0.067–0.075. A transposition is not recoverable by trigram; the representative corpus's "only fuzzy ranking can rescue this" is measured **false** on this catalog.                    |
| `Arborio rice`, `Mixed salad greens` | genuine catalog gaps — but note 140 rice rows and 43 lettuce rows exist and none were retrieved, because the conjunction excluded them too.                                                                                      |

**`Fresh oregano` retrieves `Basil, fresh` and `Thyme, fresh`.** The catalog's only oregano row is
`Spices, oregano, dried`, and `plainto_tsquery('english','Fresh oregano')` = `fresh & oregano` returns zero
rows; the two hits arrived on the `fresh` substring. This is exactly the `sifted flour` shape
`selectIngredientMatchStrategy` was written to close — measured live.

### ⛔ The finding that matters most

**U6's retrieval widening was scoped to the recipe-LOCAL table, and every miss above is on the CATALOG side.**

U6's plan entry lists two files, both in recipe-service: `selectIngredientMatchStrategy.ts` and
`ingredients.dal.ts`. Its head-term branch is one clause on `IngredientsDal.search`. `foodSearch.dao.ts`'s
retrieval predicate is still `plainto_tsquery OR aliases_tsquery OR name % OR name ILIKE OR description
ILIKE` — no head-term retrieval at all.

So **U6 is complete as specified, and the specification was aimed at the wrong surface.** That is a plan gap
rather than an unfinished unit, and it is the single highest-value lever these numbers identify: the
conjunction defect, the oregano case, the lamb case and two of the four zero-retrieval cases are all
downstream of it.

### A green test asserting behaviour that cannot occur

`representativeUserInput.test.ts` proves `classifyRankTier` puts `jalapeño`/`jalapeno` on `exact` and
`Kerrygold butter`/`butter` on `head`. Those assertions are **correct** — `classifyRankTier` is a pure
function over two term sets. But the catalog's SQL predicate never returns those rows, so the ladder is never
consulted for either phrase. Green test, absent behaviour. Both are retrieval-side.

---

## 4. What this does and does not prove

**Proves.** The two-service reset works end to end against real USDA data with the ordering enforced by a
mechanism. The seeded catalog's shape and coverage. How the catalog ranks a given phrase, at real scale,
through the real SQL.

**Does not prove.** The product's end-to-end resolution rate. The shipping path is
`GET /ingredients/suggest`, which sections local `ingredients` rows first and never interleaves them — so a
phrase already used in a recipe wins before the catalog is consulted. These are the catalog section's
figures, i.e. the **cold-start** case. It does not exercise the curated or memo tiers (both empty here) or
the LLM tier, and it is 34 hand-adjudicated queries, not U15's 448-recipe corpus and not U1's annotation
protocol.

**Still outstanding for U15 proper:** the 448-recipe import has not been run — its corpus is an
operator-downloaded file that nothing in this repository may fetch (ADR-0023) — and until it does, the
`resolutionRateOfLines` and `correctionSurfacedShareOfLines` figures `headlineFigures` now derives have no
run to derive from. U1's committed BEFORE-baseline is also absent, so a later disagreement about whether
these numbers moved cannot be settled against it.
