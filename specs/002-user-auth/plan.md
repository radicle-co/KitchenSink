# Implementation Plan: IdP User Authentication

**Branch**: `002-user-auth` | **Date**: 2026-05-13 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/002-user-auth/spec.md`
**Design reference**: [`docs/mockups/`](../../docs/mockups/) — HTML mockups + extracted design system (color, typography, spacing). Login/signup/MFA/session-expired/callback flows are rendered by **Clerk's hosted UI**; only app-rendered surfaces (profile, account, post-auth shell) have mockups under `docs/mockups/screens/`.

---

## Summary

This feature delivers IdP-based authentication and user lifecycle management for Commise web (Next.js) and mobile (Expo), with a locked split architecture:

- **Identity Service**: NestJS 11 on **AWS ECS/Fargate** (Node 24) exposing REST endpoints consumed by web/mobile
- **IdP Webhooks + Auth Pipeline**: raw **AWS Lambda** functions (Node 24.x, no NestJS) for:
    - identity.created webhook sync
    - async IdP deletion worker (SQS + DLQ)
    - nightly reconciliation
    - API Gateway REQUEST authorizer
- **Data storage**: **RDS PostgreSQL 16** (`db.t4g.micro`) using Drizzle ORM + `pg`
- **IaC**: unified CDK v2 (`aws-cdk-lib`) for all infrastructure — network/data/compute foundations, Lambda + API Gateway wiring (including REQUEST authorizer)

This preserves all functional scope in `spec.md` and `v-model/requirements.md`: signup sync, login/session, logout, profile, account edit, account deletion, password reset, social linking, suspension/reactivation, impersonation controls, and API authorization (REQ-001..REQ-050; FR-001..FR-044, excluding out-of-scope FR-035/FR-045).

---

## Technical Context

**Language/Version**:

- TypeScript 5.x
- Node.js 24.x (NestJS ECS service)
- Node.js 24.x (raw Lambda runtime)

**Primary Dependencies**:

- Web: `@clerk/nextjs` ^6.39
- Mobile: `@clerk/expo` ^2.4 (Expo 53+)
- Backend (webhooks): `@clerk/backend` ^1.27
- Backend service: NestJS 11, Drizzle ORM, `pg`, `class-validator`, `class-transformer`, `@nestjs/config`
- Lambda/auth: `jwks-rsa`, `jose`, `@aws-sdk/client-sqs`, `@aws-sdk/client-s3`, `@aws-sdk/client-scheduler`, `@aws-sdk/client-secrets-manager`, `@aws-lambda-powertools/logger`, `@sentry/aws-serverless`
- Infra: CDK v2 (`aws-cdk-lib`)

**Storage**:

- Primary: RDS PostgreSQL 16 (`db.t4g.micro`), `pg_trgm`, JSONB
- Async: SQS queue + DLQ for deletion retries
- Artifacts/media: S3 buckets (owned by CDK stacks)

**Project Layout (locked)**:

- `packages/services/identity/` (NestJS ECS service + `infra/` CDK subfolder)
- `packages/services/identity-webhooks/` (raw Lambda handlers: authorizer, identity.created webhook, deletion worker, reconciliation + `infra/` CDK subfolder)

**Package/Build Tooling**:

- npm workspaces + Turbo (already configured at root)

**Testing Strategy**:

- Unit/integration: Vitest
- End-to-end: Playwright (web/mobile flows) + API/e2e against LocalStack endpoints

---

## Service topology

```text
Web (Next.js) / Mobile (Expo)
            |
            v
  API Gateway (REST API)
            |
            v
REQUEST Authorizer Lambda (Node 24, JWKS + suspension)
            |
            v
          ALB
            |
            v
Identity Service (NestJS 11 on ECS Fargate, Node 24)
            |
            v
      RDS PostgreSQL 16

IdP (Universal Login + existing Actions/Triggers)
            |
            v
Post-registration Lambda (Node 24) ---> RDS PostgreSQL 16
            |
            +--> UPSERT users ON CONFLICT (sub) DO UPDATE (no app_metadata writeback)

