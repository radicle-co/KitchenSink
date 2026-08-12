# Tech Stack Rationale: Subscriptions & Monetization

**Branch**: `010-subscriptions` | **Date**: 2026-05-09
**Status**: Complete | **Sources**: [research.md](../research.md), [plan.md](../plan.md)

---

## Overview

Feature 010 uses a Stripe-centered billing architecture integrated into the existing NestJS stack. The objective is to implement subscription monetization (`FR-040`..`FR-043`) with low PCI scope, deterministic entitlement checks, and recoverable lifecycle handling.

---

## Billing Provider and Checkout Strategy

### Choice

**Stripe Checkout + Stripe Customer Portal**

### Rationale

- Hosted checkout minimizes payment UI complexity and PCI burden.
- Customer Portal covers plan changes, payment method updates, and cancellation without bespoke management screens.
- Strong webhook event model aligns with entitlement synchronization needs.

### Trade-offs

| Trade-off                                                  | Mitigation                                                         |
| ---------------------------------------------------------- | ------------------------------------------------------------------ |
| External redirect flow can reduce perceived app continuity | Use consistent return URLs and branded transitions                 |
| Webhook reliability depends on signing + retries           | Enable rawBody, signature verification, and idempotency table      |
| Store-billing parity not automatic                         | Reserve extension points for App Store / Play Store reconciliation |

---

## Backend Framework Integration

### Choice

**NestJS + `@golevelup/nestjs-stripe`**

### Rationale

- Integrates Stripe client and webhook handling via Nest DI patterns.
- Supports decorator-based routing and signature verification flows.
- Fits existing guard/decorator approach used for authorization concerns.

### Critical implementation constraint

`NestFactory.create(..., { rawBody: true })` is required for signature verification correctness.

---

## Entitlement and Gating Mechanism

### Choice

**`@RequirePremium()` decorator + `PlanGuard`**

### Rationale

- Keeps premium checks explicit at endpoint level.
- Runs after `AuthMiddleware` (Clerk session-token verification); fails closed when `req.user` is absent.
- Produces consistent `403 PREMIUM_REQUIRED` envelope for frontend UX handling (`FR-042`).

### Coverage target

Guard applies to premium-gated dependencies:

- private recipe visibility
- AI generation / optimization
- auto meal planning / waste optimization
- online grocery ordering
- trainer nutrition planning

---

## Persistence Layer

### Choice

Persist subscription state on `Account` + Stripe webhook idempotency table (**`stripe_webhook_events`** — ⚠️ superseded name, this file said `webhook_events`, which already ships for Clerk/svix dedup; ADR-0018).

### Rationale

- Eliminates per-request external lookup for entitlement checks.
- Enables deterministic state transitions (`trialing`, `active`, `past_due`, `canceled`).
- Supports replay-safe processing under webhook retries.

### Lifecycle fit

- `checkout.session.completed` → provision premium
- `invoice.paid` / `invoice.payment_failed` → payment lifecycle updates
- `customer.subscription.updated/deleted` → synchronization and downgrade behavior (`FR-043`)

---

## Frontend Technology Fit

### Web

- Interceptor for premium-required response
- Reusable upgrade prompt components with accessible labeling
- Pricing and checkout launch endpoints integrated through API client

### Mobile

- Restore purchase surface included in UX contract
- Billing-channel parity with store ecosystems remains future extension unless explicit FR introduced

---

## Observability and Reliability

- Log all webhook processing attempts and outcomes.
- Persist processed event IDs before applying irreversible state updates.
- Capture conversion funnel events (prompt viewed → checkout started → subscription activated).

---

## Future Extension Points (Non-mandatory)

1. **App Store / Play Store entitlement adapters**
2. **Family plan and household seat model**
3. **Dynamic paywall experiments / offer testing**

These are intentionally non-blocking unless added to source requirements.
