# Tasks: Feature 010 — Subscriptions & Monetization

**Feature**: `010-subscriptions`  
**Source**: [spec.md](spec.md), [plan.md](plan.md), [product-spec](product-spec/product-spec.md)  
**Constraints**: all `- [ ]`, paths under `packages/`, no phantom T-NNN, trace to spec.md.

---

## US Reference

| US     | Title                                    | Priority | FRs               |
| ------ | ---------------------------------------- | -------- | ----------------- |
| US-001 | Free and Premium Subscription Tiers      | P3       | FR-040, FR-041    |
| US-002 | Checkout & Billing Management            | P3       | FR-041            |
| US-003 | Subscription Lifecycle & Webhook Handling| P3       | FR-043            |
| US-004 | Upgrade Prompts & Frontend Integration   | P3       | FR-042            |
| US-005 | Data Retention on Subscription Lapse     | P3       | FR-043            |

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
```

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

- [ ] **T-003** [P0] [US-001] Create `stripe_webhook_events` idempotency table  
  — `packages/services/identity/src/database/schema/stripe_webhook_events.ts`  
  **Depends on**: T-001  
  **Implements**: FR-041 (idempotency per plan.md §2)  
  **Acceptance**: Schema file exists; Drizzle migration runs; duplicate `stripeEventId` rejected by PK/unique constraint.

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
  — downstream service controllers (e.g. `packages/services/recipe/src/…`, `packages/services/ai/src/…`, `packages/services/meal-plan/src/…`)  
  **Depends on**: T-005  
  **Implements**: FR-041 (Feature Gating Map per plan.md §4)  
  **Acceptance**: Each gated endpoint returns `403 PREMIUM_REQUIRED` for free-tier users; premium users pass through.

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

- [ ] **T-014** [P0] [US-003] Implement `StripeWebhookController` with raw-body support  
  — `packages/services/identity/src/billing/webhook/webhook.controller.ts`  
  **Depends on**: T-008  
  **Implements**: FR-043 (webhook routing per plan.md §3, §5)  
  **Acceptance**: `POST /api/v1/billing/webhook` registered; no JWT auth; invalid signatures return `400`; `rawBody: true` confirmed in `main.ts`.

- [ ] **T-015** [P0] [US-003] Implement `WebhookService` with Stripe idempotency  
  — `packages/services/identity/src/billing/webhook/webhook.service.ts`  
  **Depends on**: T-003, T-014  
  **Implements**: FR-043 (idempotency per plan.md §2, §3)  
  **Acceptance**: Duplicate `stripeEventId` silently skipped; new events processed once; `stripe_webhook_events` row inserted before handler runs.

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
  — `packages/services/identity/src/billing/webhook/handlers/__tests__/webhook-handlers.e2e-spec.ts`  
  **Depends on**: T-016, T-017, T-018, T-019  
  **Implements**: FR-043, NFR-001  
  **Acceptance**: All state transitions verified (free→premium, active→past_due, active→canceled); idempotency confirmed; data retention on cancellation confirmed.

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

## Summary

| Task | Title                                         | Story | Depends on |
| ---- | --------------------------------------------- | ----- | ---------- |
| T-001 | Add `stripe` dep + env schema                 | US-001 | — |
| T-002 | Extend `accounts` schema                      | US-001 | T-001 |
| T-003 | Create `stripe_webhook_events` table          | US-001 | T-001 |
| T-004 | `@RequirePremium()` decorator                 | US-001 | T-002 |
| T-005 | `PlanGuard` with grace period                 | US-001 | T-004 |
| T-006 | Apply decorator to gated endpoints            | US-001 | T-005 |
| T-007 | Unit tests for `PlanGuard`                    | US-001 | T-005, T-006 |
| T-008 | Scaffold `BillingModule`                      | US-002 | T-001 |
| T-009 | `BillingService` checkout session             | US-002 | T-008, T-002 |
| T-010 | `BillingService` portal session               | US-002 | T-009 |
| T-011 | `BillingService` subscription status            | US-002 | T-002 |
| T-012 | `BillingController` endpoints                   | US-002 | T-009, T-010, T-011 |
| T-013 | Unit tests for `BillingService`                 | US-002 | T-009, T-010, T-011 |
| T-014 | `StripeWebhookController`                     | US-003 | T-008 |
| T-015 | `WebhookService` with idempotency               | US-003 | T-003, T-014 |
| T-016 | `checkout.handler.ts`                         | US-003 | T-015 |
| T-017 | `invoice.handler.ts`                            | US-003 | T-015 |
| T-018 | `subscription.handler.ts`                       | US-003 | T-015 |
| T-019 | `trial-ending.handler.ts`                       | US-003 | T-015 |
| T-020 | Integration tests for webhook handlers          | US-003 | T-016–T-019 |
| T-021 | Web frontend 403 interceptor                    | US-004 | T-005 |
| T-022 | `<UpgradePrompt>` component (web)               | US-004 | T-021 |
| T-023 | `past_due` banner (web)                         | US-004 | T-011 |
| T-024 | Mobile upgrade prompts                          | US-004 | T-021 |
| T-025 | E2E tests — upgrade flow                        | US-004 | T-022, T-023 |
| T-026 | Verify data retention in cancellation           | US-005 | T-018 |
| T-027 | Read-only access for lapsed content             | US-005 | T-006, T-026 |
| T-028 | Mobile subscription status screen               | US-005 | T-011, T-024 |
