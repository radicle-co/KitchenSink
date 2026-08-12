# KitchenSink Development Guidelines

> **This file is machine-ingested as authoritative repository context** by GitHub Copilot code review,
> CodeRabbit and Qodo. A stale claim here is not a typo — it is an instruction, and a bot acting on it
> produces confidently wrong review advice that a human then has to spend budget rejecting.
> Every technology claim below is verified against the actual dependency graph, and every ADR ruling
> against `CLAUDE.md`, by `packages/infra/global/__tests__/reviewer-context.test.ts`. Keep it that way:
> if you change the stack, change this file in the same PR.

## Active Technologies

**Language / runtime.** TypeScript 5.9 (strict, zero `any`, no `@ts-ignore`), Node.js 24.x
(`.nvmrc` 24.16.0, `engines.node` 24.x). Node 22.x is the AWS **Lambda** runtime only.

**Authentication — Clerk is the ONLY auth vendor in this repo.** `@clerk/nextjs` (web),
`@clerk/expo` (mobile), `@clerk/backend` (services + Lambdas), `expo-secure-store` (mobile token
storage), `svix` (Clerk webhook signature verification), `jose` (JWT verification). Services verify the
Clerk **session token** themselves via `@clerk/backend` `verifyToken` — networkless, with `azp`
enforcement. There is deliberately no API Gateway JWT authorizer and no trusted-header path.

**Backend.** NestJS 11, Drizzle ORM 0.45, `pg` 8 (node-postgres), RDS PostgreSQL 16 (`pg_trgm`, JSONB,
`tsvector` FTS), **`nestjs-zod` (`createZodDto` + its OWN `ZodValidationPipe`) is the ONE validation
mechanism per service** — `class-validator` + `class-transformer` are still installed, but exactly **ONE**
service file still imports them (`recipe-service/src/search/dto/search-recipes.query.dto.ts`; the "19 files"
figure in older docs is a **mention** count, mostly JSDoc about migrating away). That one file is residue, not
the pattern: do not propose `class-validator` for new code (ADR-0015 / GR-016). `@nestjs/config` with a Zod env
schema, `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` (photo objects),
`@aws-sdk/client-sqs` (deletion + version-archive queues), `sharp` 0.34 (Lambda photo processor),
`@sentry/aws-serverless`, `@aws-lambda-powertools/logger`.

**Frontend.** Next.js 15 App Router + React 19 + Tailwind CSS v4 (web); Expo 57 / React Native 0.86,
new architecture only (mobile).

**Infrastructure.** AWS CDK v2 (`aws-cdk-lib`), ECS/Fargate, a single shared ALB per stage, S3,
CloudFront, SQS, and a `t4g.nano` NAT instance.

## Project Structure

Turborepo + npm workspaces. Packages live under `packages/<group>/<name>/`, each independently
buildable with its own `package.json`. Groups: `apps/commise/` (web, mobile, ui, features, i18n),
`services/` (deployable HTTP APIs and Lambda bundles), `shared/`, `clients/`, `utils/`, `infra/`,
`tools/`.

## Commands

```bash
npm run build          # all packages, in Turbo dependency order
npm run test           # all packages
npm run lint
npm run typecheck
npm run format         # Prettier: 4-space, single quotes, semicolons, 120 cols
```

Each package may use a different runner — check its own `package.json`. Shared packages are referenced
as workspace dependencies (`"@kitchensink/<name>": "*"` or `"@commise/<name>": "*"`).

## Code Style

Named exports only (default exports only where a framework requires it). `import type` for type-only
imports. Bracket notation for env vars — `process.env['KEY']`, never `process.env.KEY`. ISO 8601
strings in interfaces, never `Date` objects. Custom errors extend `Error`, call `Object.setPrototypeOf`,
and ship a matching `is*` type guard. Impure functions carry a `@sideEffect` JSDoc tag. Organize by
feature domain, not by type; `helpers/` directories are banned. Full rules in `docs/CODING_STANDARDS.md`.

