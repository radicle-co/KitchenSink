# Codebase Analysis — Notification Service

**Branch**: `014-notification-service`
**Status**: Bootstrap snapshot
**Date**: 2026-05-10

---

## Current state of "notifications" across the repo

There is no existing notification module. References are scattered across feature specs and there is no implementation to inspect — no folders exist yet for any of the cited references.

### Spec-level references (per `specs/cross-feature-consistency-report.md` §5.3 and WA-004)

| Feature                  | Reference                                                                                                                                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 001 — Commise            | `product-spec/product-spec.md` mentions notifications in vision/principles. No transport defined.                                                                                                         |
| 003 — USDA Food Data     | `plan.md` mentions "email/webhook notifications" for fetch failures. `product-spec/product-spec.md` US-005 (Rev 1) explicitly depends on an in-app notification when a backfilled food becomes available. |
| 005 — AI Integration     | `plan.md` mentions transparency disclosures on AI-generated content. No transport defined.                                                                                                                |
| 008 — Cooking Mode       | `plan.md` mentions timer alerts. No transport defined.                                                                                                                                                    |
| 009 — Nutrition Planning | `plan.md` mentions notifications for compliance gaps. No transport defined.                                                                                                                               |

### Implementation-level references

None. No notification code exists in the repository at the time of bootstrap.

---

## Inferred requirements from existing producers

These are the constraints implied by the consuming features as currently specced:

1. **003 backfill notification (firm)**: When a `pending` food row transitions to `fetched`, the original requester(s) must be notified in-app. Multiple users may have requested the same food (US-005 demand-weighted prioritization), so single-recipient and "fan-out to all requesters" must both be expressible. The "fan-out to all requesters" case is naturally a list of single-user publishes; the service does not need a distinct primitive for it.

2. **008 timer alerts (firm in spirit, soft in spec)**: Cooking mode timers are per-user and time-sensitive. Suggests low-latency in-app delivery is required, not a polling cadence measured in minutes.

3. **Global broadcasts (implied, not yet firm)**: Operations and product-wide announcements are not currently specced anywhere but were flagged in the cross-feature report as a gap. The recipient model includes `global` to allow this without a follow-up spec change.

---

## Existing infrastructure that may be reused

> Names below are repo-wide context; nothing in this folder constrains the implementation choice.

- **Auth (002 — Clerk)**: Provides authenticated identity that subscribers must carry. Group membership semantics are not yet specced in 002 — see Q-002 in the product spec.
- **AWS account**: Repo already uses AWS (per 001/003 plans for S3, SQS, RDS, CloudFront). SQS + SNS are available for backend-side fan-out without introducing a new dependency. WebSocket termination on AWS API Gateway is also available. None of these are mandated by this spec.
- **Sentry + Lambda Powertools (per 002)**: Operational visibility primitives already used in the repo; the operational counters story (US-007) can build on these conventions.

---

## Anti-references

The following are explicitly _not_ assumed:

- No existing event bus, pub/sub broker, or message-queue convention is shared across features today. 003 uses SQS for its own backfill queue; that is not a notification bus.
- No existing user-preference store. The first revision of this feature deliberately defers preferences (per the product spec "Won't Have").
- No existing in-app notification UI primitive on the client. The launch will need a minimal client-side surface; specific design is consumer-feature-driven.

---

## Open follow-ups for research

- Decide whether group membership lives in this feature, in 002, or in a future identity feature (product-spec Q-002).
- Survey the repo's existing service-to-service auth conventions before answering product-spec Q-004.
- Confirm whether any client (web Next.js, Expo mobile) already has long-lived connections to the backend; if so, multiplex into them rather than open a new socket.
