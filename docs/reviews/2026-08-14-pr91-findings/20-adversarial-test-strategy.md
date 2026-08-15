# 20 — Adversarial review: can PR 91's settled test strategy actually prove what it claims?

**Posture**: refutation. The default verdict is _"this cannot be proven"_ unless I opened the code that
proves it. Every claim carries a `file:line` that I read. Where an attack failed, the evidence that
defeated it is stated so the design gets credit for what it already has.

**Builds on** `docs/reviews/2026-08-14-pr91-findings/07-test-coverage.md` (the tier/gap audit — not
re-derived) and `12-adversarial-status-shells.md` (ADR-0019 §4/§5). Governed by `CLAUDE.md` →
_Testing policy_ and `docs/CODING_STANDARDS.md` §7 / §7.1 (matrix `:469-484`, tier tables `:490-505`,
the four-leg rule `:522-528`).

**Settled decisions under attack** (owner, 2026-08-14): mocked Playwright for the UI state matrix +
a LOCAL FULL STACK (Docker Postgres + LocalStack) for the real spine, no deployed-preview dependency;
the flow to prove is _recipe created → ingredient resolution → food PLACEHOLDER row → status advances
as USDA data arrives → full entry filled → nutrition appears on the recipe_; PR 91 also lands a
message substrate (durable, grouped, guaranteed delivery, latest-in-group wins) and all the findings.

**I ran no test suite and no Playwright.** All pass/fail statements are absent by design; everything
below is from reading source, configs and workflows.

---

## Can the flow be proven locally

### The flow decomposes into six legs. Four exist in isolation. Two have no environment at all.

| #   | Leg                                                 | Provable locally today?                      | Where                                                                                                      |
| --- | --------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 1   | recipe created                                      | **Yes**                                      | `recipe-service/vitest.e2e.config.ts:16` → `tests/global-setup.ts` (real PG + LocalStack S3/SQS), 14 specs |
| 2   | ingredient resolution (recipe → food over the wire) | **NO — no environment exists**               | see A-1                                                                                                    |
| 3   | food PLACEHOLDER row created                        | **Yes**                                      | `food.dao.ts:252-253` `INSERT … status 'PENDING'`; `tests/e2e/foods-api.e2e.test.ts`                       |
| 4   | status advances as USDA data arrives                | **Yes, with a caveat**                       | `tests/e2e/usda-adapter-http-contract.e2e.test.ts`; caveat in A-3                                          |
| 5   | message substrate                                   | **NO — nothing exists to test**              | see A-4                                                                                                    |
| 6   | nutrition appears on the recipe                     | **Yes for the read; NO for the propagation** | `recipes.service.ts:367-386`; see "Testing live reference"                                                 |

The decision is therefore not "wire up the harness we have". Legs 2 and 5 require an environment that
**has never existed in this repo and has been deliberately avoided in every harness**.

### A-1 — Nothing in this repository has ever booted the food service and the recipe service together, and three separate places record that as an intentional choice

**Claim attacked.** "A LOCAL FULL STACK (Docker Postgres + LocalStack) for the real spine."

**Evidence.**

- **The recipe e2e harness points food at a dead port on purpose.**
  `packages/services/recipe-service/tests/e2e/harness.ts:88-91` defaults
  `FOOD_SERVICE_URL=http://localhost:3002` and the comment states nothing listens there — required
  since issue #120, deliberately unreachable.
- **The recipe k6 tier does the same, and argues for it.** `.github/workflows/_ci-heavy.yml:578` sets
  `FOOD_SERVICE_URL=http://localhost:3002`; `:604-611` — _"the food-catalog half is deliberately left
  UNREACHABLE here … An unreachable food service is the exact worst case the script exists to
  defend"_.
- **The Maestro path filter excludes food-service for a measured reason.**
  `.github/workflows/heavy-e2e.yml:210-216` — _"the food service is never booted and
  `FOOD_SERVICE_URL` deliberately points at nothing … No food-service change can alter that outcome,
  so triggering the emulator on one would buy literally zero additional coverage."_
- **Every recipe-side test of the resolution path mocks the client object, not the transport.**
  `__tests__/integration/ingredients/disambiguation.integration.test.ts:93,103,104,132,133,163,179`
  and `add-by-name.integration.test.ts:85,102,113` are `vi.mocked(food.getStatus)` /
  `vi.mocked(food.addByName)`. The one spec that stands up a real `node:http` server —
  `food-token-forwarding.integration.test.ts:116,211,313` — stands up a _stand-in_, and tests token
  forwarding and timeouts, not the state machine.
- **Even the CI job that provisions the most AWS never dials it.** `e2e-food` runs a 9-service
  LocalStack (`_ci.yml:710`) that the suite never touches; the job says so at `_ci.yml:685-687`.

**Verdict.** **SURVIVES.** Leg 2 — the single edge the whole flow hinges on — has zero coverage at any
tier, in any environment, and the repo has three written justifications for keeping it that way. The
settled decision reverses all three without naming them.

### A-2 — The three compose files cannot be composed: they collide on both ports, disagree on the LocalStack image, and each define one database

**Claim attacked.** That "Docker Postgres + LocalStack" is an existing capability to be reused.

**Evidence.**

