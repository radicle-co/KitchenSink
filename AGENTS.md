# KitchenSink agent guide

This is the short, always-on entry point for Devin and AI reviewers. Devin also
loads `CLAUDE.md`, but large rule files can be truncated in context. Read the
relevant section of `CLAUDE.md` **from disk**, not just its injected excerpt,
before working. `CLAUDE.md` contains detailed reasoning, including historical
postures later superseded in that file; use the latest explicit ruling and
check the current code. The ADRs under `docs/architecture/decisions/` govern
changes to settled architecture. Do not replace a specific ruling with a
generic best practice. Keep this file small and current: reviewers treat its
claims as instructions. Verify changes to stack claims and ADR summaries with
`packages/tools/repoGuards/__tests__/reviewerContext.test.ts`.

## Before making changes

- Own the production outcome, not just a green diff. Challenge the spec and
  existing code; trace consumers, failure paths, concurrency, security,
  operability, and rollback. Prefer the smallest complete solution, not a
  shortcut that omits current requirements. Prefer maintained libraries to
  hand-rolled parsing, retries, date math, crypto, or validation.
- Read the applicable spec/plan and ADR before writing. Before modifying code,
  read the relevant part of `docs/engineering/ENGINEERING_EXCELLENCE.md`:
  backend/frontend excellence plus design patterns for production code, and
  test excellence for any test or test review. Read
  `docs/CODING_STANDARDS.md` for naming, purity, JSDoc, and test tiers.
- Tests precede implementation: write acceptance-derived tests, see them fail,
  then implement and see them pass. UI: component tests for all states plus
  Playwright (web) and Maestro (mobile) per story. Non-UI: unit and integration.
  HTTP services also require e2e and k6; migrations require a real-DB LOCAL
  e2e. Integration tests mock databases; only e2e uses a real database. LOCAL
  e2e runs on a developer machine via `npm run test:e2e`, not in CI; deployed
  e2e targets a deployed sandbox and may skip when it is down. Never claim a
  local suite proves a deploy. See `docs/CODING_STANDARDS.md` section 7.1a.
- For non-trivial architecture and user-facing changes, follow `CLAUDE.md`'s
  design/UX/code-health review gates using available tools; if a named
  Claude-only agent is unavailable, do the corresponding analysis yourself
  and report the gap instead of claiming it ran. Do not add ad-hoc abstractions
  where a fitting pattern already exists. Use the shared design system and
  localize every user-facing string.
- Preserve other people's work. Verify empirically, report which tiers ran
  and which did not, and flag any remaining uncertainty. Conventional commits
  use `<type>(<scope>): <description>`.

## Active Technologies

- Turborepo with npm workspaces under `packages/`. Inspect each package's
  `package.json` for its actual scripts. Root commands: `npm run build`,
  `npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`.
- Node 24 (`.nvmrc`); TypeScript 6. Web: Next.js 16 App Router, React 19,
  Tailwind v4. Mobile: Expo 57, React Native 0.86 (new architecture). Backend:
  NestJS 11, Drizzle, PostgreSQL 18. Infrastructure: CDK v2, ECS/Fargate,
  RDS, S3, SQS, CloudFront. Auth is Clerk, not Auth0: `@clerk/nextjs`,
  `@clerk/expo`, `@clerk/backend`, `expo-secure-store`. Services use
  `@aws-sdk/client-s3` and `@aws-sdk/client-sqs` where needed. Input
  validation uses `nestjs-zod`'s `ZodValidationPipe`, not Nest's
  `ValidationPipe` for `createZodDto`.

## Conventions

- Use named exports except framework-required defaults; type-only imports,
  `process.env['KEY']`, ISO strings in interfaces, and `@sideEffect` on impure
  functions. Custom errors extend `Error` with `Object.setPrototypeOf` and an
  `is*` guard. Organize by domain, not `helpers/` or intra-package barrels.
  Relative import suffixes depend on the package's module resolution.
- Every user-facing feature ships on web and mobile together. Platform files
  use `.native.ts(x)`, not `.mobile.*`. Shared logic, types, and clients live
  in shared packages (`docs/CODING_STANDARDS.md` section 14). In the web app,
  read its nested `AGENTS.md` and installed Next.js docs before using APIs.

