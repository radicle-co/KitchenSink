# KitchenSink Development Guidelines

> **This file is machine-ingested as authoritative repository context** by GitHub Copilot code review,
> CodeRabbit and Qodo. A stale claim here is not a typo — it is an instruction, and a bot acting on it
> produces confidently wrong review advice that a human then has to spend budget rejecting.
> Every technology claim below is verified against the actual dependency graph, and every ADR ruling
> against `CLAUDE.md`, by `packages/infra/global/__tests__/reviewerContext.test.ts`. Keep it that way:
> if you change the stack, change this file in the same PR.

## Active Technologies

**Language / runtime.** TypeScript 5.9 (strict, zero `any`, no `@ts-ignore`), Node.js 24.x
(`.nvmrc` 24.16.0, `engines.node` 24.x). Node 22.x is the AWS **Lambda** runtime only.

**Authentication — Clerk is the ONLY auth vendor in this repo.** `@clerk/nextjs` (web),
`@clerk/expo` (mobile), `@clerk/backend` (services + Lambdas), `expo-secure-store` (mobile token
storage), `svix` (Clerk webhook signature verification), `jose` (JWT verification). Services verify the
Clerk **session token** themselves via `@clerk/backend` `verifyToken` — networkless, with `azp`
enforcement. There is deliberately no API Gateway JWT authorizer and no trusted-header path.

