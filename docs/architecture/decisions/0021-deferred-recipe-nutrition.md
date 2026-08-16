# 0021 — Recipe calories are fetched after the card, and a skeleton can never be permanent

- **Status**: Accepted
- **Date**: 2026-08-16
- **Drivers**: Owner directive (2026-08-16), reversing half of plan U10. U10 deleted the denormalized
  `recipes.lead_calories_per_serving` column — correctly, it was a second copy of food's data that froze at
  its last write — but then had list and search surfaces report no calories at all, permanently. The owner's
  correction: the lookup still happens, it happens **after** the card renders, and the figure sits behind a
  skeleton until it lands.
- **Relates to**:
  [ADR-0014](0014-service-owned-api-contracts.md) — the service authors its wire types and clients never
  redeclare one, which is why the client union DERIVES its settled members;
  [ADR-0020](0020-cloudfront-edge-and-internal-alb-hostnames.md) — food's nutrition route is cached at the
  edge on the URL ALONE, which is what decides where the recipe-keyed endpoint may live;
  [ADR-0003](0003-shared-alb-per-stage.md) — the shared ALB whose default `404` is the pass condition for a
  locked-down origin;
  `specs/006-meal-planning` REQ-IF-008 — the owner ruling that fixes this endpoint's path and its 500 cap.

## Context

After U10 a recipe holds `food_id` and `food_resolution_status` and nothing else food-derived. Three call
sites — the search DAL, the recipe service's list projection and the collections service — pinned
`hasPartialNutrition: true` and emitted no figure, so **no card anywhere rendered calories**.

Fetching them inline was never an option: it is an N+1 into another service on the hot path of every list
render. The question was where the batched lookup lives, and what a card shows while it is in flight.

## Decision

### 1. The recipe-keyed endpoint lives on RECIPE, not on food

The owner's original description put a `{recipeId: [foodIds]}` endpoint on the **food** service. It cannot
live there, for a reason that is arithmetic rather than architectural: per-serving calories are
`Σ(grams × kcal_per_100g ÷ 100) ÷ servings`. That needs each line's **quantity and unit** and the recipe's
**servings**. Food holds none of them and must not — a recipe is a method, not a substance, and food's
single-writer rule is the USDA pipeline (see `specs/001` T150).

Given `{recipeId: [foodIds]}`, food could only return the same per-100g rows regrouped. The app still could
not render a number.

So the owner's request and response **shapes ship as described**; only the host moves:

| Hop           | Call                                                      | Edge-cacheable                                    |
| ------------- | --------------------------------------------------------- | ------------------------------------------------- |
| app → recipe  | `POST /api/v1/recipes/nutrition-batch` (≤ 500 recipe ids) | No — and irrelevant, a per-user id set never hits |
| recipe → food | `GET /api/v1/foods/nutrition?ids=` **unchanged**          | **Yes**, URL-keyed, hits across every user        |

This requires **no EdgeStack change**, which is itself the argument for it: every alternative needs one.
A POST on food would void ADR-0020's stated reason for food having a distribution, make food learn recipe
ids it must never persist, and still return un-renderable data.

The path and the 500 cap are **not this ADR's to choose** — `specs/006-meal-planning` REQ-IF-008 fixed both
by owner ruling, and records that 500 exceeds the 360-entry maximum of a 90-day × 4-slot plan, which is what
makes 006's "exactly one request" reachable.

### 2. Three states, of which only TWO cross the wire

```
known        { caloriesPerServing, proteinG, carbsG, fatG, isComplete, freshness: 'fresh' | 'stale' }
unaccounted  { reason: 'no_resolved_ingredients' | 'no_nutrient_data' | 'food_unavailable' }
pending      — CLIENT ONLY. Never a wire state.
```

⛔ **`pending`'s absence from the wire is the enforcement mechanism.** The moment a server can emit it, a
skeleton can become permanent — a spinner rendering forever because an origin said so, with nothing to retry
and nothing to time out. It exists only as the Suspense fallback, in a _different component_ from the chip,
so the chip has no pending case to fall back to. `unaccounted` is terminal by contrast: it is the answer,
not the absence of one, so it can never render a spinner either.

Four guards make a permanent skeleton unreachable rather than merely discouraged:

1. `pending` is not a prop — it is a fallback, a different component, and the chip's exhaustive switch does
   not compile with a pending case.
2. The request carries a finite deadline, so a never-resolving fetch becomes a rejection.
3. The error boundary is keyed on **promise identity**, so a transient failure cannot latch a card off for
   its lifetime. (It did, in the first cut: `react-error-boundary` only resets when a key _changes_.)
4. `known` **requires** a number, so a `0` there is a real measured zero — water, black coffee — and every
   failure path lands in `unaccounted`, which carries no figure at all.

This replaces `hasPartialNutrition`, a two-valued encoding of a three-valued fact whose own docstring said
"some line could not be accounted for" while three sites pinned it `true` to mean "not looked up".

### 3. Authorization is by ABSENCE, and absence renders blank

A recipe the caller may not read is **omitted from the map**. `unaccounted` would confirm the id exists;
`known` would leak the figure. Absence is the only non-disclosing representation once the value became a
union.

⛔ Clients read the map with `Object.hasOwn`, never a bare index: a `Record` index reaches the prototype
chain, so a recipe id of `toString` returns a **function** rather than `undefined`, and `?? null` hands it
straight through as if it were a reading. That defect shipped on this branch and was reverted.

A missing key renders **blank** — no chip, exactly like a recipe with no nutrition data. It must be a
definite terminal decision, never `undefined` falling through, or the skeleton stays up and reintroduces the
failure this whole design prevents.

### 4. Freshness is per ENTRY, and chunks run in bounded waves

