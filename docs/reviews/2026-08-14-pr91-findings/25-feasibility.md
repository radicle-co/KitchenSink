# 25 — Feasibility review: can PR 91 be built as described?

**Date**: 2026-08-14 · **Mode**: REVIEW, read-only · **Branch**: `chore/code-quality-enforcement-phase-1-2`
**Posture**: default to "this will not work as described"; where it does work, say so plainly.
**Method**: every claim below was re-verified against the code or the CDK source. Claims taken from reports
11–15 are marked as such and carry their source. **No database was connected to and no AWS API was called.**

**Scale note before anything else.** `git diff --stat main...HEAD` reports **1,264 files changed,
+132,314 / −17,917** — not 90. The 90 was the working set at one moment; the branch's real delta versus
`main` is three orders of magnitude past a reviewable PR. The standing directive is to land on the open
branch, so the lever is **ordering within the branch** (phased commits, each green), not new PRs. That
ordering is the single highest-value thing this review produces, and it is in "Recommended order of work".

---

## Hard blockers

### HB-1 — The message substrate names four properties that nothing in this repo provides, and the plan names no technology

The plan's substrate is "durable, grouped by entity, guaranteed delivery, latest-message-in-group wins".

**What actually exists**, verified:

- An EventBridge bus **is provisioned**: `new events.EventBus(this, 'FoodEventBus', { eventBusName:
'kitchensink-food-{stage}' })` — `packages/services/food-service/infra/lib/food-service-stack.ts:266`.
- It is **granted to all three task roles**: `eventBus.grantPutEventsTo(apiTaskRole|workerTaskRole|
changeRefreshTaskRole)` — `food-service-stack.ts:366`, `:431`, `:492`.
- The bus name is in the container env: `FOOD_EVENT_BUS_NAME: eventBus.eventBusName` — `:284`.
- The runtime **never uses it**. `@aws-sdk/client-eventbridge` is a dependency of **no** `package.json`
  (grep across the repo, zero hits — confirms 12/A-4). The only `EventBus` implementation is
  `ConsoleEventBus` (`packages/services/food-service/src/events/food-event-emitter.ts:202-215`), and it is
  the one wired: `events: new FoodEventEmitter(new ConsoleEventBus(), …)` —
  `packages/services/food-service/src/worker/main.ts:64`. Today every food domain event is a `console.info`.

**Why the properties don't follow.** The stack's own comment states the design: _"there is deliberately NO
rule consumer on the bus right now"_ (`food-service-stack.ts:263-265`). EventBridge **discards** an event
with no matching rule — so as provisioned it is not durable, has no grouping, no delivery guarantee and no
supersession. Adding a rule → SQS target buys durability and (with FIFO) grouping and ordering. It does
**not** buy "latest-message-in-group wins": that is log compaction, and no primitive in this stack has it.

The four properties are jointly satisfiable in at least four shapes, each with a different cost, test story
and failure mode:

| Shape                                                     | Durable        | Grouped       | Guaranteed    | Latest-wins              | Cost here                |
| --------------------------------------------------------- | -------------- | ------------- | ------------- | ------------------------ | ------------------------ |
| Transactional outbox (`UPSERT` on entity key) + relay     | yes (Postgres) | yes (the key) | at-least-once | **yes, by construction** | 2 tables + 2 relays; $0  |
| SQS FIFO (`MessageGroupId` = entity) + consumer watermark | yes            | yes           | at-least-once | consumer-side only       | queue per stage; ~$0     |
| DynamoDB item-per-entity + Streams                        | yes            | yes           | at-least-once | **yes**                  | new service, new IAM     |
| EventBridge → SQS FIFO                                    | yes            | yes           | at-least-once | consumer-side only       | uses the provisioned bus |

The outbox shape is also the one the repo's own normative doc already mandates for the dual-write problem
(quoted in 12/A-4 from `docs/engineering/ENGINEERING_EXCELLENCE.md`), and it is the only shape that makes
"latest-wins" a property of the _store_ rather than a discipline the consumer must not get wrong.

**Blocker, not friction**: an implementer cannot start. This is the plan's largest unmade architectural
decision.

### HB-2 — The credential gap does NOT block the substrate; it blocks the placeholder lifecycle. The brief has these backwards, and the minimum unblock already exists in-repo

The brief states "the substrate needs a producer identity, but there is NO service-to-service credential".
Half of that is wrong and the other half is worse than stated.

**The substrate producer is not blocked.** If the producer publishes to EventBridge/SQS, its identity is
the **ECS task role**, and the grant is already written (`food-service-stack.ts:366,431,492`). No
application credential is involved. The minimum unblock for a bus producer is mechanical: add
`@aws-sdk/client-eventbridge`, write `class EventBridgeEventBus implements EventBus` behind the seam that
already exists (`food-event-emitter.ts:35-47`), and replace `ConsoleEventBus` at `worker/main.ts:64`.
One dependency, one class, one line.