Identity Service ---> SQS deletion queue ---> deletion-worker Lambda ---> IdP Backend API
                                  |
                                  v
                                 DLQ (max 5 receives)

EventBridge Scheduler ---> reconciliation Lambda ---> (IdP vs DB diff) ---> RDS repair writes
```

---

## IdP tenant strategy

IdP tenancy is locked to new KitchenSink-owned tenants:

- `kitchensink-dev`
- `kitchensink-staging`
- `kitchensink-prod`

Rules:

1. **Do not reuse KitchenSink tenants**.
2. **Reuse existing IdP Actions/Triggers from tenant-template** (identity.created webhook and related trigger chain already configured).
3. **Do not author new IdP Actions** in this feature unless the source-of-truth spec is amended.
4. Environment-specific IdP credentials/domains are injected through secrets/config in infra.

Requirements impacted: REQ-001, REQ-004, REQ-005, REQ-013..REQ-017, REQ-027..REQ-031, REQ-041..REQ-044.

---

## Architectural Decisions (locked)

| Decision                   | Choice                                                                                                                                                                                                                                     | Rationale                                                                                                | Traceability                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Identity API compute       | NestJS 11 on ECS/Fargate (Node 24)                                                                                                                                                                                                         | Keeps REST business logic in a long-lived service with clear module boundaries and predictable DB access | REQ-018..REQ-026, REQ-032..REQ-038        |
| IdP control-plane handlers | Raw Lambda (Node 24), no NestJS                                                                                                                                                                                                            | Small, isolated handlers for auth edge-cases and scheduled/async tasks                                   | REQ-013..REQ-017, REQ-039..REQ-044        |
| Authorizer model           | API Gateway REST + Lambda REQUEST authorizer                                                                                                                                                                                               | Needed for custom JWT claim validation, context injection, and suspension enforcement                    | REQ-039, REQ-040, REQ-042, FR-038..FR-043 |
| ECS trust boundary         | ECS service trusts `AuthorizerContext` headers only; never decodes client JWT                                                                                                                                                              | Prevents client-supplied claim spoofing; authorizer is the sole JWT verification point                   | REQ-039, REQ-040, decisions.md T9/T11     |
| Data store                 | RDS PostgreSQL 16 (`db.t4g.micro`) with Drizzle + `pg`                                                                                                                                                                                     | Explicit replacement of obsolete Aurora DSQL assumption; aligns with broader repo standards              | REQ-013..REQ-026                          |
| Shared schema contract     | Drizzle schemas owned by `packages/services/identity/src/database/schema/`; webhook Lambdas import schemas and types from `@kitchensink/identity-service` (or subpaths). Per refactor commits `2064357` / `6a9570c` / `ee1d4d1` (2026-06). | Single source-of-truth schema in the identity service; no separate shared types package exists           | REQ-013..REQ-026, T8 evidence             |
| Deletion resiliency        | SQS + exponential backoff + DLQ after 5 attempts                                                                                                                                                                                           | Guarantees eventual IdP delete and failure visibility under rate limits/transients                       | REQ-025, REQ-026                          |
| Reconciliation             | EventBridge Scheduler nightly Lambda diff                                                                                                                                                                                                  | Safety net when signup action path partially fails                                                       | REQ-017                                   |
| Infrastructure ownership   | 100% self-contained in this repo, CDK v2 only                                                                                                                                                                                              | Eliminates cross-repo ambiguity and external dependency drift                                            | REQ-050                                   |
| Local integration runtime  | LocalStack Community + sibling Postgres container                                                                                                                                                                                          | Enables queue/event/storage testing without paid emulators                                               | REQ-049                                   |

---

## Local development

Local integration test environment is locked to:

- **LocalStack Community**: SQS, S3, EventBridge/Scheduler emulation
- **PostgreSQL Docker container**: sibling service in same `docker-compose.yml` network
- **Identity Service (NestJS)**: runs locally via workspace dev target, connected to local Postgres
- **Lambdas**: invoked locally via CDK local tooling (`cdk-local`) against LocalStack endpoints

Planned local workflow:

1. `docker compose up` starts LocalStack + Postgres
2. Health checks verify LocalStack readiness and Postgres connectivity
3. Migrations/seed scripts initialize local DB state
4. `turbo run dev:local` starts identity service + local webhook/lambda workflow
5. E2E tests target local API Gateway/Lambda endpoints and local DB side effects

This is mandatory for REQ-049 (LocalStack-backed local testing) and supports REQ-013..REQ-017 and REQ-025..REQ-026 verification.

---

## Package-level responsibilities

### `packages/services/identity/src/types`

- **Types-only** boundary (no database dependencies, no Drizzle schemas, no DAOs)
- Owned by the identity service; **service-internal** TypeScript types consumed by the service and its lambdas
- JWT claims, authorizer context, admin actions
- ⚠️ **Amended 2026-08-11 (GR-015):** this entry previously read "consumed by service, lambdas, and
  **clients**", exported as `@kitchensink/identity-service/types`. **Consumers no longer import from here** —
  they import `@kitchensink/schema-identity`. A consumer dependency on the service package is rejected by
  ADR-0014 (it drags NestJS/Drizzle/aws-sdk into web and mobile). User/account/profile wire DTOs move to the
  schema package; the inbound Clerk webhook payload is a **third-party** shape validated at the boundary, not
  a contract we own. See _API Contracts — ownership and drift (GR-015)_ below.
- Traceability: REQ-001..REQ-012, REQ-039..REQ-044, NFR-001, NFR-010

### `packages/services/identity/infra`

- CDK app: NetworkStack, DataStack, IdentityServiceStack, observability/secrets wiring; Lambda functions + API Gateway REST routes + REQUEST authorizer wiring
- No Terraform/Pulumi/SAM/raw CloudFormation templates
- Traceability: REQ-049, REQ-050, REQ-039..REQ-044

### `packages/services/identity-webhooks/`

- `authorizer` Lambda: JWT validation, claim extraction, suspension check, context injection
- `identity.created webhook` Lambda: idempotent UPSERT user/account/profile keyed by `sub` (no `app_metadata.userId` writeback)
- `deletion-worker` Lambda: retries IdP delete via SQS receive count/backoff and DLQ threshold
- `reconciliation` Lambda: periodic IdP-vs-DB diff and repair
- Traceability: REQ-013..REQ-017, REQ-025..REQ-026, REQ-039..REQ-044

### `packages/services/identity/`

- NestJS modules: `AuthModule`, `UsersModule`, `AccountsModule`, `ProfileModule`, `AdminModule`
- REST endpoints for profile/account/admin lifecycle
- Produces deletion jobs to SQS; consumes authorizer-injected identity context
- Traceability: REQ-018..REQ-038, FR-018..FR-037

---

## API Contracts — ownership and drift (GR-015)

**Normative sources**: [`docs/CODING_STANDARDS.md` §15](../../docs/CODING_STANDARDS.md) ·
[`GR-015`](../governance-rules.md#gr-015-api-contract-ownership) ·
[ADR-0014](../../docs/architecture/decisions/0014-service-owned-api-contracts.md). This section states only
the **bindings for this feature**; the rule lives there and wins on any detail.

| Role                                  | Binding for 002                                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Owning service (**authors** the zod)  | `@kitchensink/identity-service` — `packages/services/identity/src/**/*.schema.ts`, beside its controller            |
| Also in scope                         | `@kitchensink/identity-webhooks` — the `POST /api/v1/webhooks/users` **inbound Clerk** shape is third-party (below) |
| Schema package (generated, committed) | `@kitchensink/schema-identity` — `packages/schemas/identity` — **does not exist yet; being converged now**          |
| Consuming app / feature packages      | `@commise/features-account` (`ProfileServiceClient`), consumed by `@commise/web` and `@commise/mobile`              |
| Domain types (a **different** axis)   | `@kitchensink/identity-core` — reused `import type`, never re-declared in the schema package (GR-007)               |

### The service's obligation

- Every request/response shape of `/api/v1/users/*`, `/api/v1/profile/*`, `/api/v1/accounts/*`,
  `/api/v1/admin/*` and `/api/v1/groups/*` (the group model added under 014) is authored as **zod in the
  identity service** at `src/**/*.schema.ts`, next to its controller.
- The service **validates its own requests with that same zod** via `nestjs-zod`'s `createZodDto`.
- `packages/schemas/identity` is **generated and committed** from those sources — `schemas.ts`, `types.ts`,
  `contract-hash.ts`, barrel, plus a **derived** `openapi.yaml`. Nothing in it is hand-edited.
- A `*.schema.ts` imports **only `zod` and other `*.schema.ts` files** — no Drizzle schema, no DAO type, no
  Nest symbol.

⚠️ **`packages/services/identity/src/types` is NOT the contract package and must not become one.** This plan
previously described it as the "canonical TypeScript types consumed by service, lambdas, and **clients**",
exported as `@kitchensink/identity-service/types`. That arrangement is **rejected** by ADR-0014
(alternative 2): a consumer reaching into the service package drags NestJS, Drizzle and the AWS SDK into web
and mobile, inverts the build order, and gives a client a legitimate-looking path to a DAO type. Consumers
import `@kitchensink/schema-identity`. The service's `src/types` keeps only service-internal types.

### The CLIENT's obligation — separately mandatory

002 has **no `packages/clients/identity` package**. Its consumer today is `ProfileServiceClient` in
`@commise/features-account`, which means the wire shapes land in an **app-feature** package. GR-015 §15-b.4
binds that identically — the rule is about who authors a wire shape, not which directory it sits in:

- The consumer imports its wire **types and zod** from `@kitchensink/schema-identity`.
- It **declares no request or response body type of the identity service.** Anything left in its own
  `types.ts` is genuinely client-side: base URL and fetch config, `TokenSource`, request options, its own
  error shapes. `DeleteAccountResult` and any profile/account response shape are **wire** shapes and belong
  to the schema package.
- A divergent consumer shape (a settings form model, a redacted profile view) is **DERIVED** with
  `Pick` / `Omit` / `Partial` over the wire type — never independently declared. Reference:
  `packages/apps/commise/features/recipes/src/filters/model.ts`.
- **A new identity endpoint is not complete until its types are reachable from the schema package.**

🟠 **OPEN — where does the identity consumer live?** GR-015 assumes a `packages/clients/<service>` leaf, and
002 does not have one. Two shapes satisfy 15-b: (a) introduce `packages/clients/identity` and have
`@commise/features-account` wrap it, or (b) have `@commise/features-account` import
`@kitchensink/schema-identity` directly and remain the only consumer. **Question for the owner: (a) or (b)?**
Neither §15 nor an existing ADR decides it, and it is not derivable — so it is not decided here.

### Drift gates — inherited from GR-015 §15-c

All three required: turbo `inputs`-driven rebuild of `schema-identity` from the service's `*.schema.ts`; a
**regenerate-and-diff CI gate**; and a `CONTRACT_HASH` **boot assertion**. The boot assertion matters most
here: identity is the one service every already-shipped mobile binary must keep talking to.

### ⚠️ Clerk is a THIRD-PARTY API — the opposite case, do NOT converge it (GR-015 §15-d)

**Clerk is not one of our services.** We do not serve its API, we cannot author its types, and its contract
can change without telling us. So everything on the Clerk boundary is governed by §15-d, not §15-b:

- **Session-token claims** verified in `packages/shared/clerk-verify` / `ClerkAuthService`, the `azp` guard,
  and `public_metadata` scope/permission extraction: validate the **raw upstream shape at the boundary** and
  MAY declare their own types.
- **The inbound Clerk webhook payload** at `POST /api/v1/webhooks/users` (`user.created` / `user.updated` /
  `user.deleted`, `svix`-verified) is **Clerk's** shape, not ours. It is validated at the boundary and is
  **not** put in `@kitchensink/schema-identity` as though we owned it. The webhook's own _response_ is ours.
- **No OpenAPI document is written for Clerk's API.**
- Deleting or "converging" a Clerk boundary schema under §15-b replaces a checked parse of an unauthenticated
  external body with unchecked trust. That is a **security regression** on this feature's most exposed
  surface. See `packages/clients/usda` for the reference pattern.

### Status — IN PROGRESS

- 🔄 **Identity is being converged now.** `packages/schemas/identity` does not exist yet, and no
  `openapi.yaml` exists for any service in this repo.
- ⚠️ [`contracts/identity-api.openapi.json`](./contracts/identity-api.openapi.json) and the hand-written TS
  contract files in [`contracts/`](./contracts/) (`user.ts`, `auth-session.ts`, `authorizer.ts`,
  `deletion.ts`, `errors.ts`, `post-reg.ts`, `reconciliation.ts`) are **hand-maintained and verified by
  nothing**. Per §15.2(6) they are **superseded in principle** by the generated document, but the generated
  document does not exist yet, so they are retained as the only record. Where they disagree with the
  service's `*.schema.ts`, **the service's zod wins.** Do not extend them with new surface.

---

## Input validation — where the authored zod RUNS (GR-016)

**Normative sources**: [`docs/CODING_STANDARDS.md` §15.4](../../docs/CODING_STANDARDS.md) ·
[`GR-016`](../governance-rules.md#gr-016-input-validation-at-every-boundary) ·
[ADR-0015](../../docs/architecture/decisions/0015-input-validation-at-every-boundary.md). GR-015 decides
**who authors** the zod; GR-016 decides **where it runs**. Bindings for this feature only.

**002 holds the case that proves why this rule exists** — a route that looks validated and validates nothing.

- **⛔ `createZodDto` requires `nestjs-zod`'s `ZodValidationPipe`, and identity already got this wrong.**
  Under Nest's **own** built-in `ValidationPipe` a `createZodDto` DTO **validates nothing while every visible
  signal says it does**. That happened on **`PATCH /users/me`** — a route that **writes user data**. The
  identity service registers `nestjs-zod`'s pipe, and because the failure is invisible in review, the proof is
  a test that posts a **known-bad body to the real route** and asserts the `400`. Write it for `PATCH