**Tests come first (TDD red → green), with no exceptions** — see `docs/CODING_STANDARDS.md §7.1`. UI
code needs a vitest component test for _every_ state (loading, empty, populated, error, gated,
disabled), plus Playwright (web) **and** Maestro (mobile) for every user story. Non-UI code needs unit
**and** integration tests. Deployable services additionally need e2e **and** k6 tests. A test that
would still pass if the code were subtly broken is coverage theater and does not count.

<!-- MANUAL ADDITIONS START -->

## Deliberate decisions (looks wrong, isn't)

These look like bugs to "fix" and are not. Before proposing a change that reverts one, read the linked
ADR under `docs/architecture/decisions/` and confirm you are not reintroducing the failure it prevents.
`CLAUDE.md` holds the authoritative long-form reasoning; the lines below are the index.

- **ADR-0001 — sandbox previews are per-PR SUBDOMAINS; the path form 404s BY DESIGN.** A preview lives
  at `https://pr-{N}.sandbox.commise.app/`, at root, with no `basePath`. The older
  `sandbox.commise.app/pr-{N}` form returns 404 on purpose, as does the apex root — do not "fix" that
  404 by restoring path routing. `azp` enforcement is our own anchored-regex guard (`CLERK_AZP_PATTERN`),
  which is what makes bounded per-PR origins safe; keep it anchored and never disable it on sandbox.
- **ADR-0002 — per-stage VPC CIDRs; prod stays 10.0.0.0/16, sandbox 10.1.0.0/16.** Prod's explicit value
  equals the historical CDK default on purpose so it produces no diff. Changing the prod CIDR, or a
  construct ID feeding the VPC, replaces the prod VPC **and its RDS** with no snapshot.
- **ADR-0003 — ONE shared ALB per stage; services add host-rules and do NOT own an ALB.** Each service
  imports the shared HTTPS listener and adds a listener rule (identity 100, food 200, recipe 300;
  priorities must be unique). Unmatched hosts hit a default fixed-response 404. Don't "fix" a service by
  giving it its own ALB, and don't reuse a priority.
- **ADR-0004 — NAT is a `t4g.nano` instance, not a managed Gateway (~10× cheaper).** Only the DB-bound
  webhook Lambdas use it. Fargate runs in public subnets with `assignPublicIp` and egresses via the IGW;
  `assignPublicIp` does **not** give a VPC Lambda egress. Don't move those Lambdas off the NAT or delete it.
- **ADR-0005 — the `Environment` tag governs teardown: `global` persists, `pr-{N}` is deleted on PR close.**
  There is no denylist, so safety depends entirely on never naming or tagging a global resource `pr-{N}`.
  The delimiter-aware match lives once, in `.github/scripts/pr-scope.sh` (so pr-1 ≠ pr-15) — do not add a
  second matcher, do not relax it to a bare prefix, and do not add an "orphaned-looking" sweep.
- **ADR-0008 — non-prod cost levers diverge from prod on purpose.** Non-prod RDS uses `gp3` while prod
  stays `gp2`; non-prod Fargate runs `FARGATE_SPOT` while prod runs on-demand. Don't "fix" sandbox to
  match prod, and don't flip prod without its own PR and a no-diff proof.
- **ADR-0009 — sign-out goes through ONE command that VERIFIES the session ended.** `useClerk().signOut`
  is the wrong `signOut`: before clerk-js loads it queues the call and **resolves**, so `await signOut()`
  succeeds having revoked nothing. Use `useSignOutAndLeave` (web) / `useSignOutAndVerify` (mobile); never
  call `signOut` from either hook directly, never drop the post-condition, and never "fix" sign-out by
  clearing `__session` yourself.
- **ADR-0010 — a PR preview's deploy jobs are gated ENSURE-EXISTS, not on changed paths.** They run when
  sources changed, when dispatched, when the `pr-{N}` stack is absent/wedged, **or** when the origin does
  not answer — and skip only when unchanged and already serving. Don't restore the `paths-filter`-only
  gate (it left recipe-only previews with no food service and a dead `RECIPE_FOOD_SERVICE_URL`), and don't
  replace it with an unconditional redeploy. The deployed smoke treats food's **401** as the PASS: only a
  transport failure, the shared ALB's default `404 text/plain`, a `2xx` to an unauthenticated probe, or a
  `5xx` is a failure.