**What IS blocked** is the plan's _other_ half — "placeholder rows created and status-advanced". At bulk
scale that is a background recipe→food HTTP call, and there the finding is confirmed and hard:

> "food's `FoodAuthGuard` verifies a _Clerk_ token, so the only credential that can satisfy it is the
> caller's own (short-lived, per request) … a static `FOOD_SERVICE_TOKEN` … could not have worked if it had
> been [set], since a Clerk session token expires in ~60s."
> — `packages/services/recipe-service/src/ingredients/food-service-clients.factory.ts:6-13`

and `:68-71`: _"There is deliberately no fallback credential."_

**Do not build on food's `svc_*` branch.** It exists — `resolveRequesterId` returns the raw `sub` for a
`svc_`-prefixed principal (`packages/services/food-service/src/auth/authenticated-principal.ts:38-40,
:64-67`) — but it is reachable **only via a verified Clerk token whose `sub` starts `svc_`**, and no Clerk
M2M issuer is wired. The repo says so directly: _"no Clerk M2M issuer is wired"_
(`packages/shared/recipe-core/src/serviceErasureToken.ts:20-21`). 12/A-9 treats this branch as usable; it
is not. Building on it produces a path that cannot be exercised outside a test that mints its own token.

**The minimum unblock exists, is proven, and is already half-deployed.**
`packages/shared/recipe-core/src/serviceErasureToken.ts` defines an internal **asymmetric EdDSA**
service-principal JWT: pinned issuer (`:36`), **per-target audience** (`:44`, `:57` —
`SERVICE_ERASURE_TOKEN_AUDIENCE_FOOD = 'urn:commise:food-service:account-erasure'`), `EdDSA` only (`:65`),
a 120-second verifier-enforced max TTL (`:72`), and claims that bind the capability to one target and one
event. Its rationale for rejecting Clerk M2M is written out at `:18-31`. **Food already verifies this key
in production**: `FOOD_SERVICE_PRINCIPAL_JWT_KEY` is resolved from SSM per stage in
`food-service-stack.ts:296-302` with the comment _"the matching PRIVATE key is held only by the identity
deletion-worker"_.

So the unblock is: **a second audience** (e.g. `urn:commise:food-service:ingredient-resolution`), a signer
in the import worker, and a per-stage keypair in SSM — following the erasure template exactly, keeping the
"bind the capability to one target" property. That is days of work on a reviewed pattern, not a research
project. 13/A-9 correctly demands the decision; it does not name this template, and it should.

### HB-3 — `CREATE INDEX CONCURRENTLY` cannot run under either migration runner, so a large share of the data-model findings are unshippable as written

09-data-model flagged this as conditional in its "Not examined". It is now resolved, and it fails.

Both runners wrap **each migration file in an explicit transaction**:

- food: `await client.query('BEGIN'); … await client.query(sql); … COMMIT` —
  `packages/services/food-service/src/lambdas/migrate/handler.ts:121-131`
- recipe: identical shape — `packages/services/recipe-service/src/lambdas/migrate/handler.ts:114-124`

Postgres forbids `CREATE INDEX CONCURRENTLY` inside a transaction block. Every `CONCURRENTLY` in
09-data-model (F-DB4, F-DB10, F-DB11, F-DB12 at `09:685-689`, F-DB15 at `09:893-897`) therefore **fails at
deploy**, in the migration Lambda, after the rest of the file has run.

Two exits, and one must be chosen before any index migration is written: (a) drop `CONCURRENTLY` and accept
an `ACCESS EXCLUSIVE` lock for the build — probably fine at current row counts, but nobody has measured
them; or (b) give the runner a non-transactional migration class, which is a change to a deploy-critical
Lambda whose failure mode is a wedged deploy.

### HB-4 — No tier anywhere runs recipe-service and food-service together, and the two existing harnesses collide on host ports

The plan's stated test bar is "local full stack (Docker Postgres + LocalStack) proving recipe → ingredient
resolution → placeholder → status → nutrition". That crosses the service boundary. Nothing in the repo does.

- Every CI job brings its **own** Postgres and its **own** database: `food_test` (`_ci.yml:412`),
  `recipe_test` (`:464`), `food_e2e` (`:694`), `recipe_e2e` (`:760`), `recipe_workers_test` (`:548`). There
  is no job that boots both services (job list read in full, `_ci.yml:302-813`).
- The two compose files each provision **one** database and both bind host `5432`:
  `docker-compose.test.yml` → `POSTGRES_DB: kitchensink_recipes`; `infra/localstack/docker-compose.yml` →
  `POSTGRES_DB: food_e2e`. They cannot run simultaneously.
- The two services' e2e harnesses use **incompatible** DB-reset strategies, and the shared harness says so
  in normative terms: recipe resets once per vitest process via `globalSetup`, food resets per spec file,
  and _"a new service's e2e harness MUST pick exactly one, not mix them"_ —
  `packages/tools/service-test-harness/src/boot-service-app.ts:22-40`.

