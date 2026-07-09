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
- [x] **(P2, ADV-3/F2) `create` bypassed the C-004 visibility policy.** `create` persisted `dto.visibility ?? 'public'` with no gate → a free-tier user could POST `visibility:'private'` (violated FR-003). **FIXED:** `create` now takes the full `Principal`, derives `isPremium` from `permissions`, and runs the same pure `evaluateVisibility({sourceType:'user_created', hasSubstantiveEdit:false, requested})` the set-visibility endpoint uses — free-tier `private` → `INVALID_VISIBILITY` (400) *before* any persistence; premium `private` allowed. Proven by 4 unit tests (free-tier private rejected + DAL never called; premium private persists; premium-in-scopes-not-permissions still rejected) + an end-to-end integration test (free-tier `POST {visibility:'private'}` → 400 + 0 rows; public → 201). Remove the gate → the rejecting tests resolve and fail.
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

## Tier 4 — Architecture / cross-package (four-front adversarial architecture audit, 2026-07-09)

Product of four parallel architecture auditors (frontend, recipe-backend, platform-services, infra/tools),
each asked to challenge every decision against DRY/KISS/YAGNI and `ENGINEERING_EXCELLENCE.md` and to name a
*present* cost (no speculative rework). The through-line: **one design decision re-encoded in N places that
have already drifted**, plus a few genuine YAGNI over-builds and missing current-requirement robustness. Ranked
by concrete cost. Each carries the auditor tag `(ARCH-FE/BE/PS/IT-#)`.

### 4a — Duplication that has ALREADY diverged (highest leverage; each is a live or latent bug, not a style nit)

- [ ] **(P1, ARCH-BE-3/ARCH-IT-1) S3 version-archive key scheme forked 4 ways → GDPR erasure misses in-service archives.** `versions.service.ts:40` writes `recipes/{recipeId}/versions/{versionNumber}.json` (no owner segment); `version-archive-worker.ts:39` writes `recipes/{ownerId}/{recipeId}/versions/{versionId}.json`; photos use `recipes/{ownerId}/{recipeId}/photos/…`; erasure sweeps `recipes/{ownerId}/`. In-service archives are **not** under any owner prefix → survive erasure (dupes Tier-1 verticals-8, now confirmed by two independent auditors). *Fix:* one `recipeObjectKeys` module in `recipe-core` owning the single `recipes/{ownerId}/{recipeId}/…` scheme; every writer + the erasure prefix import it; one test binds all call sites to the oracle.
- [ ] **(P1, ARCH-PS-1) Identity never adopted `@kitchensink/clerk-verify` — the security-sensitive drift it exists to prevent has occurred.** `identity/auth/clerk-auth.service.ts:66-116` is a verbatim copy of the shared verifier and has already diverged (shared surfaces `userId`/`azp`, identity's copy doesn't). *Fix:* delete identity's inline verification, delegate to `verifyClerkToken` exactly as recipe does; keep `resolveOrCreateFromClaims` in identity.
- [ ] **(P1, ARCH-PS-2) Three different HTTP error envelopes across the three sibling services.** recipe = `{code,message,details}` (matches the doc); food = Nest default `{statusCode,message,error}` (inline `mapWriteError`, no global filter); identity = Nest default (Sentry filter only). A client can't write one error handler; this is a wire contract clients depend on. *Fix:* promote recipe's `ApiExceptionFilter` into a shared `@kitchensink/nest-error-envelope` and register in food + identity.
- [ ] **(P2, ARCH-BE-1/ARCH-PS) OpenAPI wire contract is hand-transcribed in 3 places and the server copy has drifted on ≥3 endpoints (photos confirm `s3Key` vs `key`; versions UUID vs integer; search `{recipe,rank}` vs `Recipe[]`) — broken end-to-end with the real client.** (Overlaps Tier-1 verticals-2/6/7.) *Fix:* make one artifact authoritative — generate client types + server DTOs from `api.openapi.yaml` (or derive both from the recipe-core zod) + one contract test per endpoint driving the real `RecipeServiceClient` against the booted app.
- [ ] **(P2, ARCH-PS-6/ARCH-BE-8) DB `pool-config.ts` copied verbatim food↔recipe (IAM signer, TLS posture, local branch); identity is a third, non-IAM approach; S3-client construction duplicated 3 ways.** *Fix:* shared `@kitchensink/rds-iam-pool` helper parameterized by role/db-name; one config-driven S3-client factory. (Identity's password→IAM migration is tracked separately — don't force it here.)
- [ ] **(P2, ARCH-FE-2) Two divergent hand-written API clients (web PATCHes `/v1/users/me`, mobile PATCHes `/v1/profiles/me`) — already drifted, breaks the cross-platform-parity rule.** *Fix:* one shared typed client in a `@commise/*` package consumed by both apps.
- [ ] **(P2, ARCH-IT-2) `@kitchensink/esbuild` is an unused shell while 4 bundlers hand-roll `esbuild.build` — and the target has drifted (recipe-workers `node24` vs three others `node22`, a runtime-reject risk).** *Fix:* route the four `esbuild.mjs` through the shared tool (extended for the dist-package.json + migrations-copy + banner they need), or delete the shell and extract the one helper they actually share.
- [ ] **(P3, ARCH-BE-5/ARCH-PS-11) `ownerIdOf(req)` duplicated across 4 recipe controllers; `extractBearer`/`parseCommaList` re-defined in 4 auth files.** *Fix:* one `@OwnerId()` param decorator; co-locate the bearer/comma-list parsers with `clerk-verify`. Standardize the request key (`req.principal` vs `req.user`).
- [ ] **(P3, ARCH-BE-6) Domain-error raising non-uniform: `CollectionError` is a straight duplicate of `RecipeDomainError`; `ingredients.service.ts:223` throws a plain object literal (no stack); collections/photos throw framework `NotFoundException` → escapes the `{code,…}` envelope.** *Fix:* collapse to one throwable; route "not found" through a domain code. (Feeds ARCH-PS-2.)
- [ ] **(P3, ARCH-FE-1, ARCH-BE-7) Design tokens duplicated `ui/src/tokens/colors.ts` ↔ `mobile/tamagui.config.ts`; visibility/added-via value sets defined 3+ ways (recipe-core zod vs `COLLECTION_VISIBILITIES` vs DB CHECK string).** *Fix:* single source imported by the consumers; DB CHECK asserted against the constant in a schema test.