| File                                                              | Postgres   | DB / user                             | LocalStack image               | `SERVICES`                                                        |
| ----------------------------------------------------------------- | ---------- | ------------------------------------- | ------------------------------ | ----------------------------------------------------------------- |
| `docker-compose.yml:27,49`                                        | `:34` 5432 | `commise`/`commise`                   | `localstack/localstack:3`      | `:58` `s3`                                                        |
| `docker-compose.test.yml:23,46`                                   | `:29` 5432 | `kitchensink_recipes`/`postgres`      | `localstack/localstack:3`      | `:57` `s3,sqs`                                                    |
| `infra/localstack/docker-compose.yml:47,29`                       | `:52` 5432 | `food_e2e`/`postgres`                 | `localstack/localstack:4.4.0`  | `:37` `secretsmanager,events,sqs,sns,sts,iam,logs,cloudwatch,ssm` |
| `packages/services/identity/infra/docker/docker-compose.yml:4,21` | 5432       | `kitchensink_identity`/`identity_app` | `localstack/localstack:latest` | `:25` `sqs,s3,secretsmanager,ssm,events`                          |

All four bind host `5432` and `4566`. Two of them cannot run at the same time. The "shared E2E harness
foundation" (`infra/localstack/docker-compose.yml:37`) **omits `s3`**, which recipe's `global-setup.ts:116-123`
unconditionally provisions — so running recipe's e2e against `npm run localstack:up`
(`package.json:42`) fails, and the only compose that matches recipe is `docker-compose.test.yml`,
which lacks food's database. There is no compose file from which the stated flow can be run.

**Verdict.** **SURVIVES.** A new compose file is a build item, not an assumption. It must carry: one
Postgres with `recipe_e2e` **and** `food_e2e` (or two Postgres services on distinct ports), one
LocalStack tag, and the union of `SERVICES`.

### A-3 — The worker is driven through DI in every e2e; the real drain loop is only ever exercised at the integration tier

**Evidence that partly defeats the attack.** `tests/worker-runtime.integration.test.ts:1-4` drives the
REAL `WorkerRuntime` against real Postgres — the advisory lock, the `LISTEN fetch_queued` wake
"within ~100ms of a NOTIFY", and the graceful-shutdown lease release. The queue wake path IS proven
locally, and that is a genuine asset.

**What survives.** Every food **e2e** spec drives `FoodConsumerService` over the app's own DI
instances instead (`tests/e2e/change-refresh.e2e.test.ts:3-10`, `foods-api.e2e.test.ts`,
`usda-adapter-http-contract.e2e.test.ts`). So no single test crosses `enqueue → NOTIFY → lease →
USDA → merge → setStatus` as an out-of-process worker. For the stated flow that matters: the
placeholder's advance is triggered by a **separate Fargate process** in production
(`worker/main.ts:39`), and the local proof would substitute a function call for a process boundary.

**Verdict.** **SURVIVES, narrowed.** The mechanism is covered; the _composition_ across the process
boundary is not.

### A-4 — The message substrate has no implementation, no precedent, and its two chosen technologies are on opposite sides of the LocalStack Community line

**Evidence.**

- **Zero FIFO anywhere.** `grep -rn "MessageGroupId|FifoQueue|ContentBasedDeduplication|MessageDeduplicationId|\.fifo"`
  over `packages/`, `infra/`, `.github/` returns **no hits in code**. Every occurrence is spec text for
  an unbuilt service (`specs/014-notification-service/spec.md:422,679`,
  `product-spec/product-spec.md:293`, `v-model/architecture-design.md:102,635,698,774`), and 014's own
  `sync-report.json:71` records the drift: _"plan.md contains 0 occurrences of FIFO, ordering,
  partition, or MessageGroupId"_.
- **Zero Valkey/Redis anywhere.** No `valkey`/`redis`/`ioredis` dependency in any `package.json`; the
  only source-file hits are the substring `redispatched` (`recipe-workers/src/handlers/erasure-sweeper.ts:270`)
  and `requireDisposableDatabaseUrl` (`food-service/tests/load/perf-fixture.ts:413`). ADR-0016's title
  line names the store: **ElastiCache Serverless for Valkey**.
- **LocalStack Community tier split.** SQS — including FIFO queues — is Community. **ElastiCache is
  Pro-only.** The harness comment already commits to Community:
  `infra/localstack/docker-compose.yml:6-8` — _"on the FREE Community tier — no auth token … the
  Pro-only services (RDS, ECS) are deliberately avoided"_ — and `_ci.yml:705-709` repeats it: _"Add
  `LOCALSTACK_AUTH_TOKEN` only if a Pro feature is ever adopted."_
- **No emitter path exists either.** `FoodEventEmitter`'s bus is `ConsoleEventBus`
  (`src/events/food-event-emitter.ts:202-215`), wired unconditionally at `src/worker/main.ts:64`;
  `@aws-sdk/client-eventbridge` is a dependency of no package. Every e2e substitutes an in-memory
  capture bus (`foods-api.e2e.test.ts:195`, `usda-adapter-http-contract.e2e.test.ts:209`,
  `change-refresh.e2e.test.ts:158`).
- **And nothing consumes the event that does exist.** `FoodFetchCompleted` is published
  (`worker/food-consumer.service.ts:288,317,619`) and a `FoodFetchCompletedRule` is declared in CDK,
  but no service subscribes. Recipe-side status advance is entirely client-poll-driven
  (`ingredients.service.ts:395-426`).

**Verdict.** **SURVIVES.** The correct local shape is **LocalStack Community SQS FIFO + a plain
`valkey/valkey` Docker container** — _not_ LocalStack ElastiCache, which needs a Pro token this repo
has explicitly refused. That divergence (real ElastiCache in prod, a raw Valkey container locally) is
acceptable — the wire protocol is identical — but it must be a stated decision, because it means the
local tier proves the client's use of Valkey and proves **nothing** about ElastiCache Serverless's
failover behaviour, which ADR-0016 itself records as lossy (`spec.md:537-541`).

### A-5 — The two services' local auth strategies are mutually exclusive, so leg 2 cannot be booted without changing one of them

**Evidence.**

