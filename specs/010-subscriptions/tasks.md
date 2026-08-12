# Tasks: Feature 010 — Subscriptions & Monetization

**Feature**: `010-subscriptions`  
**Source**: [spec.md](spec.md), [plan.md](plan.md), [product-spec](product-spec/product-spec.md)  
**Constraints**: all `- [ ]`, paths under `packages/`, no phantom T-NNN, trace to spec.md.

---

## US Reference

| US     | Title                                     | Priority | FRs            |
| ------ | ----------------------------------------- | -------- | -------------- |
| US-001 | Free and Premium Subscription Tiers       | P3       | FR-040, FR-041 |
| US-002 | Checkout & Billing Management             | P3       | FR-041         |
| US-003 | Subscription Lifecycle & Webhook Handling | P3       | FR-043         |
| US-004 | Upgrade Prompts & Frontend Integration    | P3       | FR-042         |
| US-005 | Data Retention on Subscription Lapse      | P3       | FR-043         |

---

## Dependency Graph (only tasks written below)

```
T-001 ─┬─→ T-002 ─┬─→ T-004 ──→ T-005 ──→ T-006 ──→ T-007
       │          │            │
       │          │            └────────────────────────────┐
       │          │                                         │
       ├─→ T-003 ─┴─→ T-008 ─┬─→ T-009 ──→ T-010 ──→ T-012
       │                     │                  │            │
       │                     │                  │            ├─→ T-013
       │                     │                  │            │
       │                     │                  └─→ T-011 ──────┤
       │                     │                                │
       │                     └─→ T-014 ──→ T-015 ─┬─→ T-016 ──┤
       │                                          ├─→ T-017 ──┤
       │                                          ├─→ T-018 ──┤
       │                                          ├─→ T-019 ──┤
       │                                          │            │
       │                                          └────────────┴─→ T-020
       │
       └────────────────────────────────────────────────────────────┐
                                                                    │
T-005 ──→ T-021 ─┬─→ T-022 ──→ T-025                               │
                 │                                                  │
                 ├─→ T-023                                          │
                 │                                                  │
                 └─→ T-024 ──→ T-028                               │
                                                                    │
T-018 ──→ T-026 ──→ T-027

# Contract ownership, validation & the client half
T-008 ──→ T-029 ─┬─→ T-030 ◄── T-012
                 ├─→ T-031 ◄── T-002, T-003
                 └─→ T-033 ◄── T-021, T-024
T-029 ──→ T-014 ─┬─→ T-015
                 ├─→ T-032
                 └─→ T-034 ◄── T-030
```

⛔ **T-029 gates T-014.** The webhook's **own response** shape is ours and is authored in T-029; the inbound
Stripe body is the §15-d opposite case and is authored in T-032. Both exist before the handler branches on
either.

---

## User Story 1 — Free and Premium Subscription Tiers (P3)

> Gate premium features; free tier delivers full core value. Implements FR-040, FR-041.

- [ ] **T-001** [P0] [US-001] Add `stripe` dependency and env schema vars to `@kitchensink/identity-service`  
       — `packages/services/identity/package.json`, `packages/services/identity/src/config/`  
       **Depends on**: —  
       **Implements**: FR-040, FR-041 (billing stack foundation per plan.md §2)  
       **Acceptance**: `npm run build` passes in identity service; env schema validates `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID_MONTHLY`, `STRIPE_PRICE_ID_ANNUAL`.

- [ ] **T-002** [P0] [US-001] Extend `accounts` Drizzle schema with subscription state columns  
       — `packages/services/identity/src/database/schema/accounts.ts`, `packages/services/identity/src/database/dao/account.dao.ts`  
       **Depends on**: T-001  
       **Implements**: FR-040, FR-041 (plan.md §2 Account Entity Additions)  
       **Acceptance**: Migration runs cleanly; `AccountDAO` exposes `updateSubscriptionState(userId, …)`; existing accounts default to `subscriptionTier='free'`, `subscriptionStatus='inactive'`.

- [ ] **T-003** [P0] [US-001] Create the `stripe_webhook_events` idempotency table — resolving the name collision first  
       — `packages/shared/identity-db/src/schema/stripeWebhookEvents.ts`  
       **Depends on**: T-001  
       **Implements**: FR-041 (idempotency per plan.md §2), GR-019  
       **⚠️ Path repointed.** The table is read and written by **`@kitchensink/identity-webhooks`** (T-014, T-015) as well as the API, so it belongs in the shared **`@kitchensink/identity-db`** package where `webhookEvents` and `accounts` already live — not in `packages/services/identity/src/database/schema/`, which the webhooks deployable does not import. Note the file-naming regime: `packages/shared/*` is camelCase (§1b), not the services' kebab `name.type.ts`.  
       **⛔ Resolve the collision with the SHIPPED `webhook_events` table before writing the migration.** `plan.md` §2's DDL and the existing `packages/shared/identity-db/src/schema/webhookEvents.ts` describe **different tables under the same name** — the shipped one is keyed `svix_id text PRIMARY KEY` with `identity_id text NOT NULL`, and has no `stripe_event_id`, `status`, `error` or `processed_at`. This task takes the **distinctly named** option (`stripe_webhook_events`), so Clerk's svix dedup and Stripe's remain independent and neither migration can break the other. If the owner prefers extending the shipped table instead, that is a data-model decision and T-015 changes with it.  
       **Acceptance**: Schema file exists as **Drizzle** (⚠️ `plan.md` §2 sketches these columns with **TypeORM-style `@Column()` decorators**, which is inconsistent with the whole portfolio **and with the very table it extends** — this task uses Drizzle; the inconsistency is flagged for the owner, not silently resolved). Migration runs cleanly; duplicate `stripeEventId` rejected by a PK/unique constraint. Bounded columns get **declared lengths** so a floor exists to assert against (T-031): `stripe_event_id varchar(255)`, `event_type varchar(100)`, `status varchar(20)`.  
       **⚠️ `varchar(20)` on `status` has almost no margin** — `'processing'` is already 10 characters, so a future status string over 20 chars is a failed `INSERT` **on the money path**. The zod enum (T-029) is what holds that line, and T-031 is what proves it.  
       **Tests**: unit (schema shape and constraint declarations) **AND** integration (migration applies against real Postgres; a duplicate insert is rejected by the constraint rather than by application code).