### 4b — YAGNI over-build (delete or wire; carrying cost with no caller)

- [ ] **(P1, ARCH-FE-4/5/8/11) The ditox Home-widget architecture in `features/core`/`features/recipes` is fully built and wired into NOTHING** — grep for `ditox|appShell|homeWidget|curateHomeWidgets` in web/mobile is empty; the apps don't even depend on the feature packages and render hardcoded content. Byte-identical `.native` widget shells; a not-type-safe loader seam (`() => Promise<{default: unknown}>`); a dead unreachable `AuthState.error` variant. Textbook "framework for zero callers." *Decision:* wire the apps to the widget surface (make it real) **or** delete the speculative framework until a second caller exists; either way remove the `unknown` loader and dead variant.
- [ ] **(P2, ARCH-PS-5) Recipe's config subsystem is a 610-line framework with dead machinery while identity/food use a 5-line `EnvironmentSchema.parse`.** The SSM async path is unreachable (module calls the sync overload); `ConfigFieldMeta.secret`/`ssmKey`, `CONFIG_SOURCES`, `cacheTtlSeconds` are read nowhere; `DATABASE_POOL_SIZE`/`DATABASE_IDLE_TIMEOUT_MS` are validated but ignored (pool hardcodes `max:20`) → creates the *illusion* of a 50-conn pool. *Fix:* collapse to the identity/food shape; delete the dead SSM/meta/source machinery; either wire the pool knobs or drop them.
- [ ] **(P2, ARCH-BE-2/4/10) Versions vertical inert (dupes Tier-1 verticals-1); two competing version-archive mechanisms (durable outbox types + worker exist only as types, the wired path is best-effort inline that swallows S3 errors); `AccountModule` is `@Module({})` while its `POST /v1/account/erasure` client method + worker ship unreachable.** *Fix:* pick one archive mechanism and delete the other; implement the erasure controller or remove the half-vertical's client surface.

### 4c — Missing current-requirement robustness (not speculative — required now)

- [ ] **(P1, ARCH-PS-3) No readiness/dependency health check in ANY service — `/health` returns static `{status:'ok'}`, so the ALB routes traffic into DB-dead instances** (same silent-failure class as the sandbox crash-loop). *Fix:* split liveness (static) from readiness (cheap `SELECT 1` + timeout → 503); one shared `HealthModule` factory across the three services.
- [ ] **(P1, ARCH-PS-4) `FoodServiceClient.send()` has no timeout/AbortController — and recipe's ingredient path calls it, so a hung food-service hangs recipe's request handling unbounded.** The USDA client 200 lines away does this correctly. *Fix:* add `timeoutMs` + `AbortController`, map abort → `FetchUnavailableError`. (Retries/breaker are a fair defer; the timeout is not.)
- [ ] **(P2, ARCH-IT-4/7) IAM over-grant: both service task roles grant `secretsmanager:GetSecretValue` on `resources:['*']`; one `webhooksRole` grants the union of all perms to 4 distinct lambdas.** `sandbox-scheduler-stack.ts` is the correct least-privilege template. *Fix:* scope secret ARNs (likely delete the manual `['*']` stmt — `taskDefinition.secrets` already emits a scoped grant); split a slim migration-lambda role.
- [ ] **(P2, ARCH-PS-8) Reconciliation backstop loads the entire Clerk directory into memory and processes O(n) sequentially** — latent scaling cliff on the exact component whose non-execution already caused a prod user-create gap. *Fix:* paginate `listUsers()` + bounded batches; confirm the schedule/alarm exists.
- [ ] **(P3, ARCH-FE-3) Cross-platform parity break: suspended/blocked/impersonation auth UX is mobile-only** — a security-relevant state the web app silently omits. *Fix:* lift the state handling into shared logic; render on both.