- Recipe calls food **as the caller**: `ingredients.service.ts:26-32` — _"Food-service verifies a Clerk
  token, so the only credential that can satisfy it is the requesting user's own … `undefined` means
  the request carried no bearer (the non-production dev-auth bypass)."_
- Recipe's e2e harness **forces** `NODE_ENV=development` (`tests/e2e/harness.ts:60-62`) and offers
  `RECIPE_DEV_AUTH_USER_ID` (`:70`) — the bypass path, under which requests carry no bearer.
- `_ci-heavy.yml:613-616` states the consequence measured in production shape: _"the load container
  runs with the dev-auth bypass, so requests carry NO bearer … With no credential the gateway degrades
  WITHOUT issuing a request."_ That is a **short-circuit**, not a call — so a full-stack test run this
  way would pass while food was never contacted.
- Food's e2e boots the REAL `FoodAuthGuard` and needs genuinely-signed RS256 tokens
  (`tests/support/jwt.ts:1-14`).

**Verdict.** **SURVIVES, but the fix is small and the asset already exists.** `tests/support/jwt.ts`
generates a throwaway keypair whose SPKI PEM works verbatim as `CLERK_JWT_KEY`. The full-stack harness
must mint one token from one keypair and set that PEM as `CLERK_JWT_KEY` for **both** services, with
the dev-auth bypass **off** on recipe. If it is left on, the test is green and vacuous — and that is
the single most likely way this harness ships as theatre.

### What must be built before the flow can be proven — the honest list

1. A composed `docker-compose.fullstack.yml`: one Postgres serving `recipe_e2e` + `food_e2e`, one
   LocalStack tag with the union `SERVICES` (+ SQS FIFO), one `valkey/valkey` container.
2. A **cross-service e2e tier that has no owner today.** Neither `vitest.e2e.config.ts` can boot the
   other service; `packages/tools/service-test-harness/src/boot-service-app.ts` boots one AppModule
   per process. This is a new package or a new tier with a new CI job — and per §7 `:522-528` it needs
   all four legs, which F-T4 (07-test-coverage) says nothing guards.
3. A food-service e2e harness module. `boot-service-app.ts:40-46` names its absence as _"a known gap,
   not a design choice"_; all five DB-touching food specs duplicate the pg-pool + `resetSchema` block.
4. A shared token minter promoted out of `food-service/tests/support/jwt.ts` into
   `packages/tools/test-utils` so both services' harnesses use one keypair.
5. The substrate itself, plus a consumer. Today there is neither.

---

## What the local tier cannot catch

### A-6 — The USDA fake is good, and it is frozen. Nothing in the repo detects USDA wire drift.

