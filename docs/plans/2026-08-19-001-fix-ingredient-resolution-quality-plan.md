---
title: 'fix: ingredient resolution quality — search ranking, local-vs-catalog matching, parser quantity loss, and the PG 18 + pgvector substrate'
date: 2026-08-19
revised: 2026-08-19
type: fix
depth: deep
origin: measured during the 448-recipe public-domain cookbook import (PR 91)
evidence: 'imported corpus in `recipe_clean`; ~900+ of 2,432 ingredient lines carry a wrong food_id on public recipes'
branch: chore/code-quality-enforcement-phase-1-2
---

> ⚠️ **Superseded as a description of current state** by [`docs/architecture/2026-08-28-ingredient-pipeline-state.md`](../architecture/2026-08-28-ingredient-pipeline-state.md) (2026-08-28, PR 91).
>
> The decisions and reasoning below remain valid and this document is deliberately NOT deleted. Where it
> and the state addendum disagree about **what exists today**, the addendum wins.

# fix: ingredient resolution quality

> ⛔ **SUPERSEDED (2026-08-20) by `docs/plans/2026-08-20-001-fix-ingredient-resolution-quality-plan.md`.**
> Kept for its measurements and rejected alternatives. Do not implement from it: U1's formula was measured
> at 4 regressions and 0 fixes on multi-word queries, U3's "change nothing structural" was based on a
> statistic the import itself manufactured, and the plan misses the client-side rankers, the
> `additionalDescriptions` alias table, and the cross-service deploy ordering.

## Summary

Importing 448 public-domain recipes **through the app's own resolution path** — plain text in, no
pre-resolution, no name massaging — turned the ingredient pipeline into a measurement instrument. It found
four problems, three of them defects and one an unmet substrate need.

The severity is higher than "search feels bad". Roughly **900+ of 2,432 ingredient lines carry a wrong
`food_id` on `visibility: 'public'` recipes** — published false nutrition claims. That is the same
asymmetric-cost rule `proseRecipe.ts` already applies to knife-cut dimensions, and it applies here.

⛔ **Two mechanisms in the original report were wrong and are corrected below.** Both were falsified by
measurement, not by argument, and the corrected mechanisms change the fixes.

## Problem frame

| #   | Defect                                                      | Where                              | Measured impact                                                    |
| --- | ----------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------ |
| 1   | Search ranks by string SHAPE, not word match                | `foodSearch.dao.ts` 3+ char branch | `Carob flour` 159 lines, `Crackers, milk` 89, `Bread, cinnamon` 31 |
| 2a  | A modifier-only match becomes a permanent attractor         | `ingredients.dal.ts:136`           | `finely chopped chives` absorbed 24 lines across 15 recipes        |
| 2b  | A weak local hit structurally outranks a strong catalog hit | `ingredientSuggestion.ts`          | compounds 2a                                                       |
| 3   | The parser silently corrupts or drops quantities            | `recipe-import-core`               | 472 + 122 + 377 + 107 occurrences by class                         |
| 4   | No semantic matching substrate                              | RDS PG 16, no pgvector             | word-order inversion is unfixable lexically                        |

## Key technical decisions

### KTD-1 — Issue 1 is `similarity()` dominating `ts_rank`, NOT name length

⛔ The first report said "ranks by name length". Reproduced against 7,793 real USDA rows:

```
Watercress, raw          0.3125   <- wins
Water, bottled, generic  0.2727   <- exact word match, loses
```

`similarity()` is a length-normalised TRIGRAM-OVERLAP RATIO, so a shorter total string wins on ratio even
when a longer one contains the query as a WHOLE WORD. `GREATEST` lets it dominate `ts_rank`, whose values are
~0.06 for a single lexeme hit. **Shape beats language.** Same symptom, different fix — a length term would
not have helped.

### KTD-2 — Issue 2a is a MATCHING defect in the `WHERE`, not a ranking defect

⛔ The first report said "stale PENDING freeform row, same `GREATEST(ts_rank, similarity)` formula". All
three claims are false, and the real mechanism is worse:

- `ingredients.dal.ts:138` uses **`word_similarity(query, name)`** with `<%`, NOT `similarity`.
- The attractor row is `is_user_entered = false` WITH a `food_id` — **food-backed, not freeform**. The
  catalog-beats-freeform rule could never have touched it.
- `similarity('finely chopped chives','citron') = 0.038` — it could not have produced the match.

`word_similarity(q, name)` measures how much of the QUERY is covered by SOME EXTENT of the name, **without
requiring the head noun to participate**. Measured:

```
word_similarity('finely chopped peanuts', 'finely chopped chives') = 0.652  -> matches (threshold 0.6)
word_similarity('finely chopped figs',    'finely chopped chives') = 0.833  -> matches
```

The bad row is the ONLY candidate, so ranking cannot save it. And it **ratchets**: the first
`finely chopped …` row admitted becomes a permanent attractor for every later one, for every user.

### KTD-3 — two obvious fixes are MEASURED AND REJECTED

Recorded so nobody re-proposes them:

| Candidate                                   | Why it fails                                                                                                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Raise `word_similarity_threshold` 0.6 → 0.7 | Global GUC; **breaks the documented `flor` → `All-purpose flour` requirement** (measured at exactly 0.600); `finely chopped figs` still leaks at 0.833 |
| `strict_word_similarity` (`<<%`)            | Fixes nothing (`figs` 0.833, `peanuts` 0.652 both still match) and breaks `flor` (0.375)                                                               |

**Chosen: head-token conjunction** — `q <% name AND head(q) <% name`. Measured: excludes every bad match,
keeps every good one (`flor`, `unsalted buter`, `all purpose flour`, `brown sugar`). For a single-token query
it is a tautology, so typo tolerance is untouched **by construction**.

### KTD-4 — the ranking rule is NOT shared knowledge; the INVARIANT is

Food (`similarity`) and ingredients (`word_similarity`) legitimately differ: a curated 7,793-row USDA corpus
with a `Head, qualifier` grammar versus an unbounded free-text catalog with no grammar. They change for
different reasons, so merging them is the WRONG abstraction (DRY governs knowledge, not keystrokes).

What IS one piece of knowledge, currently with zero representations:

> A whole-word match must outrank a shape-only match; the score expression IS the sort key; the score is
> bounded in `(0,1)` with `1` reserved for an identity (crosswalk) hit.

Home: a **shared conformance test contract** in `packages/tools/service-test-harness`, run by both services
against their own DAL. Shared RULE, not shared SQL — no cross-service runtime coupling (ADR-0014).

### KTD-5 — Issue 3's `2½` bug is OURS, and it is a breached Adapter contract

⛔ `parse-ingredient` returns **2.5 correctly**. `normalizeQuantity`'s tokenizer claims the bare `2`, and
`ingredientLine.ts:116` prefers it. Two docstrings assert the documented `parse-ingredient` fallback is
reachable; it is not. `needsReview` stays `false`, so the loss is silent.

**Consequence: swapping parsing libraries fixes none of the three defects.** They are ours.

### KTD-6 — the refusal machinery exists and nothing consumes it

`needsReview` / `reviewReasons` have **zero consumers** outside `recipe-import-core`. The library does what
the standards ask — refuses to guess and says so — and the pipeline discards the statement at
`proseRecipe.ts:470`. That is a seam nothing crosses, and it is why all four losses shipped silently.

### KTD-7 — PG 18 + pgvector, and why they are SEPARATE changes

Word-order inversion (`Red wine vinegar` → `Vinegar, red wine`, `cinnamon` → `Spices, cinnamon, ground`) is
**unfixable by any lexical rule**. It needs semantic matching.

- **pgvector does NOT require a Postgres upgrade** — it runs on PG 13+ and is available on RDS 16. The local
  blocker is the container IMAGE (stock `postgres:16` lacks it; `pgvector/pgvector:pg16` has it).
