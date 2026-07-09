# Recipe-service quality remediation backlog

Product of an **adversarial** three-front audit (two correctness reviewers + one test-quality reviewer,
each instructed to assume the code is fragile and prove it) measured against
[`docs/engineering/ENGINEERING_EXCELLENCE.md`](../../docs/engineering/ENGINEERING_EXCELLENCE.md). Every
item below is a *verified* defect or a *demonstrated* weak test (with the specific mutation it fails to
catch), not a style nit. This is the "loop until none of it is true" worklist; work it top-down and
**each fix ships with a test that would fail if the bug were present.**

**Premise check.** The claim "if-statements without braces / doesn't follow style" did **not** hold —
0 brace-less blocks, no `any`/`@ts-ignore`, clean imports (ESLint/oxlint/prettier enforce it). The
claims "many bugs" and "tests only scratch the surface" **did** hold, decisively — see below.

## Status legend
`[x]` fixed + proven · `[ ]` open · `(Pn)` severity · `(F#)`/`(ADV-#)` audit id.

---

## Tier 0 — Live correctness/security bugs (fix code + add mutation-killing test)

- [x] **(P1, ADV-1/F15) Lost update: optimistic concurrency was a non-atomic TOCTOU.** `RecipesDal.update` WHERE had no version predicate → two same-base PATCHes both commit, no 409. **FIXED (eeb8b78):** atomic CAS `current_version = expectedVersion`; 0-row → re-read → truthful 409/404. Proven by `concurrent-update.integration.spec.ts` (racing PATCHes → exactly one 200 + one 409, winner persists; drop the predicate → 200/200 fails it).
- [ ] **(P2, ADV-3/F2) `create` bypasses the C-004 visibility policy.** `recipes.service.ts:~189` persists `dto.visibility ?? 'public'` with no `evaluateVisibility` gate → a free-tier user can POST `visibility:'private'` (violates FR-003 "free-tier recipes are always public"). *Fix:* run `evaluateVisibility({sourceType:'user_created', isPremium, hasSubstantiveEdit:false, requested})` on create and reject with `INVALID_VISIBILITY`, or force-normalize to public. *Test:* free-tier `POST {visibility:'private'}` → 400/normalized; premium → allowed.
- [ ] **(P2, ADV-4/F1) Collection reads leak other users' PRIVATE recipes (IDOR + stale visibility).** `collections.dal.findActiveRecipe`/`listRecipes` filter only `deleted_at IS NULL` — no owner/visibility predicate. A user can add anyone's recipe id to their own collection and `GET /collections/{id}` returns its full body; and a recipe flipped to private after being added stays visible. *Fix:* scope both to `visibility='public' OR owner_id = <caller>`. *Test:* `addRecipe(OWNER, ownCollection, OTHERS_PRIVATE_ID)` rejects; a recipe made private after add drops from the collection listing.
- [ ] **(P2, ADV-2) Search text is client-poisonable / diverges from the catalog name.** `ingredient_names_text` (feeds `search_vector`) is built from the client DTO `name`, while the junction persists the catalog `ingredient.name` → recipe displays "All-purpose flour" but is indexed under whatever string the client sent. *Fix:* build `ingredientNamesText` from the resolved lines' `ingredientName`, not `dto.name`. *Test:* create with `name:'flr'` for a Flour id → search 'flour' finds it; `ingredient_names_text` equals the catalog name.
- [ ] **(P2, verticals-3) Search facet sample is nondeterministic.** Facet CTE `ORDER BY rank DESC LIMIT 200` with no tiebreak, and `rank` is constant 0 in browse mode → arbitrary 200-row sample, facet chip counts flicker between identical requests and reflect a different slice than the page. *Fix:* add a deterministic tiebreak (`created_at DESC, id`). *Test:* two identical browse searches with >sample rows → identical facet counts.
- [ ] **(P2, verticals-5/F8) Photo `reorder` accepts a non-permutation and corrupts `sortOrder`.** `photoIds:['C']` on a 3-photo recipe sets C=0 and leaves A=0 → duplicate sort orders; duplicate ids compound it. *Fix:* require `photoIds` to be a full, duplicate-free permutation of the recipe's current photos; reject otherwise. *Test:* partial list → 400/no-op; duplicate id → 400; full permutation → round-trips.
- [ ] **(P3, verticals-9) Search maps null `servings` to 0, violating `recipeSchema` (`positive`).** `rowToRecipe: servings: row.servings ?? 0` → a null-servings recipe surfaced by search fails `recipeSchema.parse` on any client. *Fix:* preserve `null` (the schema/response already allows nullable times/servings). *Test:* search a null-servings recipe → response `servings` is null and parses.
- [ ] **(P3, ADV-5) Catalog dedup is a read-then-insert race with no unique constraint.** Concurrent `createFreeform`/`createFoodBacked` both miss the SELECT and both INSERT → duplicate catalog rows for the same `food_id`/name. *Fix:* add `UNIQUE (food_id) WHERE food_id IS NOT NULL` and `UNIQUE (lower(name)) WHERE is_user_entered` (migration) + `INSERT … ON CONFLICT DO NOTHING` then re-select. *Test:* two concurrent adds of the same food → one row.

