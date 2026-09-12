# 0029 — Authored foods: the substances-only amendment to the single-writer rule

- **Status:** Accepted
- **Date:** 2026-08-31
- **Plan:** `docs/plans/2026-08-30-001-feat-resolution-funnel-earned-autonomy-plan.md` (U10–U12, U16, U18–U19)
- **Owner rulings:** Q3a, Q3b, Q3c and the promotion Sybil gate (all 2026-08-30)

## Context

Two standing decisions boxed in the ingredient catalog. T150 ruled that **a recipe is a
method, not a substance**: a finished dish is never written into the food database, and the food DB keeps
a single writer — the USDA/source pipeline. That rule was doing two jobs at once: keeping recipes out of
the food table (its point), and keeping _users_ out of it entirely (a side effect). The side effect meant
a cook whose grandmother's spice blend exists in no source had no way to put a real, nutrition-bearing
food on a recipe line — the freeform fallback carries no macros, and the resolution funnel (plan 001)
cannot learn a name that has no entity to bind to.

## Decision

**The single-writer rule is amended to be about SUBSTANCES, not about writers.** A user may author a food
— a substance with per-100g macros — through a sibling CREATE door (`POST /api/v1/foods/authored`).
T150's core stands untouched: a recipe is still never a food, a cooked dish is still never logged as one,
and the PIPELINE remains the single writer _for catalog rows_. What changed is that an authored row is
not a catalog row: it has exactly one writer too — its author.

The decision decomposes into rulings, each with its enforcement point:

1. **Provenance is the ROUTE, never a field (D9a).** Walking through the authored door IS the
   provenance; there is no wire `source` field and no `food_sources` crosswalk row — an authored food is
   _structurally_ never-synced, rather than flagged as such. (`authoredFoods.dao.ts`; the never-synced
   property is what keeps it out of both refresh scans by construction.)
2. **Macros-only at launch (Q3a).** Calories/protein/carbs/fat per 100 g, resolved through the same
   `LABEL_NUTRIENT_MAP` `{name, unit}` identities the USDA merge uses, so the recipe side reads authored
   macros through the code path it already has. Feature 009 owns the additive nutrient expansion.
3. **The dedup split (KTD-H).** The full-table `food_normalized_name_unique` became two partial uniques,
   expand-first: the catalog half (`WHERE user_id IS NULL`) recreates the old constraint over exactly the
   old rows; the per-author half (`(normalized_name, user_id)`) lets two cooks each have their own
   "protein blend" while one cook cannot have two. Migration `0013_authored_foods.sql`; the
   `food_visibility_coherent` CHECK makes the illegal states unrepresentable.
4. **Private until promoted (Q3c) — and R20 scopes EVERY shared tier.** An authored food is born
   `visibility='private'`: retrievable by its author alone (stranger → the same 404 a missing id gets, on
   every action including read — `authorshipPolicy.ts`). The privacy fact is _captured_ into the recipe
   database at admission/refresh (`ingredients.food_owner_id`, migration 0040) because ADR-0006 forbids
   the cross-database join — and every shared surface then filters on its own side: food search, recipe
   local search/suggest, the verification gate's band statistics and memo tier (a private `food_id` never
   enters a global mapping — the mapping-scope policy's `correctedFoodIsPrivate` clamp), and the detail
   read's viewer overlay (`RESOLVED_UNAVAILABLE`, plan U13). A clone by a non-author UNBINDS the line
   into a freeform row rather than carrying a reference the cloner cannot see.
5. **Promotion: corroboration TRIGGERS, a human PUBLISHES (owner ruling: the promotion Sybil gate).** Cross-author
   agreement (distinct tenured authors, macro agreement around the median) mints a row in the
   `food_promotions` moderation queue (migration 0015) and nothing more; only an operator holding
   `food:admin` publishes, electing the OLDEST contributing food canonical. Publication is TWO-PHASE by
   database boundary: phase 1 atomic in food (queue decision + visibility flip), phase 2 an idempotent
   curated correction on the recipe side binding the name to the canonical — a kill between phases leaves
   every intermediate state safe. Two throwaway accounts can mint a queue entry, never a public food.
6. **Erasure: delete-if-unreferenced, orphan-if-referenced (Q3b).** A dead author's unreferenced foods
   are deleted whole; a food a living recipe still lines against is KEPT with its `user_id` retained
   pseudonymously (the `recipes.owner_id` Recital-26 posture) and its version attribution NULLed. The
   recipe-side mirror (erasure step 13) deletes the unreferenced private-food catalog rows and retains
   the referenced ones — hidden from every living search by the R20 filter regardless.
7. **Versioning: the table half only.** `food_versions` (migration 0014) records every authored edit as
   the recipes pattern does — the S3 archive half is deliberately deferred. This is the recourse for the
   accepted KTD-I residual: a promoted food's later edits move every referencing recipe's figures, and
   history is the answer until a version-pinning decision is made (named, not designed).
8. **The cache split (ADR-0020 amendment).** The edge-cached `/api/v1/foods/nutrition` stays
   caller-invariant: a PRIVATE authored food can never appear in it, for anyone; the author reads their
   own through the authenticated `/api/v1/foods/authored-nutrition` (a path deliberately outside the
   edge's `/nutrition*` shared-cache pattern), and the recipe gateway's authored phase is never
   process-cached. A PROMOTED food is world-readable with caller-invariant nutrition, so it enters the
   shared population the moment phase 1 commits.
9. **Delete is tombstone-first (U18).** The voluntary delete flips the row to the internal `DELETING`
   status _before_ the cross-service reference check (closing the TOCTOU), refuses while referenced
   (`FOOD_REFERENCED`, with the caller's own recipe ids only), fails CLOSED when the check cannot run,
   and `DELETING` never reaches the wire.
10. **A corroborated PENDING food completes (R10's second clause, U19).** A catalog food created by
    add-by-name for a novel name, once two independent authors' corrections corroborate its identity,
    is marked `RESOLVED` and leaves the USDA sync queue — the community's agreement IS the identity
    source for a name the upstream will never carry. The trigger is fire-and-forget from the recipe
    side's promotion commit, under the correcting user's own forwarded credential, and no-ops on every
    non-PENDING status.

## Consequences

- The catalog keeps its integrity guarantees: catalog rows still have one writer, the USDA pipeline;
  the per-author namespace is disjoint by construction (the dedup split), and nothing about an authored
  row can be mistaken for pipeline data (no source row, no crosswalk, `source_id IS NULL` value rows).
- Privacy is enforced at every tier that could leak a name, not at one route — and the erasure gate
  (R24, `erasureSweepCoverage.test.ts`) now audits BOTH databases' user-keyed food data.
- Accepted residuals, recorded rather than hidden: promoted-food nutrition drift under referencing
  recipes (version history is the recourse); the U19 trigger's promotion assertion is unverifiable
  across the database boundary (blast radius: one dataless completion; `requeue` is the repair); and a
  pseudonymous ULID survives erasure on kept rows by design (ADR-0027's posture).

## Guards

`authorshipPolicy` truth table; `foodPromotionsSchema`/`authoredFoodsSchema`/`foodVersionsSchema`
integration suites; `privateFoodScoping` + `privateFoodErasure` + `cloneVisibility` (clone-unbind) +
`lineVerification` (viewer overlay) integration suites; the R24 erasure gate; `promotionsApi` end-to-end
funnel; `corroboratedCompletion`. CLAUDE.md's T150 entry carries this amendment so the next reader does
not "fix" the authored door away.
