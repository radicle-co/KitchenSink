# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## ⛔⛔ THE PRIME DIRECTIVE — Operate at a staff-engineer level, always (read FIRST, every session)

**Why this exists — do not skip it.** LLM-written code is known to carry flaws ranging from the subtle to the significant, and agents left on their own cause production outages. Unforced, an agent codes at a **junior** level: locally plausible, superficially working, quietly wrong. The owner of this project **cannot babysit you or review every single line** — the entire working relationship depends on you producing code _and architecture_ that a **staff engineer would sign their name to**: the same high bar for **quality AND correctness** as a strong human at that level. The goal is exact and non-negotiable: _hand you the specs and the plans, and trust that what comes out is working correctly, is production-quality, and is exactly the code and architecture the system needs._ Earning that trust — the same confidence one would place in a real staff engineer — **is the job.** Anything less is a failure no matter how fast it was produced or how green the happy path looks.

**This is a standing instruction, active from the FIRST token of EVERY session.** You do not wait to be told to engage it; coding at a junior level "because nobody forced me this time" is precisely the failure mode this directive exists to eliminate. This section outranks any impulse toward speed, convenience, or the merely-obvious solution.

### What operating at a staff level actually requires (behaviors, not vibes)

Stretch beyond the obvious. Think multiple levels deep. Be inventive and creative, and leverage the same physical and conceptual tools and skill set a real staff engineer uses. Concretely, on every task:

1. **Own the outcome in production, not the diff on your screen.** The question is never "does this pass?" — it is "what takes this down at 3am, under load, on the Nth retry, with a stale cache, a failed dependency, a malicious input, or a partial deploy?" Engineer for _that_. Consider failure modes, concurrency, idempotency, blast radius, observability, and rollback **before** the happy path.
2. **Treat the spec/plan as a hypothesis to pressure-test, not gospel to transcribe.** Catch the requirement that is wrong, missing, ambiguous, or self-contradictory and surface it — a faithful implementation of a broken spec is still broken. Resolve gaps with the best-justified decision; never code around them silently.
3. **Think in systems and second-order effects.** Trace what your change touches: callers, callees, invariants, contracts, data at rest, other services, the people who operate it. A local fix that creates drift, leaks across a boundary, or introduces an inconsistency elsewhere is not a fix.
4. **Design for the cost of change.** Invest where reversal is expensive (wire/persisted/security/cross-service boundaries); stay lean where it is cheap. Make illegal states unrepresentable; parse, don't validate; choose the design that is _right_, not the first that compiles — and be able to justify it against the alternatives you rejected.
5. **Prove correctness adversarially.** Build tests to **fail if the code is wrong** — apply the mutation lens ("would this still pass if I broke the logic?"). Demonstrating the happy path is not proof; coverage is not correctness.
6. **Verify empirically — never assume, never claim done on faith.** Run it. Read the actual output, the actual types, the actual query, the actual failure. "It should work" is not a status.
7. **Be your own hostile reviewer before declaring done, and be honest about residual risk.** Re-read your change as a skeptic trying to break it. If anything is unverified, partial, or uncertain, say so plainly — false confidence is worse than a known gap, because it is exactly what destroys the owner's ability to stop checking your work.
8. **Leave the codebase more coherent than you found it.** Match existing patterns, keep one authoritative representation of each piece of knowledge, and do not let the system fragment under your edits.

### The critical-thinking posture — challenge, don't accept (the failures that hide behind "it works")

The specific gates below are symptoms. The root failure they share is a **posture**: executing faithfully instead of thinking critically and broadly, and treating whatever already exists as correct. Operating at a staff level is a way of _thinking_, not a checklist to satisfy. Hold this posture on EVERY change — to the code, the implementation, AND the system architecture:

- **Existing code is a claim to be challenged, not a fact to be matched.** "It's already here and it passes" is not "it's right." When you read, touch, or test any code — including code you didn't write — ask whether it should exist in that form at all. The hand-rolled thing you're about to add a test for may be the thing to delete. Matching the surrounding code is correct ONLY when the surrounding code is correct; consistency is never a reason to propagate a flaw.
- **Challenge the premise, not just the execution.** Before building, question the requirement, the design, the abstraction, the boundary, the architecture: is this the right thing to build, in the right shape, at the right layer? Faithfully implementing a flawed design — or polishing bad code to a shine — is still a failure. Push back on the work itself, then do the _right_ work.
- **Judgment BEFORE effort — aim rigor at the right thing.** Thoroughness on the wrong thing is wasted, and worse, it _disguises_ the mistake as diligence. Exhaustive tests, mutation scores, and empirical verification prove a _sound_ design correct — they do not make an unsound one sound. Before pouring in effort, ask whether the thing deserves to exist as-is. **Polished mistakes are still mistakes.**
- **Zoom out — reason about the system, not the line.** Every change is a chance to ask the broad questions a staff engineer asks: what does this mean for the architecture, the contracts, operability, the other services, the next engineer, six months out? Fixing a local symptom while the systemic cause stands is not a fix.
- **Be generative, not reactive.** If you are only responding to explicit asks and review comments, you are an implementer, not a staff engineer. Proactively surface the problems no one flagged — the reinvention, the leaky abstraction, the contract that will drift, the missing test tier, the wrong architecture — before a human has to point them out.
- **"Works" and "tested" are the FLOOR, not the bar.** The bar is: _is this the best solution a staff engineer would choose from scratch_ — simplest, best-designed, using the best available tools, and defensible to a skeptical senior? Correct-and-covered is where you START asking that question, not where you stop. Settling at "it passes" is settling.
- **Run the reputational lens, proactively.** Before calling anything done, look at it as the staff engineer whose name is on it and ask _"what here would make me wince?"_ — then fix it, before anyone points it out. The goal is that the owner never has to catch what you should have caught yourself.

### ⛔ Pre-write gates — check these BEFORE you type, not after review catches you

The failures below are the ones that slip through most easily because the _surrounding code already commits them_. Pattern-matching neighbors is NOT a defense — the standard/doc wins over the local convention, and propagating an existing violation is still a violation.

- **Library-first.** Before hand-rolling any non-trivial mechanism — HTTP clients, query-string/URL building, retries/backoff, date/time math, file-type/magic-byte detection, parsing, crypto, validation, ID generation — you MUST first check whether a **stable, well-maintained, widely-used library** already does it, and USE it unless you can state a specific, concrete reason not to (and "the codebase hand-rolls it elsewhere" is not one). Writing an "exhaustive test" for a reinvention does not redeem the reinvention. Reach for the library.
- **Read the standard before you create/name a file.** Before adding a file, verify its name and location against `docs/CODING_STANDARDS.md §1` **for the package it lives in** (backend NestJS kebab `name.type.ts` vs frontend camelCase/PascalCase). Before writing a function, confirm purity/`@sideEffect`, the custom-error convention, and the JSDoc rule apply. Do not infer the rule from a neighbor that may itself be wrong.
- **Tests come first (TDD red→green).** Write the failing test before the code it covers, per §7.1 — not alongside, not after. If you wrote the code first, you skipped the gate.
- **Localize user-facing strings.** Any string a user reads (UI copy, and any surface that reaches them) goes through the localization path, never a hard-coded literal.

If you are about to hand-roll, name a file, or ship a string and you have NOT done the corresponding check above, stop and do it.

**The standard, in one line:** produce the code and the architecture the system _exactly needs_ — correct, robust, production-grade, and defensible line by line — as if a staff engineer whose reputation is on the line wrote it, because for this project, that is who you are. The two sections below are _how_ you meet this bar; this section is _why_, and it governs all of them.

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

## ⛔ MANDATORY — Design-pattern-first development

**Design patterns are the default language of this codebase — for writing it, describing it, and reviewing it.** A high-quality codebase is _built_ with patterns: they are the shared vocabulary for organizing, modeling, and orchestrating code, and extensibility + modularity come with them practically for free.

