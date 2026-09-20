# 0040 — Test principals: a signed marker, containment on production, and a repeatable self-purge

- **Status:** Accepted
- **Date:** 2026-09-13
- **Owner rulings (2026-09-13), recorded as the decision inputs:**
    1. _"The k6 and e2e tests need to guarantee that they not only clean up their data but to scope the data such
       that it won't conflict with real data. The only thing we don't have to worry about is food — if we import new
       food that's fine; otherwise the food will already be imported."_
    2. _"We should have a pool of test users for clerk so that we don't need to create ones."_
    3. **Containment** is ENFORCED on production and OFF on sandbox and every `pr-{N}`. It is a config switch,
       `TEST_PRINCIPAL_CONTAINMENT: 'enforce' | 'off'`, and an unset value means `enforce`.
    4. **ADR-0027 is amended**: the test purge may hard-delete a test principal's correction rows by `user_id` —
       only when the signed claim AND the service's registry both say test principal.
    5. **k6 is manual-only**, and production k6 stays limited to unauthenticated probes until this decision's
       service half ships. Lifting that gate is a later step with its own sign-off.
    6. Production pool addresses are `testpool-{slot}@testpool.commise.app`.
    7. There is **no** production `food:admin` test principal.
- **Relates to:** [ADR-0032](0032-deployed-ecosystem-test-tier.md) — §5 says a full production suite "is a SEPARATE
  decision" needing "a dedicated production test account with a bounded blast radius, and a cleanup path that
  provably reclaims everything the run authored". This is that decision, for the service half; it does not by
  itself run the full web suite on production.
  [ADR-0027](0027-ingredient-phrase-is-not-personal-data.md) — amended as ruling 4 states.
  [ADR-0023](0023-curator-declared-provenance.md) — field-level authorization lives in pure policy modules, never
  route Guards; containment is the third instance of that shape.
  [ADR-0030](0030-first-party-analytics-events.md) — impact counts never decrement, which is why analytics is
  PREVENTED rather than cleaned up.
  [ADR-0039](0039-database-role-split.md) — the purge runs in the worker, as the service role, like erasure.
  [ADR-0014](0014-service-owned-api-contracts.md) — the new routes and error code are authored in-service.

## Context

The load and end-to-end tiers write to the stages they test. Against production that is a correctness problem, not
a tidiness one, and cleanup alone cannot solve it:

- **Some effects cannot be undone.** `recipe_impact_signals` has no DELETE trigger (ADR-0030 §1), so a test view or
  save of a real recipe is a permanent count. Two distinct users agreeing on a correction promote it to a global
  mapping for every real user, and the promotion can complete a PENDING catalog food. A pool of test accounts is
  exactly the "sock-puppet" case `mappingScopePolicy.ts` describes.
- **Some effects are visible before any cleanup runs.** A public recipe or collection enters community discovery;
  a rating moves a real recipe's average.
- **The existing cleanup paths do not reset a fixed account.** Erasure is one-shot (`410 ALREADY_ERASED`), keeps
  truly-public recipes pseudonymized, and deletes the Clerk user, whose anti-resurrection then keeps the slot
  unusable. A persistent pool therefore needs a purge that is total and repeatable.
- **ADR-0027 forbids user-keyed erasure sweeps of the correction tables**, because `user_id` there is the
  distinct-user counter and an authorization predicate.

## Decision

### 1. A test principal is a signed claim, read in one place

`@kitchensink/clerk-verify` exposes a REQUIRED `testPrincipal: boolean`, read ONLY as
`public_metadata.testPrincipal === true` — strictly `true`, never truthiness, never `unsafe_metadata`, never a
top-level claim. `public_metadata` is writable only through Clerk's Backend API with the secret key, which the
services do not hold. The recipe `Principal` carries it as `principalKind: 'real' | 'test'`, and identity's
`AuthorizerContext` as `testPrincipal`.

### 2. Containment is a pure Specification composed into the owning policies through required fields

`recipe-service/src/common/containmentPolicy.ts` answers one question — "does this write let test data reach real
data here?" — from `{ principalKind, containment, action }`, denying with `TEST_PRINCIPAL_CONTAINED` (a `403`)
exactly when a test principal acts on an enforcing stage. The contained actions are: publishing a recipe or a
collection, rating, cloning content the principal does not own, promoting a correction (curated or corroborated),
recording analytics, erasing the account, and requesting ingredient verification. Verification is contained because
its worker spends ADR-0024's shared production LLM pool and writes the global `ingredient_resolution_memos` tier,
which answers for every future cook and carries no user column a purge could reach; like analytics it can only be
prevented, and preventing it costs a test nothing, because absence of a verdict means publish. Identity carries the same rule for its own two actions, closing and
erasing the account, in `users/domain/testPrincipalContainment.ts`.

