# KitchenSink agent guide

This is the short entry point, not a second copy of the repository's design
history. **Before changing a subsystem, read its rules from disk**, including
sections too long for an injected context window. Prefer the latest explicit
owner ruling and current code over superseded historical descriptions.

## Read on demand

- [CLAUDE.md](CLAUDE.md): staff-engineering posture, design-pattern and UX
  gates, architecture and deliberate decisions, test-first mandate, current
  feature status. Start with the relevant section, then follow its references.
- [Engineering Excellence](docs/engineering/ENGINEERING_EXCELLENCE.md): read
  backend/frontend and design-pattern sections before production code; read
  test excellence before writing or reviewing any test.
- [Coding Standards](docs/CODING_STANDARDS.md): file names/imports and style
  (sections 1–4), test tiers and placement (section 7), component/JSDoc rules
  (sections 8 and 11), web/mobile parity (section 14), contracts and
  validation (section 15), and schema/task uniqueness (section 16).
- [Architecture decisions](docs/architecture/decisions/): read the affected
  ADR **before** proposing a change to an established boundary. `CLAUDE.md`
  indexes decisions that look wrong but are deliberate; later ADRs or owner
  rulings may supersede an earlier posture.
- [Cross-feature governance](specs/governance-rules.md): GR-015–GR-021 for
  service-owned contracts, input validation, new-package conformance,
  rejection paths, identifier integrity, principal binding, and table/task
  ownership. These apply even when no analogous package exists yet.

## How to work

- Challenge the spec and existing code; trace callers, failure modes,
  concurrency, authorization, operations, and rollback. Use the smallest
  _complete_ design. Prefer maintained libraries to hand-rolled mechanisms.
- Read the feature spec/plan first. Write acceptance-derived tests in **every
  required tier**, observe red, then implement and observe green. UI requires
  component tests for every state plus Playwright (web) and Maestro (mobile)
  for each story. Non-UI requires unit and integration; HTTP services also
  require e2e and k6. Integration tests mock DBs. A real-DB LOCAL e2e runs
  only on a developer machine via `npm run test:e2e`; deployed e2e targets
  a deployed environment and may skip when sandbox is down. Never report a
  skip or a local suite as evidence that a deployment works.
- For nontrivial work, do architecture planning, blueprinting, and a hostile
  review of the result. Design user-facing states before building, use the
  shared design system, localize copy, and translate the job rather than the
  desktop layout to mobile. Apply the `CLAUDE.md` design/UX/code-health
  gates where tools permit; if unavailable, do the analysis yourself and
  report the gap. Verify tests and the actual behavior before claiming done.
- Preserve others' changes. Do not weaken a test just to compile. Conventional
  commits use `<type>(<scope>): <description>`.

## Active Technologies

- Turborepo and npm workspaces under `packages/`; inspect each package's
  `package.json` for commands. Root: `npm run build`, `npm run test`,
  `npm run lint`, `npm run typecheck`, `npm run format`.
- Node 24 and TypeScript 6; Next.js 16 / React 19 / Tailwind v4 (web),
  Expo 57 / React Native 0.86 (mobile), NestJS 11 / Drizzle / PostgreSQL 18
  (services), AWS CDK v2 / ECS-Fargate / RDS / S3 / SQS (infrastructure).
  Lambda@Edge alone uses Node 22 because Node 24 is unavailable there.
- Clerk is the only auth vendor: `@clerk/nextjs`, `@clerk/expo`,
  `@clerk/backend`, `expo-secure-store`. ALB-facing services verify signed
  session tokens with `azp` enforcement; never trust caller-supplied auth
  headers. Service DTOs use `nestjs-zod`'s `ZodValidationPipe`, not Nest's
  `ValidationPipe`. AWS clients include `@aws-sdk/client-s3` and
  `@aws-sdk/client-sqs`.

## Conventions and high-risk boundaries

- Named exports except framework-required defaults; `import type` for types,
  `process.env['KEY']`, ISO strings in interfaces, `@sideEffect` for impure
  functions, no `any` or TS suppression, domain-oriented files, and no
  intra-package forwarding barrels. Follow the relevant package's import
  extension convention. An index access can be undefined at runtime even
  though `noUncheckedIndexedAccess` is off: do not remove an absence guard
  merely because lint considers it unnecessary.
- All user-facing features ship on web and mobile together. Mobile-specific
  files use `.native.ts(x)`, never `.mobile.*`; localize user-visible text.
- Service-owned zod lives in service `src/**/*.schema.ts`; generated copies
  live in `packages/schemas/*`. Clients import schemas/types and validate
  responses on receipt. Third-party clients validate their own upstream
  boundaries. Parse HTTP and non-HTTP ingress at the boundary using the
  service's own schema; a signature proves origin, not shape. Mutating
  bodies default to `z.strictObject()`; response validation on the _server_
  is deliberately deferred. New packages obey GR-017 from their first commit.
- For Clerk/svix or Stripe webhooks, a valid-signature **shape** rejection
  answers 200 to stop futile redelivery, while a **signature** failure answers
  401 to preserve the retry window. The reason maps to status via one typed
  rejection path; never store a rejected payload under a fabricated ID.
  Never use sentinel identifiers. Where transport and payload both assert a
  principal, require and compare both (GR-018–GR-020).
- Preview hosts are `pr-{N}.sandbox.commise.app` at `/`; the old path form
  404s by design. The anchored sandbox Clerk `azp` regex is the trust
  boundary. Sandbox starts only by hand; CI does not wake it. Teardown is
  scoped by the single delimiter-aware matcher; do not widen it or tag
  persistent resources as a PR. Read ADR-0033, ADR-0005, and ADR-0060.
- Infrastructure has **one shared ALB** per stage and a `t4g.nano` NAT
  instance for VPC Lambda egress; public Fargate egresses via IGW. Never
  casually replace prod's VPC/RDS, reverse the PostgreSQL 18 upgrade, add
  a managed NAT Gateway, or use paid interface endpoints to dodge the NAT.
  Read ADR-0002, ADR-0003, ADR-0004, and the PG18 runbook before changes.
- Deploy database schema stacks and invoke their migration runner with the
  expected SQL manifest **before** deploying readers; applied migrations
  are immutable and contraction follows an expand-first release. Keep DB
  owner/migrator/service roles separate; never put the master on a chain to
  `rds_iam`. See ADR-0035 and ADR-0039.
- A recipe is not a food; authored foods remain substances, not a recipe
  write-back. The ingredient parser's CRF and LLM legs are independent;
  never feed the CRF answer into the LLM prompt. See ADR-0029 and ADR-0026.
- Sign-out must verify that the Clerk session actually ended (ADR-0009).
  Device drafts and the outbox have distinct persistence and retry semantics
  (ADR-0057). The prod Bedrock spend ceiling reserves before invocation and
  settles once, not after-the-fact accounting (ADR-0024).

## Current feature gates

`CLAUDE.md`'s managed Spec Kit section is the live index. In particular,
019 Offline Mode has an unresolved Clerk offline-auth opening decision (OQ-1):
do not implement that gate until the owner decides. 015 Publishing Rewards
is intentionally stopped on documented blockers. Do not copy volatile
progress or task lists into this file.