This blocks the acceptance criterion as written. It is buildable (see "Local-stack capability" — every
ingredient exists), but it is net-new harness work, not configuration.

### HB-5 — The OCR line item has no dependency, no provider port, and on mobile requires a build posture the app does not have

Verified absences: **no** `tesseract`, `textract`, `mlkit`, `vision-camera` or `text-recognition` in any
`package.json` in the repo. No `OcrProvider` port or any `ocr` module in `recipe-service/src`. `004` has no
implementation at all: `recipe-service/src/database/schema/` holds 8 files and `migrations/` holds
`0001`–`0018`, none of which is an import or OCR artifact.

**Web / Lambda.** Tesseract.js is workable but not a drop-in: its worker, WASM core and language data are
fetched from a CDN by default and must be bundled with `workerPath`/`corePath`/`langPath` set to local
files, and `cachePath` pointed at `/tmp` because the Lambda filesystem is read-only elsewhere. If the OCR
Lambda is VPC-attached (it must be if 011's `digitization_jobs` live in RDS, per 11/A-2), an un-bundled CDN
fetch on every cold start egresses through the **t4g.nano NAT instance** (ADR-0004) — the one piece of
infrastructure this repo deliberately kept tiny. _(Bundle-size, cold-start and accuracy statements here are
general knowledge about the library; nothing was installed or benchmarked.)_

**Mobile.** `packages/apps/commise/mobile/app.json` lists exactly three plugins — `@sentry/react-native/expo`,
`expo-image`, `@clerk/expo` — and the dependency list carries `expo-image-picker` but no camera and no OCR.
Expo ships no first-party text recognition. On-device OCR means a native module (ML Kit text recognition, or
vision-camera with a frame processor), which means a config plugin, which means an EAS **dev-client** build:
Expo Go stops working for local development, and the six existing Maestro flows must run against the new
binary. That is a platform posture change, not a library addition.

**Blocker for this line item only** — the rest of the plan is independent of it.

---

## Hidden prerequisites

Each of the four the brief names, re-verified, plus four it does not.

### The four named

**An import-linkage entity — CONFIRMED ABSENT.** `packages/services/recipe-service/src/database/schema/`
contains `account, author-handles, collections, index, ingredients, photos, ratings, recipes, versions` —
no import table. `migrations/0001`–`0018` create none. On the food side there is no import column and **no
owner column of any kind**; the only discriminator is `origin` (`food_origin` enum, values `live | bulk`) —
`packages/services/food-service/src/db/schema/food.ts:75`, `:98`. Consequence: per-import status,
per-import shell caps and per-import reclamation are all unimplementable, and 09/D-9 already records that
this table's **retention and its account-erasure-root status must be decided in the same migration that
creates it** (`09:1030-1040`). This is a hard prerequisite for both the substrate and the placeholder work.

**A status read endpoint — CONFIRMED ABSENT, on both sides.** The food client surface is exactly seven
methods (`packages/clients/food-service/src/client.ts:153,167,191,222,236,250,273`); `getStatus(id)` is
single-id and there is no batch status read (F-DB16). 004 specifies no `GET /api/v1/imports/{id}` (12/A-8,
13/A-8). So a 1,000-recipe import writes with one `batch` call and reads status with thousands, and the
"durable projection is the fallback" claim of ADR-0019 §5 has no read surface. F-DB16 names this as the
exact pressure that will break the single-writer rule, and it is right.

**EventBridge — the gap is smaller than "it's missing" implies.** The SDK dependency and the adapter are
absent (HB-1), but the bus, the grants, the env var and the LocalStack provisioning all exist, and the food
e2e suite already carries the TODO for asserting it: _"assert the fetch-completion fan-out lands on
EventBridge via LocalStack (`events` is provisioned in infra/localstack/docker-compose.yml; Community tier,
no token)"_ — `packages/services/food-service/tests/e2e/health.e2e.test.ts:113-114`. Whether EventBridge is
the right substrate is HB-1's question; whether it is _reachable_ is not a prerequisite problem.

**A shell reclamation path — CONFIRMED ABSENT.** No `DELETE FROM food` anywhere in the food service
(verified). The TTL only permits **reactivation**, and only of `NOT_FOUND`/`FAILED` rows. A `PENDING` or
`UNRESOLVED` shell is permanent, occupies a **globally unique name** (`uniqueIndex(
'food_normalized_name_unique')`, `food.ts:110`), and has no owner column to scope a sweep by. `food.origin`
is the natural discriminator precedent and has no `import` member.

### Four the plan does not mention

**A per-entity monotonic value on the ingredient side.** `ingredients` carries `created_at` and nothing else
— no `updated_at`, no version, no sequence (`packages/services/recipe-service/src/database/schema/ingredients.ts:48-88`).
"Latest-message-in-group wins" requires one. `recipes.current_version` exists for the recipe half (12/A-1);
the food/ingredient half has nothing.

**A guarded write on the recipe-side projection.** `IngredientsDal.updateResolution` is an unconditional
`UPDATE … WHERE id = $6` (12/A-3, F-DB7), while food's `setStatus` is a CAS against `LEGAL_PRIORS`. Adding a
substrate consumer makes it a **second unsynchronised writer** to the same column. This must land _before_
the consumer, not with it.

**A principal and a queue class for bulk-origin shells.** `FetchQueueDao.leaseNext` demand-weights and
demotes **per requester** (12/A-9). A bulk import demotes the importing user behind every interactive user
for the duration of their own import; a shared service principal collapses all imports globally into one
bucket. Neither is specified.

**A status-vocabulary mapping.** Four vocabularies are in force (shipped `FoodStatus`; 011's `job_status`;
004's progress-screen states; ADR-0019's five stages) and no total mapping exists (14/P-8). The substrate
carries a status; it cannot be written without picking one.

---

## Internal conflicts

**C-1 — "ALL 112 findings" includes two the findings themselves forbid shipping.** F-DB12 (`DROP INDEX
idx_recipes_visibility; DROP INDEX idx_recipes_public_recent;` — `09:685-686`) and F-DB15 (`DROP INDEX
food_status_idx;` — `09:897`) are index-shape judgements made with no query plan, and 09 says so twice in
place (`09:694-701`, `09:902`) and once normatively: _"The two `DROP INDEX` recommendations (F-DB12, F-DB15)
must not ship without a before/after `EXPLAIN (ANALYZE, BUFFERS)` on representative data"_ (`09:1067-1069`).
A blanket "all 112 ship" overrides the reviewer's own stop-condition. Compounded by HB-3: the replacement
`CREATE INDEX CONCURRENTLY` cannot run in the migration runner anyway.

**C-2 — The live-reference ruling contradicts the review that examined the question most closely.**
15/A-5 was sent to argue _for_ a snapshot and concluded the opposite of the ruling's premise:

> "The current model is **not a live reference**. It is _already_ a snapshot — an undeclared one."
> — `15-adversarial-food-recipe-model.md:350-351`

Verified in code: `ingredients.calories_per_100g / protein_g_per_100g / carbs_g_per_100g / fat_g_per_100g`
are a copy of the golden record (`ingredients.ts:60-63`) written once by `updateResolution` with no refresh
path for a `RESOLVED` row; `recipes.lead_calories_per_serving` is a copy of a copy, recomputed only on the
recipe's next write (`migrations/0012_lead_calories_per_serving.sql:3-6`). 15's recommendation — add
`resolved_at` + `food_item_version` and **declare** the snapshot — is filed as a persisted-schema **one-way
door** in its hand-off table (`15:328-330`, `:444`). The ruling names a different destination without naming
a mechanism, and two very different mechanisms are being conflated. See "Migration risk".

**C-3 — Live reference breaks 006's stated design premise, verified first-hand.**
`specs/006-meal-planning/research.md:448`: _"**006 never calls the food service**; nutrition is already
resolved and denormalized by 001."_ If "live" means a read against the food service, that sentence is false
and 006's whole nutrition-rollup design (`research.md:447`, a pure read-time fold with no cache and no
snapshot table) needs re-planning. If "live" means "live within the recipe DB", 006 is untouched. The plan
does not say which, and 006 is now its own deployable with its own database (ADR-0017 amendment), which
makes the cross-service version of this a network hop per recipe per plan render.