/users/me` first.
- **One mechanism, one `400`.** Measured 2026-08-11: identity has **3** `ZodValidationPipe` / **4**
  `createZodDto` — the smallest surface in the portfolio, and the one where converging on a single mechanism
  is cheapest. Every `/api/v1/users/*`, `/api/v1/profile/*`, `/api/v1/accounts/*`, `/api/v1/admin/*` and
  `/api/v1/groups/*` input — body, path params, query params, and any header a handler reads — goes through
  it. No second DTO framework, no per-method `safeParse`.
- **⚠️ WEBHOOKS: the svix signature proves ORIGIN, not SHAPE — and this is 002's highest-exposure surface.**
  `POST /api/v1/webhooks/users` (`packages/services/identity-webhooks/src/handlers/identityWebhook.ts`)
  verifies the `svix` signature, and that verification is **required and stays**. But a correctly signed Clerk
  payload whose fields moved, went null, or gained a member is still an **unvalidated body being written to
  the identity database**. So: **verify the signature, then validate the schema** — both, in that order,
  never one instead of the other. The inbound Clerk shape is validated under GR-015 §15-d (it is Clerk's
  shape, not ours, and does not enter `@kitchensink/schema-identity`); GR-016 is what makes that parse
  **mandatory rather than a good idea**.
- **The other Lambda ingress points are in scope too**, because a pipe reaches none of them:
  `deletion-worker.ts` (SQS retry payload), `reconciliation.ts` / `erasure-reconciliation.ts`,
  `tombstone-sweep.ts`, `log-forwarder.ts`, `migrate.ts`. Each parses its event against an authored zod before
  acting on it. A scheduled invocation's payload is "ours" only until a deploy drifts.
- **Service-to-service, outbound: identity is the CALLER on the erasure fan-out.**
  `packages/services/identity-webhooks/src/common/erasure-fanout.ts` posts
  `POST /api/v1/internal/account/erasure` to **recipe and food**. The outbound body is validated against the
  callee's schema-package zod **before the call**, and each response is **validated on receipt** — a
  fan-out that silently mis-reads a partial failure is how an erasure is reported complete when it is not.
- **The floor.** Every profile/account field writing a bounded column — display name, handle, locale,
  status/role enums, nullability — is validated at least as strictly as that column can store. **Asserted,
  never derived**: no zod generated from drizzle, and no Drizzle/DAO type imported into a `*.schema.ts` (the
  constraint this plan already states above is unchanged by GR-016).
- **Unknown keys are a stated choice per surface** (`z.object` strips silently, `z.strictObject` rejects). On
  a profile update, silently dropping a misspelled field returns `200` for a write that did not happen.
  Portfolio default is **OPEN** (GR-016 OPEN-GR-016-B).
- **⛔ Response validation is DEFERRED (GR-016 §16-g).** Identity validates no responses, deliberately. Do not
  add it.

---

## Security and reliability notes

- JWT verification via JWKS with in-process cache; enforce `iss`, `aud`, signature, expiration (REQ-039)
- Authorizer denies suspended users with `403` and injects `sub` context (REQ-040, REQ-042)
- Logout/revocation and secure token storage remain platform-specific per spec (REQ-006..REQ-012)
- Async deletion path must not block DB deletion completion; failed IdP deletions surface to DLQ/alarms (REQ-025, REQ-026)
- Reconciliation produces deterministic repair actions and audit logs (REQ-017, NFR-012..NFR-017)

---

## Specification Additions and Clarifications (post-creation)

The following were added to `spec.md` after the initial 2026-04-14 creation, via iterative `/speckit.clarify` and `/speckit.analyze` rounds. They are fully incorporated into `tasks.md` and must be respected during implementation.

### Webhook Payload Validation (FR-016a)

All webhook handlers MUST validate incoming payloads against a Zod schema at the entry point, before any business logic or database operations. Invalid payloads receive `400 Bad Request` (not 500), with sanitized logging and a CloudWatch metric for validation failures. This protects against IdP contract drift.

**Traceability**: FR-016a, T-072 (Zod schema definition), T-021/T-022/T-023 (handler entry points).

### Webhook Upsert Semantics (FR-017a)

`user.updated` (identity.updated) webhooks use upsert semantics: if the user exists, update; if not, create. `user.deleted` (identity.deleted) is idempotent no-op if the user is already soft-deleted. This ensures safe replay and out-of-order delivery.

**Traceability**: FR-017a, T-021 (webhook handler), T-023 (reconciliation).

### Performance Targets (NFR-011a)

Commise-controlled auth operations MUST meet:

- Silent token refresh endpoint ≤ 500ms P99
- Profile data endpoint ≤ 1s P99
- Webhook processing (API Gateway receipt → DB write) ≤ 2s P99

These targets apply only to Commise-controlled operations; IdP-hosted login page load times are out of scope.

**Traceability**: NFR-011a, T-083 (CI performance gates), T-087 (retry strategy).

### Capacity and Autoscaling Guidelines

**Day-one** (100 DAU, peak 10 req/s, 1 webhook/s):

- Single `db.t4g.micro` RDS
- 256MB Lambda
- 1 ECS task (`t4g.micro`)
- Monthly cost target ≤ $75

**Day-30** (500 DAU, peak 50 req/s, 5 webhooks/s): Trigger autoscaling at avg CPU > 70% for 10 min.

**Day-90** (1,500 DAU, peak 200 req/s, 20 webhooks/s):

- ECS → `t4g.medium`
- RDS → `db.t4g.small`
- Lambda → 512MB

All changes applied via CDK diff, never manual Console changes. Database migrations during low-traffic windows only.

**Traceability**: Spec Q15 (Round 4 clarification), T-013/T-014 (infra stacks).

### Data Retention Policy

- User PII (email, name, avatar URL): retained for lifetime of account + 30-day grace period after hard deletion
- After 30 days: permanently deleted
- Webhook event logs: retained 90 days then purged
- Identity IDs (`identity_id`): permanently retained (anonymized) for referential integrity

**Traceability**: Spec Q16 (Round 4 clarification), FR-022..FR-026 (deletion), NFR-012..NFR-013 (observability).

### Session Expiry UX

When session approaches expiry (5 minutes remaining):

1. Show warning banner with countdown
2. Save active form drafts to `localStorage`
3. On re-login after expiry, auto-restore drafts from `localStorage`
4. Clear `localStorage` drafts on successful re-auth

**Traceability**: NFR-016 (Round 3 clarification), T-051/T-052 (session management tasks).

---

## Requirement coverage map (high-level)

- **Auth flows + sessions**: REQ-001..REQ-012 (FR-001..FR-012)
- **Signup sync + reconciliation**: REQ-013..REQ-017 (FR-013..FR-017)
- **User/account/profile lifecycle**: REQ-018..REQ-026 (FR-018..FR-026)
- **Password/social**: REQ-027..REQ-034 (FR-027..FR-034)
- **Impersonation + authorization + suspension**: REQ-035..REQ-044 (FR-036..FR-044)
- **Cross-feature and infra constraints**: REQ-045..REQ-050 (NFR-001..NFR-017, NFR-011a)
- **Out of scope**: FR-045 (subscription tier from 001), FR-035 (MFA deprecated per Q4 Round 2)

---

## Constraints and non-goals

- No new IdP Actions authored in this feature (reuse existing tenant-template Actions/Triggers)
- No Aurora DSQL references or implementation
- No Terraform/Pulumi/SAM adoption
- No external IaC repository dependencies
- No changes to source-of-truth requirements documents in this rewrite
- No admin dashboard UI (suspension/reactivation/impersonation are backend/API operations only)
- No MFA enrollment (out of scope per spec.md Q4 Round 2 clarification)

## Implementation Drift (Auth0 → Clerk migration status)

The feature was originally specified against Auth0 and migrated to Clerk mid-implementation. This section records the migration state as of branch rename to `002-user-auth`.

### Doc layer — fully migrated

- All 11 substantive docs under `specs/002-user-auth/` (`spec.md`, `plan.md`, `data-model.md`, `quickstart.md`, `tasks.md`, full `v-model/`, `checklists/`, `product-spec/`, `contracts/`) reference Clerk only.
- `research.md` and `findings.md` retain a single Auth0 mention each as explicit migration history — preserved intentionally.

### Production code — fully migrated

- Zero `@auth0/*` or `react-native-auth0` npm dependencies remain.
- Installed Clerk SDKs: `@clerk/nextjs ^6.39` (web), `@clerk/expo ^2.4` (mobile), `@clerk/backend ^1.27` (webhooks).
- Web app routes/middleware/components use Clerk (`ClerkProvider`, `clerkMiddleware`, `auth()`, `currentUser()`, `<SignIn>`, `<SignUp>`, `<UserButton>`).
- Mobile app uses `@clerk/expo` with `expo-secure-store` token cache.
- Webhooks verify Svix-signed Clerk events (`user.created`, `user.updated`, `user.deleted`) via `@clerk/backend`.
- Identity service domain model renamed `auth0Id` → `clerkId` (commit `13808a8`).
- Stale Auth0 env vars removed (commit `3ab8212`).
- Infra stack tests assert absence of any `auth0` string in synthesized templates (anti-drift sentinels).

### Remaining drift (none)

The two stub e2e tests that previously held Auth0-shaped fixtures
(`deletion-worker-e2e.test.ts`, `local-api-e2e.test.ts` under
`packages/services/identity/tests/e2e/`) were removed during the Clerk
migration. Proper e2e coverage now lives in
`packages/services/identity-webhooks/tests/e2e/auth/` (12 tests across
`api.e2e.test.ts` and `deletion.e2e.test.ts`) and runs via `npm run test:e2e`.

### Naming history

- Branch `002-auth0-user-auth` was renamed to `002-user-auth` during this migration.
- Worktree directory moved from `.worktrees/002-auth0-user-auth/` to `.worktrees/002-user-auth/`.
- Spec directory `specs/002-auth0-user-auth/` was renamed to `specs/002-user-auth/` on the feature branch (commit `dba0863`); the old path may still exist on `main` until merge.

---

## Requirement Traceability Addendum (sync-verify Group D, 2026-06-02)

Added in response to sync-verify Run #1 Layer-3 findings (DRIFT-002..DRIFT-024). Maps each Functional Requirement in `spec.md` to its primary plan-level home. Where an FR is satisfied by an existing decision row, package responsibility, or specification addition above, the row identifies it. FRs whose implementation work is fully described in `tasks.md` (and not separately discussed in plan.md) cite the relevant task IDs as their plan-level locus.

| FR             | One-line scope                                                                  | Primary plan locus                                                                                            |
| -------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| FR-001         | PKCE auth (Authorization Code Flow) on web + mobile                             | `Architectural Decisions` → `IdP control-plane handlers`, `Authorizer model`; tasks T-050/T-060               |
| FR-002         | Mobile auto-display of auth screen when unauthenticated                         | Package `packages/apps/commise/mobile/`; tasks T-060                                                          |
| FR-003         | Web redirect of unauthenticated users to IdP login                              | Package `packages/apps/commise/web/` middleware; tasks T-050                                                  |
| FR-004         | Social IdP providers (Google at minimum)                                        | `IdP tenant strategy`; configuration owned by Clerk dashboard, tasks T-080                                    |
| FR-005         | OAuth callback handling on both platforms                                       | Decision `Authorizer model`; tasks T-050/T-060                                                                |
| FR-006         | Secure token storage: Keychain/Keystore (mobile) + httpOnly cookies (web)       | Section `Security and reliability notes`; tasks T-051/T-061                                                   |
| FR-007         | Silent token refresh on 401, auto-retry of failed request                       | Tasks T-051/T-061; tested in `v-model/integration-test.md`                                                    |
| FR-008         | Session-expiry warning banner + draft preservation                              | Tasks T-051 (web); MFA UI considerations out of scope per OOS                                                 |
| FR-009         | Attach Bearer token on all API requests                                         | Decision `Authorizer model`; tasks T-051/T-061                                                                |
| FR-010..FR-012 | Logout: clear local tokens, sign out IdP, return to auth screen                 | Tasks T-052/T-062                                                                                             |
| FR-013..FR-017 | `user.created` webhook → User/Account/Profile (atomic) + ULID + reconciliation  | Decision `Shared schema contract`; package `packages/services/identity-webhooks/`; tasks T-021/T-023          |
| FR-016a        | Zod schema validation at webhook entry (sanitized logging + CloudWatch metric)  | Section `Specification Additions and Clarifications (post-creation)`; tasks T-072                             |
| FR-017a        | Nightly reconciliation diffing IdP users vs DB users                            | Decision `Reconciliation`; tasks T-023                                                                        |
| FR-018..FR-021 | Profile visibility + account-edit flow                                          | Package `packages/apps/commise/web/` + `/mobile/`; tasks T-053/T-084                                          |
| FR-022..FR-026 | Account deletion: confirmation, DB+IdP delete, anonymization, post-delete state | Decision `Deletion resiliency`; package `packages/services/identity-webhooks/` (deletion worker); tasks T-022 |
| FR-027..FR-028 | Password reset via IdP-hosted flow (no app-side password handling)              | Decision `Authorizer model` (IdP-managed); no app task — provided by Clerk hosted UI                          |

**Out-of-scope FRs**: FR-029..FR-031 (MFA enrollment — see spec.md §Out of Scope). FR-032..FR-037 (social linking, operator impersonation) deferred to P2 — tracked in tasks.md US-009, US-012 but not exercised in v1 plan.
