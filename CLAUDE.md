# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## ⛔⛔ THE PRIME DIRECTIVE — Operate at a staff-engineer level, always (read FIRST, every session)

**Why this exists — do not skip it.** LLM-written code is known to carry flaws ranging from the subtle to the significant, and agents left on their own cause production outages. Unforced, an agent codes at a **junior** level: locally plausible, superficially working, quietly wrong. The owner of this project **cannot babysit you or review every single line** — the entire working relationship depends on you producing code *and architecture* that a **staff engineer would sign their name to**: the same high bar for **quality AND correctness** as a strong human at that level. The goal is exact and non-negotiable: *hand you the specs and the plans, and trust that what comes out is working correctly, is production-quality, and is exactly the code and architecture the system needs.* Earning that trust — the same confidence one would place in a real staff engineer — **is the job.** Anything less is a failure no matter how fast it was produced or how green the happy path looks.

**This is a standing instruction, active from the FIRST token of EVERY session.** You do not wait to be told to engage it; coding at a junior level "because nobody forced me this time" is precisely the failure mode this directive exists to eliminate. This section outranks any impulse toward speed, convenience, or the merely-obvious solution.

### What operating at a staff level actually requires (behaviors, not vibes)

Stretch beyond the obvious. Think multiple levels deep. Be inventive and creative, and leverage the same physical and conceptual tools and skill set a real staff engineer uses. Concretely, on every task:

1. **Own the outcome in production, not the diff on your screen.** The question is never "does this pass?" — it is "what takes this down at 3am, under load, on the Nth retry, with a stale cache, a failed dependency, a malicious input, or a partial deploy?" Engineer for *that*. Consider failure modes, concurrency, idempotency, blast radius, observability, and rollback **before** the happy path.
2. **Treat the spec/plan as a hypothesis to pressure-test, not gospel to transcribe.** Catch the requirement that is wrong, missing, ambiguous, or self-contradictory and surface it — a faithful implementation of a broken spec is still broken. Resolve gaps with the best-justified decision; never code around them silently.
3. **Think in systems and second-order effects.** Trace what your change touches: callers, callees, invariants, contracts, data at rest, other services, the people who operate it. A local fix that creates drift, leaks across a boundary, or introduces an inconsistency elsewhere is not a fix.
4. **Design for the cost of change.** Invest where reversal is expensive (wire/persisted/security/cross-service boundaries); stay lean where it is cheap. Make illegal states unrepresentable; parse, don't validate; choose the design that is *right*, not the first that compiles — and be able to justify it against the alternatives you rejected.
5. **Prove correctness adversarially.** Build tests to **fail if the code is wrong** — apply the mutation lens ("would this still pass if I broke the logic?"). Demonstrating the happy path is not proof; coverage is not correctness.
6. **Verify empirically — never assume, never claim done on faith.** Run it. Read the actual output, the actual types, the actual query, the actual failure. "It should work" is not a status.
7. **Be your own hostile reviewer before declaring done, and be honest about residual risk.** Re-read your change as a skeptic trying to break it. If anything is unverified, partial, or uncertain, say so plainly — false confidence is worse than a known gap, because it is exactly what destroys the owner's ability to stop checking your work.
8. **Leave the codebase more coherent than you found it.** Match existing patterns, keep one authoritative representation of each piece of knowledge, and do not let the system fragment under your edits.

### ⛔ Pre-write gates — check these BEFORE you type, not after review catches you

The failures below are the ones that slip through most easily because the *surrounding code already commits them*. Pattern-matching neighbors is NOT a defense — the standard/doc wins over the local convention, and propagating an existing violation is still a violation.

- **Library-first.** Before hand-rolling any non-trivial mechanism — HTTP clients, query-string/URL building, retries/backoff, date/time math, file-type/magic-byte detection, parsing, crypto, validation, ID generation — you MUST first check whether a **stable, well-maintained, widely-used library** already does it, and USE it unless you can state a specific, concrete reason not to (and "the codebase hand-rolls it elsewhere" is not one). Writing an "exhaustive test" for a reinvention does not redeem the reinvention. Reach for the library.
- **Read the standard before you create/name a file.** Before adding a file, verify its name and location against `docs/CODING_STANDARDS.md §1` **for the package it lives in** (backend NestJS kebab `name.type.ts` vs frontend camelCase/PascalCase). Before writing a function, confirm purity/`@sideEffect`, the custom-error convention, and the JSDoc rule apply. Do not infer the rule from a neighbor that may itself be wrong.
- **Tests come first (TDD red→green).** Write the failing test before the code it covers, per §7.1 — not alongside, not after. If you wrote the code first, you skipped the gate.
- **Localize user-facing strings.** Any string a user reads (UI copy, and any surface that reaches them) goes through the localization path, never a hard-coded literal.