- **PG 18 is still worth doing, on its own.** `pg_upgrade` now retains planner statistics; previously a major
  upgrade wiped them and left the optimiser blind until re-`ANALYZE`. This codebase is already sensitive to
  that — a search test needed `SET STATISTICS 1000` to stop flaking.
- **No incremental AWS cost**: RDS bills by instance class/storage/IO, not major version. Staying on 16 past
  its support window is what eventually costs more (Extended Support, per vCPU-hour).
- ⚠️ **PG 18 makes generated columns VIRTUAL by default.** `food.search_vector` must stay `STORED` (a virtual
  tsvector cannot be indexed). Existing columns keep their definition; any NEW generated column written after
  the upgrade must say `STORED` explicitly. The `head_vector` column in U1 is exactly such a column.
- ⛔ The upgrade is a **one-way door** (no in-place downgrade) and it WILL move the prod template, which
  `cdkNagTemplateParity` exists to catch. It gets its own change and its own proof — never bundled with a
  feature, because two changes sharing a failure mode is how the nightly-shutdown and in-stack-trigger
  interaction wedged a stack this week.

## Implementation units

### U1 — food-service relevance policy (Issue 1)

1. Extract `foods/dao/foodRelevance.ts` — a named tiered **Scoring Policy** owning the weights, the `(0,1)`
   bound and the score-is-sort-key rule for BOTH branches. Today `NAME_INITIAL_WEIGHT` and the `GREATEST` are
   two unrelated representations of one rule, 30 lines apart, one argued and one ad-hoc.
2. Tier: `0.5·headMatch + 0.25·lexemeHit + 0.15·word_similarity + 0.09/(1+len)`. The tier gap (0.25 > max
   lower-tier 0.195) makes word-beats-shape **provable**, not tuned.
3. Add `food.head_vector` as a **STORED** generated column, mirroring `search_vector`. Additive, expand-first
   (ADR-0022).
4. ⛔ Change only the `ORDER BY`. The header's two "deliberately NOT removed" `WHERE` rulings stand.

Measured on 15 staples: 12/15 correct head noun at #1. `water`, `milk`, `cream`, `onion`, `vinegar`,
`raisins`, `molasses` all fixed. `cinnamon` and `flour` remain — they are the inversion class, U4's problem.

### U2 — ingredient matching strategy (Issue 2a)

`selectIngredientMatchStrategy(query)` — pure, DB-free, discriminated union (`none | singleToken |
multiToken`), exhaustive switch, mirroring `foodSearch.dao.ts:131-155`. Single-token keeps today's behaviour
exactly (that is what `flor` needs); multi-token adds the head conjunction.

### U3 — precedence (Issue 2b): CHANGE NOTHING STRUCTURAL

Once U2 stops manufacturing false local candidates, "section, don't blend" is doing its job: a local row that
IS a genuine word match legitimately outranks a catalog hit, because picking it needs no `by-food` admission
round-trip. Do **not** discard the anti-jank guarantee; do **not** add a second ranker on a different scale.

### U4 — parser fixes + the review gate (Issue 3)

1. `CLAUSE_SPLIT`: do not split on `and` when `normalizeQuantity` consumed it. Use its existing
   `phrase`/`rest` outputs rather than re-encoding number-word knowledge in the splitter.
2. `½` precedence: make the docstring true — a **contract repair**, asserted both ways.
3. `*ful` units: add `cupful(s)`, `tablespoonfuls`, `saltspoonful(s)`, `dessertspoonful(s)`, `wineglassful(s)`,
   `gill(s)` to `UNIT_ALIASES`. Fixes the dropped-line AND the unconvertible-unit defect in ONE place, because
   `unitToGrams` reads the same table.
4. **The review gate**: `toCandidateRecipe` reads `reviewReasons` and refuses value-corrupting ones into the
   existing `droppedLines` channel. This closes the seam that let all four through.
5. Delete `?? 0` at `runImport.ts:130` — it contradicts "`null` is NEVER a fabricated 1".

### U5 — pgvector substrate (Issue 4, part 1)