**C-4 — Live reference reinstates the N+1 that a shipped migration exists to prevent.**
`0012_lead_calories_per_serving.sql:4-7` states its purpose verbatim: the LIST/SEARCH/collection-embed
projections read the stored column _"so a card shows calories **WITHOUT the N+1** a full nutrition read
would cost"_. A model that removes the stored copy puts that N+1 back on the hottest read path; if the live
read crosses the service boundary it is an N+1 of cross-service calls, on a path that already has a
sub-second per-keystroke budget elsewhere (`food-service-clients.factory.ts:36-42`).

**C-5 — Live reference _raises_ the priority of the nutrient-match defect rather than retiring it.**
`extractNutrition` matches by lowercase substring with **no unit filter** and takes the first hit:
`nutrientPer100g(n, (name) => name.includes('energy') || name.includes('calorie'))` and
`… name.includes('lipid') || name.includes('fat')` —
`packages/services/recipe-service/src/ingredients/ingredients.service.ts:64-66`, `:126-133`. `energy`
matches both the kcal and the kJ nutrient rows; `fat` matches `'Fatty acids, total saturated'`. Under a
stored model this is a write-time bug fixable by a one-off correction; under a live model it becomes a
**per-read** bug, so it must be fixed _before_ the model flips or every read serves the wrong number.