If you are about to hand-roll, name a file, or ship a string and you have NOT done the corresponding check above, stop and do it.

**The standard, in one line:** produce the code and the architecture the system *exactly needs* — correct, robust, production-grade, and defensible line by line — as if a staff engineer whose reputation is on the line wrote it, because for this project, that is who you are. The two sections below are *how* you meet this bar; this section is *why*, and it governs all of them.

## ⛔ MANDATORY — Engineering quality bar (read BEFORE writing any code)

**Before you write or modify a single line of code, you MUST read the relevant section(s) of [`docs/engineering/ENGINEERING_EXCELLENCE.md`](docs/engineering/ENGINEERING_EXCELLENCE.md).** That document is the repository's NORMATIVE quality bar for what _engineered_, production-grade software is — across correctness, robustness, security, design, frontend, backend, and testing — grounded in primary sources (Ousterhout, Fowler, the Google SWE book, OWASP, DDIA, Release It!, Kent C. Dodds, and more).

This is **not optional background reading**. It is progressive disclosure by design: CLAUDE.md stays lean; the deep standards live in that file and MUST be pulled in on demand:

- **Backend/service code** → read _Backend Engineering Excellence_ + _Design Patterns, Principles & Code Quality_.
- **Frontend (web or mobile)** → read _Frontend Engineering Excellence_ + _Design Patterns, Principles & Code Quality_.
- **Any test, or any review of a test** → read _Quality Systems Engineering & Test Excellence_, **every time**. A test that would still pass if the code were subtly broken is coverage theater, not a test, and MUST NOT be counted toward the test mandate below.

"I didn't read it" is **never** an acceptable reason for a defect that document would have prevented. Where it and a narrower doc (`docs/CODING_STANDARDS.md`, an ADR) both apply, the **stricter** rule wins. Re-read the relevant section before claiming a change is "done."

## ⛔ MANDATORY — Apply DRY, KISS & YAGNI correctly (and NEVER as an excuse for bad code)

You **MUST** default to the simplest design that _fully and correctly_ solves the **current, known** requirement — no more, and no less.

- **KISS** — Build the simplest thing that _completely_ solves the problem in front of you. Cleverness, indirection, and abstraction you can't justify from a present need are a loan against every future reader. Simple ≠ incomplete.
- **DRY** — Every piece of **knowledge** (a business rule, a constant, a contract) has ONE authoritative representation. DRY governs _knowledge, not keystrokes_: two fragments that merely look alike but change for **different reasons are NOT duplication** — do not merge them. Over-DRYing into a flag-riddled shared helper is the _wrong abstraction_, and "duplication is far cheaper than the wrong abstraction" (Metz). Prefer DAMP in tests; when unsure, wait for the **third** occurrence and a proven shared reason-to-change before extracting.
- **YAGNI — read this precisely; it is the single most misapplied principle, and agents fall into its trap constantly.** YAGNI means: **do NOT build capability now for a _presumed future_ need** — speculative features, configuration knobs nobody asked for, generic frameworks for a single caller, "flexible" extension points for variation you're only guessing at. Per Fowler: _"Yagni only applies to capabilities built into the software to support a presumptive feature; it does not apply to effort to make the software easier to modify."_ Its cost model is real (cost of **build** + **delay** + **carry** + **repair** of the speculative thing), which is _why_ you don't build it.

### YAGNI is NOT a license to under-build. You **MUST NOT** invoke YAGNI or KISS to justify:

