# CR-001 — Mockup parity: difficulty, ratings, the derived PRO badge, and skeleton-placeholder Home widgets

- **Status:** Accepted — _design only_ (spec/data-model/contracts amended; implementation tasks T151–T170 appended to `tasks.md`, not yet built). Owner-approved 2026-07-16.
- **Date:** 2026-07-16
- **Area:** recipe domain model · REST contract · Home widget surface · GDPR erasure path · `@kitchensink/recipe-core` · `@commise/features-core`
- **Related:** `spec.md` (FR-001b/FR-001c/FR-003a/FR-013/FR-013a/FR-013b, US-000 + FR-046 amendment, C-007 amendment), `data-model.md` (`recipes.difficulty`, `recipe_ratings`, the rating-aggregate trigger, cover-photo resolution, the erasure amendments), `contracts/api.openapi.yaml` + `contracts/recipe.types.ts`, `packages/apps/commise/features/core/src/contract.ts` (the shipped discriminated-union descriptor), ADR-0005 (erasure by owner-scoped roots), the mockups (home + recipe cards).

## ⚠️ Before you change this — the traps

- **Difficulty is NULLABLE and there is no default.** Do not "tidy" `recipes.difficulty` into `NOT NULL DEFAULT 'medium'` to match the `servings`/times precedent (migrations 0007/0008). Those columns are load-bearing and always knowable; difficulty is a subjective judgement nothing computes from, and a default would make every recipe — including every one feature 004 imports — falsely claim its author chose that value. Absent difficulty renders **no badge**, never a guess.
- **The rating aggregate is trigger-maintained; no application code may write `recipes.average_rating` / `recipes.rating_count`.** Do not "optimize" the trigger into a service-layer recompute, and do not drop the `FOR UPDATE` lock in `recipe_ratings_aggregate_refresh()` — it is the correctness fix for a lost update under READ COMMITTED, verified on PG 16 (see `data-model.md` § Rating Aggregate Maintenance). Do not disable the trigger during the erasure bulk delete.
- **The PRO badge is derived, never stored.** Do not add an `is_pro` column, and do not implement it as `visibility === 'private'`. The rule is `private AND sourceType ∈ {user_created, imported_public}` and lives in exactly one function (`usesPremiumCapability` in `@kitchensink/recipe-core`). This is NOT a feature-010 entitlement dependency.
- **Roadmap Home widgets are SKELETON placeholders, not fake data and not absent.** Do not make a placeholder render a specimen macro total / item count / recipe name — a plausible value reads to a user as their own real data, and that is the whole point of the placeholder. Do not give a placeholder a loader that imports the unbuilt feature package (that was the original R6 objection and it still holds); the host renders it from a static descriptor. Do not turn a **tier**-gated widget into a placeholder — tier exclusion stays **absent**.

## Context

The home and recipes mockups show four things the spec, data model, contract, and schema did not account for:

1. a **difficulty badge** (easy / medium / hard) on recipe cards and detail;
2. a **star rating** with an average and a count on cards;
3. a **"PRO" badge** on some recipes;
4. Home **widgets for features that have not shipped** (meal plan, nutrition, shopping, AI suggestion, resume-cooking — services 005–009), which the mockup shows as populated cards.

The original spec (FR-046 / rule R6) said unshipped-feature widgets are **absent** from Home. That rule existed to answer a concrete technical objection: the render layer does a dynamic `import()` of each feature's widget module, and `import()`ing a package that does not exist fails the build. "Absent" dodged that — but it also makes a freshly-logged-in user's Home look empty and gives no sense of what the product will become. The mockup's populated cards are the opposite failure: fabricated data a user cannot distinguish from their own.

This CR records four decisions that close the gap between the mockups and the shipped design without either fabricating data or taking on a premature entitlement model. Ratings additionally intersect the GDPR erasure path (ADR-0005 / C-007), which this CR extends.

---

## D-A — Difficulty: an optional `easy | medium | hard` enum, nullable, no default