## Architecture tripwires

These short rulings keep review bots from reversing deliberate choices. Read
`CLAUDE.md` and the cited ADR before changing an affected boundary; this list
is an index, not a substitute for the reasoning or implementation.

### Platform, deployment, and operations

- **ADR-0033 / 0001:** PR previews use `pr-{N}.sandbox.commise.app` at `/`;
  the old path form 404s by design. Keep sandbox's anchored Clerk `azp` regex;
  preview DNS must resolve directly to Vercel, not through CloudFront. Legacy
  apex acceptance during `transition` is not permission to disable `azp`.
- **ADR-0002:** Prod VPC is 10.0.0.0/16, sandbox 10.1.0.0/16. Changing prod's
  CIDR or VPC construct IDs can replace the VPC and RDS without a snapshot.
- **ADR-0003:** One shared ALB per stage; services import its HTTPS listener
  and use the shared priority allocator (`shared/infra/src/alb`). No per-service
  ALB or independently invented rule priority.
- **ADR-0004:** VPC Lambdas egress through the `t4g.nano` NAT instance;
  public-subnet Fargate egresses via IGW. Do not replace NAT with a Gateway or
  add paid VPC interface endpoints as a workaround; free gateway endpoints
  are a separate case.
- **ADR-0005:** Teardown scopes by delimiter-aware `pr-{N}` name matching
  and exact allowed environment-tag values in `.github/scripts/prScope.sh`.
  Never widen to a bare prefix or add an orphan sweep. Claim the Vercel
  preview domain before publishing DNS; on teardown remove DNS before
  releasing the claim.
- **ADR-0006:** Per-PR features share a base-stage platform but have their
  own stage and logical database. Do not infer that a shared RDS means a
  shared per-PR database or cleanup scope.
- **ADR-0060:** Sandbox starts only by hand through Sandbox Up. Midnight is
  the only scheduled stop; non-prod scheduled rules start disabled and the
  scheduler `sync` is the sole writer of their state. CI jobs skip when down.
- **ADR-0061:** After the midnight stop, reclaim deletes unused PR stacks,
  then shared tier only when safe; preserve its bounded IAM grant, no VPC,
  no role passed to `DeleteStack`, and shell-matcher parity.
- **ADR-0008:** Non-prod RDS uses gp3 and Fargate Spot; prod retains gp2 and
  on-demand. The account budget is account-scoped, not a PR resource.
- **ADR-0010 / 0036:** Per-PR service deploys are ensure-exists (changed,
  forced, missing/unhealthy, or stale), not path-only and not unconditional.
  Food's unauthenticated 401 passes the smoke; the ecosystem join owns
  food-before-recipe availability.
- **ADR-0032:** A deployed e2e suite tests the deployed ecosystem, not a
  locally booted stand-in; do not use local results as evidence of deployment.
  Follow the later local-vs-deployed tier ruling in `CLAUDE.md` section 7.1a.
- **ADR-0035 / 0022:** Each DB has a separate schema stack. Deploy schema,
  invoke its migration runner with the expected manifest digest, then deploy
  readers. No service-stack CDK migration trigger or migrate-before-runner
  deploy (which silently runs old SQL).
- **ADR-0039 / 0051:** Database owner, IAM migrator, and DML-only service
  roles are distinct; food seed has its own role. No service uses the master.
  Never put master on a membership chain to `rds_iam` (lockout).
- **ADR-0062:** Every custom metric includes `Stage`; alarm topics notify a
  single relay Lambda per base stage. Keep the relay outside the VPC, let it
  throw on failure, and preserve its imported function ARN.

### Contracts, authorization, and persistence

- **ADR-0009:** Web/mobile sign-out uses the shared verified command;
  `useClerk().signOut` can resolve while still queued. Do not clear cookies
  manually or drop the post-condition that the Clerk session ended.
- **ADR-0011:** `/api/{version}/*` is canonical; keep deprecated
  `/{version}/*` alias until external Clerk webhook configuration is migrated.