- **ADR-0011 — `/api/{version}/*` is canonical; `/{version}/*` is a deprecated alias that MUST NOT be
  removed yet.** The Clerk dashboard holds the webhook URL, i.e. configuration outside this repository.
  Deleting the alias mapping would 404 every `user.*` callback and silently stop syncing users — no failed
  deploy, no alarm.
- **ADR-0014 — the service owns its wire types; `packages/schemas/*` is GENERATED and clients never
  redeclare a wire shape.** zod is authored in the service at `src/**/*.schema.ts`, beside the controller
  it serves, and a committed COPY is generated into `packages/schemas/<svc>` (`@kitchensink/schema-<svc>`)
  by `@kitchensink/contract-gen`. Clients import zod + `z.infer` types from there and declare none of
  their own; a consumer whose shape genuinely differs DERIVES it (`Pick`/`Omit`/`Partial`). Four things
  look like defects and are not: **(1)** the schema package is a literal file COPY, not a transformation —
  zod schemas are runtime values, so they cannot be derived from themselves, and every package exports raw
  `./src/*.ts`, so no bundle-into-`dist` path exists; **(2)** turbo uses `$TURBO_ROOT$` **`inputs`**, NOT
  `dependsOn` — that edge closes the cycle `client → schema → service → client`, and ordering is not the
  requirement because the generated files are committed; **(3)** `openapi.yaml` is DERIVED output for
  `oasdiff`/docs/integrators and is **never a codegen input** — routing types through JSON Schema loses
  `readonly`, branded and template-literal types and flattens discriminated unions; **(4)** a
  `*.schema.ts` may import ONLY `zod`, enforced by a parser-based guard, because the copy would otherwise
  break or drag the server graph into web and mobile. ⛔ And the INVERSE is deliberate: a third-party API
  we do NOT serve (`packages/clients/usda`, Clerk, Vercel, Stripe) has no service of ours to own its type
  and cannot be trusted, so those clients validate the raw upstream shape at the boundary with zod and MAY
  declare their own types — do not "converge" them, and never publish an OpenAPI document for an API we do
  not serve. Also: `createZodDto` classes carry NO `class-validator` metadata, so a service using them
  MUST bind `nestjs-zod`'s `ZodValidationPipe` — under Nest's own `ValidationPipe` such a DTO validates
  **nothing** while looking correctly wired.
- **ADR-0015 — every input is parsed ONCE at the boundary against the service's OWN authored zod, and the
  database schema is the FLOOR.** One mechanism per service (`createZodDto` + **`nestjs-zod`'s**
  `ZodValidationPipe`), one `400` path naming the offending field. `@Body() body: unknown` is banned — it moves
  the parse into the method body where it is optional by construction. **Non-HTTP ingress is in scope**: queue
  and event consumers parse their payload before it becomes a job, and a webhook verifies the signature **and
  then** validates the schema, because **a signature proves ORIGIN, not SHAPE**. Every input field writing a
  **bounded column** is validated at least as strictly as that column can store — `servings: 9999999999`
  passed validation and failed at the `INSERT`, a **500 that owed a 400** — but that floor is an **ASSERTION
  between two independently authored artifacts, NEVER a derivation**: zod is never generated from drizzle and a
  wire type never imports a storage type. And a floor is not a target — PostgreSQL `text()` is unbounded, so a
  length limit on user-typed prose is a product decision with nothing to derive from. No request-derived value
  may reach `sql.raw()`; a request supplies a validated enum key that maps to a closed allowlist of literals,
  never a SQL fragment. ⛔ **Server-side RESPONSE validation is DEFERRED by owner decision — do NOT "complete"
  it.** A **consumer** parsing what it received is required and is a different thing; do not conflate them.