`FoodNutritionGateway` chunks at food's 100-id cap. Those chunks used to run **serially** inside one `try`,
so cost was `ceil(distinctFoods ÷ 100) × foodLatency` in series — at the 500 cap with low ingredient overlap,
~50 round trips back to back, past REQ-NF-006's 500 ms budget. They now run in **waves of 6** under
`Promise.allSettled`.

That change forces the other: `allSettled` makes partial success real, so one answer legitimately mixes ids
fetched a moment ago with ids recovered from cache with ids nothing recovered. A single batch-level
`freshness` scalar cannot describe that without lying in one direction. So **`freshness` moved onto the
entry**, and `absent` stopped being a value — an id nothing recovered is simply not in the map, the same
rule as an unreadable recipe.

This is also what makes the wire's per-recipe `known.freshness` **true**. It was derived from a batch scalar,
so one failed chunk caveated every recipe in the request, including recipes whose own foods came back fine.
The classifier now takes `staleFoodCount`, computed from the recipe's own foods.

Six is a **bound**, not a target: unbounded `Promise.all` would put ~50 simultaneous requests on food from
ONE recipe read, multiplied by every concurrent caller, against a service with a finite pool and a load
shedder. Waves rather than a work queue — a slow chunk holds its wave, which is slightly less optimal and
much easier to reason about, and the tail is dominated by the number of waves.

### 5. The view names an access path and decides nothing

Food's `getNutritionBatch` was `ids.map(readGoldenRecord)` at 1+4 statements each — measured at exactly
**500 statements for 100 ids**. `food_nutrient_view` joins `food_nutrients` to `nutrient` and carries
`basis` through unfiltered; the read is now **3** queries.

⛔ The view contains **no `WHERE`, no `FILTER`, no `CASE`**. The tempting shape —
`max(amount) FILTER (WHERE n.name='Energy' AND n.unit='kcal')` — would hard-code `LABEL_NUTRIENT_MAP` into
SQL, a second authority for what "calories" means whose divergence reproduces the 4.184× kcal/kJ error that
map exists to prevent, and would need the U+00B5/U+03BC micro-sign fold re-expressed in SQL. 100% of the
selection stays in `selectPer100g`.

**Not materialized**, and the reason is freshness rather than cost: food's writer is user-triggered and
latency-visible — a user adds an ingredient, food answers `202`, the USDA fetch fills it, the user is
polling — so a matview would report no nutrition for the just-resolved food, breaking exactly the moment
that matters most.

### 6. Both platforms render-as-you-fetch, with the same mechanism

Web creates the promise in the RSC route **without awaiting it** and passes it into the client subtree;
React serializes a pending promise across the boundary and streams the resolution. Mobile calls
`ensureQueryData` the moment the ids are known, which returns a promise _and_ seeds the cache, so render
finds an in-flight query.

⚠️ `RecipeHomeWidget.native.tsx` states "React Native has no Suspense-for-data streaming". That is true of
**server** streaming and false of the mechanism — `use(promise)` + `<Suspense>` work identically on the RN
client. The old prop-driven `isLoading` shape is not a constraint to copy.

**One promise, N per-card boundaries.** `use()` memoizes per promise, so N boundaries over one promise cost
one fetch and fill together.

## Consequences

- A second request per list surface, uncached, always fresh. Accepted: it is what lets the card render now.
- `freshness` reaches the wire for the first time, so a reader served cached data during a food outage is
  finally told. KTD-3b said "serve stale, **marked**"; only the first half was implemented.
- The response envelope is **strict**, which the contract suite otherwise forbids for a response — recorded
  as an argued allowlist entry, because strictness is the mechanism that refuses
  `{state:'unaccounted', caloriesPerServing: 0}`. Consequence: adding a field to this union is a breaking
  change; a new fact belongs in a new member.
- `leadCaloriesPerServing` survives on the detail read only. Once cards consume the batch hook that is two
  sources for one number — the drift U10 removed. **Follow-up owed.**
- 006's older `{results:[{recipeId, nutrition|null}]}` wording is superseded and its five files amended.

## Residual risk

**Fan-out at the cap is the real tail, and the k6 scenario does not measure it.** `capBatch` pads with
unresolvable ids, so it measures request _width_ while fan-out stays at one call — it would go green on a
case that cannot fail. The bound is `ceil(distinctFoods ÷ MAX_IDS_PER_REQUEST) ÷ MAX_CONCURRENT_CHUNKS`
waves. Seed disjoint ingredient sets so distinct-food count scales with recipe count, record the observed
p95 beside the derivation, and only then call the 500 cap safe. If it still misses, lowering the documented
cap is a spec amendment with a number behind it — REQ-IF-008 forbids silent truncation.

## Alternatives rejected

| Alternative                                  | Why not                                                                                                                                                                 |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST` the recipe-keyed batch on **food**    | Food cannot compute per-serving calories (no quantity, unit or servings), voids ADR-0020's caching rationale, and makes food learn recipe ids                           |
| `GET` on food with an encoded grouping       | Cacheable in form only — the key becomes a per-user recipe SET, so the hit rate is ~0 at higher complexity                                                              |
| Embed calories in the list response          | The N+1 this replaces                                                                                                                                                   |
| Add ingredient food ids to the list `Recipe` | Would let the client send `{recipeId:[foodIds]}`, but grows every list, search and discovery response for every consumer to echo back data the server re-derives anyway |
| A materialized view                          | Reports no nutrition for the just-resolved food — the one moment a user is watching                                                                                     |
| `pending` as a wire state                    | Lets an origin pin a skeleton forever                                                                                                                                   |
| `null` for an unreadable recipe              | Equivalent in disclosure, but not representable once the value became a union; absence already is                                                                       |