**Evidence that defeats the weak form of the attack.** The fake is genuinely strong:
`tests/e2e/usda-adapter-http-contract.e2e.test.ts:1-19` runs the **real** `UsdaApiClient` + real
`UsdaSourceAdapter` against **captured real USDA wire payloads**, intercepted at the transport with
undici `MockAgent` (`:31`, `:48`, `:121-135`). Status→typed-error mapping, nested-nutrient flattening,
per-serving reconciliation, `fdcId → externalKey`, the batch path and merge→persist all execute for
real. This is not a stub of our own shape — it is the vendor's bytes. Cases include `404 →
SourceApiError(404) → NOT_FOUND` and `429 → SourceApiError(429)`.

**What survives.** The fixtures are four files under
`tests/e2e/__fixtures__/usda/`, all with a single capture date (2026-07-06). There is **no capture
script, no refresh job, no scheduled live-contract probe** — `grep` for `api.nal.usda.gov` finds only
the default base URL (`clients/usda/src/UsdaApiClient.ts:47`, `food-service/src/config/env.schema.ts:45`),
one negative assertion (`usda-registry.test.ts:67`), and the two test files. Contrast the _internal_
contracts, which have a drift gate (`contract-drift`, `_ci.yml:253-276`) and per-client skew tests
(`clients/food-service/src/contractSkew.ts`, `clients/recipe-service/src/contractSkew.ts`). **The
boundary we trust least is the only one with no drift detector** — the same asymmetry F-T13 records
for `clients/usda` having the weakest tier.

**Class of defect the local tier cannot catch, named precisely:**

| Failure                                                                    | Local tier                                      | Tier that would catch it                                                                                                                        |
| -------------------------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| USDA adds/renames/retypes a field, or changes nutrient nesting             | **No** — replays 2026-07-06 bytes               | a scheduled live-probe job against the real FDC API with `USDA_API_KEY`, asserting the captured fixtures still parse and the shapes still match |
| USDA changes rate-limit semantics / `Retry-After` headers                  | **No**                                          | same                                                                                                                                            |
| USDA deletes or re-IDs an `fdcId` we hold a crosswalk for                  | **No**                                          | `change-refresh` against live, or a reconciliation probe                                                                                        |
| TLS/proxy/DNS/egress from the real task                                    | **No** — `MockAgent` never opens a socket       | sandbox smoke                                                                                                                                   |
| LocalStack SQS FIFO diverging from AWS SQS FIFO                            | **No**                                          | sandbox/prod smoke against real SQS                                                                                                             |
| ElastiCache Serverless failover dropping retained notifications            | **No** — a raw Valkey container has no failover | nothing in CI; this is an operational alarm, not a test (ADR-0016 records the loss as _"unrecoverable and silent"_)                             |
| Clerk token acceptance across the recipe→food hop with **real** Clerk keys | **No** — throwaway keypair                      | the sandbox deploy smoke (`sandbox-deploy.yml`, where `401` is the PASS)                                                                        |

**Verdict.** The fake proves the **adapter and the state machine**, which is most of the value. It
proves nothing about the live integration, and today nothing else does either. **This is the strongest
case for keeping one non-local tier** — the settled decision's "no dependency on a deployed preview"
is right for the _flow_ test and wrong as a blanket rule.

### A-7 — Mocked Playwright is not hermetic: it still provisions a real Clerk user on a shared, rate-limited dev instance

**Evidence.** `playwright.config.ts:51` `globalSetup: './tests/e2e/global.setup.ts'`;
`tests/e2e/utils/testUser.ts:31-34` throws without `CLERK_SECRET_KEY` and `:59` calls
`clerk.users.createUser`; `utils/auth.ts:10-13` the same. The API is mocked
(`page.route('**/api/v1/**')`, `_ci.yml:977-980`) but **auth is not**. The known-memory hazard — two
concurrent runs throttling one shared Clerk dev instance and turning CI red — is a live constraint on
the UI half of the decision.

**Verdict.** **SURVIVES.** "Mocked Playwright" ≠ "runs anywhere". Any claim that the UI matrix is
fully local is false unless a Clerk stand-in is introduced, which is a separate build item.

---

## Testing live reference

> **This is the section that should stop the decision as written.**

### A-8 — Nutrition is not a live reference. It is a three-layer cache, and the code deliberately optimises against ever re-reading it.

**Claim attacked.** _"Nutrition is a LIVE REFERENCE — recipe values change when the shared catalog
changes."_

**Evidence — the three layers, all read.**

**Layer A: food golden record → `ingredients` row. A one-shot snapshot.**
`packages/services/recipe-service/src/database/schema/ingredients.ts:58-66` stores
`calories_per_100g`, `protein_g_per_100g`, `carbs_g_per_100g`, `fat_g_per_100g` and `portions` **on the
recipe side**, commented _"populated from the food golden record once RESOLVED"_. The only writers are
`ingredients.service.ts:316-320` (`addByFoodId`) and `:406-411` (`refreshStatus`).

**Layer B: `ingredients` → recipe detail. Computed live, but only from LOCAL rows.**
`recipes.service.ts:367-386` assembles lines from `ingredientsDal.findByIds`
(`ingredients/dal/ingredients.dal.ts:195`) — the local table. `RecipesService`'s constructor
(`:327-351`) holds **no** food-service client. A recipe read never contacts food-service.

**Layer C: `recipes.lead_calories_per_serving`. Written at recipe-write time only.**
`database/schema/recipes.ts:124`; written at create `:513`, update `:703`, clone `:802`; the update is
gated `const recomputeLead = ingredients !== undefined || dto.servings !== undefined;`
(`recipes.service.ts:647`).

**Evidence — the propagation is not just missing, it is actively short-circuited.**

- The poller **stops at terminal**: `usePollIngredientStatus`'s docstring —
  _"it refetches only while the food is `PENDING` and stops the instant a terminal/`RESOLVED`/`UNRESOLVED`
  state arrives"_ (`features/recipes/src/hooks/usePollIngredientStatus.ts:10-13`).
- `addByFoodId` **explicitly refuses the round-trip** once nutrition is present:
  `ingredients.service.ts:279-285` — _"Already settled AND already nourished: nothing to admit and
  nothing to backfill — no round-trip."_
- The food side updates nutrients on an already-`RESOLVED` food **without any status change**:
  `merge-and-persist.service.ts` `mergeChangedSources` uses `FoodDao.touch`
  (`food.dao.ts:389-404`, bumps `updated_at` only) precisely because `RESOLVED → RESOLVED` is illegal
  under `LEGAL_PRIORS` (`food.dao.ts:182-188`). So the exact event that _should_ trigger live-reference
  propagation — change-refresh landing corrected USDA values — emits **no status transition at all**.
- And there is no consumer to receive one anyway (A-4).

**Consequence, stated concretely.** A recipe created while its ingredient is `PENDING` keeps a stale or
absent `lead_calories_per_serving` forever, because the only writer is a recipe edit that changed
ingredients or servings. Meanwhile its **detail** read picks up the backfilled value as soon as some
client polled. The list card and the detail page can therefore disagree — despite `recipe-core/nutrition.ts:66-69`
claiming the two "are computed from byte-identical inputs and can never disagree". The claim is true of
the _function_; it is false of the _stored_ value, because layer C's write is gated on a different
event than layer A's.

**Verdict.** **SURVIVES, decisively.** The settled decision states a property the system does not have,
in three independent places, one of which is a deliberate optimisation.

### Is there a test that would FAIL if live-reference propagation broke?

**No — and there cannot be one, because there is nothing to break.** I searched: no test asserts a
recipe's nutrition changes after the underlying food's nutrients change. The nearest thing,
`ingredients-suggest.service.test.ts:288` (`mockResolvedValue({ ...stale, caloriesPer100g: 165 })`),
mocks the DAL and asserts the _backfill on first resolve_, not re-propagation.

**Verdict on the sub-question posed:** as written, the decision **ships unverifiable**.

### How to make it deterministic — the only two shapes that are testable

A live-reference value **is** testable; the trick is to make the propagation event explicit and assert
on the _edge_, never on a number.

| Shape                                                                                                                                                            | What it is                                                                                            | The falsifying test                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **(1) True live read** — drop layers A and C; recipe reads nutrition from food-service per request, cached with an explicit TTL/ETag                             | Correct by construction; costs a cross-service read on every recipe detail, at import scale a fan-out | e2e: create recipe → assert calories `X` → mutate the food row → **without touching the recipe** re-read the recipe → assert calories `Y ≠ X`. Deterministic because the food row is mutated by the test. |
| **(2) Invalidated projection** (recommended) — keep the snapshot, add a `food_id → ingredients` invalidation on every food content change, and recompute layer C | Preserves the read path and the demand-weighted queue; needs the outbox 12-A-4 already demands        | Same e2e as (1), plus an integration test that a `touch`-only change (`food.dao.ts:402-404`) **emits an invalidation** — the assertion that kills the current shipped behaviour.                          |

**Both require a monotonic freshness anchor on the recipe side.** 12-A-1 already found that
`ingredients` carries `created_at` and **no** `updated_at` and no version column
(`ingredients.ts:50-68`), and that `IngredientsDal.updateResolution`
(`dal/ingredients.dal.ts:363-385`) is a bare unguarded `UPDATE`. Without that column, "did propagation
happen?" is not observable, so no test can assert it. **The column is a prerequisite for testability,
not just for correctness.**

---

## Falsifying the substrate guarantee

"Durable, grouped, guaranteed delivery, latest-in-group wins" is four claims. They need four different
kinds of test, and **only two of the four can be tested in CI at all**.

### A-9 — FIFO-per-recipient makes the supersession logic untestable through the bus, which is the opposite of reassuring

If `MessageGroupId = recipient.id` (`specs/014-notification-service/product-spec/product-spec.md:293`),
AWS SQS FIFO delivers strictly in order **within the group**. So an end-to-end test through the bus
**can never produce the out-of-order arrival that supersession exists to handle** — it will pass
whether the supersession logic is correct, inverted, or deleted. This is the classic
coverage-theatre shape: the environment guarantees the property the assertion is checking.

Two consequences that must be designed for, not discovered:

1. **Supersession must be a PURE function** — `(highWaterMark, incomingSequence) → admit | discard` —
   unit-tested exhaustively in isolation, including `<`, `=`, `>`, `undefined`, and wraparound. The bus
   test then proves only wiring. Any design that buries the compare inside a Lua script or a consumer
   handler is untestable by construction.
2. **FIFO-per-recipient is head-of-line blocking at import scale.** One stuck entity's message blocks
   every other entity's message for that user — and 004 allows 1,000 recipes per file
   (`specs/004-recipe-importing/spec.md:299`). That is a load property, not a correctness one, and it
   needs a k6 scenario, not a unit test.

### The adversarial matrix

| Scenario                                     | Falsifying test                                                                                                                                                            | CI-testable?                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Out-of-order arrival**                     | Feed the consumer's supersession function seq 4 then seq 3 directly; assert terminal state is seq 4's                                                                      | **Yes — unit only.** Impossible through FIFO (A-9). Through a _standard_ queue it is possible but non-deterministic; do not try.                                                                                                                                                                                                                                                                                                                                                    |
| **Redelivery after ack** (12-A-2's scenario) | publish 3, publish 4, **client**-ack 4, redeliver 3, assert client terminal state unchanged                                                                                | **Partly.** The SQS ack and the client ack are different acks — FR-045 conflates them (`spec.md:640-642` vs `:657-660`). Testable at the consumer+store layer with a fake bus; **not** testable end-to-end until FR-045's self-contradiction is resolved. This is 12-A-2's "missing acceptance test" and it is still missing.                                                                                                                                                       |
| **Consumer crash mid-ack**                   | Process message, kill the process before `DeleteMessage`, restart, assert exactly-once _effect_ (idempotent projection), not exactly-once delivery                         | **Yes**, with a real LocalStack SQS visibility timeout and an out-of-process consumer. Needs the process boundary A-3 says no e2e has today. Slow (visibility timeout ≥ 1s), so it belongs in the integration tier with a short timeout, not e2e.                                                                                                                                                                                                                                   |
| **Two producers on one group**               | Two concurrent writers advance the same entity; assert the sequence is minted **in the same statement that writes the row** so both cannot mint the same value             | **Yes — integration, real Postgres.** This is 12-A-1's "state the multi-worker rule". Today it cannot be written: `ingredients` has no sequence column.                                                                                                                                                                                                                                                                                                                             |
| **Slow consumer misses intermediate states** | Emit `queued→processing→succeeded` faster than the consumer drains; assert the consumer's _final_ state is `succeeded` and that skipping intermediates is **not** an error | **Yes — unit/integration.** This is the property supersession is _for_, and it is the cheapest one to prove.                                                                                                                                                                                                                                                                                                                                                                        |
| **Guaranteed delivery**                      | Inject a **throwing** bus; assert the state change either rolls back or the event is durably retained (outbox)                                                             | **Yes — and it currently FAILS by design.** `food-event-emitter.ts:169-177` try/catches the put and swallows it (`:10-12`: _"fire-and-forget: a bus failure is logged … and swallowed"_). One test exists that injects `throw new Error('eventbridge down')` (`src/events/__tests__/food-event-emitter.test.ts:87`) — and it asserts the swallow is **correct**. That test must be **inverted** by PR 91, or "guaranteed delivery" is false and a test actively certifies it false. |
| **Durability across store failover**         | Kill the Valkey node mid-flight, assert retained notifications survive                                                                                                     | **No.** A raw local container has no failover; ElastiCache is Pro-only in LocalStack (A-4). ADR-0016 already concedes the loss is _"unrecoverable and silent"_. **Do not claim durability that no tier can prove** — record it as accepted residual risk with an alarm.                                                                                                                                                                                                             |

### A-10 — "Guaranteed delivery" is falsified today by a shipped test that asserts the opposite

Worth isolating because it is the sharpest single item in this review. `food-event-emitter.test.ts:87`
is a test whose purpose is to prove the emitter **loses the event quietly** when the bus is down. That
is the correct test for the current fire-and-forget design and the wrong test for the settled design.
Shipping the substrate without inverting it means the repo will contain an executable assertion that
delivery is **not** guaranteed, sitting green next to a claim that it is.

---

## Findings with no falsifying test

The task names "112 findings". **I could not verify that number and no authoritative list exists.**
`ls docs/reviews/2026-08-14-pr91-findings/` shows 15 documents and no index/rollup; `grep -rn "112"`
across them matches only line references. Counting `##`/`###` finding headings across all 15 gives
**174**, not 112 (`01`:11, `02`:9, `03`:16, `04`:6, `05`:15, `06`:11, `07`:16, `08`:14, `09`:26,
`10`:0, `11`:9, `12`:11, `13`:10, `14`:15, `15`:5). **This is itself the first gate defect:** a PR whose
acceptance criterion is "all N findings fixed" against a set nobody has enumerated is unfalsifiable by
construction. Before anything else, the findings need one numbered, machine-readable index with a
per-finding disposition (fixed / deferred / rejected) and, for "fixed", the test that proves it.