1. **Skipping correctness or robustness of the CURRENT requirement.** Error paths, edge/empty/null/boundary cases, input validation, authorization checks, concurrency safety, and dependency-failure handling are **NOT speculative features** — they are part of doing _today's_ job correctly. Omitting them is a **bug**, not simplicity.
2. **Skipping tests.** Self-testing code is an _enabler_ of YAGNI, never a violation of it — YAGNI is only safe _because_ you can change code later, and tests are what make that true. A weak/absent test is corner-cutting, full stop.
3. **Writing sloppy, tightly-coupled, un-refactorable code.** _"Yagni is not a justification for neglecting the health of your code base. Yagni requires (and enables) malleable code"_ (Fowler). Good modularity, clear names, and separation of concerns are YAGNI's **precondition**, not its casualty.
4. **Ignoring a KNOWN or near-certain requirement.** YAGNI is about _uncertain, presumed_ futures. A requirement you already know is coming is not a "maybe" — account for it now.
5. **Refusing a cheap seam where the cost of changing later is HIGH.** YAGNI's arithmetic assumes change is cheap. Where reversing a decision later is expensive — a public/wire API, a persisted schema or migration, a security/authorization boundary, a cross-service contract, anything clients depend on — that asymmetry **weakens** YAGNI: design the boundary right the first time instead of "simplest thing now."

**The test before you cite YAGNI/KISS:** _"Am I declining to build a speculative feature or abstraction for a future I'm only guessing at (correct), or am I using it to justify skipping correctness, tests, structure, a known requirement, or an expensive-to-reverse decision (misuse)?"_ If the latter, it is **not** YAGNI — it is corner-cutting, and it is forbidden. Full treatment (with DAMP-over-DRY, deep modules, and the pattern catalog) in `docs/engineering/ENGINEERING_EXCELLENCE.md` → _Design Patterns, Principles & Code Quality_.

## Commands

```bash
# Install dependencies
npm install

# Build all packages (respects Turbo dependency order)
npm run build

# Run all tests
npm run test

# Run a single workspace's tests
npm run test --workspace=packages/services/identity

# Run tests in watch mode (within a workspace)
cd packages/services/identity && npx vitest

# Lint all packages
npm run lint

# Type check all packages
npm run typecheck

# Format all files
npm run format

# Develop locally (persistent, all workspaces)
npm run dev:local
```

### Per-workspace development

```bash
# Web app (Next.js)
npm run dev --workspace=packages/apps/commise/web

# Mobile app (Expo)
npm run dev --workspace=packages/apps/commise/mobile

# Identity service (NestJS)
npm run dev --workspace=packages/services/identity

# E2E tests (Playwright — web only)
npm run test:e2e --workspace=packages/apps/commise/web

# E2E tests (Vitest-based — mobile / webhooks)
npm run test:e2e --workspace=packages/services/identity-webhooks
```

### Infrastructure (CDK)

```bash
# Synth identity service stacks
npm run infra:synth --workspace=packages/services/identity

# Synth identity-webhooks stacks
npm run infra:synth --workspace=packages/services/identity-webhooks

# Build + deploy (done by CI; avoid manual prod deploys)
npm run infra:deploy --workspace=packages/services/identity
```

## Architecture

This is a TypeScript monorepo using **npm workspaces** and **Turborepo** for the **Commise** recipe/meal-planning platform.

### Workspace layout

| Path                                  | Package                                                    | Description                                                                                                 |
| ------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `packages/apps/commise/web`           | `@commise/web`                                             | Next.js 15 web app (React 19, Tailwind CSS v4)                                                              |
| `packages/apps/commise/mobile`        | `@commise/mobile`                                          | Expo 53 / React Native 0.79 mobile app                                                                      |
| `packages/apps/commise/ui`            | `@commise/ui`                                              | Shared design-system tokens + Clerk components (Tamagui-compatible)                                         |
| `packages/services/identity`          | `@kitchensink/identity-service`                            | NestJS 11 REST service on ECS/Fargate; Drizzle ORM + RDS PostgreSQL 16                                      |
| `packages/services/identity-webhooks` | `@kitchensink/identity-webhooks`                           | AWS Lambda handlers: Clerk webhook, deletion worker, reconciliation, log forwarder, schema migration runner |
| `packages/infra/global`               | _(CDK app)_                                                | Shared CDK stacks (VPC, RDS, S3, SQS, IAM foundations)                                                      |
| `packages/tools/*`                    | `@kitchensink/{eslint,typescript,vitest,prettier,esbuild}` | Shared tooling configs                                                                                      |

### Authentication architecture

Authentication is built on **Clerk**.