- **ADR-0016 — a notification is retained until the client ACKS it or 3 days pass, deduplicated by CANONICAL
  PAYLOAD while pending, in ElastiCache Serverless for Valkey (feature 014).** Retention is `ack OR 72h,
whichever first`, and **nothing refreshes the clock** — not a duplicate publish, not a delivery attempt.
  Dedup uses **two indexes over one verdict**: a SHA-256 over the **RFC 8785 (JCS)** canonical JSON of
  `{ schemaVersion, recipient, messageType, producer, payload }`, released on ack (so the same payload after a
  consumption is a **NEW** notification — deliberate), plus a `(producer, idempotencyKey)` claim that
  **survives** the ack to suppress transport redelivery. `occurredAt` is excluded on purpose (it changes on a
  retry). On a duplicate: **drop it, return the ORIGINAL id, and change nothing about the original** — never
  extend its TTL, or a retrying producer holds a notification pending forever. Ack is **batched, idempotent,
  and per USER not per device**; an unknown/expired/other-user id returns success as "already settled" so the
  endpoint is not an existence oracle. Canonicalization comes from a **maintained RFC 8785 library, not
  hand-rolled**; array order is preserved, absent ≠ explicit `null`, strings are byte-exact (no Unicode
  normalization), and a number that cannot survive an IEEE-754 round trip is **rejected** rather than silently
  collapsed. ⛔ **Accepted residual risk, not an oversight:** ElastiCache durability is **opt-in and OFF by
  default in both flavours**, so a node replacement can drop retained notifications the service already
  accepted — the owner chose Redis knowing DynamoDB-with-TTL would be durable and cheaper. Mitigation is
  synchronous ElastiCache durability if available on Serverless Valkey; escalation is MemoryDB or DynamoDB.
  One cache **per stage** with a `pr-{N}:` key prefix — **not** one per PR.
- **ADR-0017 — features 006, 007 and 009 land in `@kitchensink/recipe-service`; 010 lands in
  `@kitchensink/identity-service` (its Stripe webhook in `@kitchensink/identity-webhooks`). NO new deployable
  service is created.** A **schema package is per SERVICE, not per feature**, so meal plans, grocery lists and
  nutrition plans all add `*.schema.ts` files to recipe-service and are copied into the existing
  `@kitchensink/schema-recipe` — there is no `@kitchensink/schema-meal-planning`, `-grocery`, `-nutrition` or
  `-billing`. Do **not** propose splitting them out: a new deployable here is an ECS service per stage **plus
  ≈ $8.25/month per open PR**, on an account with a $300 budget that runs a `t4g.nano` NAT instance to save
  $28/month — and it would put a network boundary through `meal_plan_entries → recipes`, where an in-database
  `ON DELETE CASCADE` deletes 006's orphan handler and its `is_orphaned` column outright. `recipe-service`'s
  name will understate what it holds, exactly as `food-service` is really the ingredient service; **do not
  propose a rename or a split to make the name true.** The NestJS module (`MealPlansModule`,
  `GroceryListsModule`, `NutritionPlansModule`) is the internal boundary and is where a future extraction would
  cut. Recorded flip conditions: a DPIA requiring physical isolation of 009's GDPR Article 9 health data
  (the likeliest), inbound retailer surface for 007, planner write volume for 006, marketplace payouts for 010.

## Contract & validation conformance for NEW code (GR-017 – GR-020, ruled 2026-08-12)

These are inline because a review bot cannot follow a link, and because they bind code that **does not exist
yet** — the case prose in a feature spec has repeatedly failed to cover.

- **A new deployable service owes all of this on its FIRST commit**, not "when it has clients": authored zod at
  `src/**/*.schema.ts`; a `contract:generate` script; a committed `packages/schemas/<svc>` exporting zod +
  `z.infer` types + `CONTRACT_HASH` + a barrel + a **derived** `openapi.yaml`; a `CONTRACT_HASH` assertion at
  **boot**; **`nestjs-zod`'s** `ZodValidationPipe`; `z.strictObject()` on mutating bodies; a zod parse on every
  queue/event/webhook/scheduled ingress; and unit + integration + e2e + k6 tests.
- **A new client or app package owes:** **zero** declared wire shapes of any of our services (type-only counts),
  wire types **and** zod imported from the schema package, **response validation on receipt**, outbound bodies
  validated against the **callee's** zod, and a contract-skew guard. Divergent consumer shapes are
  `Pick`/`Omit`/`Partial` derivations, never independent declarations.
- ⚠️ **A conformance test that enumerates services or clients from a HARDCODED LIST is itself the defect** — it
  cannot see the next package. Discover them from `packages/services/*/package.json`,
  `packages/clients/*/package.json` or `git ls-files`, as
  `packages/infra/global/__tests__/app-service-dependency.test.ts` and `scripts/contractOwners.mjs` already do.