- **ADR-0014 / 0015:** Services own zod wire schemas in `src/**/*.schema.ts`;
  `packages/schemas/*` are generated copies and OpenAPI is derived output,
  never the source for types. Clients import and parse received wire shapes;
  third-party API clients validate their own external boundaries. Parse
  incoming HTTP/event/queue/webhook data once at ingress with service-owned
  zod and `nestjs-zod`'s `ZodValidationPipe`; signature proves origin, not
  shape. Validate bounded-column inputs; no request-derived `sql.raw()`.
  Server-side response validation is deferred, not a missing task.
- **ADR-0016:** Notification retention is ACK or 72h, whichever comes
  first. Pending dedup hashes RFC 8785 canonical payload; idempotency claims
  survive ACK. Duplicates return the original id without extending any TTL;
  unknown/other-user ACKs settle without leaking existence.
- **ADR-0017 / 0019:** Respect established service owners; do not create a
  new service merely to isolate a feature. The ingredient parser is the
  deliberate Python Lambda exception and owns no database.
- **ADR-0018:** Table names have one owner; Stripe delivery dedup uses
  `stripe_webhook_events`, not Clerk's `webhook_events`. Specs define each
  task ID only once. Do not fold distinct senders into one live dedup table.
- **ADR-0023:** Imported-public recipe provenance is a field-level policy,
  authorized by `recipes:import:public`, not a route guard; the cookbook
  corpus is operator-downloaded, never runtime-fetched from Gutenberg.
- **ADR-0024:** Bedrock's prod $100/month hard cap reserves worst-case spend
  atomically in recipe PostgreSQL before invocation and settles once using
  the reservation's UTC period. Budget alerts, concurrency limits, or
  post-call-only accounting are not a spending boundary; counter failure
  closes the gate. Do not add Gemini to a Bedrock-only roster.
- **ADR-0025:** Python ingredient-parser Lambda stays outside the VPC and
  ships its runtime assets (including the NLTK corpus); do not disguise it
  as a provider or attach it to the NAT merely for consistency.
- **ADR-0026:** CRF and LLM parse the original ingredient line independently;
  never give the LLM the CRF answer. A missing engine is not a disagreement;
  preserve stated-vs-restated quantities and the policy's detailed unit and
  packaging decisions before touching parser rules.
- **ADR-0027:** Ingredient phrases in specified resolution tables persist
  across user erasure under the owner's ruling. `user_id` counts distinct
  contributors and authorizes private corrections; do not reintroduce an
  erasure sweep without revisiting the privacy ruling.
- **ADR-0029:** User-authored foods are user-owned substances; USDA remains
  the catalog writer. A recipe is a method, never written back as a food or
  logged as a substance.
- **ADR-0030:** Analytics has one first-party event store with distinct
  ingestion doors and lifetime counts; inspect the ADR before changing event
  ownership, dedup, or retention.
- **ADR-0034 / ADR-0058:** First publication starts version history; a never-
  published draft updates in place, using `first_published_at`, not current
  `status` or a caller-provided skip flag. Once published, draft edits still
  version.
- **ADR-0047:** Browser-facing services share `resolveCorsPolicy` derived
  from the Clerk authorized parties. It assumes bearer-only ingress; do not
  add cookie/session auth or WebSocket upgrades to adopters, or reflect all
  origins when the party list is empty.
- **ADR-0056:** Native navigation uses React Navigation 7, per-tab stacks
  and the app tab bar. The back-intercept provider remains *outside* the
  navigation container so an open sheet consumes Back before a stack pop.
- **ADR-0057:** Device drafts and the single-writer outbox have fixed v1
  formats; unknown create outcome is parked, not blindly resent. Deletes
  alone are retry-safe after unknown outcome under the current 404 contract.
- **ADR-0059:** Settings are nullable typed columns in identity; NULL means
  never chosen. Defaults are resolved in code, GET does not write, and
  erasure removes settings. Do not use JSONB or local browser preferences.

## Feature status

`CLAUDE.md`'s managed Spec Kit section holds the current feature gates; read
it before working on a numbered feature. In particular, 019 Offline Mode has
an unresolved Clerk offline-auth opening decision (OQ-1): do not implement
that gate until the owner decides. 015 Publishing Rewards is planned but its
implementation is intentionally stopped on documented blockers. Avoid
copying volatile task lists or progress into this always-on file.