**Backend.** NestJS 11, Drizzle ORM 0.45, `pg` 8 (node-postgres), RDS PostgreSQL 18 (`pg_trgm`, JSONB,
`tsvector` FTS), **`nestjs-zod` (`createZodDto` + its OWN `ZodValidationPipe`) is the ONE validation
mechanism per service** — `class-validator` + `class-transformer` are still installed, but exactly **ONE**
service file still imports them (`recipe-service/src/search/dto/searchRecipes.query.dto.ts`; the "19 files"
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
- **ADR-0004 — NAT is a `t4g.nano` instance, not a managed Gateway (~10× cheaper).** EVERY VPC-attached
  Lambda uses it — **17 across six stacks**, not the four the ADR originally named (that list rotted, and a
  live design decision was made on the stale figure). Fargate runs in public subnets with `assignPublicIp`
  and egresses via the IGW; `assignPublicIp` does **not** give a VPC Lambda egress. Don't move those Lambdas
  off the NAT or delete it. ⛔ Don't add a VPC **interface** endpoint to dodge the NAT either — $0.01 per
  endpoint-hour **per AZ** ($14.60/month/stage here) is several times the NAT itself; gateway endpoints are
  free and fine. Both facts are asserted by `packages/infra/global/__tests__/natEgressConsumers.test.ts`.
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

- **Schema migrations run INSIDE the deploy, ordered by an in-stack `aws-cdk-lib/triggers` Trigger — in EVERY stack that touches the database — and `executeBefore` is DERIVED from the construct tree.** `cdk deploy` returns only once ECS has stabilised, so "deploy, then invoke the migration runner" served the new image against the OLD schema for the whole stabilisation window (and prod is behind CloudFront, which CACHES the 500s); on a first-ever `pr-{N}` deploy it is worse than skew, because ADR-0006's per-PR logical database is CREATED BY that migration run, so the code addressed a database that did not exist. ⛔ The obvious repair — hoisting the pipeline's migrate step above `cdk deploy` — is **silently WORSE**: `esbuild.mjs` copies `migrations/*.sql` into the bundle at BUILD time and the bundle ships WITH the deploy, so invoking first invokes the PREVIOUS release's runner carrying the PREVIOUS migration set (exit 0, "nothing pending", nothing applied). ⛔ Reordering the PIPELINE is also wrong: recipe's workers deploy first because they publish the SSM parameters the service resolves at deploy time AND because a queue's CONSUMER must upgrade before its PRODUCER — swapping trades schema skew for message-contract skew on the right-to-erasure path. So each of `IdentityServiceStack`, `FoodServiceStack`, `RecipeServiceStack` and `RecipeWorkersStack` deploys its own runner plus a Trigger whose `executeBefore` is `this.node.findAll()` filtered to `lambda.Function | ecs.BaseService` — **never a literal array**, which is what let three barriers cover only what existed the day they were written. `WebhooksStack` deliberately has NO barrier (its five DB-touching Lambdas are ordered by deploying AFTER the identity service, which is now asserted); `DataStack`'s bootstrap Lambdas CREATE the databases and are correctly exempt. The standing precondition is **EXPAND-FIRST** migrations: a contracting migration ships a release LATER than the code that stopped reading the column. Read **`docs/architecture/decisions/0022-in-stack-migration-trigger.md`** (including its residual risk: nothing orders two CDK apps, +1 VPC Lambda per stage per open PR, and the runner takes no advisory lock).

- **The public-domain cookbook corpus is an OPERATOR-DOWNLOADED FILE — nothing we deploy fetches Project Gutenberg — and `imported_public` is DECLARABLE, but only with the `recipes:import:public` grant, enforced in a pure POLICY rather than a route Guard.** ⚠️ The corpus looks like an obvious candidate for a runtime fetcher and is not: `gutenberg.org/robots.txt` is only `Disallow: /ebooks/search`, so 004-FR-023's robots check PASSES on `/cache/epub/…` — while `gutenberg.org/policy/robot_access.html` says the site "is intended for human users only" and that perceived automated access "will result in a temporary or permanent block of your IP address" (its only exceptions are a mirror, the rate-limited `/robot/harvest` endpoint, and the catalog feeds). **robots.txt compliance is not terms-of-use compliance**, and the blast radius of getting that wrong is shared and stage-level: a VPC Lambda leaves through the single `t4g.nano` NAT instance's address (ADR-0004), Fargate through an address the task does not choose, CI through GitHub's pools. So the file is downloaded out of band and the persisted `sourceUrl` is a CITATION, not a fetch target — do not "fix" it into an automated fetch, and do not read a green robots.txt as clearance. ⛔ Second half: `RecipesService.create` no longer hardcodes `USER_CREATED`; it resolves provenance through the pure `evaluateProvenance` (`recipes/domain/provenancePolicy.ts`, the sibling of `evaluateVisibility`) and feeds the RESOLVED `sourceType` into C-004 — so a recipe's provenance and the provenance its visibility is judged against are finally the same fact. Do NOT "improve" the grant check into `ScopesGuard` + `@RequireScopes`: that is ROUTE-level and `POST /api/v1/recipes` must stay open to every authenticated user — what is authorized is a FIELD VALUE, a genuinely new authorization SHAPE here though not a new CONCEPT (`Principal.scopes`/`permissions` have always come from the token's signed `public_metadata`). `source` sits on `createRecipeRequestSchema` via `.extend()` and NEVER on the base, because `updateRecipeRequestSchema` derives from that base and would let any caller re-classify a recipe on PATCH; `imported_physical`/`imported_paid` are deliberately NOT declarable (both are private-only and `evaluateVisibility` admits them with NO premium check, which would hand a free-tier caller the private recipe 004-FR-028 gates). This AMENDS 004-FR-025 to say an **unprivileged** caller may not declare `imported_public`. Read **`docs/architecture/decisions/0023-curator-declared-provenance.md`**.

- **PostgreSQL 18 is a ONE-WAY DOOR, and merging the PR IS the production maintenance action.** `DataStack` pins `rds.PostgresEngineVersion.VER_18` with `allowMajorVersionUpgrade`. ⛔ **Do not revert it casually** — 18 cannot be downgraded in place, so the only recovery is restoring the pre-upgrade snapshot into a NEW physical instance, which CDK does not own and which ADR-0002 warns is exactly how the prod data stack gets replaced (`removalPolicy: DESTROY`, no automatic snapshot, `deletionProtection` described in-code as the only thing between accidental replacement and total loss). ⚠️ There is no separate "schedule the maintenance" step: `prod-deploy.yml` fires on `packages/infra/global/**` and RDS `ApplyImmediately` defaults to **true**, so the merge button starts the outage, unattended, from CI. Run `docs/runbooks/pg18-upgrade.md` first — its Phase 1 carries HALT gates (`ValidUpgradeTarget` — 16.4/16.5/16.7 have **no** 18 target; `datconnlimit = -2` databases; stale per-PR databases) and its Phase 2 rehearses the RESTORE on a snapshot-restored clone, not just the upgrade. Three non-obvious facts live there: **`postgres:18` MOVED its data directory** (`/var/lib/postgresql/data` → `/var/lib/postgresql/18/docker`), so the local compose mounts moved with it and the old path makes the container refuse to start; **no custom parameter group is set on purpose**, because families are version-pinned and immutable so a custom group must be replaced in the same change set or the deploy fails AFTER the outage begins (a guard asserts its absence); and **99.7% of `name ASC` tiebreak positions move with collation**, so a post-upgrade judgement-set difference traceable to a tiebreak or planner change is re-baselined and recorded rather than treated as a regression. `packages/infra/global/__tests__/engineVersionDiff.test.ts` pins the synthesized version against a committed constant — `cdkNagTemplateParity` cannot catch an engine change, because it synthesizes the same source twice and both halves move together.

- **The LLM verification gate's $100/month ceiling is enforced by OUR OWN reserve-then-settle counter, because NO AWS mechanism stops Bedrock inference at a dollar threshold in near-real-time — and the bake-off roster does NOT include Gemini, which is not on Bedrock at all.** Bedrock's quotas are on tokens and requests only (TPM/RPM/TPD) and Service Quotas is increase-only ("The new value must be greater than the current value"); application inference profiles are ATTRIBUTION, not enforcement; AWS Budgets refreshes "up to three times a day," typically 8-12h apart, and AWS states you "might incur additional costs … that exceed your budget notification threshold before AWS Budgets can notify you." ⛔ The obvious repair — a **Budget Action** (IAM deny / SCP) — does NOT close that gap: it fires off the SAME threshold evaluation as the notification, so it automates the RESPONSE and inherits the full 8-12h detection lag plus SCP propagation. ⛔ `reservedConcurrency = 1` is NOT the ceiling either (it caps burn RATE, and rate-to-dollars is model-dependent by ~30x). ⚠️ And do NOT "simplify" the gate back to "read, call, then increment from `usage`": that shape has a DURABILITY defect that `reservedConcurrency = 1` does not fix — a Lambda that dies between a successful `Converse` response and the increment leaves real spend uncounted, and those crashes are CORRELATED with the runaway the ceiling exists to stop, so the counter reports green precisely when it matters. Instead charge worst case BEFORE the call and refund after, mirroring Bedrock's own burndown (`input + max_tokens` reserved at start, unused "replenished" at the end). ⛔ The store is the recipe **PostgreSQL** database, NOT DynamoDB — an earlier draft specified DynamoDB on a claim that `RecipeWorkersStack` already owned a table, which is FALSE (it owns none and carries no DynamoDB client); the worker already ships `pg` and is VPC-attached solely to reach that RDS, so Postgres adds no dependency, no IAM surface and no new failure domain. ONE conditional `INSERT … ON CONFLICT DO UPDATE … WHERE reserved_micros <= $headroom`; **zero rows returned IS the denial**, and reserved spend never exceeds the ceiling under ARBITRARY concurrency because the row lock serializes callers and the headroom subtracts the worst case before comparing — so the bound does not depend on the concurrency setting. ⛔ There is ONE ceiling — **$100/month, prod only** (owner ruling 2026-08-21). Do NOT reintroduce the daily sub-ceiling an earlier draft carried: a monthly cap is a hard cap rather than a slow detector, it never enforced the monthly figure it sat under (31 × $5 = $155 > $100), and it denied legitimate bulk work. Sandbox and every `pr-{N}` call the provider UNGATED (ADR-0006 gives each PR its own logical database and Postgres cannot read across them), bounded by layers 0–2 at ≈$88/month/stage on Nova. ⛔ Settle is NEVER retried — `reserved + $delta` is not idempotent, so a retried settle double-refunds and reintroduces the under-count; any outcome with no billed response refunds in FULL. ⛔ Layer 4's EMF metric CANNOT detect a bypass (it is emitted BY the gated path); the bypass control is IAM — `bedrock:InvokeModel` on exactly one role, guard-tested by set equality like `natEgressConsumers.test.ts`. The period key is captured at RESERVE and carried into settle — recomputing it at settle straddles the UTC month boundary. Preconditions: explicit `maxTokens` AND a hard input-token cap (without them the reservation is a lie), and an over-cap line is **REJECTED, never truncated** (a truncated line asks the model to judge text the user did not write). An unreadable counter fails **CLOSED** — the call is not made — but that is NOT the same as resolving the line: a ceiling denial and an unreadable counter are **transient** and the message retries under layer 0's `maxReceiveCount` + DLQ, because `unresolved` means _verified and disagreed_ and U11 ranks a wrong DISAGREE as the unacceptable direction. `usage.inputTokens`/`outputTokens`/`totalTokens` are `Required: Yes`; `cacheReadInputTokens`/`cacheWriteInputTokens` are `Required: No` AND are always zero here (caching cannot engage at ~660 input tokens; Haiku 4.5's minimum is 4,096), so cost them defensively and ALERT if either is ever non-zero. ⛔ Gemini Flash-Lite is NOT available on Amazon Bedrock — only **Gemma** is — so naming it in the bake-off breaks the very premises that chose Bedrock (no vendor relationship, no secret, and an egress path already covered by ADR-0004's NAT — the `bedrock-runtime` VPC interface endpoint that clause used to cite was DROPPED on 2026-08-20, because recipe-workers was already a NAT consumer and the endpoint cost $14.60/month/stage to carry $0.27 of inference; ADR-0024 §4a). Roster is Nova Micro vs Claude Haiku 4.5. Read **`docs/architecture/decisions/0024-llm-spend-ceiling-reserve-then-settle.md`**.

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
  `packages/infra/global/__tests__/appServiceDependency.test.ts` and `scripts/contractOwners.mjs` already do.
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
  `packages/services/identity-webhooks/src/common/handlerPipeline.ts` did exactly that and dropped a real
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

## One declarer per TABLE NAME, one definition per TASK ID (GR-021 / ADR-0018, ruled 2026-08-12)

Inline, because a review bot cannot follow a link — and because both of these were found **by accident**, in
documents that had already been reviewed.

- ⛔ **A table name has exactly ONE declarer, portfolio-wide** — one feature, or one shipped package. This binds
  across features, between a feature and shipped code, and between two shipped packages, **including when the two
  live in different logical databases**, because the name is how humans and tools identify the table.
- **The collision that produced the rule:** feature 010 declared a `webhook_events` table for Stripe idempotency.
  That name **already ships** in the very database ADR-0017 puts 010's webhook in —
  `packages/shared/identity-db/src/schema/webhookEvents.ts`, Clerk/svix delivery dedup, keyed
  `svix_id text PRIMARY KEY` with `identity_id text NOT NULL` — with an otherwise **disjoint** column set. Two
  tables under one name is a migration that fails at deploy, or one that succeeds and corrupts dedup for **both**
  senders. ✅ **Ruled: ONE DEDUP TABLE PER SENDER.** Stripe gets **`stripe_webhook_events`**; the shipped table is
  **not touched**. ⛔ Do **not** "simplify" this by adding a `source` discriminator to the shipped table: that
  means dropping its PRIMARY KEY and **relaxing `identity_id` to nullable** — the very constraint that makes
  GR-019's no-sentinel rule schema-enforced — on a live table on the user-provisioning path, and it lets a
  billing-side dedup or retention defect **evict Clerk's dedup rows**. `stripe_webhook_events` deliberately has
  **no `identity_id`**: a Stripe event is attributed to a `stripe_customer_id`, and attribution is a lookup
  against `accounts.stripe_customer_id` where a miss is allowed to be a miss.
- **The second collision, found in the same sweep:** feature 011 planned a **second** `recipe_versions` table in
  `digitization-service`'s database while `recipe_versions` already ships in the recipe service — two independent
  `(recipe_id, version_number)` sequences over one recipe's history, so "version 4" would stop identifying
  anything. ✅ **Ruled: 011 does NOT create it.** A digitization correction is a version created **through
  `@kitchensink/recipe-service-client`**. For the same single-writer reason, 011's `recipes.audience` DDL ships as
  a **recipe-service** migration, not a `digitization-service` one — a second service issuing DDL against another's
  table forks schema ownership and races the owner's migration ordering.
- **A spec DECLARES a table by writing fenced DDL** (` ```sql ` `CREATE TABLE`, or ` ```ts ` `pgTable('…')`).
  Prose naming a table is a **reference**, which is normal and correct — 007 reads 001's `recipe_ingredients`, and
  that is not a claim of ownership. ⚠️ A prose-only declaration is **invisible to the gate**: that is exactly how
  011's `recipe_versions` escaped the first automated pass. Writing the DDL is the author's obligation.
- **A not-yet-implemented feature MUST NOT `CREATE TABLE` a name that already ships** — the statement can only
  fail or clobber. To reuse the table, the **owning service** writes it and the feature calls that service.
- ⛔ **A `tasks.md` defines each task ID exactly once.** Feature 007 defined **eight** twice (T-004, T-025, T-027,
  T-028, T-041, T-043, T-044, T-046) — 60 checkbox lines for 52 IDs — so a traceability row could be closed by the
  **wrong** task and `Depends on: T-043` had no single referent. A **definition** is the line carrying the
  done-state: a checkbox, or (in a file using no checkboxes at all, as feature 004 does) a heading. One task
  serving two stories is **defined once**, tagged with every story it serves, its second site a **non-checkbox
  pointer**; two different deliverables get two IDs (007's T-046 UI vs its E2E test, now **T-053**).
- ⚠️ **The gates PARSE, they do not grep, and they DISCOVER, they do not enumerate.** A text gate in this repo once
  passed against deliberately broken code because the docstring above it contained the words it searched for. Four
  measured reasons here: 007's fenced dependency graph makes a line-wise task-ID regex report **~30 phantom**
  duplicates; 001's suffixed IDs (`T001`, `T001a`, `T001-alb` are three different tasks) make a `T\d+` match
  manufacture **~50 more**; drizzle writes `pgTable(` and the table name on **different lines**, so a single-line
  regex sees **3** of this repo's tables instead of all of them; and SQL comments name tables constantly. Gates:
  `packages/infra/global/__tests__/specTaskIds.test.ts` and `.../specTableCollisions.test.ts` over
  `.../specDeclarations.ts`.
- **An exemption needs a substantive written `why`, and pins the owner set EXACTLY** (precedent:
  `contract-gen`'s `AllowedPackageImport.why`, `ColumnAccount.why`). A blank or one-word reason is a hard failure,
  and a **third** declarer joining an exempted pair fails — "two of these were ruled acceptable" says nothing
  about a third. ⚠️ Three current exemptions record a **shipped DEFECT, not an approval**:
  `packages/services/identity/src/types/schema/{users,accounts,profiles}.ts` are **drifted** duplicates of the
  authoritative `packages/shared/identity-db/src/schema/*` — `id` is `varchar(255) COLLATE "C"` vs `text`, `email`
  is `varchar(320)` vs case-insensitive `citext`, `profiles.user_id` is **`uuid` vs `text`** — under a comment
  claiming the two are "kept in lockstep". Nothing in production imports them; the only consumer is a test.

## Cross-platform rule (enforced)

Every user-facing feature ships to **both** web and mobile in the same release. Platform-specific
implementations use the `.native.ts(x)` suffix, never `.mobile.*`. Shared business logic, types and API
clients live in shared packages. See `docs/CODING_STANDARDS.md §14`.

<!-- MANUAL ADDITIONS END -->