## Tier 1 — Larger / architectural (decision + scope)

- [ ] **(P1, verticals-1) Versions vertical is inert — no snapshot is written on create/update.** `createSnapshot` is only called by `restore`, so `GET /versions` is always `[]`, `restore` always 404s, retention never runs. *Fix:* wire snapshot-on-save (RecipesService → VersionsService.createSnapshot on create/update). Note the `RecipesModule ↔ VersionsModule` cycle — resolve with `forwardRef` or an event/outbox. *Test:* create→edit×3→`GET /versions` returns the history; restore round-trips. (Previously deferred as Phase-4.5; it is a real functional gap.)
- [ ] **(P1/P2, verticals-2/6/7) Endpoints diverge from `contracts/api.openapi.yaml`.** versions addressed by UUID `versionId` vs spec integer `versionNumber`; search `results` wrapped as `{recipe,rank}` vs bare `Recipe`, missing `cuisine` facet, `sortBy` enum mismatch (`recent|title` vs `newest|updatedAt|prepTimeAsc|totalTimeAsc`); photo `upload-url` returns `s3Key`/`maxBytes` vs spec `key`/`expiresIn`; `restore` returns raw `RecipeVersion` vs `{recipe, restoredFromVersion, currentVersion}`. *Decision needed:* which is authoritative (001 contracts are under RECONCILIATION). Then reconcile impl↔spec and add **contract-conformance tests** asserting responses against the OpenAPI schemas.
- [ ] **(P2, verticals-4) Presigned upload is overwrite-capable for its TTL (post-confirm re-upload).** A client can confirm a valid small JPEG then re-PUT arbitrary/oversize content to the same key within 900s; CloudFront serves it unvalidated. *Fix options:* copy-to-immutable-key at confirm, content-hash pin, or a single-use/short-TTL upload token. *Test:* re-PUT after confirm → served object still matches the validated one (or the stale key 404s).
- [ ] **(P2, verticals-8) Version archives survive GDPR erasure.** Archives are written under `recipes/{recipeId}/versions/…` in `S3_BUCKET_VERSIONS` with no owner segment, but the erasure worker only deletes `recipes/{ownerId}/` in `RECIPE_MEDIA_BUCKET`. Also two archive key schemes disagree (`versionNumber` vs `versionId`). *Fix:* unify the key scheme with an owner segment and have erasure sweep the versions bucket. *Test:* integration — erasure removes version-archive objects. (Erasure worker is a Phase-4.5 stub — see residual risks.)

## Tier 2 — Weak tests that let real mutations ship green (harden to mutation-resistant)