1. **Always use design patterns, unless applying one would break the pattern or the code.** When a use-case is what a named pattern solves, the pattern IS the simplest correct design — use it (individually or, better, **composed**: e.g. statechart + headless hook + adapter; registry + discriminated-union render map; specification/policy module + value object). The only misuse is _forcing_ a pattern onto a shape it doesn't match, or applying it in a way that violates the pattern's own contract. "Pattern intent already satisfied by a language/library feature" counts as using the pattern (a TS discriminated union + exhaustive switch IS Visitor; TanStack mutations ARE Command; `React.lazy` IS Proxy) — say so rather than adding redundant machinery.
2. **Speak in patterns first.** Pull-request descriptions and code reviews MUST lead with the design patterns involved — which patterns are used/introduced/affected, how they compose, and why they fit — _before_ line-level detail. Component/module JSDoc names the pattern(s) the unit implements. Discussion of the codebase happens in pattern vocabulary ("the policy module", "the editor statechart", "the facet registry"), not plain-code narration. Reviews reject unnamed ad-hoc shapes where a fitting pattern exists.
3. **Pure functions and pure components are requirements.** Functions are pure unless performing I/O, mutations, or external calls (documented `@sideEffect`). Presentational (render) components are pure `props → JSX`: no data fetching, no mutations, no side effects, ONE responsibility each; a boolean/mode prop that switches _behavior_ (not mere display derivation) belongs in the orchestration layer, which selects the right render component instead. Refs are near-forbidden — permitted only to wrap a genuinely external, non-declarative system with no alternative.
4. **Record pattern decisions where they're made.** A feature's plan or design doc carries its pattern register: the prescriptions in force, the patterns deliberately preserved, and the shapes where a pattern's intent is already satisfied (so nobody re-introduces redundant machinery or "refactors" a pattern away). New work cites the pattern it implements.

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
| `packages/apps/commise/mobile`        | `@commise/mobile`                                          | Expo 57 / React Native 0.86 mobile app (new-architecture only)                                              |
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
- **Clerk Webhooks**: `packages/services/identity-webhooks/src/handlers/identityWebhook.ts` handles `user.created/updated/deleted` events at the public `POST /api/v1/webhooks/users` (no gateway auth; verified via `svix` signature inside the Lambda).

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