Enable `vector` on RDS 16; switch local/CI images to `pgvector/pgvector:pg16`. Embeddings over ~8k rows need
**no ANN index** — brute-force cosine is fine at that size. Store the **model identifier** alongside every
vector: embeddings are model-versioned, and mixing generations silently corrupts distance.

### U6 — PG 16 → 18 upgrade (Issue 4, part 2) — SEPARATE CHANGE, AFTER U1–U5

1. Pre-flight: confirm `pgvector` and every extension in use is available on RDS 18.
2. `PostgresEngineVersion.VER_16` → `VER_18` in `DataStack.ts`, **with a template diff reviewed**, not
   assumed — this WILL move the prod template and `cdkNagTemplateParity` will flag it. That is the guard
   working; the diff must be read and justified, not suppressed.
3. Sandbox first, with the full suite green, before prod.
4. ⚠️ Audit every `generatedAlwaysAs` for an explicit `STORED` before upgrading.
5. Post-upgrade: verify planner statistics survived (the PG 18 improvement) rather than assuming.

## Testing strategy

⛔ **A ranking change cannot be validated on three examples.** The deliverable that makes this provable is a
**Golden Relevance Judgement Set**: `{ query, expectedTopFoodName, why }`, ≥60 queries over real USDA names,
asserted as **precision@1 against a committed baseline with zero regressions**. Two properties matter more
than the threshold:

- **known-miss entries are asserted to STILL miss**, so nobody "fixes" ranking by over-fitting;
- an added judgement that fails is a RED test, so the suite can detect the absence of the fix.

Per §7.1: U1/U2 need unit AND integration (real Postgres — a mocked test structurally cannot prove `<%`
threshold semantics), plus e2e and k6 for the deployable services. `ingredients.dal.test.ts:75-105` is
**mock-only and asserts call counts** — it would pass with the `WHERE` arbitrarily broken. That is coverage
theater by §7.1's own definition, and it is why this shipped.

⚠️ k6 must re-measure the SC-007 200 ms budget at the **50,000-food scale** the original baseline used, not
at 7,954.

## Sequencing, and why

1. **U4** (parser) — cheapest, independent, and it is corrupting data now.
2. **U1** (ranking) — needs the judgement set first.
3. **U2/U3** (matching) — independent of U1 but shares the conformance contract.
4. **U5** (pgvector) — unblocks the inversion class U1 deliberately leaves.
5. **U6** (PG 18) — last, alone, with its own proof.

⛔ **Do NOT loosen the catalog-beats-freeform rule to leading-comma-segment until AFTER U1.** Suppression
removes a USER'S OWN ROW, so its correctness is downstream of the ranker's. With today's ranking it would
hide a cook's `Pepper` in favour of `Pepper, banana, raw`. Flip condition, explicit: loosen only once the
judgement set shows **precision@1 ≥ 0.9 on single-token staple queries**.

## Open questions

1. **Remediation of published data** — the owner has ruled: **wipe and re-import.** ⚠️ Still open: the prose-derived rows minted into the SHARED, ownerless `food` catalog (`finely chopped chives`, `cold water a teaspoon of flour`) are global and outlive the recipes. Tombstone or keep? No rollback.
2. **Is the word-order-inversion class in scope for U1?** It is not solvable lexically; U5 is the answer. U1 leaves those as _visible, tier-2_ misses rather than random ones.
3. **`wineglassful` / `gill` gram conversions** — an accepted source, or alias with `unitToGrams → null`?
4. **A genuine stated range ("2 to 3 cups")** — refuse like `2-1/2`, or keep taking the lower bound as documented?
5. **Is the 50,000-food perf corpus still generable** for U1's k6 gate?

## Risks

- **One-way doors**: `head_vector` (schema), the PG 18 upgrade, and the already-published data. Rank weights
  and thresholds are two-way — decide fast, they live in one module.
- **The shared `food` catalog is ownerless** — `addByName` mints globally visible rows from whatever a caller
  types. That is the systemic cause behind 2a's ratchet and it is not fixed by any unit here.
- **Model-versioned embeddings** (U5): changing the model invalidates every stored vector.