- **Web**: `@clerk/nextjs` — ClerkProvider wraps the Next.js app; `middleware.ts` at the app root protects routes.
- **Mobile**: `@clerk/expo` — tokens stored in `expo-secure-store`.
- **Identity Service**: `AuthMiddleware` (`packages/services/identity/src/auth/middleware/auth.middleware.ts`) verifies the Clerk **session token** (Bearer) itself via `ClerkAuthService` → `@clerk/backend` `verifyToken` — networkless (public `CLERK_JWT_KEY`), with `CLERK_AUTHORIZED_PARTIES`/`azp` enforced. On first request it **read-through-creates** the user+account+profile (`UsersService.resolveOrCreateFromClaims`, Clerk `sub` → app ULID) and populates `req.user`; all routes except `/health` are protected. Admin `scopes`/`permissions` come from the signed token's `public_metadata`. There is deliberately **no** trusted-header (`x-authorizer-context`) path — the service is fronted by a public ALB, so a client-suppliable header would be forgeable (PR #39).
- **Clerk Webhooks**: `packages/services/identity-webhooks/src/handlers/identityWebhook.ts` handles `user.created/updated/deleted` events at the public `POST /v1/webhooks/users` (no gateway auth; verified via `svix` signature inside the Lambda).

### Identity service (NestJS)

`packages/services/identity/src/` is organized by domain:

- `app.module.ts` — root module wiring
- `auth/` — `ClerkAuthService` (session-token verification) + `AuthMiddleware` (Bearer auth, read-through user resolution)
- `users/` — `UsersModule`: user CRUD, avatar upload, profile resolution
- `admin/` — admin-scoped endpoints
- `database/` — `DatabaseModule` (global Drizzle provider), schema definitions, DAOs, migrations
- `config/` — Zod env schema (`EnvironmentSchema`); requires `DATABASE_URL` or individual `DB_*` vars plus `DELETION_QUEUE_URL`
- `queue/` — SQS deletion queue integration
- `types/` — shared TypeScript types including `AuthorizerContext`

### Identity-webhooks (Lambda)

`packages/services/identity-webhooks/src/` contains raw Lambda handlers (no NestJS):

- `handlers/identityWebhook.ts` → Clerk webhook sync (user.created/updated/deleted → RDS)
- `handlers/deletion-worker.ts` → async SQS-triggered user deletion retries
- `handlers/reconciliation.ts` → nightly scheduled reconciliation

Infrastructure lives in `infra/` subfolders of each service package using CDK v2.

### Infra stack topology

The identity service infra is split across stacks in `packages/services/identity/infra/lib/`:
`NetworkStack` → `DataStack` → `IdentityServiceStack` (ECS/Fargate, RDS credentials) plus the `WebhooksStack` (API Gateway + webhook/worker Lambdas) in `packages/services/identity-webhooks/infra/lib/`. The `packages/infra/global` package owns shared foundational resources.

A **single shared internet-facing ALB per stage** (`kitchensink-alb-{stage}`, the `SharedAlbStack` owned by `packages/infra/global`) fronts both backend services. Services do **not** create their own ALB: each imports the shared ALB's HTTPS listener and attaches a **host-based listener rule** routing its subdomain to its own target group (identity = priority 100, food = priority 200; future services pick 300, 400, … — priorities must be unique across the shared listener). Unmatched hosts hit the listener's default fixed-response 404. The HTTP listener redirects to HTTPS. The shared ALB security group (`AlbSecurityGroup`) is owned by `NetworkStack`; the shared `serviceSecurityGroup` already allows ALB ingress on :3000, so adding a service needs no SG change. See **`docs/architecture/decisions/0003-shared-alb-per-stage.md`**.

**Egress / NAT (cost-minimized).** The VPC uses a single **`t4g.nano` NAT instance** (not a managed NAT Gateway — ~$3–4/mo vs ~$32/mo; see ADR-0004). Fargate services run in **public subnets with `assignPublicIp`** (inbound locked to the ALB SG) and egress to Clerk/AWS via the Internet Gateway, so they do **not** use the NAT. The **only** NAT consumers are the four DB-bound webhook lambdas (`webhook`, `deletion-worker`, `reconciliation`, `migrate`), which must be VPC-attached to reach the private RDS.

### Cross-platform rule (enforced)

Every user-facing feature ships to **both** web and mobile in the same release. Platform-specific implementations use `.native.ts(x)` suffix (never `.mobile.*`). Shared business logic, types, and API clients live in shared packages. See `docs/CODING_STANDARDS.md §14` for the full rules.