Findings whose fix has **no test that would catch a wrong fix**, verified individually:

| Finding                                                                                                                                                                                                                             | Why no test catches a wrong fix                                                                                                                                                                                                                                   | Smallest falsifying test to add                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **09 F-DB1–F-DB16's D-1…D-10** (`09-data-model.md`, ten OPEN decisions: where the shell lives, where per-entity status lives, keying, envelope shape, typeahead visibility, guard mechanism, sweep, history, retention, 006 impact) | These are **undecided**, not merely untested. No test can be written against an unchosen shape, and a PR that silently picks one leaves nine unrecorded.                                                                                                          | Not a test — a written ruling per decision, each citing the test that will enforce it. **This blocks TDD entirely for the state machine.**                                                                             |
| **12-A-2 / FR-045 self-contradiction** (`spec.md:640-642` vs `:657-660`)                                                                                                                                                            | The two sentences specify opposite behaviours; either implementation satisfies "the spec".                                                                                                                                                                        | Resolve first, then: publish 3, publish 4, ack, redeliver 3, assert terminal state unchanged.                                                                                                                          |
| **12-A-3 / `updateResolution` is unguarded** (`ingredients.dal.ts:363-385`)                                                                                                                                                         | Any status can be written over any status; `refreshStatus` (`ingredients.service.ts:395-422`) is already a second writer. A fix that adds a _legal-priors_ predicate but no _sequence_ predicate still loses to a stale poll — and no test distinguishes the two. | Integration, real PG: write seq 5 `RESOLVED`, then write seq 3 `PENDING`; assert the row is still `RESOLVED` **and** `rowCount = 0` was treated as "stale, ignored", not "row missing".                                |
| **12-A-4 / no outbox; emitter swallows**                                                                                                                                                                                            | See A-10 — the existing test certifies the loss.                                                                                                                                                                                                                  | Invert `food-event-emitter.test.ts:87`; add: throwing bus → assert the outbox row exists in the same transaction as the status row.                                                                                    |
| **12-A-8 / shells are never deleted** (no `DELETE FROM food` in `food-service/src`; global unique name `food.ts:110`; no owner column)                                                                                              | A reclamation rule that is written wrong (too aggressive, or scoped by prefix) has no assertion to violate. `pr-scope.test.ts` is the in-repo precedent for exactly this class of scope bug.                                                                      | Integration: create a `PENDING` shell with no `fetch_queue` row and no referencing `ingredients` row, advance the clock past N days, sweep, assert deleted — **and** assert a shell that IS referenced is NOT deleted. |
| **12-A-10 / `IngredientsDal.search` leaks non-terminal placeholders** (`ingredients.dal.ts:149-170`, no status/owner predicate; ownerless table `ingredients.ts:48-88`)                                                             | A fix that filters in the _service_ rather than the _DAL_ passes any service-level test while the DAL stays leaky for the next caller.                                                                                                                            | DAL-level integration: insert a `PENDING` placeholder, call `search`, assert absent. Assert at the DAL, not the service.                                                                                               |
| **F-T5 / `ARGOS_ENABLED` unset** (`_ci.yml:1238-1240`)                                                                                                                                                                              | Config-only; setting the variable wrong (or at the wrong scope) produces the same silent no-op.                                                                                                                                                                   | A workflow-invariant test asserting the gate's variable exists — the `workflow-invariants.test.ts` pattern already in `packages/infra/global/__tests__/`.                                                              |
| **F-T4 / no guard holds vitest tiers to CI**                                                                                                                                                                                        | A new tier added by PR 91 with no CI job is green and dark. Two-for-two record in this repo (`_ci.yml:744-749`, `:530-532`).                                                                                                                                      | The filesystem-discovering guard F-T4 specifies; reuse `k6-load-tier-wiring.test.ts`'s workflow parser. **PR 91 adds at least two new tiers, so this is a prerequisite, not follow-up.**                               |
| **Dual enqueue implementations** (`fetch-queue.dao.ts:87-107`/`:119-143` have **zero production callers**; production uses raw SQL in `enqueue.emitter.ts:126-174`)                                                                 | Both are tested; only one runs. A fix to the invariant applied to the tested-but-dead one is green and inert.                                                                                                                                                     | Delete the dead pair, or add a test asserting the two produce identical rows. Prefer deletion.                                                                                                                         |
| **`auth-dos.e2e.test.ts` never resets the schema** (imports neither `pg` nor `resetSchema`; runs first alphabetically under `fileParallelism: false`)                                                                               | Order-dependent; a future spec reordering silently changes what it runs against.                                                                                                                                                                                  | Add the `resetSchema` block, or assert a known-empty precondition.                                                                                                                                                     |