- **Sandbox front-end addressing — per-PR SUBDOMAINS (cutover executed 2026-07-13); the path form 404s BY DESIGN.** A sandbox web preview lives at **`https://pr-{N}.sandbox.commise.app/`** (at root, no `basePath`). The older path form — `sandbox.commise.app/pr-{N}` — **returns 404 on purpose**; so does the apex root. Do **not** "fix" that 404 by restoring path routing. The addressing form is selected by `SANDBOX_PREVIEW_MODE` (`subdomain`, set as both a GitHub repo variable and a Vercel build var; unset/`path` is the pre-cutover fallback), and CI publishes the working URL as the PR's own GitHub deployment — Vercel's native preview button points at the bare deployment host, which does **not** work under our router + `azp`.
    - **Why the original "subdomains are impossible" reasoning no longer binds.** It rested on Clerk matching `azp` by exact string. True at the SDK layer, but **`azp` enforcement is our code**: `resolveAzpEnforcement` (`clerk-auth.service.ts` → `@kitchensink/clerk-verify`) validates the **signature-verified** `azp` against an **anchored regex** (`CLERK_AZP_PATTERN`), which makes bounded per-PR patterns safe with enforcement **ON**. A 2026-07-12 spike also probed the sandbox dev instance live: it reflects **any** `Origin` with `allow-credentials: true` (Clerk's "allowed subdomains" toggle is production-instance-only, and the dev instance is not origin-restricted). That is precisely why **our regex `azp` guard is the real trust boundary on sandbox** — keep it anchored, and never disable `azp` there.
    - **Current posture is `transition`, not final.** Sandbox identity runs `CLERK_AZP_PREVIEW_MODE=transition` (SSM `azp-preview-mode`), which **also** admits the legacy path-routed apex origin during the migration; any other value is strict/subdomain-only. The `azp` confirmation is **DONE** (2026-07-28): a real browser sign-in on the live `pr-73.sandbox.commise.app` minted `azp = "https://pr-73.sandbox.commise.app"` and the signed-in Home rendered. Still open: drain and set `strict`, then retire the `basePath` machinery. Until then the `// ⚠️ DELIBERATE` path-routing guards in `next.config.ts`, `src/lib/base-path.ts`, `src/middleware.ts`, and the router describe the **rollback** posture — leave them alone.
    - **⚠️ Previews are currently UNREACHABLE in a browser, and the fix is infra, not code.** The router's Host swap (`ALL_VIEWER_EXCEPT_HOST_HEADER` + `updateRequestOrigin`) leaves the Next app terminating the **Vercel deployment host**, not the public preview origin — so Clerk's handshake `redirect_url` points at the SSO-protected bare deployment host (dead-ends at `vercel.com/login`) and Next 15 rejects every Server Action with a 500 (`Origin !== Host`). Do **not** re-propose `x-forwarded-host` (the CFF already sets it; Vercel overwrites it), and do **not** switch the router to `ALL_VIEWER` (Vercel answers `404 DEPLOYMENT_NOT_FOUND` or `403 x-vercel-mitigated: deny`). The proven cure resolves `pr-{N}.sandbox.commise.app` **directly to Vercel** (Route 53 `CNAME cname.vercel-dns.com` + Vercel domain + an explicit per-deployment alias), which makes the custom domain protection-exempt and retires the router/KVS/bypass token for previews. `experimental.serverActions.allowedOrigins` in `next.config.ts` is a partial mitigation only. Read the ADR's **"Update (2026-07-28)"** before touching any of it.
    - **Prod is unaffected** — single origin, exact-match `azp`. Before changing sandbox routing, the web app's serving origin, `SANDBOX_PREVIEW_MODE`, or `CLERK_AUTHORIZED_PARTIES` / `CLERK_AZP_PATTERN` / `azp` handling, read **`docs/architecture/decisions/0001-sandbox-front-end-addressing.md`** (its "Update (2026-07-12)" and "CUTOVER EXECUTED" notes are the current record).
- **Per-stage VPC CIDRs — prod stays 10.0.0.0/16, sandbox 10.1.0.0/16.** `NetworkStack.cidrForStage` sets each stage's VPC CIDR; prod's explicit value equals the historical CDK default on purpose, so it produces no diff. Changing the prod CIDR (or a construct ID feeding the VPC) replaces the prod VPC **and its RDS** (`removalPolicy: DESTROY`, no snapshot). A CIDR change is also never a one-shot `cdk deploy --all` (export-in-use deadlock), and you must never `cdk destroy` the global/data stack to recover (autoDeleteObjects buckets). Before touching VPC CIDRs, stack/construct names, or the teardown order, read **`docs/architecture/decisions/0002-vpc-consolidation-and-cidr-scheme.md`**.
- **One shared ALB per stage — services add host-rules, they do NOT own an ALB.** `SharedAlbStack` (`kitchensink-alb-{stage}`, global infra) provisions a single internet-facing ALB; identity and food each `Fn.importValue` its HTTPS listener and add an `ApplicationListenerRule` (identity = priority 100, food = priority 200) plus an A-record aliased to the shared ALB. This is a deliberate cost decision (one ~$16/mo ALB per stage instead of one per service while traffic is small). Don't "fix" a service by giving it its own ALB, don't reuse a priority, and remember the global ALB must deploy before the services (cross-stack listener-ARN import). Before changing the ALB topology, listener rules, or priority allocation, read **`docs/architecture/decisions/0003-shared-alb-per-stage.md`**.
- **The "food" service is really the INGREDIENT service, and a recipe is NEVER written back into it.** Its data comes from the USDA and it holds ingredients, not dishes — the owner has said outright they would have named it `ingredient-service` and that **renaming it is not worth the cost today**, so read every `food_*` identifier (`kitchensink_food`, `food_id`, `@kitchensink/food-service-client`, `food-pr-{N}` hosts) as `ingredient_*` and leave the names alone. This matters because the misleading name invites two "fixes" that are both wrong: a rename, and — more damaging — registering a finished recipe as a food entity so it can be used as an ingredient or logged for nutrition. That was **DECIDED NO** (2026-08-08, feature 001 T150): _a recipe is a method, not a substance_ — there is more than one way to make a pizza, so two cooks' pizzas share a name and nothing else, and publishing one of them as "pizza" would assert a nutritional identity that does not exist. The relationship is **one-directional and stays that way**: recipes reference ingredients by opaque `food_id` and compute a recipe-side nutrition summary; the food DB keeps a SINGLE writer, the USDA/source pipeline. Accepted consequences: a recipe cannot be an ingredient in another recipe, and a cooked dish cannot be logged as a food. If either is ever wanted it is a NEW feature modelling a user-authored composite, not a write-back. See `specs/001-commise-recipe-app/tasks.md` T150.
- **NAT is a t4g.nano instance, and only the DB-bound webhook lambdas use it.** Don't "fix" the NAT instance back to a managed Gateway (~10× cost), and don't move the `webhook`/`deletion-worker`/`reconciliation`/`migrate` lambdas off the NAT or delete it — they're VPC-attached solely to reach the private RDS, and `assignPublicIp` does **not** give a VPC Lambda egress (Fargate only). The NAT instance SG is scoped to the VPC CIDR, not `0.0.0.0/0`. Before changing NAT topology, ECS subnet placement, or the webhook lambdas' VPC attachment, read **`docs/architecture/decisions/0004-minimize-nat-egress.md`**.
- **`Environment` tag governs teardown — `global` persists, `pr-{N}` is deleted on PR close.** Every CDK app tags at the `App` level: persistent global infra (network/data/domain/global/alb, identity-service, identity-webhooks) is `Environment=global` and named `kitchensink-*`; an ephemeral per-PR feature deploy (food etc., `stage=pr-{N}`) is `Environment=pr-{N}` (its suffix-named `kitchensink-{service}-pr-{N}` stacks are caught by that **tag**, not by the name rule, which is a prefix match). The `cleanup` job in `.github/workflows/sandbox-deploy.yml` (on PR close) and the daily `reap-abandoned` job both run the ONE script `.github/scripts/teardown-sandbox-pr.sh`, which deletes everything matching `pr-{N}` **by tag OR name** — there is **no denylist**, so the safety depends entirely on **never naming/tagging a global resource `pr-{N}`** and on the delimiter-aware match. That match lives once, in `.github/scripts/pr-scope.sh` (`pr-{N}` exactly or `pr-{N}-…`, so pr-1 ≠ pr-15), and is regression-tested against the real shell functions by `packages/infra/global/__tests__/pr-scope.test.ts` — do not add a second matcher, do not relax it to a bare prefix, and do not add an "orphaned-looking" sweep. Any new **feature** service must tag `Environment=pr-{N}` (and prefix untaggable resources with `pr-{N}`).
    - **A preview's PUBLIC ADDRESS is CREATED and RECLAIMED by CI, because CloudFormation owns neither** (#94): the Route 53 `CNAME pr-{N}.sandbox.commise.app → cname.vercel-dns.com`, the Vercel project-domain binding **and** the per-deployment alias. Teardown (`scripts/teardownPreviewDomain.ts`) runs FIRST in the cleanup script, before any stack delete (which can hang); creation (`scripts/createPreviewDomain.ts`) runs from the `preview-domain` job on every non-closed PR event. **The two orders are deliberate mirrors and must not be "simplified":** teardown deletes DNS **before** releasing the Vercel claim, creation takes the claim **before** publishing DNS — either reversal manufactures the subdomain-takeover window ("resolves to Vercel, nobody claims the name"), so a failure in the first step aborts before the second. Creation's **alias comes LAST and is retried** because Vercel refuses it (`400 cert_missing`) until it has issued a cert, and refuses the cert (`449`) until the name already resolves to Vercel — and it re-runs on every push on purpose, since an alias left pinned to one deployment is what made PR #73 serve a stale build. Absent/existing records are **success** (idempotent) in both directions, but a `409` for a domain on a **different** Vercel project fails loudly; everything else is an `::error::` + non-zero exit. A Vercel _branch domain_ (`gitBranch`) is **not** a substitute for the alias — measured to re-enable deployment protection. The DNS scope is **exact first-label equality** (`pr-{N}` only — `pr-{N}-…` does NOT qualify in DNS), defined ONCE in `scripts/previewDomainScope.ts` (do not add a second matcher) and re-asserted inside every adapter of both commands, because the same zone holds the apex, the `*.sandbox` wildcard and **`identity.sandbox.commise.app` — the single shared identity service every preview signs in against**. The daily reaper also discovers candidate tokens from Route 53, since a web-only PR owns no stack/ECR/log group.
    - Read **`docs/architecture/decisions/0005-environment-tagging-and-pr-cleanup.md`** and ADR-0001's _"Teardown of the preview address"_.
- **Non-prod cost levers diverge from prod on purpose — RDS gp3, Fargate Spot, and an account budget.** Non-prod (sandbox + `pr-{N}`) RDS uses `gp3` storage while prod stays `gp2`; non-prod Fargate tasks (identity service, food API/worker/change-refresh) run on `FARGATE_SPOT` while prod runs on-demand `FARGATE`. This is deliberate per-stage divergence, gated on `stage` (a `pr-{N}` preview runs Spot even though it imports the sandbox platform), and prod's synthesized template is unchanged. Don't "fix" sandbox back to on-demand/gp2 to match prod, and don't flip prod to gp3/Spot without its own PR + no-diff proof. A separate, account-scoped `kitchensink-cost-guardrails` stack (created ONCE, prod-stage-guarded in `packages/infra/global/bin/app.ts`) owns the $300 monthly budget + cost-anomaly alarms — it is `Environment=global`, never `pr-{N}`, so per-PR cleanup must not touch it. Read **`docs/architecture/decisions/0008-additional-cost-levers-gp3-fargate-spot-budget-guardrails.md`**.
- **Sign-out goes through ONE command that VERIFIES the session ended — on BOTH platforms — and `useClerk().signOut` is the wrong `signOut`.** `useClerk().signOut` is the raw `IsomorphicClerk.signOut`: before clerk-js has loaded it QUEUES the call in `premountMethodCalls` and **resolves**, so `await signOut()` succeeds having revoked nothing, and the caller's full-document navigation then destroys the queued callback. Observed end-to-end: the viewer is navigated off the settings page while their session stays ACTIVE at Clerk and keeps minting fresh JWTs. So `LogoutButton`, `AccountCloseForm`, and `AccountEraseForm` all issue `useSignOutAndLeave()`, which (a) signs out via `useAuth().signOut` — Clerk's load-SAFE wrapper, which awaits clerk-js — (b) then asserts `clerk.loaded && !clerk.session` and throws if not, and (c) short-circuits `status === 'error'` because Clerk's awaiter never settles on it. Do NOT call `signOut` from either hook directly in a new control, do NOT drop the post-condition (it is the guarantee; `clerkLoaded` is an undocumented Clerk internal), do NOT gate on `useAuth().isLoaded` instead (it is `true` during the load window on web, because `@clerk/nextjs` feeds `deriveState` an SSR `initialState`), do NOT assume Clerk's own `<SignOutButton>` is safe (it is `renderWhileLoading: true` — same bug), and do NOT "fix" sign-out by clearing `__session`/`__client_uat` yourself (that hides the session instead of revoking it). The ordering + post-condition live ONCE, in `signOutAndVerify` (`@commise/features-account/src/session`); `useSignOutAndLeave` (web) and mobile's `useSignOutAndVerify` are thin adapters over it, so a fix to one platform can't miss the other — mobile's two controls were `void signOut()` (fire-and-forget, no error path) and now issue the same command, with a busy state and a localized failure. Read **`docs/architecture/decisions/0009-clerk-signout-load-gate.md`** (its "Update (2026-07-27) — the mobile half" and "Update (2026-07-28) — where sign-out LANDS").

- **There is NO welcome/landing screen — the signed-out front door IS sign-in, on BOTH platforms (owner decision, 2026-07-28).** Web's `[locale]/page.tsx` redirects a signed-out caller to `/{locale}/sign-in` and renders Home for a signed-in one; mobile's `AuthGate` opens directly on `LoginScreen` and its `Screen` union deliberately has no landing member, so the state cannot represent one. The branded U8 welcome hero (`/welcome`, `WelcomeContent.tsx`, `screens/welcome.tsx`, `.maestro/auth/welcome-flow.yaml`, the `welcome.*` i18n blocks) was **deleted**, not disabled — this **reverses** the earlier U8 reasoning that the front door should be the branded hero "rather than straight to the bare sign-in form", so do not "restore" it as a missing screen, and do not reintroduce an interstitial in either gate (`src/app/[locale]/__tests__/page.test.tsx` and `tests/components/AuthGate.native.test.tsx` assert that nothing stands in front of sign-in). **Sign-UP is now reachable ONLY from the sign-in surface** — web via the link Clerk's `<SignIn>` renders from `signUpUrl`, mobile via `LoginScreen`'s own control — so that affordance is load-bearing (asserted by `tests/e2e/routeProtection.spec.ts` and `.maestro/auth/login-flow.yaml`); removing it strands registration. Sign-out/close/erase keep navigating to the bare `/` **on purpose**, so the signed-out destination stays defined in ONE place. Two accepted consequences are recorded, not bugs: there is no pre-auth surface explaining the product, and a just-erased user lands on a sign-in form for a deleted account. See **`specs/001-commise-recipe-app/spec.md` FR-045a** (+ Clarifications "Session 2026-07-28").

- **A PR preview's deploy jobs are gated ENSURE-EXISTS, not on changed paths — and food's `401` is the smoke's PASS.** `deploy-food` and `deploy-recipe` in `.github/workflows/sandbox-deploy.yml` run when the service's sources CHANGED, when the run was dispatched by hand, when the `pr-{N}` stack is **absent or in an unusable resting state**, or when the origin it should be serving does not answer `200` — and skip only when unchanged AND already serving. The decision lives ONCE in `.github/scripts/deploy-gate.sh` (pure `decide` + impure `evaluate`, regression-tested by `packages/infra/global/__tests__/deploy-gate{,.integration}.test.ts`). Do NOT restore the old `steps.changes.outputs.* == 'true'` gate on every step: that is what left a recipe-only PR with **no food service at all** while `RECIPE_FOOD_SERVICE_URL` (REQUIRED since `c60dc9ae`) named a host that did not resolve, silently degrading the whole preview's ingredient catalog to `catalogAvailability: 'unavailable'` behind green checks. Do NOT "simplify" it to an unconditional redeploy either (two Docker builds + pushes for a README-only push). Ordering is doubly protected: `deploy-food`'s job-level `if:` must stay true for every non-closed `pull_request` event (a skipped dependency skips its dependents), AND `deploy-recipe` carries `!cancelled() && needs.deploy-food.result != 'failure'` (which is also what makes `workflow_dispatch` of `service: recipe` runnable at all). The post-deploy smoke now asserts the ECOSYSTEM: the running recipe task's `FOOD_SERVICE_URL` is this stage's food origin, and that origin answers — where **`401`/`403` (and `429`) are the PASS**, because `/api/v1/foods/search` requires a Clerk token, so only a transport failure, the shared ALB's default `404 text/plain` (ADR-0003), a `2xx` to an unauthenticated probe, or a `5xx` is a failure. Per-PR food runs ONE API task on purpose (≈ $8.25/mo per open PR). Read **`docs/architecture/decisions/0010-ensure-exists-per-pr-deploy-gate.md`** (including its residual-risk list: per-PR ECS is NOT in the sandbox nightly-shutdown selector).

- **The service OWNS its wire types: zod authored in-service, copied to `packages/schemas/*`, and clients NEVER redeclare a wire shape.** Every HTTP service's contract is authored as zod at `packages/services/<svc>/src/**/*.schema.ts`, beside the controller it serves and used for that controller's validation; a committed COPY lives at `packages/schemas/<svc>` (`@kitchensink/schema-<svc>`), exporting the zod, `z.infer` types, a `CONTRACT_HASH`, and a DERIVED `openapi.yaml`. Clients import from the schema package and declare no wire types; a consumer whose shape genuinely differs DERIVES it (`Pick`/`Omit`/`Partial`) rather than declaring it independently. Three things here look wrong and are not: **(1)** the schema package is a literal file COPY, not a transformation — zod schemas are runtime values so they cannot be derived from themselves, and every package exports raw `./src/*.ts` so there is no bundle-into-`dist` path; **(2)** turbo uses `$TURBO_ROOT$` **`inputs`**, NOT `dependsOn` — that edge closes the cycle `client -> schema -> service -> client` because `recipe-service` devDepends on its own client, and ordering was never the requirement since the generated files are committed; **(3)** `openapi.yaml` is DERIVED output for `oasdiff`/docs/integrators and is **never a codegen input** — deriving types through JSON Schema loses `readonly`, branded and template-literal types and flattens discriminated unions. ⛔ And the INVERSE case is deliberate: a third-party API we do NOT serve (`packages/clients/usda`, Clerk, Vercel) has no service of ours to own its type and cannot be trusted, so those clients validate the raw upstream shape at the boundary with zod and MAY declare their own types — do not "converge" them or write an OpenAPI document for an API we do not serve. Before changing any of this read **`docs/architecture/decisions/0014-service-owned-api-contracts.md`**, `docs/CODING_STANDARDS.md` §15, and `specs/governance-rules.md` GR-015.

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
- **Imports**: `.js`/`.jsx` on aliased imports. Relative imports follow the package's `moduleResolution`: `.js` under `NodeNext` (backend/clients/shared — the base config default), extensionless under `bundler` (`@commise/web`). **Never end a relative import in `.ts`/`.tsx`** — that is `error TS5097` under NodeNext. `import type` for type-only imports. Import order: external packages → internal aliases (blank line between). No relative imports crossing workspace boundaries.
- **Environment variables**: bracket notation only — `process.env['KEY']`, never `process.env.KEY`.
- **Dates**: ISO 8601 strings in interfaces, never `Date` objects.
- **Custom errors**: extend `Error`, call `Object.setPrototypeOf`, provide a matching `is*` type guard.
- **Impure functions**: document with `@sideEffect` JSDoc tag.
- **Function purity**: functions must be pure unless performing I/O, mutations, or external calls.
- **Test files**: unit `*.test.ts` in `__tests__/`. Backend integration `*.integration.test.ts` in `tests/`, backend e2e `*.e2e.test.ts` in `tests/e2e/`; frontend integration `*.integration.test.ts(x)` in `tests/__integration__/`. **Bare `*.spec.ts` is reserved for Playwright** (`tests/e2e/`) — every vitest tier uses `.test.ts`, because a shared suffix makes Playwright try to run vitest files and crash the run. Each non-unit tier needs its own `vitest.*.config.ts`, its own `package.json` script, exclusion from the default `test` globs, **and** a CI step (CI calls them per-workspace by name). Full tables: `docs/CODING_STANDARDS.md §7 Test File Location`. Always import `describe/it/expect/vi` explicitly from `vitest`.
- **Playwright selectors**: `getByRole` and `getByLabel` only — `data-testid` and `page.waitForTimeout()` are banned.
- **Fixture factories**: `make*` functions in `__fixtures__/` accepting `Partial<T>`.
- **TypeScript**: strict mode, zero `any`, no `@ts-ignore`/`@ts-expect-error`.
- **Folder structure**: organize by feature domain (not type); `helpers/` dirs are banned — use `utils/` co-located with consumers or `common/` for cross-cutting concerns.