**C-6 — Tesseract.js removes one of the three grounds ADR-0019 §3 used to justify a separate image
deployable.** Per 14/P-5 and 11/A-6, §3's second ground is _"it carries a vendor dependency the recipe
service should not link"_. Tesseract.js is an in-process npm library — there is no vendor, no IAM edge, no
secret. So the OCR ruling and the topology ruling now point in opposite directions and one must move.
13/A-6 and 11/A-6 independently argue the workload belongs in `recipe-workers` (which exists, with six
Lambda handlers and its own stack); the Tesseract ruling strengthens that argument considerably.

**C-7 — "Mobile submits raw text" is unreconcilable with FR-025's provenance rule and with 011's
differentiator.** Per 11/A-8 and 14/P-3, `004-FR-025` holds that `imported_physical` is _"set only by the
server from the channel it observed"_. A raw-text POST is byte-indistinguishable from a paste, so the server
observes nothing and the classification becomes caller-declared — the exact mass-assignment the rule exists
to prevent, and the one gating a premium-only channel. Separately, 011's stated differentiator is
_"correction UX over a normalised schema"_ (11/A-5 quoting `011/spec.md:26`) rendered over per-token
confidence anchored to the image; a raw-text submission has neither. So one FR produces two different
products on two platforms, against `CLAUDE.md` §"Cross-platform rule (enforced)". That divergence may be the
right call, but it must be recorded as a decision, not arrived at by transport choice.

**C-8 — "Spec/plan/task updates ONLY (no code) for 004–014" collides with the substrate's own
prerequisites.** The batch status read, `GET /api/v1/imports/{id}`, and the import-linkage table are 004
artifacts, and HB-1/HB-2 and the reclamation rule all depend on them. Meanwhile several _shipped-code_
defects in 001/002/003 are in scope and are made critical only by 004 — the typeahead leak of non-terminal
placeholders (F-DB6 / 12-A-10 / 15-A-1.2), the unguarded `updateResolution` (F-DB7), the caller-authored
shared catalog name (15-A-1). The scope line has to be drawn explicitly or an implementer will guess.

**C-9 — 004's downstream artifacts still specify the OCR channel the ADR removed.** 11/A-7 documents that
commit `4a979422` touched only two `spec.md` files, leaving `004/tasks.md:551` (T-018, _"ships at launch"_),
`:558`, `:660`, `:666`, `:820` plus `plan.md`, three v-model files, the product spec and a wireframe all
specifying OCR in 004. Adding a Tesseract/on-device ruling on top of that produces three stale layers. The
"spec/plan/task updates only" scope is the right instinct and is a large amount of work: 11/A-5 counts 25
OCR references in `tasks.md`, 18 in `plan.md`, 30 in the acceptance plan and 42 in the traceability matrix.

---

## Migration risk

**Is a migration required? It depends entirely on which "live reference" is meant, and the plan does not
say.** Two readings, with opposite risk profiles:

**Reading A — live within the recipe database.** Keep `ingredients.*_per_100g` as a _refreshable_ cache and
add a path that re-reads a `RESOLVED` row when the food changes (the gap 15/A-4(ii) identifies: today
`mergeChangedSources` rewrites the golden record in place and nothing propagates to `ingredients`).

- **Migration: additive only.** `resolved_at`, `food_item_version`, `resolution_sequence` on `ingredients`
  — nullable `ADD COLUMN`, metadata-only, no table rewrite, no backfill. This is the exact pattern
  `0012_lead_calories_per_serving.sql:12-15` documents and validates ("SAFE AGAINST EXISTING ROWS").
- **Reversible**: yes, `DROP COLUMN`.
- **Existing rows**: unaffected. `NULL` must be read as _"resolved before we tracked as-of"_ — **not** as
  "fresh". Getting that wrong silently marks every pre-existing row current.
- 006 (C-3) and the `lead_calories` N+1 rationale (C-4) both survive intact.

**Reading B — live against the food service per read.**

- **Migration: destructive.** `ingredients.calories_per_100g / protein_g_per_100g / carbs_g_per_100g /
fat_g_per_100g / portions` and `recipes.lead_calories_per_serving` all become dead.
- **Not reversible.** The values cannot be recomputed without re-reading food for every ingredient, and
  `lead_calories_per_serving` cannot be recomputed _at all_ for recipes whose ingredients are `NOT_FOUND` or
  `FAILED`.
- **Existing rows change meaning before any DDL runs.** The point of no return is the deploy where the read
  path flips, not the migration. No feature-flag mechanism is named anywhere in the plan.
- **Recommendation if B is chosen**: do not drop in the same PR. Stop _writing_ the columns, keep _reading_
  them as the degraded fallback (which the live path needs anyway — food is a network dependency with an 8s
  budget, `food-service-clients.factory.ts:36-38`), and drop only after the live path has a measured
  availability record.

**What touches shipped data either way:**

- **`ingredients` rows already `RESOLVED`** carry per-100g values written by the unit-blind matcher (C-5).
  Some fraction are kilojoules (×4.184) and saturated-fat-not-total-fat. Under A they persist until
  refreshed; under B they vanish. Neither is a _migration_ — it is a data-correction question with **no
  measured incidence**. Take the counts before deciding: how many `RESOLVED` ingredients exist, and how many
  foods carry two `Energy` nutrient rows.