---

## Required gate evidence for PR 91

**Release decision: NOT READY to open PR 91 under the settled strategy.** Not because the branch is
red — 07-test-coverage verified 25/25 base + 4/4 heavy green — but because two of the six legs the PR
must prove have **no environment**, one central claim (live reference) **contradicts three shipped
mechanisms**, and the acceptance criterion ("all findings") is **unenumerated**.

### Blockers — a wrong fix ships green without these

| #   | Gate                                                                                                              | Evidence that satisfies it                                                                                                                                                                            |
| --- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | **One enumerated findings index** with per-finding disposition and, for each "fixed", the test id                 | A committed `00-index.md`; a test asserting every finding id has a disposition                                                                                                                        |
| B2  | **The ten D-1…D-10 decisions ruled in writing** (`09-data-model.md`)                                              | ADR-0019 amended; each ruling names its enforcing test                                                                                                                                                |
| B3  | **FR-045's contradiction resolved** before any substrate code                                                     | Spec diff + the redelivery-after-ack acceptance test (12-A-2)                                                                                                                                         |
| B4  | **The full-stack harness exists and is proven non-vacuous**                                                       | A compose file per A-2; a spec that FAILS when the food container is stopped. **Without this negative control the harness is theatre** (A-5 is the exact way it ships green while contacting nothing) |
| B5  | **F-T4's tier-wiring guard**, before the new tiers land                                                           | The filesystem-discovering test; non-vacuity assertion in the shape of `k6-load-tier-wiring.test.ts:576`                                                                                              |
| B6  | **Supersession as a pure, exhaustively unit-tested function** + the throwing-bus test inverted (A-10)             | Unit table over `<`/`=`/`>`/absent; `food-event-emitter.test.ts:87` rewritten                                                                                                                         |
| B7  | **The live-reference decision restated to match reality** (A-8) — either shape (1) or (2), or the claim withdrawn | The mutate-the-food-row-then-re-read-the-recipe e2e; the `updateResolution` staleness test                                                                                                            |
| B8  | **`ingredients.resolution_sequence`** (or equivalent) exists and `updateResolution` is guarded on it              | 12-A-3's integration test                                                                                                                                                                             |

