# Product Spec — Notification Service

**Branch**: `014-notification-service`
**Status**: Reconciled 2026-08-05 / **pending revalidation**

---

## Index

| Artifact      | File                                 | Status                                                                                                                            |
| ------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Product Spec  | [product-spec.md](./product-spec.md) | Story map renumbered onto `spec.md` ids; Q-001/Q-002/Q-003/Q-007 resolved, Q-009 opened (2026-08-05).                             |
| User Journeys | [user-journey.md](./user-journey.md) | Producer publish, recipient delivery, and operations broadcast journeys. **Journey C step 4 contradicts `spec.md` on global retention — see Q-009.** |
| Wireframes    | **needed — no longer deferred**      | 014 owns the in-app bell + feed surface. The previous note ("in-app rendering belongs to consumer features") predates the discovery that both apps already ship an inert notifications control awaiting this service. Tasks T-028 – T-030. |
| Metrics       | [metrics.md](./metrics.md)           | Product execution metrics for publish API reliability, live/replay delivery, operations auditability, and producer compatibility. |

---

## Quick links

- [product-spec.md](./product-spec.md) — scope and contract sketch
- [user-journey.md](./user-journey.md) — notification delivery journeys
- [metrics.md](./metrics.md) — story-level execution metrics
- [../README.md](../README.md) — feature overview and follow-up scope
- [../research/codebase-analysis.md](../research/codebase-analysis.md) — current state of notification references across features
- [../review.md](../review.md) — revalidation log