- [ ] **(F3) `ClerkAuthService` has ZERO tests** — `authorizedParties=[]` disables azp enforcement entirely and ships green on a public-ALB service. Add a unit test (mock `@kitchensink/clerk-verify`) asserting the allowlist + jwtKey are forwarded and any throw → `UnauthorizedException` with no leaked reason.
- [ ] **(F4, F19) `recipes.dal` predicates never asserted** — dropping `owner_id` (cross-tenant IDOR) or `deleted_at IS NULL` (tombstone resurrection) passes; `currentVersion +1` only asserted to *exist*. The fake-DB records WHERE args but never inspects them. Assert the recorded predicates; add tombstone-excluded + version-increment cases.
- [ ] **(F5) No cross-user IDOR integration spec** — B reading A's private (expect 404), PATCH/DELETE/clone (expect 403), A's public (expect 200). Invert the `visibility !== 'public'` guard and nothing fails.
- [ ] **(F6) `setVisibility` premium path executed by nothing** — only free-tier deny runs. Unit-test (fake DAL): premium + imported_public + substantive → `dal.setVisibility` called; free → `INVALID_VISIBILITY`; non-owner → `NOT_OWNER`; assert `isPremium` derives from `permissions` (not `scopes`).
- [ ] **(F7) Version restore lineage/IDOR unasserted** — restore test asserts only `createSnapshot` called once; pin `baseVersion`, `expectedVersion`, `changeSummary`, snapshot payload; add foreign-`versionId` → `RECIPE_NOT_FOUND`. (Blocked partly on Tier-1 versions wiring.)
- [ ] **(F8) Photo delete/reorder recipe-scoping proven only against a WHERE-ignoring fake DB** — add integration asserting cross-recipe delete/reorder is impossible.
- [ ] **(F9) Clone visibility RESET not actually tested** — both cases use a source whose own visibility already equals the expected default. Clone an `imported_public` source that is currently `private` → assert clone is `public` (kills "copy source visibility" mutation).
- [ ] **(F10) Photo cap boundary + size cap** — no `count=9` (legit 10th must succeed) test; `409 MAX_PHOTOS_EXCEEDED` and `413` (>5 MB) asserted in no integration test. Add: 10 succeed, 11th → 409 `details.limit===10` + no row; >5 MB → 413.
- [ ] **(F11) Substantive-edit clause coverage** — untested branches: array-length change (add/remove line), reorder, unit-only, notes-only, ingredientId swap (flour→sugar), timerSeconds-only; and assert the flag is *persisted*, not just present in mock call args.
- [ ] **(F12) Ingredient `sortOrder` never tested with >1 line** — use ≥3 ingredients whose author order differs from id/alpha order; assert positions round-trip (kills `sortOrder:0`/drop-orderBy mutations).
- [ ] **(F13) Search relevance ORDER never asserted** — `ORDER BY rank DESC → ASC` passes every test. Seed strong+weak matches, assert `results[0]` is the strong one; assert TITLE/RECENT order behaviorally (not SQL substring).
- [ ] **(F14) Clone content fidelity + "original never mutated"** — assert `timerSeconds`/`quantity`/`unit`/`displayText`/`sortOrder` copied, and `update`/`setVisibility`/`softDelete` on the source `.not.toHaveBeenCalled()`.
- [ ] **(F16) `recipe-core` validators: 1 of ~26 tested** — add `positiveNumberSchema` (qty > 0), `title.min(1)`, `expectedVersion`, search `page/pageSize`. Mutate `.positive()`→`.nonnegative()` and qty 0 currently passes.
- [ ] **(F17) `load-config` DB-union: only URL happy-path** — add discrete `DB_*` arm (deployed path), neither-arm rejection, invalid `DATABASE_URL`.
- [ ] **(F18) `api-exception.filter` maps 11 of 12 codes; backstop only asserts `typeof status === number`** — add `UNKNOWN_INGREDIENT`; assert the actual status per code + the `{code,message,details}` body shape.
- [ ] **(F20) Search filters `ingredientIds`/`tags`/`maxPrepTime`/`cuisine` have zero behavioral coverage** — only `dietaryFlags`; `ingredientIds` cross-table `EXISTS` asserted by SQL substring only.
- [ ] **(F21) `updateResolution` COALESCE untested** — drop COALESCE and an omitted nutrient nulls prior data. Assert partial-nutrition update preserves existing values.
- [ ] **(F22) `schema.test.ts` pins columns but no PK/FK/composite-PK/defaults/indexes** — dropping `owner_id` index passes. Add constraint/index assertions or a migration-drift check.
- [ ] **(F23, F25) DTO/`ParseUUIDPipe` validation unexercised; controllers are delegation theater** — send non-UUID ids, empty `photoIds` (`@ArrayMinSize(1)`), missing required fields; controllers assert `toHaveBeenCalledWith` only.
- [ ] **(F24) Photo `headSize()===undefined → 422` branch untested.**

## Tier 3 — CI / harness integrity

- [ ] **No `e2e-recipe` CI job** — `vitest.e2e.config.ts` + `health.e2e.spec.ts` never run in CI (no `test:e2e --workspace=@kitchensink/recipe-service` in `_ci.yml`); the CLAUDE.md "services require e2e" mandate is unmet for recipe. Add the job.
- [ ] **Integration lane can silently vanish** — `_ci.yml` uses `--if-present` + `passWithNoTests:true`; a rename/glob-break goes green with zero integration tests. Add a "≥N specs ran" floor.
- [ ] **k6 load lane not run in CI** (tracked separately — needs standalone-boot packaging).

## Residual risks (verify → fix or accept with rationale)

- Account-erasure worker `eraseRecipeRows` is a no-op stub yet logs "recipe account data erased" — false success signal (Phase-4.5).
- `version-archive-worker` stamps `archivedAt = new Date()` per invocation → not byte-idempotent under SQS at-least-once redelivery.
- Both workers process records serially and throw on first failure with no `ReportBatchItemFailures` → one poison message re-drives the whole batch.
- Photo advisory lock uses 32-bit `hashtext(recipeId)::bigint` → distinct recipes can share a lock key (contention only, not incorrectness).
- `restore` re-resolves ingredients through the live catalog → restoring a snapshot whose ingredient was later removed fails `UNKNOWN_INGREDIENT` instead of restoring the historical line.

---

## How to run the loop to completion

1. Work Tier 0 → Tier 1 → Tier 2 → Tier 3, each fix with a test that **fails if the bug is present**.
2. After a batch, **stand up Stryker mutation testing** on the pure domain logic (`recipes/domain`, DAL query builders, services) and drive surviving mutants to zero — that is the objective proof the tests exercise the code, not just cover it.
3. Re-run the adversarial audit; the loop is done when a genuinely adversarial reviewer, trying hard to break it, finds nothing substantive.