- **`recipes.lead_calories_per_serving`** is recomputed only on the recipe's next write
  (`0012:12-15`), so any correction leaves stale headline calories on every unedited recipe **indefinitely**.
  A backfill is a full recompute over `recipes`; it needs the corrected matcher first, and under B there is
  nothing to backfill to.

**The placeholder lifecycle needs no migration — it ships.** `food.status` defaults to `PENDING`
(`food.ts:95`), the enum's first member is `PENDING` (`:44`), `FoodDao.createByName` mints shells and
`setStatus` advances them under `LEGAL_PRIORS`, and the recipe side already carries `food_id` +
`food_resolution_status` with a `CHECK` (`ingredients.ts:56`, `:70-73`). 12/A-7 and 14/P-2 both establish
this at file:line. **What is genuinely new and does need DDL** is the import linkage, a reclamation
discriminator, and the sequence column — i.e. exactly the "hidden prerequisites" above.

**Two mechanical migration facts that constrain every option:**

1. `CREATE INDEX CONCURRENTLY` is unavailable (HB-3).
2. **Adding a value to a Postgres enum cannot be reversed** — you cannot `DROP` an enum value. So marking
   bulk shells by widening `food_origin` with an `import` member is a genuine one-way door; prefer a
   separate nullable column or a `text` + `CHECK`, which is what the recipe side already does for
   `food_resolution_status` (`ingredients.ts:70-73`).
3. Each migration **file** is atomic (both runners, `BEGIN`…`COMMIT`), but a migration **set** is not: file
   N can commit and file N+1 fail. Every file must be independently safe against a partially-applied set.

---

## Local-stack capability

**What LocalStack Community actually provides here**, from the repo's own harness rather than from vendor
docs — `infra/localstack/docker-compose.yml:5-13`, `:37`:

> `secretsmanager, events` (EventBridge)`, sqs, sns, sts, iam, logs, cloudwatch, ssm` … _"Every service here
> is Community; the Pro-only services (RDS, ECS) are deliberately avoided (Docker Postgres for the DB; the
> Nest app boots as a process)."_

CI mirrors it (`_ci.yml:477`, `:710`, `:771`, LocalStack `4.4.0`).

**Can it prove the stated flow? Yes — every ingredient exists, and this is the plainly-feasible part of the
plan.**

- **Both services boot in-process.** `packages/tools/service-test-harness/src/boot-service-app.ts` is a
  generic `NestFactory.create(AppModule)` bootstrap on an ephemeral port, already used by identity and
  recipe, with food-service explicitly named in its DB-isolation contract (`:32-40`).
- **The Clerk credential is hermetic and needs no network.** Food's e2e mints genuinely-signed RS256 tokens
  against a throwaway 2048-bit keypair whose public PEM is used verbatim as `CLERK_JWT_KEY` —
  `packages/services/food-service/tests/support/jwt.ts:1-14`. Point _both_ services at the same public key
  and recipe's forwarded-caller-token path works locally with zero Clerk calls. This is the piece most likely
  to be assumed impossible; it is already solved.
- **USDA needs no external call.** The source pipeline has an injectable adapter seam and the integration
  suites already use a fake: _"A fake USDA adapter whose `fetchByKey` the test programs"_ —
  `packages/services/food-service/tests/food-refresh.integration.test.ts:38-47`.
- **Placeholder → status → nutrition is pure Postgres.** No AWS involved at all.
- **The substrate depends on HB-1's choice.** EventBridge, SQS (incl. FIFO), SNS and DynamoDB are all
  Community. **ElastiCache/Valkey is Pro** — so if the substrate reuses ADR-0016's Valkey, LocalStack cannot
  emulate it and you run a `valkey`/`redis` container instead. Workable, but it changes the compose file and
  must be stated.