### Required, gating, and mechanical

- **F-T1 / F-T2** (07): fix mobile's self-testing e2e tier and its double-collection **before** adding
  to it.
- **F-T11**: `passWithNoTests: false` on every tier that has ≥1 spec — a relocated glob in a PR this
  size is a certainty, and today it exits 0.
- **F-T8**: copy `food-service/src/database/__tests__/pool-config.test.ts` to recipe-service. Bulk
  import is precisely what exhausts a pool.
- **k6 path filter**: extend `heavy-e2e.yml`'s `run_load_test` filter to the new import routes, and add
  a k6 script for FIFO head-of-line blocking at 1,000-recipe scale (A-9) and for the fairness collapse
  12-A-9 predicts.
- **F-T15**: one Playwright spec + one Maestro flow that drive `PENDING → RESOLVED` (serve PENDING on
  the first `page.route` fulfilment, RESOLVED on the second). This is PR 91's central UI mechanism and
  the repo has no executable precedent for it.
- **Coverage/mutation**: recipe-service already has a `test:mutation` (`stryker run`) script that no
  workflow invokes. Run it on the placeholder state machine's files in this PR and attach the report.
  It is the only evidence that settles the next section empirically rather than by argument.

### One non-local tier must survive

The decision's "no dependency on a deployed preview" is right for the **flow** test and wrong as a
blanket rule. A-6's table shows six defect classes no local tier can catch. Keep at least: the sandbox
deploy smoke (which already treats `401` as the PASS, per ADR-0010) and add a **scheduled** live-USDA
contract probe that re-validates the four frozen fixtures. Neither gates the PR; both alarm.

---

## The mutation lens — the placeholder state machine

The machine is `LEGAL_PRIORS` + `setStatus` (`food-service/src/foods/dao/food.dao.ts:182-188`,
`:303-333`). Its tests are `tests/food.dao.integration.test.ts:152-188` — **five cases**, which I read
in full. `LEGAL_PRIORS` encodes 5 legal pairs out of 25; the suite exercises 3 legal and 2 illegal.

| #   | Mutation                                                                                                 | Survives?                    | Why, and the consequence                                                                                                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M1  | Add `'RESOLVED'` to `PENDING`'s priors (allow `RESOLVED → PENDING`)                                      | **SURVIVES**                 | No test asserts `RESOLVED → PENDING` is rejected. A resolved food could be knocked back to a shell — and this is exactly the edit a naive "live reference refresh" implementer would make. |
| M2  | Drop `'FAILED'` from `PENDING`'s priors                                                                  | **SURVIVES**                 | Only `NOT_FOUND → PENDING` is tested (`:166-171`). `FAILED → PENDING` retry silently dies; a transiently-failed food becomes immortal.                                                     |
| M3  | Drop `\|\| status === 'FAILED'` from `isTerminal` (`food.dao.ts:305`)                                    | **SURVIVES**                 | Every `tombstoned_at` assertion for FAILED uses a raw SQL `UPDATE` (`:94`), never `setStatus`. FAILED rows get `tombstoned_at = NULL`, so the TTL reactivation at `:254-266` never fires.  |
| M4  | Drop `'UNRESOLVED'` from `RESOLVED`'s priors                                                             | **KILLED** — but only at e2e | No DAO test covers `UNRESOLVED → RESOLVED`; `tests/e2e/foods-api.e2e.test.ts`'s candidate-pick path catches it. A slow, distant test for a one-line table.                                 |
| M5  | Weaken `rowCount !== 1` to `< 1` (`:322`)                                                                | **EQUIVALENT MUTANT**        | `id` is the PK, so `rowCount > 1` is unreachable. No test can kill it; do not chase it.                                                                                                    |
| M6  | Invert the `WHERE … status IN (priorList)` predicate to `NOT IN`                                         | **KILLED**                   | `:174-178` and `:186-187`.                                                                                                                                                                 |
| M7  | Change `merge-and-persist.service.ts:389-391`'s `if (current?.status !== 'UNRESOLVED')` to `===`         | **UNKNOWN — not verified.**  | This read-then-check exists solely to dodge the illegal `UNRESOLVED → UNRESOLVED`. I did not read `tests/merge-and-persist.integration.test.ts`; flagging rather than asserting.           |
| M8  | `food-consumer.service.ts:281` `candidates.length === 0 && failedSources === 0` → drop the second clause | **UNKNOWN — not verified.**  | Would classify "all sources errored" as `NOT_FOUND` instead of retry-then-`FAILED`. `tests/food-consumer.integration.test.ts` not read.                                                    |