### Deliberate decisions — looks wrong, isn't (read the ADR before changing)

Some choices look like bugs to "fix" but are intentional. Before reverting one, read the linked ADR and confirm you're not reintroducing the failure it prevents.

- **Sandbox front-end addressing — path routing, NOT per-PR subdomains.** Sandbox web previews are served from one stable origin (`sandbox.commise.app`) with the PR in the **URL path** (and static resources selected via a manifest query param), not from `pr-{N}.commise.app` subdomains. This is deliberate: Clerk's `azp` check is exact-string match (no wildcards), and the sandbox identity service is **shared**, so per-PR origins would 401 every preview. Before changing sandbox routing, the web app's serving origin, or `CLERK_AUTHORIZED_PARTIES` / `azp` handling, read **`docs/architecture/decisions/0001-sandbox-front-end-addressing.md`**.
- **Per-stage VPC CIDRs — prod stays 10.0.0.0/16, sandbox 10.1.0.0/16.** `NetworkStack.cidrForStage` sets each stage's VPC CIDR; prod's explicit value equals the historical CDK default on purpose, so it produces no diff. Changing the prod CIDR (or a construct ID feeding the VPC) replaces the prod VPC **and its RDS** (`removalPolicy: DESTROY`, no snapshot). A CIDR change is also never a one-shot `cdk deploy --all` (export-in-use deadlock), and you must never `cdk destroy` the global/data stack to recover (autoDeleteObjects buckets). Before touching VPC CIDRs, stack/construct names, or the teardown order, read **`docs/architecture/decisions/0002-vpc-consolidation-and-cidr-scheme.md`**.
- **One shared ALB per stage — services add host-rules, they do NOT own an ALB.** `SharedAlbStack` (`kitchensink-alb-{stage}`, global infra) provisions a single internet-facing ALB; identity and food each `Fn.importValue` its HTTPS listener and add an `ApplicationListenerRule` (identity = priority 100, food = priority 200) plus an A-record aliased to the shared ALB. This is a deliberate cost decision (one ~$16/mo ALB per stage instead of one per service while traffic is small). Don't "fix" a service by giving it its own ALB, don't reuse a priority, and remember the global ALB must deploy before the services (cross-stack listener-ARN import). Before changing the ALB topology, listener rules, or priority allocation, read **`docs/architecture/decisions/0003-shared-alb-per-stage.md`**.
- **NAT is a t4g.nano instance, and only the DB-bound webhook lambdas use it.** Don't "fix" the NAT instance back to a managed Gateway (~10× cost), and don't move the `webhook`/`deletion-worker`/`reconciliation`/`migrate` lambdas off the NAT or delete it — they're VPC-attached solely to reach the private RDS, and `assignPublicIp` does **not** give a VPC Lambda egress (Fargate only). The NAT instance SG is scoped to the VPC CIDR, not `0.0.0.0/0`. Before changing NAT topology, ECS subnet placement, or the webhook lambdas' VPC attachment, read **`docs/architecture/decisions/0004-minimize-nat-egress.md`**.
- **`Environment` tag governs teardown — `global` persists, `pr-{N}` is deleted on PR close.** Every CDK app tags at the `App` level: persistent global infra (network/data/domain/global/alb, identity-service, identity-webhooks) is `Environment=global` and named `kitchensink-*`; an ephemeral per-PR feature deploy (food etc., `stage=pr-{N}`) is `Environment=pr-{N}` (its suffix-named `kitchensink-{service}-pr-{N}` stacks are caught by that tag). The `cleanup` job in `.github/workflows/sandbox-deploy.yml` (on PR close) deletes everything matching `pr-{N}` **by tag OR name** — there is **no denylist**, so the safety depends entirely on **never naming/tagging a global resource `pr-{N}`** and on the delimiter-aware match (`pr-{N}` exactly or `pr-{N}-…`, so pr-1 ≠ pr-15). Any new **feature** service must tag `Environment=pr-{N}` (and prefix untaggable resources with `pr-{N}`). Read **`docs/architecture/decisions/0005-environment-tagging-and-pr-cleanup.md`**.
- **Non-prod cost levers diverge from prod on purpose — RDS gp3, Fargate Spot, and an account budget.** Non-prod (sandbox + `pr-{N}`) RDS uses `gp3` storage while prod stays `gp2`; non-prod Fargate tasks (identity service, food API/worker/change-refresh) run on `FARGATE_SPOT` while prod runs on-demand `FARGATE`. This is deliberate per-stage divergence, gated on `stage` (a `pr-{N}` preview runs Spot even though it imports the sandbox platform), and prod's synthesized template is unchanged. Don't "fix" sandbox back to on-demand/gp2 to match prod, and don't flip prod to gp3/Spot without its own PR + no-diff proof. A separate, account-scoped `kitchensink-cost-guardrails` stack (created ONCE, prod-stage-guarded in `packages/infra/global/bin/app.ts`) owns the $300 monthly budget + cost-anomaly alarms — it is `Environment=global`, never `pr-{N}`, so per-PR cleanup must not touch it. Read **`docs/architecture/decisions/0008-additional-cost-levers-gp3-fargate-spot-budget-guardrails.md`**.