### 4d — Lower-cost consistency / dead code (mechanical)

- [ ] **(P3, ARCH-IT-3) `@kitchensink/vitest` preset adopted only by the 3 placeholder packages; 6 real suites hand-roll config; preset sets `globals:true`, contradicting the "always import from vitest" house rule.** *Fix:* make `baseConfig` the real base (include-override + CI-timeout headroom + integration/e2e excludes), adopt in the 6, drop `globals:true`.
- [ ] **(P3, ARCH-IT-6) Lambda asset-probe ("2-vs-3-levels-up dist-lambda" + placeholder) duplicated in 3 stacks with inconsistent missing-asset semantics (scheduler throws — correct; data/food return a silent no-op that can ship a broken deploy).** *Fix:* one `resolveLambdaAsset(url,{onMissing})` helper; default to throw.
- [ ] **(P3, ARCH-IT-8) Dead imported constructs in `webhooks-stack.ts:71-81` (instantiated, discarded); `tools/typescript/package.json` exports `./test.json` which doesn't exist (hard-fails any workspace that extends it).** *Fix:* delete the imports; add or remove the export.
- [ ] **(P3, ARCH-IT-9/ARCH-PS-9/10) `process.env` dot-notation in `infra/global/bin/app.ts` + identity DB/queue modules (house rule = bracket-only); `FOOD_MAX_BATCH_NAMES` default `100` duplicated in service + schema, service copy skips Zod (→ `NaN` on bad input).** *Fix:* bracket-notation; source the cap from validated `Environment`; route identity DB config through its own `EnvironmentSchema`.

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

## Stryker mutation baseline (objective test-rigor measure — 2026-07-09, commit c7a99e2)

`npm run test:mutation --workspace=@kitchensink/recipe-service` (vitest runner, unit config → no Docker),
scoped to `recipes/domain/**`, `recipes.service.ts`, `photos.service.ts`. **Baseline: 63.4% mutation score,
135 surviving mutants** — objective proof of the "tests only scratch the surface" finding (a surviving mutant =
a bug the current tests cannot see):

| File | Score | Survived | Read |
| --- | --- | --- | --- |
| `recipes.service.ts` | 60.7% | 77 | mapping/branch logic barely asserted |
| `photos.service.ts` | 63.8% | 49 | ownership/cap/error branches under-tested |
| `recipes/domain/visibility-policy.ts` | 78.6% | 9 | the one deep module — still not airtight |

Target **≥80%** overall (a rigorous suite). The surviving-mutant list is the *concrete* worklist backing
Tier 2 — each Tier-2 hardening should kill a named cluster of these mutants. Re-run after each batch and record
the delta; do not mark Tier 2 done until the score clears 80% and no *correctness* mutant survives.

## What is genuinely well-built (per the honesty standard — do NOT "fix" these into churn)

All four auditors independently flagged real strengths; recording them so the loop doesn't rewrite sound code:
the **C-004 `visibility-policy.ts`** pure evaluator (one genuinely deep domain module, reused by create/clone/
set-visibility); the **optimistic-concurrency CAS** + re-read to distinguish 409-vs-404 (Tier-0 #1, now proven);
the **`PhotoStoragePort` hexagonal seam** and the **exhaustive `RECIPE_ERROR_STATUS` record** that fails
compilation on an unmapped code; the **webhook dedup-race redesign** (confirm-after-process on the `svix-id` PK,
idempotent handlers, no pre-claim so poison payloads retry visibly); the **USDA client** (timeout + body-read
inside the deadline + schema-vs-transport error split — the reference the food client should copy); and the food
stack's **pure, tested routing/priority/DB-name functions**. The findings above are about consistency,
dependency direction, and un-generated contracts — not the core logic.

## How to run the loop to completion

1. Work Tier 0 → Tier 1 → Tier 2 → Tier 3 → Tier 4, each fix with a test that **fails if the bug is present**.
   Tier 4's cross-package consolidations (shared error envelope, `clerk-verify` adoption, health/readiness,
   `rds-iam-pool`) are the highest-leverage because each kills an entire *class* of future drift.
2. Stryker is **stood up** (baseline above). Drive surviving mutants to zero on the domain logic; extend `mutate`
   globs to the DAL query builders and the other services as their tests harden. Re-run per batch, record delta.
3. Re-run the adversarial audit; the loop is done when a genuinely adversarial reviewer, trying hard to break it,
   finds nothing substantive. **This is a multi-iteration loop, not a one-pass sweep** — iteration 1 (2026-07-09)
   built the objective instrumentation (ENGINEERING_EXCELLENCE bar, DRY/KISS/YAGNI directives, Stryker, this
   backlog) and fixed the P1 lost-update exemplarily; ~42 findings remain queued here.