It is composed rather than bolted on: `principalKind` and `containment` are REQUIRED inputs of the visibility
policy, the clone default, the shared correction-scope rule, the analytics capture seam, and the ratings,
collections, clone and erasure services, so every call site failed to compile until it decided what a test
principal means there — the technique 015 records for `hasAvailablePrivateSlot`. The correction rule is contained
in `evaluateCorrectionScope`, not in either adapter, so the mapping tier and the parse tier are contained by one
edit. A contained correction still lands, author-scoped: the grant does not apply and corroborators do not count.

Two decisions inside this are deliberate:

- **Denials run after any existence `404`**, never before it, so containment can never confirm that a private
  recipe or collection exists. A rating is refused before any read, because that refusal is about the principal.
- **Analytics is contained at the one seam every capture converges on** (`AnalyticsService.capture` and
  `ingestBatch` take the acting principal), so a capture site added later cannot forget it. Verification is contained
  the same way, at the top of `RecipesService.requestVerification`, whose containment subject is a required parameter.

Required fields cannot see a write path that never passes through a composed policy, so a guard covers that gap:
`packages/infra/global/__tests__/containmentDisposition.test.ts` discovers every `@Post`/`@Put`/`@Patch`/`@Delete`
handler on a recipe-service controller, and every queue-port `enqueue*` call, from the AST. Each must carry a written
disposition in its register: the contained actions it reaches, `ownerScoped` with a reason, or `sharedByRuling` with
the ruling or ADR that accepts it. The check runs in both directions, and every contained action must be reached by at
least one entry. An enqueue that reaches a contained action must sit in a function that itself calls the policy. A
handler's claim is recorded rather than traced through the call graph.

### 3. A registry makes the stage's SQL able to tell test rows from real ones

`test_principals` (migration 0044) is a read model upserted by `AuthMiddleware` the first time a process sees a
signed test principal. A failed write is logged and not memoized; it never fails the request. On an enforcing
stage the corroborator readers in `resolutionMappings.dal.ts` and `parseCorrections.dal.ts` exclude registered test
principals, for every caller: a real user's correction on production must not count a test row as its corroborator
either, which is the direction the caller's own containment cannot reach. Both readers take that scope as a required
parameter, built from the stage alone by `corroboratorScopeFor` (`stageContains`), so no caller reaches either reader
without deciding.

### 4. Containment decides on the claim alone; the purge requires the claim AND the registry

This asymmetry is the security argument and must not be collapsed into one rule:

- **Containment is fail-closed on the claim.** A real user an operator mis-marks loses publish on production —
  noisy and harmless.
- **The purge destroys data with no carve-out**, so it requires the verified token to say test principal AND the
  registry to hold the principal. That is one witness checked twice, not two independent witnesses: the registry is
  written from the claim, so it guards against a process that never registered the principal (or whose registration
  failed), and not against a Clerk user an operator mis-marks. For that user, whoever holds their session can
  hard-delete all of their own data, public recipes, ratings and corrections included, with no confirmation phrase.

#### Precondition: an independent witness before any production tenant

