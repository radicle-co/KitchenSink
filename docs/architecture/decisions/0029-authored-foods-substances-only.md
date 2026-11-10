# 0029 — Authored foods: the substances-only amendment to the single-writer rule

- **Status:** Accepted
- **Date:** 2026-08-31
- **Plan:** `docs/plans/2026-08-30-001-feat-resolution-funnel-earned-autonomy-plan.md` (U10–U12, U16, U18–U19)
- **Owner rulings:** Q3a, Q3b, Q3c, the promotion Sybil gate (2026-08-30), and the private-food rulings (2026-11-08)
- **Relates to:** [ADR-0052](0052-food-data-sources.md): an authored food's values carry no citation
  (`food_nutrition_value.citation_id` is NULL), and the authored route stays its provenance (D9a).

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
4. **Private until published, and private foods live only in private recipes.** An authored food is born
   `visibility='private'` and is readable by its author alone (a stranger gets the 404 a missing id gets,
   `authorshipPolicy.ts`). A recipe that is published and public may hold no line bound to a private food: every write
   that would leave one so is refused with `PRIVATE_FOODS_ON_PUBLIC_RECIPE`, naming the lines (`publicFoodsPolicy.ts`),
   and the recipe database enforces the same rule with `recipe_holds_private_food` and a constraint trigger. Before
   deciding, the write re-asks food, as the author, about each captured private food, and clears
   `food_lookups.food_owner_id` for one food now reports public. The R20 filters stay on every shared surface (food
   search, local search and suggest, search-by-food, band statistics, memo tier, global mappings), and the viewer overlay
   stays as defence. A clone keeps its bindings and is born a draft, so the rule meets it at publish.
5. **Publication: the author asks, staff approve.** The author files a request against the food's current version
   (`food_publication_requests`); an operator holding `food:admin` approves or declines it. Approval re-checks, under
   lock, that the food is not withdrawn and is at the requested version, then applies it and sets
   `visibility='promoted'`. A declined version cannot be asked again; an edit makes a new version. Food never calls
   recipe-service; the recipe side learns of the change through its own re-capture. Promotion is one-way. One request
   table serves both asks: the first publication of a private food, and each edit of a public one.
6. **Erasure: delete-if-unreferenced, orphan-if-referenced (Q3b).** A dead author's unreferenced foods
   are deleted whole; a food a living recipe still lines against is KEPT with its `user_id` retained
   pseudonymously (the `recipes.owner_id` Recital-26 posture) and its version attribution NULLed. The
   recipe-side mirror (erasure step 13) deletes the unreferenced private-food catalog rows and retains
   the referenced ones — hidden from every living search by the R20 filter regardless.
   The erasure donate-flip donates only an elected recipe that holds no private food; any other elected recipe is
   removed with the owner-only set, so no kept recipe ever holds a dead author's private food. That does not make
   the food's own deletion certain: the fan-out enqueues the recipe leg and then asks for the food references
   without waiting for the worker to delete the author's recipes, so a private food can still read as referenced
   and be kept orphaned on the food side, while the recipe-side binding is deleted by step 13.
   Orphan-if-referenced now applies to promoted foods.
7. **Versioning, and edits to a public food go back to review.** `food_versions` records every authored edit. The live
   food row is always the approved version, and every read (search, `/nutrition`, `refs/resolve`, every recipe) serves
   it. A private food's edit applies at once. A public food's edit is written only as the next version, and a pending
   `food_publication_requests` row points at it. Readers, other cooks and the author's own recipes keep the approved
   version until staff approve. Approval applies that version's snapshot to the live row, and then every recipe that
   uses the food moves together. Decline leaves the live row alone and keeps the declined version as history. A newer
   edit closes the older pending request, so staff only ever approve the newest version.
8. **A promoted food is world-readable.** Food search and the shared `/nutrition` route admit `visibility='promoted'`
   beside catalog rows (`promotedIsPublic.ts`). The edge-cached `/api/v1/foods/nutrition` stays caller-invariant: a
   PRIVATE authored food can never appear in it, for anyone; the author reads their own through the authenticated
   `/api/v1/foods/authored-nutrition` (a path deliberately outside the edge's `/nutrition*` shared-cache pattern), and the
   recipe gateway's authored phase is never process-cached.
9. **Delete is a withdrawal.** The author's `DELETE` flips `RESOLVED` to `WITHDRAWN` and keeps the row, with no
   cross-service check; a referencing line shows the food as removed. A pending publication request is closed with it.
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
- Accepted residuals, recorded rather than hidden: the edge-cached `/nutrition` serves the previous approved figures for
  its TTL after an approval; a staff-approved rename can collide with the author's other foods (the approval answers
  `409` and the request stays pending); promotion is one-way, so reversing it later needs a reverse path for the
  private-food rule; the database trigger turns a forgotten write path into a rolled-back transaction, which on erasure
  would be a stuck job (the donate filter and its e2e prevent it); the author's own recipes show the approved figure,
  not the pending edit; and a pseudonymous ULID survives erasure on kept rows by design (ADR-0027's posture).

## Guards

`authorshipPolicy` truth table; `publicFoodsPolicy`, `promotedIsPublic` and `publicationRequestPolicy` truth tables;
the migration `0064` trigger suite (`publicRecipePublicFoods` e2e); `foodPublicationRequestsSchema` and
`publicationRequests.dao` e2e suites; the `authoredFoodsSchema`/`foodVersionsSchema` integration suites;
`privateFoodScoping` + `privateFoodErasure` + `cloneVisibility` + `lineVerification` suites; the R24 erasure gate;
`corroboratedCompletion`. CLAUDE.md's T150 entry carries this amendment so the next reader does not "fix" the authored
door away.
