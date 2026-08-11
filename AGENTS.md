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
`tsvector` FTS), `class-validator` + `class-transformer` (DTO validation), `@nestjs/config` with a Zod
env schema, `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` (photo objects),
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

## Cross-platform rule (enforced)

Every user-facing feature ships to **both** web and mobile in the same release. Platform-specific
implementations use the `.native.ts(x)` suffix, never `.mobile.*`. Shared business logic, types and API
clients live in shared packages. See `docs/CODING_STANDARDS.md §14`.

<!-- MANUAL ADDITIONS END -->
