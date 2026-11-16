# Product Spec: Subscriptions & Monetization

**Branch**: `010-subscriptions`
**Date**: 2026-05-09
**Status**: Draft
**Source**: [spec.md](../spec.md)

---

## Index

This directory contains Product Forge product specification artifacts for feature 010 subscriptions and monetization.

| Artifact      | File                                  | Description                                                                                                                                                           |
| ------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product Spec  | [product-spec.md](./product-spec.md)  | Vision, personas, epics, MoSCoW story map with strict traceability to `FR-040..FR-043`, and explicit out-of-scope list.                                               |
| User Journeys | [user-journey.md](./user-journey.md)  | End-to-end journeys covering free-tier usage, premium upgrade, subscription lifecycle events, cancellation/downgrade behavior, and restore-purchase flow.             |
| Wireframes    | [wireframes/](./wireframes/README.md) | ASCII conceptual wireframes for six monetization screens: pricing page, paywall modal, subscription management, billing history, restore purchase, tier upgrade flow. |
| Metrics       | [metrics.md](./metrics.md)            | Story-level measurable outcomes for subscription adoption, conversion, gating UX quality, and retention after downgrade.                                              |

---

## Quick Links

- [product-spec.md](./product-spec.md) — source of scope decisions
- [user-journey.md](./user-journey.md) — primary lifecycle flows
- [wireframes/](./wireframes/README.md) — monetization UI structures
- [metrics.md](./metrics.md) — story-level metrics
- [../spec.md](../spec.md) — canonical FR/NFR reference
- [../plan.md](../plan.md) — architecture and endpoint contracts

---

## Artifact Cross-Reference

```
product-spec.md
    |
    +-- MoSCoW stories (US-010-001..)
    |       Each story references FR-040..FR-043 only
    |
    +-- Personas (Free User / Premium Aspirant / Returning Subscriber)
    |
    v
user-journey.md
    |
    +-- Upgrade and lifecycle sequence diagrams
    |       Billing + gating + downgrade + restore paths
    |
    v
wireframes/
    |
    +-- pricing-page.md
    +-- paywall-modal.md
    +-- subscription-manage.md
    +-- billing-history.md
    +-- restore-purchase.md
    +-- tier-upgrade-flow.md
    |
    v
metrics.md
    |
    +-- Story-level outcomes tied to FR-040..043 and SC-005/SC-006
```

---

## Traceability Rules Applied

1. All stories in `product-spec.md` map to `FR-040`..`FR-043` from `spec.md`.
2. Any domain request not represented in source FRs is marked as **future consideration** rather than a hard requirement.
3. Dependency-gated capabilities from other specs are referenced only as transitive behavior under `FR-041`.