- **`z.strictObject()` is the portfolio default for every MUTATING request body.** Plain `z.object()` needs a
  forward-compatibility reason documented at the schema, which in practice means a read surface. On a mutating
  body a silently stripped unknown key is a `200` **plus a partial write the caller was told succeeded**.
- **The storage floor is enforced by a per-service parity TEST**, in the service, which **may** import both the
  drizzle schema and the zod — **a test is not a wire schema**, so the ban on the _production_ coupling stands
  unweakened — enumerating bounded columns **derived from** the drizzle schema, with the field→column mapping
  asserted complete **in both directions**.
- **ONE rejection path per ingress: one code path, one shape, one `reason`, one counter, one alarm.** A
  signature failure and a shape failure are **equally invalid** and must not be two code paths or two error
  contracts. An **invalid payload is never retried** (a transient dependency failure is a different `reason` and
  may). ⚠️ **For svix (Clerk) and Stripe, "not retried" means answering `2xx` — but ONLY on a SHAPE failure**:
  they retry on **any** non-2xx (Stripe for 72 hours), and a body that cannot parse never will. Record the
  rejection in the response body, in structured logs, in a per-`reason` counter, and **alarm** on it: **reject
  the content, accept the delivery.**
- ⛔ **But a SIGNATURE failure on that same endpoint answers NON-2xx, and this is incident-grounded.** Two causes,
  both arguing against `2xx`: the caller may not be the real sender (on a public endpoint the signature is the
  **only** trust boundary, so a `2xx` tells a forger the forgery landed), or the caller IS the real sender and
  **our** signing secret is stale — a **transient, operator-fixable** condition where the sender's retry window
  is the recovery mechanism. `2xx` there says "delivered" and discards every queued real event permanently behind
  a green check. An earlier revision of
  `packages/services/identity-webhooks/src/common/handler-pipeline.ts` did exactly that and dropped a real
  `user.created`. So the **status comes from ONE complete `reason`→status lookup**
  (`WEBHOOK_REJECTION_STATUS`: `shape → 200`, `signature → 401`), never a second branch — the question a status
  answers is **"would a redelivery ever succeed?"**. Do **not** "simplify" the two onto one status; it breaks
  something in either direction. None of this generalises to our own callers — an endpoint called by our own
  services returns the `400`/`403`, and an ingress with no caller dead-letters once and alarms on DLQ depth.
- ⛔ **A rejected event is NOT recorded as a row.** An invalid payload has no trustworthy id, and
  `webhook_events.identity_id` is `text NOT NULL`, so "just record it" forces a sentinel. The log line, the
  counter and the DLQ entry **are** the record.
- **No identifier may EVER be a sentinel** — not `'unknown'`, `'none'`, `''`, `'n/a'` or `0` — anywhere it is
  stored, wired, used as a map/cache key, used as a metrics dimension, or compared in a branch. An id is
  **REQUIRED** wherever it is consumed; the sole exception is a **create/upsert**, where an absent id is
  **generated** (ULID). An unresolvable id is a **rejection**, never a placeholder. A legitimately absent
  relationship is `NULL` / `| null`, which is checkable; a magic string is not.
- **Where a request asserts a principal TWICE — once by transport (a token `sub`, an EventBridge `source`) and
  once in the payload — BOTH are required and a mismatch is a REJECTION.** The transport signal resolves through
  a **committed, version-controlled** registry (not a table) to a **name**, the mapping is **injective and
  asserted at boot**, and the payload-asserted value is **never** trusted on its own — its only permitted
  outcomes are "agrees" and "rejected". Same lesson as PR #39 deleting the forgeable `x-authorizer-context`
  header: a value the sender controls cannot authorise what the sender may do.

## Cross-platform rule (enforced)

Every user-facing feature ships to **both** web and mobile in the same release. Platform-specific
implementations use the `.native.ts(x)` suffix, never `.mobile.*`. Shared business logic, types and API
clients live in shared packages. See `docs/CODING_STANDARDS.md §14`.

<!-- MANUAL ADDITIONS END -->
