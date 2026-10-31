# 0079 — The calorie lookup never suspends: a card reads its figure as a value, not a promise

- **Status**: Accepted
- **Date**: 2026-10-31
- **Supersedes**: [ADR-0021](0021-deferred-recipe-nutrition.md). Its §2 guards 1 and 3 and all of its §6 are
  replaced below. Its §1, §3, §4 and §5 are carried forward unchanged in substance, so this record is complete
  on its own and ADR-0021 is kept only as the record of the suspending design.
- **Drivers**: A defect, measured. Discover's "See all" stayed on the rails for as long as the calorie lookup
  was in flight, up to the lookup's 12 s deadline, and for good in a test whose lookup never settled. ADR-0021's
  own promise was that the lookup "never holds anything up": the card paints now, and the figure fills in later.
  The suspending mechanism broke that promise for every deferred update on a screen that shows calorie slots.
- **Relates to**:
  [ADR-0014](0014-service-owned-api-contracts.md) — the service authors its wire types and clients never
  redeclare one, which is why the client union DERIVES its settled members;
  [ADR-0020](0020-cloudfront-edge-and-internal-alb-hostnames.md) — food's nutrition route is cached at the
  edge on the URL ALONE, which is what decides where the recipe-keyed endpoint may live;
  [ADR-0003](0003-shared-alb-per-stage.md) — the shared ALB whose default `404` is the pass condition for a
  locked-down origin;
  `specs/006-meal-planning` REQ-IF-008 — the owner ruling that fixes this endpoint's path and its 500 cap.

## Context

ADR-0021 put each card's calorie figure behind its own `<Suspense>` boundary. The card's slot called
`use(promise)` on the page's batch promise; the fallback was the skeleton; an error boundary keyed on the
promise's identity turned a failure into the "unavailable" chip.

That works for the slot. It does not work for the screen around it, because of how React 19 picks the next
lanes to render. The cause was read in the pinned `react-dom` 19.2.8,
`node_modules/react-dom/cjs/react-dom-client.development.js`, `getNextLanes`:

1. A calorie slot commits its fallback. React schedules a RETRY lane to try the slot again when its promise
   settles, and that lane is pending and not suspended.
2. A deferred update on the same root — "See all" (`useDeferredDiscoveryCriteria`), a sort change, a collection
   switch — renders in a transition lane. It suspends on its own data, and when that data lands React PINGS it.
3. `getNextLanes` first takes the highest-priority pending lanes that are NOT suspended
   (`pendingLanes & ~suspendedLanes`). Only when there are none does it look at the PINGED lanes. The slot's
   retry lane is unsuspended, so it wins every time, and its render suspends again on the same unsettled batch.
   The pinged transition does not get a turn until the batch settles.

So the deferred update waits for the calorie lookup, up to the client's 12 s deadline, and forever if nothing
settles it. Whether the retry render was already waiting depends on scheduling, which is why it looked like a
flake.

Measured on 2026-10-31 with a calorie lookup that never settles: a new sort of My recipes did not re-order the
cards, 3 of 3 runs on web (`RecipeListContainer`) and 3 of 3 on native (`RecipeListScreen`). The same tests with
a settled lookup passed 3 of 3 on each. Discover's "See all" did not reproduce in jsdom on either platform, in over
40 runs; commit `9bb75ec0a` records it timing out in 18 of 20 isolated runs under load.

It had been met twice before, and each time the symptom was fixed rather than the cause:

- `useRecipeNutritionBatches.ts` grew `failedBatch`: a failed batch handed `ensureQueryData` a new request on
  every render React did not commit, and "a deferred render waited behind every one of them". The fix handed
  back a pre-rejected promise, so the slot stopped suspending on failure. It still suspended while pending.
- Commit `9bb75ec0a` changed the discovery test's fake from a lookup that never settled to one that answered at
  once, because "See all" never ran while the retry render waited. That hid the defect in the suite. On a device
  the lookup takes as long as it takes, and the screen waited with it.

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
and nothing to time out. It exists only as the condition of a query that has not answered, and the slot renders
it as the skeleton, a _different component_ from the chip, so the chip has no pending case to fall back to.
`unaccounted` is terminal by contrast: it is the answer, not the absence of one, so it can never render a
spinner either.

Four guards make a permanent skeleton unreachable rather than merely discouraged:

1. `pending` is not a member of the union the chip switches over. The slot reads a BATCH reading —
   `pending`, `failed` or `settled` — with an exhaustive switch, and only `pending` renders the skeleton; the
   chip's own switch does not compile with a pending case.
2. The request carries a finite deadline, so a never-resolving fetch becomes a failure.
3. The reading is DERIVED from the query's state on every render, so nothing latches. A query with data is
   `settled`, even while it refetches and even if a later refetch failed; a query with no data and an error is
   `failed`; anything else is `pending`. A refetch that brings data replaces a failure on the next render, with
   no error boundary and no reset key to keep in step.
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
The classifier now reads freshness from the recipe's own contributing lines, so a stale food behind a line that
added no catalog figure does not caveat the reading.

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

### 6. Both platforms read the lookup as a value, through one hook

The calorie lookup NEVER suspends. No component under `features/recipes/src/nutrition/`, and not
`useRecipeNutritionBatches`, calls `use()`, mounts a `<Suspense>` boundary or reads a `useSuspense*` query.
`packages/tools/repoGuards/__tests__/nutritionNeverSuspends.test.ts` holds that.

