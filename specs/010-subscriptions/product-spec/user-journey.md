# User Journeys: Subscriptions & Monetization

**Branch**: `010-subscriptions`
**Date**: 2026-05-09
**Status**: Draft
**Source**: [product-spec.md](./product-spec.md), [spec.md](../spec.md), [plan.md](../plan.md)

---

## Journey Notation

Each journey represents an end-to-end user flow. Steps annotate requirement coverage with `[FR-XXX]` or `[NFR-XXX]` where relevant.

---

## Persona 1: Free-First Home Cook (Alex) — Journey A: Hit a Premium Gate and Evaluate Upgrade

**Scenario**: Alex uses free-tier features successfully, then attempts to set a recipe private and encounters a contextual paywall with a clear value explanation.

```mermaid
sequenceDiagram
    participant Alex as Alex (Web)
    participant API as Commise API
    participant Guard as PlanGuard
    participant UI as Upgrade Prompt UI

    Note over Alex,API: Free-tier baseline usage [FR-040]

    Alex->>API: GET /api/v1/recipes (public + own)
    API-->>Alex: 200 OK

    Alex->>API: PATCH /api/v1/recipes/:id/visibility { private: true }
    API->>Guard: Evaluate entitlement
    Guard-->>API: deny (plan=free)
    API-->>Alex: 403 { code: PREMIUM_REQUIRED, upgradeUrl }

    Alex->>UI: View paywall modal with value preview
    Note right of UI: clear contextual prompt [FR-042]
    Note right of UI: icon+text lock labels [NFR-004]
```

---

## Persona 2: Power Planner Upgrader (Jordan) — Journey B: Upgrade and Unlock Immediately

**Scenario**: Jordan attempts an AI planning feature, upgrades through Stripe Checkout, and gets immediate premium access.

```mermaid
sequenceDiagram
    participant Jordan as Jordan (Web)
    participant API as Billing API
    participant Stripe as Stripe Checkout
    participant Webhook as Stripe Webhook
    participant DB as Account Store

    Jordan->>API: POST /api/v1/meal-plans/generate (premium feature)
    API-->>Jordan: 403 PREMIUM_REQUIRED [FR-042]

    Jordan->>API: POST /api/v1/billing/checkout
    API-->>Jordan: checkoutUrl
    Jordan->>Stripe: Complete payment / trial setup

    Stripe->>Webhook: checkout.session.completed
    Webhook->>DB: set plan=premium, status=active|trialing

    Jordan->>API: POST /api/v1/meal-plans/generate (retry)
    API-->>Jordan: 200 OK [FR-041]
```

---

## Persona 3: Returning Subscriber (Morgan) — Journey C: Payment Failure, Grace, Downgrade, Reactivation

**Scenario**: Morgan's renewal fails, enters grace period, downgrades to free behavior without data loss, then reactivates.

```mermaid
sequenceDiagram
    participant Stripe as Stripe
    participant Webhook as Webhook Service
    participant DB as Account Store
    participant Morgan as Morgan
    participant API as Commise API

    Stripe->>Webhook: invoice.payment_failed
    Webhook->>DB: status=past_due

    Morgan->>API: Attempt premium action during grace
    API-->>Morgan: allowed/conditional based on grace policy

    Stripe->>Webhook: customer.subscription.deleted
    Webhook->>DB: plan=free, status=canceled

    Morgan->>API: Access core features and historical data
    API-->>Morgan: data retained, premium actions gated [FR-043]

    Morgan->>API: POST /api/v1/billing/checkout (re-upgrade)
    Stripe->>Webhook: checkout.session.completed
    Webhook->>DB: plan=premium
```

---

## Cross-Platform Journey D: Restore Purchase Signal (Mobile)

**Scenario**: User reinstalls app or switches device and invokes restore purchase to resync entitlement state.

1. User opens Billing Settings > Restore Purchase.
2. App calls restore/sync endpoint and refreshes account plan state.
3. App displays resolved entitlement state and available actions.

Coverage:

- Supports continuity expectations tied to `FR-043` trust contract.
- If mobile store billing is added, this flow becomes mandatory parity path (currently future-oriented warning).

---

## Journey-to-Requirement Matrix

| Journey              | FR-040 | FR-041           | FR-042 | FR-043 | NFR-003 | NFR-004 |
| -------------------- | ------ | ---------------- | ------ | ------ | ------- | ------- |
| A: Hit premium gate  | ✅     | ✅ (attempted)   | ✅     | —      | ✅      | ✅      |
| B: Upgrade + unlock  | —      | ✅               | ✅     | —      | ✅      | ✅      |
| C: Lapse + retention | ✅     | ✅ (when active) | ✅     | ✅     | —       | ✅      |
| D: Restore purchase  | ✅     | ✅               | —      | ✅     | ✅      | —       |