**What must be built to reach the stated bar (all friction, none blocking except HB-4's collision):**

1. **One compose file with two databases.** Today: `docker-compose.test.yml` → `kitchensink_recipes` only;
   `infra/localstack/docker-compose.yml` → `food_e2e` only; both bind host `5432`.
2. **`events` added to the root test compose.** It enables only `SERVICES: s3,sqs`
   (`docker-compose.test.yml`), while CI enables `s3,sqs,sns,events,secretsmanager,sts,iam,logs,cloudwatch,ssm`
   (`_ci.yml:477`). A substrate test written locally against `events` would fail on the committed local stack.
3. **One DB-reset strategy.** Recipe resets per vitest process, food per spec file, and
   `boot-service-app.ts:28-40` forbids mixing them.
4. **A CI job that runs it.** Otherwise the tier is dark — F-T4's exact documented failure mode, with a
   2-for-2 record in this repo.

**What LocalStack cannot prove, regardless of tier**: IAM policy correctness (its enforcement is not
authoritative), EventBridge archive/replay and cross-account semantics, real at-least-once redelivery
timing, and anything about the ALB/ECS/RDS path. Those stay sandbox-only.

**Mocked Playwright for UI states** is ordinary route-interception work with no blocker — but note there is
no visual-regression signal today (F-T5: `ARGOS_ENABLED` unset) and no executable precedent anywhere for
asserting an async status transition in a browser or on a device (F-T15), which is this plan's central
mechanism.

---

## Recommended order of work

The organising principle: **every item in Phases 1–3 is cheap now and a rewrite after bulk import exists.**
Bulk import multiplies each of them by three orders of magnitude.

**Phase 0 — Decide.** See the next section. No code.

**Phase 1 — Measure, because three decisions depend on numbers nobody has.**

- `EXPLAIN (ANALYZE, BUFFERS)` before/after for the two `DROP INDEX` candidates (`09:1067-1069`).
- Violation counts for the proposed `CHECK`s (F-DB3, F-DB13) — 09 names these a prerequisite to writing
  either migration.
- Counts for the nutrition correction: `RESOLVED` ingredient rows; foods carrying two `Energy` nutrients.
- Decide HB-3's exit (plain `CREATE INDEX` vs a non-transactional runner class).

**Phase 2 — Close the shipped defects bulk import multiplies, plus the harness that proves them.** Land the
two-service compose + CI job here, not at the end, so everything after arrives with a test.

- Status-filter `IngredientsDal.search` (F-DB6 / 12-A-10 / 15-A-1.2).
- Guard `updateResolution` with legal-priors **and** a monotonic predicate (F-DB7 / 12-A-3). **Must precede
  any second writer.**
- Match nutrients by `external_code`, then `(name, unit)` exactly; add `ORDER BY` to the golden-record
  nutrient select (15-A-1). **Must precede the nutrition ruling under either reading** (C-5).
- Stop `addByName` writing a caller-supplied name into the shared catalog (15-A-1).
- `findFoodIdByExternalKey` convergence before minting a second food owner — or at minimum model the `23503`
  as a `409` (15-A-4(iv)). This is a live wedge today with no user exit.
- Idempotent `200` on the losing `patchResolve` (15-A-1.4).

**Phase 3 — The persisted one-way doors, one additive migration each, after Phase 1's counts.**

- `ingredients`: `resolved_at`, `food_item_version`, `resolution_sequence`.
- The import-linkage table(s), with retention and account-erasure-root wiring decided in the same file
  (`09:1030-1040`).
- The shell discriminator and reclamation predicate (as a nullable column, not an enum widening).

**Phase 4 — The service-to-service credential**, on the erasure-token template with a new audience (HB-2).
Everything asynchronous depends on it.

**Phase 5 — The substrate**, in this order: outbox row written **in the same transaction** as `setStatus` /
`updateResolution` → relay with lag alarm → transport adapter (`@aws-sdk/client-eventbridge` +
`EventBridgeEventBus`, replacing `ConsoleEventBus` at `worker/main.ts:64`) → delete the emitter's
swallow-and-continue (12/A-4) → the LocalStack assertion the food e2e already has a TODO for
(`health.e2e.test.ts:113-114`).

**Phase 6 — The read surfaces**: batch status read on the food contract (F-DB16) and
`GET /api/v1/imports/{id}` over the recipe-side projection, so import status is answerable with 014 absent
(12/A-6.2, 13/A-8).

**Phase 7 — Spec/plan/task reconciliation for 004–014.** No code dependency, so run it **in parallel from
Phase 0 onward** — do not leave it last. Today an agent executing `004/tasks.md` builds the channel ADR-0019
says 004 does not build (11/A-7), and that hazard is live for the whole duration.

**Phase 8 — OCR, last**, and only after a spike (below).

**Kept out of this branch until measured**: F-DB12 and F-DB15's `DROP INDEX` halves (C-1).

---

## What must be decided before coding

1. **Which "live reference"** — Reading A (refreshable cache in `ingredients`) or Reading B (per-read call
   to the food service). This decides the migration, whether it is reversible, whether
   `lead_calories_per_serving` survives, and whether 006's _"never calls the food service"_ premise holds.
   _Everything about the nutrition work is blocked on this one sentence._
2. **The substrate technology**, evaluated against the four stated properties (HB-1's table). And whether
   "guaranteed delivery" means at-least-once with an idempotent consumer (achievable) or exactly-once (not).
3. **Where the monotonic sequence lives per entity type, and who assigns it** — 12/A-1's rule is that
   whoever writes the entity row assigns it in the same statement. Also: **rename one of the two `sequence`
   fields** before either is generated into `packages/schemas/*`. It is a wire field and therefore a one-way
   door (12/A-1.2).
4. **The service-to-service credential, once, for the whole portfolio** (13/A-9). Recommendation: a new
   audience on the existing erasure-token pattern. It is the only mechanism in this repo that is proven,
   asymmetric, capability-bound and already verified by food in production.
5. **Which principal a bulk import resolves under, and what queue class its shells enter** (12/A-9).
6. **Whether F-DB12 / F-DB15's `DROP INDEX` halves are in scope for this PR at all.** Recommendation: no.
7. **Whether the migration runner gets a non-transactional class**, or every new index takes an
   `ACCESS EXCLUSIVE` lock (HB-3).
8. **The import-linkage shape, its retention, and whether it is an account-erasure root** — before the table
   exists (`09:1030-1040`).
9. **The shell reclamation rule** — the predicate, the clock, and how a bulk shell is discriminated from a
   catalog row without widening an enum.
10. **The status vocabulary**, as a _total_ mapping over the four in force, naming where `UNRESOLVED`,
    `duplicate-found` and `awaiting-correction` land (14/P-8).
11. **OCR accuracy** — this is a **spike, not a decision**. Tesseract.js on printed recipe cards is
    plausible; on handwriting (011's stated differentiator) it is not. Run it against a real corpus before
    committing the ruling.
12. **Whether removing the vendor dependency reopens ADR-0019 §3's separate-image-deployable ruling** (C-6).
13. **Mobile OCR platform posture** — which native module, whether the app moves to a dev-client build, and
    what that does to Expo Go, EAS and the six Maestro flows.
14. **What a mobile raw-text submission means for provenance**, given FR-025 forbids a caller declaring
    `imported_physical` (C-7) — and whether web-and-mobile shipping different products from one FR is
    accepted and recorded.
15. **The scope line for "no code for 004–014"**, given that the batch status read, the import projection
    read and the import table are 004 artifacts the substrate needs (C-8).

### Stated plainly: what is feasible

Not everything here is a problem, and it would be dishonest to imply otherwise.

- **The placeholder + status-advance model needs no invention.** It ships, with a correctly-implemented
  guarded State machine (`LEGAL_PRIORS` + a conditional `UPDATE` that throws on `rowCount = 0`). That is the
  strongest code at this seam and the shells ride on it safely.
- **The substrate's infrastructure half is done**: bus provisioned, three task roles granted, env var wired,
  LocalStack `events` running in CI. The gap is one dependency and one adapter class.
- **The service credential has a reviewed, deployed template in-repo**, with food already holding the public
  key. This is a days-scale extension, not a research problem.
- **The local full-stack test is genuinely buildable**: both services boot in-process, the Clerk credential
  is mintable hermetically, the USDA source has an injectable fake, and every AWS service involved is
  Community-tier.
- **Mocked Playwright for UI states** is ordinary work with no blocker.

The risk is concentrated in three places: the undecided substrate technology, the undecided meaning of
"live reference", and the OCR platform change. Everything else is sequencing.

---

## Not examined

- **No database was connected to.** No `EXPLAIN`, no row counts, no `pg_stat_statements`, no table or index
  sizes. Every performance, volume and "this will be slow" statement here is structural inference from the
  schema and the query shape, not measurement.
- **No AWS API call of any kind.** Quota, cost and deploy-behaviour claims come from the CDK source and from
  reports 11–15, not from the account.
- **I read reports 11–15 in full and 07 in full; 09 only in the targeted regions** (F-DB6, F-DB7, F-DB11–16,
  D-9, D-10, Not-examined). **Reports 01, 02, 03, 04, 05, 06, 08 and 10 were grepped, not read.** A finding
  in one of those may contradict something above; the conflict enumeration in "Internal conflicts" is
  therefore a floor, not a ceiling.
- **I did not open `specs/004`, `specs/011`, `specs/014`, ADR-0019, ADR-0017 or ADR-0016.** Every claim
  attributed to them is second-hand from reports 11–15 and its line numbers should be re-checked before
  acting on any single one. The one exception I verified directly is
  `specs/006-meal-planning/research.md:448` (C-3).
- **Nothing about Tesseract.js was installed, bundled or benchmarked.** The bundle-size, cold-start,
  `/tmp`-cache and handwriting-accuracy statements are general knowledge about the library.
- **I did not verify LocalStack 4.4.0's Community/Pro split against LocalStack's current documentation** — I
  used the repo's own harness header (`infra/localstack/docker-compose.yml:5-13`), which asserts it and has
  been running in CI.
- **I did not de-duplicate the 112 findings.** "All 112" may be materially fewer distinct changes than the
  count suggests, which would improve the schedule picture.
- **I did not examine** the 011 Family Circles half, features 012/013, the k6/load tiers, the web/mobile UI
  surfaces for the import flow, or the `recipe-workers` handlers beyond confirming they exist.
- **I did not verify whether the branch's existing 1,264-file delta is itself coherent** — only its size.

**Confidence**: High for HB-1 through HB-4, every "hidden prerequisite" absence, C-1 through C-5, and the
local-stack capability assessment — each is anchored to a file I opened, and every absence claim shows the
search that produced it. Medium for HB-5 (the mobile posture is certain; the Tesseract performance and
accuracy statements are unmeasured) and for C-6/C-7/C-9, which rest on spec text read second-hand.