- **One hook, both platforms.** `useRecipeNutritionBatches` subscribes with `useQueries`, one
  `recipeQueries(client).nutritionBatch(page)` per page of recipe ids on screen, and hands the surface a lookup
  from recipe id to a reading: `{ status: 'pending' } | { status: 'settled', response } | { status: 'failed' }`,
  or `null` for a recipe no page carries. The request starts in the first commit, which is as early as a card
  exists to show its figure; the skeleton is on screen from the first frame either way.
- **Pages are batched separately.** An infinite surface (discovery) accumulates results; one request per page
  keeps each page's answer settled forever and asks food only about the recipes that are new. A recipe that
  appears on two pages reads the first page's answer.
- **The slot is a selector, not a boundary.** `RecipeNutritionSlot` takes the reading and switches over it:
  `pending` → skeleton; `failed` → `unaccounted{food_unavailable}`; `settled` → the recipe's own state, or
  nothing when the response omitted it (§3).
- **The deadline stays in the client** (`nutritionBatch`'s `readWithinDeadline`), so `pending` always ends.
- **The batch is not cancelled when its observers leave.** The read seam does not read TanStack's own `signal`.
  TanStack cancels an in-flight query whose last observer leaves IF its request read that signal, and the next
  mount asks again. Discover's frame moves its results to a new parent when `<main>` is first measured, which
  remounts every rail: with the signal read, the rails' batches were requested 6 times instead of 3 in
  `RecipeDiscoveryContainer.nutrition.test.tsx`, each first request aborted. Under ADR-0021 nothing observed the
  query, so nothing cancelled it; this keeps that behaviour. The deadline alone bounds the request.
- **No RSC promise.** A server-created promise is not in the client `QueryClient`, so the client would batch a
  second time, and the server knows only page one of an infinite list. The client query is the one source on
  both platforms. Web keeps its hydration gate (`useHydratedNutrition`): the lookup starts after hydration, so
  server HTML and the first client render agree.

A deferred update can still wait on its OWN data. It no longer waits on the calorie lookup, because nothing
about the lookup suspends.

## Consequences

- A second request per list surface, uncached, always fresh. Accepted: it is what lets the card render now.
- `freshness` reaches the wire, so a reader served cached data during a food outage is told. KTD-3b said
  "serve stale, **marked**".
- The response envelope is **strict**, which the contract suite otherwise forbids for a response — recorded
  as an argued allowlist entry, because strictness is the mechanism that refuses
  `{state:'unaccounted', caloriesPerServing: 0}`. Adding a field to this union is a breaking change; a new fact
  belongs in a new member.
- Each card's slot re-renders when its page's query state changes. That is one render per card per state
  change, the same work the Suspense retry did, and it no longer competes with anything else for a lane.
- `react-error-boundary` no longer guards the calorie slot. A render error inside a slot is a bug and reaches
  the screen's own error handling like any other.
- Every caller that rendered calorie slots changed only in the type it passes on: the lookup returns a reading
  instead of a promise.

## Residual risk

**Fan-out at the cap** was measured for ADR-0021 and still holds: `prepareNutritionFanoutFixture` drives
`capOverlap` and `capFanout` in `tests/load/lib/common.js`, which records the figures and their derivation. On
2 vCPUs this batch is dominated by the service's own aggregation, not by waiting on food, so re-measure on the
target host rather than re-deriving.

**A future suspending read elsewhere on the same screen** can still hold a deferred update behind its own
retry lane. This ADR removes the calorie lookup from that class; it does not remove the class. Another deferred
figure should follow §6, not ADR-0021.

## Alternatives rejected

| Alternative                                                    | Why not                                                                                                                                                                 |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep `use(promise)` and pre-settle the promises we can         | Done twice already (`settledBatch`, `failedBatch`). It removes suspension only once the answer is known, and the defect lives in the time before it is known            |
| Keep Suspense and wrap the lookup's own updates in transitions | The retry lane belongs to the committed fallback, not to any update we schedule, so no wrapper of ours moves it                                                         |
| Answer the test's lookup at once (commit `9bb75ec0a`)          | Hides the defect from the suite and leaves it on every device, where the lookup takes real time                                                                         |
| `useSuspenseQueries` for the batch                             | Still suspends; same lane, same wait                                                                                                                                    |
| `POST` the recipe-keyed batch on **food**                      | Food cannot compute per-serving calories (no quantity, unit or servings), voids ADR-0020's caching rationale, and makes food learn recipe ids                           |
| `GET` on food with an encoded grouping                         | Cacheable in form only — the key becomes a per-user recipe SET, so the hit rate is ~0 at higher complexity                                                              |
| Embed calories in the list response                            | The N+1 this replaces                                                                                                                                                   |
| Add ingredient food ids to the list `Recipe`                   | Would let the client send `{recipeId:[foodIds]}`, but grows every list, search and discovery response for every consumer to echo back data the server re-derives anyway |
| A materialized view                                            | Reports no nutrition for the just-resolved food — the one moment a user is watching                                                                                     |
| `pending` as a wire state                                      | Lets an origin pin a skeleton forever                                                                                                                                   |
| `null` for an unreadable recipe                                | Equivalent in disclosure, but not representable once the value became a union; absence already is                                                                       |