**Decision.** Add `recipes.difficulty TEXT CHECK (difficulty IN ('easy','medium','hard'))` — **nullable**, no default. Surface it as an optional `difficulty?: RecipeDifficulty` on the `Recipe` DTO, settable on create and update. On update the field is **three-state**: omitted = leave unchanged, a value = set it, explicit `null` = clear it back to "not stated" (without a clear sentinel, `Partial<>`'s omitted-means-unchanged rule would make "no difficulty" reachable only at create time). Difficulty is descriptive metadata only — nothing (nutrition, scaling, search ranking) may depend on it. Where shown, a text label accompanies any color coding (NFR-004).

**Why nullable, against the `NOT NULL` precedent.** Migrations 0007/0008 made `servings` and the time fields `NOT NULL`. Difficulty deliberately diverges. The distinction is _knowability_: servings and times are load-bearing (scaling and nutrition compute from them) and always knowable by the author. Difficulty is a subjective judgement, and "the author did not state one" is a real, first-class state. A `NOT NULL DEFAULT 'medium'` would stamp that judgement onto every recipe that never made it — and would be wrong the moment feature 004 imports a recipe whose source states no difficulty. NULL → no badge is the only honest rendering.

**Alternatives rejected.**

- **`NOT NULL DEFAULT 'medium'` (match 0007/0008).** Rejected: fabricates authorship; wrong for every import; makes "unstated" unrepresentable. Consistency with a precedent is not a reason to propagate a semantic that does not fit.
- **A numeric 1–5 difficulty.** Rejected: implies a false precision and invites computation ("sort by difficulty ascending" as if it were ordinal-metric). The mockup shows three labelled tiers; model exactly that.
- **Derive difficulty from step count / total time.** Rejected: it is a subjective judgement, not a function of the data; any formula would be confidently wrong and un-overridable by the author.

---

## D-B — Ratings: a `recipe_ratings` table, full write path, trigger-maintained denormalized aggregate

**Decision.** Add `recipe_ratings` — one row per `(recipe_id, user_id)`, `stars` CHECK 1–5, `UNIQUE(recipe_id, user_id)`, `recipe_id` FK → `recipes` `ON DELETE CASCADE`, `user_id VARCHAR(255)` app-user ULID with **no FK** (D2, same rule as `recipes.owner_id`), timestamps. Denormalize `recipes.average_rating` (`NUMERIC(3,2)`, NULL when unrated) + `recipes.rating_count` (`INTEGER NOT NULL DEFAULT 0`), maintained **only** by a statement-level trigger `recipe_ratings_aggregate_refresh()` (mirroring the existing trigger-maintained `search_vector`). Expose `PUT /v1/recipes/{id}/rating` (idempotent upsert) and `DELETE /v1/recipes/{id}/rating` (idempotent remove), both under bare `/v1` (R1). `averageRating` + `ratingCount` are read-only on the list and detail DTOs.

**Rules (FR-013).** Any authenticated user may rate any recipe **they can see**, governed by the existing visibility/IDOR read rules — an unreadable recipe returns the same `404 RECIPE_NOT_FOUND` as a non-existent one (a `403` would confirm existence). A user may **not** rate their **own** recipe (`403 CANNOT_RATE_OWN_RECIPE` — the owner already knows it exists, so an explicit rejection leaks nothing). One rating per user per recipe; re-rating replaces. A tombstoned recipe is not rateable.

**Why trigger-maintained, not computed on read.** Reads (the Home widget + the recipe list, every session, every user) vastly outnumber writes (one rating per user per recipe). Computing the aggregate on read means a `GROUP BY` join on every list query forever; the denormalized column arrives free in the row the list already selects, stays sortable/indexable if rating-ordered browse is ever added, and — decisively — the trigger makes the aggregate **impossible for any write path to bypass**: the erasure worker's bulk delete and the recipe-delete FK cascade both re-derive it without touching application code.

**Two non-obvious correctness properties (both verified on PG 16).**

1. **Statement-level over a transition table, not row-level.** A bulk `DELETE FROM recipe_ratings WHERE user_id = :ownerId` fires the trigger **once** regardless of row count (`Trigger …: calls=1`), not once per row. Because PostgreSQL forbids transition tables on a multi-event trigger, there are **three** single-event triggers (INSERT / UPDATE / DELETE) sharing one function.
2. **The `FOR UPDATE` lock is the lost-update fix.** Without it, two users rating the same recipe concurrently under READ COMMITTED silently corrupt the aggregate (measured: `1 / 3.00` against a ground truth of `2 / 4.00`, never self-healing). Locking the affected recipes first, in `ORDER BY id` order (deterministic → no deadlock), forces the recompute onto a snapshot that sees the committed row.

**Alternatives rejected.**

- **Compute average/count on read (no denormalization).** Rejected: penalizes the dominant read path forever to save a once-per-write trigger; and leaves nothing to keep the aggregate consistent after bulk/cascade deletes.
- **Maintain the aggregate in the service layer.** Rejected: a write path can always forget to call it — precisely what the erasure worker's bulk delete and the FK cascade would do. The database is the only place that cannot be bypassed.
- **Row-level trigger.** Rejected: turns the erasure bulk delete into N trigger firings (a real perf cliff for a heavy rater).
- **Store the average as `0` when unrated.** Rejected: `0` renders as a genuine zero-star score. Unrated = `NULL` average + `0` count; a CHECK (`(rating_count = 0) = (average_rating IS NULL)`) makes the incoherent pairing unrepresentable.

---

## D-C — The PRO badge is DERIVED on projection, never stored

**Decision.** Expose a read-only `usesPremiumCapability: boolean` on the list and detail DTOs (rendered as "PRO"). It is **derived on projection**, from `visibility` + `sourceType`, by exactly one authoritative pure function `usesPremiumCapability()` in `@kitchensink/recipe-core`, called by both projections. No column, no entitlement model, no dependency on feature 010.

**The rule (and the trap it avoids).** A recipe uses a premium-only capability when it is **private AND its privacy was chosen rather than forced** — i.e. `visibility === 'private' AND sourceType ∈ {user_created, imported_public}`. The naive `visibility === 'private'` is wrong: per C-004, `imported_physical` and `imported_paid` recipes are private for **every** tier (their privacy is forced), so a free-tier user's OCR import would be falsely badged PRO. This is latent today — 004 has not shipped, so every row is `user_created` — which is exactly why it is encoded correctly now, while it costs nothing.

**Forward path.** When feature 010 ships real entitlements, this one function is the only thing that changes; no wire field, no client, and no stored value changes with it. That is the whole reason to expose it as a server-derived field rather than let clients compute it.

**Alternatives rejected.**

- **A stored `is_pro` boolean column.** Rejected: a second source of truth that drifts from `visibility`/`sourceType`, needs a migration and a write path, and duplicates knowledge that the row already carries.
- **`isPro = visibility === 'private'`, computed client-side.** Rejected: wrong for forced-private imports (badges a free user's data PRO), and duplicates the rule into every client where it will drift.
- **Model it against feature 010's entitlements now.** Rejected: 010 has not shipped; this would be a speculative dependency (YAGNI). The derivation is defined entirely by data 001 already owns.

---

## D-D — Home widgets for unshipped features 005–009 render as skeleton placeholders (amends FR-046 / R6)

**Decision.** Reverse the original "absent" rule. A widget whose backing feature (005–009) has not shipped is registered as a **skeleton placeholder**: the real widget's layout and shape, with **skeleton blocks in place of every data value**, and **no fabricated data**. The placeholder is rendered by the **host** from a static descriptor and **imports nothing** from the unbuilt feature package. When the feature ships, it registers its **live** descriptor under the **same widget id**, and **capability gating** swaps the placeholder for the live widget the moment the backing service is live — no client change. Placeholders cover **capability**-absence only: a widget gated out by **subscription tier** stays **absent** (a skeleton for a feature the user is not entitled to would mislead), and the per-widget **empty state** remains distinct (a _live_ widget with _no data_).

**The original R6 rationale is preserved, not violated.** R6 forbade absent widgets from being rendered because the render layer `import()`s each feature's widget module, and importing a non-existent package fails the build. A placeholder dissolves that objection by being drawn from a **host-owned** loader that imports nothing from the unbuilt package — so there is still no `import()` of a package that does not exist.

**Mechanism — spec follows the shipped code.** The Home-chrome engineer implemented this concurrently in `@commise/features-core` (`contract.ts`) as a **discriminated union** on `kind: 'live' | 'placeholder'`:

- `LiveHomeWidgetDescriptor` (`kind?: 'live'`, optional so a bare `{ id, load, defaultWeight }` stays valid) — eligible only when its `capability` **is** live;
- `PlaceholderHomeWidgetDescriptor` (`kind: 'placeholder'`, `capability` **required**) — eligible only when its `capability` is **not** live.

For any one capability the two arms are **mutually exclusive**, so a roadmap placeholder and the real widget registered under the same id can never both render, and the placeholder **self-supersedes** when the service deploys — no flag flip, no coordinated edit. `capability` being required on the placeholder arm makes "a placeholder that waits on nothing" (one that could sit on Home forever) unrepresentable rather than merely discouraged. Placeholder descriptors are declared in `roadmapWidgets.ts` (they cannot be colocated with a package that does not exist yet). `curateHomeWidgets` gates hidden → tier → capability, then orders by personalization then `defaultWeight`. The spec text (US-000, FR-046) was written to describe **this** mechanism.

**Also (D-D adjacent) — the list DTO needs `coverPhotoUrl` (FR-001c).** The Home recent-recipes widget and the recipe list grid render a card image. Photos hang off `RecipeDetail`, not the list `Recipe`, so without a cover field the widget would do an N+1 detail fetch per card. Add a **derived** `coverPhotoUrl` to the list projection: the recipe's photo with the lowest `sort_order`, resolved deterministically (ties broken by `created_at`, then `id`, so the same recipe yields the same cover across requests), via a single `LEFT JOIN LATERAL … LIMIT 1` — no N+1. A recipe with no photos **omits** the field (never a placeholder/stock URL; the client owns the no-image visual).

> **FOLLOW-UP-CR-001-A (named perf follow-up, NOT solved by this CR).** Photos are stored and served **unprocessed** — no resizing, no derived variants (ARCH-BE-3 / `data-model.md` § Photo Upload Flow). So `coverPhotoUrl` today is the **full-size original** (up to 5 MB) even when painted into a ~300 px 4:3 thumbnail; a 4-card Home widget can pull ~20 MB on first paint. This is a real regression risk against SC-009 and mobile data use. Tracked as **FOLLOW-UP-CR-001-A** (derived photo renditions / thumbnail variants); it must be resolved before the Home widget is considered release-ready on mobile.

**Alternatives rejected.**

- **Keep unshipped widgets absent (original R6).** Rejected: empty Home on first login; no sense of the product's shape. The technical reason for "absent" is fully addressed by a host-rendered skeleton.
- **Show the mockup's populated cards (sample data).** Rejected: fabricated data is indistinguishable from the user's own; a specimen "1,240 / 2,000 cal" is a lie the user will believe. This is the anti-constraint the whole placeholder design protects.
- **A separate boolean `isPlaceholder` flag beside a nullable loader.** Rejected in favour of the discriminated union the Home engineer shipped: the union makes "placeholder with no capability to wait on" and "live widget with no loader" unrepresentable, which a flag + nullable pair does not.
- **Put `coverPhotoUrl` on detail only and let the widget fetch detail per card.** Rejected: an N+1 on the most-hit screen in the product.

---

## Impact analysis — every artifact and package this CR touches

| Artifact / package                                  | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `spec.md`                                           | US-000 + Independent Test + acceptance scenarios amended for skeleton placeholders (scenarios 12–13 new); US1 scenarios 7–10 (difficulty, cover image, PRO); US2 scenarios 6–13 (ratings, ratings×erasure); **FR-001b** (difficulty), **FR-001c** (cover photo), **FR-003a** (derived PRO), **FR-013 / FR-013a / FR-013b** (ratings + aggregate + erasure), **FR-046** amended (skeleton placeholders); Rating key entity added, Recipe/Collection entities updated; **C-007** amended to three owner-scoped roots; Session 2026-07-16 clarifications block. |
| `data-model.md`                                     | `recipes.difficulty` (nullable, no default) + `average_rating` / `rating_count` + coherence CHECK; `recipe_ratings` table, indexes (incl. `idx_recipe_ratings_user_id` for the erasure sweep), and the 3-trigger `recipe_ratings_aggregate_refresh()`; cover-photo LATERAL + `idx_recipe_photos_recipe_cover`; derived read-model section (`usesPremiumCapability`, `coverPhotoUrl`); **erasure amendments** (below).                                                                                                                                        |
| `contracts/api.openapi.yaml`                        | `Ratings` tag; `PUT`/`DELETE /v1/recipes/{id}/rating`; `SetRecipeRatingRequest`; `difficulty` on `Recipe`/`CreateRecipeRequest`/`UpdateRecipeRequest` (3-state nullable on update); `averageRating`/`ratingCount`/`usesPremiumCapability`/`coverPhotoUrl` on `Recipe`; **drift reconciliation** (below).                                                                                                                                                                                                                                                     |
| `contracts/recipe.types.ts`                         | `RecipeDifficulty` enum + schema; `difficulty?` on `Recipe`/`CreateRecipeInput` and 3-state (`… \| null`) on `UpdateRecipeInput`; `averageRating?`/`ratingCount`/`usesPremiumCapability`/`coverPhotoUrl?` on `Recipe`; `usesPremiumCapability()` pure fn; `RecipeRating`, `SetRecipeRatingInput`; `CANNOT_RATE_OWN_RECIPE` error code.                                                                                                                                                                                                                       |
| `@kitchensink/recipe-service`                       | New `ratings` module (upsert/delete + visibility-derived authz returning 404-not-403 for unreadable); difficulty on create/update/detail; `usesPremiumCapability` + `coverPhotoUrl` on list/detail projections; migration adding the columns, `recipe_ratings`, both indexes, and the hand-authored trigger SQL.                                                                                                                                                                                                                                             |
| `@kitchensink/recipe-service-client` + hooks        | `setRecipeRating` / `deleteRecipeRating` methods + mutation hooks (cache-invalidate the recipe detail + any list/search rows); `difficulty` threaded through create/update inputs.                                                                                                                                                                                                                                                                                                                                                                           |
| `@commise/features-recipes`                         | Difficulty badge (label + color, NFR-004); star-rating display + control; PRO badge bound to `usesPremiumCapability`; card cover image from `coverPhotoUrl` with the no-image treatment. Web + `.native` parity (FR-044).                                                                                                                                                                                                                                                                                                                                    |
| `@commise/features-core`                            | Already shipped: the `kind: 'live' \| 'placeholder'` discriminated union, `isPlaceholderHomeWidget`/`isLiveHomeWidget`, inverse-capability gating in `curateHomeWidgets`, `roadmapWidgets.ts`. Spec now describes this mechanism.                                                                                                                                                                                                                                                                                                                            |
| Home host (web `next/dynamic`, mobile `React.lazy`) | Host-owned skeleton component + roadmap placeholder descriptors for 005–009; render swap driven by capability.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `@kitchensink/recipe-workers` (erasure)             | The erasure worker deletes the erasing user's `recipe_ratings` (third owner-scoped root); relies on the aggregate trigger to re-derive surviving recipes; MUST NOT disable the trigger (below).                                                                                                                                                                                                                                                                                                                                                              |

### Drift reconciliation folded into `api.openapi.yaml`

The yaml's `Recipe` schema had drifted from the shipped `@kitchensink/recipe-core` `Recipe`. Reconciled (the yaml is the law downstream builds from):

- **Split `Recipe` (metadata) from `RecipeDetail` (metadata + `ingredients`/`steps`/`photos`/`nutrition`).** The yaml previously inlined the cookable content on `Recipe` and returned it from list _and_ detail. Now list/search/collection-embedded return `Recipe`; the single-recipe operations (`get`/`create`/`update`/`clone`/`setVisibility`/`setRating`, and `restore`'s `recipe`) return `RecipeDetail` — matching the shipped client, whose `getRecipeById`/`createRecipe`/… are typed `Promise<RecipeDetail>` and whose `listRecipes` is `Promise<PaginatedResponse<Recipe>>`.
- **`version` → `currentVersion`** (matches shipped `Recipe.currentVersion`).
- **Added the missing shipped fields:** `sourceType`, `sourceUrl`, `sourceAttribution`, `clonedFromId`, `hasSubstantiveEdit`, `hasPartialNutrition`.
- **Ids.** Entity ids (`recipe.id`, `collection.id`, `photo.id`, `ingredient.id`) are genuinely server-generated **UUIDs** (`uuid('id').defaultRandom()` in the Drizzle schema), so `format: uuid` is retained and correct. `ownerId` / `createdBy` / rating `userId` are app-user **ULIDs** (from the token claim, `varchar(255)`, no FK) and are plain `type: string` with no `format` — as they already were. (The initial CR framing "ids are ULIDs" was imprecise; only the app-user ids are ULIDs, and those were already modelled correctly.)

### GDPR erasure path (C-007 / ADR-0005) — three amendments folded in

1. **`recipe_ratings.user_id` is a third owner-scoped erasure root.** Alongside `recipes.owner_id` and `collections.owner_id`. Ratings are authored by the **rater**, so they routinely live on **other users' recipes**, which **survive**. The worker `DELETE FROM recipe_ratings WHERE user_id = :ownerId` (using `idx_recipe_ratings_user_id`), and the aggregate trigger re-derives `average_rating`/`rating_count` on each affected surviving recipe. The worker **MUST NOT** disable the trigger for speed — doing so would leave other users' recipes holding permanently wrong aggregates with nothing to repair them; it is not needed anyway (the trigger is statement-level → one firing for the whole bulk delete). Deleting the erasing user's own recipes cascades to ratings other users left on them — correct, the rated recipe ceases to exist.
2. **Rows-first, then S3 — and the owner-prefixed key scheme (was stale against ARCH-BE-3).** The prior prose prescribed S3-before-rows and a row-enumerated key scheme (`photos/{recipe_id}/`, `versions/{recipe_id}/`). Both predate ARCH-BE-3, which owner-prefixes every key (`recipes/{ownerId}/…`, built only via `@kitchensink/recipe-core`'s `recipeObjectKeys`). With owner-prefixed keys the S3 sweep is a pure prefix scan that never reads the DB, so deleting rows first is strictly better (the reverse leaves live rows pointing at deleted objects). Both the key scheme and the step order are corrected in `data-model.md`.
3. **Who writes `failed` — the worker deliberately does not.** On error the erasure worker records `attempts`/`last_error`, **leaves the job `running`**, and rethrows for SQS redelivery. Writing `failed` inside the worker would (a) drop the job out of the `queued`/`running` set the cron sweeper re-drains, and (b) free the `idx_erasure_jobs_active_owner` partial unique index so a re-POST inserts a second active job that the original retry then crashes on. `failed` is terminal-until-retry, written from exactly one place **outside** the worker — the T136b DLQ path (in flight). The C-007 idempotency contract (a `failed` job → fresh POST returns 202 + re-enqueue) is unchanged and correct; this note records the _writer_, which was previously unstated and made the `failed` path read as reachable when no code produced it.

---

## Consequences

**Positive**

- The mockups are reconcilable with the shipped design with **zero fabricated data** and **no premature entitlement model**.
- Difficulty, PRO, and cover are all either honest-nullable or derived-on-read → no drift, no extra write path, one authoritative rule each.
- The rating aggregate is correct by construction under concurrency, bulk delete, and cascade — because the database, not application code, owns it.
- Home lights up meaningfully on first login and self-upgrades as 005–009 ship, with no client change.
- The contract now matches shipped reality (`Recipe`/`RecipeDetail` split, `currentVersion`, source fields), so downstream codegen stops drifting.

**Negative / costs**

- `coverPhotoUrl` ships a full-size original into a thumbnail until **FOLLOW-UP-CR-001-A** lands — a real mobile-data / SC-009 risk, accepted only as an interim.
- The rating aggregate carries a `FOR UPDATE` serialization point per rated recipe (correct, and cheap at this write rate; revisit only if a single recipe becomes a rating hot-spot).
- One more owner-scoped root on the erasure critical path — more to get exactly right, mitigated by the trigger doing the aggregate repair automatically.
- Three single-event triggers instead of one (a PostgreSQL transition-table constraint), which future readers must not "simplify" into a multi-event trigger.

## Hand-off

- **Backend (`be-1` / `staff-engineer`):** the `ratings` module + migration (columns, `recipe_ratings`, indexes, hand-authored trigger SQL), difficulty on create/update, `usesPremiumCapability` + `coverPhotoUrl` projections. Erasure worker (`@kitchensink/recipe-workers`) gains the ratings root — coordinate with the T136/T136b owners.
- **Frontend (`fe-1`):** difficulty badge, star rating display + control, PRO badge, card cover — web + `.native` parity. Home host: skeleton component + roadmap placeholder descriptors, consuming the shipped `@commise/features-core` union.
- **Review:** `sec-aud-1` for the rate-what-you-can-see IDOR boundary (404-not-403 for unreadable recipes) and the rater-from-token rule; `db-arch-1` for the trigger + lock; `qse` for the concurrency and erasure×ratings test tiers.

Confidence: High on D-A/D-B/D-C and the erasure amendments (grounded in the shipped schema, trigger behavior verified on PG 16, and the shipped client's return types). High on D-D's mechanism (read directly from the shipped `contract.ts`). Medium only on FOLLOW-UP-CR-001-A's urgency, which depends on real photo sizes in production.