Before a production test-pool tenant exists, and before the production k6 gate lifts to authenticated scenarios, the
purge must require a witness that is not derived from the claim. The candidate is the verified `email` claim matching
a per-stage anchored pattern (`TEST_PRINCIPAL_EMAIL_PATTERN`; production `^testpool-[a-z0-9]+@testpool\.commise\.app$`,
ruling 6's addresses) with the door closed when the pattern is unset. It is a different write path: an operator marks
`public_metadata` through the Backend API, while the address belongs to a subdomain with no mail exchanger that no one
can verify. It needs the Clerk session token template to carry `email`, which is an owner action in the Clerk
dashboard. The same precondition covers food-service's authored-food purge, which has no registry at all.

### 5. The purge is a repeatable Command executed by the erasure worker module

- `POST /api/v1/account/test-reset` takes no body. It records a `test_reset_jobs` row (migration 0045; at most one
  active job per user, arbitrated by a partial unique index) and enqueues a `testPrincipalReset` message on the
  existing account-erasure queue. `GET /api/v1/account/test-reset/{jobId}` reports the job. Anyone the
  claim-and-registry gate refuses — and any id that is not the caller's own job, including a malformed one — receives `404 NOT_FOUND`,
  so the door is indistinguishable from an unrouted path. Containment does not close this door: the reset is the
  same Command on every stage.
- **It is not one-shot**: an in-flight job is returned, a completed one blocks nothing.
- **The erasure message becomes a discriminated union.** An ABSENT `kind` still means an erasure, so every message
  produced before this decision is honoured; an UNRECOGNISED kind is refused and fails the delivery, so a kind an
  older consumer does not know can never run as an erasure.
- **The worker's `purgeTestPrincipalRows` deletes everything user-keyed**, with no public carve-out and no
  pseudonymization, and sweeps the principal's whole owner prefix in both buckets. The erasure worker's docstring
  sentence "the ONLY code path permitted to issue `DELETE FROM recipes`" becomes "the ONLY module": the purge
  shares the module precisely so the hard-purge exemption stays in one place.
- **The worker's claim differs from erasure's.** A delivery claims only a `queued` reset job. A message that finds
  the job running, or finished, is acknowledged and purges nothing: a second purge beside a running one, or after a
  finished one, would reach the writes of a test run that started after the first purge completed. A message for an
  owner with no reset row, or with no registry row, is refused and fails the delivery. A failed invocation records
  its error and hands its own claim back to `queued`, so the queue's redelivery re-claims it; completion and release
  are both guarded on the claim's `attempts`, so neither can touch a newer invocation's claim. A dead invocation
  records nothing, so the erasure sweeper hands a `running` reset idle past its staleness window back to `queued`
  (guarded on the attempt it read) before re-sending it. It re-drains stuck resets as it re-drains erasures, so a
  lost send cannot hold the write lock below forever. Recovery from a dead invocation therefore waits for the
  sweeper's window rather than the next redelivery.
- **While a reset is active, `ErasureLockGuard` answers the principal's mutations with `423`**, reading the reset
  table only for a principal whose claim marks it `test`, so real users pay no extra round trip.
- **`testResetSweepCoverage`** folds the recipe migrations exactly as `erasureSweepCoverage` does and requires every
  user-bearing table to be mutated by the purge or exempt for a written reason.
- **A test principal's authored foods are purged by food-service itself**, through `POST
/api/v1/foods/authored/test-purge`, because the recipe purge cannot reach another service's database (ADR-0006)
  and food-service has no route that lists a caller's authored foods. The normal `DELETE /api/v1/foods/{id}` is a
  withdrawal that keeps the row, so a fixed pool slot would accumulate withdrawn foods for ever. The door takes no
  body and hard-deletes only the caller's own `private` authored foods that are not mid-erasure, letting the cascade
  remove nutrients, portions and versions. Promoted foods, catalog rows and demand rows stay. A pure policy admits a
  caller only when the signed claim says test principal, the principal is a person, and its ULID has synced. Every
  other authenticated caller receives the exact `404` an unrouted path answers. No normal-user route, response or
  authorization changes. Food-service keeps no registry, so the claim is this door's only check; section 4's
  precondition covers it.

### 6. The ADR-0027 amendment, stated narrowly

ADR-0027's rule stands for erasure: no erasure sweep targets the correction tables. The purge is not erasure. It may
hard-delete a test principal's rows in `ingredient_resolution_mappings` and `ingredient_parse_corrections` by
`user_id`, and the corroboration bindings that cite them, because (a) the owner ruled so, (b) the signed claim and
the registry must both name the principal — which, as section 4 states, is one witness checked twice and is why an
independent witness is a precondition of any production tenant — and (c) on an enforcing stage a test principal can neither promote nor corroborate, so on production those
rows bind only the test principal itself.

### 7. The deploy switch

`TEST_PRINCIPAL_CONTAINMENT` is validated by each service's config schema: `enforce` or `off`, defaulting to
`enforce`, and any other value fails the boot. The stacks set `off` from an ALLOWLIST — recipe: `sandbox` and
`pr-{N}`; identity: `sandbox` — and leave every other stage, production included, unset. Each stack's test asserts
it per stage.

## Alternatives rejected

- **Read-side exclusion** (hide test content from real viewers). It touches every hot read path, a missed path
  leaks, and views and corrections still land. Flip to it only if a production flow ever needs a test principal to
  see another test principal's public content.
- **Run-namespaced data with production read-only.** It contradicts ruling 5's path to authenticated production
  scenarios, and it silently measures nothing there.
- **Enable Clerk test mode on the production instance.** It hands the fixed verification code to anyone who
  registers a `+clerk_test` address on production.
- **Erasure as the reset.** One-shot, keeps public content, and destroys the Clerk user.
- **Hashing a run onto a pool slot.** Two runs can address one user; `runFixtureIdentity.ts` records that incident.
- **A route Guard for containment.** ADR-0023's reasoning: the routes stay open, and what is authorized is a field
  value or an effect.
- **A separate queue for resets.** Heavier infrastructure for no isolation the job-row interlock does not already
  give, and it would put the hard purge outside the one module permitted to perform it.

## Consequences

- Sandbox and production diverge by configuration, and the divergence is guarded per stage in each stack's tests.
- A signed test principal on production can create and edit private content, read, correct ingredients for itself,
  and reset itself. Three things it does still reach shared state, each accepted by name in the containment
  register: adding, admitting or settling a food writes the shared ingredient catalog, under ruling 1; a freeform
  ingredient writes a user-entered name into that same catalog; and a parse job spends the shared LLM pool and writes
  the shared parse cache.
- The identity and recipe services each carry the two-value mode vocabulary in their own config schema; each
  service owns its config (the house rule), and a divergence would fail that service's boot, not silently widen.
- The account-erasure queue now carries two kinds of work, and the worker dispatches on an exhaustive switch.
- `test_principals` and `test_reset_jobs` are user-bearing tables; GDPR erasure deletes both principals' rows, and
  the erasure sweep-coverage fold counts them.

## Residual risk

- **A write path missed by the composition.** The required fields make every existing call site decide, and the
  compiler cannot see a path that never reaches a composed policy. Ingredient verification was such a path. The
  containment-disposition guard now requires a decision for every write handler and every queue enqueue, but it
  traces only an enqueue's own function: a handler's `reaches` is a recorded claim, and a write that leaves the
  service by another mechanism, such as a direct cross-service call, is not discovered.
- **Parse jobs spend the shared LLM pool.** A contained test principal's parse job, retry or line edit runs the
  gated LLM leg against ADR-0024's single $100/month production pool and writes the shared parse cache. The job's
  rows are the principal's own and the cache is keyed by the exact line, so no real user's data changes, but a load
  run can exhaust the ceiling and deny real users' parses and verifications until the month turns. Containing it
  would stop the tiers exercising the import flow on production; the decision is the owner's, and it binds before
  the production k6 gate lifts.
- **A freeform ingredient name is shared.** Ruling 1 excludes food from containment; whether a user-entered
  ingredient name counts as food is not ruled. A test principal's freeform ingredient is visible in every cook's
  search.
- **The parse-correction tier has no live write route.** Its policy is contained and its corroborator reader
  excludes registered test principals through a required parameter; the route that makes it live must pass
  `corroboratorScopeFor`, as the mapping tier does.
- **Deploy ordering.** A recipe service that emits `testPrincipalReset` ahead of a worker that does not know the
  kind would have that older worker read the body as an erasure; the job-row interlock then refuses it (no erasure
  row exists), unless a test principal also holds a completed erasure row, where the older worker replays an
  erasure. The workers must deploy no later than the service.
- **Load still reaches real users.** Containment scopes data, not capacity: production k6 shares the RDS instance
  and Fargate tasks with real traffic, and the analytics in-flight bound can shed real users' client-door events
  under load.
- **The purge leaves object versions.** Both buckets are versioned and the worker holds no `s3:DeleteObjectVersion`,
  so a swept object becomes a delete marker — the gap ADR-0013 already records for erasure.
- **Collateral the purge cannot see.** A test principal's handle frozen onto someone else's clone of its collection
  stays; a corroboration binding the principal helped produce is deleted with it; a real user's row the principal's
  row superseded stays retired with no successor. On an enforcing stage containment prevents all three from arising.
- **Service-principal erasure is not contained.** A Clerk-side deletion of a pool user reaches the internal erasure
  route with no claim to read; deleting a pool user in Clerk is an operator act, and it retires the slot.
- **The registry is derived from the claim.** Section 4 states what the registry check does and does not protect, and
  the independent-witness precondition it sets.