- [ ] **T-004** [P0] [US-001] Implement `@RequirePremium()` decorator  
       — `packages/services/identity/src/billing/decorators/require-premium.decorator.ts`  
       **Depends on**: T-002  
       **Implements**: FR-041 (feature gating per plan.md §4)  
       **Acceptance**: Decorator compiles; metadata key `PLAN_REQUIRED='premium'` readable via `Reflector`.

- [ ] **T-005** [P0] [US-001] Implement `PlanGuard` with grace-period logic  
       — `packages/services/identity/src/billing/guards/plan.guard.ts`  
       **Depends on**: T-004  
       **Implements**: FR-041, FR-043 (grace period per product-spec D-3)  
       **Acceptance**: Free user denied with `403 PREMIUM_REQUIRED`; premium/trialing allowed; `past_due` within 7-day grace allowed; `past_due` beyond grace denied.

- [ ] **T-006** [P1] [US-001] Apply `@RequirePremium()` to all gated downstream endpoints  
       — `packages/services/recipe-service/src/…` (001's gated routes, plus 006 meal plans / 007 grocery lists / 009 nutrition plans, all of which land in this service per ADR-0017), and each further owning service as it is built  
       **Depends on**: T-005  
       **Implements**: FR-041 (Feature Gating Map per plan.md §4), FR-044  
       **⚠️ Three paths in this task did not exist and were removed.** `packages/services/recipe/src/…` is really **`packages/services/recipe-service/`**; `packages/services/ai/src/…` and `packages/services/meal-plan/src/…` **do not exist at all** — meal planning is **not** a service ([ADR-0017](../../docs/architecture/decisions/0017-service-ownership-for-features-006-007-009-010.md) puts 006 in `@kitchensink/recipe-service`), and 005's `ai-service` is unbuilt and unratified (ADR-0017 explicitly declines to decide it). Do not scaffold a service to satisfy this task.  
       **⛔ The guard is a SHARED package reading a signed CLAIM — it is NOT an import of the identity service.** Per ADR-0017 decision 3 and `plan.md` L162-175: every gated route lives in some _other_ service, so `@RequirePremium()` / `PlanGuard` sit under `packages/shared/*` and read the entitlement from the **verified Clerk session token** (FR-044, the mechanism `packages/shared/clerk-verify` already implements for admin `scopes`/`permissions`). Importing `@kitchensink/identity-service` to gate a route drags NestJS, Drizzle and the AWS SDK into every consumer, inverts the build order, and is already forbidden by `packages/infra/global/__tests__/app-service-dependency.test.ts`.  
       **Acceptance**: Each gated endpoint returns `403 PREMIUM_REQUIRED` for free-tier users; premium and `trialing` pass through. **Every consumer fails CLOSED** — an absent, unreadable or unparsed claim is `free`, **never** premium. ⚠️ The entitlement enum is **parsed before it is branched on**: a `status` string that never met its enum can **fail open and grant premium with `typecheck` green**, which is the paywall failing silently in production.  
       **Tests**: unit (free/premium/trialing/past-due-in-grace/past-due-beyond-grace; absent claim ⇒ `free`; malformed claim ⇒ `free` **and** a recorded rejection, never a pass-through) **AND** integration (a real gated route on a booted service returns `403` for a free token and `200` for a premium one).

- [ ] **T-007** [P1] [US-001] Unit tests for `PlanGuard` and `@RequirePremium()`  
       — `packages/services/identity/src/billing/guards/__tests__/plan.guard.test.ts`  
       **Depends on**: T-005, T-006  
       **Implements**: FR-041, NFR-001  
       **Acceptance**: All tests pass; coverage ≥ 90% on guard file.

---

## User Story 2 — Checkout & Billing Management (P3)

> Users can subscribe via Stripe Checkout and manage via Customer Portal. Implements FR-041.

- [ ] **T-008** [P0] [US-002] Scaffold `BillingModule` in identity service  
       — `packages/services/identity/src/billing/billing.module.ts`  
       **Depends on**: T-001  
       **Implements**: FR-041 (plan.md §5 Module Structure)  
       **Acceptance**: App bootstraps without error; `BillingModule` visible in module graph; exports `BillingService`.

- [ ] **T-009** [P0] [US-002] Implement `BillingService.createCheckoutSession`  
       — `packages/services/identity/src/billing/billing.service.ts`  
       **Depends on**: T-008, T-002  
       **Implements**: FR-041 (Stripe Checkout per plan.md §3; 14-day trial per product-spec D-1)  
       **Acceptance**: Integration test (Stripe test mode) creates session and returns checkout URL; new Stripe Customer created and stored on first call.

- [ ] **T-010** [P1] [US-002] Implement `BillingService.createPortalSession`  
       — `packages/services/identity/src/billing/billing.service.ts`  
       **Depends on**: T-009  
       **Implements**: FR-041 (Stripe Customer Portal per plan.md §3)  
       **Acceptance**: Returns portal URL for users with `stripeCustomerId`; throws `BadRequestException` if missing.

- [ ] **T-011** [P1] [US-002] Implement `BillingService.getSubscriptionStatus`  
       — `packages/services/identity/src/billing/billing.service.ts`  
       **Depends on**: T-002  
       **Implements**: FR-041 (plan.md §3 API Contracts)  
       **Acceptance**: Returns correct DTO from DB (no Stripe API call); free users return `plan='free'`, `status='inactive'`.

- [ ] **T-012** [P1] [US-002] Implement `BillingController` with checkout / portal / subscription endpoints  
       — `packages/services/identity/src/billing/billing.controller.ts`  
       **Depends on**: T-009, T-010, T-011  
       **Implements**: FR-041 (plan.md §3 Billing Endpoints)  
       **Acceptance**: E2E tests confirm `401` without JWT, correct `200` responses with valid token.

- [ ] **T-013** [P1] [US-002] Unit tests for `BillingService`  
       — `packages/services/identity/src/billing/__tests__/billing.service.test.ts`  
       **Depends on**: T-009, T-010, T-011  
       **Implements**: FR-041, NFR-001  
       **Acceptance**: All tests pass; coverage ≥ 85% on `billing.service.ts`; error paths (missing customer, Stripe API errors) covered.

---

## User Story 3 — Subscription Lifecycle & Webhook Handling (P3)

> Stripe webhooks keep DB in sync; subscription state transitions are reliable. Implements FR-043.

- [ ] **T-014** [P0] [US-003] Implement the Stripe webhook handler in `identity-webhooks`, with ONE rejection path answering `2xx`  
       — `packages/services/identity-webhooks/src/handlers/stripeWebhook.ts`  
       **Depends on**: T-008, T-029  
       **Implements**: FR-043 (webhook routing per plan.md §3, §5), GR-016 §16-b, GR-018 §18-a/§18-b/§18-c/§18-d, GR-019  
       **⚠️ Two corrections to what this task used to say, both of which would have shipped a defect.**  
       **(1) Wrong deployable.** It named `packages/services/identity/src/billing/webhook/webhook.controller.ts` — the **ECS API**. [ADR-0017](../../docs/architecture/decisions/0017-service-ownership-for-features-006-007-009-010.md) and `plan.md` L145-160 put the Stripe webhook in **`@kitchensink/identity-webhooks`**, for four reasons that package already satisfies for Clerk's svix callback: it is an **unauthenticated third-party callback** that must not sit behind Clerk's `AuthMiddleware` (which protects every identity-service route but `/health`); it needs the **raw body**, so hosting it on the API forces `rawBody: true` globally for one route; it must **answer while the API is scaled down** (non-prod runs `FARGATE_SPOT` + a nightly shutdown, and Stripe retries for 72h against whatever is or is not up); and the **`webhook_events` idempotency table already exists in that database**.  
       **(2) ⛔ "Invalid signatures return `400`" is the EXACT inversion [GR-018 §18-c](../governance-rules.md#gr-018-one-rejection-path-and-invalid-input-is-never-retried) forbids** — and it is dangerous precisely because it **looks more correct than the rule**. **Stripe retries on ANY non-2xx for 72 hours.** A `400` therefore _requests_ a three-day retry storm of a payload that **can never succeed**, converting a producer's bug into sustained load and burying the signal that would have found it. It also split **signature** failure from **shape** failure into two behaviours, violating §18-a.  
       **Acceptance**: `POST /api/v1/billing/webhook` registered on the webhooks deployable; **no JWT auth**. Signature is verified **first**, the body is parsed against the T-029 Stripe boundary zod **second** — ⚠️ a signature proves **origin, not shape**, so both controls are required, in that order, never one instead of the other. A **signature failure and a shape failure are EQUALLY invalid**: they take **ONE** rejection path producing **ONE** structured shape differing **only** in a **`reason`** field. An invalid payload — either cause — is answered **`2xx`** with the rejection recorded in **(1)** the response body (so Stripe's dashboard shows what was wrong), **(2)** structured logs carrying the `reason`, **(3)** a **per-`reason` counter**, and **(4)** an **alarm** on that counter, because a rejection nobody sees is indistinguishable from success. **Reject the content, accept the delivery.**  
       **⛔ The rejected event is NOT recorded as a row** (GR-018 §18-d + GR-019). An invalid payload has **no trustworthy identifier**, and `webhook_events.identity_id` is `text NOT NULL` in this very database (`packages/shared/identity-db/src/schema/webhookEvents.ts`) — so "just record it" forces the writer to invent `'unknown'`, the sentinel GR-019 forbids outright. A sentinel here fuses every unattributable billing event into one fictitious account, cannot be told apart from a real id afterwards, and would put an **authorization** decision in the hands of a string literal. **The log line and the counter are load-bearing, not a consolation prize.**  
       **⚠️ This does NOT generalize to our own callers.** `/api/v1/billing/checkout`, `/portal` and `/subscription` are called by **our own** clients and keep returning the `400`/`403` GR-016 §16-a.3 requires — a `2xx` there would hide a fixable integration bug from the only party able to fix it. The question is always _who is on the other end, and do they retry on status?_  
       **Tests**: unit (a bad signature and a malformed body produce the **same** shape differing only in `reason`; no row is written for either) **AND** integration — **BOTH halves, per AC-018-c**: an **invalid** body yields **`2xx`** + the rejection in the body + the per-`reason` counter incremented + no `webhook_events` row, **AND** a **valid** body still yields its normal success. ⚠️ Without the second half the test **passes on a handler that always returns `200`**, which is the whole failure this rule guards.

- [ ] **T-015** [P0] [US-003] Implement Stripe idempotency in the webhooks deployable  
       — `packages/services/identity-webhooks/src/common/stripeIdempotency.ts`  
       **Depends on**: T-003, T-014  
       **Implements**: FR-043 (idempotency per plan.md §2, §3), GR-018 §18-d, GR-019  
       **Acceptance**: Duplicate `stripeEventId` skipped (recorded, not silent — a dedup hit increments its own counter); new events processed exactly once; the idempotency row is inserted **before** the handler runs, and **only for a payload that passed both T-014 controls**.  
       **⚠️ Path repointed** from `packages/services/identity/src/billing/webhook/webhook.service.ts` — the handler moved to `identity-webhooks` (T-014).  
       **⛔ Resolve the table-name collision deliberately, before writing a migration.** `plan.md` §2's DDL describes a `webhook_events` table keyed on `stripe_event_id` with `status` / `error` / `processed_at`. A table of that name **already ships** at `packages/shared/identity-db/src/schema/webhookEvents.ts`, keyed **`svix_id text PRIMARY KEY`** with `identity_id text NOT NULL`, `event_type`, `received_at`, `expires_at` — and **no** `stripe_event_id`, `status`, `error` or `processed_at`. Two different tables under one name is a **failing migration discovered at deploy time**, so the choice — extend the existing table, or add a distinctly named `stripe_webhook_events` — is made and recorded here rather than found. T-003 names the second option; if the first is chosen, T-003 changes with it.  
       **⚠️ `identity_id` is `text NOT NULL`.** Whichever option is taken, a row is written **only** when the principal resolved from a **validated** payload. An unresolvable account is a **rejection** (T-014), never `'unknown'`, `''` or `0` — including as a metrics dimension (GR-019).  
       **Tests**: unit (first delivery processes, replay skips and increments the dedup counter, a rejected payload writes **nothing**) **AND** integration (concurrent duplicate deliveries against real Postgres write exactly one row and never two — the race the unique constraint exists to lose safely).

- [ ] **T-016** [P1] [US-003] Implement `checkout.handler.ts` — provision subscription  
       — `packages/services/identity/src/billing/webhook/handlers/checkout.handler.ts`  
       **Depends on**: T-015  
       **Implements**: FR-041, FR-043 (`checkout.session.completed` per plan.md §3)  
       **Acceptance**: After event, account updated to `plan='premium'`, `subscriptionStatus='active'` (or `'trialing'`), `stripeCustomerId`, `stripeSubscriptionId`, `currentPeriodEnd` populated.

- [ ] **T-017** [P1] [US-003] Implement `invoice.handler.ts` — renewal & payment failure  
       — `packages/services/identity/src/billing/webhook/handlers/invoice.handler.ts`  
       **Depends on**: T-015  
       **Implements**: FR-043 (`invoice.paid`, `invoice.payment_failed` per plan.md §3)  
       **Acceptance**: `invoice.paid` resets `subscriptionStatus='active'` and updates `currentPeriodEnd`; `invoice.payment_failed` sets `subscriptionStatus='past_due'`.

- [ ] **T-018** [P1] [US-003] Implement `subscription.handler.ts` — sync & cancellation  
       — `packages/services/identity/src/billing/webhook/handlers/subscription.handler.ts`  
       **Depends on**: T-015  
       **Implements**: FR-043 (`customer.subscription.updated`, `customer.subscription.deleted` per plan.md §3)  
       **Acceptance**: Updated events sync `plan`, `status`, `currentPeriodEnd`, `cancelAtPeriodEnd`; deleted event downgrades to `plan='free'`, `status='canceled'`, clears Stripe IDs, retains all user data.

- [ ] **T-019** [P1] [US-003] Implement `trial-ending.handler.ts` — trial notification  
       — `packages/services/identity/src/billing/webhook/handlers/trial-ending.handler.ts`  
       **Depends on**: T-015  
       **Implements**: FR-041 (trial reminder per product-spec D-1)  
       **Acceptance**: Handler invoked for `customer.subscription.trial_will_end`; notification logged with user ID and trial end date; email stub ready for future integration.

- [ ] **T-020** [P1] [US-003] Integration tests for all webhook handlers  
       — `packages/services/identity-webhooks/tests/stripe-webhook-handlers.integration.test.ts`  
       **Depends on**: T-016, T-017, T-018, T-019  
       **Implements**: FR-043, NFR-001, GR-018 AC-018-c  
       **⚠️ Filename corrected — the old one used a BANNED suffix.** `webhook-handlers.e2e-spec.ts` is neither tier's convention: per CODING_STANDARDS §7 "Test File Location", **bare `*.spec.ts` is reserved for Playwright** (a shared suffix makes Playwright try to run vitest files and crash the run on their `vitest` imports), and every vitest tier uses `*.test.ts` — integration as `*.integration.test.ts` in `tests/`. The handlers also moved to `identity-webhooks` (T-014).  
       **Acceptance**: All state transitions verified (free→premium, active→past_due, active→canceled); idempotency confirmed under concurrent duplicate delivery; data retention on cancellation confirmed. **Plus both GR-018 halves**: an **invalid** body yields `2xx` + a recorded rejection + a per-`reason` counter + **no** row, **and** a **valid** body still yields its normal success — ⚠️ the second half is what stops this suite passing against a handler that always returns `200`.  
       **Tests**: this task **is** the integration tier; the matching unit tier lives with each handler (T-016…T-019), and the deployable's k6 load profile is T-034.

---

## User Story 4 — Upgrade Prompts & Frontend Integration (P3)

> Free-tier users see contextual upgrade prompts; 403 responses are intercepted. Implements FR-042.

- [ ] **T-021** [P1] [US-004] Web frontend HTTP interceptor for `403 PREMIUM_REQUIRED`  
       — `packages/apps/commise/web/src/lib/billing-interceptor.ts`  
       **Depends on**: T-005  
       **Implements**: FR-042 (three-tier prompt hierarchy per spec.md)  
       **Acceptance**: Attempting a premium action as free user shows upgrade CTA modal, not generic error toast; CTA links to checkout flow.

- [ ] **T-022** [P1] [US-004] Build reusable `<UpgradePrompt>` component (web)  
       — `packages/apps/commise/web/src/components/UpgradePrompt.tsx`  
       **Depends on**: T-021  
       **Implements**: FR-042, NFR-003, NFR-004 (accessible, non-color-only state)  
       **Acceptance**: Component renders with `aria-label`; Playwright `getByRole` finds CTA; color is not sole state indicator.

- [ ] **T-023** [P1] [US-004] Subscription status banner for `past_due` accounts (web)  
       — `packages/apps/commise/web/src/components/PastDueBanner.tsx`  
       **Depends on**: T-011  
       **Implements**: FR-042, FR-043 (past-due banner per plan.md OQ-4)  
       **Acceptance**: Banner visible for `past_due` users on all pages; hidden for `active`/`free`/`trialing`; links to customer portal.

- [ ] **T-024** [P1] [US-004] Mobile upgrade prompts (Expo / React Native)  
       — `packages/apps/commise/mobile/src/components/UpgradeSheet.tsx`  
       **Depends on**: T-021  
       **Implements**: FR-042 (mobile deep-link per spec.md Assumptions)  
       **Acceptance**: Premium action on mobile shows upgrade bottom sheet; tapping CTA opens system browser to web checkout URL.

- [ ] **T-025** [P2] [US-004] E2E tests — upgrade flow (Playwright)  
       — `packages/apps/commise/web/tests/e2e/upgrade-flow.spec.ts`  
       **Depends on**: T-022, T-023  
       **Implements**: FR-042, NFR-003  
       **Acceptance**: Free user hits gated feature → upgrade prompt appears; `past_due` banner visible on dashboard; premium user accesses gated feature without prompt.

---

## User Story 5 — Data Retention on Subscription Lapse (P3)

> All user data is retained when premium lapses; only premium actions are gated. Implements FR-043.

- [ ] **T-026** [P1] [US-005] Verify data retention policy in cancellation handler  
       — `packages/services/identity/src/billing/webhook/handlers/subscription.handler.ts`  
       **Depends on**: T-018  
       **Implements**: FR-043 (spec.md §Edge Cases, product-spec D-3)  
       **Acceptance**: Code review confirms NO data deletion; integration test verifies recipe count unchanged after `customer.subscription.deleted`.

- [ ] **T-027** [P1] [US-005] Read-only access for lapsed premium content  
       — `packages/services/identity/src/billing/guards/plan.guard.ts`, downstream service authorization layers  
       **Depends on**: T-006, T-026  
       **Implements**: FR-043 (spec.md Edge Cases)  
       **Acceptance**: Lapsed user can READ their own private recipes; cannot CREATE new private recipes or use AI features; `PlanGuard` only gates write/action endpoints for owned content.

- [ ] **T-028** [P2] [US-005] Mobile subscription status screen and portal deep-link  
       — `packages/apps/commise/mobile/src/screens/SubscriptionScreen.tsx`  
       **Depends on**: T-011, T-024  
       **Implements**: FR-041, FR-043 (mobile billing surface per spec.md Assumptions)  
       **Acceptance**: Free user sees upgrade CTA; active premium user sees plan details and Manage button; `past_due` user sees recovery banner; all buttons open correct URLs in system browser via `Linking.openURL`.

---

## Cross-Cutting — Contract ownership, validation & the client half (GR-015, GR-016, GR-017, GR-018)

> ⛔ **Service ownership is CLOSED.** [ADR-0017](../../docs/architecture/decisions/0017-service-ownership-for-features-006-007-009-010.md)
> rules `/api/v1/billing/*` into **`@kitchensink/identity-service`** sharing **`@kitchensink/schema-identity`**,
> with the Stripe webhook in **`@kitchensink/identity-webhooks`**. **No new deployable is created**, there is no
> `billing-service`, and there is **no** `@kitchensink/schema-billing` — a schema package is per **SERVICE**, not
> per feature. 010 **extends** `packages/schemas/identity`; forking it is a violation.
>
> ⚠️ **010 straddles GR-015, and getting the halves backwards here is expensive.** `/api/v1/billing/*` is
> **ours** (§15-b: converge it). **Stripe is not** (§15-d: never converge it). The webhook request carries one of
> each: the **inbound body is Stripe's**, the **response is ours**.

- [ ] **T-029** [P0] [US-002] Author billing's wire shapes as zod in the identity service and extend the existing schema package  
       — `packages/services/identity/src/billing/billing.schema.ts`, `packages/services/identity/src/billing/subscription.schema.ts` → `packages/schemas/identity`  
       **Depends on**: T-008  
       **Implements**: FR-041, FR-043, GR-015 §15-a, GR-017 §17-a.1/§17-a.3  
       **Acceptance**: Checkout, portal and subscription-status request/response shapes — plus the **webhook endpoint's own response** shape — authored as zod **beside `BillingController`** under `src/billing/`, importing **only `zod` and other `*.schema.ts` files**. `npm run contract:verify` regenerates `packages/schemas/identity` (`schemas.ts`, `types.ts`, `contract-hash.ts`, barrel, **derived** `openapi.yaml`) with no diff. **Add to the existing `@kitchensink/schema-identity` — never fork it**, and never hand-edit the generated package. Schemas live at `src/billing/*.schema.ts` beside the controller, **never in a `dto/` directory** (§15.2).  
       **⛔ No Stripe SDK type may appear in a `*.schema.ts`**, and Stripe's shapes are **not** folded into our schema package as though we owned them. Our normalized `SubscriptionStatus` **deliberately differs** from Stripe's subscription object — that difference **is** the normalization, not drift.  
       **⛔ Three things that look wrong and are not**: the schema package is a literal file **COPY** (zod are runtime values and cannot be derived from themselves); `openapi.yaml` is **DERIVED** output for `oasdiff`/docs/integrators and is **NEVER a codegen input**; the copy is wired with turbo `$TURBO_ROOT$` **`inputs`**, never `dependsOn` (that edge closes the cycle `client → schema → service → client`).  
       **⚠️ Identifiers are REQUIRED, never sentinels** (GR-019): `stripeCustomerId` / `stripeSubscriptionId` are typed required where consumed and `| null` where genuinely absent — never `''`, `'unknown'` or `'none'`, in storage, on a wire, as a map key, or as a metrics dimension.  
       **Tests**: unit (each schema accepts a valid fixture and rejects every malformed variant; the enum rejects an unknown status) **AND** integration (regenerate-and-diff runs clean; `packages/services/identity/src/__tests__/build-inputs.test.ts` covers the new files; the `CONTRACT_HASH` boot assertion still holds).

- [ ] **T-030** [P0] [US-002] Register billing routes under **`nestjs-zod`'s** `ZodValidationPipe`, with `z.strictObject()` on mutating bodies  
       — `packages/services/identity/src/billing/billing.controller.ts`, `packages/services/identity/src/app.module.ts`  
       **Depends on**: T-012, T-029  
       **Implements**: FR-041, GR-016 §16-a/§16-e, GR-017 §17-a.5/§17-c  
       **⚠️ Billing lands inside the ONE service where this has already gone wrong.** Identity is where a `createZodDto` DTO was served by Nest's **own** `ValidationPipe` and therefore **validated nothing while looking correctly wired** — `PATCH /users/me`, a route that writes user data. Billing routes must not inherit that wiring. Identity registers `nestjs-zod`'s pipe in `app.module.ts` today (**6** `ZodValidationPipe` / **6** `createZodDto` sites, re-measured 2026-08-12, up from 3/4).  
       **Acceptance**: Every checkout, portal and subscription input — body, path params, query params — takes a `createZodDto` DTO derived from T-029's zod under **`nestjs-zod`'s** pipe. **One** mechanism in the service; **no `class-validator` DTO** added alongside it. One `400` path naming the offending field. Every mutating body uses **`z.strictObject()`** — `z.object()` strips unknown keys silently, so a misspelled field would yield a `200` and a partial write on the **money path**.  
       **Tests**: unit (per-DTO accept/reject, unknown-key rejection) **AND** integration (post a known-bad body to a **real billing route** on a booted app and assert the `400` + field name — the **only** way to observe the wrong-pipe failure; modelled on `packages/services/identity/tests/app-validation.test.ts`) **AND** e2e (extends T-012's `401`/`200` coverage over HTTP) **AND** k6 (T-034).

- [ ] **T-031** [P1] [US-001] Add the storage-floor boundary-parity test for billing's bounded columns  
       — `packages/services/identity/src/billing/__tests__/storage-capacity.test.ts`
    - ⛔ **DO NOT BUILD A NEW GATE — the mechanism already EXISTS.** `@kitchensink/contract-gen` exports `auditStorageCapacity` / `collectBoundedColumns` / `formatStorageCapacityFindings` (`packages/tools/contract-gen/src/storage-capacity.ts`), and a `storage-capacity.test.ts` already wires it in **all three** shipped services (recipe `src/database/__tests__/`, food `src/db/schema/__tests__/`, identity `src/types/schema/__tests__/`). Copy that pattern; do not hand-roll a second one — a second mechanism for one invariant is the failure GR-016 §16-a.2 forbids, one layer up. It reads drizzle **structurally** via `Symbol.for('drizzle:Columns')` (so `contract-gen` needs no `drizzle-orm` dependency) and zod bounds via the **public** `z.toJSONSchema`; it is already **exhaustive over columns**, with `stale-account` / `duplicate-account` findings as the reverse-direction check. The work here is the **mapping**: every bounded column bound to the wire fields that write it, or declared not-client-writable **with a reason** (GR-017 §17-d).
      **Depends on**: T-002, T-003, T-029  
       **Implements**: GR-016 §16-d, GR-017 §17-d  
       **Acceptance**: Lives **in the service**, imports **both** the storage schema and the authored zod (a test is not a wire schema, so §16-d's ban on the _production_ coupling is untouched), **derives** its bounded-column enumeration from the storage schema rather than typing it out, and asserts each writing wire field **rejects** a value the column cannot hold: `stripe_event_id varchar(255)`, `event_type varchar(100)`, **`status varchar(20)`** (⚠️ the thinnest margin in the portfolio — `'processing'` is already 10 chars, and an over-long status is a failed `INSERT` on the money path), plan/status enum domains, integer amounts against the `int4` ceiling **2,147,483,647**, timestamps, nullability. Mapping completeness asserted in **BOTH** directions — every bounded column has an entry or an explicit reasoned exemption, and every entry names a column that exists.  
       **⚠️ `accounts`' new `varchar` columns are declared with NO length** in `plan.md` §2, which is **unbounded in PostgreSQL and therefore not yet a floor** — **a length must be declared before it can be asserted against**. Declaring it is part of T-002; `stripeCustomerId` / `stripeSubscriptionId` hold **third-party identifiers whose format is Stripe's to change**, so the bound is a deliberate product choice, not a derivation.  
       **⛔ Asserted, never derived** — no zod generated from the storage schema, and **no Stripe SDK type** in a `*.schema.ts`.  
       **⚠️ Limitation**: only the "every bounded column has an entry" direction catches a **new** column, and only if the enumeration is derived. Derive it.  
       **Tests**: unit (the parity assertions) **AND** integration (an over-length `status` posted through a real path yields the boundary rejection, not a `22001` from the `INSERT` surfacing as `500`).

- [ ] **T-032** [P0] [US-003] ⛔ Boundary-validate Stripe's inbound shapes — and NEVER converge them  
       — `packages/services/identity-webhooks/src/stripe/stripeEvents.schema.ts`  
       **Depends on**: T-014  
       **Implements**: FR-043, GR-015 §15-d, GR-016 §16-b, GR-017 §17-b.6  
       **⛔ This is the OPPOSITE case to T-029, in the same feature.** We do **not** serve Stripe's API: there is no service of ours to own its types, and Stripe versions its contract independently of us.  
       **Acceptance**: `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted` and `customer.subscription.trial_will_end` each have a zod schema validating the **raw upstream shape at the boundary**, applied **after** signature verification and **before any field drives a `subscriptions` or `webhook_events` write**. This adapter **MAY declare its own types**; Stripe's types stay on **Stripe's side of the adapter**; **NO OpenAPI document is written for Stripe**; and rules 17-b.1–17-b.5 do not apply to it. Only unknown/unregistered event types are ignored — and ignored **loudly**, with a counter, never silently.  
       **⛔ Deleting these schemas in the name of §15-b is a SECURITY and CORRECTNESS regression, not a cleanup — this is the code path that decides who has paid.** `packages/clients/usda/src/schemas.ts` is the reference implementation and must **NEVER** be touched in this rule's name.  
       **⚠️ Parse before you branch.** The plan/entitlement enum gates 004, 007, 009, 012 and 013. A `status` string that was never checked against the enum can **fail open — granting premium — with `typecheck` green**.  
       **Tests**: unit (each event schema rejects a renamed, missing, wrong-typed and null-valued field; an unknown event type is counted, not thrown; the normalized `SubscriptionStatus` is asserted **independent** of Stripe's raw shape) **AND** integration (recorded real Stripe test-mode payloads parse clean; a mutated payload is rejected at the boundary and drives **no** write).

- [ ] **T-033** [P1] [US-002] Consume billing through the schema package on web and mobile, validating responses on receipt  
       — `packages/apps/commise/web`, `packages/apps/commise/mobile`, `packages/apps/commise/features/account`  
       **Depends on**: T-029, T-021, T-024  
       **Implements**: FR-041, FR-042, GR-015 §15-b, GR-016 §16-c.2/§16-c.3, GR-017 §17-b.1–§17-b.4, §17-f, CODING_STANDARDS §14.1  
       **Acceptance**: No file in `@commise/web`, `@commise/mobile` or `@commise/features-account` declares a billing request/response body type — `SubscriptionStatus`, the checkout-session response and the portal response all come from **`@kitchensink/schema-identity`**, and divergent consumer shapes (the past-due banner's view model, the upgrade-prompt tier copy model) are **DERIVED** with `Pick`/`Omit`/`Partial`. Reference: `packages/apps/commise/features/recipes/src/filters/model.ts`. **Every response is parsed with that package's runtime zod the moment it arrives**, and every outbound body is validated against it **before** the call. A parse failure **fails closed** to `free` — it never renders an entitlement it could not read.  
       **⚠️ Which consumer package is still OPEN in 002** (`packages/clients/identity` vs `@commise/features-account` importing `@kitchensink/schema-identity` directly). 010 does **not** pre-empt that decision; whichever lands, the obligations above are identical, and a `packages/clients/identity` created later carries a **contract-skew guard** modelled on `packages/clients/{food-service,recipe-service}/src/contractSkew.ts`.  
       **⛔ Do NOT add server-side response validation** — GR-016 §16-g defers a **producing service** parsing what it **emits**; that is an owner decision, not an unfinished task. This is the **consumer** parsing what it **received** (GR-017 §17-f).  
       **Tests**: unit (each derived model asserted assignable from its wire parent; a response with a missing, renamed or wrong-typed `plan`/`status` raises the typed parse error and falls back to `free`) **AND** **vitest component tests for EVERY path/state on BOTH platforms** — free, trialing, active, past-due-in-grace, past-due-beyond-grace, canceled, checkout-pending, checkout-failed, portal-unavailable, entitlement-unreadable — not a representative sample **AND** **Playwright** (web, extending T-025) **AND** a **Maestro** flow per story (mobile, matching T-025 one-for-one — ⚠️ T-024 and T-028 are the mobile surfaces and currently have **no Maestro flow**, which §14.1 requires).

- [ ] **T-034** [P2] [US-002] Add k6 load coverage for the billing surface and the webhook ingress  
       — `packages/tools/loadtest/`  
       **Depends on**: T-030, T-014  
       **Implements**: NFR-001, CODING_STANDARDS §7.1 (a deployable owes e2e **AND** k6), GR-017 §17-a.8  
       **Acceptance**: Load profiles assert the latency/throughput SLOs for `/api/v1/billing/subscription` (read on the hot path for gating) and for the webhook ingress under **Stripe's 72-hour retry behaviour** — the rejection path must stay cheap, because a malformed-payload storm is answered `2xx` and must not become a cost or latency incident. k6 is a **separate, additional** gate and is not part of the 70/20/10 pyramid.  
       **⚠️ Scripts live in `packages/tools/loadtest/`, shared across services, not colocated** (§7 Test File Location), and `open()` is script-relative.  
       **Tests**: this task **is** the k6 tier.

---

## Summary

| Task  | Title                                                      | Story  | Depends on          |
| ----- | ---------------------------------------------------------- | ------ | ------------------- |
| T-001 | Add `stripe` dep + env schema                              | US-001 | —                   |
| T-002 | Extend `accounts` schema                                   | US-001 | T-001               |
| T-003 | Create `stripe_webhook_events` table                       | US-001 | T-001               |
| T-004 | `@RequirePremium()` decorator                              | US-001 | T-002               |
| T-005 | `PlanGuard` with grace period                              | US-001 | T-004               |
| T-006 | Apply decorator to gated endpoints                         | US-001 | T-005               |
| T-007 | Unit tests for `PlanGuard`                                 | US-001 | T-005, T-006        |
| T-008 | Scaffold `BillingModule`                                   | US-002 | T-001               |
| T-009 | `BillingService` checkout session                          | US-002 | T-008, T-002        |
| T-010 | `BillingService` portal session                            | US-002 | T-009               |
| T-011 | `BillingService` subscription status                       | US-002 | T-002               |
| T-012 | `BillingController` endpoints                              | US-002 | T-009, T-010, T-011 |
| T-013 | Unit tests for `BillingService`                            | US-002 | T-009, T-010, T-011 |
| T-014 | `StripeWebhookController`                                  | US-003 | T-008               |
| T-015 | `WebhookService` with idempotency                          | US-003 | T-003, T-014        |
| T-016 | `checkout.handler.ts`                                      | US-003 | T-015               |
| T-017 | `invoice.handler.ts`                                       | US-003 | T-015               |
| T-018 | `subscription.handler.ts`                                  | US-003 | T-015               |
| T-019 | `trial-ending.handler.ts`                                  | US-003 | T-015               |
| T-020 | Integration tests for webhook handlers                     | US-003 | T-016–T-019         |
| T-021 | Web frontend 403 interceptor                               | US-004 | T-005               |
| T-022 | `<UpgradePrompt>` component (web)                          | US-004 | T-021               |
| T-023 | `past_due` banner (web)                                    | US-004 | T-011               |
| T-024 | Mobile upgrade prompts                                     | US-004 | T-021               |
| T-025 | E2E tests — upgrade flow                                   | US-004 | T-022, T-023        |
| T-026 | Verify data retention in cancellation                      | US-005 | T-018               |
| T-027 | Read-only access for lapsed content                        | US-005 | T-006, T-026        |
| T-028 | Mobile subscription status screen                          | US-005 | T-011, T-024        |
| T-029 | Author billing zod + extend `@kitchensink/schema-identity` | US-002 | T-008               |
| T-030 | `nestjs-zod` pipe on billing routes + `z.strictObject()`   | US-002 | T-012, T-029        |
| T-031 | Storage-floor boundary-parity test                         | US-001 | T-002, T-003, T-029 |
| T-032 | Stripe boundary zod — the §15-d opposite case              | US-003 | T-014               |
| T-033 | Web + mobile consume the schema package, parse on receipt  | US-002 | T-029, T-021, T-024 |
| T-034 | k6 load coverage: billing surface + webhook ingress        | US-002 | T-030, T-014        |

**Total tasks: 34** (was 28).

⚠️ **T-029…T-034 close GR-017 §17-e.12.** Before this revision the file had **no** task to extend the schema
package, wire the `CONTRACT_HASH`/skew surface, or validate a response on receipt — while `plan.md` §3.0 stated
the client obligation in prose. An obligation with no task is an obligation that does not ship.

⚠️ **Four stale/contradictory items were corrected in place**, each of which would have shipped a defect:
T-014 (the GR-018 §18-c `400` inversion **and** the wrong deployable), T-003/T-015 (the `webhook_events`
table-name collision with the shipped svix table), T-006 (three nonexistent service paths, plus the guard's
package and claim source per ADR-0017 decision 3), and T-020 (the banned `.e2e-spec.ts` suffix).