## Testing policy — ABSOLUTE, NON-NEGOTIABLE (all phases, all features, no exceptions)

**This is a HARD requirement, not a guideline, and it outranks every other instruction about pace, scope, or convenience.** Write tests **BEFORE** the code they cover (TDD red → green), with **ZERO EXCEPTIONS**. Code that lacks the tests its category requires is **INCOMPLETE**: it **MUST NOT** be merged, marked "done", or called shippable — regardless of deadline or author (human **or** AI agent). "Add tests later", "the happy path is enough", "it's a small change", and "the tests can't run here" are all **VIOLATIONS**. Full matrix + enforcement: **`docs/CODING_STANDARDS.md §7.1`**.

- **UI code**: **EVERY** UI path/state — loading, empty, populated, error, gated, disabled, every branch, **NOT just the happy path** — MUST have a **vitest component test** (React Testing Library). **EVERY** happy-path / user story MUST have a **Playwright** test (web) **AND** a **Maestro** flow (mobile). Playwright IS the UI's integration test.
- **Non-UI code** (services, DALs, domain logic, controllers, workers, libraries): **unit tests AND integration tests — BOTH, always.** Unit-only is a violation.
- **Services** (deployable HTTP APIs): additionally **e2e tests AND k6** load/performance tests.

A feature is **NOT DONE** until every category it touches has **passing** tests of every required kind. If a test cannot run locally (e.g. no Docker), it is still **written** and run in **CI** — never skipped. This overrides schedule, convenience, and any impulse to defer. **NO EXCEPTIONS.**

## Key conventions

- **Commit messages**: Conventional Commits — `<type>(<scope>): <description>`. Enforced by commitlint.
- **Formatting**: 4-space indent, single quotes, semicolons, trailing commas, 120-char print width. Enforced by Prettier; run `npm run format` to fix.
- **Exports**: named exports only; default exports only where framework-required (Next.js pages, Expo entry).
- **Imports**: `.js`/`.jsx` extension on aliased imports; `.ts`/`.tsx` on relative imports. `import type` for type-only imports. Import order: external packages → internal aliases (blank line between). No relative imports crossing workspace boundaries.
- **Environment variables**: bracket notation only — `process.env['KEY']`, never `process.env.KEY`.
- **Dates**: ISO 8601 strings in interfaces, never `Date` objects.
- **Custom errors**: extend `Error`, call `Object.setPrototypeOf`, provide a matching `is*` type guard.
- **Impure functions**: document with `@sideEffect` JSDoc tag.
- **Function purity**: functions must be pure unless performing I/O, mutations, or external calls.
- **Test files**: `*.test.ts` in `__tests__/`; integration tests as `*.integration.test.ts` in `__integration__/`; E2E specs in `e2e/` as `*.spec.ts`. Always import `describe/it/expect/vi` explicitly from `vitest`.
- **Playwright selectors**: `getByRole` and `getByLabel` only — `data-testid` and `page.waitForTimeout()` are banned.
- **Fixture factories**: `make*` functions in `__fixtures__/` accepting `Partial<T>`.
- **TypeScript**: strict mode, zero `any`, no `@ts-ignore`/`@ts-expect-error`.
- **Folder structure**: organize by feature domain (not type); `helpers/` dirs are banned — use `utils/` co-located with consumers or `common/` for cross-cutting concerns.