**Recipe half — worse.** `IngredientsDal.updateResolution` (`ingredients.dal.ts:363-385`) is an
unguarded `UPDATE`, so there is **no guard to mutate**: every "flip a guard" mutation is vacuous
because the guard does not exist. The recipe-side state machine is not under-tested; it is **absent**.

**Bottom line for the lens:** three of eight named mutations to the shipped guard survive, all three in
the direction PR 91 pushes (reactivation, retry, terminal TTL). The fix is cheap and mechanical —
a table-driven test over all 25 `(prior, target)` pairs asserting legal/illegal against `LEGAL_PRIORS`
itself, plus a `tombstoned_at` assertion on the `PENDING → FAILED` edge — and it should land **before**
the state machine acquires a second writer.

---

## Not examined

- **I ran nothing.** No `npm test`, no vitest, no Playwright, no k6, no `docker compose`. No claim here
  is an observed pass or fail; all are derived from reading source, configs and workflows.
- **PR 91's actual diff.** Not on this branch; not fetched. Everything about "what PR 91 does" comes
  from the task statement and from the specs/ADRs it implements.
- **Not read:** `tests/merge-and-persist.integration.test.ts`, `tests/food-consumer.integration.test.ts`,
  `tests/change-refresh.consumer.integration.test.ts`, `tests/food-refresh.integration.test.ts` — which
  is why M7 and M8 are **UNKNOWN** rather than asserted. Anyone extending this review should start there;
  it is ~2 files' reading to settle both.
- **Not read:** `specs/004-recipe-importing/plan.md` and `tasks.md`; `specs/014-notification-service/plan.md`,
  `tasks.md`, `v-model/*`. A task may already carry the sequence column or the harness this review says
  is missing. I read 014's `spec.md` only via 12's citations.
- **Not read in full:** ADR-0016 (read: title, Context, Decision §1). Its Atomicity and Durability
  sections are cited here **via** `12-adversarial-status-shells.md`, not first-hand.
- **LocalStack tier facts are external.** SQS-FIFO-is-Community and ElastiCache-is-Pro come from
  LocalStack's public docs (linked below), cross-checked against this repo's own statements
  (`infra/localstack/docker-compose.yml:6-8`, `_ci.yml:705-709`). I did not test LocalStack's FIFO
  fidelity, and its _behavioural_ divergence from AWS SQS FIFO is unmeasured — treat A-9 as reasoning
  about the guarantee, not a measurement of the emulator.
- **The 174-vs-112 finding count** was produced by one heading regex over the 15 documents. It is a
  count of headings that look like findings, not an authoritative enumeration — which is the point of
  gate B1. `10-import-ux.md` matched zero and may use a different heading convention.
- **Not assessed:** whether the UI state matrix is _complete_ (F-T15 aside). I looked at the async-status
  mechanism only, not at the import UI's full state space, which `10-import-ux.md` covers.
- **Not assessed:** cost/runtime of the proposed full-stack tier. A compose with 2 Postgres databases +
  LocalStack + Valkey + two Nest processes is materially slower than any current job; whether it fits
  the base tier or belongs behind `heavy-e2e` is a `per-1` / `devops-1-devops-engineer` question.

---

## Recommend next (by `subagent_type`)

- **`staff-architect`** — B2 (the ten D-1…D-10 rulings) and the shape of the cross-service e2e tier.
  Both are cross-package seams; per CLAUDE.md they must be designed once, not bolted on. Also the
  live-reference shape choice (A-8, options 1 vs 2).
- **`per-1`** — A-9's head-of-line blocking under FIFO-per-recipient at 1,000 recipes, and 12-A-9's
  fairness collapse. Both need a measured k6 profile, not an argument.
- **`devops-1-devops-engineer`** — A-2 (the composed harness, LocalStack tag unification, the
  Valkey container) and the scheduled live-USDA probe job.
- **`compound-engineering:ce-testing-reviewer`** — the four unread food-service integration suites that
  leave M7/M8 UNKNOWN, and a per-file mutation review of the recipe-side ingredient tests.
- **`sec-aud-1`** — A-5's shared-keypair harness. A test harness that sets one `CLERK_JWT_KEY` across
  two services is the right call here, but the bypass-off requirement is a security-relevant default
  and should not be set by whoever is in a hurry.

**Confidence: High** for every `file:line` claim (each was opened and read). **High** for A-1, A-4, A-8
and the mutation table M1–M3 — these are the load-bearing findings and each rests on multiple
independent citations. **Medium** for completeness, per _Not examined_. **Low-confidence, flagged as
such:** M7, M8, and the 174 finding count.

**Sources (external, labelled):**

- [LocalStack — Local AWS Services](https://docs.localstack.cloud/aws/services/)
- [LocalStack — SQS](https://docs.localstack.cloud/aws/services/sqs/)
- [LocalStack — ElastiCache](https://docs.localstack.cloud/aws/services/elasticache/)
- [LocalStack — Plans](https://docs.localstack.cloud/aws/licensing/)
